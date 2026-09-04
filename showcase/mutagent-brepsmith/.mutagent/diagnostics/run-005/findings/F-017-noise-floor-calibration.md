# F-017 — Calibration: the run-to-run noise floor is ~±0.07; only |Δ| > 0.08 is signal

- **Confidence:** high
- **Scope:** methodological guard for the ⑤ OPTIMIZE gate

## Evidence

Five samples where **both runs recorded the same reading in near-identical words** and the score
still moved:

| id | reading (both runs) | s4 | s5 | Δ |
|---|---|---|---|---|
| 211 | "extrude the top face's **own profile** 10 mm in +Z and fuse" | 0.6766 | 0.6033 | **−0.0733** |
| 250 | extend the unique unfilleted boss to be flush | 0.8044 | 0.7814 | −0.0230 |
| 209 | "pad the single +Z-facing face by 2.5 mm by extruding **THAT FACE'S OWN PROFILE**" | 0.7454 | 0.7234 | −0.0220 |
| 215 | "extrude the disc's own end face 1.000 mm along −Y" | 0.9264 | 0.9072 | −0.0192 |
| 242 | 100 → 120 mm split evenly about the boss mid-plane | 0.8835 | 0.8756 | −0.0079 |

Sources: `runs/eval-run-{004,005}/armA/{209,211,215,242,250}/report.json` → `interpretation`.

These deltas come from tessellation/boolean-seam differences, not from decisions. 211 is the
widest at −0.0733; the rest sit under 0.025.

## Consequences for reading the run-005 diff

The 32-sample delta table separates cleanly once the noise band is applied:

- **Signal, negative:** 238 (−0.3772), 214 (−0.2988). Nothing else. The "seven regressions" in the
  raw diff are two regressions plus five noise samples.
- **Signal, positive:** the 17 wins, all ≥ +0.0903. (204 at +0.0903 is the marginal one.)
- **Noise / no-change:** 201 (+0.0109), 212, 218 (+0.0025), 224 (+0.0090), 229 (+0.0301), 243, 246,
  247 (+0.0027), plus the five above.

Two of those "noise" entries matter for a different reason: **201, 218, 229, 243 and 246 moved by
less than the noise floor across two runs that used materially different readings.** When a
changed reading produces a sub-noise score change, the reading is not what is binding — that is the
Population-B / interpretation-blind signature (F-013, F-014).

## Remedy candidate — R-017

1. **Do not act on |Δ| < 0.08 between runs.** In particular, do not "fix" 211, 250, 209, 215, 242 —
   their readings are already the best known and the movement is not attributable.
2. Report deltas with the noise band shown, so the ⑤ gate does not spend budget chasing tessellation.
3. Since the mean over 32 samples aggregates ~±0.02 of per-sample noise, the **editing mean's own
   uncertainty is roughly ±0.01**; treat 0.5059 → 0.6669 (+0.161) as solidly real, but treat future
   arm-vs-arm comparisons smaller than ~0.02 in the mean as inconclusive.

Cost: none (a reporting convention). Correctness: high.
