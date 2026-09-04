import { describe, expect, test } from "bun:test";
import { buildInventory } from "../src/inventory.ts";
import { CANNED_FALLBACK, GatePipeline, repairCall } from "../src/pipeline.ts";
import { MemoryTraceSink } from "../src/trace.ts";
import type { TurnInput } from "../src/types.ts";
import { loadTools, loadWiki, MockBackbone, step, testConfig } from "./helpers/mock-backbone.ts";

async function turnInput(
  over: Partial<TurnInput> = {},
  file = "tools-info.json",
): Promise<TurnInput> {
  return {
    taskId: "task-1",
    turn: 0,
    systemPrompt: await loadWiki(),
    transcript: [{ role: "user", content: "Open the sunroof halfway." }],
    toolDefinitions: await loadTools(file),
    ...over,
  };
}

describe("gate-pipeline", () => {
  test("gates run in the spec's order around a single draft call", async () => {
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

  test("a no-risk turn costs exactly ONE backbone call; a risky turn costs exactly TWO", async () => {
    const readOnly = new MockBackbone([
      step(undefined, [{ toolName: "get_weather", arguments: {} }]),
    ]);
    const pipelineA = new GatePipeline({ backbone: readOnly, config: testConfig() });
    const a = await pipelineA.decideNextStep(await turnInput());
    expect(readOnly.calls).toBe(1);
    expect(a.passes).toBe(1);

    // Sunroof with its prerequisites already satisfied -> the state change survives to escalation.
    const transcript: TurnInput["transcript"] = [
      { role: "user", content: "Open the sunroof halfway." },
      { role: "tool", content: '{"weather":"sunny"}', toolName: "get_weather" },
      { role: "tool", content: '{"sunshade":100}', toolName: "get_sunroof_and_sunshade_position" },
      { role: "tool", content: '{"status":"SUCCESS"}', toolName: "open_close_sunshade" },
    ];
    const risky = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
    ]);
    const pipelineB = new GatePipeline({ backbone: risky, config: testConfig() });
    const b = await pipelineB.decideNextStep(await turnInput({ transcript }));
    expect(risky.calls).toBe(2);
    expect(b.passes).toBe(2);
  });

  test("policy pre-check schedules the weather lookup BEFORE the sunroof state change", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
      step(undefined, [{ toolName: "get_weather", arguments: {} }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(await turnInput());

    expect(decision.toolCalls.map((c) => c.toolName)).not.toContain("open_close_sunroof");
    expect(
      decision.findings.some((f) => f.gate === "policy" && f.code === "prerequisite-unsatisfied"),
    ).toBe(true);
  });

  // ── Binding condition C1 ────────────────────────────────────────────────────────────────────
  test("C1: an UNKNOWN TOOL routes to the honest-limit path and is never repaired into another tool", async () => {
    const backbone = new MockBackbone([
      step("Opening the sunshade.", [
        { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
      ]),
      step("Opening the sunshade.", [
        { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
      ]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput(
        { transcript: [{ role: "user", content: "Open the sunshade." }] },
        "tools-info-removed-tool.json",
      ),
    );

    // No fabricated action, no substituted tool, an honest limit statement instead.
    expect(decision.toolCalls).toEqual([]);
    expect(decision.text).toBeString();
    expect(decision.text?.toLowerCase()).toContain("can't");
    expect(decision.findings.some((f) => f.gate === "feasibility" && f.verdict === "block")).toBe(
      true,
    );
    expect(decision.closed).toBe(true);
  });

  test("C1: an ABSENT PARAMETER routes to the honest-limit path, not to a repair", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_window", arguments: { percentage: 50 } }]),
      step(undefined, [{ toolName: "open_close_window", arguments: { percentage: 50 } }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput(
        { transcript: [{ role: "user", content: "Open the window halfway." }] },
        "tools-info-removed-param.json",
      ),
    );

    expect(decision.toolCalls).toEqual([]);
    expect(decision.findings.some((f) => f.code === "unknown-parameter")).toBe(true);
    expect(decision.findings.some((f) => f.gate === "feasibility" && f.verdict === "block")).toBe(
      true,
    );
  });

  test("ambiguity: a premature question is challenged and the internal lookup wins", async () => {
    const backbone = new MockBackbone([
      step("Which temperature would you like?"),
      step(undefined, [
        {
          toolName: "get_user_preferences",
          arguments: { preference_categories: { points_of_interest: { bakery: true } } },
        },
      ]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        transcript: [{ role: "user", content: "Set the climate the way I like it." }],
      }),
    );

    expect(decision.toolCalls.map((c) => c.toolName)).toEqual(["get_user_preferences"]);
    expect(decision.text).toBeUndefined();
    expect(decision.findings.some((f) => f.code === "internal-resolution-available")).toBe(true);

    // The challenge names the still-unqueried sources and does not invent arguments itself.
    expect(backbone.requests[1]?.critique).toContain("get_user_preferences");
    // Ambiguity is a risk trigger, so this IS the one extra pass — never a second one.
    expect(backbone.calls).toBe(2);
    expect(decision.passes).toBe(2);
  });

  test("ambiguity: if the re-draft still asks, the question stands (we tried internal resolution)", async () => {
    const backbone = new MockBackbone([
      step("Which temperature would you like?"),
      step("Which temperature would you like?"),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        transcript: [{ role: "user", content: "Set the climate the way I like it." }],
      }),
    );

    expect(decision.text).toBe("Which temperature would you like?");
    expect(decision.toolCalls).toEqual([]);
    expect(backbone.calls).toBe(2);
  });

  test("ambiguity: with every internal source exhausted, exactly ONE question is allowed through", async () => {
    const exhausted: TurnInput["transcript"] = [
      { role: "user", content: "Set the climate the way I like it." },
      { role: "tool", content: "{}", toolName: "get_user_preferences" },
      { role: "tool", content: "{}", toolName: "get_entries_from_calendar" },
      { role: "tool", content: "{}", toolName: "get_contact_information" },
      { role: "tool", content: "{}", toolName: "get_contact_id_by_contact_name" },
    ];
    const backbone = new MockBackbone([
      step("Which temperature would you like?"),
      step("Which temperature would you like?"),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(await turnInput({ transcript: exhausted }));

    expect(decision.text).toBe("Which temperature would you like?");
    expect(decision.toolCalls).toEqual([]);
  });

  test("arg self-check repairs CARlo's own draft once, then emits it valid", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "get_weather", arguments: { location_or_poi_id: 42 } }]),
    ]);
    const sink = new MemoryTraceSink();
    const pipeline = new GatePipeline({ backbone, config: testConfig(), sink });
    await pipeline.decideNextStep(await turnInput());

    // Ruling 2: every repair is trace-logged before AND after.
    const repairs = sink.lines.filter((l) => l.phase === "repair");
    for (const line of repairs) {
      expect(line.before).toBeDefined();
      expect(line.after).toBeDefined();
    }
  });

  test("an unrepairable draft is DROPPED, never emitted broken", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: {} }]),
      step(undefined, [{ toolName: "open_close_sunroof", arguments: {} }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const transcript: TurnInput["transcript"] = [
      { role: "user", content: "Open the sunroof." },
      { role: "tool", content: '{"weather":"sunny"}', toolName: "get_weather" },
      { role: "tool", content: '{"sunshade":100}', toolName: "get_sunroof_and_sunshade_position" },
      { role: "tool", content: "{}", toolName: "open_close_sunshade" },
    ];
    const decision = await pipeline.decideNextStep(await turnInput({ transcript }));

    expect(decision.toolCalls).toEqual([]);
    expect(decision.findings.some((f) => f.code === "unrepairable-draft")).toBe(true);
  });

  test("the turn cap closes cleanly instead of throwing or going silent", async () => {
    const backbone = new MockBackbone([]);
    const config = testConfig({ maxTurns: 50 });
    const pipeline = new GatePipeline({ backbone, config });
    const decision = await pipeline.decideNextStep(await turnInput({ turn: 50 }));

    expect(decision.closed).toBe(true);
    expect(decision.text).toBeString();
    expect(decision.text?.length ?? 0).toBeGreaterThan(0);
    expect(decision.toolCalls).toEqual([]);
    expect(backbone.calls).toBe(0);
    expect(decision.findings.some((f) => f.code === "turn-cap")).toBe(true);
  });

  test("the bounded loop uses the spec's maxIterations = 50", () => {
    expect(testConfig().maxTurns).toBe(50);
  });

  test("the backbone only ever sees tools declared in THIS session", async () => {
    const backbone = new MockBackbone([step("ok")]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    await pipeline.decideNextStep(await turnInput({}, "tools-info-removed-tool.json"));

    const names = backbone.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(names).not.toContain("open_close_sunshade");
    expect(names.length).toBe(57);
  });

  test("ingest happens once per task and is traced", async () => {
    const backbone = new MockBackbone([step("a"), step("b")]);
    const sink = new MemoryTraceSink();
    const pipeline = new GatePipeline({ backbone, config: testConfig(), sink });

    await pipeline.decideNextStep(await turnInput({ turn: 0 }));
    await pipeline.decideNextStep(await turnInput({ turn: 1 }));

    expect(sink.lines.filter((l) => l.phase === "ingest").length).toBe(1);
  });

  test("a failing trace sink never breaks the decision path", async () => {
    const backbone = new MockBackbone([step("fine")]);
    const exploding = {
      write() {
        throw new Error("disk on fire");
      },
    };
    const pipeline = new GatePipeline({ backbone, config: testConfig(), sink: exploding });
    const decision = await pipeline.decideNextStep(await turnInput());
    expect(decision.text).toBe("fine");
  });
});

