# CARlo ③ EVALUATE — post-remedy verdict v2 (2026-08-25)

Corrected build (through ed9a643 + a72b791). Same 15-task × 3-trial smoke slice.

## Pass^3 scorecard

| | base | hallucination | disambiguation | overall |
|---|---|---|---|---|
| raw Flash (bar) | 1.00 | 0.80 | 0.80 | **0.87** |
| CARlo pre-remedy | 0.40 | 0.60 | 0.60 | 0.53 |
| CARlo v2, groundedness OFF | 0.80 | **1.00** | 0.60 | **0.80** |
| CARlo v2, groundedness ON | 0.80 | **1.00** | 0.60 | **0.80** |

GATE: **still FAIL on beats-flash-baseline overall (0.80 < 0.87)** — but:
- hallucination is SOLVED: 1.00 across 4 consecutive runs/configs (baseline 0.80) — the
  scaffold's core purpose works and is robust.
- overall +0.27 over pre-remedy; groundedness now neutral (its earlier gains are subsumed by
  the corrected prose gate; keep OFF as default pending wider-split evidence).

## Cost (first token-accurate run: carlo-v2-gon)

- CARlo full-scaffold: backbone $1.2024 + harness side $0.0398 ≈ **$1.24 / 45 sessions ≈ $0.028/task**
- raw-Flash baseline arm: $1.88 / 45 sessions ≈ $0.042/task → **CARlo is ~34% CHEAPER than the
  stock harness agent** (its planning-tool loop is token-hungry) while scoring within 0.07.
- cost-below-frontier: PASS by orders of magnitude (frontier runs are dollars/task).
- Cumulative ADL benchmark spend to date: **$3.28**.

## Residual failure cluster (ONE shape left)

base_0 · disambiguation_0 · disambiguation_8 — all `OUT_OF_SCOPE`/`DISAMBIGUATION_ERROR` with
missing sunroof/sunshade/fog-light actions: the prose feasibility gate STILL over-fires
intermittently in weather-conditional confirmation dialogues (now sampling-dependent, e.g.
base_0 v2-gon [1,1,0] — was hard-fail before). The ed9a643 fix removed most but not all
over-suppression. Next optimize iteration: deep-read the 3 residual trajectories, likely
further narrow the prose gate (weather/sunroof interplay), re-run slice.

## Disposition
Enter ⑤ OPTIMIZE (bounded loop) on the residual cluster, then the full 129-task train run +
public-test holdout milestone.
