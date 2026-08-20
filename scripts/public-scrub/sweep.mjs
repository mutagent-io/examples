#!/usr/bin/env node
/**
 * sweep.mjs — the GATE for the public mirror.
 *
 * Runs the detection manifest (sweep-rules.mjs) over a tree and reports every leak.
 * Exit 0 = clean; exit 1 = one or more leaks.
 *
 * PUBLISHED to mutagent-io/examples alongside sweep-rules.mjs, where
 * .github/workflows/validate.yml runs it on every push and PR. Deliberately
 * SELF-CONTAINED — it does not import from scrub.mjs, because scrub.mjs stays private.
 *
 * Pure Node, zero deps.
 * Usage: node sweep.mjs <tree-dir>
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SWEEP } from "./sweep-rules.mjs";

const TEXT_EXT = new Set([
  ".md", ".yaml", ".yml", ".ts", ".tsx", ".mjs", ".js", ".json", ".jsonl",
  ".sh", ".txt", ".html", ".py", ".toml", ".cfg", ".env", ".sample",
]);

/** Deterministic sorted walk. Exported so the pipeline can reuse it. */
export function listFiles(root, rel = "") {
  const out = [];
  for (const name of readdirSync(join(root, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    out.push(...(statSync(join(root, r)).isDirectory() ? listFiles(root, r) : [r]));
  }
  return out;
}

/** @returns {Array<{file,category,token,line,excerpt}>} */
export function runSweep(root) {
  const findings = [];
  for (const rel of listFiles(root)) {
    if (SWEEP.exemptPaths.some((re) => re.test(rel))) continue;

    // Path-shape rules match the path itself, whatever the file type.
    for (const p of SWEEP.paths) {
      if (p.re.test(rel)) {
        findings.push({ file: rel, category: p.name, token: "<path>", line: 0, excerpt: rel });
      }
    }

    const ext = extname(rel);
    if (!TEXT_EXT.has(ext)) continue;
    const codedRefApplies = SWEEP.codedRefExt.has(ext);

    const lines = readFileSync(join(root, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      const record = (category, token) =>
        findings.push({ file: rel, category, token, line: i + 1, excerpt: line.trim().slice(0, 120) });

      for (const t of SWEEP.terms) {
        const m = line.match(t.re);
        if (m) record(t.name, m[0]);
      }
      if (codedRefApplies) {
        const cr = line.match(SWEEP.codedRef);
        if (cr) record("coded-ref", cr[0]);
      }
      const sec = line.match(SWEEP.secrets);
      if (sec) record("secret", sec[0].slice(0, 12) + "…");
    });
  }
  return findings;
}

/** Group findings into { category: {count, tokens:{tok:count}} }. */
export function summarize(findings) {
  const by = {};
  for (const f of findings) {
    by[f.category] ??= { count: 0, tokens: {} };
    by[f.category].count++;
    by[f.category].tokens[f.token] = (by[f.category].tokens[f.token] || 0) + 1;
  }
  return by;
}

/** @returns true when clean. */
export function reportSweep(findings, log = console.info) {
  const by = summarize(findings);
  const cats = Object.keys(by).sort();
  if (cats.length === 0) {
    log("[sweep] CLEAN — 0 leaks");
    return true;
  }
  log("[sweep] LEAKS FOUND:");
  for (const c of cats) {
    const toks = Object.entries(by[c].tokens)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}×${n}`)
      .join(", ");
    log(`  ${c}: ${by[c].count}  [${toks}]`);
  }
  log(`[sweep] ${findings.length} site(s), first 25:`);
  for (const f of findings.slice(0, 25)) log(`  ${f.file}:${f.line}  (${f.token})  ${f.excerpt}`);
  return false;
}

const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = process.argv[2];
  if (!root || !existsSync(root)) {
    process.stderr.write("Usage: node sweep.mjs <tree-dir>\n");
    process.exit(1);
  }
  process.exit(reportSweep(runSweep(root)) ? 0 : 1);
}