describe("repairCall", () => {
  test("normalizes enum case and numeric strings without touching the tool name", () => {
    const inventory = buildInventory([
      {
        type: "function",
        function: {
          name: "set_mode",
          parameters: {
            type: "object",
            required: ["mode", "level"],
            properties: {
              mode: { type: "string", enum: ["fresh_air"] },
              level: { type: "integer" },
            },
          },
        },
      },
    ]);
    const repaired = repairCall(
      { toolName: "set_mode", arguments: { mode: "Fresh_Air", level: "3" } },
      inventory,
    );
    expect(repaired?.toolName).toBe("set_mode");
    expect(repaired?.arguments).toEqual({ mode: "fresh_air", level: 3 });
  });

  test("refuses to repair an unknown parameter (that is absence, not a value defect)", () => {
    const inventory = buildInventory([
      { type: "function", function: { name: "t", parameters: { type: "object", properties: {} } } },
    ]);
    expect(repairCall({ toolName: "t", arguments: { ghost: 1 } }, inventory)).toBeNull();
  });

  test("refuses to repair a call to an unknown tool", () => {
    expect(repairCall({ toolName: "nope", arguments: {} }, buildInventory([]))).toBeNull();
  });
});

// ── /R2d + R2e: confirmation gate and fail-loud policy compilation ──────────────────────────
async function loadDeliveredWiki(): Promise<string> {
  return await Bun.file(new URL("./fixtures/wiki-delivered.md", import.meta.url)).text();
}

