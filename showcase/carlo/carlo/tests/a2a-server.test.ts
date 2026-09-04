import { describe, expect, test } from "bun:test";
import { createHandler } from "../src/a2a/server.ts";
import { A2A_METHOD, AGENT_CARD_PATH } from "../src/a2a/wire.ts";
import { loadTools, loadWiki, MockBackbone, step, testConfig } from "./helpers/mock-backbone.ts";

const BASE = "http://carlo.test";

function rpc(message: Record<string, unknown>, id = "req-1"): Request {
  return new Request(`${BASE}/`, {
    method: "POST",
    headers: { "content-type": "application/a2a+json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: A2A_METHOD, params: { message } }),
  });
}

async function firstTurnMessage(overrides: Record<string, unknown> = {}) {
  const wiki = await loadWiki();
  const tools = await loadTools();
  return {
    messageId: "m1",
    role: "ROLE_USER",
    parts: [{ text: `System: ${wiki}\n\nUser: Open the sunroof halfway.` }, { data: { tools } }],
    metadata: { source: "user" },
    ...overrides,
  };
}

describe("A2A server", () => {
  test("serves an agent card the readiness probe can parse", async () => {
    const { fetch } = createHandler({
      config: testConfig(),
      backbone: new MockBackbone([]),
      sink: { write() {} },
    });
    const response = await fetch(new Request(`${BASE}${AGENT_CARD_PATH}`));
    expect(response.status).toBe(200);

    const card = (await response.json()) as Record<string, any>;
    expect(card.name).toBe("carlo");
    expect(card.supportedInterfaces[0].protocolBinding).toBe("JSONRPC");
    expect(card.supportedInterfaces[0].protocolVersion).toBe("1.0");
  });

  test("a first turn returns text and/or a tool-call data part", async () => {
    const backbone = new MockBackbone([
      step("Let me check the weather first.", [
        {
          toolName: "get_weather",
          arguments: { location_or_poi_id: "loc_1", month: 8, day: 24, time_hour_24hformat: 12 },
        },
      ]),
    ]);
    const { fetch } = createHandler({ config: testConfig(), backbone, sink: { write() {} } });

    const response = await fetch(rpc(await firstTurnMessage()));
    const body = (await response.json()) as Record<string, any>;

    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe("req-1");
    const parts = body.result.message.parts;
    expect(parts.some((p: any) => typeof p.text === "string")).toBe(true);
    expect(parts.some((p: any) => p.data?.tool_calls?.[0]?.tool_name === "get_weather")).toBe(true);
  });

  // ── G-H: contextId minting and echo ─────────────────────────────────────────────────────────
  test("G-H: a contextId is MINTED when the evaluator sends none, and echoed", async () => {
    const backbone = new MockBackbone([step("Hello.")]);
    const { fetch } = createHandler({
      config: testConfig(),
      backbone,
      sink: { write() {} },
      newId: () => "minted-ctx",
    });

    const message = await firstTurnMessage();
    expect((message as Record<string, unknown>).contextId).toBeUndefined();

    const body = (await (await fetch(rpc(message))).json()) as Record<string, any>;
    expect(body.result.message.contextId).toBe("minted-ctx");
  });

  test("G-H: the echoed contextId continues the SAME conversation on the next turn", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "get_sunroof_and_sunshade_position", arguments: {} }]),
      step("The sunshade is already open."),
    ]);
    const { fetch, executor } = createHandler({
      config: testConfig(),
      backbone,
      sink: { write() {} },
      newId: () => "ctx-1",
    });

    await fetch(rpc(await firstTurnMessage()));
    await fetch(
      rpc({
        messageId: "m2",
        contextId: "ctx-1",
        role: "ROLE_USER",
        parts: [
          {
            data: {
              tool_results: [
                {
                  tool_name: "get_sunroof_and_sunshade_position",
                  tool_call_id: "c1",
                  content: "{}",
                },
              ],
            },
          },
        ],
        metadata: { source: "environment" },
      }),
    );

    // One conversation, not two — and the tool result reached the transcript.
    expect(executor.activeContexts).toBe(1);
    const secondRequest = backbone.requests[1];
    expect(secondRequest?.transcript.some((e) => e.role === "tool")).toBe(true);
  });

  test("two different contextIds never bleed history", async () => {
    const backbone = new MockBackbone([step("A"), step("B")]);
    const { fetch, executor } = createHandler({
      config: testConfig(),
      backbone,
      sink: { write() {} },
    });

    await fetch(rpc(await firstTurnMessage({ contextId: "ctx-A" })));
    await fetch(rpc(await firstTurnMessage({ contextId: "ctx-B", messageId: "m2" })));

    expect(executor.activeContexts).toBe(2);
    // The second task's draft must not see ANY of the first task's turns.
    const second = backbone.requests[1]?.transcript ?? [];
    expect(second.length).toBe(1);
    expect(second.filter((e) => e.role === "user").length).toBe(1);
    expect(JSON.stringify(second)).not.toContain('"A"');
  });

  test("turn_metrics: absent on a tool-call turn, present and summed on the final turn", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "get_sunroof_and_sunshade_position", arguments: {} }]),
      step("All set."),
    ]);
    const { fetch } = createHandler({
      config: testConfig(),
      backbone,
      sink: { write() {} },
      newId: () => "ctx-1",
    });

    const toolTurn = (await (await fetch(rpc(await firstTurnMessage()))).json()) as Record<
      string,
      any
    >;
    expect(toolTurn.result.message.metadata).toBeUndefined();

    const finalTurn = (await (
      await fetch(
        rpc({
          messageId: "m2",
          contextId: "ctx-1",
          role: "ROLE_USER",
          parts: [
            {
              data: {
                tool_results: [
                  {
                    tool_name: "get_sunroof_and_sunshade_position",
                    tool_call_id: "c1",
                    content: "{}",
                  },
                ],
              },
            },
          ],
        }),
      )
    ).json()) as Record<string, any>;

    const metrics = finalTurn.result.message.metadata.turn_metrics;
    // Aggregated across BOTH passes of this assistant step.
    expect(metrics.prompt_tokens).toBe(200);
    expect(metrics.num_llm_calls).toBe(2);
    expect(metrics.model).toBe(testConfig().model);
    expect(metrics.num_passes).toBeGreaterThanOrEqual(1);
    // The evaluator adds turn_time_ms itself; we must never send it.
    expect(metrics.turn_time_ms).toBeUndefined();
  });

  test("cancel drops the conversation state", async () => {
    const backbone = new MockBackbone([step("hi")]);
    const { fetch, executor } = createHandler({
      config: testConfig(),
      backbone,
      sink: { write() {} },
      newId: () => "ctx-1",
    });

    await fetch(rpc(await firstTurnMessage()));
    expect(executor.activeContexts).toBe(1);
    executor.cancel("ctx-1");
    expect(executor.activeContexts).toBe(0);
  });

  test("a bad frame returns a JSON-RPC error and keeps the server alive", async () => {
    const backbone = new MockBackbone([step("hi")]);
    const { fetch } = createHandler({ config: testConfig(), backbone, sink: { write() {} } });

    const bad = new Request(`${BASE}/`, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "Nope", params: {} }),
    });
    const body = (await (await fetch(bad)).json()) as Record<string, any>;
    expect(body.error.code).toBe(-32601);

    // Still serving afterwards.
    const ok = await fetch(rpc(await firstTurnMessage()));
    expect(ok.status).toBe(200);
  });

  test("emitted tool and parameter names are byte-identical to the declared schema", async () => {
    const backbone = new MockBackbone([
      step(undefined, [
        {
          toolName: "get_weather",
          arguments: { location_or_poi_id: "loc_1", month: 8, day: 24, time_hour_24hformat: 12 },
        },
      ]),
    ]);
    const { fetch } = createHandler({ config: testConfig(), backbone, sink: { write() {} } });
    const body = (await (await fetch(rpc(await firstTurnMessage()))).json()) as Record<string, any>;

    const call = body.result.message.parts.find((p: any) => p.data?.tool_calls)?.data.tool_calls[0];
    expect(call.tool_name).toBe("get_weather");
    expect(Object.keys(call.arguments).sort()).toEqual([
      "day",
      "location_or_poi_id",
      "month",
      "time_hour_24hformat",
    ]);
  });
});
