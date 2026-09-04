# CARlo ⑤ OPTIMIZE — CARlo-minimal ablation verdict (2026-08-26)

Config: `CARLO_MINIMAL=1` (build: gates OFF — feasibility/ambiguity/verify/policy-precheck;
KEPT schema-validate + in-turn retry (budget 4) + inventory-grounded parameter check; ADDED
backbone transient retry, 5 general behavior rules, thinkingLevel HIGH, temp 0). 261 tests green.
Sample: 30 stratified train tasks (12 base / 11 halluc / 7 disamb) drawn by baseline-difficulty
buckets; baseline anchors recomputed from the existing full-train corpus (no baseline re-spend).
Simulator: same as corpus (gemini-2.5-flash on Vertex) → internally comparable, not
official-comparable (see diagnostics/train-2026-08-25/thylinao-report.md §fidelity).

## GATE: **PASS on the sample — minimal beats baseline, reverses the full-train fail**

| Pass^3 | CARlo-minimal | raw-Flash baseline | old CARlo (full pipeline) |
|---|---|---|---|
| base | 8/12 | 9/12 | 8/12 |
| hallucination | **8/11** | 5/11 | 4/11 |
| disambiguation | **4/7** | 3/7 | 3/7 |
| **overall** | **20/30 = 0.667** | 17/30 = 0.567 | 15/30 = 0.500 |

- Hallucination +3 tasks over baseline: the kept inventory-grounded capability checks + the
  honest-limit behavior rule, with none of the old false-refusal machinery.
- Disambiguation +1: first time any CARlo config beats baseline here.
- Base −1 (8 vs 9): remaining misses are the sample's hard tail (disamb_12/34/48 and
  base_24/70 also fail 0–1/3 under baseline). No sign of the old gate-interference pattern.
- Diagnosis remedies validated: every convicted mechanism removed → regression reversed.
  Sample-level old-CARlo 0.500 → 0.667 while baseline sits at 0.567.

## Cost — cap EXCEEDED, flagged

Run ≈ **$19.8** (backbone $19.70 from 1,840 calls: 27.7M prompt (22.3M cached), 175k output,
750k thinking; harness $0.07) vs the stated **$15 cap** — overrun ~32%. Driver: thinkingLevel
HIGH. Per-session $0.219 ≈ Thylinao's reported $0.169–0.24. Process gap: the cap was stated but
not enforced mid-run (monitor watched progress, not spend) — next run gets a spend cutoff in the
monitor. Cumulative ADL spend ≈ **$139.4**. Note: scripts/cost-report.ts does not scan the new
traces/minimal/ subdir (shows "unknown"); needs a one-line glob fix.

## Caveats + disposition

- 30 tasks is a SAMPLE (each task = 3.3 points); the smoke-slice lesson stands. The claim
  "minimal > baseline" needs the full-train confirm (129×3, minimal arm only) before any
  external statement. Projected cost at measured per-session rate: 387 sessions × $0.219 ≈
  **$85** (thinking HIGH is the cost driver; a thinkingLevel MEDIUM arm would be ~cheaper but
  unmeasured). Full-train run is GATED on operator approval with that estimate stated up front.
- Holdout (public test) stays untouched until a full-train pass.