describe("confirmation gate (F2/R2d)", () => {
  test("a REQUIRES_CONFIRMATION action is BLOCKED until the driver affirms", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_trunk_door", arguments: { action: "OPEN" } }]),
      step(undefined, [{ toolName: "open_close_trunk_door", arguments: { action: "OPEN" } }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Open the trunk." }],
      }),
    );

    expect(decision.toolCalls).toEqual([]);
    // The block emits the listing + the confirmation question the policy demands.
    expect(decision.text).toBeString();
    expect(decision.text?.trim().endsWith("?")).toBe(true);
    expect(decision.text).toContain("open_close_trunk_door");
    expect(decision.text).toContain("OPEN");
    expect(
      decision.findings.some((f) => f.gate === "policy" && f.code === "confirmation-required"),
    ).toBe(true);
  });

  test("after the action was listed and the driver said yes, the call goes through", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_trunk_door", arguments: { action: "OPEN" } }]),
      step(undefined, [{ toolName: "open_close_trunk_door", arguments: { action: "OPEN" } }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Open the trunk." },
          {
            role: "assistant",
            content: "Just to confirm — open_close_trunk_door with action OPEN. Shall I?",
          },
          { role: "user", content: "Yes, go ahead." },
        ],
      }),
    );

    expect(decision.toolCalls.map((c) => c.toolName)).toEqual(["open_close_trunk_door"]);
    expect(decision.findings.some((f) => f.code === "confirmation-required")).toBe(false);
  });

  test("an affirmation that PRECEDES the listing does not count", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_trunk_door", arguments: { action: "OPEN" } }]),
      step(undefined, [{ toolName: "open_close_trunk_door", arguments: { action: "OPEN" } }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Yes please." },
          { role: "assistant", content: "Opening open_close_trunk_door now." },
        ],
      }),
    );

    expect(decision.toolCalls).toEqual([]);
    expect(decision.findings.some((f) => f.code === "confirmation-required")).toBe(true);
  });

  test("a tool WITHOUT the confirmation prefix is untouched by the gate", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "get_weather", arguments: {} }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({ systemPrompt: await loadDeliveredWiki() }),
    );

    expect(decision.findings.some((f) => f.code === "confirmation-required")).toBe(false);
  });
});

describe("policy compilation is FAIL-LOUD (F2/R2e)", () => {
  test("a non-empty policy text that compiles to 0 rules emits policyCompileFailed", async () => {
    const backbone = new MockBackbone([step("ok")]);
    const sink = new MemoryTraceSink();
    const pipeline = new GatePipeline({ backbone, config: testConfig(), sink });

    await pipeline.decideNextStep(
      await turnInput({ systemPrompt: "A policy with prose but no anchored obligations." }),
    );

    const loud = sink.lines.find((l) => l.phase === "policyCompileFailed") as any;
    expect(loud).toBeDefined();
    expect(loud.policyChars).toBeGreaterThan(0);
    expect(loud.rules).toBe(0);
  });

  test("an EMPTY policy is not a compile failure (nothing was delivered to parse)", async () => {
    const backbone = new MockBackbone([step("ok")]);
    const sink = new MemoryTraceSink();
    const pipeline = new GatePipeline({ backbone, config: testConfig(), sink });

    await pipeline.decideNextStep(await turnInput({ systemPrompt: "" }));
    expect(sink.lines.some((l) => l.phase === "policyCompileFailed")).toBe(false);
  });

  test("the delivered wiki compiles quietly — no fail-loud event", async () => {
    const backbone = new MockBackbone([step("ok")]);
    const sink = new MemoryTraceSink();
    const pipeline = new GatePipeline({ backbone, config: testConfig(), sink });

    await pipeline.decideNextStep(await turnInput({ systemPrompt: await loadDeliveredWiki() }));
    expect(sink.lines.some((l) => l.phase === "policyCompileFailed")).toBe(false);
    const ingest = sink.lines.find((l) => l.phase === "ingest") as any;
    expect(ingest.policyRules).toBe(19);
  });
});

