/**
 * CARLO_MINIMAL — the ④ DIAGNOSE ablation ("CARlo-minimal", diagnosis.md §Disposition).
 *
 * The full six-gate pipeline lost the A/B (0.388 vs 0.566 raw-Flash Pass³): the feasibility gate
 * false-refused from UTTERANCE keywords, the ambiguity gate was net-negative everywhere, the policy
 * pre-check redirected drafts it could not repair, and 4 trials died to un-retried backbone
 * timeouts. `CARLO_MINIMAL=1` keeps ONLY what the corpus showed paid for itself:
 *
 *   live-schema validation + in-turn retry (budget 4, then strip)   [kept]
 *   unexpressible-attribute, grounded in the INVENTORY only         [kept]
 *   backbone retry on transient failure                             [added]
 *   5 general behavior bullets + HIGH thinking                      [added]
 *
 * DEFAULT IS OFF. Every assertion here that names the default mode is a regression guard: the flag
 * must not shift unflagged behavior by a single byte.
 */

import { describe, expect, test } from "bun:test";
import { buildRequest, VertexBackbone } from "../src/backbone/vertex.ts";
import { loadConfig, MINIMAL_THINKING_BUDGET } from "../src/config.ts";
import { buildInventory } from "../src/inventory.ts";
import { GatePipeline, MINIMAL_CALL_BUDGET } from "../src/pipeline.ts";
import { composeSystemInstruction, MINIMAL_BEHAVIOR_RULES, SYSTEM_PROMPT } from "../src/prompts.ts";
import { MemoryTraceSink } from "../src/trace.ts";
import type { RawToolDefinition, TurnInput } from "../src/types.ts";
import { loadTools, loadWiki, MockBackbone, step, testConfig } from "./helpers/mock-backbone.ts";

const minimalConfig = () => testConfig({ minimal: true, thinkingBudget: MINIMAL_THINKING_BUDGET });

async function turnInput(
  over: Partial<TurnInput> = {},
  file = "tools-info.json",
): Promise<TurnInput> {
  return {
    taskId: "task-min",
    turn: 0,
    systemPrompt: await loadWiki(),
    transcript: [{ role: "user", content: "Open the sunroof halfway." }],
    toolDefinitions: await loadTools(file),
    ...over,
  };
}

/** The hallucination_6 mutation: `lightcolor` deleted from BOTH `properties` and `required`. */
async function ambientLightsWithoutColor(): Promise<RawToolDefinition[]> {
  const defs = (await loadTools()).map((d) => JSON.parse(JSON.stringify(d)) as RawToolDefinition);
  for (const def of defs) {
    if (def.function?.name !== "set_ambient_lights") continue;
    const parameters = def.function.parameters as Record<string, any>;
    delete parameters.properties.lightcolor;
    parameters.required = (parameters.required as string[]).filter((r) => r !== "lightcolor");
  }
  return defs;
}

// ── (i) FLAG OFF ⇒ NOTHING CHANGES ────────────────────────────────────────────────────────────

