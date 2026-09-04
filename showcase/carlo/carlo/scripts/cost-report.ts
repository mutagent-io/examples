// Cost ledger for CARlo ADL development — per benchmark run + cumulative.
//
// Two cost channels, summed per run label and overall:
//   1. HARNESS side (exact): each checkpoint record carries `user_cost` (simulated driver) and
//      `total_agent_cost` (LiteLLM response_cost — nonzero for the raw-Flash baseline arm; 0 for
//      CARlo, whose backbone runs outside the harness).
//   2. CARLO side (derived): per-turn token usage from traces/*.jsonl priced at Vertex list prices.
//      Trace files are attributed to the run label whose results-file mtime window contains their
//      first timestamp. Runs before the token-redaction fix (2026-08-25) show tokens=unknown.
//
// Usage:  bun scripts/cost-report.ts            (from carlo/)
// Writes: ../.mutagent/costs/ledger.json  and prints the table.

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

// Vertex list prices (USD per token), source: litellm.model_cost["vertex_ai/gemini-3.5-flash"].
const PRICE = {
  "gemini-3.5-flash": { input: 1.5e-6, output: 9e-6, thinking: 9e-6, cacheRead: 1.5e-7 },
};
const BACKBONE = "gemini-3.5-flash" as const;

const ROOT = process.cwd();
const RESULTS = join(ROOT, "results");
const TRACES = join(ROOT, "traces");
const LEDGER_DIR = join(ROOT, "..", ".mutagent", "costs");

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Python's json.dump can emit bare Infinity/NaN — neutralize before JSON.parse. */
function tolerantParse(text: string): unknown {
  return JSON.parse(text.replace(/\b(-?Infinity|NaN)\b/g, "null"));
}

interface RunRow {
  label: string;
  files: number;
  records: number;
  harnessUserCost: number;
  harnessAgentCost: number;
  carloTokens: { prompt: number; completion: number; thinking: number; cached: number } | null;
  carloCost: number | null;
  carloLlmCalls: number;
  tracesAttributed: number;
  tracesRedacted: number;
  endMtimeMs: number;
}

const runs = new Map<string, RunRow>();
if (existsSync(RESULTS)) {
  for (const f of walk(RESULTS)) {
    if (!f.endsWith(".json")) continue;
    let records: any[];
    try {
      const data = tolerantParse(readFileSync(f, "utf8"));
      records = Array.isArray(data) ? data : ((data as any)?.results ?? []);
    } catch {
      continue;
    }
    const label = relative(RESULTS, f).split("/").slice(0, -2).join("/") || relative(RESULTS, f);
    const row =
      runs.get(label) ??
      ({
        label, files: 0, records: 0, harnessUserCost: 0, harnessAgentCost: 0,
        carloTokens: null, carloCost: null, carloLlmCalls: 0,
        tracesAttributed: 0, tracesRedacted: 0, endMtimeMs: 0,
      } as RunRow);
    row.files += 1;
    row.endMtimeMs = Math.max(row.endMtimeMs, statSync(f).mtimeMs);
    for (const r of records) {
      row.records += 1;
      const uc = r?.info?.user_cost ?? r?.user_cost;
      const ac = r?.info?.total_agent_cost ?? r?.total_agent_cost;
      if (typeof uc === "number" && Number.isFinite(uc)) row.harnessUserCost += uc;
      if (typeof ac === "number" && Number.isFinite(ac)) row.harnessAgentCost += ac;
    }
    runs.set(label, row);
  }
}

// Attribute each trace file to the earliest run label whose end-mtime >= the trace's first ts.
const byEnd = [...runs.values()].sort((a, b) => a.endMtimeMs - b.endMtimeMs);
function labelFor(tsMs: number): RunRow | undefined {
  return byEnd.find((r) => r.endMtimeMs >= tsMs);
}