// ── /R4a + R4b: feasibility reaches the CALL, the SCHEMA and the TEXT ───────────────────────
describe("feasibility extensions (F4)", () => {
  test("R4b proactive: a request for an absent capability is acknowledged BEFORE drafting", async () => {
    const backbone = new MockBackbone([step("Sure, opening the sunshade!")]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput(
        {
          systemPrompt: await loadDeliveredWiki(),
          transcript: [{ role: "user", content: "Open the sunshade for me." }],
        },
        "tools-info-removed-tool.json",
      ),
    );

    // No backbone call is even needed: the absence is a set-difference at ingest.
    expect(backbone.calls).toBe(0);
    expect(decision.toolCalls).toEqual([]);
    expect(decision.text?.toLowerCase()).toContain("can't");
    expect(decision.text?.toLowerCase()).toContain("sunshade");
    expect(decision.findings.some((f) => f.gate === "feasibility" && f.verdict === "block")).toBe(
      true,
    );
    expect(decision.closed).toBe(true);
  });

  test("R4b defensive: a drafted CLAIM to have used an absent tool never reaches the driver", async () => {
    const backbone = new MockBackbone([
      step("I have opened the sunshade."),
      step("I have opened the sunshade."),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput(
        {
          systemPrompt: await loadDeliveredWiki(),
          // A question, so the proactive gate stays out of the way and the DRAFT is what is tested.
          transcript: [{ role: "user", content: "Is everything closed up top?" }],
        },
        "tools-info-removed-tool.json",
      ),
    );

    expect(decision.text).not.toContain("I have opened");
    expect(decision.toolCalls).toEqual([]);
    expect(decision.findings.some((f) => f.code === "absent-capability")).toBe(true);
  });

  test("R4b defensive: claiming a state change with NO emitted call is rejected", async () => {
    const backbone = new MockBackbone([
      step("I have opened the sunroof for you."),
      step("I have opened the sunroof for you."),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Is the sunroof open?" }],
      }),
    );

    expect(decision.text).not.toContain("I have opened");
    expect(decision.findings.some((f) => f.code === "unexecuted-claim")).toBe(true);
  });

  test("R4a: a schema-VALID call whose carrier parameter was deleted is suppressed", async () => {
    const defs = (await loadTools()).map((d) => JSON.parse(JSON.stringify(d)));
    for (const def of defs) {
      if (def.function?.name !== "set_ambient_lights") continue;
      delete def.function.parameters.properties.lightcolor;
      def.function.parameters.required = def.function.parameters.required.filter(
        (r: string) => r !== "lightcolor",
      );
    }
    const outputs = (await Bun.file(
      new URL("./fixtures/getter-outputs.json", import.meta.url),
    ).json()) as Record<string, unknown>;

    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "set_ambient_lights", arguments: { on: true } }]),
      step(undefined, [{ toolName: "set_ambient_lights", arguments: { on: true } }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep({
      taskId: "task-parity",
      turn: 0,
      systemPrompt: await loadDeliveredWiki(),
      transcript: [
        { role: "user", content: "Make the ambient light brown." },
        {
          role: "tool",
          content: JSON.stringify(outputs.get_ambient_light_status_and_color),
          toolName: "get_ambient_light_status_and_color",
        },
      ],
      toolDefinitions: defs,
    });

    // The call is schema-valid, so ONLY the parity check can stop it — and it must.
    expect(decision.toolCalls).toEqual([]);
    expect(decision.findings.some((f) => f.code === "unexpressible-attribute")).toBe(true);
    expect(decision.text?.toLowerCase()).toContain("can't");
    expect(decision.closed).toBe(true);
  });

  test("REGRESSION: a full-inventory turn is untouched by both extensions", async () => {
    const backbone = new MockBackbone([
      step("Let me check where the sunshade is.", [
        { toolName: "get_sunroof_and_sunshade_position", arguments: {} },
      ]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({ systemPrompt: await loadDeliveredWiki() }),
    );

    expect(decision.toolCalls.map((c) => c.toolName)).toEqual([
      "get_sunroof_and_sunshade_position",
    ]);
    expect(decision.findings.some((f) => f.gate === "feasibility")).toBe(false);
  });
});

describe("no-call/no-text fallback (cluster-3 secondary)", () => {
  test("a pending clarifying question is preferred over the canned apology", async () => {
    const backbone = new MockBackbone([step(undefined, []), step(undefined, [])]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Set the temperature." },
          { role: "assistant", content: "Which seat zone should I set?" },
        ],
      }),
    );

    expect(decision.text).toBe("Which seat zone should I set?");
  });

  test("with no pending question the canned close still applies", async () => {
    const backbone = new MockBackbone([step(undefined, []), step(undefined, [])]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Do the thing." }],
      }),
    );

    expect(decision.text).toBe("Sorry, I can't complete that right now.");
  });
});

