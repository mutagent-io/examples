# DIAGNOSE (ADL ④) — cad-step-editor, run-004 (Sonnet, 0.5059) vs run-005 (Opus, 0.6669)

Scoring model assumed throughout: `0.6·shape(renormalized vs no-op, clamped ≥0) + 0.3·interface + 0.1·topology`.
Findings F-006 … F-017 in ./findings/. Written by the ④ DIAGNOSE analyzer; relayed verbatim by the orchestrator
(the analyzer's harness blocked the report write; content unchanged).

## 1. Headline arithmetic
- editing mean 0.5059 → 0.6669 (+0.1610)
- win mass (17 samples, Δ ≥ +0.09): +5.916 · loss mass (7 samples): −0.821, of which −0.676 (82%) is 238 + 214
- run-to-run noise floor (F-017): ±0.07 per sample — only |Δ| > 0.08 is signal
- samples at exactly 0.4000 (interface+topology full, shape ZERO): 218, 238, 243, 246 (+229 at 0.4012, 203 at 0.4047)
- a literal no-op does NOT score 0.400 (run-004's 201 no-op scored 0.3256)

## 2. Diagnosis in one paragraph
run-005's gain came from grounding the reading in measurement — frame remapping (31% of win mass), empirical
add-vs-remove, unique-topological-signature feature search, tangent-blend rebuilding, inherited-defect repair
(26% of win mass). Its losses came from the opposite: on 238 and 214 it argued away readings a previous scored
run had already proven, using preference heuristics with no relationship to the scoring function. Structural
defect underneath: the local verification loop is interpretation-blind — a confidently wrong reading satisfies
every check, so extra rounds polish execution instead of testing the reading.

## 3. Answers (condensed — details in findings)
- Q1 WINS: five conventions — frame remapping (≥2 axis clauses, permutations over sign flips; +1.835);
  unique topological signature per noun (exactly one match, never best-effort; +0.538); empirical material-side
  by point classification (+0.454); tangent features travel with their parent wall (+0.394); expected volume
  delta stated before implementation (32/32 vs 0/32).
- Q2 REGRESSIONS: 238 — symmetric hedge was on the list, rejected by "fewest entities changed"; GT removed
  from −Z; hedge earns 63% of headroom, wrong-side guess zero. 214 — boundary over-reach past the named
  feature's extent cost ~0.50 shape; face-topology tidiness is worth far less than geometric extent.
  Preventing rule: SCORED-READING RATCHET — incumbent readings (prior score ≥0.6) displaced only by a
  contradicting measurement; ≤0.41 readings are anti-incumbents. Threshold separates populations 32/32 clean.
- Q3 STUCK COHORT: A (mis-read, resolvable): 203 → re-space five blades; 229 → apply stated delta not endpoint;
  201 → "inward" = toward central bore; 202 → re-derive +Z sign independently. B (shape-unresolvable,
  edits 0.015–0.10% of volume): 218, 243, 246, 241 — cap interpretation effort; 218's untried lead: TORUS
  r=178.5 @ axis (70,0). Shared signature of all seven: no measurement-confirmable clause.
- Q4 WAIVERS: class-level clean (−0.07 inside noise). Surface-type allowance model misfires on
  delete-feature edits (allowance should be the named feature's own face inventory). Intent-class waivers DO
  hide defects (241 tolerance widened 2%→5%; 201 no-op waiver).
- Q5 ROUNDS: 1-round mean 0.7289 vs ≥2-round 0.5871 (ρ=−0.311, confounded); iteration has never repaired a
  wrong reading — change what a round may be spent on, don't cut the budget.

## 4. Ranked remedies for ⑤ OPTIMIZE
1. Scored-reading ratchet (low cost, high correctness, +0.021)
2. Hedge unmarked distributions; ban convention-based placement (low, high, +0.012 + insurance)
3. No edit past named feature's measured extent; blend-carry only if tangency ⊆ moved set; revert 214 (+0.009)
4. Candidate-carrying on ambiguous samples (medium, +0.02–0.05)
5. Formalize frame resolution (48 signed permutations, unique argmax with margin) — protects +1.835
6. Intent waivers non-emitting; never widen a tolerance to pass
7. Surface-type allowance = named feature's face inventory for delete edits
8. Size-tiered effort from pre-derived delta (<0.1% precision tier) — gate on the 246 no-op experiment
9. Unfalsifiable-instruction trigger (7/7 stuck, 0/7 top) → route to 4+2
10. Boolean playbook as fixed knowledge (fuzzy 0 then 1e-4; extrude target face's own profile; SkipClean; no Defeaturing on dense bodies)
11. Report deltas with the ±0.08 band — do not "fix" 211/250/209/215/242

Experiment: submit a deliberate no-op for 246 in a scored pilot (one slot settles the shape-floor question for 4 of 32).
Sequencing: remedies 1–3 are pure decision rules, together +0.042 (0.6669 → ~0.709) from regressions alone; land first.
