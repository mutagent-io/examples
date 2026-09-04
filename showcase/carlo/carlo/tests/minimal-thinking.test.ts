/**
 * CARLO_MINIMAL, part 2: the wire-level reasoning-effort selector, the timeout-shaped backoff, and
 * arm attribution in the trace. These are the three items the ablation needs that cannot be seen
 * from the pipeline's own decisions — they live on the request payload, on the retry clock, and in
 * the evidence file `*eval`/`*diagnose` read afterwards.
 *
 * DOC PIN (crawled fresh at build time, 2026-08-26 —
 * cloud.google.com/vertex-ai/generative-ai/docs/thinking):
 *   - "Gemini 3 models introduce the thinking_level parameter" — `gemini-3.5-flash` supports
 *     MINIMAL | LOW | MEDIUM | HIGH, and its documented per-model DEFAULT is MEDIUM.
 *   - `thinking_budget` is the parameter for "models earlier than Gemini 3".
 *   - "If you specify both thinking_level and thinking_budget in the same request for a Gemini 3
 *     model, the model returns an error."
 * So the pinned model's HIGH-effort setting is `thinkingConfig.thinkingLevel = "HIGH"`, and exactly
 * ONE of the two keys may ever appear. `MINIMAL_THINKING_BUDGET` (-1) stays the CONFIG sentinel —
 * it is translated at the wire, never sent.
 */

import { describe, expect, test } from "bun:test";
import {
  buildRequest,
  MINIMAL_RETRY_BASE_MILLIS,
  MINIMAL_RETRY_FACTOR,
  THINKING_LEVEL_HIGH,
  thinkingConfigFor,
  VertexBackbone,
} from "../src/backbone/vertex.ts";
import { loadConfig, MINIMAL_THINKING_BUDGET } from "../src/config.ts";
import { GatePipeline } from "../src/pipeline.ts";
import { MemoryTraceSink } from "../src/trace.ts";
import type { BackboneRequest, TurnInput } from "../src/types.ts";
import { loadTools, loadWiki, MockBackbone, step, testConfig } from "./helpers/mock-backbone.ts";

const minimalConfig = () => testConfig({ minimal: true, thinkingBudget: MINIMAL_THINKING_BUDGET });

async function turnInput(over: Partial<TurnInput> = {}): Promise<TurnInput> {
  return {
    taskId: "task-thinking",
    turn: 0,
    systemPrompt: await loadWiki(),
    transcript: [{ role: "user", content: "Open the sunroof halfway." }],
    toolDefinitions: await loadTools(),
    ...over,
  };
}

const request: BackboneRequest = {
  systemInstruction: "policy first",
  transcript: [{ role: "user", content: "hi" }],
  tools: [],
};

/** A client that fails N times with a transient error, recording nothing but the attempt count. */
class FailingClient {
  attempts = 0;
  constructor(private readonly failures: number) {}
  models = {
    generateContent: async (): Promise<never> => {
      this.attempts += 1;
      if (this.attempts <= this.failures) {
        const error = new Error("fetch failed");
        (error as Error & { cause?: unknown }).cause = Object.assign(new Error("ETIMEDOUT"), {
          code: "ETIMEDOUT",
        });
        throw error;
      }
      return { text: "recovered" } as never;
    },
  };
}

// ── the reasoning-effort selector ─────────────────────────────────────────────────────────────