describe("CARLO_MINIMAL is OFF by default", () => {
  test("the config default is minimal=false with thinking still disabled", () => {
    const config = loadConfig({});
    expect(config.minimal).toBe(false);
    expect(config.thinkingBudget).toBe(0); // default mode keeps thinking OFF (gap G-E)
  });

  test("the flag is settable from the environment and flips thinking to HIGH", () => {
    const config = loadConfig({ CARLO_MINIMAL: "1" });
    expect(config.minimal).toBe(true);
    // HIGH reasoning = dynamic budget (-1, model decides) — Thylinao's key disambiguation stabiliser.
    expect(config.thinkingBudget).toBe(MINIMAL_THINKING_BUDGET);
    expect(MINIMAL_THINKING_BUDGET).toBe(-1);
    // Temperature is greedy in BOTH modes: sampling variance is what Pass³ punishes.
    expect(config.temperature).toBe(0);
  });

  test("an explicit CARLO_THINKING_BUDGET still wins in minimal mode", () => {
    expect(loadConfig({ CARLO_MINIMAL: "1", CARLO_THINKING_BUDGET: "512" }).thinkingBudget).toBe(
      512,
    );
  });

  test("the default pipeline still runs all six gates in order", async () => {
    const backbone = new MockBackbone([
      step("Checking the weather.", [{ toolName: "get_weather", arguments: {} }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    await pipeline.decideNextStep(await turnInput());

    expect(pipeline.lastGateOrder).toEqual([
      "feasibility",
      "ambiguity",
      "draft",
      "policy",
      "args",
      "escalation",
    ]);
  });
});

// ── (ii) MINIMAL SKIPS feasibility / ambiguity / policy-precheck / verify ──────────────────────

describe("minimal mode skips the gates the diagnosis charged for the GATE FAIL", () => {
  test("the executed gate order is draft -> schema-validate only", async () => {
    const backbone = new MockBackbone([step("ok")]);
    const pipeline = new GatePipeline({ backbone, config: minimalConfig() });
    await pipeline.decideNextStep(await turnInput());
    expect(pipeline.lastGateOrder).toEqual(["draft", "args"]);
  });

  test("the utterance-triggered absent-capability refusal is GONE (root cause #1)", async () => {
    // Default mode: "open the sunshade" + a removed sunshade tool = a canned refusal, llmCalls 0.
    const blocked = new MockBackbone([step("unused")]);
    const blockedPipeline = new GatePipeline({ backbone: blocked, config: testConfig() });
    const before = await blockedPipeline.decideNextStep(
      await turnInput(
        { transcript: [{ role: "user", content: "Open the sunshade for me." }] },
        "tools-info-removed-tool.json",
      ),
    );
    expect(blocked.calls).toBe(0);
    expect(before.findings.some((f) => f.gate === "feasibility")).toBe(true);

    // Minimal mode: the model is ALWAYS called; nothing is refused from utterance keywords.
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "get_sunroof_and_sunshade_position", arguments: {} }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: minimalConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput(
        { transcript: [{ role: "user", content: "Open the sunshade for me." }] },
        "tools-info-removed-tool.json",
      ),
    );

    expect(backbone.calls).toBe(1);
    expect(decision.toolCalls.map((c) => c.toolName)).toEqual([
      "get_sunroof_and_sunshade_position",
    ]);
    expect(decision.findings).toEqual([]);
  });

  test("the prose-fabrication gate no longer rewrites the model's own text", async () => {
    const backbone = new MockBackbone([step("I'll open the sunshade for you now.")]);
    const pipeline = new GatePipeline({ backbone, config: minimalConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput(
        { transcript: [{ role: "user", content: "Open the sunshade." }] },
        "tools-info-removed-tool.json",
      ),
    );
    expect(decision.text).toBe("I'll open the sunshade for you now.");
  });

  test("the policy pre-check no longer redirects a state change", async () => {
    // Default mode replaces the sunroof call with the weather prerequisite.
    const gated = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
      step(undefined, [{ toolName: "get_weather", arguments: {} }]),
    ]);
    const before = await new GatePipeline({
      backbone: gated,
      config: testConfig(),
    }).decideNextStep(await turnInput());
    expect(before.toolCalls.map((c) => c.toolName)).not.toContain("open_close_sunroof");

    // Minimal mode emits exactly what the model drafted, in one pass.
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
    ]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput());

    expect(backbone.calls).toBe(1);
    expect(decision.toolCalls.map((c) => c.toolName)).toEqual(["open_close_sunroof"]);
    expect(decision.findings.some((f) => f.gate === "policy")).toBe(false);
  });

  test("no confirmation-gate turn is injected in front of a REQUIRES_CONFIRMATION tool", async () => {
    const transcript: TurnInput["transcript"] = [
      { role: "user", content: "Open the sunroof halfway." },
      { role: "tool", content: '{"weather":"sunny"}', toolName: "get_weather" },
      { role: "tool", content: '{"sunshade":100}', toolName: "get_sunroof_and_sunshade_position" },
      { role: "tool", content: '{"status":"SUCCESS"}', toolName: "open_close_sunshade" },
    ];
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
    ]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput({ transcript }));

    expect(decision.toolCalls.map((c) => c.toolName)).toEqual(["open_close_sunroof"]);
    expect(decision.findings.some((f) => f.code === "confirmation-required")).toBe(false);
  });

  test("verify escalation is gone: a risky state change costs exactly ONE backbone call", async () => {
    const transcript: TurnInput["transcript"] = [
      { role: "user", content: "Open the sunroof halfway." },
      { role: "tool", content: '{"weather":"sunny"}', toolName: "get_weather" },
      { role: "tool", content: '{"sunshade":100}', toolName: "get_sunroof_and_sunshade_position" },
      { role: "tool", content: '{"status":"SUCCESS"}', toolName: "open_close_sunshade" },
    ];
    const call = { toolName: "open_close_sunroof", arguments: { percentage: 50 } };

    const risky = new MockBackbone([step(undefined, [call]), step(undefined, [call])]);
    const before = await new GatePipeline({
      backbone: risky,
      config: testConfig(),
    }).decideNextStep(await turnInput({ transcript }));
    expect(risky.calls).toBe(2);
    expect(before.passes).toBe(2);

    const backbone = new MockBackbone([step(undefined, [call]), step(undefined, [call])]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput({ transcript }));
    expect(backbone.calls).toBe(1);
    expect(decision.passes).toBe(1);
  });

  test("a clarifying question is NOT replanned away (the disambiguation-family regression)", async () => {
    const backbone = new MockBackbone([step("Which window would you like me to open?")]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(
      await turnInput({ transcript: [{ role: "user", content: "Open the window." }] }),
    );

    expect(backbone.calls).toBe(1); // default mode spends a second "call it now instead of asking" pass
    expect(decision.text).toBe("Which window would you like me to open?");
    expect(decision.findings.some((f) => f.gate === "ambiguity")).toBe(false);
  });
});

