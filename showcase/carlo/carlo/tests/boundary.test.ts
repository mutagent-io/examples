import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHandler } from "../src/a2a/server.ts";
import { A2A_METHOD } from "../src/a2a/wire.ts";
import { loadTools, loadWiki, MockBackbone, step, testConfig } from "./helpers/mock-backbone.ts";

const SRC = new URL("../src", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

/**
 * The benchmark boundary, encoded as executable checks rather than prose:
 * car-bench-ijcai/docs/agent-under-test-harnessing.md#agentic-harness-boundaries and
 * spec.intent.constraints["Benchmark boundary"].
 */
describe("benchmark boundary", () => {
  test("the decision loop has no shell, file-write, or outbound-network capability", () => {
    // The sanctioned exceptions: backbone/vertex.ts (the model call) and trace.ts (the evidence sink).
    const decisionModules = sourceFiles(SRC).filter(
      (f) => !f.includes("/backbone/") && !f.endsWith("/trace.ts"),
    );
    expect(decisionModules.length).toBeGreaterThan(5);

    for (const file of decisionModules) {
      const source = readFileSync(file, "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      expect(code, `${file} must not spawn processes`).not.toMatch(
        /child_process|Bun\.spawn|execSync|\$`/,
      );
      expect(code, `${file} must not read or write the filesystem`).not.toMatch(
        /node:fs|require\(["']fs["']\)|Bun\.file\(/,
      );
      // `fetch(` in server.ts is the INBOUND handler's own name, not an outbound call.
      expect(code, `${file} must not make outbound HTTP calls`).not.toMatch(
        /axios|node:https?|httpx|await fetch\(/,
      );
    }
  });

  test("no module reads task definitions, answer keys, or mock data", () => {
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file} must not touch benchmark data`).not.toMatch(
        /task_splits|ground_truth|mock_data|removed_part|answer_key|third_party/,
      );
    }
  });

  test("CARlo emits tool-call REQUESTS and never executes a tool", async () => {
    // The only outbound effect in the whole surface is the A2A response; there is no executor for
    // vehicle tools anywhere in src/.
    for (const file of sourceFiles(SRC)) {
      const code = readFileSync(file, "utf8");
      expect(code).not.toMatch(/function\s+(invoke|executeTool|runTool)\b/);
    }
  });

  test("emitted tool and parameter names are byte-identical to the declared schema", async () => {
    const declaredArgs = {
      location_or_poi_id: "loc_1",
      month: 8,
      day: 24,
      time_hour_24hformat: 12,
    };
    const backbone = new MockBackbone([
      step(undefined, [{ toolName: "get_weather", arguments: { ...declaredArgs } }]),
    ]);
    const { fetch } = createHandler({ config: testConfig(), backbone, sink: { write() {} } });

    const response = await fetch(
      new Request("http://carlo.test/", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: A2A_METHOD,
          params: {
            message: {
              messageId: "m1",
              role: "ROLE_USER",
              parts: [
                { text: `System: ${await loadWiki()}\n\nUser: What's the weather?` },
                { data: { tools: await loadTools() } },
              ],
            },
          },
        }),
      }),
    );

    const body = (await response.json()) as Record<string, any>;
    const call = body.result.message.parts.find((p: any) => p.data?.tool_calls)?.data.tool_calls[0];

    expect(call.tool_name).toBe("get_weather");
    // Round-trips byte-identical: no renaming, no restructuring, no type coercion on the way out.
    expect(call.arguments).toEqual(declaredArgs);
  });

  // ── B7 finding: no env-activated backbone swap may exist in the production entrypoint ───────
  test("src/ contains no stub backbone and no backbone-swap env flag", () => {
    const files = sourceFiles(SRC);
    expect(files.some((f) => f.includes("stub"))).toBe(false);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not reference a stub backbone`).not.toMatch(
        /StubBackbone|CARLO_TEST_BACKBONE|stubEnabled/,
      );
    }
  });

  test("the ONLY backbone seam is the injected option — the env cannot swap the model client", () => {
    const server = readFileSync(join(SRC, "a2a/server.ts"), "utf8");

    // Exactly one construction site, and it is unconditional apart from the injection default.
    expect(server).toContain("options.backbone ?? new VertexBackbone({ config })");
    expect(server).not.toMatch(/process\.env\[[^\]]*BACKBONE/);

    // The live-config guard must not be conditional (an earlier revision let a flag bypass it).
    expect(server).toContain("assertLiveReady(config);");
    expect(server).not.toMatch(/if\s*\([^)]*\)\s*assertLiveReady/);
  });

  test("the system prompt layers AFTER the evaluator's policy, never replacing it", async () => {
    const backbone = new MockBackbone([step("ok")]);
    const { fetch } = createHandler({ config: testConfig(), backbone, sink: { write() {} } });
    const wiki = await loadWiki();

    await fetch(
      new Request("http://carlo.test/", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: A2A_METHOD,
          params: {
            message: {
              messageId: "m1",
              role: "ROLE_USER",
              parts: [
                { text: `System: ${wiki}\n\nUser: hi` },
                { data: { tools: await loadTools() } },
              ],
            },
          },
        }),
      }),
    );

    const instruction = backbone.requests[0]?.systemInstruction ?? "";
    expect(instruction).toContain("AUT-POL:005");
    expect(instruction.indexOf("AUT-POL:005")).toBeLessThan(instruction.indexOf("You are CARlo"));
  });
});
