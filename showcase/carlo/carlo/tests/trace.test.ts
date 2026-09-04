import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatePipeline } from "../src/pipeline.ts";
import { JsonlTraceSink, MemoryTraceSink, redact } from "../src/trace.ts";
import { loadTools, loadWiki, MockBackbone, step, testConfig } from "./helpers/mock-backbone.ts";

describe("observability sink", () => {
  test("a run leaves one parseable JSONL line per traced phase", async () => {
    const dir = mkdtempSync(join(tmpdir(), "carlo-trace-"));
    const sink = new JsonlTraceSink(dir);
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "get_sunroof_and_sunshade_position", arguments: {} }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig(), sink });

    await pipeline.decideNextStep({
      taskId: "task-42",
      turn: 0,
      systemPrompt: await loadWiki(),
      transcript: [{ role: "user", content: "Is the sunshade open?" }],
      toolDefinitions: await loadTools(),
    });

    const files = readdirSync(dir);
    expect(files).toEqual(["task-42.jsonl"]);

    const lines = readFileSync(join(dir, "task-42.jsonl"), "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.taskId).toBe("task-42");
      expect(parsed.turn).toBe(0);
      expect(parsed.phase).toBeString();
      expect(parsed.ts).toBeString();
    }

    const emit = lines.map((l) => JSON.parse(l)).find((l) => l.phase === "emit");
    expect(emit.usage).toBeDefined();
    expect(emit.toolCalls[0].tool).toBe("get_sunroof_and_sunshade_position");
  });

  test("an unwritable directory degrades quietly instead of throwing", () => {
    const sink = new JsonlTraceSink("/proc/definitely/not/writable");
    expect(() => sink.write({ taskId: "t", turn: 0, phase: "emit", ts: "now" })).not.toThrow();
  });

  test("usage token COUNTERS survive redaction (cost accounting depends on them)", () => {
    const cleaned = redact({
      usage: {
        promptTokens: 100,
        completionTokens: 7,
        thinkingTokens: 0,
        cachedTokens: 3,
        totalTokens: 110,
      },
      usageMetadata: { promptTokenCount: 100 },
      apiToken: "secret-value",
    }) as Record<string, any>;

    expect(cleaned.usage.promptTokens).toBe(100);
    expect(cleaned.usage.totalTokens).toBe(110);
    expect(cleaned.usageMetadata.promptTokenCount).toBe(100);
    expect(cleaned.apiToken).toBe("[redacted]");
  });

  test("credential-shaped keys are redacted before they can reach disk", () => {
    const cleaned = redact({
      apiKey: "secret-value",
      nested: { authorization: "Bearer xyz", GOOGLE_API_KEY: "abc" },
      safe: "keep me",
    }) as Record<string, any>;

    expect(JSON.stringify(cleaned)).not.toContain("secret-value");
    expect(JSON.stringify(cleaned)).not.toContain("Bearer xyz");
    expect(cleaned.safe).toBe("keep me");
  });

  test("a task id with path characters cannot escape the trace directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "carlo-trace-"));
    const sink = new JsonlTraceSink(dir);
    sink.write({ taskId: "../../etc/passwd", turn: 0, phase: "emit", ts: "now" });

    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    expect(files[0]).not.toContain("/");
  });

  test("the memory sink captures lines for tests without touching disk", () => {
    const sink = new MemoryTraceSink();
    sink.write({ taskId: "t", turn: 1, phase: "draft", ts: "now" });
    expect(sink.lines.length).toBe(1);
  });
});

// ── /R3a: the trace must carry drafted/verified ARGUMENTS, not just tool names ──────────────
/**
 * Diagnosis : draft/verify records logged tool NAMES only, so no analysis could tell whether a
 * bad VALUE was authored by the draft or by the verify pass. Arguments are the enabler for every
 * groundedness remedy below — they must be present in the trace.
 */
describe("trace argument fidelity (F3/R3a)", () => {
  test("the draft record carries per-call arguments", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "get_weather", arguments: { location_or_poi_id: "Munich" } }]),
    ]);
    const sink = new MemoryTraceSink();
    const pipeline = new GatePipeline({ backbone, config: testConfig(), sink });

    await pipeline.decideNextStep({
      taskId: "task-args",
      turn: 0,
      systemPrompt: await loadWiki(),
      transcript: [{ role: "user", content: "What's the weather in Munich?" }],
      toolDefinitions: await loadTools(),
    });

    const draft = sink.lines.find((l) => l.phase === "draft") as any;
    expect(draft).toBeDefined();
    expect(draft.toolCalls[0].tool).toBe("get_weather");
    expect(draft.toolCalls[0].arguments).toEqual({ location_or_poi_id: "Munich" });
  });

  test("the verify record carries draft AND verified arguments", async () => {
    const transcript = [
      { role: "user" as const, content: "Open the sunroof halfway." },
      { role: "tool" as const, content: '{"weather":"sunny"}', toolName: "get_weather" },
      {
        role: "tool" as const,
        content: '{"sunshade":100}',
        toolName: "get_sunroof_and_sunshade_position",
      },
      { role: "tool" as const, content: '{"status":"SUCCESS"}', toolName: "open_close_sunshade" },
    ];
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
    ]);
    const sink = new MemoryTraceSink();
    const pipeline = new GatePipeline({ backbone, config: testConfig(), sink });

    await pipeline.decideNextStep({
      taskId: "task-verify-args",
      turn: 0,
      systemPrompt: await loadWiki(),
      transcript,
      toolDefinitions: await loadTools(),
    });

    const verify = sink.lines.find((l) => l.phase === "verify") as any;
    expect(verify).toBeDefined();
    expect(verify.draftCalls[0]).toEqual({
      tool: "open_close_sunroof",
      arguments: { percentage: 50 },
    });
    expect(verify.verifiedCalls[0]).toEqual({
      tool: "open_close_sunroof",
      arguments: { percentage: 50 },
    });
  });
});
