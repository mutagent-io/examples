# CARlo ④ DIAGNOSE — full-train GATE FAIL forensics (2026-08-26)

Corpus: 129×3×2 train run (verdict: ../../evaluator/train-2026-08-25/verdict.md). Regression set =
33 tasks where raw Flash passes 3/3 and CARlo fails Pass³ (15 base / 8 halluc / 10 disamb), all
linked to per-turn gate traces. Three diagnostics-analyzers, one per family (code-first, no LLM
spend); Thylinao rank-2 report mined (thylinao-report.md). Per-family details:
{base,hallucination,disambiguation}-findings.md.

## Root causes, ranked by trials lost across families

1. **Feasibility gate false refusals — ~16 trials (9 base + 6 disamb + 1 halluc). Worst offender.**
   The gate string-matches nouns from the USER UTTERANCE (`along`, `distance`, `contact`,
   `charging`, `calculate`, `weather`, headlight nouns) instead of grounding in the tool
   inventory. On a hit it short-circuits pre-draft — `llmCalls: 0`, the model is never called —
   and emits the canned refusal; the user-sim ends OUT_OF_SCOPE. Every audited firing on the
   regression set was a false positive (the "missing" tools exist in the same trace's inventory
   digest). base_74/base_78 0/3 and disamb_10/disamb_44 losses are entirely this; disamb_44
   re-fires even after the user says "I don't want to control the weather!".

2. **Ambiguity gate net-negative everywhere — ~7 trials + massive turn inflation.**
   base: 55 firings, 0 trials saved, always demanding the same four irrelevant tools, roughly
   doubling turn counts (22-turn episodes). disamb: injects "Do not ask the driver yet — call it
   now instead of asking", suppressing exactly the clarifying question the family rewards
   (mirror-image of the retired groundedness gate). halluc: discarded a correct honest-limit
   draft, re-emitted it a turn later (`askedAnyway: true`); its state-probes supply the material
   the model then fabricates from. Failing halluc trials avg 9.1 turns vs 6.0 passing.

3. **Prose-fabrication check under-triggers — 10 halluc trials.** The single biggest halluc
   leak: fabricated claims about removed capabilities emitted with `findings: []` (e.g. "Calling
   Gasthaus Zum Adler now" with call tooling removed). The gate designed for exactly this fired
   4× in 130 trials. Conversely it also once REPLACED a correct tool-grounded answer (base_86).

4. **Policy gate is advisory, not enforcing — ~6 trials.** Emits drafts unchanged despite its own
   `policy:prerequisite-unsatisfied` finding (base_16, disamb_14 → AUT-POL:011); one redraft
   reached the model as a user instruction ("there is no such policy"); its injected
   confirmation turn caused a required status-check skip (disamb_20 → AUT-POL:014).

5. **Missing behavior rule, not machinery — 6 base trials.** "Announce the N route alternatives"
   is one sentence of prose (baseline says it, CARlo doesn't). No gate can add it; a
   Thylinao-style general behavior rule does.

6. **Infra: 4 backbone-timeout trials eaten as 0.0** — no retry on the backbone call.

## What the scaffold DID buy (keep-list)

- absent-capability / unexpressible-attribute on PARAMETER removals: won 5 halluc flips
  (h14 seat-heating.level, h24 sunshade.percentage — raw flash misses these because the tool
  still exists). 21/31 pass when it fires vs 45/99 when not.
- Text-discipline rules won 3 disamb flips (24h format, no redundant confirmation, announce
  alternatives) — the baseline lost those to the prose-policy judge.

## Convergent external evidence (Thylinao, rank 2, flash-3.5, train Pass³ 0.802)

Their negative result IS our GATE FAIL: prompt additions pass targeted probes and degrade
unrelated tasks ("prompt-interference tax"); they reverted a single policy-cascade RULE — we
shipped a six-gate PIPELINE. Their whole recipe: temp 0 (starter agent leaves it unset!),
live-schema validate + in-turn retry (budget 4), capability-absence observations, 4 general
behavior rules, HIGH reasoning effort (CARlo runs thinkingBudget 0; high effort stabilises
disambiguation at 2–11% token overhead). Full recipe: thylinao-report.md.

## ⚠ Eval-fidelity finding (affects all our absolute numbers)

Our user-sim + policy judge = gemini-2.5-flash on vertex_ai (bridge defaults). Official Track-1
locks both to gemini-3.5-flash on the AI-Studio gemini/ route. Thylinao measured ~25 points
inflation on hallucination from exactly this sim config. Internal A/B validity holds (same sim
both arms → GATE FAIL stands); absolute comparability to leaderboard/competition does not.

## Disposition → ⑤ OPTIMIZE candidate: **CARlo-minimal**

Delete: feasibility gate, ambiguity gate, verify escalation, policy pre-check/redirect machinery.
Keep: schema-validate + in-turn retry (add backbone retry), absent-capability grounded in the
INVENTORY DIGEST only (never utterance keywords), honest-limit rule.
Add: temp 0 confirmed, thinking HIGH (flip from 0), 4-bullet behavior block incl.
announce-route-alternatives + name-action-before-confirmation + 24h/metric units + act-on-asked.
Projected from analyzer counterfactuals: base ~0.70, halluc ~0.54, disamb ~0.45 → ≈0.58 vs
baseline 0.566 BEFORE the thinking/temp levers, which Thylinao's 0.802 suggests carry further.
Validation: representative stratified sample first (~30 tasks ×3), full split only on a pass.
