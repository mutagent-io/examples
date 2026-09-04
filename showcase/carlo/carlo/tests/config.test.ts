import { describe, expect, test } from "bun:test";
import { assertLiveReady, ConfigError, describeConfig, loadConfig } from "../src/config.ts";

describe("env-var-only config", () => {
  test("defaults honor the spec and the live probe findings", () => {
    const config = loadConfig({});

    expect(config.model).toBe("gemini-3.5-flash"); // spec-pinned backbone
    expect(config.temperature).toBe(0); // constraint: variance is a defect
    expect(config.thinkingBudget).toBe(0); // G-E: thinking is ON by default for this model
    expect(config.maxTurns).toBe(50); // spec maxIterations = 50
    expect(config.verifyMode).toBe("risk"); / default; always-verify is an env flip
    // G-D: gemini-3.5-flash resolved ONLY at `global` on the probed project.
    expect(config.location).toBe("global");
  });

  test("every knob is settable from the environment (competition rule)", () => {
    const config = loadConfig({
      CARLO_MODEL: "gemini-2.5-flash",
      CARLO_TEMPERATURE: "0.7",
      CARLO_THINKING_BUDGET: "512",
      CARLO_MAX_TURNS: "40",
      CARLO_VERIFY_MODE: "always",
      CARLO_TRACE_DIR: "/tmp/t",
      GOOGLE_CLOUD_PROJECT: "proj",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      PORT: "9000",
      HOST: "0.0.0.0",
    });

    expect(config).toMatchObject({
      model: "gemini-2.5-flash",
      temperature: 0.7,
      thinkingBudget: 512,
      maxTurns: 40,
      verifyMode: "always",
      traceDir: "/tmp/t",
      project: "proj",
      location: "us-central1",
      port: 9000,
      host: "0.0.0.0",
    });
  });

  test("invalid values fail loudly and name the variable", () => {
    expect(() => loadConfig({ CARLO_VERIFY_MODE: "sometimes" })).toThrow(/CARLO_VERIFY_MODE/);
    expect(() => loadConfig({ CARLO_TEMPERATURE: "warm" })).toThrow(/CARLO_TEMPERATURE/);
    expect(() => loadConfig({ CARLO_MAX_TURNS: "0" })).toThrow(/CARLO_MAX_TURNS/);
  });

  test("a live run requires the project, and says so", () => {
    expect(() => assertLiveReady(loadConfig({}))).toThrow(ConfigError);
    expect(() => assertLiveReady(loadConfig({}))).toThrow(/GOOGLE_CLOUD_PROJECT/);
    expect(() => assertLiveReady(loadConfig({ GOOGLE_CLOUD_PROJECT: "p" }))).not.toThrow();
  });

  test("the startup banner surfaces the model/location pair that silently 404s when mismatched", () => {
    const banner = describeConfig(loadConfig({ GOOGLE_CLOUD_PROJECT: "p" }));
    expect(banner).toContain("model=gemini-3.5-flash");
    expect(banner).toContain("location=global");
  });

  test("config is frozen — no component can mutate it mid-run", () => {
    const config = loadConfig({});
    expect(Object.isFrozen(config)).toBe(true);
  });
});

// ── /R3b: the groundedness gate is an env flip, OFF until it is measured ────────────────────
describe("groundedness flag", () => {
  test("defaults to OFF", () => {
    expect(loadConfig({ GOOGLE_CLOUD_PROJECT: "p" }).groundedness).toBe(false);
  });

  test("CARLO_GROUNDEDNESS turns it on and the banner reports it", () => {
    const config = loadConfig({ GOOGLE_CLOUD_PROJECT: "p", CARLO_GROUNDEDNESS: "1" });
    expect(config.groundedness).toBe(true);
    expect(describeConfig(config)).toContain("groundedness=true");
  });
});
