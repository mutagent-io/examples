# CARlo ③ EVALUATE — verdict v3 (2026-08-25, post-OPTIMIZE iteration 1)

Build: through – (policy-redirect fix bundle, 218 tests). Same 15-task × 3-trial slice.

## GATE: **PASS — beats-flash-baseline met on the smoke slice**

| Pass^3 | base | hallucination | disambiguation | overall |
|---|---|---|---|---|
| raw Flash (bar) | 1.00 | 0.80 | 0.80 | 0.87 |
| CARlo v3, groundedness OFF ★ | **1.00** | **1.00** | **0.80** | **0.93** |
| CARlo v3, groundedness ON | 1.00 | 1.00 | 0.40 | 0.80 |

- ★ Winning configuration: gates only, `CARLO_GROUNDEDNESS=0` (stays the default).
- Groundedness verdict: HARMFUL on disambiguation (asks where the bench demands internal
  resolution). Retired from the default path; keep the flag for future experiments.
- Hallucination: 1.00 for the 6th consecutive run — robust.
- Journey: 0.53 → 0.80 → **0.93** across two diagnose→optimize iterations.

## Cost (token-accurate)

- Winning config: $2.16 / 45 sessions ≈ **$0.048/task** (backbone $2.12 + harness $0.035).
  Honest note: slightly ABOVE the stock-agent baseline arm ($0.042/task) — successful
  multi-turn dialogues are longer; the v2 "34% cheaper" figure belonged to a config that
  failed more tasks early. cost-below-frontier: PASS by orders of magnitude.
- Cumulative ADL benchmark spend: **$6.86**.

## Criterion status (smoke evidence)
beats-flash-baseline PASS · acknowledges-missing-capability PASS (1.00) ·
final-state-correct PASS (base 1.00) · no-invalid-tool-calls PASS · no-policy-violations
PASS · correct-ambiguity-routing PASS at bar (0.80 = baseline) · cost-below-frontier PASS ·
required-info-tools-called PASS.

## Caveat + next
15 tasks/type ×3 is a SMOKE slice — variance on 5-task families is coarse (each task = 0.2).
The claim must be confirmed on the FULL train split (129 tasks × 3 × both arms), then the
public-test holdout milestone. Estimated full-run cost ≈ $35–45, several hours.
