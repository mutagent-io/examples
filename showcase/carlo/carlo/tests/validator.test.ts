import { describe, expect, test } from "bun:test";
import { buildInventory } from "../src/inventory.ts";
import {
  hasCapabilityAbsence,
  isCapabilityAbsence,
  isRepairable,
  toGateFindings,
  validateCall,
} from "../src/validator.ts";
import { loadTools } from "./helpers/mock-backbone.ts";

const inventoryPromise = loadTools().then(buildInventory);

describe("arg-validator", () => {
  test("a well-formed call passes", async () => {
    const result = validateCall(
      { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
      await inventoryPromise,
    );
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("missing required parameter is reported and is REPAIRABLE", async () => {
    const result = validateCall(
      { toolName: "open_close_sunroof", arguments: {} },
      await inventoryPromise,
    );
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.code).toBe("missing-required");
    expect(result.findings[0]?.parameter).toBe("percentage");
    expect(isRepairable(result)).toBe(true);
  });

  test("type mismatch is reported and is REPAIRABLE", async () => {
    const result = validateCall(
      { toolName: "open_close_sunroof", arguments: { percentage: "fifty" } },
      await inventoryPromise,
    );
    expect(result.findings.some((f) => f.code === "type-mismatch")).toBe(true);
    expect(isRepairable(result)).toBe(true);
  });

  test("enum violation is reported and is REPAIRABLE", async () => {
    const inventory = buildInventory([
      {
        type: "function",
        function: {
          name: "set_air_circulation",
          description: "",
          parameters: {
            type: "object",
            required: ["mode"],
            properties: { mode: { type: "string", enum: ["fresh_air", "recirculation"] } },
          },
        },
      },
    ]);
    const result = validateCall(
      { toolName: "set_air_circulation", arguments: { mode: "turbo" } },
      inventory,
    );
    expect(result.findings[0]?.code).toBe("enum-violation");
    expect(isRepairable(result)).toBe(true);
  });

  test("the validator never mutates its input", async () => {
    const call = { toolName: "open_close_sunroof", arguments: { percentage: "50" } };
    const snapshot = JSON.stringify(call);
    validateCall(call, await inventoryPromise);
    expect(JSON.stringify(call)).toBe(snapshot);
  });

  // ── Binding condition C1 ────────────────────────────────────────────────────────────────────
  describe("C1 — capability ABSENCE routes to the honest-limit path and is never repairable", () => {
    test("an UNKNOWN TOOL is a non-repairable feasibility finding", async () => {
      const reduced = buildInventory(await loadTools("tools-info-removed-tool.json"));
      const result = validateCall(
        { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
        reduced,
      );

      expect(result.ok).toBe(false);
      expect(result.findings[0]?.code).toBe("unknown-tool");
      expect(result.findings[0]?.repairable).toBe(false);
      const first = result.findings[0];
      expect(first).toBeDefined();
      if (first) expect(isCapabilityAbsence(first)).toBe(true);
      expect(hasCapabilityAbsence(result)).toBe(true);
      expect(isRepairable(result)).toBe(false);

      // It is routed to the FEASIBILITY gate and BLOCKED — never to the repairable args path.
      const gateFindings = toGateFindings(result);
      expect(gateFindings[0]?.gate).toBe("feasibility");
      expect(gateFindings[0]?.verdict).toBe("block");
    });

    test("an ABSENT PARAMETER is a non-repairable feasibility finding", async () => {
      const reduced = buildInventory(await loadTools("tools-info-removed-param.json"));
      const result = validateCall(
        { toolName: "open_close_window", arguments: { percentage: 50 } },
        reduced,
      );

      expect(result.findings.some((f) => f.code === "unknown-parameter")).toBe(true);
      expect(hasCapabilityAbsence(result)).toBe(true);
      expect(isRepairable(result)).toBe(false);

      const gateFindings = toGateFindings(result);
      expect(gateFindings.some((f) => f.gate === "feasibility" && f.verdict === "block")).toBe(
        true,
      );
    });

    test("absence never mixes into the repairable class even alongside value defects", async () => {
      const reduced = buildInventory(await loadTools("tools-info-removed-param.json"));
      const result = validateCall(
        { toolName: "open_close_window", arguments: { percentage: 50, position: "front_left" } },
        reduced,
      );
      expect(isRepairable(result)).toBe(false);
      expect(hasCapabilityAbsence(result)).toBe(true);
    });
  });
});

// ── /R4a: getter/setter FIELD PARITY ────────────────────────────────────────────────────────
import { listTools } from "../src/inventory.ts";
import type { RawToolDefinition } from "../src/types.ts";
import {
  checkFieldParity,
  observableOnlySubjects,
  proseFeasibility,
  siblingGetter,
  userNamedAbsentCapabilities,
} from "../src/validator.ts";

async function loadGetterOutputs(): Promise<Record<string, unknown>> {
  return (await Bun.file(
    new URL("./fixtures/getter-outputs.json", import.meta.url),
  ).json()) as Record<string, unknown>;
}

/** The hallucination_6 mutation: `lightcolor` deleted from BOTH `properties` and `required`. */
async function ambientLightsWithoutColor(): Promise<RawToolDefinition[]> {
  const defs = (await loadTools()).map((d) => JSON.parse(JSON.stringify(d)) as RawToolDefinition);
  for (const def of defs) {
    if (def.function?.name !== "set_ambient_lights") continue;
    const parameters = def.function.parameters as Record<string, any>;
    delete parameters.properties.lightcolor;
    parameters.required = parameters.required.filter((r: string) => r !== "lightcolor");
  }
  return defs;
}

describe("field parity (F4/R4a)", () => {
  test("a deleted carrier parameter surfaces as unexpressible-attribute", async () => {
    const inventory = buildInventory(await ambientLightsWithoutColor());
    const outputs = await loadGetterOutputs();
    const transcript = [
      { role: "user", content: "Make the ambient light brown." },
      {
        role: "tool",
        content: JSON.stringify(outputs.get_ambient_light_status_and_color),
        toolName: "get_ambient_light_status_and_color",
      },
    ];

    const findings = checkFieldParity(
      { toolName: "set_ambient_lights", arguments: { on: true } },
      inventory,
      transcript,
    );

    expect(findings.length).toBe(1);
    expect(findings[0]?.code).toBe("unexpressible-attribute");
    expect(findings[0]?.parameter).toBe("ambient_light");
    // Non-repairable by construction: it must reach the honest-limit path, never a repair.
    expect(findings[0]?.repairable).toBe(false);
    expect(isCapabilityAbsence(findings[0] as any)).toBe(true);
  });

  test("the SAME call is silent under the full inventory (the carrier exists)", async () => {
    const inventory = await inventoryPromise;
    const outputs = await loadGetterOutputs();
    const findings = checkFieldParity(
      { toolName: "set_ambient_lights", arguments: { on: true, lightcolor: "BLUE" } },
      inventory,
      [
        {
          role: "tool",
          content: JSON.stringify(outputs.get_ambient_light_status_and_color),
          toolName: "get_ambient_light_status_and_color",
        },
      ],
    );
    expect(findings).toEqual([]);
  });

  test("the check stays NARROW: no sibling getter call, no finding", async () => {
    const inventory = buildInventory(await ambientLightsWithoutColor());
    expect(
      checkFieldParity({ toolName: "set_ambient_lights", arguments: { on: true } }, inventory, [
        { role: "user", content: "Make the ambient light brown." },
      ]),
    ).toEqual([]);
  });

  test("REGRESSION: zero parity findings across all 58 tools on the full inventory", async () => {
    const inventory = await inventoryPromise;
    const outputs = (await loadGetterOutputs()) as Record<string, unknown>;
    let flagged = 0;
    let paired = 0;

    for (const tool of listTools(inventory)) {
      const getter = siblingGetter(tool, inventory);
      if (!getter) continue;
      const payload = outputs[getter.name];
      if (payload === undefined) continue;
      paired += 1;
      flagged += checkFieldParity({ toolName: tool.name, arguments: {} }, inventory, [
        { role: "tool", content: JSON.stringify(payload), toolName: getter.name },
      ]).length;
    }

    expect(paired).toBeGreaterThanOrEqual(8);
    expect(flagged).toBe(0);
  });
});

// ── /R4b: PROSE-channel feasibility ─────────────────────────────────────────────────────────
describe("prose feasibility (F4/R4b)", () => {
  test("a claim to have executed an ABSENT tool is flagged", async () => {
    const cut = buildInventory(await loadTools("tools-info-removed-tool.json"));
    const findings = proseFeasibility("I have opened the sunshade", cut, []);

    expect(findings.map((f) => `${f.code}:${f.term}`)).toEqual(["absent-capability:sunshade"]);
  });

  test("an OFFER of an absent tool is flagged too (hallucination_0's first move)", async () => {
    const cut = buildInventory(await loadTools("tools-info-removed-tool.json"));
    expect(
      proseFeasibility("I can open the sunshade for you if you like.", cut, []).some(
        (f) => f.code === "absent-capability" && f.term === "sunshade",
      ),
    ).toBe(true);
  });

  test("claiming a state change no emitted call performs is flagged", async () => {
    const inventory = await inventoryPromise;
    expect(
      proseFeasibility("I have opened the sunroof for you.", inventory, []).map((f) => f.code),
    ).toEqual(["unexecuted-claim"]);

    // The same sentence is honest when the call IS emitted.
    expect(
      proseFeasibility("I have opened the sunroof for you.", inventory, ["open_close_sunroof"]),
    ).toEqual([]);
  });

  test("the claim is attributed to the MOST SPECIFIC tool it names", async () => {
    const inventory = await inventoryPromise;
    // "the window defrost" names open_close_window (1 token) and set_window_defrost (2).
    expect(
      proseFeasibility("I have set the window defrost for you.", inventory, ["set_window_defrost"]),
    ).toEqual([]);
  });

  test("a REQUEST naming an absent capability is caught at ingest; a QUESTION is not", async () => {
    const cut = buildInventory(await loadTools("tools-info-removed-tool.json"));
    const full = await inventoryPromise;

    expect(userNamedAbsentCapabilities("Open the sunshade please", cut)).toEqual(["sunshade"]);
    expect(userNamedAbsentCapabilities("Open the sunshade please", full)).toEqual([]);
    expect(userNamedAbsentCapabilities("Is the sunshade open?", cut)).toEqual([]);
  });

  test("REGRESSION: realistic phrasing produces ZERO flags across all 58 tools", async () => {
    const inventory = await inventoryPromise;
    const flags: string[] = [];

    for (const tool of listTools(inventory)) {
      const phrase = tool.name
        .replace(/^(get|set|open_close|send|call|delete|navigation)_/, "")
        .replace(/_/g, " ");
      const texts = tool.stateChanging
        ? [`I have set the ${phrase} for you.`, `I can set the ${phrase} if you like.`]
        : [`The ${phrase} looks fine.`, `I can check the ${phrase} for you.`];
      const emitted = tool.stateChanging ? [tool.name] : [];
      for (const text of texts) {
        for (const finding of proseFeasibility(text, inventory, emitted)) {
          flags.push(`${tool.name}|${text}|${finding.code}:${finding.term}`);
        }
      }
    }

    expect(flags).toEqual([]);
    // Nothing that HAS an actuator may be treated as an absent capability.
    for (const subject of observableOnlySubjects(inventory)) {
      expect(userNamedAbsentCapabilities(`Set the ${subject} now`, inventory)).toContain(subject);
    }
  });
});

// ── /R3b: ARGUMENT GROUNDEDNESS ─────────────────────────────────────────────────────────────
import { checkGroundedness, groundednessQuestion } from "../src/validator.ts";

function userTurn(content: string) {
  return [{ role: "user", content }];
}

describe("argument groundedness (F3/R3b)", () => {
  test("FAILING SHAPE: a window percentage the driver never uttered is ungrounded", async () => {
    const inventory = await inventoryPromise;
    const findings = checkGroundedness(
      { toolName: "open_close_window", arguments: { window: "DRIVER", percentage: 100 } },
      inventory,
      userTurn("Open my window"),
    );

    expect(findings.map((f) => f.parameter)).toContain("percentage");
    expect(groundednessQuestion(findings[0] as any)).toContain(
      (findings[0] as any).parameter.replace(/_/g, " "),
    );
  });

  test("FAILING SHAPE: ambient NONE/off for a request of 'brown' is ungrounded", async () => {
    const inventory = await inventoryPromise;
    const findings = checkGroundedness(
      { toolName: "set_ambient_lights", arguments: { on: false, lightcolor: "NONE" } },
      inventory,
      userTurn("Make the ambient light brown"),
    );
    expect(findings.map((f) => f.parameter)).toEqual(["lightcolor"]);
  });

  test("PASSING SHAPE: 'fresh air' grounds FRESH_AIR (enum-value tokenization)", async () => {
    const inventory = await inventoryPromise;
    expect(
      checkGroundedness(
        { toolName: "set_air_circulation", arguments: { mode: "FRESH_AIR" } },
        inventory,
        userTurn("Let some fresh air in please"),
      ),
    ).toEqual([]);
  });

  test("PASSING SHAPE: 'windshield' grounds WINDSHIELD", async () => {
    const inventory = await inventoryPromise;
    expect(
      checkGroundedness(
        { toolName: "set_fan_airflow_direction", arguments: { direction: "WINDSHIELD" } },
        inventory,
        userTurn("Point the airflow at the windshield"),
      ),
    ).toEqual([]);
  });

  test("a value READ FROM THE CAR is grounded", async () => {
    const inventory = await inventoryPromise;
    expect(
      checkGroundedness(
        { toolName: "open_close_window", arguments: { window: "DRIVER", percentage: 30 } },
        inventory,
        [
          { role: "user", content: "Put the window back where it was" },
          {
            role: "tool",
            content: '{"result":{"window_driver_position":30}}',
            toolName: "get_vehicle_window_positions",
          },
          { role: "user", content: "the driver one" },
        ],
      ),
    ).toEqual([]);
  });

  test("read-only calls and free-form strings are OUT OF SCOPE", async () => {
    const inventory = await inventoryPromise;
    // A getter is never groundedness-checked.
    expect(
      checkGroundedness(
        { toolName: "get_weather", arguments: { location_or_poi_id: "Berlin" } },
        inventory,
        userTurn("What's the weather?"),
      ),
    ).toEqual([]);
    // An authored email body is not a graded VALUE choice.
    const email = checkGroundedness(
      {
        toolName: "send_email",
        arguments: { recipient: "anna@example.com", subject: "Running late", body: "See you at 8" },
      },
      inventory,
      userTurn("Tell Anna I'm running late"),
    );
    expect(email).toEqual([]);
  });
});

// ── R4b OVER-FIRE FIXES (smoke re-run 2026-08-25) ─────────────────────────────────────────────
/**
 * The first cut of the prose gate refused IN-SCOPE disambiguation turns two ways, regressing
 * Pass^3 to 1/5: an offer in one sentence made every subject named in ANOTHER sentence suspect
 * (t5/t6, "weather"), and a truthful report of work done on an EARLIER turn was read as an
 * unexecuted claim (t11-t13). Both shapes are replayed verbatim from
 * traces/de659f7f-cab7-41d8-80dd-a23d79599fdf.jsonl.
 */
describe("prose feasibility over-fire fixes (F4/R4b)", () => {
  test("a DESCRIPTIVE weather turn is not a capability claim", async () => {
    const inventory = await inventoryPromise;
    expect(
      proseFeasibility(
        "It's currently raining in Luxembourg — are you sure you want the sunroof open?",
        inventory,
        [],
      ),
    ).toEqual([]);
  });

  test("t5 VERBATIM: reporting the weather while asking to confirm the sunroof is clean", async () => {
    const inventory = await inventoryPromise;
    expect(
      proseFeasibility(
        "Hey there! I checked the weather for you, and it looks like it is currently rainy. " +
          "Since it is raining, are you sure you want me to open the sunroof? If you still want " +
          "to go ahead, just let me know and I will open the sunshade all the way and set the " +
          "sunroof to 50% for you!",
        inventory,
        [],
      ),
    ).toEqual([]);
  });

  test("t6 VERBATIM: a rain warning plus a confirmation question is clean", async () => {
    const inventory = await inventoryPromise;
    expect(
      proseFeasibility(
        "It looks like it is currently raining outside. Since the weather is rainy, opening the " +
          "sunroof might get the interior wet. Are you sure you want me to go ahead and open the " +
          "sunshade all the way and the sunroof to 50%?",
        inventory,
        [],
      ),
    ).toEqual([]);
  });

  test("a CONDITIONAL offer is not a completion claim", async () => {
    const inventory = await inventoryPromise;
    expect(
      proseFeasibility("I'll open the sunroof to 50% once you confirm.", inventory, []),
    ).toEqual([]);
  });

  test("t11 VERBATIM: reporting work done on an EARLIER turn is honest", async () => {
    const inventory = await inventoryPromise;
    const text =
      "I have opened the sunshade all the way to 100% and set the sunroof to 50% for you. " +
      "Enjoy the fresh air!";

    // Nothing emitted THIS turn, but both calls ran earlier in the conversation.
    expect(
      proseFeasibility(text, inventory, [], ["open_close_sunshade", "open_close_sunroof"]),
    ).toEqual([]);
    // Regression guard: with nothing ever executed, the same sentence IS a fabrication.
    expect(proseFeasibility(text, inventory, []).map((f) => f.code)).toEqual([
      "unexecuted-claim",
      "unexecuted-claim",
    ]);
  });

  test("disambiguation_8 shape: proposing fog lights and asking to confirm is clean", async () => {
    const inventory = await inventoryPromise;
    expect(
      proseFeasibility(
        "It's foggy in Luxembourg right now. I can turn on the fog lights for you — shall I go " +
          "ahead and switch them on?",
        inventory,
        [],
      ),
    ).toEqual([]);
  });

  test("REGRESSION GUARD: a past claim on an absent tool still flags", async () => {
    const cut = buildInventory(await loadTools("tools-info-removed-tool.json"));
    expect(
      proseFeasibility("I have opened the sunshade", cut, []).map((f) => `${f.code}:${f.term}`),
    ).toEqual(["absent-capability:sunshade"]);
  });

  test("REGRESSION GUARD: offering an ABSENT actuator still flags", async () => {
    const cut = buildInventory(await loadTools("tools-info-removed-tool.json"));
    expect(
      proseFeasibility("Would you like me to open the sunshade?", cut, []).map(
        (f) => `${f.code}:${f.term}`,
      ),
    ).toEqual(["absent-capability:sunshade"]);
  });

  test("mentioning an absent subject WITHOUT actuating it is clean", async () => {
    const cut = buildInventory(await loadTools("tools-info-removed-tool.json"));
    // The sunshade is readable; describing its position is not a capability claim.
    expect(proseFeasibility("The sunshade is currently closed.", cut, [])).toEqual([]);
    expect(
      proseFeasibility("I checked the sunshade position for you — it's shut.", cut, []),
    ).toEqual([]);
  });
});
