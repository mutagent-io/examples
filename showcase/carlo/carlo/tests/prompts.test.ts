import { describe, expect, test } from "bun:test";
import { composeSystemInstruction, SYSTEM_PROMPT } from "../src/prompts.ts";

/**
 * The spec is the SSoT. This test re-extracts the operative prompt FROM the card at test
 * time, so any spec edit that is not cascaded into the implementation fails the build.
 */
const SPEC_PATH = new URL("../../.mutagent/specs/carlo/agentspec.yaml", import.meta.url);

async function promptFromSpec(): Promise<string> {
  const raw = await Bun.file(SPEC_PATH).text();
  const spec = (Bun as unknown as { YAML: { parse(s: string): any } }).YAML.parse(raw);
  return spec.spec.agent.systemPrompt as string;
}

describe("operative system prompt", () => {
  test("is byte-identical to spec.agent.systemPrompt", async () => {
    expect(SYSTEM_PROMPT).toBe(await promptFromSpec());
  });

  test("carries all seven ABSOLUTE RULES verbatim", () => {
    expect(SYSTEM_PROMPT).toContain("ABSOLUTE RULES");
    for (const rule of [
      "1. CAPABILITIES ARE ONLY WHAT THE CURRENT TOOL LIST DECLARES.",
      "2. RESOLVE AMBIGUITY INTERNALLY FIRST; ASK ONLY AS A LAST RESORT.",
      "3. POLICIES BEFORE ACTIONS.",
      "4. GATHER BEFORE YOU CHANGE.",
      "5. EVERY TOOL CALL MUST BE EXACTLY VALID.",
      "6. WHEN UNCERTAIN, DEFER.",
      "7. CLOSE CLEANLY.",
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });

  test("the evaluator's policy text is preserved verbatim and placed FIRST", () => {
    const wiki = "# In-Car Assistant agent policy\n- AUT-POL:005:something binding";
    const composed = composeSystemInstruction(wiki);

    expect(composed.startsWith(wiki)).toBe(true);
    expect(composed).toContain(SYSTEM_PROMPT);
    // The 19 policies are scored against their originals — never rewritten or dropped.
    expect(composed).toContain("AUT-POL:005:something binding");
  });

  test("an empty wiki degrades to CARlo's rules alone", () => {
    expect(composeSystemInstruction("")).toBe(SYSTEM_PROMPT);
    expect(composeSystemInstruction("   ")).toBe(SYSTEM_PROMPT);
  });
});
