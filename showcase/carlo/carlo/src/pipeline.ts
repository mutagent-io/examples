// @implements gate-pipeline
/**
 * The deterministic per-turn pipeline ordering the four gates (feasibility, ambiguity,
 * policy-precheck, arg-selfcheck) around the backbone draft call, plus the risk-triggered verify
 * pass — spec.agent.workflow.inline:
 *
 *   ingest (once per task) -> feasibility -> ambiguity -> DRAFT (one backbone call)
 *   -> policy pre-check -> arg self-check -> risk-triggered verify -> emit
 *
 * The loop is bounded at `maxTurns` (spec maxIterations = 50, decision) and its overflow exit
 * is a CLEAN CLOSE, never a throw and never silence (sop[close-cleanly].onFailure).
 *
 * Transport-agnostic by construction: the A2A server (primary) and the Python bridge both call
 * `decideNextStep`. Observability is an INJECTED `TraceSink` (PLAN C2) so this module never depends
 * on the concrete JSONL writer.
 */

import type { CarloConfig } from "./config.ts";
import {
  argsDisagree,
  conservativeChoice,
  decideEscalation,
  disagreementQuestion,
} from "./escalation.ts";
import { buildInventory, getTool, inventoryDigest, listTools } from "./inventory.ts";
import {
  compilePolicy,
  confirmationRulesForTool,
  mentionsTool,
  orderingFor,
  prerequisitesFor,
} from "./policy.ts";
import { composeSystemInstruction } from "./prompts.ts";
import type {
  Backbone,
  BackboneResult,
  GateFinding,
  Inventory,
  PolicyChecklist,
  ToolCallRequest,
  ToolEntry,
  TraceSink,
  TranscriptEntry,
  TurnDecision,
  TurnInput,
  Usage,
} from "./types.ts";
import { addUsage, EMPTY_USAGE, NULL_SINK } from "./types.ts";
import {
  checkFieldParity,
  checkGroundedness,
  type GroundednessFinding,
  groundednessQuestion,
  hasCapabilityAbsence,
  isCapabilityAbsence,
  proseFeasibility,
  toGateFindings,
  userNamedAbsentCapabilities,
  type ValidationFinding,
  type ValidationResult,
  validateCall,
} from "./validator.ts";

/**
 * The apology of last resort — ONLY for a turn where nothing could be drafted and no gate
 * interfered. When a gate emptied the step, `CLARIFY_FALLBACK` is used instead: the request is
 * still in scope, so refusing it is both untrue and scored as OUT_OF_SCOPE by the user simulator.
 */
export const CANNED_FALLBACK = "Sorry, I can't complete that right now.";
export const CLARIFY_FALLBACK =
  "Just to make sure I get this right — what would you like me to do?";

/**
 * CARLO_MINIMAL retry budget: sequential model calls per action decision, INCLUDING the first
 * draft. Thylinao's live-schema guard uses 4 (thylinao-report.md §The recipe #2); on the held-out
 * set every one of their 14 parameter-schema violations was resolved inside that budget. After it
 * is exhausted the still-invalid calls are STRIPPED — never dispatched, never rewritten into an
 * available tool (competition boundary C1).
 */
export const MINIMAL_CALL_BUDGET = 4;

/** Tools whose results can resolve ambiguity internally, in priority order (wiki: disambiguation). */
const INTERNAL_RESOLUTION_HINTS = [
  "get_user_preferences",
  "get_entries_from_calendar",
  "get_contact_information",
  "get_contact_id_by_contact_name",
];

export interface PipelineOptions {
  backbone: Backbone;
  config: CarloConfig;
  sink?: TraceSink;
}

/**
 * What the policy pre-check decided. `reorder` preserves the draft (arguments AND text); `schedule`
 * inserts a complete parameterless call; `redraft` asks the backbone for the missing prerequisite
 * rather than inventing arguments for it.
 */
type PolicyRedirect =
  | { kind: "reorder"; calls: ToolCallRequest[]; finding: GateFinding }
  | { kind: "schedule"; call: ToolCallRequest; finding: GateFinding }
  | { kind: "redraft"; prerequisite: string; action: string; finding: GateFinding };

interface TaskFrame {
  inventory: Inventory;
  checklist: PolicyChecklist;
  toolDigest: string;
}

export class GatePipeline {
  private readonly backbone: Backbone;
  private readonly config: CarloConfig;
  private readonly sink: TraceSink;
  private readonly frames = new Map<string, TaskFrame>();
  /** Gate order actually executed on the most recent turn — asserted by tests. */
  public lastGateOrder: string[] = [];

  constructor(options: PipelineOptions) {
    this.backbone = options.backbone;
    this.config = options.config;
    this.sink = options.sink ?? NULL_SINK;
  }

  /** Drop per-task state (called on A2A `cancel` and when a bridge task ends). */
  public forget(taskId: string): void {
    this.frames.delete(taskId);
  }

  private trace(taskId: string, turn: number, phase: string, data: Record<string, unknown>): void {
    try {
      this.sink.write({ taskId, turn, phase, ts: new Date().toISOString(), ...data });
    } catch {
      // A failing sink must never alter or fail the decision path.
    }
  }

  /** ingest — compile policy + inventory once per task (sop[ingest-task-frame]). */
  private frameFor(input: TurnInput): TaskFrame {
    const digest = inventoryDigest(buildInventory(input.toolDefinitions));
    const existing = this.frames.get(input.taskId);
    // The tool surface is static within a task; a changed digest means a new task frame.
    if (existing && existing.toolDigest === digest) return existing;

    const inventory = buildInventory(input.toolDefinitions);
    const checklist = compilePolicy(input.systemPrompt, inventory);
    const frame: TaskFrame = { inventory, checklist, toolDigest: digest };
    this.frames.set(input.taskId, frame);

    this.trace(input.taskId, input.turn, "ingest", {
      tools: inventory.order.length,
      malformedToolDefs: inventory.malformed,
      policyRules: checklist.rules.length,
      policyUnverified: checklist.unverified,
      inventoryDigest: digest,
      // ARM ATTRIBUTION: the A/B is decided off these traces, and a run whose arm has to be
      // inferred from which gate lines are missing is a run that will be misattributed. The flag
      // is written ONLY when it is on, so a default-arm trace stays byte-identical to the corpus
      // already collected (train-2026-08-25) and stays diff-able against it.
      ...(this.config.minimal ? { minimal: true } : {}),
    });

 // FAIL LOUD (diagnosis /R2e): policy text was DELIVERED but compiled to nothing. That is a
    // silently inert policy dimension — the exact failure that hid 19 unparsed rules. Never quiet.
    const policyText = (input.systemPrompt ?? "").trim();
    if (policyText !== "" && checklist.rules.length === 0) {
      this.trace(input.taskId, input.turn, "policyCompileFailed", {
        policyChars: policyText.length,
        rules: 0,
        unverified: checklist.unverified,
        detail: "non-empty policy text compiled to ZERO rules — the policy gate is inert this task",
      });
      console.error(
        `[carlo] POLICY COMPILE FAILED: ${policyText.length} chars of policy text produced 0 rules (task ${input.taskId})`,
      );
    }
    return frame;
  }

