/**
 * Env-var-only configuration.
 *
 * Competition rule (car-bench-ijcai/README.md#submission-instructions): "All LLM model names,
 * provider routes, deployment names, API bases, service tiers, and reasoning-effort selectors must
 * be configurable through environment variables." No secret is ever baked into the image.
 */

export type VerifyMode = "risk" | "always" | "never";

export interface CarloConfig {
  model: string;
  temperature: number;
  thinkingBudget: number;
  /**
   * `CARLO_THINKING_LEVEL` — the Gemini-3 reasoning-effort selector (`MINIMAL|LOW|MEDIUM|HIGH`).
   * Empty means "derive it from `thinkingBudget`" (a negative budget = HIGH); set, it always wins.
   * Kept as its own env var because the competition requires every reasoning-effort selector to be
   * environment-configurable (README#submission-instructions).
   */
  thinkingLevel: string;
  project: string;
  location: string;
  useVertex: boolean;
  maxTurns: number;
  verifyMode: VerifyMode;
  /**
 * R3b/R3d argument-groundedness gate (diagnosis). OFF by default: it suppresses acting drafts,
   * so its win/loss ratio must be MEASURED on the smoke slice before it can become the default.
   */
  groundedness: boolean;
  /**
   * CARLO_MINIMAL — the ④ DIAGNOSE ablation (diagnosis.md §Disposition). OFF by default: it is an
   * A/B arm, not a new default. ON, the six-gate chain collapses to draft + live-schema validation
   * with in-turn retry, and the general behavior block + HIGH thinking come on.
   */
  minimal: boolean;
  traceDir: string;
  host: string;
  port: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Env = Record<string, string | undefined>;

function str(env: Env, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw.trim() === "" ? fallback : raw.trim();
}

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`${key} must be a finite number, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/**
 * `gemini-3.5-flash` resolved ONLY at location `global` on the probed project (404 at us-central1
 * and us-east5) — verified live 2026-08-24, recorded as PLAN gap G-D. A wrong region otherwise
 * surfaces only as a runtime 404, so `global` is the default and the resolved value is logged.
 */
export const DEFAULT_LOCATION = "global";
export const DEFAULT_MODEL = "gemini-3.5-flash";

/**
 * HIGH reasoning effort for minimal mode, carried as a NEGATIVE budget SENTINEL. It is translated
 * at the wire into the pinned model's actual selector — `thinkingConfig.thinkingLevel: "HIGH"` —
 * by `thinkingConfigFor` (backbone/vertex.ts): gemini-3.5-flash is a Gemini 3 model, and per the
 * Vertex thinking docs those take `thinking_level`, while `thinking_budget` is the pre-Gemini-3
 * parameter and specifying BOTH in one request returns an error. `-1` therefore never goes out on
 * the wire; it only means "as much thinking as the task needs". Thylinao measured high effort as the stabiliser
 * for multi-step disambiguation at only 2.4-11.2% of episode tokens; CARlo ran 0 and lost that
 * family worst (diagnosis.md §Convergent external evidence).
 */
export const MINIMAL_THINKING_BUDGET = -1;

/** Spec `agent.workflow.inline.loop.maxIterations` = 50 (decision, matching max_steps=50). */
export const DEFAULT_MAX_TURNS = 50;

export function loadConfig(env: Env = process.env): CarloConfig {
  const verifyRaw = str(env, "CARLO_VERIFY_MODE", "risk");
  if (verifyRaw !== "risk" && verifyRaw !== "always" && verifyRaw !== "never") {
    throw new ConfigError(
      `CARLO_VERIFY_MODE must be one of risk|always|never, got ${JSON.stringify(verifyRaw)}`,
    );
  }

  // Legacy `vertexai` and current `enterprise` spellings are both accepted (PLAN gap G-1); the
  // flag is passed to the SDK explicitly rather than relying on undocumented env auto-pickup.
  const useVertex =
    bool(env, "GOOGLE_GENAI_USE_VERTEXAI", false) ||
    bool(env, "GOOGLE_GENAI_USE_ENTERPRISE", false) ||
    true;

  // The thinking DEFAULT is mode-dependent (0 default / dynamic-high minimal); an explicit
  // CARLO_THINKING_BUDGET always wins, so the competition's "every selector is env-configurable"
  // rule still holds in both modes.
  const minimal = bool(env, "CARLO_MINIMAL", false);

  const config: CarloConfig = {
    model: str(env, "CARLO_MODEL", DEFAULT_MODEL),
    temperature: num(env, "CARLO_TEMPERATURE", 0),
    thinkingBudget: num(env, "CARLO_THINKING_BUDGET", minimal ? MINIMAL_THINKING_BUDGET : 0),
    thinkingLevel: str(env, "CARLO_THINKING_LEVEL", ""),
    project: str(env, "GOOGLE_CLOUD_PROJECT", ""),
    location: str(env, "GOOGLE_CLOUD_LOCATION", DEFAULT_LOCATION),
    useVertex,
    maxTurns: num(env, "CARLO_MAX_TURNS", DEFAULT_MAX_TURNS),
    verifyMode: verifyRaw,
    groundedness: bool(env, "CARLO_GROUNDEDNESS", false),
    minimal,
    traceDir: str(env, "CARLO_TRACE_DIR", "traces"),
    host: str(env, "HOST", "127.0.0.1"),
    port: num(env, "PORT", 8080),
  };

  if (config.maxTurns < 1) {
    throw new ConfigError(`CARLO_MAX_TURNS must be >= 1, got ${config.maxTurns}`);
  }
  return Object.freeze(config);
}

/**
 * Credentials are required only for a LIVE run; unit gates run against a mocked backbone. Called
 * by the server entrypoint so a misconfiguration fails loudly at startup instead of mid-benchmark.
 */
export function assertLiveReady(config: CarloConfig): void {
  if (!config.project) {
    throw new ConfigError(
      "GOOGLE_CLOUD_PROJECT is required for a live run (set it in the environment; never bake it into the image)",
    );
  }
}

/** Startup banner — surfaces model+location, the pair that silently 404s when mismatched. */
export function describeConfig(config: CarloConfig): string {
  return [
    `model=${config.model}`,
    `location=${config.location}`,
    `project=${config.project || "<unset>"}`,
    `temperature=${config.temperature}`,
    `thinkingBudget=${config.thinkingBudget}`,
    `thinkingLevel=${config.thinkingLevel || "<derived>"}`,
    `maxTurns=${config.maxTurns}`,
    `verifyMode=${config.verifyMode}`,
    `groundedness=${config.groundedness}`,
    `minimal=${config.minimal}`,
  ].join(" ");
}