// ── (iii) SCHEMA-VALIDATE + IN-TURN RETRY, BUDGET 4, THEN STRIP ────────────────────────────────

describe("minimal mode KEEPS live-schema validation with in-turn retry", () => {
  const bad = { toolName: "open_close_sunroof", arguments: { percent: 50 } }; // undeclared parameter
  const good = { toolName: "open_close_sunroof", arguments: { percentage: 50 } };

  test("a valid first draft costs exactly one backbone call", async () => {
    const backbone = new MockBackbone([step(undefined, [good])]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput());
    expect(backbone.calls).toBe(1);
    expect(decision.toolCalls).toEqual([good]);
    expect(decision.findings).toEqual([]);
  });

  test("an invalid call is re-asked in-turn and the corrected call is emitted", async () => {
    const backbone = new MockBackbone([step(undefined, [bad]), step(undefined, [good])]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput());

    expect(backbone.calls).toBe(2);
    expect(decision.toolCalls).toEqual([good]);
    expect(decision.passes).toBe(2);
  });

  test("the retry budget is 4 model calls per action decision, then the calls are STRIPPED", async () => {
    expect(MINIMAL_CALL_BUDGET).toBe(4);
    const backbone = new MockBackbone(
      [
        step(undefined, [bad]),
        step(undefined, [bad]),
        step(undefined, [bad]),
        step(undefined, [bad]),
      ],
      step(undefined, [good]), // a 5th call would repair it — proving the budget is what stops us
    );
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput());

    expect(backbone.calls).toBe(MINIMAL_CALL_BUDGET);
    expect(decision.toolCalls).toEqual([]); // stripped, never dispatched
    expect(decision.findings.some((f) => f.code === "unknown-parameter")).toBe(true);
    expect(decision.text).toBeString();
  });

  test("only the INVALID calls are stripped; valid siblings survive", async () => {
    const invalidPlusValid = step(undefined, [
      bad,
      { toolName: "get_climate_settings", arguments: {} },
    ]);
    const backbone = new MockBackbone([
      invalidPlusValid,
      invalidPlusValid,
      invalidPlusValid,
      invalidPlusValid,
    ]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput());

    expect(decision.toolCalls.map((c) => c.toolName)).toEqual(["get_climate_settings"]);
  });

  test("an unknown TOOL is an in-turn capability-absence observation, never a rewrite", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunshade", arguments: { percentage: 100 } }]),
      step("The sunshade control isn't available in this car."),
    ]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput({}, "tools-info-removed-tool.json"));

    const critique = backbone.requests[1]?.critique ?? "";
    expect(critique).toContain("open_close_sunshade");
    expect(critique.toLowerCase()).toContain("not available");
    // Compliance: absence is reported as capability-absence, NEVER as removal detection.
    expect(critique.toLowerCase()).not.toContain("remov");
    expect(critique.toLowerCase()).not.toContain("delet");
    expect(decision.toolCalls).toEqual([]);
    expect(decision.text).toBe("The sunshade control isn't available in this car.");
  });

  test("a missing REQUIRED parameter is retried too (repairable defects use the same loop)", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: {} }]),
      step(undefined, [good]),
    ]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput());
    expect(backbone.calls).toBe(2);
    expect(decision.toolCalls).toEqual([good]);
  });
});