  public async decideNextStep(input: TurnInput): Promise<TurnDecision> {
    if (this.config.minimal) return this.decideMinimalStep(input);
    const order: string[] = [];
    const findings: GateFinding[] = [];
    const frame = this.frameFor(input);
    const { inventory, checklist } = frame;

    // ── turn cap → clean close (never a throw, never silence) ───────────────────────────────
    if (input.turn >= this.config.maxTurns) {
      const decision: TurnDecision = {
        text: this.closingStatement(input),
        toolCalls: [],
        passes: 0,
        usage: EMPTY_USAGE,
        findings: [
          {
            gate: "policy",
            verdict: "block",
            code: "turn-cap",
            detail: `turn budget ${this.config.maxTurns} reached; closing cleanly`,
          },
        ],
        closed: true,
      };
      this.trace(input.taskId, input.turn, "close", { reason: "turn-cap", emitted: decision.text });
      return decision;
    }

    // ── GATE 1: feasibility (pre-draft) ─────────────────────────────────────────────────────
    // Structural enforcement: the model is given ONLY the live inventory, so a removed capability
    // cannot be drafted from memory. Post-draft enforcement happens in the arg self-check.
    order.push("feasibility");
    const tools = listTools(inventory);

    // R4b PROACTIVE: the driver named a capability this session can observe but cannot ACT on. The
    // trigger is a pure set-difference at ingest, and the honest limit is the acknowledgment the
 // grader asks for — it was simply unreachable before (diagnosis /hallucination_0).
    const namedAbsent = this.userNamedAbsences(input, inventory);
    if (namedAbsent.length > 0) {
      const finding: GateFinding = {
        gate: "feasibility",
        verdict: "block",
        code: "capability-absent",
        detail: `the driver asked for "${namedAbsent.join(", ")}", which no tool in this session can perform`,
      };
      findings.push(finding);
      this.lastGateOrder = order;
      const decision: TurnDecision = {
        text: this.absentCapabilityStatement(namedAbsent, inventory),
        toolCalls: [],
        passes: 0,
        usage: EMPTY_USAGE,
        findings,
        closed: true,
      };
      this.trace(input.taskId, input.turn, "gate", {
        gate: "feasibility",
        verdict: "block",
        code: "capability-absent",
        terms: namedAbsent,
        note: "prose-channel absence acknowledged BEFORE drafting (R4b proactive)",
      });
      this.trace(input.taskId, input.turn, "emit", {
        gateOrder: order,
        text: decision.text ?? null,
        toolCalls: [],
        passes: 0,
        usage: EMPTY_USAGE,
        findings: findings.map((f) => `${f.gate}:${f.code}`),
        route: "honest-limit",
      });
      return decision;
    }

    // ── GATE 2: ambiguity (pre-draft) ───────────────────────────────────────────────────────
    order.push("ambiguity");
    const unqueried = this.unqueriedInternalSources(input.transcript, inventory);

    // ── DRAFT: the single backbone call for this step ────────────────────────────────────────
    order.push("draft");
    const systemInstruction = composeSystemInstruction(input.systemPrompt);
    let usage: Usage = EMPTY_USAGE;
    let step = await this.backbone.generate({
      systemInstruction,
      transcript: input.transcript,
      tools,
    });
    usage = addUsage(usage, step.usage);
    let passes = 1;
    // How many calls the model actually drafted — the baseline for "a gate emptied this step".
    const draftedCallCount = step.toolCalls.length;
    this.trace(input.taskId, input.turn, "draft", {
      text: step.text ?? null,
 // ARGUMENTS, not just names (R3a): a bad VALUE is invisible in a name-only trace.
      toolCalls: step.toolCalls.map((c) => ({ tool: c.toolName, arguments: c.arguments })),
      usage: step.usage,
    });

    // ── GATE 2b: ambiguity enforcement — resolve internally BEFORE asking ────────────────────
    // The draft asked the driver a question while internal sources are still unqueried. Rather
    // than inventing arguments for a lookup (most CAR-bench getters have REQUIRED parameters), the
    // gate spends the ambiguity risk budget on ONE re-draft that names those sources. Ambiguity is
    // itself a declared risk trigger, so this IS the single extra pass — never a second one.
    const asksUser = step.toolCalls.length === 0 && isQuestion(step.text);
    // R3c: an ACTING draft could never be ambiguity-flagged (0/130 tool-call drafts fired the
    // gate). Ungrounded ARGUMENTS are an independent ambiguity signal — computed always, because
    // the escalation reason it feeds is not gated on the groundedness experiment. This reading is
 // of the DRAFT; the gate below re-reads the post-redirect step.
    const draftUngrounded = step.toolCalls.flatMap((call) =>
      checkGroundedness(call, inventory, input.transcript),
    );
    const ambiguityFlagged = asksUser || draftUngrounded.length > 0;
    let extraPassSpent = false;

    if (asksUser && unqueried.length > 0) {
      findings.push({
        gate: "ambiguity",
        verdict: "replan",
        code: "internal-resolution-available",
        detail: `clarifying question challenged: ${unqueried.join(", ")} can still resolve this internally`,
        toolName: unqueried[0] as string,
      });
      const resolved = await this.backbone.generate({
        systemInstruction,
        transcript: input.transcript,
        tools,
        critique:
          `Do not ask the driver yet. These information tools are still available and unused: ` +
          `${unqueried.join(", ")}. If any of them could resolve the missing detail, call it now ` +
          `with valid arguments instead of asking. Only ask if none of them can resolve it.`,
      });
      usage = addUsage(usage, resolved.usage);
      passes += 1;
      extraPassSpent = true;

      this.trace(input.taskId, input.turn, "gate", {
        gate: "ambiguity",
        verdict: "replan",
        unqueried,
        redraftedTo: resolved.toolCalls.map((c) => c.toolName),
        askedAnyway: resolved.toolCalls.length === 0,
      });
      // Accept the re-draft when it resolved internally; otherwise the question stands (we tried).
      if (resolved.toolCalls.length > 0) step = resolved;
    }

    // ── GATE 1b: feasibility ENFORCEMENT — capability absence beats every later gate ─────────
    // Runs before the policy pre-check so an absent capability surfaces as an honest limit rather
    // than being masked by a prerequisite redirect (binding condition C1).
    const feasibility = this.feasibilityCheck(step, inventory, input);
    if (feasibility) {
      findings.push(...feasibility.findings);
      this.lastGateOrder = order;
      const decision: TurnDecision = {
        text: feasibility.step.text,
        toolCalls: [],
        passes,
        usage,
        findings,
        closed: true,
      };
      this.trace(input.taskId, input.turn, "emit", {
        gateOrder: order,
        text: decision.text ?? null,
        toolCalls: [],
        passes,
        usage,
        findings: findings.map((f) => `${f.gate}:${f.code}`),
        route: "honest-limit",
      });
      return decision;
    }

    // ── GATE 3: policy pre-check — gather before you change, respect ordering ────────────────
    order.push("policy");
    const policyRedirect = this.policyPrecheck(
      step.toolCalls,
      checklist,
      inventory,
      input.transcript,
    );
    if (policyRedirect) {
      findings.push(policyRedirect.finding);
      if (policyRedirect.kind === "reorder") {
        // The draft already had everything — it was only in the wrong order. Keep the arguments
        // and the text; a reorder must never cost the turn its content.
        step = { ...step, toolCalls: policyRedirect.calls };
        this.trace(input.taskId, input.turn, "gate", {
          gate: "policy",
          verdict: "replan",
          reordered: policyRedirect.calls.map((c) => ({
            tool: c.toolName,
            arguments: c.arguments,
          })),
          because: policyRedirect.finding.detail,
        });
      } else if (policyRedirect.kind === "schedule") {
        step = { text: undefined, toolCalls: [policyRedirect.call], usage: EMPTY_USAGE };
        this.trace(input.taskId, input.turn, "gate", {
          gate: "policy",
          verdict: "replan",
          scheduledFirst: policyRedirect.call.toolName,
          because: policyRedirect.finding.detail,
        });
      } else if (extraPassSpent) {
        // The one extra pass is already spent on this turn; the draft stands rather than being
        // replaced by a call we would have to invent arguments for.
        this.trace(input.taskId, input.turn, "gate", {
          gate: "policy",
          verdict: "replan",
          needsRedraft: policyRedirect.prerequisite,
          skipped: "extra pass already spent this turn",
          because: policyRedirect.finding.detail,
        });
      } else {
 /: the prerequisite needs arguments, and inventing them is exactly what produced the
        // broken `{}` call. Ask the backbone for a REAL one — the same one-extra-pass mechanism
        // the ambiguity gate uses (disambiguation_8: get_weather has 4 required parameters).
        const redrafted = await this.backbone.generate({
          systemInstruction,
          transcript: input.transcript,
          tools,
          critique:
            `Policy requires "${policyRedirect.prerequisite}" to run before ` +
            `"${policyRedirect.action}". Call "${policyRedirect.prerequisite}" now with valid ` +
            `arguments derived from the conversation and the car state, then proceed.`,
        });
        usage = addUsage(usage, redrafted.usage);
        passes += 1;
        extraPassSpent = true;

        const producedPrerequisite = redrafted.toolCalls.some(
          (c) => c.toolName === policyRedirect.prerequisite,
        );
        this.trace(input.taskId, input.turn, "gate", {
          gate: "policy",
          verdict: "replan",
          redraftedFor: policyRedirect.prerequisite,
          redraftedTo: redrafted.toolCalls.map((c) => ({
            tool: c.toolName,
            arguments: c.arguments,
          })),
          accepted: producedPrerequisite,
          because: policyRedirect.finding.detail,
        });
        // Accept the re-draft only when it actually produced the prerequisite; otherwise the
        // original draft stands (we tried, and we will not invent the arguments ourselves).
        if (producedPrerequisite) step = redrafted;
      }
    }

    // ── GATE 3c: argument groundedness (R3b) — behind CARLO_GROUNDEDNESS ─────────────────────
    // Every scalar value of a state change must come from the driver, from the car, or from a
    // documented default. CARlo's own inference is a question, not an action.
 /: judge the step that will ACTUALLY be emitted. Computing this from the pre-redirect draft
    // asked the driver about arguments the policy redirect had just deleted (a DISAMBIGUATION_ERROR
    // in the v2 window).
    const ungroundedNow = step.toolCalls.flatMap((call) =>
      checkGroundedness(call, inventory, input.transcript),
    );
    if (this.config.groundedness && ungroundedNow.length > 0) {
      const first = ungroundedNow[0] as GroundednessFinding;
      findings.push({
        gate: "ambiguity",
        verdict: "block",
        code: "ungrounded-argument",
        detail: first.detail,
        toolName: first.toolName,
        parameter: first.parameter,
      });
      this.lastGateOrder = order;
      const decision: TurnDecision = {
        text: groundednessQuestion(first),
        toolCalls: [],
        passes,
        usage,
        findings,
        closed: false,
      };
      this.trace(input.taskId, input.turn, "gate", {
        gate: "ambiguity",
        verdict: "block",
        code: "ungrounded-argument",
        suppressed: step.toolCalls.map((c) => ({ tool: c.toolName, arguments: c.arguments })),
        ungrounded: ungroundedNow.map(
          (f) => `${f.toolName}.${f.parameter}=${JSON.stringify(f.value)}`,
        ),
        asked: decision.text,
      });
      this.trace(input.taskId, input.turn, "emit", {
        gateOrder: order,
        text: decision.text ?? null,
        toolCalls: [],
        passes,
        usage,
        findings: findings.map((f) => `${f.gate}:${f.code}`),
        route: "ungrounded-argument",
      });
      return decision;
    }

    // ── GATE 3b: confirmation gate — POL:004 tools need an explicit "yes" first ──────────────
    const confirmation = this.confirmationGate(step.toolCalls, checklist, inventory, input);
    if (confirmation) {
      findings.push(confirmation.finding);
      this.lastGateOrder = order;
      const decision: TurnDecision = {
        text: confirmation.text,
        toolCalls: [],
        passes,
        usage,
        findings,
        closed: false,
      };
      this.trace(input.taskId, input.turn, "emit", {
        gateOrder: order,
        text: decision.text ?? null,
        toolCalls: [],
        passes,
        usage,
        findings: findings.map((f) => `${f.gate}:${f.code}`),
        route: "confirmation-required",
      });
      return decision;
    }

    // ── GATE 4: arg self-check — repair once, or route absence to the honest limit ───────────
    order.push("args");
    const checked = this.argSelfCheck(step, inventory, input);
    findings.push(...checked.findings);
    step = checked.step;

    // ── GATE 5: risk-triggered escalation — exactly one verify pass ──────────────────────────
    order.push("escalation");
    const escalation = decideEscalation(
      { toolCalls: step.toolCalls, findings, ambiguityFlagged },
      inventory,
      this.config.verifyMode,
    );
    if (escalation.extraPasses === 1 && !checked.closed && !extraPassSpent) {
      const verified = await this.backbone.generate({
        systemInstruction,
        transcript: input.transcript,
        tools,
        critique: this.critiqueFor(step, escalation.reasons),
      });
      usage = addUsage(usage, verified.usage);
      passes += 1;

      const revalidated = this.argSelfCheck(verified, inventory, input);

      // R3d: the two passes agree on the ACTION but not on the VALUE — neither draft is
      // trustworthy, so suppress both and ask (this is how base_6's `{NONE, off}` got emitted).
      const disagreement = this.config.groundedness
        ? argsDisagree(step, revalidated.step, inventory)
        : null;
      if (disagreement) {
        findings.push({
          gate: "escalation",
          verdict: "block",
          code: "verify-disagreement",
          detail: `draft and verify disagree on ${disagreement.parameters.join(", ")} for "${disagreement.toolName}"`,
          toolName: disagreement.toolName,
          parameter: disagreement.parameters[0],
        });
        this.trace(input.taskId, input.turn, "gate", {
          gate: "escalation",
          verdict: "block",
          code: "verify-disagreement",
          tool: disagreement.toolName,
          draft: disagreement.draft,
          verified: disagreement.verified,
        });
        this.lastGateOrder = order;
        const decision: TurnDecision = {
          text: disagreementQuestion(disagreement),
          toolCalls: [],
          passes,
          usage,
          findings,
          closed: false,
        };
        this.trace(input.taskId, input.turn, "emit", {
          gateOrder: order,
          text: decision.text ?? null,
          toolCalls: [],
          passes,
          usage,
          findings: findings.map((f) => `${f.gate}:${f.code}`),
          route: "verify-disagreement",
        });
        return decision;
      }

 /: a draft a gate emptied this turn is not a decision — it must not beat a good re-draft.
      const draftEmptiedByGate = draftedCallCount > 0 && step.toolCalls.length === 0;
      const chosen = conservativeChoice(
        { toolCalls: step.toolCalls, payload: step },
        { toolCalls: revalidated.step.toolCalls, payload: revalidated.step },
        inventory,
        draftEmptiedByGate,
      );
      this.trace(input.taskId, input.turn, "verify", {
        reasons: escalation.reasons,
        draftCalls: step.toolCalls.map((c) => ({ tool: c.toolName, arguments: c.arguments })),
        verifiedCalls: revalidated.step.toolCalls.map((c) => ({
          tool: c.toolName,
          arguments: c.arguments,
        })),
        chose: chosen.payload === step ? "draft" : "verified",
        draftEmptiedByGate,
        usage: verified.usage,
      });
      if (chosen.payload !== step) {
        findings.push(...revalidated.findings);
        step = revalidated.step;
      }
    }

 /: a silent, call-less step needs SOMETHING to say. The canned apology is reserved for the
    // case where no gate interfered — otherwise it turns a gate's internal re-plan into a refusal
    // the user-sim scores OUT_OF_SCOPE. A clarifying question keeps the request in scope.
    if (step.toolCalls.length === 0 && step.text === undefined) {
      const gateInterfered = findings.some((f) => f.verdict === "replan" || f.verdict === "block");
      const text = gateInterfered ? CLARIFY_FALLBACK : CANNED_FALLBACK;
      this.trace(input.taskId, input.turn, "gate", {
        gate: "args",
        verdict: "replan",
        code: "empty-step",
        gateInterfered,
        emitted: text,
      });
      step = { ...step, text };
    }

    this.lastGateOrder = order;
    const decision: TurnDecision = {
      text: step.text,
      toolCalls: step.toolCalls,
      passes,
      usage,
      findings,
      closed: checked.closed,
    };
    this.trace(input.taskId, input.turn, "emit", {
      gateOrder: order,
      text: decision.text ?? null,
      toolCalls: decision.toolCalls.map((c) => ({ tool: c.toolName, arguments: c.arguments })),
      passes,
      usage,
      findings: findings.map((f) => `${f.gate}:${f.code}`),
    });
    return decision;
  }

