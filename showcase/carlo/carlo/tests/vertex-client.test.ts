import { describe, expect, test } from "bun:test";
import {
  BackboneError,
  buildContents,
  buildRequest,
  type GenAiLike,
  type GenerateContentLike,
  mapResult,
  mapUsage,
  REPLAYED_CALL_SIGNATURE,
  VertexBackbone,
} from "../src/backbone/vertex.ts";
import { buildInventory, listTools } from "../src/inventory.ts";
import type { BackboneRequest } from "../src/types.ts";
import { EMPTY_USAGE } from "../src/types.ts";
import { loadTools, testConfig } from "./helpers/mock-backbone.ts";

/** A stand-in for the SDK. NO network: gate execution is hermetic. */
class FakeClient implements GenAiLike {
  readonly seen: Record<string, unknown>[] = [];
  constructor(
    private readonly responses: Array<GenerateContentLike | Error>,
    private readonly fallback: GenerateContentLike = { text: "ok" },
  ) {}
  models = {
    generateContent: async (request: Record<string, unknown>): Promise<GenerateContentLike> => {
      this.seen.push(request);
      const next = this.responses.shift() ?? this.fallback;
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

async function sampleRequest(): Promise<BackboneRequest> {
  const inventory = buildInventory(await loadTools());
  return {
    systemInstruction: "policy first, then CARlo rules",
    transcript: [{ role: "user", content: "Open the sunroof halfway." }],
    tools: listTools(inventory),
  };
}

describe("vertex-client request construction", () => {
  test("every call pins temperature 0, thinking disabled, AFC disabled, and the configured model", async () => {
    const config = testConfig();
    const payload = buildRequest(await sampleRequest(), config) as Record<string, any>;

    expect(payload.model).toBe("gemini-3.5-flash");
    expect(payload.config.temperature).toBe(0);
    // P5: thinking is ON by default for this model; disabling it is explicit and load-bearing.
    expect(payload.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    // We never execute tools, so automatic function calling must be off (P6).
    expect(payload.config.automaticFunctionCalling).toEqual({ disable: true });
    expect(payload.config.systemInstruction).toBe("policy first, then CARlo rules");
  });

  test("tool schemas pass through as parametersJsonSchema BY REFERENCE (never rewritten)", async () => {
    const request = await sampleRequest();
    const payload = buildRequest(request, testConfig()) as Record<string, any>;
    const declarations = payload.config.tools[0].functionDeclarations;

    expect(declarations.length).toBe(request.tools.length);
    const sunroof = declarations.find((d: any) => d.name === "open_close_sunroof");
    const source = request.tools.find((t) => t.name === "open_close_sunroof");
    expect(sunroof.parametersJsonSchema).toBe(source?.parameters);
    // The legacy `parameters` field must NOT be used — it is mutually exclusive and lossy.
    expect(sunroof.parameters).toBeUndefined();
  });

  test("transcript maps to contents with tool results replayed as functionResponse parts", () => {
    const contents = buildContents({
      systemInstruction: "s",
      tools: [],
      transcript: [
        { role: "user", content: "Open it." },
        {
          role: "assistant",
          content: "Checking.",
          toolCalls: [{ toolName: "get_weather", arguments: { a: 1 } }],
        },
        { role: "tool", content: '{"condition":"sunny"}', toolName: "get_weather" },
      ],
    });

    expect(contents[0]).toEqual({ role: "user", parts: [{ text: "Open it." }] });
    expect((contents[1] as any).role).toBe("model");
    expect((contents[1] as any).parts[1].functionCall).toEqual({
      name: "get_weather",
      args: { a: 1 },
    });
    expect((contents[2] as any).parts[0].functionResponse.name).toBe("get_weather");
  });

  test("replayed functionCall parts carry the documented placeholder thought signature", () => {
    // Gemini 3.x 400s on replayed functionCall parts without a thoughtSignature (observed live
    // 2026-08-25, smoke run: "Function call is missing a thought_signature in functionCall parts").
    const contents = buildContents({
      systemInstruction: "s",
      tools: [],
      transcript: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ toolName: "get_weather", arguments: {} }],
        },
      ],
    });
    expect((contents[0] as any).parts[0].thoughtSignature).toBe(REPLAYED_CALL_SIGNATURE);
  });

  test("a captured thought signature is echoed verbatim instead of the placeholder", () => {
    const contents = buildContents({
      systemInstruction: "s",
      tools: [],
      transcript: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ toolName: "get_weather", arguments: {}, thoughtSignature: "sig-abc" }],
        },
      ],
    });
    expect((contents[0] as any).parts[0].thoughtSignature).toBe("sig-abc");
  });

  test("a critique is appended as the last turn for the verify pass", () => {
    const contents = buildContents({
      systemInstruction: "s",
      tools: [],
      transcript: [{ role: "user", content: "hi" }],
      critique: "re-check this",
    });
    expect((contents.at(-1) as any).parts[0].text).toBe("re-check this");
  });
});

