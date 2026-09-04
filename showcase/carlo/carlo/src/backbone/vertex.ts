// @implements vertex-client
/**
 * Thin @google/genai Vertex AI client wrapper — temperature 0, retries, token accounting for the
 * cost-per-task metric.
 *
 * Verified live against the real service on 2026-08-24 (PLAN probes P2/P4/P5/P6):
 *   - `new GoogleGenAI({vertexai: true, project, location})` constructs and authenticates via ADC
 *     under bun (`vertexai` is the legacy alias of `enterprise`; js-genai docs).
 *   - `gemini-3.5-flash` resolves ONLY at location `global` on the probed project (gap G-D).
 *   - `thinkingConfig.thinkingBudget = 0` is accepted and returns `thoughtsTokenCount: 0`; leaving
 *     it unset spent 183 thought-tokens / 257 total on a trivial turn versus 74 (gap G-E). Thinking
 *     is therefore disabled EXPLICITLY: the spec treats variance as a defect and caps cost.
 *   - `parametersJsonSchema` carries a raw OpenAI-style schema (incl. `enum`) through untouched and
 *     `automaticFunctionCalling: {disable: true}` yields `response.functionCalls` — the exact
 *     `{name, args, id}` shape the A2A renderer needs.
 *
 * MODEL INTENT IS SACRED : if the pinned model cannot be served this THROWS. There is no
 * fallback model anywhere in this file.
 */

import { GoogleGenAI } from "@google/genai";
import type { CarloConfig } from "../config.ts";
import type { Backbone, BackboneRequest, BackboneResult, ToolEntry, Usage } from "../types.ts";
import { EMPTY_USAGE } from "../types.ts";

export class BackboneError extends Error {
  constructor(
    message: string,
    readonly model: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BackboneError";
  }
}

/** Minimal structural view of the SDK surface we use — lets tests inject a double. */
export interface GenAiLike {
  models: {
    generateContent(request: Record<string, unknown>): Promise<GenerateContentLike>;
  };
}

