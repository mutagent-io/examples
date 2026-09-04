// @implements arg-validator
/**
 * Schema validation of drafted tool calls against the capability inventory BEFORE emission
 * (JSON-Schema level, no LLM). Serves criterion `no-invalid-tool-calls` ↔ the harness's
 * `r_tool_execution` / `tool_execution_errors` (car-bench/car_bench/types.py::RewardInfo).
 *
 * REPAIRABILITY IS THE LOAD-BEARING DISTINCTION (architect condition C1 + Ruling 2).
 *
 *   repairable   — the tool and every named parameter EXIST, but the draft got a value wrong:
 *                  missing required parameter, type mismatch, enum violation. sop[arg-selfcheck]
 *                  allows exactly ONE repair of CARlo's own pre-emission draft, then re-plan.
 *
 *   NOT repairable — `unknown-tool` and `unknown-parameter`. These mean the capability is ABSENT
 *                  from this session (hallucination tasks are built by removing tools, parameters
 *                  or results — car-bench/README.md#2-hallucination-tasks). They route to the
 *                  feasibility gate / honest-limit path and are NEVER rewritten into an available
 *                  tool. Converting unavailable into available is exactly what the competition
 *                  rules forbid (car-bench-ijcai/docs/agent-under-test-harnessing.md
 *                  #agentic-harness-boundaries) and would defeat the hallucination metric.
 *
 * Numeric arguments are NOT pre-coerced for the wire: the evaluator normalizes tool-call arguments
 * against the exposed schema before execution (development-guide.md#option-2-tool-calls-only).
 */

import { getTool } from "./inventory.ts";
import type { GateFinding, Inventory, ToolCallRequest, ToolEntry } from "./types.ts";

export type ValidationCode =
  | "unknown-tool"
  | "unknown-parameter"
  | "missing-required"
  | "type-mismatch"
  | "enum-violation"
  /**
   * R4a: a state attribute this session can OBSERVE (a called sibling getter reports it) but that
   * the correspondingly-named setter has no parameter to carry. The declared surface cannot satisfy
   * the request — a schema-valid call would still fail in the car. Non-repairable by construction.
   */
  | "unexpressible-attribute";

export interface ValidationFinding {
  code: ValidationCode;
  toolName: string;
  parameter?: string;
  detail: string;
  /** False for capability-absence findings — those must reach the honest-limit path (C1). */
  repairable: boolean;
}

export interface ValidationResult {
  ok: boolean;
  findings: ValidationFinding[];
}

const NON_REPAIRABLE: ReadonlySet<ValidationCode> = new Set([
  "unknown-tool",
  "unknown-parameter",
  "unexpressible-attribute",
]);

export function isCapabilityAbsence(finding: ValidationFinding): boolean {
  return NON_REPAIRABLE.has(finding.code);
}

function schemaTypes(schema: Record<string, unknown>): string[] {
  const direct = schema.type;
  if (typeof direct === "string") return [direct];
  if (Array.isArray(direct)) return direct.filter((t): t is string => typeof t === "string");
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    return anyOf.flatMap((branch) =>
      typeof branch === "object" && branch !== null
        ? schemaTypes(branch as Record<string, unknown>)
        : [],
    );
  }
  return [];
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      // Unknown/omitted type keyword: nothing to assert.
      return true;
  }
}

function enumValues(schema: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(schema.enum)) return schema.enum;
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    const collected: unknown[] = [];
    let found = false;
    for (const branch of anyOf) {
      if (typeof branch === "object" && branch !== null) {
        const nested = (branch as Record<string, unknown>).enum;
        if (Array.isArray(nested)) {
          collected.push(...nested);
          found = true;
        }
      }
    }
    return found ? collected : null;
  }
  return null;
}

