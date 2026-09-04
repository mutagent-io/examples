# CARlo ③ EVALUATE — full-train confirm of CARlo-minimal (2026-08-26)

129 tasks × 3 trials, one arm (CARLO_MINIMAL=1 + thinkingLevel HIGH, commit 5b5b138 build),
concurrency 8, same simulator as the baseline corpus (gemini-2.5-flash on Vertex → internally
comparable; NOT official-comparable, see diagnostics/train-2026-08-25/thylinao-report.md).

## GATE: **PASS — CARlo-minimal beats the raw-Flash baseline on the full train split**

| Pass^3 | CARlo-minimal | raw-Flash baseline | old CARlo |
|---|---|---|---|
| base | 35/50 = 0.700 | 36/50 = 0.720 | 0.44 |
| hallucination | **26/48 = 0.542** | 22/48 = 0.458 | 0.417 |
| disambiguation | **17/31 = 0.548** | 15/31 = 0.484 | 0.26 |
| **overall** | **78/129 = 0.605** | 73/129 = 0.566 | 0.388 |

Pass@3: 0.736 (baseline 0.752).

- +5 tasks over baseline overall; ahead on hallucination (+4) and disambiguation (+2), one task
  behind on base. The sample-ablation prediction (0.667 vs 0.567 on 30 tasks) held direction and
  roughly magnitude at full scale — the eval discipline that caught the smoke-slice overfit now
  confirms a real win.
- The ④ DIAGNOSE → ⑤ OPTIMIZE loop is validated end-to-end: 0.388 → 0.605 by REMOVING the
  convicted machinery and flipping thinking to HIGH (MEDIUM control arm proved the thinking
  lever causally: 0.533 on the sample).
- beats-flash-baseline criterion: **MET on train** under the project's own simulator config.
- Context: Thylinao reports 0.802 on this split under the FAITHFUL (3.5-flash, gemini/ route)
  simulator — not directly comparable to our 2.5-flash-sim numbers in either direction. Closing
  the fidelity gap is the prerequisite for any external claim.

## Cost

Run $95.24 (backbone $94.91, harness $0.33) vs $85 estimate / $95 cutoff — finished $0.24 over
the cutoff line because the last trials landed between monitor polls (10-min cadence); the
enforced-cutoff mechanism worked, the poll interval is the residual gap. Per-session $0.245.
Cumulative ADL spend: **$249.09**.

## Disposition

1. Candidate config FROZEN: CARLO_MINIMAL=1 + thinkingLevel HIGH.
2. cost-below-frontier: PASS ($0.245/session ≈ Thylinao's $0.169–0.24; frontier runs cost
   dollars/task).
3. Next milestones (each gated): (a) eval-fidelity decision — re-score under the official
   3.5-flash simulator (Vertex route possible today; gemini/ route needs a GEMINI_API_KEY,
   currently ruled out) before ANY public claim; (b) public-test holdout single pre-registered
   read (125 tasks × 3, ~$92 est at measured rate).
