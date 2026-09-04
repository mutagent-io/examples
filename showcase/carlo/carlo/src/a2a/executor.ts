/**
 * A2A turn executor: per-`contextId` conversation state, turn accounting, and `turn_metrics`.
 *
 * G-H (derived from car-bench-ijcai/src/agentbeats/tool_provider.py:72-82, documented nowhere in
 * the guides): the evaluator sends `contextId: null` on the first turn and then REPLAYS whatever
 * `contextId` our response carried. If we never mint and echo one, every turn looks like a fresh
 * conversation and per-task history is lost. So the executor mints on first contact and echoes on
 * every response.
 *
 * `turn_metrics` is attached ONLY to a final response with no tool-call part, aggregating all
 * internal passes of that assistant step (development-guide.md#response-metadata). The evaluator
 * adds `turn_time_ms` itself — we never send it.
 */

import type { GatePipeline } from "../pipeline.ts";
import type { TranscriptEntry, TurnDecision, Usage } from "../types.ts";
import { addUsage, EMPTY_USAGE } from "../types.ts";
import type { InboundTurn, OutboundStep } from "./wire.ts";

interface Conversation {
  transcript: TranscriptEntry[];
  systemPrompt: string;
  tools: unknown[];
  turn: number;
  /** Usage accumulated across passes since the last final (no-tool-call) response. */
  pendingUsage: Usage;
  pendingPasses: number;
  lastToolCalls: { toolName: string; id: string }[];
}

export interface ExecutorOptions {
  pipeline: GatePipeline;
  model: string;
  newId?: () => string;
}

export class A2AExecutor {
  private readonly pipeline: GatePipeline;
  private readonly model: string;
  private readonly newId: () => string;
  private readonly conversations = new Map<string, Conversation>();

  constructor(options: ExecutorOptions) {
    this.pipeline = options.pipeline;
    this.model = options.model;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  public get activeContexts(): number {
    return this.conversations.size;
  }

  /** Drop conversation state — the `cancel` path and the end of a bridge task. */
  public cancel(contextId: string): void {
    this.conversations.delete(contextId);
    this.pipeline.forget(contextId);
  }

  public async handleTurn(
    turn: InboundTurn,
  ): Promise<{ step: OutboundStep; contextId: string; decision: TurnDecision }> {
    // Mint on first contact; echo thereafter (G-H).
    const contextId = turn.contextId ?? this.newId();
    const conversation = this.conversationFor(contextId, turn);

    if (turn.kind === "first" && turn.tools) conversation.tools = turn.tools;
    if (turn.systemPrompt !== null) conversation.systemPrompt = turn.systemPrompt;

    // Fold the inbound turn into the transcript.
    if (turn.toolResults && turn.toolResults.length > 0) {
      for (const result of turn.toolResults) {
        conversation.transcript.push({
          role: "tool",
          content: result.content,
          toolName: result.toolName,
          toolCallId: result.toolCallId,
        });
      }
    } else if (turn.userText !== null) {
      conversation.transcript.push({ role: "user", content: turn.userText });
    }

    const decision = await this.pipeline.decideNextStep({
      taskId: contextId,
      turn: conversation.turn,
      systemPrompt: conversation.systemPrompt,
      transcript: conversation.transcript,
      toolDefinitions: conversation.tools as never[],
    });

    conversation.turn += 1;
    conversation.pendingUsage = addUsage(conversation.pendingUsage, decision.usage);
    conversation.pendingPasses += decision.passes;

    // Record our own step so the next turn replays it as history.
    conversation.transcript.push({
      role: "assistant",
      content: decision.text ?? "",
      toolCalls: decision.toolCalls.length > 0 ? decision.toolCalls : undefined,
    });
    conversation.lastToolCalls = decision.toolCalls.map((call) => ({
      toolName: call.toolName,
      id: call.id ?? this.newId(),
    }));

    const isFinal = decision.toolCalls.length === 0;
    const step: OutboundStep = {
      text: decision.text,
      toolCalls: decision.toolCalls,
      turnMetrics: isFinal ? this.drainMetrics(conversation) : undefined,
    };
    return { step, contextId, decision };
  }

  private conversationFor(contextId: string, turn: InboundTurn): Conversation {
    const existing = this.conversations.get(contextId);
    if (existing && turn.kind !== "first") return existing;
    if (existing && turn.kind === "first" && existing.transcript.length > 0) {
      // A `first` frame on a live context means the evaluator restarted the task on this id.
      this.conversations.delete(contextId);
      this.pipeline.forget(contextId);
    } else if (existing) {
      return existing;
    }

    const fresh: Conversation = {
      transcript: [],
      systemPrompt: "",
      tools: [],
      turn: 0,
      pendingUsage: EMPTY_USAGE,
      pendingPasses: 0,
      lastToolCalls: [],
    };
    this.conversations.set(contextId, fresh);
    return fresh;
  }

  /** Aggregate and reset the metrics for the assistant step that is now complete. */
  private drainMetrics(conversation: Conversation): Record<string, unknown> {
    const usage = conversation.pendingUsage;
    const passes = conversation.pendingPasses;
    const metrics = {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      cost: usage.cost,
      model: this.model,
      thinking_tokens: usage.thinkingTokens,
      num_llm_calls: usage.llmCalls,
      avg_llm_call_time_ms:
        usage.llmCalls > 0 ? Math.round((usage.llmMillis / usage.llmCalls) * 10) / 10 : 0,
      num_passes: Math.max(1, passes),
    };
    conversation.pendingUsage = EMPTY_USAGE;
    conversation.pendingPasses = 0;
    return metrics;
  }
}