/** Validate a drafted call. Pure: never mutates the call or the inventory. */
export function validateCall(call: ToolCallRequest, inventory: Inventory): ValidationResult {
  const findings: ValidationFinding[] = [];
  const tool = getTool(inventory, call.toolName);

  if (!tool) {
    findings.push({
      code: "unknown-tool",
      toolName: call.toolName,
      detail: `tool "${call.toolName}" is not declared in this session's tool definitions`,
      repairable: false,
    });
    return { ok: false, findings };
  }

  const args = call.arguments ?? {};

  for (const name of Object.keys(args)) {
    if (!Object.hasOwn(tool.properties, name)) {
      findings.push({
        code: "unknown-parameter",
        toolName: tool.name,
        parameter: name,
        detail: `parameter "${name}" is not declared by "${tool.name}" in this session`,
        repairable: false,
      });
    }
  }

  for (const name of tool.required) {
    if (!Object.hasOwn(args, name) || args[name] === undefined) {
      findings.push({
        code: "missing-required",
        toolName: tool.name,
        parameter: name,
        detail: `required parameter "${name}" is missing`,
        repairable: true,
      });
    }
  }

  for (const [name, value] of Object.entries(args)) {
    const schema = tool.properties[name];
    if (!schema) continue;

    const types = schemaTypes(schema);
    if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
      findings.push({
        code: "type-mismatch",
        toolName: tool.name,
        parameter: name,
        detail: `parameter "${name}" expects ${types.join("|")}, got ${typeof value}`,
        repairable: true,
      });
      continue;
    }

    const allowed = enumValues(schema);
    if (allowed && !allowed.some((candidate) => candidate === value)) {
      findings.push({
        code: "enum-violation",
        toolName: tool.name,
        parameter: name,
        detail: `parameter "${name}" must be one of ${JSON.stringify(allowed)}, got ${JSON.stringify(value)}`,
        repairable: true,
      });
    }
  }

  return { ok: findings.length === 0, findings };
}

export function toGateFindings(result: ValidationResult): GateFinding[] {
  return result.findings.map((f) => ({
    gate: isCapabilityAbsence(f) ? ("feasibility" as const) : ("args" as const),
    verdict: isCapabilityAbsence(f) ? ("block" as const) : ("repair" as const),
    code: f.code,
    detail: f.detail,
    toolName: f.toolName,
    parameter: f.parameter,
  }));
}

/** True when any finding reports an ABSENT capability — the honest-limit route (C1). */
export function hasCapabilityAbsence(result: ValidationResult): boolean {
  return result.findings.some(isCapabilityAbsence);
}

/** True when every finding is a value-level defect in CARlo's own draft — repair once, then re-plan. */
export function isRepairable(result: ValidationResult): boolean {
  return result.findings.length > 0 && result.findings.every((f) => f.repairable);
}

// ── R4a: getter/setter FIELD PARITY ───────────────────────────────────────────────────────────
/**
 * The feasibility gate used to ask only "did the model name something absent?". It never asked
 * "can the declared surface satisfy the request?" — so hallucination_6 (a parameter deleted from
 * both `properties` and `required`) produced a schema-VALID call that the car still rejected
 * (diagnosis).
 *
 * The parity check is deliberately NARROW. It fires only when ALL of these hold:
 *   1. the drafted call targets a STATE-CHANGING tool,
 *   2. this session exposes a SIBLING GETTER for it (its significant name tokens cover the
 *      setter's) AND that getter was actually CALLED in this transcript,
 *   3. the getter's observed result names a field on the SAME subject as the setter, and
 *   4. NO parameter of the setter can carry that field — neither by name nor by value type.
 *
 * Under the full 58-tool inventory every observed field has a carrier, so the check is silent; it
 * speaks only when a mutation removed the carrier.
 */

const GENERIC_NAME_TOKENS: ReadonlySet<string> = new Set([
  "get",
  "set",
  "open",
  "close",
  "status",
  "state",
  "position",
  "positions",
  "level",
  "levels",
  "current",
  "and",
  "the",
  "for",
  "from",
  "car",
  "vehicle",
  "info",
  "information",
  "settings",
  "setting",
  "value",
  "description",
]);

/** Significant, singularized tokens of a tool name or an observed field name. */
function nameTokens(name: string): string[] {
  return (
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !GENERIC_NAME_TOKENS.has(t))
      // Singularize AFTER the generic filter, so "status" is dropped as generic rather than
      // surviving as the nonsense stem "statu".
      .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t))
      .filter((t) => !GENERIC_NAME_TOKENS.has(t))
  );
}

