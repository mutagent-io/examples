# F-011 — REGRESSION 214 (0.8620 → 0.5632): the "more physical" reading extended the edit past the feature's own boundary

- **Confidence:** medium-high (target and parameter are identical across runs; only the boundary
  treatment differs, and run-005 names the discarded alternative verbatim)
- **Scope:** −0.2988
- **Instruction:** *"Shrink the diameter of the largest bore in this part by 5mm."*

## Both runs agreed on everything that the instruction states

| | run-004 | run-005 |
|---|---|---|
| target | r = 48.425314513698 bore, axis (21.437, 35.985) | r = 48.4253 bore, axis (21.437, 35.985) |
| new radius | 45.925314513698 (−2.5 mm radius = −5 mm dia) | 45.9253 |
| operation | annular sleeve fused on (add material) | annular sleeve fused on (add material) |
| axial extent | **Z −23.970 … 30.030 (depth 54 mm)**, expected ΔV **+40,015.5 mm³** | **z −23.9702 … 32.0298 (depth 56 mm)**, expected ΔV **+41,512 mm³** |
| top fillet (2 mm, torus R=50.4253) | **left in place** | **carried inward with the wall, "keeps its 2 mm radius"** |
| collateral | 61 unrelated analytic faces destroyed by `BRepAlgoAPI_Fuse` same-domain unification (waived, unresolved in 5 rounds) | 1 CYLINDER + 1 TORUS destroyed, within allowance; all checks pass in round 1 |
| official score | **0.8620** | **0.5632** |

Sources: `runs/eval-run-004/armA/214/report.json` (`interpretation`, `round_summary`,
`verify.surface_type_conservation`); `runs/eval-run-005/armA/214/report.json`
(`interpretation.chosen`, `rejected_readings[3]`, `rounds[0]`).

## What run-005 changed, and why

run-005 explicitly rejected run-004's treatment:

> `rejected_readings[3]`: "Leaving the top fillet in place and creating a 2.5 mm ledge at z=30.03:
> **rejected as less physical**; it also leaves the fillet dangling on a diameter that no longer
> exists. **Volume difference between the two readings is 1495 mm³ (0.08 % of the part).**"

The two consequences of that choice: the sleeve grew from 54 mm to 56 mm of axial extent (the
bore's stated top moved from z=30.030 to z=32.0298, i.e. through the fillet band up to the top
face), and the fillet's footprint on the stationary top face moved inward by 2.5 mm.

## Why it cost 0.30 when the volume difference is 0.08 %

Decomposing against the scoring model: 0.8620 ⇒ shape ≈ 0.770; 0.5632 ⇒ shape ≈ 0.272 (assuming
interface and topology full in both, which run-005's clean check results support and run-004's
61 destroyed faces argue *against* — so if anything run-004's shape advantage is even larger). A
0.08 % volume difference produced a ~0.50 collapse in renormalized shape.

That is only possible because the shape term is **renormalized against the no-op**: the
denominator is the (small) difference between the input and ground truth, i.e. exactly the sleeve
band. Errors are therefore measured *relative to the size of the requested edit*, not relative to
the part. A 1495 mm³ error against a ~40,000 mm³ edit is a ~3.7 % error of the *denominator*
concentrated entirely at the feature boundary — and it is placed on material that ground truth
almost certainly did not touch (the bore mouth and the top face's imprint ring).

Two corollaries worth carrying forward:

1. **Face-topology cleanliness is not worth much.** run-004 destroyed 61 unrelated faces, burned
   5 rounds failing to fix it, waived the check — and still beat run-005's surgically clean
   round-1 result by 0.30. Same-domain face unification changes the B-rep bookkeeping, not the
   geometry; the grader scores geometry. run-005's own instinct here was right (F-009), but the
   *priority* is wrong: never trade geometric extent for face-count tidiness.
2. **"More physical" is not a scoring argument.** A designer's parametric edit in the authoring
   CAD system would indeed carry the fillet — but ground truth is a specific STEP file, and the
   evidence says it did not.

## The rule that would have prevented it

**R-011 — Do not extend an edit beyond the named feature's own measured extent.**
> The bore's own cylindrical faces span z −23.970 … 30.030. Anything outside that span (the fillet
> band z 30.03…32.03, the top-face imprint ring) belongs to an *adjacent* feature that the
> instruction did not name. Change the named parameter over the named feature's measured extent
> and stop; let the adjacent geometry produce whatever ledge or step results.

This is the same boundary condition derived independently in **F-008** (a blend travels with its
parent wall only if every surface it is tangent to also moves — here the fillet is tangent to the
stationary top face). The two findings agree, which raises confidence in the boundary test.

**R-011b — when two readings differ only in a boundary treatment and their volume difference is
< ~5 % of the edit, build both and prefer the one with the smaller axial/radial extent.** They are
cheap to build (run-005 produced its version clean in one round) and the score difference between
them is large.

## Cost / correctness

- R-011: cost low (it is an extent measurement the agent already performs); correctness
  medium-high — one decisive sample, but it agrees with F-008's independently derived boundary
  test and the mechanism is quantitatively consistent.
- Immediate action for a re-run of 214: **revert to run-004's treatment** (sleeve over the bore's
  own 54 mm span, fillet left in place, ledge accepted) while keeping run-005's clean boolean
  recipe. Expected ≥ 0.86.
