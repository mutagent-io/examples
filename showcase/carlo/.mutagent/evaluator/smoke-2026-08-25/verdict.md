# CARlo ③ EVALUATE — smoke run verdict (2026-08-25)

Slice: 5 tasks/type × 3 trials, train split. Both arms on Vertex ADC, temp 0.
Checkpoints: `carlo/results/smoke/{baseline,carlo}/*_train/` (latest per dir).

## GATE: **FAIL** — beats-flash-baseline not met

| Task type | raw-Flash Pass^3 | CARlo Pass^3 |
|---|---|---|
| base | 5/5 | **2/5** |
| hallucination | 4/5 | **3/5** |
| disambiguation | 4/5 | **3/5** |
| **overall** | **13/15 (0.87)** | **8/15 (0.53)** |

Baseline failures are stable across trials (Pass^3 ≈ Pass^1) → the bar is real, not noise.
Note: the stock harness agent gives raw Flash a planning tool; it uses it well.

## Per-criterion (smoke evidence)

| Criterion | Verdict | Evidence |
|---|---|---|
| final-state-correct | FAIL | base_6, disambiguation_2 (spurious intermediate actions), base_0/disambiguation_0 (infra) |
| required-info-tools-called | pass | no CARlo tool_subset misses on scored runs |
| no-invalid-tool-calls | FAIL | hallucination_6: `set_ambient_lights` called missing required `lightcolor` — the arg-selfcheck gate's one job |
| no-policy-violations | FAIL | base_2: trunk-door confirmation policy skipped; trace shows `policyRules: 0, policyUnverified: true` — policy compiler extracted NOTHING |
| acknowledges-missing-capability | FAIL | hallucination_0 (HALLUCINATION_ERROR; baseline also fails this task) |
| correct-ambiguity-routing | mixed | CARlo passes disambiguation_8 (baseline's failure!) but drops disambiguation_2 via spurious actions |
| beats-flash-baseline | **FAIL** | 0.53 < 0.87 overall; below on every type |
| cost-below-frontier | not yet evaluated | token accounting present in traces; defer to full run |

## Failure clusters → DIAGNOSE handoff

1. **WIRE (infra, mechanical):** parallel functionCalls answered with one functionResponse per
   user turn; Gemini 3.x requires all N responses batched in the SAME turn
   (`400: number of function response parts must equal function call parts`). Kills base_0 +
   disambiguation_0 entirely (6/45 trials). Fix in `buildContents` grouping.
   (The earlier thought_signature 400 is FIXED and did not recur — commit a97e18d.)
2. **POLICY COMPILER DEAD:** `policyRules: 0` on every trace — the compiler parses none of the
   evaluator's policy wiki, so policy-precheck is inert → base_2 violation.
3. **SPURIOUS ACTIONS DURING CLARIFICATION:** base_6 (`set_ambient_lights on:false` before
   asking), disambiguation_2 — state changes emitted before the ambiguity gate resolved;
   zeroes r_actions_intermediate even when the final state ends correct.
4. **ARG GATE MISS:** hallucination_6 emitted a call missing a required parameter (likely the
   removed-part trap: the required param was the removed capability — should have been an
   acknowledge-limit, not a call).
5. **HARD TASK:** hallucination_0 fails both arms 3/3 — study before treating as CARlo-specific.

## Disposition

Route clusters 1–4 to ④ DIAGNOSE (cluster 1 is mechanical; 2–4 are scaffold defects — the
gates exist but two of them demonstrably did not do their job on live traffic). Re-run the
smoke slice after remedies; only then consider the full 129-task train run.
