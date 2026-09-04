# F-007 — Explicit description-frame → file-frame remapping is the single largest win driver (Q1)

- **Confidence:** high
- **Scope:** 5 of the 17 improved samples; 31 % of the total win mass

## Problem

CadGenBench edit descriptions are written in an authoring frame (typically Z-up or Y-up) that is
frequently **not** the STEP file's frame. run-004 resolved axis words literally in the file frame
and lost whole samples to it; run-005 introduced an explicit `interpretation.frame_mapping` field
and recovered them.

## Evidence

Win mass (sum of the 17 positive deltas) = **+5.916**; net mean gain 0.5059 → 0.6669.

| id | mapping stated in run-005 | s4 | s5 | Δ |
|---|---|---|---|---|
| 205 | `desc X = file Y, desc Y = file X, desc Z = file Z` | 0.3857 | 0.9975 | **+0.6118** |
| 217 | "the instruction's Y is the description frame's up-axis (Y-up vs Z-up export)" | 0.0000 | 0.5167 | **+0.5167** |
| 202 | "The instruction's Z axis is the STEP file's Y axis" | 0.0000 | 0.3963 | **+0.3963** |
| 208 | "the description's X axis is the file's Z axis" | 0.3969 | 0.6119 | **+0.2150** |
| 204 | `desc(X,Y,Z) → file(Z,X,Y)` (cyclic) | 0.4243 | 0.5146 | **+0.0903** |
| 212 | "The description's Y is the file's Z" | 0.9728 | 0.9728 | 0.0000 |
| 218 | frame flip asserted, `axis_discrepancy` | 0.3975 | 0.4000 | +0.0025 |

Subtotal for the five wins: **+1.835 = 31 % of all gain.**
Sources: `runs/eval-run-005/armA/{202,204,205,208,212,217,218}/report.json` →
`interpretation.frame_mapping` / `analysis.frame`; `runs/eval-run-005/armA/batch1-summary.json`.

## The generalizable convention (extracted)

**Solve the frame before solving the feature, and solve it by consistency, not by one clue.**
The run-005 reports that won did all four of these:

1. **Falsify the literal reading first.** 217: "no continuous void exists along Y"; 202: "there
   is no Z-axis bore in this model (12 Z-axis cylinders, all r≤6) and no Z-normal annular face at
   all; taken literally in the file frame the instruction has no referent." A literal reading with
   **no referent** is the trigger to remap — not a preference.
2. **Require a single mapping that satisfies EVERY axis word in the sentence simultaneously.**
   204 is the cleanest example: `desc(X,Y,Z) → file(Z,X,Y)` was chosen because it is the only
   permutation under which "axes collinear with Z", "aligned along the X axis" and "far end in the
   Y direction" are all true at once. One clue is a coincidence; three is a frame.
3. **Prefer permutations/swaps over sign flips.** 205 (an X/Y swap) and 204 (a cyclic rotation)
   were decisive wins. Bare sign flips are much weaker evidence — see the failure below.
4. **Record the mapping as a field**, so downstream steps (locality region, expected-delta
   derivation, invariants) all use one frame.

## Counter-evidence — where the rule must stop (218)

218 applied a **sign flip on the up-axis only** ("no boss protrudes toward +Z… the description's
up-axis is flipped, as in 217") and gained nothing (0.3975 → 0.4000, shape still zero). Its
justification was that the file's +Z face is flat, i.e. an *absence* of the named feature — which
is exactly the "literal reading has no referent" trigger, but with only ONE axis word in the
sentence to constrain it, so the mapping is underdetermined. The render
(`datasets/cadgenbench-data/218/renders/iso.png`) confirms the +Z face is a plain flat teardrop
plate — the observation was right, the inference from it was not decisive.

**Refined rule:** remap only when ≥2 independent axis/direction words in the instruction are
jointly satisfied by exactly one mapping. With a single directional word, treat the flip as a
*candidate* (F-006 R-006), not a conclusion.

## Remedy candidate — R-007

Promote frame resolution to an explicit, mandatory first step with a written decision record:
enumerate all 48 signed axis permutations, score each by how many of the instruction's axis /
direction / "furthest-in" clauses it satisfies against measured geometry, and require a **unique
argmax with margin ≥ 1 clue**. If there is no unique argmax, emit both top mappings as candidates
rather than picking one. Cost: low (pure measurement, no extra booleans). Confidence: high.