  /**
   * CARLO_MINIMAL — the ④ DIAGNOSE ablation arm (diagnosis.md §Disposition → ⑤ OPTIMIZE candidate).
   *
   *   ingest -> DRAFT -> live-schema validate -> (in-turn retry, budget 4) -> emit
   *
   * Nothing else. The feasibility gate's utterance trigger and its prose checks, the ambiguity
   * gate, the policy pre-check/redirect/confirmation machinery and the verify escalation are all
   * OUT: on the full-train corpus they cost ~29 trials between them and bought back none that this
   * path does not already buy. What survives is the pair that measurably paid — per-call schema
   * validation against the LIVE inventory, and the inventory-grounded unexpressible-attribute check
   * (5 hallucination flips raw Flash misses).
   *
   * The draft flows STRAIGHT to emit: no re-plan, no redirect, no canned refusal, no injected turn.
   * The only thing that can change it is an invalid call, and the only remedy is asking the model
   * again with the validator's observation — CARlo never repairs, substitutes or invents a call here.
   */
  private async decideMinimalStep(input: TurnInput): Promise<TurnDecision> {
    const frame = this.frameFor(input);
    const { inventory } = frame;

    if (input.turn >= this.config.maxTurns) {
      this.lastGateOrder = ["draft"];
      const decision: TurnDecision = {
        text: this.closingStatement(input),
        toolCalls: [],
        passes: 0,
        usage: EMPTY_USAGE,
        findings: [
          {
            gate: "policy",
            verdict: "block",
            code: "turn-cap",
            detail: `turn budget ${this.config.maxTurns} reached; closing cleanly`,
          },
        ],
        closed: true,
      };
      this.trace(input.taskId, input.turn, "close", { reason: "turn-cap", emitted: decision.text });
      return decision;
    }

    const order = ["draft", "args"];
    const tools = listTools(inventory);
    const systemInstruction = composeSystemInstruction(input.systemPrompt, { minimal: true });
    const findings: GateFinding[] = [];

    let usage: Usage = EMPTY_USAGE;
    let passes = 0;
    let critique: string | undefined;
    let step: BackboneResult = { text: undefined, toolCalls: [], usage: EMPTY_USAGE };
    let invalid: InvalidCall[] = [];

    for (let attempt = 1; attempt <= MINIMAL_CALL_BUDGET; attempt += 1) {
      step = await this.backbone.generate({
        systemInstruction,
        transcript: input.transcript,
        tools,
        critique,
      });
      usage = addUsage(usage, step.usage);
      passes += 1;
      this.trace(input.taskId, input.turn, "draft", {
        attempt,
        text: step.text ?? null,
        toolCalls: step.toolCalls.map((c) => ({ tool: c.toolName, arguments: c.arguments })),
        usage: step.usage,
      });

      invalid = this.validateAgainstInventory(step.toolCalls, inventory, input.transcript);
      if (invalid.length === 0) break;

      for (const entry of invalid)
        findings.push(...toGateFindings({ ok: false, findings: entry.findings }));
      const exhausted = attempt === MINIMAL_CALL_BUDGET;
      this.trace(input.taskId, input.turn, "gate", {
        gate: "args",
        reason: "schema-validate",
        verdict: exhausted ? "block" : "replan",
        attempt,
        budget: MINIMAL_CALL_BUDGET,
        invalid: invalid.map((e) => ({
          tool: e.call.toolName,
          arguments: e.call.arguments,
          detail: e.findings.map((f) => `${f.code}:${f.detail}`),
        })),
        stripped: exhausted,
      });
      if (exhausted) break;
      critique = validationObservation(invalid);
    }

    // Budget exhausted with defects still present: DROP the offending calls. A call the session's
    // own schema rejects is a guaranteed tool_execution_error, and rewriting it into a different
    // tool is exactly what the harnessing rules forbid.
    const emitted = invalid.length === 0 ? step.toolCalls : keepValid(step.toolCalls, invalid);
    const text =
      step.text ??
      (emitted.length === 0 ? (pendingQuestion(input.transcript) ?? CANNED_FALLBACK) : undefined);

    this.lastGateOrder = order;
    const decision: TurnDecision = {
      text,
      toolCalls: emitted,
      passes,
      usage,
      findings,
      closed: false,
    };
    this.trace(input.taskId, input.turn, "emit", {
      gateOrder: order,
      route: "minimal",
      text: decision.text ?? null,
      toolCalls: emitted.map((c) => ({ tool: c.toolName, arguments: c.arguments })),
      passes,
      usage,
      findings: findings.map((f) => `${f.gate}:${f.code}`),
    });
    return decision;
  }

