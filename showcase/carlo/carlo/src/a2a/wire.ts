/**
 * A2A 1.0 wire codec — strict, dependency-free (architect RULING 1).
 *
 * The evaluator's agent-under-test path is NOT SDK-mediated. Read from
 * car-bench-ijcai/src/agentbeats/tool_provider.py::talk_to_agent_with_parts_sync ->
 * src/agentbeats/sync_client.py::send_message_with_parts_sync, it is a plain httpx POST:
 *
 *   headers: Content-Type: application/a2a+json, A2A-Version: 1.0
 *   body:    {"jsonrpc":"2.0","id":"<hex>","method":"SendMessage",
 *             "params":{"message": MessageToDict(<a2a.v1.Message>)}}
 *   reply:   {"result":{"message": <a2a.v1.Message JSON>}}
 *
 * The reply is parsed with `ParseDict(..., Message())` and NO `ignore_unknown_fields`, so a single
 * stray or mis-cased field is a hard ParseError that kills the run. Hence the ENCODER BELOW IS AN
 * ALLOWLIST, and its field names are taken verbatim from the pinned proto crawl:
 *
 *   a2aproject/A2A `specification/a2a.proto` (crawled 2026-08-24)
 *     message Message { string message_id = 1 [REQUIRED]; string context_id = 2; string task_id = 3;
 *                       Role role = 4 [REQUIRED]; repeated Part parts = 5 [REQUIRED];
 *                       google.protobuf.Struct metadata = 6; repeated string extensions = 7;
 *                       repeated string reference_task_ids = 8; }
 *     message Part { oneof content { string text = 1; bytes raw = 2; string url = 3;
 *                    google.protobuf.Value data = 4; }
 *                    google.protobuf.Struct metadata = 5; string filename = 6; string media_type = 7; }
 *     enum Role { ROLE_UNSPECIFIED = 0; ROLE_USER = 1; ROLE_AGENT = 2; }
 *
 * protobuf JSON mapping ⇒ lowerCamelCase field names and enum NAMES for `role`.
 */

import type { ToolCallRequest } from "../types.ts";

export const A2A_METHOD = "SendMessage";
export const A2A_VERSION = "1.0";
export const A2A_CONTENT_TYPE = "application/a2a+json";
/** a2a-python/src/a2a/utils/constants.py: AGENT_CARD_WELL_KNOWN_PATH / DEFAULT_RPC_URL. */
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";
export const RPC_PATH = "/";

/** The complete set of `a2a.v1.Message` JSON keys we are permitted to emit. */
export const MESSAGE_FIELD_ALLOWLIST = [
  "messageId",
  "contextId",
  "taskId",
  "role",
  "parts",
  "metadata",
  "extensions",
  "referenceTaskIds",
] as const;

/** The complete set of `a2a.v1.Part` JSON keys we are permitted to emit. */
export const PART_FIELD_ALLOWLIST = [
  "text",
  "raw",
  "url",
  "data",
  "metadata",
  "filename",
  "mediaType",
] as const;

export type Json = Record<string, unknown>;

export interface InboundToolResult {
  toolName: string;
  toolCallId: string;
  content: string;
}

export type InboundKind = "first" | "tool-results" | "user";

export interface InboundTurn {
  kind: InboundKind;
  contextId: string | null;
  taskId: string | null;
  messageId: string | null;
  /** Present on the first turn: the evaluator's `System:` policy wiki. */
  systemPrompt: string | null;
  /** The simulated driver's utterance, when this turn carries one. */
  userText: string | null;
  /** Raw OpenAI-format tool definitions from the first-turn data Part. */
  tools: unknown[] | null;
  toolResults: InboundToolResult[] | null;
  /** Advisory `{"source": "user"|"environment"}` tag (development-guide.md). */
  source: string | null;
}

export class WireError extends Error {
  constructor(
    message: string,
    readonly code = -32600,
  ) {
    super(message);
    this.name = "WireError";
  }
}

function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Split the first-turn `"System: <wiki>\n\nUser: <request>"` text part. */
export function splitSystemUser(text: string): { systemPrompt: string | null; userText: string } {
  const marker = "\n\nUser:";
  if (text.startsWith("System:") && text.includes(marker)) {
    const index = text.indexOf(marker);
    return {
      systemPrompt: text.slice("System:".length, index).trim(),
      userText: text.slice(index + marker.length).trim(),
    };
  }
  return { systemPrompt: null, userText: text };
}

