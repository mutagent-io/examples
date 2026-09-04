/**
 * Shared turn-level vocabulary for the CARlo core.
 *
 * Implements spec_id: carlo (see .mutagent/specs/carlo/agentspec.yaml).
 *
 * PLAN C2 resolution: the gate pipeline (T8) is coupled to the observability sink (T13) through
 * the `TraceSink` INTERFACE declared here, injected at construction. T8 therefore depends on this
 * module only — never on the concrete JSONL writer — so the planned build order needs no reordering.
 */

/** A raw OpenAI-function-calling tool definition exactly as the evaluator delivers it. */
export interface RawToolDefinition {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** One tool as compiled into the capability inventory. Schema bytes are preserved verbatim. */
export interface ToolEntry {
  name: string;
  description: string;
  /** The RAW JSON Schema object from the evaluator. Never rewritten — passed straight to the model. */
  parameters: Record<string, unknown>;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  /** True when the tool mutates environment state (CAR-bench `set_apis/`-style). */
  stateChanging: boolean;
  /**
   * True when the tool's DESCRIPTION starts with `REQUIRES_CONFIRMATION` — the only channel the
   * bench uses to bind the confirmation policy (POL:004) to concrete tools (diagnosis F2b).
   */
  requiresConfirmation: boolean;
}

export interface Inventory {
  tools: Record<string, ToolEntry>;
  order: string[];
  /** Definitions that could not be parsed; excluded from the inventory but counted. */
  malformed: number;
}

/** A compiled policy obligation attached to the tools it governs. */
export interface PolicyRule {
  id: string;
  text: string;
  appliesToTools: string[];
  /** Tools that must be called BEFORE the governed action. */
  prerequisites: string[];
  /** Tools that must be ordered before the governed action (sequencing, not information). */
  ordering: string[];
  /**
   * The action this rule primarily governs — the first state-changing tool it names. An ordering
   * only binds the PRIMARY action, so a rule that happens to mention another tool (e.g. AUT-POL:010
   * naming both the window defrost and windows) cannot force that tool ahead of an unrelated one.
   */
  primaryTool?: string;
  condition?: string;
}

export interface PolicyChecklist {
  rules: PolicyRule[];
  /**
   * True when the policy text was missing/unparsable. Per sop[ingest-task-frame].onFailure the
   * checklist then stays EMPTY and every capability claim is treated as unverified (fail toward
   * caution, never toward fabrication).
   */
  unverified: boolean;
}

/** A tool call CARlo intends to emit. `arguments` stays ordinary JSON. */
export interface ToolCallRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  id?: string;
  /**
   * Gemini 3.x signs functionCall parts; Vertex validates the signature when the transcript is
   * replayed. Carried when we produced the call ourselves; absent for evaluator-replayed calls
   * (the wire is stateless), which are re-sent with Google's documented placeholder instead.
   */
  thoughtSignature?: string;
}

export type GateName = "feasibility" | "ambiguity" | "policy" | "args" | "escalation";

export type GateVerdict = "pass" | "block" | "repair" | "replan";

export interface GateFinding {
  gate: GateName;
  verdict: GateVerdict;
  code: string;
  detail: string;
  toolName?: string;
  parameter?: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cost: number;
  llmCalls: number;
  llmMillis: number;
}

export const EMPTY_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  thinkingTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  cost: 0,
  llmCalls: 0,
  llmMillis: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    thinkingTokens: a.thinkingTokens + b.thinkingTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: a.cost + b.cost,
    llmCalls: a.llmCalls + b.llmCalls,
    llmMillis: a.llmMillis + b.llmMillis,
  };
}

/** One transcript entry in the benchmark conversation. */
export interface TranscriptEntry {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolCalls?: ToolCallRequest[];
}

export interface TurnInput {
  taskId: string;
  turn: number;
  /** The evaluator's policy wiki (the `System:` text). Never replaced by CARlo's own prompt. */
  systemPrompt: string;
  transcript: TranscriptEntry[];
  toolDefinitions: RawToolDefinition[];
}

export interface TurnDecision {
  text?: string;
  toolCalls: ToolCallRequest[];
  /** Internal inference passes spent on this step (1 = single-pass, 2 = risk-triggered verify). */
  passes: number;
  usage: Usage;
  findings: GateFinding[];
  /** True when this step is the clean close (goal reached, limit acknowledged, or turn cap hit). */
  closed: boolean;
}

/** What the backbone is asked for: one next assistant step. */
export interface BackboneRequest {
  systemInstruction: string;
  transcript: TranscriptEntry[];
  tools: ToolEntry[];
  /** Extra steering appended for a verify/critic pass. */
  critique?: string;
}

export interface BackboneResult {
  text?: string;
  toolCalls: ToolCallRequest[];
  usage: Usage;
}

/** The one sanctioned egress of the decision loop. */
export interface Backbone {
  generate(request: BackboneRequest): Promise<BackboneResult>;
}

/** One observability record. Written before/after every consequential decision. */
export interface TraceLine {
  taskId: string;
  turn: number;
  phase: string;
  ts: string;
  [k: string]: unknown;
}

/**
 * Injected observability sink (C2). The pipeline writes through this interface; a failing sink
 * must never alter or fail the decision path.
 */
export interface TraceSink {
  write(line: TraceLine): void;
}

/** A sink that discards everything — the default when no observability is configured. */
export const NULL_SINK: TraceSink = {
  write(): void {
    /* intentionally empty */
  },
};
