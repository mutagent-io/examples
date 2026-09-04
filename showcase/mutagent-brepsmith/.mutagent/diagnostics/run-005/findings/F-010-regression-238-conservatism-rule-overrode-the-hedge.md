# F-010 — REGRESSION 238 (0.7772 → 0.4000): the "fewest entities changed" rule was applied to an interpretation choice it does not govern, and it discarded a winning hedge

- **Confidence:** high (the discarded reading is named verbatim in run-005's own report)
- **Scope:** −0.3772, the single largest loss in the run
- **Instruction:** *"Decrease the overall thickness of the part by 5mm from 55mm to 50mm."*

## What each run chose

**run-004 — symmetric trim (score 0.7772).**
> "No single face is named, so the SYMMETRIC reading was used: 2.5 mm trimmed from each of the top
> (z=27.5) and bottom (z=−27.5) faces, giving new bounds −25..25 (50 mm total), **preserving the
> part's Z-centerline — the most conservative distribution given no directional cue in the
> instruction.**"

run-004 also *built and rejected* the asymmetric variant in round 2: "A round-2 asymmetric trial
(all 5 mm removed from one face only) was also tried and produced an identical destroyed-type
profile (part is Z-symmetric top/bottom)" — i.e. run-004 saw both, and kept the hedge.
(`runs/eval-run-004/armA/238/report.json`)

**run-005 — top-only cut (score 0.4000, shape clamped to zero).**
> `convention_used`: "No face is named, so the material comes off the +Z ('top') side, **the
> conventional up-direction**; the bottom face stays where it is."

## Why run-005 abandoned the winning reading — it is on the record, verbatim

run-005 evaluated the symmetric reading and rejected it explicitly
(`runs/eval-run-005/armA/238/report.json` → `interpretation.rejected_readings[1]`):

> **reading:** "Remove 2.5 mm from the top AND 2.5 mm from the bottom (symmetric, preserving the
> part's near-mirror symmetry about z=0)"
> **why_rejected:** "changes twice as many entities as a one-sided cut and destroys detail on BOTH
> faces. **It was a serious contender** — the part is nearly mirror-symmetric about z=0 (top face
> 2677.0 mm² vs bottom 2675.8 mm²) and **this reading hedges a wrong-side guess** — but **the
> conservatism rule is fewest entities changed.**"

And `rejected_readings[3]`:

> "Take the 5 mm off the −Z side instead: geometrically the mirror of what was done; **nothing in
> the model marks one face as the reference** (both are planes with normal (0,0,1), areas 2677.0
> and 2675.8 mm²). +Z was chosen by the up-direction convention and the choice is recorded here."

So: run-005 correctly identified that (a) the side choice was unmarked, (b) the symmetric reading
hedges it, and then broke the tie with an **entity-count** heuristic and an **up-direction
convention** — neither of which has any relationship to the scoring function.

## Reconstructing the ground truth from the two scores

The scoring model is `0.6·shape(renormalized vs no-op) + 0.3·interface + 0.1·topology`.

- Top-only cut → **0.4000** exactly ⇒ interface and topology FULL, shape clamped to **0**, i.e. the
  output is no closer to ground truth than doing nothing (`max(0, ·)` is active).
- Symmetric cut → **0.7772** ⇒ shape ≈ (0.7772 − 0.4)/0.6 ≈ **0.629**.

If ground truth had been a top-only cut, run-005's output would score ≈ 1.0, not 0.400. If ground
truth had been symmetric, run-004's output would score ≈ 1.0, not 0.777. The only reading
consistent with both numbers is that **ground truth removed the 5 mm from the −Z side**: the
symmetric hedge is then half-right everywhere (2.5 mm of 5 mm on the correct face) and earns ~63 %
of the shape headroom, while the top-only cut is maximally wrong — it leaves the bottom 5 mm of
material that GT removed *and* removes the top 5 mm that GT kept, displacing essentially the whole
body 5 mm in Z relative to GT and scoring worse than a no-op.

This is the mechanism that makes side-choice the highest-leverage decision on any
"reduce/increase an overall spanning dimension" instruction: **an unhedged wrong-side guess does
not degrade the shape score, it zeroes it**, because the entire unchanged body is rigidly
displaced relative to ground truth.

## The rule that would have prevented it

Two rules, in priority order.

**R-010a — Hedge unmarked distributions; conservatism is a tie-break for METHOD, not for
PLACEMENT.**
> When two readings differ in *where* material is placed or removed (which face, which side, which
> end) and the instruction names no face, side or direction, choose the **centroid-preserving /
> symmetric** distribution. Entity count, face-destruction count and "conventional up" are
> tie-breakers for *how to build* a chosen change; they must never decide *where* the change goes.
>
> Justification is decision-theoretic and now measured: under an unknown ground truth, the
> symmetric hedge bounds the rigid displacement of unchanged material at Δ/2 and scored 0.629 of
> shape headroom on 238; an unhedged guess is 50 % likely to be maximally wrong and scored 0.000.

Supporting evidence for the hedge across the run: 231 symmetric growth **0.9747**; 249 symmetric
growth **0.6068** (+0.1291 vs run-004); 242 where the instruction *states* "symmetrically along its
axis" **0.8756**; 238 run-004 symmetric **0.7772**. No sample in either run was harmed by choosing
a symmetric distribution.

**R-010b — "Conventional up-direction" is not admissible evidence.**
238 is the only place in run-005 where a *convention about the world* (top = +Z) rather than a
*measurement of the model* decided a geometric placement, and it is the largest loss in the run.
Any `convention_used` field whose justification does not cite a measurement should be treated as
an unresolved ambiguity and routed to the candidate-carrying path (F-006 R-006).

**R-010c — the ratchet (see F-012).** The symmetric reading was in run-004's scored output at
0.7772. A rule of the form *"when the plausible-reading set contains a reading that a previous
scored run used, changing away from it requires positive evidence — a measurement that
contradicts it, not a preference heuristic"* would have blocked this regression outright.

## Cost / correctness

- R-010a: cost low (it is a decision rule, no extra geometry); correctness high (4 supporting
  samples, 1 decisive counterexample, mechanism explained).
- R-010b: cost low; correctness high.
