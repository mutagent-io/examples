// @implements policy-compiler
/**
 * Compiles the evaluator's policy context (the `System:` wiki) into a structured checklist —
 * prerequisites, orderings, conditional obligations — consulted by every gate.
 *
 * Anchors are the wiki's own machine-readable policy ids: bullets of the form
 * `- AUT-POL:005:<text>` or `- LLM-POL:008:AUT-POL:009:<text>`
 * (car-bench/car_bench/envs/car_voice_assistant/wiki.md, 19 policies). Continuation lines are
 * folded into the owning rule. The wiki also carries runtime placeholders
 * (`{{placeholder_location_based_on_task_context_init_config}}`) that the harness substitutes
 * before delivery (car-bench/run.py:173-188), so both substituted and raw text must parse.
 *
 * sop[ingest-task-frame].onFailure: when the policy text is missing or unparsable the checklist
 * stays EMPTY and `unverified` is set — fail toward caution, never toward fabrication.
 */

import { listTools } from "./inventory.ts";
import type { Inventory, PolicyChecklist, PolicyRule, ToolEntry } from "./types.ts";

/**
 * The namespace prefix is OPTIONAL because the bench STRIPS it before delivery: `wiki.py:8-10`
 * replaces "INS:", "AUT-POL:" and "LLM-POL:" with "", so the agent receives `- 004:<text>` and
 * `- 008:009:<text>` rather than the raw anchors (diagnosis). Both forms must parse; POLICY_ID is
 * always tested BEFORE PLAIN_BULLET so an id-anchored bullet is never mistaken for a plain one.
 */
const POLICY_ID = /^-\s+((?:(?:(?:AUT|LLM)-POL:)?\d+:)+)(.*)$/;
const POLICY_ID_PART = /((?:AUT|LLM)-POL:)?(\d+):/g;
const PLAIN_BULLET = /^-\s+(.*)$/;
const SECTION = /^#{2,4}\s+(.*)$/;

/** Rules that bind via the tool-description marker rather than by naming tools (POL:004). */
const CONFIRMATION_RULE = /REQUIRES_CONFIRMATION/;

/**
 * A rule only imposes an ORDERING between state changes when its text carries an explicit
 * sequencing cue. Without this, a rule that merely MENTIONS two actions (e.g. LLM-POL:008, which
 * lists weather conditions for the sunroof and for the fog lights in one bullet) would wrongly
 * force one action before the other. AUT-POL:005 — "the sunroof can only be opened if the sunshade
 * is already fully opened" — carries the cue and does impose an ordering.
 */
const SEQUENCING_CUE =
  /\b(only if|only when|before|already|beforehand|first|prior to|in parallel)\b/i;

/** Generic verbs/nouns in CAR-bench tool names that carry no discriminating meaning. */
const GENERIC_TOKENS = new Set([
  "get",
  "set",
  "open",
  "close",
  "send",
  "call",
  "delete",
  "add",
  "replace",
  "one",
  "current",
  "by",
  "at",
  "the",
  "from",
  "to",
  "and",
  "of",
  "for",
  "in",
  "on",
  "is",
  "info",
  "information",
  "status",
  "state",
  "position",
  "level",
  "apis",
  "api",
  "new",
  "navigation",
]);

function significantTokens(toolName: string): string[] {
  return toolName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
}

/** Position of a tool's first mention in the rule text, or -1 when it is not referenced. */
function mentionIndex(text: string, tool: ToolEntry): number {
  const exact = text.indexOf(tool.name);
  if (exact >= 0) return exact;
  const tokens = significantTokens(tool.name);
  if (tokens.length === 0) return -1;

  let earliest = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    const match = new RegExp(`\\b${token}s?\\b`, "i").exec(text);
    if (!match) return -1; // every significant token must appear
    earliest = Math.min(earliest, match.index);
  }
  return Number.isFinite(earliest) ? earliest : -1;
}

/**
 * Tools a rule references, ORDERED BY FIRST MENTION so the primary governed action is the one the
 * rule talks about first. Ties break toward the more specific name (more matched tokens): in
 * AUT-POL:010 "the window defrost ... for all windows", `set_window_defrost` is the governed action,
 * not `open_close_window`.
 */
