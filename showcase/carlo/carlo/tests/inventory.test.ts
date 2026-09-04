import { describe, expect, test } from "bun:test";
import {
  buildInventory,
  getTool,
  hasParameter,
  hasTool,
  inventoryDigest,
  isStateChanging,
  listTools,
} from "../src/inventory.ts";
import { loadTools } from "./helpers/mock-backbone.ts";

describe("capability-inventory", () => {
  test("compiles the full declared tool surface with exact params and enums", async () => {
    const inventory = buildInventory(await loadTools());

    // The fixture is extracted from the real harness sources; CAR-bench declares 58 tools.
    expect(inventory.order.length).toBe(58);
    expect(inventory.malformed).toBe(0);

    const sunroof = getTool(inventory, "open_close_sunroof");
    expect(sunroof).toBeDefined();
    expect(sunroof?.required).toEqual(["percentage"]);
    expect(Object.keys(sunroof?.properties ?? {})).toEqual(["percentage"]);
    expect(sunroof?.properties.percentage?.type).toBe("number");

    // An enum-bearing tool keeps its allowed values verbatim.
    const withEnum = listTools(inventory).find((t) =>
      Object.values(t.properties).some((p) => Array.isArray(p.enum)),
    );
    expect(withEnum).toBeDefined();
  });

  test("preserves the RAW schema object by reference (no rewriting on the way to the model)", async () => {
    const defs = await loadTools();
    const inventory = buildInventory(defs);
    const source = defs.find((d) => d.function?.name === "open_close_sunroof");
    expect(getTool(inventory, "open_close_sunroof")?.parameters).toBe(
      source?.function?.parameters as Record<string, unknown>,
    );
  });

  test("hallucination task: a REMOVED tool is simply absent — never a remembered superset", async () => {
    const full = buildInventory(await loadTools());
    const reduced = buildInventory(await loadTools("tools-info-removed-tool.json"));

    expect(hasTool(full, "open_close_sunshade")).toBe(true);
    expect(hasTool(reduced, "open_close_sunshade")).toBe(false);
    expect(reduced.order.length).toBe(full.order.length - 1);
  });

  test("hallucination task: a REMOVED parameter leaves the tool present but the param gone", async () => {
    const reduced = buildInventory(await loadTools("tools-info-removed-param.json"));

    expect(hasTool(reduced, "open_close_window")).toBe(true);
    expect(hasParameter(reduced, "open_close_window", "percentage")).toBe(false);
    expect(getTool(reduced, "open_close_window")?.required).not.toContain("percentage");
  });

  test("malformed definitions are excluded and counted, never thrown", () => {
    const inventory = buildInventory([
      { type: "function" },
      { type: "function", function: { name: "" } },
      { type: "function", function: { name: "get_weather", parameters: { type: "object" } } },
      { type: "function", function: { name: "get_weather", parameters: {} } },
      null as never,
    ]);

    expect(inventory.order).toEqual(["get_weather"]);
    expect(inventory.malformed).toBe(4);
  });

  test("no leakage between two tasks with different tool sets", async () => {
    const a = buildInventory(await loadTools());
    const b = buildInventory(await loadTools("tools-info-removed-tool.json"));
    expect(hasTool(a, "open_close_sunshade")).toBe(true);
    expect(hasTool(b, "open_close_sunshade")).toBe(false);
    expect(inventoryDigest(a)).not.toBe(inventoryDigest(b));
  });

  test("state-changing classification follows the set_/get_ split, not a hardcoded list", () => {
    expect(isStateChanging("open_close_sunroof")).toBe(true);
    expect(isStateChanging("set_fan_speed")).toBe(true);
    expect(isStateChanging("send_email")).toBe(true);
    expect(isStateChanging("get_weather")).toBe(false);
    expect(isStateChanging("get_sunroof_and_sunshade_position")).toBe(false);
    expect(isStateChanging("search_poi_at_location")).toBe(false);
  });
});

// ── /R2b: the confirmation binding lives in the tool DESCRIPTION prefix ─────────────────────
describe("capability-inventory confirmation flag", () => {
  test("REQUIRES_CONFIRMATION-prefixed descriptions set requiresConfirmation", async () => {
    const inventory = buildInventory(await loadTools());

    expect(inventory.tools.open_close_trunk_door?.requiresConfirmation).toBe(true);
    expect(inventory.tools.send_email?.requiresConfirmation).toBe(true);
    expect(inventory.tools.set_head_lights_high_beams?.requiresConfirmation).toBe(true);
    expect(inventory.tools.open_close_sunroof?.requiresConfirmation).toBe(false);
    expect(inventory.tools.get_weather?.requiresConfirmation).toBe(false);
  });

  test("the flag keys on the PREFIX, not a mention anywhere in the description", () => {
    const inventory = buildInventory([
      {
        type: "function",
        function: { name: "set_a", description: "Mentions REQUIRES_CONFIRMATION mid-sentence." },
      },
      {
        type: "function",
        function: { name: "set_b", description: "REQUIRES_CONFIRMATION, do it" },
      },
    ]);
    expect(inventory.tools.set_a?.requiresConfirmation).toBe(false);
    expect(inventory.tools.set_b?.requiresConfirmation).toBe(true);
  });
});
