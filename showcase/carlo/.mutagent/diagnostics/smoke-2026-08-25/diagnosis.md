# CARlo ④ DIAGNOSE — smoke-run RCA (2026-08-25)

Input: ③ EVALUATE GATE FAIL (`.mutagent/evaluator/smoke-2026-08-25/verdict.md`).
Method: 4 parallel analyzers, deep-read of failing trajectories + CARlo per-turn traces +
implicated source. All findings evidence-cited; confidence high throughout.

## Findings

### WIRE: parallel tool results replayed un-batched `{format-violation · tool-misuse · harness-side}`
`buildContents` aggregates parallel CALLS into one model turn but replays each RESULT as its
own single-part user turn (`vertex.ts:95-107` vs `:80-93`); Gemini requires all k
functionResponse parts in ONE user turn → deterministic 400 that permanently poisons the
transcript. Proof 1:1:1 — 5 parallel-call traces : 5 log 400s : 5 zero-reward records
(base_0 ×2, disambiguation_0 ×3). Negative control: base_0 trial 1 passed when the model
single-called. Trigger is sampling-dependent → all current pass rates are OPTIMISTIC.
**Remedy (rank 1, low cost, high correctness):** buffer consecutive `role:"tool"` entries,
flush as ONE user content at the next non-tool entry / end / before critique; keep both sides
id-free; + response-parity invariant test + k≥2, duplicate-name, critique-ordering tests.

### POLICY: compiler anchored on tokens the bench deletes `{missing-context · contract-mismatch · code-construct}`
`policy.ts:20` requires literal `AUT-POL:`/`LLM-POL:` prefixes; `wiki.py:8-10` strips exactly
those before delivery → 19 rules delivered, 0 parsed, on every task (`policyRules:0`).
Test blind spot: the fixture is the RAW wiki, not the delivered form.
**F2b (corollary):** even parsed, the trunk-door rule (POL:004) attaches to ZERO tools — it
binds via a `REQUIRES_CONFIRMATION` description prefix CARlo never reads. Parser fix alone
does NOT fix base_2.
**Remedy (rank 1):** (a) make the namespace prefix optional in `POLICY_ID`; (b) capture
`requiresConfirmation` from tool descriptions in `inventory.ts` and bind POL:004-class rules
to those tools; (c) pipeline confirmation gate for such tools; (d) FAIL-LOUD when a non-empty
policy text compiles to 0 rules; (e) delivered-format fixture (apply wiki.py's replaces).
Blast radius: ALL 19 rules currently inert — expect more failures surfaced (good) on wider
splits; historical CARlo numbers are a no-gate baseline.

### AMBIGUITY: gate structurally unreachable for acting drafts `{wrong-output · gate-unreachable · code-construct}`
`ambiguityFlagged := (no toolCalls && isQuestion(text))` (`pipeline.ts:173-174`) — an acting
draft can NEVER be ambiguity-flagged: 0/130 tool-call drafts fired the gate. The verify
backstop renders tool NAMES only (`pipeline.ts:507`) — 44/52 verify passes were no-ops; in
base_6 the verify pass itself AUTHORED the spurious `{NONE, off}` write. `riskScore` is
class-level so verify cannot veto a bad VALUE. disambiguation_2 trial 3 passed purely because
the model happened to draft a question — gates contributed nothing.
**Remedies (order):** R3a trace drafted/verified ARGUMENTS (enabler, zero risk, land first);
R3b argument-groundedness gate — every scalar arg of a state-changing call must be
user-stated, tool-read, or documented default, else suppress + ask (behind a config flag,
measure before default; beware false suppression on base_4/base_8-style synonyms);
R3c render args into the verify critique + independent ambiguity signal; R3d same-tool/
different-args disagreement ⇒ suppress + ask. Prompt hardening (R3e) is low-rank: the prose
rule already exists and was ignored 5/5.

### FEASIBILITY: draft-reactive and tool-call-only `{wrong-output · tool-schema-hole · code-construct}`
The gate only asks "did the model name something absent?" — never "can the declared surface
satisfy the request?" (hallucination_6: param deleted from schema+required, so `{on:true}` is
schema-VALID but the env still requires it → TypeError ×3 with `findings: []`) and never
"does the PROSE claim a capability we lack?" (hallucination_0: CARlo OFFERED the removed
sunshade tool and in trial 1 CLAIMED to have executed it — fabrication travelled on the text
channel the gate never inspects; baseline merely stayed silent — CARlo is WORSE here).
hallucination_0 verdict: **CARlo-fixable** — trigger is a pure set-difference at turn 0, and
`limitStatement` already emits the exact acknowledgment the grader wants; it's just unreachable.
**Remedies:** R4a getter/setter field-parity check → `unexpressible-attribute` (non-repairable
→ existing honest-limit path); R4b prose-channel feasibility — (proactive) diff user-named
capabilities vs inventory at ingest → force acknowledgment via limitStatement; (defensive)
reject text asserting/offering/claiming-executed an absent tool (key on tool-name tokens, not
verbs); R4c description-vs-properties coherence flag (conservative). Expected: hallucination_6
0→1 (prose already correct), hallucination_0 high-probability flip.

## Recommended remedy bundle (apply order)

1. ** wire batching** — mechanical, zero regression risk (k=1 byte-identical), unblocks 5 records.
2. **R3a trace arguments** — zero-risk enabler for everything below.
3. ** policy compiler + confirmation gate + fail-loud** — restores the whole policy dimension.
4. **R4a/R4b feasibility extensions** — wins hallucination_6, very likely hallucination_0.
5. **R3b/R3c/R3d groundedness + verify-args** — behind `CARLO_GROUNDEDNESS` flag; measure on
   the smoke slice before making default.

Then RE-RUN the smoke slice (same 15 tasks × 3) and RE-BASELINE — historical CARlo numbers
were produced with an inert policy gate and an optimistic wire.

## Cross-cutting lesson
One sentence: CARlo's gates were tested against the inputs they expected, not the inputs the
benchmark actually delivers (stripped policy anchors · mutilated schemas · parallel calls ·
prose-channel claims). Every fixture derived from RAW sources must be regenerated through the
bench's own delivery transforms.

## hallucination_0 note
Fails BOTH arms 3/3; not backbone-hard; see. Secondary over-refusal defect (rain) noted
but not score-bearing.
