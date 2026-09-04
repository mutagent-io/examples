import { describe, expect, test } from "bun:test";

/**
 * Submission-shape conformance, per car-bench-ijcai/README.md#submission-instructions.
 * These are cheap structural checks that catch the mistakes that would invalidate a submission.
 */
const load = async (name: string) =>
  (Bun as unknown as { TOML: { parse(s: string): any } }).TOML.parse(
    await Bun.file(new URL(`../scenarios/${name}`, import.meta.url)).text(),
  );

describe("submission scenario.toml", () => {
  test("uses the OFFICIAL evaluator image (participants never submit an evaluator)", async () => {
    const scenario = await load("scenario.toml");
    expect(scenario.evaluator.image).toBe("ghcr.io/car-bench/car-bench-evaluator:latest");
  });

  test("pins the agent image by DIGEST, not a mutable tag", async () => {
    const scenario = await load("scenario.toml");
    expect(scenario.agent_under_test.image).toContain("@sha256:");
    expect(scenario.agent_under_test.image).toMatch(/^ghcr\.io\//);
  });

  test("runs the full hidden set over three trials", async () => {
    const { config } = await load("scenario.toml");
    expect(config.task_split).toBe("hidden");
    expect(config.num_trials).toBe(3);
    expect(config.tasks_base_num_tasks).toBe(-1);
    expect(config.tasks_hallucination_num_tasks).toBe(-1);
    expect(config.tasks_disambiguation_num_tasks).toBe(-1);
 // The agent's own turn cap must not sit below the harness's step budget (decision).
    expect(config.max_steps).toBe(50);
  });

  test("declares env var NAMES only — no secret VALUES", async () => {
    const scenario = await load("scenario.toml");
    const env: Record<string, string> = scenario.agent_under_test.env;

    for (const [key, value] of Object.entries(env)) {
      // Every entry is either a ${VAR:?}/${VAR:-default} reference or a plain non-secret default.
      if (/key|token|secret|password|credential/i.test(key)) {
        expect(value, `${key} must be an env reference, never a literal`).toMatch(/^\$\{/);
      }
      expect(value).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/); // Google API key shape
      expect(value).not.toMatch(/sk-[0-9A-Za-z]{10,}/); // OpenAI key shape
    }
  });

  // Required vars must use the shell-style ":?" (fail-if-unset) form and optional vars the
  // ":-" (default) form, per the submission template.
  test("required variables use the fail-if-unset form and optional ones the default form", async () => {
    const scenario = await load("scenario.toml");
    const env: Record<string, string> = scenario.agent_under_test.env;

    expect(env.GOOGLE_CLOUD_PROJECT).toMatch(/^\$\{GOOGLE_CLOUD_PROJECT:\?/);
    expect(env.GOOGLE_CLOUD_LOCATION).toMatch(/^\$\{GOOGLE_CLOUD_LOCATION:-/);
    // G-D: the development project served gemini-3.5-flash only at `global`.
    expect(env.GOOGLE_CLOUD_LOCATION).toContain("global");
  });

  test("the model is configurable through the environment (competition rule)", async () => {
    const scenario = await load("scenario.toml");
    expect(scenario.agent_under_test.env.CARLO_MODEL).toMatch(/^\$\{CARLO_MODEL:-/);
    expect(scenario.agent_under_test.env.CARLO_MODEL).toContain("gemini-3.5-flash");
  });
});

describe("development scenarios", () => {
  test("the docker smoke builds locally against the official evaluator image", async () => {
    const scenario = await load("local_docker_smoke.toml");
    expect(scenario.evaluator.image).toBe("ghcr.io/car-bench/car-bench-evaluator:latest");
    expect(scenario.agent_under_test.build.dockerfile).toBe("Dockerfile");
  });

  test("every scenario keeps max_steps at 50", async () => {
    for (const name of ["scenario.toml", "local_smoke.toml", "local_docker_smoke.toml"]) {
      const scenario = await load(name);
      expect(scenario.config.max_steps, name).toBe(50);
    }
  });
});

describe("Dockerfile submission hygiene", () => {
  const dockerfile = () => Bun.file(new URL("../Dockerfile", import.meta.url)).text();

  test("the base image is digest-pinned", async () => {
    expect(await dockerfile()).toMatch(/^FROM\s+\S+@sha256:[0-9a-f]{64}/m);
  });

  test("runs as a non-root user and exposes 8080", async () => {
    const text = await dockerfile();
    expect(text).toMatch(/^USER\s+(?!root)\S+/m);
    expect(text).toContain("EXPOSE 8080");
  });

  test("bakes NO secret and NO test-only flag", async () => {
    const text = await dockerfile();
    expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(text).not.toMatch(/GOOGLE_CLOUD_PROJECT=\S/);
    expect(text).not.toMatch(/GEMINI_API_KEY=\S/);
    // The hermetic-test backbone must never be enabled in a shipped image.
    expect(text).not.toContain("CARLO_TEST_BACKBONE");
  });
});