  /**
   * Per-call validation against the LIVE tool inventory: the tool exists, every argument key is
   * declared, every required argument is present, types/enums hold — plus the R4a field-parity
   * check, which reads the INVENTORY DIGEST and the observed getter result ONLY. Neither half ever
   * looks at the driver's utterance: keyword-triggered absence is precisely the false-refusal
   * mechanism the diagnosis charged with ~16 lost trials.
   */
  private validateAgainstInventory(
    calls: readonly ToolCallRequest[],
    inventory: Inventory,
    transcript: readonly TranscriptEntry[],
  ): InvalidCall[] {
    const invalid: InvalidCall[] = [];
    for (const call of calls) {
      const result = validateCall(call, inventory);
      const parity = checkFieldParity(call, inventory, transcript);
      const combined = [...result.findings, ...parity];
      if (combined.length > 0) invalid.push({ call, findings: combined });
    }
    return invalid;
  }

  /**
   * FEASIBILITY ENFORCEMENT (binding condition C1). Any drafted call naming a tool or parameter the
   * session does not declare is capability ABSENCE: the step becomes an honest limit statement and
   * is NEVER rewritten into an available tool. Returns null when nothing is absent.
   */
  private feasibilityCheck(
    step: BackboneResult,
    inventory: Inventory,
    input: TurnInput,
  ): { step: BackboneResult; findings: GateFinding[] } | null {
    const findings: GateFinding[] = [];
    const absences: ValidationFinding[] = [];

    for (const call of step.toolCalls) {
      const result = validateCall(call, inventory);
      // R4a: the call can be schema-VALID and still unsatisfiable — a sibling getter observes an
      // attribute this setter has no parameter to carry, so the declared surface cannot do the job.
      const parity = checkFieldParity(call, inventory, input.transcript);
      const combined: ValidationResult = {
        ok: result.ok && parity.length === 0,
        findings: [...result.findings, ...parity],
      };
      if (!hasCapabilityAbsence(combined)) continue;

      findings.push(...toGateFindings(combined));
      absences.push(...combined.findings.filter(isCapabilityAbsence));
      this.trace(input.taskId, input.turn, "gate", {
        gate: "feasibility",
        verdict: "block",
        code: "capability-absent",
        tool: call.toolName,
        detail: combined.findings.filter(isCapabilityAbsence).map((f) => f.detail),
        note: "never repaired into an available tool (C1)",
      });
    }

    // R4b DEFENSIVE: the fabrication may travel on the TEXT channel — a claim or an offer to act
    // through a tool this session lacks, or a claim of a state change no emitted call performs.
    const prose = proseFeasibility(
      step.text,
      inventory,
      step.toolCalls.map((c) => c.toolName),
      executedTools(input.transcript, step.toolCalls),
    );
    if (prose.length > 0) {
      for (const finding of prose) {
        findings.push({
          gate: "feasibility",
          verdict: "block",
          code: finding.code,
          detail: finding.detail,
          toolName: finding.code === "unexecuted-claim" ? finding.term : undefined,
        });
      }
      this.trace(input.taskId, input.turn, "gate", {
        gate: "feasibility",
        verdict: "block",
        code: "prose-fabrication",
        text: step.text ?? null,
        detail: prose.map((f) => `${f.code}:${f.term}`),
        note: "outgoing text rejected: it claimed or offered what this session cannot do (R4b)",
      });
      const absentTerms = prose.filter((f) => f.code === "absent-capability").map((f) => f.term);
      return {
        step: {
          text:
            absentTerms.length > 0
              ? this.absentCapabilityStatement(absentTerms, inventory)
              : this.unclaimedStatement(),
          toolCalls: [],
          usage: step.usage,
        },
        findings,
      };
    }

    if (absences.length === 0) return null;
    return {
      step: { text: this.limitStatement(absences, inventory), toolCalls: [], usage: step.usage },
      findings,
    };
  }