export interface GenerateContentLike {
  text?: string;
  functionCalls?: Array<{ name?: string; args?: Record<string, unknown>; id?: string }>;
  /** Raw candidate parts — the only place the SDK exposes per-part `thoughtSignature`. */
  candidates?: Array<{
    content?: {
      parts?: Array<{
        functionCall?: { name?: string; args?: Record<string, unknown>; id?: string };
        thoughtSignature?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Google's documented placeholder signature for functionCall parts injected from a transcript the
 * model did not sign itself (docs: "Function calling with thought signatures").
 */
export const REPLAYED_CALL_SIGNATURE = "context_engineering_is_the_way_to_go";

/**
 * Map the shared transcript onto Gemini `contents`. Pure — unit-tested without the SDK.
 *
 * PARALLEL-CALL BATCHING (diagnosis). A model turn carrying k functionCall parts MUST be
 * answered by a SINGLE user turn carrying exactly k functionResponse parts. Consecutive `tool`
 * entries are therefore BUFFERED and flushed as ONE user content — on the next non-tool entry, at
 * the end of the transcript, and before the critique. Replaying each result as its own user turn is
 * a deterministic 400 that permanently poisons the transcript. k=1 is byte-identical to the old
 * shape, so this batching carries no regression risk.
 *
 * Both sides stay ID-FREE: matching is positional + by name, exactly as the model emitted it.
 */
export function buildContents(request: BackboneRequest): Array<Record<string, unknown>> {
  const contents: Array<Record<string, unknown>> = [];
  let pendingResponses: Array<Record<string, unknown>> = [];

  const flushResponses = (): void => {
    if (pendingResponses.length === 0) return;
    contents.push({ role: "user", parts: pendingResponses });
    pendingResponses = [];
  };

  for (const entry of request.transcript) {
    if (entry.role === "user") {
      flushResponses();
      contents.push({ role: "user", parts: [{ text: entry.content }] });
      continue;
    }
    if (entry.role === "assistant") {
      flushResponses();
      const parts: Array<Record<string, unknown>> = [];
      if (entry.content) parts.push({ text: entry.content });
      for (const call of entry.toolCalls ?? []) {
        // Gemini 3.x validates thought signatures on replayed functionCall parts. Echo the real
        // signature when we captured one; otherwise use Google's documented placeholder for
        // externally-replayed calls (the evaluator wire is stateless and strips signatures).
        parts.push({
          functionCall: { name: call.toolName, args: call.arguments },
          thoughtSignature: call.thoughtSignature ?? REPLAYED_CALL_SIGNATURE,
        });
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }
    // Tool results are replayed as functionResponse parts — buffered, never emitted one turn each.
    pendingResponses.push({
      functionResponse: {
        name: entry.toolName ?? "",
        response: { result: entry.content },
      },
    });
  }

  flushResponses();

  if (request.critique) {
    contents.push({ role: "user", parts: [{ text: request.critique }] });
  }
  return contents;
}

/**
 * The reasoning-effort selector, in the shape the PINNED model's API actually takes.
 *
 * Crawled fresh at build time (cloud.google.com/vertex-ai/generative-ai/docs/thinking, 2026-08-26):
 * Gemini 3 and later — `gemini-3.5-flash` included — take `thinkingConfig.thinkingLevel`
 * (`MINIMAL | LOW | MEDIUM | HIGH`; the documented per-model default for 3.5 Flash is `MEDIUM`).
 * `thinkingBudget` is the pre-Gemini-3 spelling, and **"if you specify both thinking_level and
 * thinking_budget in the same request for a Gemini 3 model, the model returns an error"** — so
 * exactly ONE key is ever emitted.
 *
 * The config carries the effort as a NUMBER (`thinkingBudget`, so `CARLO_THINKING_BUDGET` keeps
 * working and P5's live-verified `0` is untouched). A NEGATIVE budget is the "let the model think
 * as much as it needs" sentinel — `MINIMAL_THINKING_BUDGET` — and that is what minimal mode wants,
 * so it is translated here into the documented HIGH level rather than sent as `-1`. An explicit
 * `CARLO_THINKING_LEVEL` always wins (competition rule: every reasoning-effort selector must be
 * env-configurable).
 */
export const THINKING_LEVEL_HIGH = "HIGH";

export function thinkingConfigFor(config: CarloConfig): Record<string, unknown> {
  const explicit = config.thinkingLevel.trim();
  if (explicit !== "") return { thinkingLevel: explicit.toUpperCase() };
  if (config.thinkingBudget < 0) return { thinkingLevel: THINKING_LEVEL_HIGH };
  return { thinkingBudget: config.thinkingBudget };
}

/**
 * Build the `generateContent` request. Tool schemas are passed through by reference as
 * `parametersJsonSchema` so the declared names/structure reach the model — and come back to the
 * evaluator — byte-identical (agent-under-test-harnessing.md#important-design-rules).
 */
export function buildRequest(
  request: BackboneRequest,
  config: CarloConfig,
): Record<string, unknown> {
  const functionDeclarations = request.tools.map((tool: ToolEntry) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  }));

  const generationConfig: Record<string, unknown> = {
    systemInstruction: request.systemInstruction,
    temperature: config.temperature,
    automaticFunctionCalling: { disable: true },
    thinkingConfig: thinkingConfigFor(config),
  };
  if (functionDeclarations.length > 0) {
    generationConfig.tools = [{ functionDeclarations }];
  }

  return {
    model: config.model,
    contents: buildContents(request),
    config: generationConfig,
  };
}

/** Undefined-safe usage mapping — a real response omitted `candidatesTokenCount` entirely (P4). */
export function mapUsage(response: GenerateContentLike, millis: number, calls = 1): Usage {
  const u = response.usageMetadata ?? {};
  return {
    promptTokens: u.promptTokenCount ?? 0,
    completionTokens: u.candidatesTokenCount ?? 0,
    thinkingTokens: u.thoughtsTokenCount ?? 0,
    cachedTokens: u.cachedContentTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
    // Vertex does not return a per-call price; cost is derived downstream from token counts.
    cost: 0,
    llmCalls: calls,
    llmMillis: millis,
  };
}

export function mapResult(response: GenerateContentLike, usage: Usage): BackboneResult {
  // Prefer raw candidate parts: the SDK's `functionCalls` getter strips `thoughtSignature`,
  // which Gemini 3.x requires us to echo back on replay.
  const signedParts = (response.candidates?.[0]?.content?.parts ?? []).filter(
    (part) => typeof part.functionCall?.name === "string" && part.functionCall.name !== "",
  );
  const toolCalls = signedParts.length
    ? signedParts.map((part) => ({
        toolName: part.functionCall?.name as string,
        arguments: part.functionCall?.args ?? {},
        id: part.functionCall?.id,
        thoughtSignature: part.thoughtSignature,
      }))
    : (response.functionCalls ?? [])
        .filter((call) => typeof call.name === "string" && call.name !== "")
        .map((call) => ({
          toolName: call.name as string,
          arguments: call.args ?? {},
          id: call.id,
        }));
  const text =
    typeof response.text === "string" && response.text !== "" ? response.text : undefined;
  return { text, toolCalls, usage };
}

/**
 * Transient-failure vocabulary (④ DIAGNOSE root cause #6: four full-train trials were eaten as 0.0
 * by backbone timeouts that never got a second attempt).
 *
 * The original pattern was too narrow to catch how the failure actually ARRIVES. A dead socket
 * under bun/undici surfaces as `Error: fetch failed` whose CAUSE carries the code (`ETIMEDOUT`,
 * `UND_ERR_SOCKET`) — `\btimeout\b` never matches `ETIMEDOUT`, so those turns died on attempt 1.
 * The matcher now (a) covers the socket/abort/5xx vocabulary and (b) walks the `cause` chain and
 * the `code`/`errno`/`status` properties, not just the top-level message.
 *
 * Still deliberately conservative: a 404 (wrong model/region) or a 400 (bad request) is a
 * DETERMINISTIC failure and must fail fast — retrying it burns budget and hides the misconfiguration.
 */
const RETRYABLE =
  /\b(408|409|429|500|502|503|504|deadline|deadline_exceeded|timeout|timed\s?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|EAI_AGAIN|ENETUNREACH|ENETRESET|EHOSTUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|socket\s+hang\s+up|fetch\s+failed|network\s+error|terminated|aborted|unavailable|overloaded|internal\s+error|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED)\b/i;

/**
 * True when an error (or anything in its `cause` chain) reports a transient condition. The chain
 * walk is what makes `fetch failed -> cause: {code: "ETIMEDOUT"}` retryable.
 */
export function isRetryable(error: unknown, depth = 0): boolean {
  if (error === null || error === undefined || depth > 5) return false;
  if (typeof error === "string") return RETRYABLE.test(error);
  if (typeof error !== "object") return false;

  const record = error as Record<string, unknown> & { cause?: unknown };
  for (const key of ["message", "code", "errno", "status", "statusText", "name"]) {
    const value = record[key];
    if ((typeof value === "string" || typeof value === "number") && RETRYABLE.test(String(value))) {
      return true;
    }
  }
  return isRetryable(record.cause, depth + 1);
}

/** Minimal-mode retry backoff: 2s, then 8s (root cause #6 was TIMEOUTS, not rate limits). */
export const MINIMAL_RETRY_BASE_MILLIS = 2_000;
export const MINIMAL_RETRY_FACTOR = 4;

export interface VertexBackboneOptions {
  config: CarloConfig;
  client?: GenAiLike;
  /** Total attempts: 1 draft + 2 retries. A transient backbone failure must never cost the turn. */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class VertexBackbone implements Backbone {
  private readonly config: CarloConfig;
  private readonly client: GenAiLike;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: VertexBackboneOptions) {
    this.config = options.config;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.client =
      options.client ??
      (new GoogleGenAI({
        vertexai: this.config.useVertex,
        project: this.config.project,
        location: this.config.location,
      }) as unknown as GenAiLike);
  }

  /**
   * Backoff between attempts. DEFAULT mode keeps the original 250ms/500ms ladder byte-for-byte.
   * MINIMAL mode waits 2s then 8s: the four trials this retry exists for died to backbone
   * TIMEOUTS (diagnosis root cause #6), and a service that just timed out needs seconds to
   * recover, not milliseconds. Still bounded — 10s of waiting, worst case, per turn.
   */
  private backoffMillis(attempt: number): number {
    return this.config.minimal
      ? MINIMAL_RETRY_BASE_MILLIS * MINIMAL_RETRY_FACTOR ** (attempt - 1)
      : 250 * 2 ** (attempt - 1);
  }

  async generate(request: BackboneRequest): Promise<BackboneResult> {
    const payload = buildRequest(request, this.config);
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const started = Date.now();
      try {
        const response = await this.client.models.generateContent(payload);
        return mapResult(response, mapUsage(response, Date.now() - started, attempt));
      } catch (error) {
        lastError = error;
        if (attempt === this.maxAttempts || !isRetryable(error)) break;
        await this.sleep(this.backoffMillis(attempt));
      }
    }

 // No silent re-target: the pinned model is named in the failure.
    throw new BackboneError(
      `backbone call failed for model "${this.config.model}" at location "${this.config.location}": ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      this.config.model,
      lastError,
    );
  }
}

export const ZERO_USAGE = EMPTY_USAGE;
