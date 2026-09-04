// @implements escalation-controller
/**
 * Risk-trigger logic: decides when a step earns the second verify/critic backbone pass.
 *
 * sop[risk-triggered-escalation]: "Default budget is one backbone call per step. On a flagged risk,
 * spend exactly ONE additional verify/critic pass over the drafted step before emitting it. This is
 * the cost lever: verification where it pays, single-pass everywhere else." (decision.)
 *
 * The always-verify alternative is a declared eval-loop experiment (spec.intent.unknowns[1]), so it
 * is an env flip (`CARLO_VERIFY_MODE`) rather than a code change.
 */

import type { VerifyMode } from "./config.ts";
import { getTool } from "./inventory.ts";
import type { GateFinding, Inventory, ToolCallRequest } from "./types.ts";

export type RiskReason = "state-change" | "ambiguity" | "capability-doubt";

export interface EscalationDecision {
  /** Extra verify passes to spend on this step. Never more than one (sop: "exactly one"). */
  extraPasses: 0 | 1;
  reasons: RiskReason[];
  mode: VerifyMode;
}

export interface RiskSignals {
  toolCalls: readonly ToolCallRequest[];
  findings: readonly GateFinding[];
  /** Set when the ambiguity gate flagged the turn as underspecified. */
  ambiguityFlagged: boolean;
}

function detectReasons(signals: RiskSignals, inventory: Inventory): RiskReason[] {
  const reasons: RiskReason[] = [];

  const stateChanging = signals.toolCalls.some(
    (call) => getTool(inventory, call.toolName)?.stateChanging === true,
  );
  if (stateChanging) reasons.push("state-change");

  if (signals.ambiguityFlagged || signals.findings.some((f) => f.gate === "ambiguity")) {
    reasons.push("ambiguity");
  }

  const capabilityDoubt = signals.findings.some(
    (f) => f.gate === "feasibility" || f.code === "unknown-tool" || f.code === "unknown-parameter",
  );
  if (capabilityDoubt) reasons.push("capability-doubt");

  return reasons;
}

export function decideEscalation(
  signals: RiskSignals,
  inventory: Inventory,
  mode: VerifyMode = "risk",
): EscalationDecision {
  const reasons = detectReasons(signals, inventory);

  if (mode === "never") return { extraPasses: 0, reasons, mode };
  if (mode === "always") return { extraPasses: 1, reasons, mode };

  // `risk`: exactly one extra pass when ANY risk fired — two risks are still one pass.
  return { extraPasses: reasons.length > 0 ? 1 : 0, reasons, mode };
}

/**
 * Arbitration when the verify pass contradicts the draft.
 * sop[risk-triggered-escalation].onFailure: "prefer the more conservative of the two."
 *
 * Conservative order: no action (text only) < information gathering < state change.
 */
/**
 * `draftEmptiedByGate` marks a draft that a gate STRIPPED this turn. Such a step scores 0 — the
 * safest possible score — so the corpse beat a perfectly good verify re-draft: in the v2 window a
 * verify pass returning [sunshade{100}, sunroof{50}] lost to `chose: "draft"` with an empty list.
 * An emptied draft is not a considered decision and must never win.
 *
 * On a TIE the DRAFT is kept: it already carries this turn's gate corrections (e.g. a policy
 * reorder), and discarding them for an equally risky verify step would undo the gate's work.
 */
export function conservativeChoice<T extends { toolCalls: readonly ToolCallRequest[] }>(
  draft: T,
  verified: T,
  inventory: Inventory,
  draftEmptiedByGate = false,
): T {
  if (draftEmptiedByGate && verified.toolCalls.length > 0) return verified;
  return riskScore(verified, inventory) < riskScore(draft, inventory) ? verified : draft;
}

function riskScore(step: { toolCalls: readonly ToolCallRequest[] }, inventory: Inventory): number {
  if (step.toolCalls.length === 0) return 0;
  return step.toolCalls.some((call) => getTool(inventory, call.toolName)?.stateChanging === true)
    ? 2
    : 1;
}

/**
 * R3d (diagnosis): the verify pass drafting the SAME state-changing tool with DIFFERENT
 * arguments is a disagreement about the VALUE, which `riskScore` cannot see — both steps score
 * identically (a state change is a state change), so `conservativeChoice` silently picked one. In
 * base_6 that is how the verify pass's own `{NONE, off}` invention was emitted.
 *
 * Two drafts that agree on the ACTION but not on the VALUE mean neither is trustworthy: suppress
 * both and ask.
 */
export interface ArgsDisagreement {
  toolName: string;
  parameters: string[];
  draft: Record<string, unknown>;
  verified: Record<string, unknown>;
}

export function argsDisagree(
  draft: { toolCalls: readonly ToolCallRequest[] },
  verified: { toolCalls: readonly ToolCallRequest[] },
  inventory: Inventory,
): ArgsDisagreement | null {
  for (const call of draft.toolCalls) {
    if (getTool(inventory, call.toolName)?.stateChanging !== true) continue;
    const counterpart = verified.toolCalls.find((c) => c.toolName === call.toolName);
    if (!counterpart) continue;

    const keys = new Set([
      ...Object.keys(call.arguments ?? {}),
      ...Object.keys(counterpart.arguments ?? {}),
    ]);
    const parameters = [...keys].filter(
      (key) =>
        JSON.stringify(call.arguments?.[key]) !== JSON.stringify(counterpart.arguments?.[key]),
    );
    if (parameters.length > 0) {
      return {
        toolName: call.toolName,
        parameters,
        draft: call.arguments ?? {},
        verified: counterpart.arguments ?? {},
      };
    }
  }
  return null;
}

/** The clarifying question a draft/verify value disagreement earns. */
export function disagreementQuestion(disagreement: ArgsDisagreement): string {
  const first = disagreement.parameters[0] ?? "value";
  return `I want to get this right before I act — what should the ${first.replace(/_/g, " ")} be?`;
}