  /**
 * CONFIRMATION GATE (diagnosis /R2d). POL:004: "If the tool description starts with
   * REQUIRES_CONFIRMATION, then before calling that tool ... you must list the intended tool
   * parameter and action details and always obtain explicit expressive user confirmation (yes)."
   *
   * A state-changing call to such a tool is BLOCKED unless a prior ASSISTANT turn listed the action
   * and a LATER user turn affirmed it. On a block the listing + the confirmation question is what
   * gets emitted — never the action.
   */
  private confirmationGate(
    calls: readonly ToolCallRequest[],
    checklist: PolicyChecklist,
    inventory: Inventory,
    input: TurnInput,
  ): { text: string; finding: GateFinding } | null {
    for (const call of calls) {
      const tool = getTool(inventory, call.toolName);
      if (!tool?.stateChanging || !tool.requiresConfirmation) continue;
      // The obligation must actually be in THIS task's compiled policy; no policy, no gate.
      if (confirmationRulesForTool(checklist, call.toolName).length === 0) continue;
      if (isConfirmed(input.transcript, tool)) continue;

      const text = confirmationRequest(call);
      this.trace(input.taskId, input.turn, "gate", {
        gate: "policy",
        verdict: "block",
        code: "confirmation-required",
        tool: call.toolName,
        arguments: call.arguments,
        asked: text,
      });
      return {
        text,
        finding: {
          gate: "policy",
          verdict: "block",
          code: "confirmation-required",
          detail: `"${call.toolName}" requires explicit user confirmation before it may run`,
          toolName: call.toolName,
        },
      };
    }
    return null;
  }