describe("thinkingConfig speaks the PINNED model's dialect", () => {
  test("default mode still sends thinkingBudget 0 — P5's live-verified payload, unchanged", () => {
    const payload = buildRequest(request, testConfig()) as Record<string, any>;
    expect(payload.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  test("minimal mode sends thinkingLevel HIGH, and the -1 sentinel never reaches the wire", () => {
    const payload = buildRequest(request, minimalConfig()) as Record<string, any>;
    expect(payload.config.thinkingConfig).toEqual({ thinkingLevel: THINKING_LEVEL_HIGH });
    expect(JSON.stringify(payload)).not.toContain("thinkingBudget");
    expect(JSON.stringify(payload)).not.toContain("-1");
  });

  test("NEVER both keys — a Gemini 3 model returns an error when both are present", () => {
    for (const config of [
      testConfig(),
      minimalConfig(),
      testConfig({ thinkingBudget: 1024 }),
      testConfig({ thinkingLevel: "LOW" }),
      testConfig({ minimal: true, thinkingBudget: -1, thinkingLevel: "MEDIUM" }),
    ]) {
      const keys = Object.keys(thinkingConfigFor(config));
      expect(keys.length).toBe(1);
      expect(["thinkingBudget", "thinkingLevel"]).toContain(keys[0] as string);
    }
  });

  test("CARLO_THINKING_LEVEL is the env selector the competition rules require, and it wins", () => {
    const config = loadConfig({ CARLO_MINIMAL: "1", CARLO_THINKING_LEVEL: "low" });
    expect(config.thinkingLevel).toBe("low");
    // Normalized to the documented enum spelling on the wire.
    expect(thinkingConfigFor(config)).toEqual({ thinkingLevel: "LOW" });
    // It also overrides an explicit budget rather than emitting both.
    expect(
      thinkingConfigFor(loadConfig({ CARLO_THINKING_BUDGET: "512", CARLO_THINKING_LEVEL: "HIGH" })),
    ).toEqual({ thinkingLevel: "HIGH" });
  });

  test("the level is unset by default, so nothing about the default arm moves", () => {
    expect(loadConfig({}).thinkingLevel).toBe("");
    expect(thinkingConfigFor(loadConfig({}))).toEqual({ thinkingBudget: 0 });
  });

  test("an explicit non-negative budget still goes out as a budget (2.5-era models stay usable)", () => {
    expect(thinkingConfigFor(testConfig({ thinkingBudget: 1024 }))).toEqual({
      thinkingBudget: 1024,
    });
  });

  test("temperature stays greedy in both arms — the pin the whole A/B rests on", () => {
    for (const config of [testConfig(), minimalConfig()]) {
      expect((buildRequest(request, config) as Record<string, any>).config.temperature).toBe(0);
    }
  });
});

// ── the retry clock ───────────────────────────────────────────────────────────────────────────

describe("minimal-mode backoff is timeout-shaped, not rate-limit-shaped", () => {
  test("minimal waits 2s then 8s; default keeps its original 250ms/500ms ladder", async () => {
    const cases: Array<{ config: ReturnType<typeof testConfig>; expected: number[] }> = [
      { config: minimalConfig(), expected: [MINIMAL_RETRY_BASE_MILLIS, 8_000] },
      { config: testConfig(), expected: [250, 500] },
    ];
    expect(MINIMAL_RETRY_BASE_MILLIS * MINIMAL_RETRY_FACTOR).toBe(8_000);

    for (const { config, expected } of cases) {
      const waits: number[] = [];
      const client = new FailingClient(2);
      const backbone = new VertexBackbone({
        config,
        client: client as never,
        sleep: async (ms) => {
          waits.push(ms);
        },
      });
      const result = await backbone.generate(request);
      expect(result.text).toBe("recovered");
      expect(client.attempts).toBe(3); // 1 draft + 2 retries — the budget root cause #6 needed
      expect(waits).toEqual(expected);
    }
  });

  test("the retry ceiling is the same in both arms: 3 attempts, then a typed throw", async () => {
    for (const config of [minimalConfig(), testConfig()]) {
      const client = new FailingClient(99);
      const backbone = new VertexBackbone({
        config,
        client: client as never,
        sleep: async () => {},
      });
      await expect(backbone.generate(request)).rejects.toThrow(/gemini-3\.5-flash/);
      expect(client.attempts).toBe(3);
    }
  });
});

// ── arm attribution in the evidence ───────────────────────────────────────────────────────────

describe("the trace says which arm produced it", () => {
  test("minimal mode stamps `minimal: true` on the ingest event", async () => {
    const sink = new MemoryTraceSink();
    await new GatePipeline({
      backbone: new MockBackbone([step("ok")]),
      config: minimalConfig(),
      sink,
    }).decideNextStep(await turnInput());

    const ingest = sink.lines.find((l) => l.phase === "ingest");
    expect(ingest).toBeDefined();
    expect(ingest?.minimal).toBe(true);
    // The digest stays alongside it: arm + tool surface are what a re-run has to match.
    expect(ingest?.inventoryDigest).toBeString();
  });

  test("the default arm's ingest line is untouched — the 2026-08-25 corpus stays diff-able", async () => {
    const sink = new MemoryTraceSink();
    await new GatePipeline({
      backbone: new MockBackbone([step("ok")]),
      config: testConfig(),
      sink,
    }).decideNextStep(await turnInput());

    const ingest = sink.lines.find((l) => l.phase === "ingest") as Record<string, unknown>;
    expect(Object.hasOwn(ingest, "minimal")).toBe(false);
  });
});