/** The read-only tool that OBSERVES what a state-changing tool CHANGES, or undefined. */
export function siblingGetter(setter: ToolEntry, inventory: Inventory): ToolEntry | undefined {
  if (!setter.stateChanging) return undefined;
  const wanted = nameTokens(setter.name);
  if (wanted.length === 0) return undefined;

  for (const name of inventory.order) {
    const candidate = inventory.tools[name];
    if (!candidate || candidate.stateChanging) continue;
    const have = new Set(nameTokens(candidate.name));
    if (wanted.every((token) => have.has(token))) return candidate;
  }
  return undefined;
}

/** The observed state object of a tool result: the `result` envelope when present, else the body. */
function observedFields(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const body = parsed as Record<string, unknown>;
  const inner = body.result;
  if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return body;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** True when some parameter of `tool` could carry `value` for the observed field `field`. */
function hasCarrier(tool: ToolEntry, field: string, value: string | number | boolean): boolean {
  const wanted = field.toLowerCase().replace(/[^a-z0-9]/g, "");
  const valueType = typeof value;

  for (const [name, schema] of Object.entries(tool.properties)) {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    // By NAME: the same attribute, however the two sides spell it.
    if (normalized === wanted || normalized.includes(wanted) || wanted.includes(normalized)) {
      return true;
    }
    // By VALUE TYPE: a parameter that could carry the observed value at all. Enum membership is
    // deliberately NOT required — getters and setters use different vocabularies for the same
    // attribute ("closed" vs "CLOSE") and that is a repairable value defect, not absence.
    const types = schemaTypes(schema);
    if (types.length === 0) return true;
    const carries = types.some(
      (t) =>
        (t === "string" && valueType === "string") ||
        ((t === "number" || t === "integer") && valueType === "number") ||
        (t === "boolean" && valueType === "boolean"),
    );
    if (carries) return true;
  }
  return false;
}

/**
 * Field-parity findings for one drafted call. `transcript` supplies the OBSERVED state: the check
 * needs a sibling getter that was actually called, so it can never fire on a cold turn.
 */
export function checkFieldParity(
  call: ToolCallRequest,
  inventory: Inventory,
  transcript: readonly { role: string; content: string; toolName?: string }[],
): ValidationFinding[] {
  const tool = getTool(inventory, call.toolName);
  if (!tool?.stateChanging) return [];

  const getter = siblingGetter(tool, inventory);
  if (!getter) return [];

  const results = transcript.filter((e) => e.role === "tool" && e.toolName === getter.name);
  if (results.length === 0) return [];

  const subject = new Set(nameTokens(tool.name));
  const findings: ValidationFinding[] = [];
  const seen = new Set<string>();

  for (const entry of results) {
    for (const [field, value] of Object.entries(observedFields(entry.content))) {
      if (!isScalar(value) || seen.has(field)) continue;
      // Same SUBJECT as the setter — an unrelated field the getter happens to report is not our
      // business (that is what keeps this narrow).
      const tokens = nameTokens(field);
      if (tokens.length === 0 || !tokens.some((t) => subject.has(t))) continue;
      if (hasCarrier(tool, field, value)) continue;

      seen.add(field);
      findings.push({
        code: "unexpressible-attribute",
        toolName: tool.name,
        parameter: field,
        detail: `"${getter.name}" reports "${field}", but "${tool.name}" declares no parameter that can carry it in this session`,
        repairable: false,
      });
    }
  }
  return findings;
}

// ── R4b: PROSE-CHANNEL feasibility ────────────────────────────────────────────────────────────
/**
 * The gate only ever inspected TOOL CALLS, so a fabrication travelling on the TEXT channel was
 * invisible: hallucination_0 OFFERED the removed sunshade tool and then CLAIMED to have executed
 * it (diagnosis). Two checks, both keyed on TOOL-NAME tokens — never on free verbs:
 *
 *   absent-capability — the text (or the driver's request) names a subject this session can only
 *     OBSERVE: some read-only tool's NAME carries the token, but no state-changing tool does. The
 *     actuator is absent, so offering or claiming the action is fabrication.
 *
 *   unexecuted-claim — the text claims a state change through a tool that IS available but was not
 *     among the calls this turn actually emitted.
 */

const ACTION_VERB =
  /\b(open|opens|opened|opening|close|closes|closed|closing|set|sets|setting|turn|turns|turned|switch|switches|switched|activate|activates|activated|deactivate|start|starts|started|stop|stops|stopped|adjust|adjusts|adjusted|raise|raised|lower|lowered|send|sends|sent|delete|deletes|deleted|add|adds|added)\b/i;

/** A first-person assertion that the state change ALREADY happened. */
const EXECUTION_CLAIM =
  /\b(?:I(?:'ve| have| already)\s+(?:just\s+)?(?:\w+ed|set|sent|shut|put|done)|I\s+(?:opened|closed|set|sent|turned|switched|activated|started|stopped|adjusted|deleted|added|raised|lowered)\b|(?:it's|that's|it is|that is)\s+(?:now\s+)?(?:done|open|closed|set|on|off)|all set|done for you)/i;

/** An offer to perform the action ("I can open ...", "shall I open ...", "would you like me to"). */
const ACTION_OFFER =
  /\b(?:I\s+can|I\s+could|I'?ll|I\s+will|shall\s+I|want\s+me\s+to|like\s+me\s+to|happy\s+to)\b/i;

function subjectTokens(inventory: Inventory, stateChanging: boolean): Set<string> {
  const out = new Set<string>();
  for (const name of inventory.order) {
    const tool = inventory.tools[name];
    if (!tool || tool.stateChanging !== stateChanging) continue;
    for (const token of nameTokens(tool.name)) out.add(token);
    // An actuator may SPELL its subject only in the description ("set_new_navigation" is how a
    // "route" is changed). Counting those keeps the absent-capability set honest: it must contain
    // ONLY subjects with no actuator at all, or every navigation turn would be falsely refused.
    if (stateChanging) {
      for (const token of nameTokens(tool.description.replace(/_/g, " "))) out.add(token);
    }
  }
  return out;
}

/**
 * Subjects this session can observe but NOT act on — e.g. with `open_close_sunshade` removed,
 * "sunshade" survives only inside `get_sunroof_and_sunshade_position`. These are exactly the terms
 * an offer or a completion claim must never be built on.
 */
export function observableOnlySubjects(inventory: Inventory): Set<string> {
  const actionable = subjectTokens(inventory, true);
  const out = new Set<string>();
  for (const token of subjectTokens(inventory, false)) {
    if (!actionable.has(token)) out.add(token);
  }
  return out;
}

function mentionedSubjects(text: string, subjects: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const subject of subjects) {
    if (new RegExp(`\\b${subject}s?\\b`, "i").test(text)) found.push(subject);
  }
  return found;
}

/** Leading forms that make a turn a QUESTION about state rather than a request to change it. */
const QUERY_LEAD =
  /^\s*(is|are|was|were|do|does|did|what|which|how|where|when|can you tell|tell me)\b/i;

/**
 * PROACTIVE (ingest): capabilities the DRIVER named that this session cannot act on. Only an
 * action REQUEST counts — a question about state is not a capability claim.
 */
export function userNamedAbsentCapabilities(userText: string, inventory: Inventory): string[] {
  if (QUERY_LEAD.test(userText) || !ACTION_VERB.test(userText)) return [];
  return mentionedSubjects(userText, observableOnlySubjects(inventory));
}

export interface ProseFinding {
  code: "absent-capability" | "unexecuted-claim";
  term: string;
  detail: string;
}

/** Sentences, with their terminator kept so a QUESTION stays recognizable. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Conditional / future / permission-seeking framing. Such a sentence PROMISES, it does not report:
 * "I'll open the sunroof once you confirm" is the confirmation policy working, not a fabrication.
 */
const CONDITIONAL =
  /\b(?:I'?ll|I\s+will|I\s+can|I\s+could|once\s+you|if\s+you|when\s+you|would\s+you|do\s+you\s+want|shall\s+I|let\s+me\s+know|just\s+say|as\s+soon\s+as|after\s+you)\b/i;

/**
 * An ACTUATION bound to the subject: the verb must govern the subject token ("open the sunshade"),
 * not merely appear somewhere in the same paragraph. This binding is what keeps a WEATHER REPORT
 * ("I checked the weather ... are you sure you want me to open the sunroof?") out of the gate:
 * "checked" is not an actuation verb, and the actuation verbs present govern the sunroof instead.
 */
const ACTUATION_VERB =
  "open|opens|opened|opening|close|closes|closed|closing|set|sets|setting|turn|turns|turned|switch|switches|switched|activate|activates|activated|deactivate|deactivates|start|starts|started|stop|stops|stopped|adjust|adjusts|adjusted|raise|raises|raised|lower|lowers|lowered|send|sends|sent|delete|deletes|deleted|add|adds|added";

function actuates(sentence: string, subject: string): boolean {
  // verb, then at most three filler words ("the", "my", "all the"), then the subject.
  return new RegExp(`\\b(?:${ACTUATION_VERB})\\b(?:\\s+\\w+){0,3}\\s+${subject}s?\\b`, "i").test(
    sentence,
  );
}

/**
 * DEFENSIVE (pre-emission): reject outgoing text that offers or claims an action this session
 * cannot perform, or claims a state change that never ran.
 *
 * Both checks are evaluated PER SENTENCE, because an offer in one sentence must not make every
 * subject named in another sentence suspect — that over-fire refused in-scope disambiguation turns
 * for merely REPORTING the weather (smoke re-run, t5/t6).
 *
 * `executedToolNames` defaults to the calls emitted THIS turn, but callers should pass every tool
 * that has actually run in the conversation: reporting work completed on an earlier turn is honest,
 * and blocking it stopped CARlo from ever closing the task (smoke re-run, t11-t13).
 */
export function proseFeasibility(
  text: string | undefined,
  inventory: Inventory,
  emittedToolNames: readonly string[],
  executedToolNames: readonly string[] = emittedToolNames,
): ProseFinding[] {
  if (typeof text !== "string" || text.trim() === "") return [];

  const observable = observableOnlySubjects(inventory);
  const executed = new Set([...emittedToolNames, ...executedToolNames]);
  const findings: ProseFinding[] = [];
  const seen = new Set<string>();

  const push = (finding: ProseFinding): void => {
    const key = `${finding.code}:${finding.term}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  for (const sentence of sentences(text)) {
    const isQuestion = sentence.endsWith("?");
    const conditional = CONDITIONAL.test(sentence);
    const offers = ACTION_OFFER.test(sentence);
    // A completion assertion — never a promise, a question or a conditional.
    const claims = !isQuestion && !conditional && EXECUTION_CLAIM.test(sentence);

    if (claims || offers) {
      // Only an ACTUATION of the subject counts. Mentioning, describing or reporting a subject
      // this session can read is not a capability claim — get_weather exists, and no setter for
      // the weather ever will.
      for (const subject of mentionedSubjects(sentence, observable)) {
        if (!actuates(sentence, subject)) continue;
        push({
          code: "absent-capability",
          term: subject,
          detail: `the response ${claims ? "claims" : "offers"} an action on "${subject}", which no tool in this session can perform`,
        });
      }
    }

    if (!claims) continue;

    // Attribute the claim to the MOST SPECIFIC tool it names: "the window defrost" names both
    // `open_close_window` (1 token) and `set_window_defrost` (2), and only the latter is meant.
    const matches: Array<{ name: string; specificity: number }> = [];
    for (const name of inventory.order) {
      const tool = inventory.tools[name];
      if (!tool?.stateChanging) continue;
      const tokens = nameTokens(tool.name);
      if (tokens.length === 0) continue;
      if (tokens.every((t) => new RegExp(`\\b${t}s?\\b`, "i").test(sentence))) {
        matches.push({ name, specificity: tokens.length });
      }
    }

    const best = Math.max(0, ...matches.map((m) => m.specificity));
    const attributed = matches.filter((m) => m.specificity === best);
    // If ANY call covering the claim has run — this turn or earlier — the claim is honest.
    if (attributed.some((m) => executed.has(m.name))) continue;
    for (const match of attributed) {
      push({
        code: "unexecuted-claim",
        term: match.name,
        detail: `the response claims "${match.name}" ran, but no such call has been made`,
      });
    }
  }

  return findings;
}

// ── R3b: ARGUMENT GROUNDEDNESS ────────────────────────────────────────────────────────────────
/**
 * The ambiguity gate could never fire on an ACTING draft — it keyed on "no tool calls AND the text
 * is a question", so 0/130 tool-call drafts were ever flagged, and the verify pass (which saw tool
 * NAMES only) could not veto a bad VALUE. In base_6 the verify pass itself authored the spurious
 * `{NONE, off}` write (diagnosis).
 *
 * A scalar argument of a state-changing call is GROUNDED when it is
 *   (i)   lexically supported by something the DRIVER said,
 *   (ii)  present in a prior TOOL RESULT this session read, or
 *   (iii) the parameter's DOCUMENTED DEFAULT.
 * Anything else is CARlo's own inference and must be asked about, not acted on.
 *
 * SCOPE — only ENUM and NUMERIC parameters are checked: those are the value CHOICES the benchmark
 * grades. Free-form strings (an email body, a search term) are authored by construction and would
 * be flagged by any lexical test.
 *
 * The task's own `disambiguation_element_*` fields are NEVER read: that would be eval leakage.
 */

export interface GroundednessFinding {
  toolName: string;
  parameter: string;
  value: unknown;
  detail: string;
}

/** Lexical tokens of an enum value: "FRESH_AIR" -> ["fresh","air"], "WINDSHIELD" -> ["windshield"]. */
function valueTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function mentionsValue(haystack: string, value: string | number): boolean {
  if (typeof value === "number") {
    return new RegExp(`(?<![0-9.])${value}(?![0-9])`).test(haystack);
  }
  const tokens = valueTokens(value);
  if (tokens.length === 0) return false;
  // Every token of the value must appear — "FRESH_AIR" is grounded by "fresh air", not by "air".
  return tokens.every((token) => new RegExp(`\\b${token}s?\\b`, "i").test(haystack));
}

/** True when the schema documents this exact value as the parameter's default. */
function isDocumentedDefault(schema: Record<string, unknown>, value: unknown): boolean {
  if (Object.hasOwn(schema, "default") && schema.default === value) return true;
  const description = typeof schema.description === "string" ? schema.description : "";
  if (!/\bdefault\b/i.test(description)) return false;
  return typeof value === "string" || typeof value === "number"
    ? mentionsValue(description, value)
    : false;
}

export function checkGroundedness(
  call: ToolCallRequest,
  inventory: Inventory,
  transcript: readonly { role: string; content: string; toolName?: string }[],
): GroundednessFinding[] {
  const tool = getTool(inventory, call.toolName);
  if (!tool?.stateChanging) return [];

  const userText = transcript
    .filter((e) => e.role === "user")
    .map((e) => e.content)
    .join("\n");
  const toolText = transcript
    .filter((e) => e.role === "tool")
    .map((e) => e.content)
    .join("\n");

  const findings: GroundednessFinding[] = [];
  for (const [name, value] of Object.entries(call.arguments ?? {})) {
    const schema = tool.properties[name];
    if (!schema) continue; // absence is the feasibility gate's business, not groundedness
    const graded = enumValues(schema) !== null || /^(number|integer)$/.test(String(schema.type));
    if (!graded) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;

    if (mentionsValue(userText, value)) continue;
    if (mentionsValue(toolText, value)) continue;
    if (isDocumentedDefault(schema, value)) continue;

    findings.push({
      toolName: tool.name,
      parameter: name,
      value,
      detail: `"${name}" = ${JSON.stringify(value)} is neither stated by the driver, read from the car, nor a documented default`,
    });
  }
  return findings;
}

/** The ONE clarifying question an ungrounded argument earns — it names the parameter. */
export function groundednessQuestion(finding: GroundednessFinding): string {
  return `Before I change anything — what should I use for the ${finding.parameter.replace(/_/g, " ")}?`;
}