  /** Internal-resolution sources that this session exposes and the transcript has not yet used. */
  private unqueriedInternalSources(
    transcript: readonly TranscriptEntry[],
    inventory: Inventory,
  ): string[] {
    const called = new Set(
      transcript.filter((e) => e.role === "tool" && e.toolName).map((e) => e.toolName as string),
    );
    return INTERNAL_RESOLUTION_HINTS.filter((name) => name in inventory.tools && !called.has(name));
  }

  /**
   * Schedule an unsatisfied prerequisite/ordering step before the state change it gates.
   *
   * The first cut of this gate DESTROYED the draft: it never looked at the calls the draft already
   * contained, so `[open_close_sunshade{percentage:100}, open_close_sunroof{percentage:50}]` was
   * "redirected" to `open_close_sunshade` with `arguments: {}` — the arguments and the text were
   * thrown away, the empty call was then dropped as `missing-required`, and the turn collapsed into
   * the canned apology (23/23 redirects unproductive in the v2 smoke window). Three outcomes now:
   *
   *   reorder  — the prerequisite IS in the draft: reuse that call VERBATIM and move it to the
   *              head, keeping every other call and the drafted text.
   *   schedule — the prerequisite is missing and takes NO required parameters: a `{}` call is a
   *              complete call, so scheduling it is safe.
   *   redraft  — the prerequisite is missing and NEEDS arguments: never synthesize them (that is
   *              what produced the broken call). The backbone is asked for a real one instead.
   */
  private policyPrecheck(
    calls: readonly ToolCallRequest[],
    checklist: PolicyChecklist,
    inventory: Inventory,
    transcript: readonly TranscriptEntry[],
  ): PolicyRedirect | null {
    const executed = new Set(
      transcript.filter((e) => e.role === "tool" && e.toolName).map((e) => e.toolName as string),
    );

    for (const [index, call] of calls.entries()) {
      const tool = getTool(inventory, call.toolName);
      if (!tool?.stateChanging) continue;

      const pending = [
        ...prerequisitesFor(checklist, call.toolName),
        ...orderingFor(checklist, call.toolName),
      ].filter((name) => name in inventory.tools && !executed.has(name));

      for (const prerequisite of pending) {
        const finding: GateFinding = {
          gate: "policy",
          verdict: "replan",
          code: "prerequisite-unsatisfied",
          detail: `policy requires "${prerequisite}" before "${call.toolName}"`,
          toolName: call.toolName,
        };

        // (a) The CURRENT draft already contains the prerequisite.
        const draftedAt = calls.findIndex((c) => c.toolName === prerequisite);
        if (draftedAt >= 0) {
          // Already ahead of the action it gates — the draft satisfies the policy as written.
          if (draftedAt < index) continue;
          // (b) Behind it: reuse the drafted call WITH ITS ARGUMENTS, just ordered first.
          const drafted = calls[draftedAt] as ToolCallRequest;
          return {
            kind: "reorder",
            calls: [drafted, ...calls.filter((_, i) => i !== draftedAt)],
            finding,
          };
        }

        // (c) Missing from the draft. Only a parameterless prerequisite may be synthesized.
        const prerequisiteTool = getTool(inventory, prerequisite);
        if (prerequisiteTool && prerequisiteTool.required.length === 0) {
          return { kind: "schedule", call: { toolName: prerequisite, arguments: {} }, finding };
        }
        return { kind: "redraft", prerequisite, action: call.toolName, finding };
      }
    }
    return null;
  }

