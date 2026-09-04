/**
 * Test doubles. Gate EXECUTION is hermetic: no live Vertex call, no benchmark run, no network.
 */

import { type CarloConfig, loadConfig } from "../../src/config.ts";
import type {
  Backbone,
  BackboneRequest,
  BackboneResult,
  RawToolDefinition,
  ToolCallRequest,
  Usage,
} from "../../src/types.ts";
import { EMPTY_USAGE } from "../../src/types.ts";

export function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    ...EMPTY_USAGE,
    promptTokens: 100,
    completionTokens: 10,
    totalTokens: 110,
    llmCalls: 1,
    llmMillis: 20,
    ...overrides,
  };
}

export function step(
  text: string | undefined,
  toolCalls: ToolCallRequest[] = [],
  over: Partial<Usage> = {},
): BackboneResult {
  return { text, toolCalls, usage: usage(over) };
}

/** A scripted backbone: returns queued results in order and records every request it received. */
export class MockBackbone implements Backbone {
  readonly requests: BackboneRequest[] = [];
  private readonly queue: BackboneResult[];
  private readonly fallback: BackboneResult;

  constructor(queue: BackboneResult[], fallback: BackboneResult = step("Anything else?")) {
    this.queue = [...queue];
    this.fallback = fallback;
  }

  get calls(): number {
    return this.requests.length;
  }

  async generate(request: BackboneRequest): Promise<BackboneResult> {
    // Snapshot the transcript: the caller owns that array and appends to it after we return, so
    // storing the reference would make later mutations look like they were present at call time.
    this.requests.push({ ...request, transcript: request.transcript.map((e) => ({ ...e })) });
    return this.queue.shift() ?? this.fallback;
  }
}

export function testConfig(overrides: Partial<CarloConfig> = {}): CarloConfig {
  const base = loadConfig({
    GOOGLE_CLOUD_PROJECT: "test-project",
    CARLO_TRACE_DIR: "/tmp/carlo-test-traces",
  });
  return Object.freeze({ ...base, ...overrides });
}

export async function loadTools(file = "tools-info.json"): Promise<RawToolDefinition[]> {
  return (await Bun.file(
    new URL(`../fixtures/${file}`, import.meta.url),
  ).json()) as RawToolDefinition[];
}

export async function loadWiki(): Promise<string> {
  return await Bun.file(new URL("../fixtures/wiki.md", import.meta.url)).text();
}