/** Decode a JSON-RPC `SendMessage` envelope into a turn. Throws `WireError` on a malformed frame. */
export function decodeRequest(body: unknown): { rpcId: unknown; turn: InboundTurn } {
  const envelope = asRecord(body);
  if (!envelope) throw new WireError("request body is not a JSON object", -32700);

  const method = envelope.method;
  if (method !== A2A_METHOD) {
    throw new WireError(`unsupported method ${JSON.stringify(method)}`, -32601);
  }

  const params = asRecord(envelope.params);
  const message = asRecord(params?.message);
  if (!message) throw new WireError("params.message is missing", -32602);

  const parts = Array.isArray(message.parts) ? message.parts : [];
  const metadata = asRecord(message.metadata);

  let systemPrompt: string | null = null;
  let userText: string | null = null;
  let tools: unknown[] | null = null;
  let toolResults: InboundToolResult[] | null = null;

  for (const rawPart of parts) {
    const part = asRecord(rawPart);
    if (!part) continue;

    if (typeof part.text === "string") {
      const split = splitSystemUser(part.text);
      if (split.systemPrompt !== null) systemPrompt = split.systemPrompt;
      userText = split.userText;
      continue;
    }

    const data = asRecord(part.data);
    if (!data) continue;

    if (Array.isArray(data.tools)) {
      tools = data.tools;
      continue;
    }
    if (Array.isArray(data.tool_results)) {
      toolResults = data.tool_results.flatMap((entry) => {
        const record = asRecord(entry);
        if (!record) return [];
        return [
          {
            // Accept both snake_case (documented) and camelCase (protobuf-mapped) spellings.
            toolName: str(record.tool_name) ?? str(record.toolName) ?? "",
            toolCallId: str(record.tool_call_id) ?? str(record.toolCallId) ?? "",
            content: typeof record.content === "string" ? record.content : "",
          },
        ];
      });
    }
  }

  // The evaluator substitutes whitespace-only messages with "none" before sending.
  if (userText !== null && userText.trim() === "") userText = "none";

  const kind: InboundKind =
    tools !== null || systemPrompt !== null
      ? "first"
      : toolResults !== null
        ? "tool-results"
        : "user";

  return {
    rpcId: envelope.id,
    turn: {
      kind,
      contextId: str(message.contextId),
      taskId: str(message.taskId),
      messageId: str(message.messageId),
      systemPrompt,
      userText,
      tools,
      toolResults,
      source: str(metadata?.source),
    },
  };
}

export interface OutboundStep {
  text?: string | undefined;
  toolCalls: readonly ToolCallRequest[];
  reasoning?: string | undefined;
  /** Attached ONLY on a final response that carries no tool calls (development-guide.md). */
  turnMetrics?: Record<string, unknown> | undefined;
}

/**
 * Encode an agent Message. Emits ONLY allowlisted fields; `role` is the enum NAME.
 * Tool calls go in a data Part as `{"tool_calls":[{"tool_name","arguments"}]}` — the shape the
 * evaluator parses (car-bench-ijcai/src/tool_call_types.py::ToolCallsData).
 */
export function encodeMessage(step: OutboundStep, contextId: string, messageId: string): Json {
  const parts: Json[] = [];

  if (typeof step.text === "string" && step.text !== "") {
    parts.push({ text: step.text });
  }
  if (step.toolCalls.length > 0) {
    parts.push({
      data: {
        tool_calls: step.toolCalls.map((call) => ({
          tool_name: call.toolName,
          arguments: call.arguments,
        })),
      },
    });
  }
  if (typeof step.reasoning === "string" && step.reasoning !== "") {
    parts.push({ data: { reasoning_content: step.reasoning } });
  }
  if (parts.length === 0) {
    parts.push({ text: "" });
  }

  const message: Json = {
    messageId,
    contextId,
    role: "ROLE_AGENT",
    parts,
  };
  if (step.turnMetrics) {
    message.metadata = { turn_metrics: step.turnMetrics };
  }
  return message;
}

export function encodeResult(message: Json, rpcId: unknown): Json {
  return { jsonrpc: "2.0", id: rpcId ?? null, result: { message } };
}

export function encodeError(error: unknown, rpcId: unknown): Json {
  const wire = error instanceof WireError ? error : null;
  return {
    jsonrpc: "2.0",
    id: rpcId ?? null,
    error: {
      code: wire?.code ?? -32603,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

/**
 * Self-check used by the negative contract test (RULING 1): assert an encoded Message carries only
 * allowlisted keys, so a polluted response is caught here as well as by the real Python ParseDict.
 */
export function assertAllowlisted(message: Json): void {
  const allowed = new Set<string>(MESSAGE_FIELD_ALLOWLIST);
  for (const key of Object.keys(message)) {
    if (!allowed.has(key)) {
      throw new WireError(`Message field "${key}" is not in the a2a.v1.Message allowlist`);
    }
  }
  const partAllowed = new Set<string>(PART_FIELD_ALLOWLIST);
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (const rawPart of parts) {
    const part = asRecord(rawPart);
    if (!part) throw new WireError("part is not an object");
    for (const key of Object.keys(part)) {
      if (!partAllowed.has(key)) {
        throw new WireError(`Part field "${key}" is not in the a2a.v1.Part allowlist`);
      }
    }
  }
  if (message.role !== "ROLE_AGENT") {
    throw new WireError(`role must be "ROLE_AGENT", got ${JSON.stringify(message.role)}`);
  }
}