function referencedTools(text: string, tools: ToolEntry[]): ToolEntry[] {
  return tools
    .map((tool) => ({
      tool,
      index: mentionIndex(text, tool),
      specificity: significantTokens(tool.name).length,
    }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index || b.specificity - a.specificity)
    .map((entry) => entry.tool);
}

interface RawRule {
  ids: string[];
  text: string;
}

/** Split the wiki into id-anchored rules, folding continuation lines into the owning rule. */
export function extractRawRules(wiki: string): RawRule[] {
  const rules: RawRule[] = [];
  let current: RawRule | null = null;

  for (const line of wiki.split("\n")) {
    const idMatch = POLICY_ID.exec(line);
    if (idMatch) {
      const idBlob = idMatch[1] ?? "";
      const body = idMatch[2] ?? "";
      // A stripped id has no namespace left to report, so it is tagged `POL:<n>`; a raw id keeps
      // its own namespace verbatim.
      const ids = [...idBlob.matchAll(POLICY_ID_PART)].map((m) =>
        m[1] ? `${m[1]}${m[2]}` : `POL:${m[2]}`,
      );
      current = { ids, text: body.trim() };
      rules.push(current);
      continue;
    }
    if (current === null) continue;

    // A new top-level bullet or a section heading ends the current rule.
    if (PLAIN_BULLET.test(line) || SECTION.test(line)) {
      current = null;
      continue;
    }
    const continuation = line.trim();
    if (continuation !== "") current.text = `${current.text} ${continuation}`;
  }
  return rules;
}

/**
 * Compile the wiki against the LIVE inventory. Attachment is inventory-relative: a policy about a
 * tool that this task does not expose attaches to nothing, which is exactly right for hallucination
 * tasks where the tool was removed.
 */
export function compilePolicy(
  wiki: string | null | undefined,
  inventory: Inventory,
): PolicyChecklist {
  const text = (wiki ?? "").trim();
  if (text === "") return { rules: [], unverified: true };

  const raw = extractRawRules(text);
  if (raw.length === 0) {
    // Parsable as text but carrying no recognizable obligations — treat as unverified.
    return { rules: [], unverified: true };
  }

  const tools = listTools(inventory);
  const confirmationGated = tools.filter((t) => t.requiresConfirmation);
  const rules: PolicyRule[] = raw.map((entry, index) => {
    // POL:004 governs "any tool whose description starts with REQUIRES_CONFIRMATION" — it names no
    // tool, so it must bind through the inventory flag or it attaches to NOTHING (diagnosis F2b).
    const referenced = CONFIRMATION_RULE.test(entry.text)
      ? confirmationGated
      : referencedTools(entry.text, tools);
    const stateChanging = referenced.filter((t) => t.stateChanging);
    const readOnly = referenced.filter((t) => !t.stateChanging);
    const primary = stateChanging[0];

    return {
      id: entry.ids[0] ?? `POL:GEN:${index}`,
      text: entry.text,
      appliesToTools: referenced.map((t) => t.name),
      // "GATHER BEFORE YOU CHANGE": information tools named by a rule must precede the change.
      prerequisites: readOnly.map((t) => t.name),
      // Sequencing between state changes, e.g. sunshade before sunroof (AUT-POL:005) — only when
      // the rule text actually expresses a sequence, never from mere co-mention.
      // A confirmation rule never imposes an ORDERING: it binds a set of unrelated gated tools, so
      // its "before calling that tool" cue must not sequence them against each other.
      ordering:
        !CONFIRMATION_RULE.test(entry.text) && SEQUENCING_CUE.test(entry.text)
          ? stateChanging.filter((t) => t.name !== primary?.name).map((t) => t.name)
          : [],
      primaryTool: primary?.name,
      condition: /\bif\b|\bwhen\b|\bunless\b/i.test(entry.text) ? entry.text : undefined,
    };
  });

  return { rules, unverified: false };
}

/** Every rule governing a given tool. */
export function rulesForTool(checklist: PolicyChecklist, toolName: string): PolicyRule[] {
  return checklist.rules.filter((rule) => rule.appliesToTools.includes(toolName));
}

/** Union of information-gathering tools that must precede this action. */
export function prerequisitesFor(checklist: PolicyChecklist, toolName: string): string[] {
  const out = new Set<string>();
  for (const rule of rulesForTool(checklist, toolName)) {
    for (const pre of rule.prerequisites) if (pre !== toolName) out.add(pre);
  }
  return [...out];
}

/**
 * Union of state-changing actions that must be ordered before this action. Only rules that
 * PRIMARILY govern this action can impose an ordering on it (see `PolicyRule.primaryTool`).
 */
export function orderingFor(checklist: PolicyChecklist, toolName: string): string[] {
  const out = new Set<string>();
  for (const rule of rulesForTool(checklist, toolName)) {
    if (rule.primaryTool !== toolName) continue;
    for (const before of rule.ordering) if (before !== toolName) out.add(before);
  }
  return [...out];
}

/** True when a free-text turn names this tool (exact name, or all of its significant tokens). */
export function mentionsTool(text: string, tool: ToolEntry): boolean {
  return mentionIndex(text, tool) >= 0;
}

/** Rules that bind through the REQUIRES_CONFIRMATION description marker (POL:004). */
export function confirmationRulesForTool(
  checklist: PolicyChecklist,
  toolName: string,
): PolicyRule[] {
  return rulesForTool(checklist, toolName).filter((rule) => CONFIRMATION_RULE.test(rule.text));
}