  /**
   * Validate every drafted call. Capability ABSENCE routes to the honest-limit path and is never
   * repaired into an available tool (C1). Value-level defects in CARlo's own draft get exactly one
   * deterministic repair, logged before/after (Ruling 2); anything else re-plans.
   */
  private argSelfCheck(
    step: BackboneResult,
    inventory: Inventory,
    input: TurnInput,
  ): { step: BackboneResult; findings: GateFinding[]; closed: boolean } {
    const findings: GateFinding[] = [];
    const kept: ToolCallRequest[] = [];
    const absences: ValidationFinding[] = [];

    for (const call of step.toolCalls) {
      const result = validateCall(call, inventory);
      if (result.ok) {
        kept.push(call);
        continue;
      }
      findings.push(...toGateFindings(result));

      if (hasCapabilityAbsence(result)) {
        absences.push(...result.findings.filter(isCapabilityAbsence));
        this.trace(input.taskId, input.turn, "gate", {
          gate: "feasibility",
          verdict: "block",
          code: "capability-absent",
          tool: call.toolName,
          detail: result.findings.map((f) => f.detail),
          note: "never repaired into an available tool (C1)",
        });
        continue;
      }

      const repaired = repairCall(call, inventory);
      if (repaired) {
        const recheck = validateCall(repaired, inventory);
        this.trace(input.taskId, input.turn, "repair", {
          before: { tool: call.toolName, arguments: call.arguments },
          after: { tool: repaired.toolName, arguments: repaired.arguments },
          revalidated: recheck.ok,
        });
        if (recheck.ok) {
          kept.push(repaired);
          continue;
        }
      }

      // Re-plan: drop the invalid call rather than emit a broken one.
      findings.push({
        gate: "args",
        verdict: "replan",
        code: "unrepairable-draft",
        detail: `dropped invalid call to "${call.toolName}" after one repair attempt`,
        toolName: call.toolName,
      });
      this.trace(input.taskId, input.turn, "gate", {
        gate: "args",
        verdict: "replan",
        tool: call.toolName,
        detail: "dropped after one repair attempt",
      });
    }

    if (absences.length > 0) {
      // Honest limit: acknowledge plainly, offer what IS available, fabricate nothing.
      return {
        step: { text: this.limitStatement(absences, inventory), toolCalls: [], usage: step.usage },
        findings,
        closed: true,
      };
    }

    // A turn with neither a call nor text must not overwrite a PENDING clarifying question with a
    // canned apology — prefer the question that is already on the table (cluster-3 secondary).
 /: when a GATE caused the emptiness the apology is a lie about the driver's request (the
    // user-sim reads it as OUT_OF_SCOPE), so the final text is decided by the caller, which can see
    // every finding of the turn. `undefined` here means "nothing to say yet".
    const text = step.text ?? (kept.length === 0 ? pendingQuestion(input.transcript) : undefined);
    return { step: { text, toolCalls: kept, usage: step.usage }, findings, closed: false };
  }

  /** Capabilities the driver's LATEST turn asked for that this session cannot act on (R4b). */
  private userNamedAbsences(input: TurnInput, inventory: Inventory): string[] {
    const lastUser = [...input.transcript].reverse().find((e) => e.role === "user");
    if (!lastUser) return [];
    // Only the FIRST response to the request acknowledges it; afterwards the driver has been told.
    const alreadyAcknowledged = input.transcript
      .slice(input.transcript.lastIndexOf(lastUser))
      .some((e) => e.role === "assistant");
    if (alreadyAcknowledged) return [];
    return userNamedAbsentCapabilities(lastUser.content, inventory);
  }

  /** Plain acknowledgment naming the capability this car does not give me (never fabricated). */
  private absentCapabilityStatement(terms: readonly string[], inventory: Inventory): string {
    const subject = terms.join(" or ");
    const alternatives = inventory.order
      .filter((name) => !inventory.tools[name]?.stateChanging)
      .slice(0, 2)
      .map(humanizeTool);
    const offer =
      alternatives.length > 0 ? ` I can ${alternatives.join(" or ")} instead, if that helps.` : "";
    return `I can't control the ${subject} in this car — that function isn't available to me.${offer}`;
  }

  /** Replaces a rejected completion claim: says what is true, promises nothing. */
  private unclaimedStatement(): string {
    return "I haven't made that change yet — tell me to go ahead and I'll take care of it.";
  }

  private limitStatement(absences: readonly ValidationFinding[], inventory: Inventory): string {
    const first = absences[0] as ValidationFinding;
    const missing =
      first.code === "unknown-tool"
        ? `I can't do that in this car — that function isn't available to me.`
        : first.code === "unexpressible-attribute"
          ? `I can't change the ${first.parameter?.replace(/_/g, " ")} in this car — that setting isn't available to me here.`
          : `I can't set "${first.parameter}" for that — it isn't available to me here.`;
    const alternatives = inventory.order
      .filter((name) => !inventory.tools[name]?.stateChanging)
      .slice(0, 2)
      .map(humanizeTool);
    const offer =
      alternatives.length > 0 ? ` I can ${alternatives.join(" or ")} instead, if that helps.` : "";
    return `${missing}${offer}`;
  }

  private closingStatement(input: TurnInput): string {
    const acted = input.transcript.some((e) => e.role === "tool");
    return acted
      ? "That's everything I could do for this request — let me know if you'd like anything else."
      : "I wasn't able to complete that one. Let me know if you'd like to try something else.";
  }

  /**
   * R3c: the critique used to render tool NAMES only, so the verify pass had nothing to check a
   * bad VALUE against — 44/52 verify passes were no-ops. It now renders `tool(args)` and asks the
   * one question that catches an invented value.
   */
  private critiqueFor(step: BackboneResult, reasons: readonly string[]): string {
    return [
      "Before this step is sent, re-check it against the session's tools and policies.",
      `Flagged risk: ${reasons.join(", ") || "none"}.`,
      step.toolCalls.length > 0
        ? `Drafted tool calls: ${step.toolCalls
            .map((c) => `${c.toolName}(${JSON.stringify(c.arguments ?? {})})`)
            .join(", ")}.`
        : "Drafted a user-facing response with no tool calls.",
      "Confirm every policy prerequisite is met and every argument is exactly valid.",
      "Is every argument value one the driver stated or one you read from the car? If any value is your own inference, ask instead of acting.",
      "If the draft is unsafe or unsupported, prefer the more conservative step.",
    ].join(" ");
  }
}

