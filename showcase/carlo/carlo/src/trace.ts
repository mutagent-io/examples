/**
 * Observability sink (dogfood): every run persists its inputs, gate findings, decisions and
 * usage to a DISCOVERABLE local sink, so `*eval` and `*diagnose` have evidence to read.
 *
 * One JSONL file per task under a RELATIVE trace directory (never an absolute path). Append-only,
 * one `JSON.stringify` per line. Implements the injected `TraceSink` interface from types.ts (C2),
 * so the pipeline depends on the interface and not on this writer.
 *
 * Hard rule: a failing sink must never alter or fail the decision path.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TraceLine, TraceSink } from "./types.ts";

/** Values that must never reach a trace line even if a caller passes them in. */
const SECRET_KEY = /(key|token|secret|password|credential|authorization)/i;
/**
 * Usage COUNTERS are not secrets. The secret filter matches any key containing "token", which
 * silently scrubbed promptTokens/completionTokens/… and broke cost accounting — a token COUNT
 * (a key ending in "Tokens"/"TokenCount") is always numeric telemetry, never a credential.
 */
const TOKEN_COUNTER = /(tokens|tokencount)$/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const secret = SECRET_KEY.test(k) && !TOKEN_COUNTER.test(k);
      out[k] = secret ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

function safeFileName(taskId: string): string {
  const cleaned = taskId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${cleaned === "" ? "task" : cleaned}.jsonl`;
}

export class JsonlTraceSink implements TraceSink {
  private readonly dir: string;
  private ensured = false;
  /** Set once a write fails, so a broken sink degrades quietly instead of throwing every turn. */
  private disabled = false;

  constructor(dir: string) {
    this.dir = dir;
  }

  write(line: TraceLine): void {
    if (this.disabled) return;
    try {
      if (!this.ensured) {
        mkdirSync(this.dir, { recursive: true });
        this.ensured = true;
      }
      const payload = redact(line) as Record<string, unknown>;
      appendFileSync(join(this.dir, safeFileName(line.taskId)), `${JSON.stringify(payload)}\n`);
    } catch {
      this.disabled = true;
    }
  }

  /** Where the evidence lands — surfaced in the build report and the server banner. */
  get location(): string {
    return this.dir;
  }
}

/** An in-memory sink for tests and for callers that want the lines without touching disk. */
export class MemoryTraceSink implements TraceSink {
  readonly lines: TraceLine[] = [];
  write(line: TraceLine): void {
    this.lines.push(line);
  }
}