// ── /R3b-d: groundedness gate (flagged), critique args, verify disagreement ─────────────────
describe("groundedness gate (F3/R3b, CARLO_GROUNDEDNESS)", () => {
  const climateTranscript: TurnInput["transcript"] = [{ role: "user", content: "Open my window" }];

  test("ON: an ungrounded value suppresses the call and asks ONE question naming the parameter", async () => {
    const backbone = new MockBackbone([
      step(undefined, [
        { toolName: "open_close_window", arguments: { window: "DRIVER", percentage: 100 } },
      ]),
      step(undefined, [
        { toolName: "open_close_window", arguments: { window: "DRIVER", percentage: 100 } },
      ]),
    ]);
    const pipeline = new GatePipeline({
      backbone,
      config: testConfig({ groundedness: true }),
    });
    const decision = await pipeline.decideNextStep(
      await turnInput({ systemPrompt: await loadDeliveredWiki(), transcript: climateTranscript }),
    );

    expect(decision.toolCalls).toEqual([]);
    expect(decision.text?.endsWith("?")).toBe(true);
    expect(decision.findings.filter((f) => f.code === "ungrounded-argument").length).toBe(1);
    expect(decision.closed).toBe(false);
  });

  test("OFF (default): the same draft is emitted untouched", async () => {
    const backbone = new MockBackbone([
      step(undefined, [
        { toolName: "open_close_window", arguments: { window: "DRIVER", percentage: 100 } },
      ]),
      step(undefined, [
        { toolName: "open_close_window", arguments: { window: "DRIVER", percentage: 100 } },
      ]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({ systemPrompt: await loadDeliveredWiki(), transcript: climateTranscript }),
    );

    expect(decision.toolCalls.map((c) => c.toolName)).toEqual(["open_close_window"]);
    expect(decision.findings.some((f) => f.code === "ungrounded-argument")).toBe(false);
  });

  test("ON: a GROUNDED draft is emitted on the first attempt (base_4 / base_8 shapes)", async () => {
    for (const [utterance, call] of [
      [
        "Let some fresh air in",
        { toolName: "set_air_circulation", arguments: { mode: "FRESH_AIR" } },
      ],
      [
        "Point the airflow at the windshield",
        { toolName: "set_fan_airflow_direction", arguments: { direction: "WINDSHIELD" } },
      ],
    ] as const) {
      const backbone = new MockBackbone([step(undefined, [call]), step(undefined, [call])]);
      const pipeline = new GatePipeline({ backbone, config: testConfig({ groundedness: true }) });
      const decision = await pipeline.decideNextStep(
        await turnInput({
          systemPrompt: await loadDeliveredWiki(),
          transcript: [{ role: "user", content: utterance }],
        }),
      );

      expect(decision.toolCalls.map((c) => c.toolName)).toEqual([call.toolName]);
      expect(decision.findings.some((f) => f.code === "ungrounded-argument")).toBe(false);
    }
  });
});

describe("verify critique carries ARGUMENTS (F3/R3c)", () => {
  test("the critique serializes tool(args) and asks the inference question", async () => {
    const call = { toolName: "set_air_circulation", arguments: { mode: "FRESH_AIR" } };
    const backbone = new MockBackbone([step(undefined, [call]), step(undefined, [call])]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Let some fresh air in" }],
      }),
    );

    const critique = backbone.requests[1]?.critique ?? "";
    expect(critique).toContain('set_air_circulation({"mode":"FRESH_AIR"})');
    expect(critique).toContain("your own inference");
  });

  test("ungrounded arguments are an ambiguity RISK even with the gate off", async () => {
    const call = {
      toolName: "open_close_window",
      arguments: { window: "DRIVER", percentage: 100 },
    };
    const backbone = new MockBackbone([step(undefined, [call]), step(undefined, [call])]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Open my window" }],
      }),
    );

    expect(backbone.requests[1]?.critique).toContain("ambiguity");
  });
});

describe("verify disagreement (F3/R3d)", () => {
  test("ON: the same tool with DIFFERENT args suppresses BOTH and asks", async () => {
    const backbone = new MockBackbone([
      step(undefined, [
        { toolName: "set_ambient_lights", arguments: { on: true, lightcolor: "BLUE" } },
      ]),
      step(undefined, [
        { toolName: "set_ambient_lights", arguments: { on: false, lightcolor: "NONE" } },
      ]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig({ groundedness: true }) });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Make the ambient light blue" }],
      }),
    );

    expect(decision.toolCalls).toEqual([]);
    expect(decision.text?.endsWith("?")).toBe(true);
    expect(decision.findings.some((f) => f.code === "verify-disagreement")).toBe(true);
  });

  test("OFF: arbitration falls back to conservativeChoice", async () => {
    const backbone = new MockBackbone([
      step(undefined, [
        { toolName: "set_ambient_lights", arguments: { on: true, lightcolor: "BLUE" } },
      ]),
      step(undefined, [
        { toolName: "set_ambient_lights", arguments: { on: false, lightcolor: "NONE" } },
      ]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Make the ambient light blue" }],
      }),
    );

    expect(decision.findings.some((f) => f.code === "verify-disagreement")).toBe(false);
    expect(decision.toolCalls.length).toBe(1);
  });
});

