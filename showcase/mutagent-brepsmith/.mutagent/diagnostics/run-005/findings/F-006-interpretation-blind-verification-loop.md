# F-006 — The local verification suite is interpretation-blind

- **Confidence:** high
- **Scope:** root cause spanning Q3 and Q5; explains the whole ~0.400 cohort
- **Audience:** OPTIMIZE gate (⑤)

## Problem

The agent's local gate (validity · locality · volume-intent · surface-type conservation) reports
"score 1.0 from check-results" on samples whose official shape score is exactly zero — 7 of 32
samples in run-005 pass every local check and score 0.400 or below. The check suite measures
whether the edit was executed cleanly, never whether it was the edit the instruction asked for,
so a confidently-wrong reading is indistinguishable from a correct one at every point where the
agent could still change course.

## Evidence

| id | run-005 self-report | official |
|---|---|---|
| 218 | `emitted: "round 3 (score 1.0 from check-results)"` | 0.4000 |
| 229 | `emitted: "round 3 (score 1.0 from check-results)"` | 0.4012 |
| 246 | all local checks pass, round-1 candidate emitted | 0.4000 |
| 243 | all local checks pass (1 waiver) | 0.4000 |
| 238 | `result: "valid; emitted with one waived check"`, intent rel-error 0.000405 | 0.4000 |

`runs/eval-run-005/armA/{218,229,238,243,246}/report.json`;
`.mutagent/evaluator/run-005/official-result.json` → `per_sample_scores`.

The scoring model is `0.6·shape(renormalized vs no-op) + 0.3·interface + 0.1·topology`, so a
score of exactly **0.4000** means interface and topology are FULL and the shape term is clamped
to zero. Five samples land on 0.4000 to four decimal places, from five different geometric
operations — the local suite gave all five a perfect self-assessment.

Natural experiment confirming the reading is what is being lost: run-004 sample **201** made **no
geometric change at all** (`checks.intent: "fail-waived — no geometric change was made"`,
`max_distance 3.07e-08`, `changed_fraction 0.0`) and scored **0.3256**. run-005's 201 executed an
82,275 mm³ edit (3.2 % of the body) with every check passing and scored **0.3365** — **+0.0109
over a literal no-op.** A 3 %-of-body edit that buys one point of the third decimal is a wrong
reading, and nothing in the local loop could say so.

## Why it matters

Rounds are therefore spent exclusively on implementation robustness (F-016). The agent has no
instrument that discriminates between competing readings, so interpretation is decided once, up
front, by prose heuristics — and when those heuristics are wrong (F-010) the loop happily
polishes the wrong answer to a 0.0004 intent error.

## Remedy candidate — R-006 · add a reading-discriminating check to the loop

Add a **pre-emit interpretation challenge** that is scored, not asserted:

1. For every sample, carry the top-2 readings from `rejected_readings` forward as *implementable
   candidates*, not as prose. Build both when the second is within reach (most are one parameter
   apart).
2. Score each candidate against the *only* proxy for ground truth that is available locally:
   **displacement from the no-op**, decomposed as (a) volume delta, (b) the bbox/centroid shift
   of unchanged material, (c) the fraction of the body that moves rigidly. Prefer the candidate
   that leaves the *unchanged* material where it was (see F-010).
3. Emit the winner, and record the runner-up plus its measured differences in the report so that
   a later run can re-target without re-deriving (see F-012).

Cost: medium (a second build on ambiguous samples only — ~10 of 32). Expected value: high; the
seven interpretation-blind samples are worth up to +0.35 mean if even half are re-read correctly.