// ── (iv) unexpressible-attribute: INVENTORY-GROUNDED ONLY, never utterance text ────────────────

describe("unexpressible-attribute fires from the tool inventory, not from what was said", () => {
  test("it fires when the carrier parameter is genuinely absent from the live schema", async () => {
    const outputs = (await Bun.file(
      new URL("./fixtures/getter-outputs.json", import.meta.url),
    ).json()) as Record<string, unknown>;
    const transcript: TurnInput["transcript"] = [
      { role: "user", content: "Make the ambient light brown." },
      {
        role: "tool",
        content: JSON.stringify(outputs.get_ambient_light_status_and_color),
        toolName: "get_ambient_light_status_and_color",
      },
    ];
    const drafted = step(undefined, [{ toolName: "set_ambient_lights", arguments: { on: true } }]);
    const backbone = new MockBackbone([drafted, drafted, drafted, drafted]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(
      await turnInput({ transcript, toolDefinitions: await ambientLightsWithoutColor() }),
    );

    expect(decision.findings.some((f) => f.code === "unexpressible-attribute")).toBe(true);
    expect(decision.toolCalls).toEqual([]);
    expect(backbone.requests[1]?.critique ?? "").toContain("ambient_light");
  });

  test("the SAME utterance is silent under the full inventory (no keyword trigger)", async () => {
    const outputs = (await Bun.file(
      new URL("./fixtures/getter-outputs.json", import.meta.url),
    ).json()) as Record<string, unknown>;
    const transcript: TurnInput["transcript"] = [
      // Every keyword the old utterance-based trigger keyed on, and a fully valid call.
      {
        role: "user",
        content:
          "Make the ambient light orange, and calculate the distance along the charging route.",
      },
      {
        role: "tool",
        content: JSON.stringify(outputs.get_ambient_light_status_and_color),
        toolName: "get_ambient_light_status_and_color",
      },
    ];
    const backbone = new MockBackbone([
      step(undefined, [
        { toolName: "set_ambient_lights", arguments: { on: true, lightcolor: "ORANGE" } },
      ]),
    ]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(await turnInput({ transcript }));

    expect(backbone.calls).toBe(1);
    expect(decision.findings).toEqual([]);
    expect(decision.toolCalls.map((c) => c.toolName)).toEqual(["set_ambient_lights"]);
  });

  test("the check needs an OBSERVED getter result — a cold turn can never fire it", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "set_ambient_lights", arguments: { on: true } }]),
    ]);
    const decision = await new GatePipeline({
      backbone,
      config: minimalConfig(),
    }).decideNextStep(
      await turnInput({
        transcript: [{ role: "user", content: "Make the ambient light brown." }],
        toolDefinitions: await ambientLightsWithoutColor(),
      }),
    );
    expect(backbone.calls).toBe(1);
    expect(decision.findings).toEqual([]);
  });
});

// ── (v-a) HIGH REASONING REACHES THE WIRE ─────────────────────────────────────────────────────

