import { describe, expect, test } from "bun:test";
import { conservativeChoice, decideEscalation } from "../src/escalation.ts";
import { buildInventory } from "../src/inventory.ts";
import type { GateFinding, ToolCallRequest } from "../src/types.ts";
import { loadTools } from "./helpers/mock-backbone.ts";

const inventoryPromise = loadTools().then(buildInventory);
const noFindings: GateFinding[] = [];

describe("escalation-controller", () => {
  test("a read-only step spends NO extra pass", async () => {
    const decision = decideEscalation(
      {
        toolCalls: [{ toolName: "get_weather", arguments: {} }],
        findings: noFindings,
        ambiguityFlagged: false,
      },
      await inventoryPromise,
    );
    expect(decision.extraPasses).toBe(0);
    expect(decision.reasons).toEqual([]);
  });

  test("a state-changing step earns exactly ONE extra pass", async () => {
    const decision = decideEscalation(
      {
        toolCalls: [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }],
        findings: noFindings,
        ambiguityFlagged: false,
      },
      await inventoryPromise,
    );
    expect(decision.extraPasses).toBe(1);
    expect(decision.reasons).toContain("state-change");
  });

  test("flagged ambiguity earns exactly one pass", async () => {
    const decision = decideEscalation(
      { toolCalls: [], findings: noFindings, ambiguityFlagged: true },
      await inventoryPromise,
    );
    expect(decision.extraPasses).toBe(1);
    expect(decision.reasons).toContain("ambiguity");
  });

  test("capability doubt earns exactly one pass", async () => {
    const findings: GateFinding[] = [
      { gate: "feasibility", verdict: "block", code: "unknown-tool", detail: "absent" },
    ];
    const decision = decideEscalation(
      { toolCalls: [], findings, ambiguityFlagged: false },
      await inventoryPromise,
    );
    expect(decision.extraPasses).toBe(1);
    expect(decision.reasons).toContain("capability-doubt");
  });

  test("TWO risks in one step are still exactly ONE pass (never two)", async () => {
    const findings: GateFinding[] = [
      { gate: "feasibility", verdict: "block", code: "unknown-tool", detail: "absent" },
    ];
    const decision = decideEscalation(
      {
        toolCalls: [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }],
        findings,
        ambiguityFlagged: true,
      },
      await inventoryPromise,
    );
    expect(decision.reasons.length).toBeGreaterThan(1);
    expect(decision.extraPasses).toBe(1);
  });

  test("verify modes are honored", async () => {
    const inventory = await inventoryPromise;
    const quiet = { toolCalls: [], findings: noFindings, ambiguityFlagged: false };
    const risky = {
      toolCalls: [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }],
      findings: noFindings,
      ambiguityFlagged: false,
    };

    expect(decideEscalation(quiet, inventory, "always").extraPasses).toBe(1);
    expect(decideEscalation(risky, inventory, "never").extraPasses).toBe(0);
    expect(decideEscalation(quiet, inventory, "risk").extraPasses).toBe(0);
  });

  test("conservative-wins arbitration when verify contradicts the draft", async () => {
    const inventory = await inventoryPromise;
    const stateChange = {
      toolCalls: [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }],
    };
    const infoOnly = { toolCalls: [{ toolName: "get_weather", arguments: {} }] };
    const textOnly = { toolCalls: [] };

    expect(conservativeChoice(stateChange, infoOnly, inventory)).toBe(infoOnly);
    expect(conservativeChoice(stateChange, textOnly, inventory)).toBe(textOnly);
    // A verify pass that escalates risk does NOT win.
    expect(conservativeChoice(infoOnly, stateChange, inventory)).toBe(infoOnly);
  });
});

// ── /R3d: draft/verify VALUE disagreement ───────────────────────────────────────────────────
import { argsDisagree, disagreementQuestion } from "../src/escalation.ts";

describe("draft/verify argument disagreement (F3/R3d)", () => {
  test("the SAME state-changing tool with DIFFERENT args is a disagreement", async () => {
    const inventory = buildInventory(await loadTools());
    const disagreement = argsDisagree(
      {
        toolCalls: [{ toolName: "set_ambient_lights", arguments: { on: true, lightcolor: "RED" } }],
      },
      {
        toolCalls: [
          { toolName: "set_ambient_lights", arguments: { on: false, lightcolor: "NONE" } },
        ],
      },
      inventory,
    );

    expect(disagreement?.toolName).toBe("set_ambient_lights");
    expect(disagreement?.parameters.sort()).toEqual(["lightcolor", "on"]);
    expect(disagreementQuestion(disagreement as any)).toContain("?");
  });

  test("identical arguments are no disagreement, and read-only tools are out of scope", async () => {
    const inventory = buildInventory(await loadTools());
    const same = { toolCalls: [{ toolName: "set_ambient_lights", arguments: { on: true } }] };
    expect(argsDisagree(same, same, inventory)).toBeNull();

    expect(
      argsDisagree(
        { toolCalls: [{ toolName: "get_weather", arguments: { location_or_poi_id: "A" } }] },
        { toolCalls: [{ toolName: "get_weather", arguments: { location_or_poi_id: "B" } }] },
        inventory,
      ),
    ).toBeNull();
  });

  test("a DIFFERENT tool in the verify pass is arbitrated by conservativeChoice, not this check", async () => {
    const inventory = buildInventory(await loadTools());
    expect(
      argsDisagree(
        { toolCalls: [{ toolName: "set_ambient_lights", arguments: { on: true } }] },
        { toolCalls: [{ toolName: "get_weather", arguments: {} }] },
        inventory,
      ),
    ).toBeNull();
  });
});

// ── : a gate-emptied draft must never win arbitration ───────────────────────────────────────
describe("conservativeChoice and the gate-emptied draft (R4)", () => {
  test("an EMPTIED draft loses to a verify pass that has real calls", async () => {
    const inventory = buildInventory(await loadTools());
    const emptied = { toolCalls: [] as ToolCallRequest[] };
    const verified = {
      toolCalls: [
        { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
        { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
      ],
    };

    // Without the flag the corpse wins on risk score alone — that was the defect.
    expect(conservativeChoice(emptied, verified, inventory)).toBe(emptied);
    expect(conservativeChoice(emptied, verified, inventory, true)).toBe(verified);
  });

  test("a draft that is legitimately empty (nothing drafted) is unaffected", async () => {
    const inventory = buildInventory(await loadTools());
    const textOnly = { toolCalls: [] as ToolCallRequest[] };
    const verified = { toolCalls: [{ toolName: "get_weather", arguments: {} }] };
    expect(conservativeChoice(textOnly, verified, inventory, false)).toBe(textOnly);
  });

  test("on a TIE the draft is kept, so this turn's gate corrections survive", async () => {
    const inventory = buildInventory(await loadTools());
    const draft = {
      toolCalls: [
        { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
        { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
      ],
    };
    const verified = {
      toolCalls: [
        { toolName: "open_close_sunroof", arguments: { percentage: 50 } },
        { toolName: "open_close_sunshade", arguments: { percentage: 100 } },
      ],
    };
    expect(conservativeChoice(draft, verified, inventory)).toBe(draft);
  });

  test("a strictly safer verify pass still wins", async () => {
    const inventory = buildInventory(await loadTools());
    const stateChange = {
      toolCalls: [{ toolName: "open_close_sunroof", arguments: { percentage: 50 } }],
    };
    const infoOnly = { toolCalls: [{ toolName: "get_weather", arguments: {} }] };
    expect(conservativeChoice(stateChange, infoOnly, inventory)).toBe(infoOnly);
  });
});
