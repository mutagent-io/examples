import { describe, expect, test } from "bun:test";
import { buildInventory } from "../src/inventory.ts";
import {
  compilePolicy,
  extractRawRules,
  orderingFor,
  prerequisitesFor,
  rulesForTool,
} from "../src/policy.ts";
import { loadTools, loadWiki } from "./helpers/mock-backbone.ts";

describe("policy-compiler", () => {
  test("extracts the wiki's own AUT-POL/LLM-POL anchored rules", async () => {
    const rules = extractRawRules(await loadWiki());
    expect(rules.length).toBeGreaterThanOrEqual(19);
    expect(rules.some((r) => r.ids.includes("AUT-POL:005"))).toBe(true);
    // A rule carrying two ids on one bullet keeps both.
    const dual = rules.find((r) => r.ids.length > 1);
    expect(dual?.ids.length).toBeGreaterThan(1);
  });

  test("AUT-POL:005 attaches the sunshade ORDERING to the sunroof action", async () => {
    const inventory = buildInventory(await loadTools());
    const checklist = compilePolicy(await loadWiki(), inventory);

    expect(checklist.unverified).toBe(false);
    expect(rulesForTool(checklist, "open_close_sunroof").length).toBeGreaterThan(0);
    expect(orderingFor(checklist, "open_close_sunroof")).toContain("open_close_sunshade");
  });

  test("the weather rule attaches get_weather as a PREREQUISITE of opening the sunroof", async () => {
    const inventory = buildInventory(await loadTools());
    const checklist = compilePolicy(await loadWiki(), inventory);
    expect(prerequisitesFor(checklist, "open_close_sunroof")).toContain("get_weather");
  });

  test("attachment is inventory-relative: a removed tool attaches to nothing", async () => {
    const reduced = buildInventory(await loadTools("tools-info-removed-tool.json"));
    const checklist = compilePolicy(await loadWiki(), reduced);
    expect(orderingFor(checklist, "open_close_sunroof")).not.toContain("open_close_sunshade");
  });

  test("placeholder-bearing wiki still parses (harness substitutes at runtime)", async () => {
    const inventory = buildInventory(await loadTools());
    const raw = await loadWiki();
    expect(raw).toContain("{{placeholder_location_based_on_task_context_init_config}}");
    expect(compilePolicy(raw, inventory).unverified).toBe(false);
  });

  test("onFailure: missing or unparsable policy yields an EMPTY checklist marked unverified", async () => {
    const inventory = buildInventory(await loadTools());

    for (const wiki of ["", "   ", null, undefined, "no policies here, just prose"]) {
      const checklist = compilePolicy(wiki, inventory);
      expect(checklist.rules).toEqual([]);
      expect(checklist.unverified).toBe(true);
    }
  });
});

// ── : the bench DELIVERS the wiki with its namespace prefixes stripped ───────────────────
/**
 * `wiki.py:8-10` replaces "INS:", "AUT-POL:" and "LLM-POL:" with "" before delivery, so the agent
 * never sees the anchors the compiler was written against (`- 004:` / `- 008:009:` arrive instead).
 * The raw fixture was the test blind spot that let 19 delivered rules compile to 0.
 */
async function loadDeliveredWiki(): Promise<string> {
  return await Bun.file(new URL("./fixtures/wiki-delivered.md", import.meta.url)).text();
}

describe("policy-compiler on the DELIVERED wiki (F2/R2)", () => {
  test("the fixture really is the delivered form (no namespace prefixes survive)", async () => {
    const delivered = await loadDeliveredWiki();
    expect(delivered).not.toContain("AUT-POL:");
    expect(delivered).not.toContain("LLM-POL:");
    expect(delivered).not.toContain("INS:");
    expect(delivered).toContain("- 004:");
    expect(delivered).toContain("- 008:009:");
  });

  test("all 19 delivered rules parse, and the checklist is NOT unverified", async () => {
    const inventory = buildInventory(await loadTools());
    const checklist = compilePolicy(await loadDeliveredWiki(), inventory);

    expect(checklist.rules.length).toBe(19);
    expect(checklist.unverified).toBe(false);
  });

  test("stripped ids are tagged POL:<n>, prefixed ids keep their namespace", async () => {
    const delivered = extractRawRules(await loadDeliveredWiki());
    const raw = extractRawRules(await loadWiki());

    expect(delivered.some((r) => r.ids.includes("POL:005"))).toBe(true);
    // A dual-id bullet keeps BOTH ids after stripping.
    expect(delivered.some((r) => r.ids.join(",") === "POL:008,POL:009")).toBe(true);
    expect(raw.some((r) => r.ids.includes("AUT-POL:005"))).toBe(true);
  });

  test("the delivered wiki still attaches AUT-POL:005's sunshade ordering to the sunroof", async () => {
    const inventory = buildInventory(await loadTools());
    const checklist = compilePolicy(await loadDeliveredWiki(), inventory);
    expect(orderingFor(checklist, "open_close_sunroof")).toContain("open_close_sunshade");
  });

  test("F2b: the REQUIRES_CONFIRMATION rule binds to every confirmation-gated tool", async () => {
    const inventory = buildInventory(await loadTools());
    const checklist = compilePolicy(await loadDeliveredWiki(), inventory);

    const trunk = rulesForTool(checklist, "open_close_trunk_door");
    expect(trunk.some((r) => /REQUIRES_CONFIRMATION/.test(r.text))).toBe(true);

    // It binds by DESCRIPTION PREFIX, so all three gated tools are covered — and nothing else.
    const rule = checklist.rules.find((r) => /REQUIRES_CONFIRMATION/.test(r.text));
    expect([...(rule?.appliesToTools ?? [])].sort()).toEqual([
      "open_close_trunk_door",
      "send_email",
      "set_head_lights_high_beams",
    ]);
  });
});
