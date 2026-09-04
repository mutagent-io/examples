# ⑤ OPTIMIZE loop — closing report (2026-08-24)

Bundle – applied and verified. Loop shape: WRITE (–) → JUDGE (rescore-002) → WRITE (residual) → converged.

## Converged verdict (clean set, n=13 — slice minus unsatisfiable-GT minus contaminated)
- harness 0.7750 vs single-shot baseline 0.6582 → **+0.1168, beats_baseline: true**
- All 26 clean outputs status `ok`; scorer upgrade proven value-neutral (deltas ≤1e-9)
- Last frame-flag (armB/abc_0067) re-adjudicated: pose false positive, independently
  invalid — zero stands with corrected cause label
- GATE (revised): **pass on the clean set** — with named scope limits below

## Measurement integrity now enforced, not hoped
- GT↔instruction consistency gate at generation (6/19 thicken GTs refused as unsatisfiable)
- Harness-computed round scores; agent self-scores refused; checks_passed gates emission
- Surface-type conservation + wired locality checks; size-invariant pose test;
  machine-readable waivers; isolation audit (AST) that blocks aggregation
- Eval profile cannot import the generator (devtools wheel split)
- Ledger budget waste fixed (was 14.7%); memory-budgeted proximity on diff AND score paths

## Named follow-ups (outside this loop's bounds)
1. Dataset repair: rework the 6 unsatisfiable thicken cases (recipe refuses those parts —
   either new parts with +Z planar tops or an axis-aware recipe variant)
2. spec cascade: operation-class clause into the prompt region via *sync-spec
   (staged in appendix; definition change needs the spec owner)
3. Arm-B observability: baseline runs must retain their scripts for isolation audit
4. C1 criterion candidate (operation-class-fidelity): batch-check before adoption
5. Scale-up: full 86-triple run + real-inputs proxy slice under the isolated eval profile,
 then the Opus-5-xhigh arm for the leaderboard attempt
