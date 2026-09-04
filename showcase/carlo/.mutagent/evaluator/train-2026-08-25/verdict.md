# CARlo ③ EVALUATE — FULL TRAIN SPLIT verdict (2026-08-25)

129 tasks × 3 trials × 2 arms, concurrency 8, Vertex ADC. Build: through – (ed9a643+).
Config: winning smoke config (gates on, groundedness off).

## GATE: **FAIL — decisively. The scaffold hurts the backbone on the full split.**

| Pass^3 | base | hallucination | disambiguation | **overall** | Pass@3 |
|---|---|---|---|---|---|
| raw gemini-3.5-flash | 0.72 | 0.46 | 0.48 | **0.566** | 0.752 |
| CARlo | 0.44 | 0.42 | 0.26 | **0.388** | 0.659 |

- CARlo is below baseline on EVERY family (−0.28 base, −0.04 hallucination, −0.22 disambiguation).
- The 15-task smoke slice (CARlo 0.93 vs 0.87) was systematically unrepresentative: first-5
  tasks per family are far easier than the tail, and two optimize iterations tuned against it
  OVERFIT the slice. The eval discipline caught this before any external claim — that is the
  system working, and the reason the holdout was never touched.
- Context: raw flash-3.5 at 0.566 train ≈ published leaderboard #1 (Opus 4.6 0.58, all-254).
  First known flash-3.5 measurement on CAR-bench.
- Competition context (concluded IJCAI Challenge 2026, hidden set): Track-1 winner 0.70
  (GPT-5.6 Sol); runner-up "Thylinao" 0.667 with Gemini 3.5 Flash and a MINIMAL harness
  (temp-0, live-schema validation + in-turn retry, behavior rules; no policy/redirect
  machinery). Hypothesis for diagnosis: less scaffold, more model.

## Cost — significant overrun, flagged

Full-train run ≈ **$112** vs the ~$35–45 estimate (cumulative ADL spend now **$119.50**).
Driver: harness-side agent cost on the baseline arm (stock agent's planning-tool loops on hard
tasks; litellm response_cost) + longer conversations on hard tasks in both arms. The per-task
smoke figures extrapolated badly. Lesson recorded: estimate from per-family mean cost on a
REPRESENTATIVE sample, not the easy head.

## Assets produced

- Definitive two-arm, per-trial corpus: results/train/{baseline,carlo}/*_train/*_full.json
- ~230 failing CARlo trials with full trajectories + per-turn gate traces (carlo/traces/)
- The raw-flash baseline anchor per family (the real bar)

## Disposition

Route to ④ DIAGNOSE with the full corpus. Key questions:
1. Which gates fire on the hard-tail tasks and with what outcome distribution (the smoke
   diagnosis saw only the easy head)?
2. Failure taxonomy on base: gate-interference vs turn-budget vs conversation derail.
3. What does Thylinao's minimal harness do differently (mine reports/track_1/team-28.pdf)?
4. Ablation candidate: CARlo-minimal (schema-validate + retry + honest-limit ONLY; policy
   pre-check, redirects, verify, prose gates OFF) as a cheap A/B on a REPRESENTATIVE sample.