// ── R4b over-fire fixes, end to end (smoke re-run 2026-08-25) ─────────────────────────────────
describe("prose gate does not block an in-scope close (F4/R4b)", () => {
  test("t11 shape: the summary of work done on EARLIER turns is emitted, not refused", async () => {
    const backbone = new MockBackbone([
      step("I have opened the sunshade all the way to 100% and set the sunroof to 50% for you."),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Open the sunroof halfway." },
          { role: "tool", content: '{"weather":"rainy"}', toolName: "get_weather" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ toolName: "open_close_sunshade", arguments: { percentage: 100 } }],
          },
          { role: "tool", content: '{"status":"SUCCESS"}', toolName: "open_close_sunshade" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }],
          },
          { role: "tool", content: '{"status":"SUCCESS"}', toolName: "open_close_sunroof" },
        ],
      }),
    );

    expect(decision.text).toContain("I have opened the sunshade");
    expect(decision.findings.some((f) => f.code === "unexecuted-claim")).toBe(false);
  });

  test("t5 shape: a rain warning plus a confirmation question survives the gate", async () => {
    const backbone = new MockBackbone([
      step(
        "I checked the weather for you, and it is currently rainy. Since it is raining, are you " +
          "sure you want me to open the sunroof?",
      ),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Open the sunroof halfway." },
          { role: "tool", content: '{"weather":"rainy"}', toolName: "get_weather" },
        ],
      }),
    );

    expect(decision.text).toContain("are you sure");
    expect(decision.findings.some((f) => f.gate === "feasibility")).toBe(false);
  });

  test("REGRESSION GUARD: a fabricated claim with nothing ever executed is still blocked", async () => {
    const backbone = new MockBackbone([
      step("I have opened the sunroof for you."),
      step("I have opened the sunroof for you."),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Is the sunroof open?" }],
      }),
    );

    expect(decision.text).not.toContain("I have opened");
    expect(decision.findings.some((f) => f.code === "unexecuted-claim")).toBe(true);
  });
});

// ── : the policy pre-check must not CLOBBER the draft ───────────────────────────────────────
/**
 * The redirect used to replace the whole step with `{toolName, arguments: {}}`, destroying the
 * drafted arguments and text; the empty call was then dropped as unrepairable and the turn
 * collapsed into the canned apology (23/23 redirects unproductive in the v2 smoke window).
 */
const BASE_0_TRANSCRIPT: TurnInput["transcript"] = [
  { role: "user", content: "Open the sunroof halfway, please." },
  {
    role: "tool",
    content: '{"sunroof_position":0,"sunshade_position":0}',
    toolName: "get_sunroof_and_sunshade_position",
  },
  { role: "tool", content: '{"condition":"cloudy_and_rain"}', toolName: "get_weather" },
  {
    role: "assistant",
    content: "It's raining right now — are you sure you want the sunroof open?",
  },
  { role: "user", content: "Yes, I still want to open it. Go ahead." },
];

describe("policy pre-check preserves the draft (R1)", () => {
  test("T1 base_0 replay: both drafted calls survive, with their arguments and order", async () => {
    const draft = [
      { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
      { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
    ];
    const backbone = new MockBackbone([step(undefined, draft), step(undefined, draft)]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: BASE_0_TRANSCRIPT,
      }),
    );

    expect(decision.toolCalls).toEqual(draft);
    expect(decision.text).not.toBe("Sorry, I can't complete that right now.");
    expect(decision.findings.some((f) => f.code === "unrepairable-draft")).toBe(false);
  });

  test("a prerequisite already in the draft but BEHIND the action is REORDERED, not rebuilt", async () => {
    const draft = [
      { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
      { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
    ];
    const backbone = new MockBackbone([step("On it.", draft), step("On it.", draft)]);
 // verifyMode "never" isolates the policy gate; the verify pass's own arbitration is 's job.
    const pipeline = new GatePipeline({ backbone, config: testConfig({ verifyMode: "never" }) });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: BASE_0_TRANSCRIPT,
      }),
    );

    // Reordered — and the arguments and the drafted text are intact.
    expect(decision.toolCalls).toEqual([
      { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
      { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
    ]);
    expect(decision.text).toBe("On it.");
    expect(
      decision.findings.some((f) => f.gate === "policy" && f.code === "prerequisite-unsatisfied"),
    ).toBe(true);
  });

  test("a PARAMETERLESS missing prerequisite is still scheduled first", async () => {
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
      step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Open the sunroof halfway." },
          { role: "tool", content: '{"condition":"sunny"}', toolName: "get_weather" },
        ],
      }),
    );

    // get_sunroof_and_sunshade_position takes no parameters, so a `{}` call IS complete.
    expect(decision.toolCalls.map((c) => c.toolName)).toEqual([
      "get_sunroof_and_sunshade_position",
    ]);
  });
});