describe("the thinking lever actually reaches the generateContent request", () => {
  test("minimal mode sends the HIGH thinking level; default sends budget 0", async () => {
    const request = {
      systemInstruction: "s",
      transcript: [{ role: "user", content: "hi" }] as TurnInput["transcript"],
      tools: [],
    };
    const minimal = buildRequest(request, minimalConfig()).config as Record<string, any>;
    // `MINIMAL_THINKING_BUDGET` (-1) is the CONFIG sentinel for "think as hard as needed"; the
    // PINNED model's API spells that `thinkingLevel: HIGH`. Per the Vertex thinking docs
    // (crawled 2026-08-26) Gemini 3 models — gemini-3.5-flash included — take `thinking_level`,
    // `thinking_budget` is the pre-Gemini-3 parameter, and sending BOTH returns an error. The
    // translation happens at the wire (`thinkingConfigFor`), asserted in minimal-thinking.test.ts.
    expect(MINIMAL_THINKING_BUDGET).toBeLessThan(0);
    expect(minimal.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
    expect(minimal.temperature).toBe(0); // greedy decoding in BOTH arms

    const base = buildRequest(request, testConfig()).config as Record<string, any>;
    expect(base.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(base.temperature).toBe(0);
  });
});

// ── (v) THE BEHAVIOR BLOCK — minimal mode only ────────────────────────────────────────────────

describe("the general behavior block", () => {
  test("it carries exactly the five general rules and nothing task-type-conditional", () => {
    const bullets = MINIMAL_BEHAVIOR_RULES.split("\n").filter((l) => l.trimStart().startsWith("-"));
    expect(bullets.length).toBe(5); // prompt-interference tax: five bullets, no more
    const text = MINIMAL_BEHAVIOR_RULES.toLowerCase();
    expect(text).toContain("parameter value");
    expect(text).toContain("24-hour");
    expect(text).toContain("metric");
    expect(text).toContain("exactly what was asked");
    expect(text).toContain("not available in this car");
    expect(text).toContain("alternatives");
    // Never conditional on the task family or on a "removed" tool (Thylinao's negative result).
    expect(text).not.toContain("hallucination");
    expect(text).not.toContain("disambiguation");
    expect(text).not.toContain("remov");
  });

  test("composeSystemInstruction appends it ONLY in minimal mode", async () => {
    const wiki = await loadWiki();
    expect(composeSystemInstruction(wiki)).not.toContain(MINIMAL_BEHAVIOR_RULES);
    const minimal = composeSystemInstruction(wiki, { minimal: true });
    expect(minimal).toContain(MINIMAL_BEHAVIOR_RULES);
    // Layering is unchanged: evaluator policy verbatim first, then CARlo's rules, then behavior.
    expect(minimal.indexOf(wiki.trim())).toBe(0);
    expect(minimal.indexOf(SYSTEM_PROMPT)).toBeLessThan(minimal.indexOf(MINIMAL_BEHAVIOR_RULES));
  });

  test("the pipeline sends it to the backbone in minimal mode and never otherwise", async () => {
    const minimalBackbone = new MockBackbone([step("ok")]);
    await new GatePipeline({ backbone: minimalBackbone, config: minimalConfig() }).decideNextStep(
      await turnInput(),
    );
    expect(minimalBackbone.requests[0]?.systemInstruction).toContain(MINIMAL_BEHAVIOR_RULES);

    const defaultBackbone = new MockBackbone([step("ok")]);
    await new GatePipeline({ backbone: defaultBackbone, config: testConfig() }).decideNextStep(
      await turnInput(),
    );
    expect(defaultBackbone.requests[0]?.systemInstruction).not.toContain(MINIMAL_BEHAVIOR_RULES);
  });
});

// ── (vi) BACKBONE RETRY ON TIMEOUT (root cause #6: 4 trials eaten as 0.0) ──────────────────────

class FlakyClient {
  seen: Record<string, unknown>[] = [];
  constructor(private readonly script: Array<unknown>) {}
  models = {
    generateContent: async (request: Record<string, unknown>) => {
      this.seen.push(request);
      const next = this.script.shift();
      if (next instanceof Error) throw next;
      return (next ?? { text: "ok" }) as never;
    },
  };
}

/** A `fetch` failure the way undici actually surfaces a dead socket: the code is on `cause`. */
function fetchFailure(code: string): Error {
  const error = new Error("fetch failed");
  (error as Error & { cause?: unknown }).cause = Object.assign(new Error(code), { code });
  return error;
}

describe("backbone transient-failure retry", () => {
  test("a timeout is retried up to 2x and then succeeds", async () => {
    const client = new FlakyClient([
      fetchFailure("ETIMEDOUT"),
      fetchFailure("ECONNRESET"),
      { text: "recovered" },
    ]);
    const backbone = new VertexBackbone({
      config: testConfig(),
      client: client as never,
      sleep: async () => {},
    });
    const result = await backbone.generate({
      systemInstruction: "s",
      transcript: [{ role: "user", content: "hi" }],
      tools: [],
    });
    expect(result.text).toBe("recovered");
    expect(client.seen.length).toBe(3); // 1 attempt + 2 retries
  });

  test("undici's bare socket errors count as transient", async () => {
    for (const message of ["socket hang up", "terminated", "The operation was aborted"]) {
      const client = new FlakyClient([new Error(message), { text: "recovered" }]);
      const backbone = new VertexBackbone({
        config: testConfig(),
        client: client as never,
        sleep: async () => {},
      });
      const result = await backbone.generate({
        systemInstruction: "s",
        transcript: [{ role: "user", content: "hi" }],
        tools: [],
      });
      expect(result.text).toBe("recovered");
      expect(client.seen.length).toBe(2);
    }
  });

  test("a non-retryable error still fails fast — no wasted attempts", async () => {
    const client = new FlakyClient([new Error("404 model not found")]);
    const backbone = new VertexBackbone({
      config: testConfig(),
      client: client as never,
      sleep: async () => {},
    });
    await expect(
      backbone.generate({ systemInstruction: "s", transcript: [], tools: [] }),
    ).rejects.toThrow(/404/);
    expect(client.seen.length).toBe(1);
  });

  test("backoff is applied between attempts, not busy-looped", async () => {
    const waits: number[] = [];
    const client = new FlakyClient([
      fetchFailure("ETIMEDOUT"),
      fetchFailure("ETIMEDOUT"),
      { text: "recovered" },
    ]);
    const backbone = new VertexBackbone({
      config: testConfig(),
      client: client as never,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await backbone.generate({ systemInstruction: "s", transcript: [], tools: [] });
    expect(waits.length).toBe(2);
    expect(waits[1]).toBeGreaterThan(waits[0] as number);
  });
});

// ── (vii) TRACING SURVIVES — downstream diagnosis must keep working ───────────────────────────

describe("minimal mode still emits the trace events diagnosis reads", () => {
  test("ingest / draft / emit are written, with validation retries as gate events", async () => {
    const sink = new MemoryTraceSink();
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percent: 50 } }]),
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
    ]);
    await new GatePipeline({ backbone, config: minimalConfig(), sink }).decideNextStep(
      await turnInput(),
    );

    const phases = sink.lines.map((l) => l.phase);
    expect(phases).toContain("ingest");
    expect(phases.filter((p) => p === "draft").length).toBe(2);
    expect(phases).toContain("emit");

    const gate = sink.lines.find((l) => l.phase === "gate");
    expect(gate).toBeDefined();
    expect(gate?.reason).toBe("schema-validate");
    expect(gate?.gate).toBe("args");

    const emit = sink.lines.find((l) => l.phase === "emit");
    expect(emit?.route).toBe("minimal");
    expect(emit?.gateOrder).toEqual(["draft", "args"]);
  });

  test("the turn cap still closes cleanly rather than throwing or going silent", async () => {
    const backbone = new MockBackbone([step("never reached")]);
    const decision = await new GatePipeline({
      backbone,
      config: testConfig({ minimal: true, maxTurns: 3 }),
    }).decideNextStep(await turnInput({ turn: 3 }));

    expect(backbone.calls).toBe(0);
    expect(decision.closed).toBe(true);
    expect(decision.text).toBeString();
  });

  test("the inventory the model sees is still the LIVE one, never a remembered surface", async () => {
    const backbone = new MockBackbone([step("ok")]);
    await new GatePipeline({ backbone, config: minimalConfig() }).decideNextStep(
      await turnInput({}, "tools-info-removed-tool.json"),
    );
    const names = backbone.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(names).not.toContain("open_close_sunshade");
    expect(names.length).toBe(57);
  });

  test("buildInventory is still the single source of the tool surface", async () => {
    const inventory = buildInventory(await loadTools("tools-info-removed-tool.json"));
    expect("open_close_sunshade" in inventory.tools).toBe(false);
  });
});