if (existsSync(TRACES)) {
  // traces/ may hold arm-specific subdirs (e.g. traces/minimal/) — walk one level deep
  const traceFiles: string[] = [];
  for (const e of readdirSync(TRACES, { withFileTypes: true })) {
    if (e.isDirectory()) {
      for (const f of readdirSync(join(TRACES, e.name))) {
        if (f.endsWith(".jsonl")) traceFiles.push(join(e.name, f));
      }
    } else if (e.name.endsWith(".jsonl")) traceFiles.push(e.name);
  }
  for (const e of traceFiles) {
    const lines = readFileSync(join(TRACES, e), "utf8").split("\n").filter(Boolean);
    let firstTs = 0;
    const tok = { prompt: 0, completion: 0, thinking: 0, cached: 0 };
    let calls = 0;
    let redacted = false;
    for (const line of lines) {
      let d: any;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (!firstTs && d.ts) firstTs = Date.parse(d.ts);
      const u = d.usage;
      if (!u) continue;
      if (typeof u.promptTokens === "string") {
        redacted = true;
        if (typeof u.llmCalls === "number") calls += u.llmCalls;
        continue;
      }
      if (typeof u.promptTokens === "number") {
        tok.prompt += u.promptTokens;
        tok.completion += u.completionTokens ?? 0;
        tok.thinking += u.thinkingTokens ?? 0;
        tok.cached += u.cachedTokens ?? 0;
        calls += u.llmCalls ?? 0;
      }
    }
    const row = firstTs ? labelFor(firstTs) : undefined;
    if (!row) continue;
    row.tracesAttributed += 1;
    row.carloLlmCalls += calls;
    if (redacted) row.tracesRedacted += 1;
    else {
      row.carloTokens ??= { prompt: 0, completion: 0, thinking: 0, cached: 0 };
      row.carloTokens.prompt += tok.prompt;
      row.carloTokens.completion += tok.completion;
      row.carloTokens.thinking += tok.thinking;
      row.carloTokens.cached += tok.cached;
    }
  }
}

const p = PRICE[BACKBONE];
for (const row of runs.values()) {
  if (row.carloTokens) {
    const t = row.carloTokens;
    row.carloCost =
      (t.prompt - t.cached) * p.input + t.cached * p.cacheRead + t.completion * p.output + t.thinking * p.thinking;
  }
}

const rows = [...runs.values()].sort((a, b) => a.endMtimeMs - b.endMtimeMs);
const total = {
  harness: rows.reduce((s, r) => s + r.harnessUserCost + r.harnessAgentCost, 0),
  carlo: rows.reduce((s, r) => s + (r.carloCost ?? 0), 0),
  redactedTraces: rows.reduce((s, r) => s + r.tracesRedacted, 0),
};

const fmt = (n: number | null) => (n === null ? "unknown" : `$${n.toFixed(4)}`);
console.log("run label                                | harness(user+agent) | carlo backbone | traces (redacted)");
console.log("-".repeat(105));
for (const r of rows) {
  console.log(
    `${r.label.padEnd(40)} | ${fmt(r.harnessUserCost + r.harnessAgentCost).padStart(19)} | ${fmt(r.carloCost).padStart(14)} | ${r.tracesAttributed} (${r.tracesRedacted})`,
  );
}
console.log("-".repeat(105));
console.log(
  `CUMULATIVE (all runs on disk)            | ${fmt(total.harness).padStart(19)} | ${fmt(total.carlo).padStart(14)} | redacted-token traces: ${total.redactedTraces}`,
);
console.log(`GRAND TOTAL: ${fmt(total.harness + total.carlo)}  (excludes runs whose artifacts were deleted; carlo-side unknown for redacted traces)`);

mkdirSync(LEDGER_DIR, { recursive: true });
writeFileSync(
  join(LEDGER_DIR, "ledger.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), backbone: BACKBONE, prices: p, runs: rows, total }, null, 2),
);
console.log(`ledger: ${relative(ROOT, join(LEDGER_DIR, "ledger.json"))}`);
