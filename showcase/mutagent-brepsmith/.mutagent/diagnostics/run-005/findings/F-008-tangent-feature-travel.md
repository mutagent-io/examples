# F-008 — "Tangent features travel with their parent wall" is a real convention, with one boundary condition (Q1)

- **Confidence:** high for the rule; medium for the boundary condition
- **Scope:** 4 wins (+1.12 combined) and 1 regression (−0.30)

## Problem

When a dimension edit moves a wall, the blends tangent to that wall (fillets, chamfers, rounds,
run-outs) can either be **carried along at their original radius** or **left behind / destroyed**.
run-004 usually left them; run-005 rebuilt them. This single implementation convention accounts
for the largest cluster of wins after frame remapping.

## Evidence — where carrying the blend won

| id | run-004 | run-005 | Δ |
|---|---|---|---|
| 230 | "leaving the 4 main-centerline journals **and all fillets/counterweights untouched**" — three independent annulus subtractions | "each pin's radius goes 38.1 → 30.0; **its two 0.64 mm concave web fillets (TORUS R=38.74, r=0.64) are re-created at the new radius (R=30.64)**" | **+0.3936** |
| 231 | symmetric ±5 mm growth of each rib's side planes | same growth, but "the new material **follows the r=44 boss wall and its 2 mm fillet**" | **+0.3059** |
| 217 | bore r 6→7 | "both 45-degree chamfers **translated outward** with the wall" | **+0.5167** (also a frame win, F-007) |
| 249 | symmetric 25→30 | "each flank moves outward 2.5 mm, **carrying its R=2 rounds**" | **+0.1291** |
| 225 | rigid down-translation of the whole boss column | "cut at z=24 and **re-filleted with their original 3 mm top round**" | **+0.1710** |

Sources: `runs/eval-run-005/armA/{217,225,230,231,249}/report.json` → `interpretation.chosen`;
`runs/eval-run-004/armA/{225,230,231,249}/report.json`; `batch2-summary.json`.

230 is the cleanest controlled comparison in the whole dataset: **identical target, identical
radius change, identical operation class**, differing only in whether the 0.64 mm web fillets were
rebuilt at the new radius. Worth **+0.394**.

## Boundary condition — where carrying the blend LOST (214)

214 shrank the same bore (r 48.4253 → 45.9253) in both runs. run-005 additionally carried the
bore's **2 mm top-edge fillet** inward with the wall, explicitly rejecting the alternative:

> "Leaving the top fillet in place and creating a 2.5 mm ledge at z=30.03: rejected as less
> physical; it also leaves the fillet dangling on a diameter that no longer exists. Volume
> difference between the two readings is 1495 mm³ (0.08 % of the part)."

Score: **0.8620 → 0.5632 (−0.2988)**. The rejected reading is what run-004 did.

**The distinguishing property:** in 230/231/249/217 the blend is tangent to the moved wall **and**
to another surface that also moves (or to nothing fixed). In 214 the blend is a *mouth break* —
tangent to the moved bore wall **and** to a stationary datum plane (the top face at z=30.03/32.03).
Carrying it dragged the bore mouth 2 mm further up the axis and moved material at a fixed datum.

**Refined rule:** a blend travels with its parent wall **iff** every surface it is tangent to also
moves. If it is tangent to a face that the instruction does not move, keep its footprint on that
face and accept the resulting ledge/step.

## Remedy candidate — R-008

Encode the rule as a mechanical adjacency test rather than a judgement call: for each blend face
adjacent to a moved face, enumerate its tangency neighbours; carry it only if the neighbour set
⊆ moved set. Otherwise pin it. Record the test result in the report. Cost: low (topology query
only). Correctness: high for the carry case (5 samples), medium for the pin case (1 sample).