// ── : a missing prerequisite that NEEDS arguments is re-drafted, never synthesized ──────────
describe("missing-prerequisite re-draft (R2)", () => {
  test("T2 disambiguation_8 replay: the backbone supplies the fully-parameterized get_weather", async () => {
    const weatherCall = {
      toolName: "get_weather",
      arguments: {
        location_or_poi_id: "Luxembourg",
        month: 8,
        day: 25,
        time_hour_24hformat: 18,
      },
    };
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "set_fog_lights", arguments: { on: true } }]),
      step(undefined, [weatherCall]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          {
            role: "user",
            content: "Could you turn on the lights, please? Visibility is a bit low",
          },
          {
            role: "tool",
            content: '{"fog_lights":false,"head_lights_low_beams":false}',
            toolName: "get_exterior_lights_status",
          },
        ],
      }),
    );

    expect(decision.toolCalls).toEqual([weatherCall]);
    expect(decision.findings.some((f) => f.code === "missing-required")).toBe(false);
    expect(decision.findings.some((f) => f.code === "unrepairable-draft")).toBe(false);
    // The re-draft IS the one extra pass — never a second one.
    expect(backbone.calls).toBe(2);
    expect(decision.passes).toBe(2);
  });

  test("if the re-draft does not produce the prerequisite, the original draft stands", async () => {
    const draft = [{ toolName: "set_fog_lights", arguments: { on: true } }];
    const backbone = new MockBackbone([
      step(undefined, draft),
      step("I could not look that up.", []),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Could you turn on the lights, please?" },
          {
            role: "tool",
            content: '{"fog_lights":false}',
            toolName: "get_exterior_lights_status",
          },
        ],
      }),
    );

    expect(decision.toolCalls).toEqual(draft);
  });

  test("T3 INVARIANT: no emitted call is ever missing a REQUIRED parameter", async () => {
    const inventory = buildInventory(await loadTools());
    const scenarios: Array<{
      queue: ReturnType<typeof step>[];
      transcript: TurnInput["transcript"];
    }> = [
      {
        // The shape that used to synthesize get_weather({}).
        queue: [
          step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
          step(undefined, [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }]),
        ],
        transcript: [{ role: "user", content: "Open the sunroof halfway." }],
      },
      {
        queue: [
          step(undefined, [{ toolName: "set_fog_lights", arguments: { on: true } }]),
          step(undefined, [{ toolName: "set_fog_lights", arguments: { on: true } }]),
        ],
        transcript: [{ role: "user", content: "Turn on the lights, visibility is low." }],
      },
      {
        queue: [
          step(undefined, [
            { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
            { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
          ]),
          step(undefined, [
            { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
            { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
          ]),
        ],
        transcript: BASE_0_TRANSCRIPT,
      },
    ];

    for (const scenario of scenarios) {
      const pipeline = new GatePipeline({
        backbone: new MockBackbone(scenario.queue),
        config: testConfig(),
      });
      const decision = await pipeline.decideNextStep(
        await turnInput({
          systemPrompt: await loadDeliveredWiki(),
          transcript: scenario.transcript,
        }),
      );

      for (const call of decision.toolCalls) {
        const tool = inventory.tools[call.toolName];
        expect(tool).toBeDefined();
        for (const required of tool?.required ?? []) {
          expect(Object.hasOwn(call.arguments, required)).toBe(true);
        }
      }
    }
  });
});

// ── end to end ─────────────────────────────────────────────────────────────────────────────
describe("escalation does not resurrect a gate-emptied draft (R4)", () => {
  test("T5: a draft emptied by the arg gate loses to the correct verify calls", async () => {
    const good = [
      { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
      { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
    ];
    const backbone = new MockBackbone([
      // Drafted with a missing required parameter -> the arg gate drops it, emptying the step.
      step(undefined, [{ toolName: "open_close_sunroof", arguments: {} }]),
      step(undefined, good),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({ systemPrompt: await loadDeliveredWiki(), transcript: BASE_0_TRANSCRIPT }),
    );

    expect(decision.toolCalls).toEqual(good);
    expect(decision.text).not.toBe("Sorry, I can't complete that right now.");
  });

  test("a policy REORDER survives the verify pass instead of being undone", async () => {
    const unordered = [
      { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
      { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
    ];
    const backbone = new MockBackbone([step("On it.", unordered), step("On it.", unordered)]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({ systemPrompt: await loadDeliveredWiki(), transcript: BASE_0_TRANSCRIPT }),
    );

    expect(decision.toolCalls.map((c) => c.toolName)).toEqual([
      "open_close_sunshade",
      "open_close_sunroof",
    ]);
  });
});

// ── : the canned apology is reserved for turns NO gate touched ──────────────────────────────
describe("no refusal-shaped fallback after a gate re-plan (R3)", () => {
  test("T4: whenever a replan/block finding exists, the text is not the canned apology", async () => {
    const scenarios: Array<{
      queue: ReturnType<typeof step>[];
      transcript: TurnInput["transcript"];
    }> = [
      {
        // Unrepairable draft: the arg gate drops the call and the verify pass adds nothing.
        queue: [
          step(undefined, [{ toolName: "open_close_sunroof", arguments: {} }]),
          step(undefined, [{ toolName: "open_close_sunroof", arguments: {} }]),
        ],
        transcript: BASE_0_TRANSCRIPT,
      },
      {
        queue: [
          step(undefined, [{ toolName: "set_fog_lights", arguments: {} }]),
          step(undefined, [{ toolName: "set_fog_lights", arguments: {} }]),
        ],
        transcript: [
          { role: "user", content: "Turn on the lights, visibility is low." },
          {
            role: "tool",
            content: '{"fog_lights":false}',
            toolName: "get_exterior_lights_status",
          },
        ],
      },
    ];

    for (const scenario of scenarios) {
      const pipeline = new GatePipeline({
        backbone: new MockBackbone(scenario.queue),
        config: testConfig(),
      });
      const decision = await pipeline.decideNextStep(
        await turnInput({
          systemPrompt: await loadDeliveredWiki(),
          transcript: scenario.transcript,
        }),
      );

      const replanned = decision.findings.some(
        (f) => f.verdict === "replan" || f.verdict === "block",
      );
      expect(replanned).toBe(true);
      expect(decision.text).not.toBe(CANNED_FALLBACK);
      expect(decision.text?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("a pending clarifying question still wins over both fallbacks", async () => {
    const backbone = new MockBackbone([step(undefined, []), step(undefined, [])]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Set the temperature." },
          { role: "assistant", content: "Which seat zone should I set?" },
        ],
      }),
    );

    expect(decision.text).toBe("Which seat zone should I set?");
  });

  test("with NO gate interference the canned close is still what is emitted", async () => {
    const backbone = new MockBackbone([step(undefined, []), step(undefined, [])]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Do the thing." }],
      }),
    );

    expect(decision.findings.some((f) => f.verdict === "replan" || f.verdict === "block")).toBe(
      false,
    );
    expect(decision.text).toBe(CANNED_FALLBACK);
  });
});

// ── : groundedness judges the step that will actually be emitted ────────────────────────────
describe("groundedness reads the post-redirect step (R5)", () => {
  test("no question is asked about arguments the policy gate removed", async () => {
    // The draft's ungrounded value lives on set_fog_lights; the policy gate replaces the step with
    // a fully-parameterized get_weather, so there is nothing ungrounded left to ask about.
    const weatherCall = {
      toolName: "get_weather",
      arguments: {
        location_or_poi_id: "Luxembourg",
        month: 8,
        day: 25,
        time_hour_24hformat: 18,
      },
    };
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "set_fog_lights", arguments: { on: true } }]),
      step(undefined, [weatherCall]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig({ groundedness: true }) });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Could you turn on the lights, please? Visibility is low" },
          {
            role: "tool",
            content: '{"fog_lights":false}',
            toolName: "get_exterior_lights_status",
          },
        ],
      }),
    );

    expect(decision.findings.some((f) => f.code === "ungrounded-argument")).toBe(false);
    expect(decision.toolCalls).toEqual([weatherCall]);
  });

  test("an ungrounded value that SURVIVES to the emitted step is still caught", async () => {
    const backbone = new MockBackbone([
      step(undefined, [
        { toolName: "open_close_window", arguments: { window: "DRIVER", percentage: 100 } },
      ]),
      step(undefined, [
        { toolName: "open_close_window", arguments: { window: "DRIVER", percentage: 100 } },
      ]),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig({ groundedness: true }) });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Open my window" }],
      }),
    );

    expect(decision.findings.some((f) => f.code === "ungrounded-argument")).toBe(true);
    expect(decision.toolCalls).toEqual([]);
  });
});