describe("vertex-client response mapping", () => {
  test("functionCalls map to {toolName, arguments, id} with names preserved", () => {
    const result = mapResult(
      {
        text: "Opening.",
        functionCalls: [{ name: "open_close_sunroof", args: { percentage: 50 }, id: "call_67995" }],
      },
      EMPTY_USAGE,
    );
    expect(result.toolCalls).toEqual([
      { toolName: "open_close_sunroof", arguments: { percentage: 50 }, id: "call_67995" },
    ]);
    expect(result.text).toBe("Opening.");
  });

  test("usage mapping is undefined-safe (a real response omitted candidatesTokenCount)", () => {
    // Shape observed live on 2026-08-24 (probe P4).
    const usage = mapUsage(
      { usageMetadata: { promptTokenCount: 1, totalTokenCount: 5, thoughtsTokenCount: 4 } },
      20,
    );
    expect(usage.promptTokens).toBe(1);
    expect(usage.completionTokens).toBe(0);
    expect(usage.thinkingTokens).toBe(4);
    expect(usage.totalTokens).toBe(5);

    const empty = mapUsage({}, 0);
    expect(empty.totalTokens).toBe(0);
  });

  test("thought signatures are captured from raw candidate parts when present", () => {
    const result = mapResult(
      {
        functionCalls: [{ name: "get_weather", args: { a: 1 } }],
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { name: "get_weather", args: { a: 1 } },
                  thoughtSignature: "sig-1",
                },
              ],
            },
          },
        ],
      },
      EMPTY_USAGE,
    );
    expect(result.toolCalls).toEqual([
      { toolName: "get_weather", arguments: { a: 1 }, id: undefined, thoughtSignature: "sig-1" },
    ]);
  });

  test("nameless function calls are dropped rather than emitted", () => {
    const result = mapResult(
      { functionCalls: [{ args: {} }, { name: "", args: {} }] },
      EMPTY_USAGE,
    );
    expect(result.toolCalls).toEqual([]);
  });
});

describe("vertex-client failure behavior", () => {
  test("a transient error is retried and then succeeds", async () => {
    const client = new FakeClient([new Error("503 unavailable"), { text: "recovered" }]);
    const backbone = new VertexBackbone({ config: testConfig(), client, sleep: async () => {} });

    const result = await backbone.generate(await sampleRequest());
    expect(result.text).toBe("recovered");
    expect(client.seen.length).toBe(2);
  });

  test("a persistent failure THROWS naming the pinned model — no fallback model is ever tried", async () => {
    const client = new FakeClient([
      new Error("503 unavailable"),
      new Error("503 unavailable"),
      new Error("503 unavailable"),
    ]);
    const backbone = new VertexBackbone({ config: testConfig(), client, sleep: async () => {} });

    await expect(backbone.generate(await sampleRequest())).rejects.toThrow(BackboneError);

 /: model intent is sacred. Every attempt used the pinned model and nothing else.
    const models = new Set(client.seen.map((r) => r.model));
    expect([...models]).toEqual(["gemini-3.5-flash"]);
  });

  test("a non-retryable error fails fast", async () => {
    const client = new FakeClient([new Error("404 model not found")]);
    const backbone = new VertexBackbone({ config: testConfig(), client, sleep: async () => {} });

    await expect(backbone.generate(await sampleRequest())).rejects.toThrow(/404/);
    expect(client.seen.length).toBe(1);
  });

  test("the client is constructed with explicit project/location and never an apiKey", () => {
    const config = testConfig();
    // Constructed lazily against the real SDK only when no client is injected; assert the
    // configuration we would pass (P4: this model resolves only at `global`).
    expect(config.location).toBe("global");
    expect(config.useVertex).toBe(true);
    expect(JSON.stringify(config)).not.toContain("apiKey");
  });
});

// ── : parallel tool results must be replayed as ONE user turn ────────────────────────────
/**
 * Gemini requires that a model turn carrying k functionCall parts be answered by a SINGLE user
 * turn carrying exactly k functionResponse parts. Replaying each result as its own user turn is a
 * deterministic 400 that permanently poisons the transcript (diagnosis).
 */