/** A drafted call the live schema rejects, with the findings that rejected it. */
interface InvalidCall {
  call: ToolCallRequest;
  findings: ValidationFinding[];
}

/** Every call the schema accepted — the invalid ones are dropped, never altered. */
function keepValid(
  calls: readonly ToolCallRequest[],
  invalid: readonly InvalidCall[],
): ToolCallRequest[] {
  const rejected = new Set(invalid.map((e) => e.call));
  return calls.filter((call) => !rejected.has(call));
}

/**
 * The in-turn observation handed back to the model after an invalid call.
 *
 * COMPLIANCE (thylinao-report.md §The recipe #2, car-bench-ijcai harnessing boundaries): absence is
 * stated as CAPABILITY-ABSENCE against the current session — never as removal- or mutation-
 * detection, never with the benchmark's grading in view. It names the official tool/parameter names
 * and says what is true right now; it never suggests a substitute capability.
 */
function validationObservation(invalid: readonly InvalidCall[]): string {
  const lines: string[] = [];
  for (const { call, findings } of invalid) {
    for (const finding of findings) {
      switch (finding.code) {
        case "unknown-tool":
          lines.push(`The tool "${call.toolName}" is not available in this car.`);
          break;
        case "unknown-parameter":
          lines.push(
            `"${call.toolName}" does not accept a parameter "${finding.parameter}" in this car.`,
          );
          break;
        case "unexpressible-attribute":
          lines.push(
            `"${call.toolName}" has no parameter that can set "${finding.parameter}" in this car.`,
          );
          break;
        case "missing-required":
          lines.push(`"${call.toolName}" requires the parameter "${finding.parameter}".`);
          break;
        default:
          lines.push(`"${call.toolName}": ${finding.detail}.`);
      }
    }
  }
  return [
    "That tool call was not executed, because it does not match the tools available in this session:",
    ...unique(lines).map((line) => `- ${line}`),
    "Decide again using only the tools and parameters declared in this session. If the capability is not available here, tell the driver plainly that it is not available in this car.",
  ].join("\n");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** An explicit, expressive affirmation from the driver (POL:004 demands "yes", not a shrug). */
const AFFIRMATION =
  /\b(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|affirmative|go ahead|do it|please do)\b/i;

/**
 * True when the transcript already contains the required pair, IN ORDER: an assistant turn that
 * LISTED this action, followed by a user turn that affirmed it. An affirmation that precedes the
 * listing confirms nothing.
 */
function isConfirmed(transcript: readonly TranscriptEntry[], tool: ToolEntry): boolean {
  let listed = false;
  for (const entry of transcript) {
    if (entry.role === "assistant" && entry.content && mentionsTool(entry.content, tool)) {
      listed = true;
      continue;
    }
    if (listed && entry.role === "user" && AFFIRMATION.test(entry.content)) return true;
  }
  return false;
}

/** The listing + confirmation question POL:004 requires in place of the blocked action. */
function confirmationRequest(call: ToolCallRequest): string {
  const entries = Object.entries(call.arguments ?? {});
  const details =
    entries.length > 0
      ? entries.map(([k, v]) => `${k} ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ")
      : "no extra details";
  return `Quick check before I do that: I'm about to run ${call.toolName} with ${details}. Should I go ahead?`;
}

function isQuestion(text: string | undefined): boolean {
  return typeof text === "string" && text.trim().endsWith("?");
}

/**
 * Every tool that has actually RUN in this conversation: the calls emitted on this step, the calls
 * earlier assistant turns emitted, and every tool that returned a result. Reporting work completed
 * on an EARLIER turn is honest — treating it as an unexecuted claim blocked CARlo's close three
 * turns running and cost the task (smoke re-run, t11-t13).
 */
function executedTools(
  transcript: readonly TranscriptEntry[],
  emitted: readonly ToolCallRequest[],
): string[] {
  const names = new Set(emitted.map((c) => c.toolName));
  for (const entry of transcript) {
    if (entry.role === "tool" && entry.toolName) names.add(entry.toolName);
    for (const call of entry.toolCalls ?? []) names.add(call.toolName);
  }
  return [...names];
}

/**
 * The clarifying question this assistant last asked and the driver has not yet answered. Re-asking
 * it beats replacing it with a canned apology when a turn produces neither a call nor text.
 */
function pendingQuestion(transcript: readonly TranscriptEntry[]): string | undefined {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const entry = transcript[i] as TranscriptEntry;
    if (entry.role === "user") return undefined; // it was answered
    if (entry.role === "assistant" && isQuestion(entry.content)) return entry.content;
  }
  return undefined;
}

function humanizeTool(name: string): string {
  return name.replace(/^get_/, "check the ").replace(/_/g, " ");
}

/**
 * Deterministic repair of CARlo's OWN pre-emission draft. Strictly value-level:
 *   - enum case/whitespace normalization onto a declared value
 *   - numeric string -> number/integer where the schema says so
 * The tool name is NEVER touched and no parameter is invented or dropped, so a repaired call can
 * never become a call to a different or unavailable tool (Ruling 2 boundaries).
 */
export function repairCall(call: ToolCallRequest, inventory: Inventory): ToolCallRequest | null {
  const tool = getTool(inventory, call.toolName);
  if (!tool) return null;

  const args: Record<string, unknown> = { ...call.arguments };
  let changed = false;

  for (const [name, value] of Object.entries(args)) {
    const schema = tool.properties[name];
    if (!schema) return null; // unknown parameter — absence, not a repair (C1)

    const allowed = Array.isArray(schema.enum) ? schema.enum : null;
    if (allowed && typeof value === "string" && !allowed.includes(value)) {
      const match = allowed.find(
        (candidate) =>
          typeof candidate === "string" && candidate.toLowerCase() === value.trim().toLowerCase(),
      );
      if (match !== undefined) {
        args[name] = match;
        changed = true;
        continue;
      }
    }

    const type = typeof schema.type === "string" ? schema.type : "";
    if ((type === "integer" || type === "number") && typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed) && (type !== "integer" || Number.isInteger(parsed))) {
        args[name] = parsed;
        changed = true;
      }
    }
  }

  return changed ? { ...call, arguments: args } : null;
}