// ── T6 golden negatives: the paths that already score 1.00 must not move ──────────────────────
describe("golden paths unaffected by the R1-R5 redirect fixes", () => {
  test("T6: the prose gate's true positive still fires (past claim, nothing executed)", async () => {
    const backbone = new MockBackbone([
      step("I have opened the sunroof for you."),
      step("I have opened the sunroof for you."),
    ]);
    const pipeline = new GatePipeline({ backbone, config: testConfig() });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Is the sunroof open?" }],
      }),
    );

    expect(decision.findings.some((f) => f.code === "unexecuted-claim")).toBe(true);
    expect(decision.text).not.toContain("I have opened");
  });

  test("base_2 golden path: the trunk confirmation gate still blocks, then allows", async () => {
    const call = { toolName: "open_close_trunk_door", arguments: { action: "OPEN" } };
    const blocked = new MockBackbone([step(undefined, [call]), step(undefined, [call])]);
    const blockedDecision = await new GatePipeline({
      backbone: blocked,
      config: testConfig(),
    }).decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Open the trunk." }],
      }),
    );
    expect(blockedDecision.toolCalls).toEqual([]);
    expect(blockedDecision.findings.some((f) => f.code === "confirmation-required")).toBe(true);

    const allowed = new MockBackbone([step(undefined, [call]), step(undefined, [call])]);
    const allowedDecision = await new GatePipeline({
      backbone: allowed,
      config: testConfig(),
    }).decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [
          { role: "user", content: "Open the trunk." },
          {
            role: "assistant",
            content: "Just to confirm — open_close_trunk_door with action OPEN. Shall I?",
          },
          { role: "user", content: "Yes, go ahead." },
        ],
      }),
    );
    expect(allowedDecision.toolCalls).toEqual([call]);
  });

  test("base_6 golden path: a grounded ambient-light change is emitted as drafted", async () => {
    const call = {
      toolName: "set_ambient_lights",
      arguments: { on: true, lightcolor: "BLUE" },
    };
    const backbone = new MockBackbone([step(undefined, [call]), step(undefined, [call])]);
    const pipeline = new GatePipeline({ backbone, config: testConfig({ groundedness: true }) });
    const decision = await pipeline.decideNextStep(
      await turnInput({
        systemPrompt: await loadDeliveredWiki(),
        transcript: [{ role: "user", content: "Make the ambient light blue" }],
      }),
    );

    expect(decision.toolCalls).toEqual([call]);
    expect(decision.findings.some((f) => f.verdict === "block")).toBe(false);
  });
});