function assertResponseParity(contents: Array<Record<string, unknown>>): void {
  for (let i = 0; i < contents.length; i += 1) {
    const turn = contents[i] as any;
    if (turn.role !== "model") continue;
    const k = (turn.parts as any[]).filter((p) => p.functionCall).length;
    if (k === 0) continue;
    const next = contents[i + 1] as any;
    expect(next).toBeDefined();
    expect(next.role).toBe("user");
    const responses = (next.parts as any[]).filter((p) => p.functionResponse);
    expect(responses.length).toBe(k);
    // A functionResponse turn answering calls carries NOTHING else.
    expect(next.parts.length).toBe(k);
  }
}

function parallelTranscript(k: number): BackboneRequest["transcript"] {
  const names = Array.from({ length: k }, (_, i) => `get_tool_${i}`);
  return [
    { role: "user", content: "Do several things." },
    {
      role: "assistant",
      content: "On it.",
      toolCalls: names.map((name) => ({ toolName: name, arguments: { i: name } })),
    },
    ...names.map((name) => ({
      role: "tool" as const,
      content: `{"tool":"${name}"}`,
      toolName: name,
    })),
  ];
}

describe("vertex-client parallel functionResponse batching (F1/R1)", () => {
  test("k=2 parallel results collapse into ONE user turn with 2 parts in call order", () => {
    const contents = buildContents({
      systemInstruction: "s",
      tools: [],
      transcript: parallelTranscript(2),
    });

    // user, model, user(2 responses) — and nothing more.
    expect(contents.length).toBe(3);
    const responseTurn = contents[2] as any;
    expect(responseTurn.role).toBe("user");
    expect(responseTurn.parts.length).toBe(2);
    expect(responseTurn.parts.map((p: any) => p.functionResponse.name)).toEqual([
      "get_tool_0",
      "get_tool_1",
    ]);
    // Matching stays positional + by name: no ids on either side.
    for (const part of responseTurn.parts) {
      expect(part.functionResponse.id).toBeUndefined();
      expect(Object.keys(part.functionResponse).sort()).toEqual(["name", "response"]);
    }
  });

  test("response parity holds for k = 1, 2 and 3", () => {
    for (const k of [1, 2, 3]) {
      assertResponseParity(
        buildContents({ systemInstruction: "s", tools: [], transcript: parallelTranscript(k) }),
      );
    }
  });

  test("k=1 keeps the previous single-part shape (byte-identical, zero regression)", () => {
    const contents = buildContents({
      systemInstruction: "s",
      tools: [],
      transcript: parallelTranscript(1),
    });
    expect(contents[2]).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: { name: "get_tool_0", response: { result: '{"tool":"get_tool_0"}' } },
        },
      ],
    });
  });

  test("a duplicate-name batch preserves ORDER (matching is positional)", () => {
    const contents = buildContents({
      systemInstruction: "s",
      tools: [],
      transcript: [
        { role: "user", content: "Both windows." },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { toolName: "open_close_window", arguments: { seat: "front_left" } },
            { toolName: "open_close_window", arguments: { seat: "front_right" } },
          ],
        },
        { role: "tool", content: '{"seat":"front_left"}', toolName: "open_close_window" },
        { role: "tool", content: '{"seat":"front_right"}', toolName: "open_close_window" },
      ],
    });

    const responseTurn = contents.at(-1) as any;
    expect(responseTurn.parts.length).toBe(2);
    expect(responseTurn.parts.map((p: any) => p.functionResponse.response.result)).toEqual([
      '{"seat":"front_left"}',
      '{"seat":"front_right"}',
    ]);
    assertResponseParity(contents);
  });

  test("a batch is flushed on the next non-tool entry, not merged into it", () => {
    const contents = buildContents({
      systemInstruction: "s",
      tools: [],
      transcript: [
        ...parallelTranscript(2),
        { role: "user", content: "Thanks, also open the roof." },
      ],
    });

    expect(contents.length).toBe(4);
    expect((contents[2] as any).parts.length).toBe(2);
    expect(contents[3]).toEqual({
      role: "user",
      parts: [{ text: "Thanks, also open the roof." }],
    });
    assertResponseParity(contents);
  });

  test("the critique lands AFTER the grouped responses, never inside them", () => {
    const contents = buildContents({
      systemInstruction: "s",
      tools: [],
      transcript: parallelTranscript(2),
      critique: "re-check this",
    });

    expect((contents[2] as any).parts.length).toBe(2);
    expect((contents[2] as any).parts.every((p: any) => p.functionResponse)).toBe(true);
    expect(contents.at(-1)).toEqual({ role: "user", parts: [{ text: "re-check this" }] });
    assertResponseParity(contents);
  });
});
