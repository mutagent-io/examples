# F-014 — For edits below ~0.1 % of part volume the shape term appears unresolvable; effort there should be redirected to interface and topology

- **Confidence:** medium (mechanism inferred from score algebra; a cheap decisive test is proposed)
- **Scope:** 218, 241, 243, 246 — 4 of 32 samples, mean score 0.377

## Observation

Ranked by relative edit size (`|ΔV| / input volume`, from
`datasets/cadgenbench-data/<id>/input.mesh.npz` + report expected deltas):

| id | dV/vol | run-004 | run-005 | two runs' readings |
|---|---|---|---|---|
| 218 | **0.00015** | 0.3975 | 0.4000 | different features (CONE break vs TORUS fillet) |
| 246 | **0.00028** | 0.4000 | 0.4000 | same solid, two different methods |
| 241 | **0.00057** | 0.2165 | 0.3083 | same feature, different parameter reading |
| 243 | **0.00100** | 0.4000 | 0.4000 | opposite readings (shrink bore vs grow OD) |
| — gap — | | | | |
| 248 | 0.00196 | 0.4000 | **0.9378** | |
| 206 | 0.00200 | 0.4977 | **0.7427** | |
| 205 | 0.00269 | 0.3857 | **0.9975** | |

The four smallest edits in the run are the four that will not move. Immediately above them, three
similarly tiny edits score 0.74–1.00, so **size alone does not cap the score** — but in the
sub-0.1 % band, *four pairs of materially different outputs produced pairwise identical scores*
(246 and 243 to four decimal places).

## Mechanism

`shape = 0.6 · max(0, (d_noop − d_edit) / d_noop)`. The denominator is the distance between the
*input* and *ground truth* — i.e. it is proportional to the size of the requested edit. Two
consequences pull in opposite directions:

- **Amplification:** a correct tiny edit scores full shape, because `d_edit → 0`. Renormalization
  removes the size penalty. So "tiny edits are hopeless" is *not* the right model.
- **Resolution floor:** when `d_noop` falls to the sampling/tessellation noise of the shape metric,
  the ratio is dominated by noise and clamps to 0 for every candidate. This is the only hypothesis
  consistent with the internally contradictory signature these samples carry: **interface and
  topology score FULL (the 0.4000 constant) — meaning the output's B-rep interface matches ground
  truth exactly — while shape reads as no better than a no-op.** An output whose interface matches
  ground truth cannot plausibly have a geometry that is worse than the unedited input.

Corroborating calibration: a genuine no-op does **not** score 0.4000 — run-004's 201 no-op scored
**0.3256** — so 0.4000 is not a "did nothing" constant; it is specifically "interface and topology
perfect, shape unresolved".

## Distinguishing this from a genuine wrong-side error

238 also scores exactly 0.4000 but its edit is **3.8 %** of the body — far above the band — and its
shape term is genuinely clamped by `max(0, ·)` because the output is *worse* than a no-op
(F-010). The two causes of an exact 0.4000 are separated by edit size:

- `dV/vol < ~0.1 %` → unresolvable (this finding)
- `dV/vol > ~1 %` → genuinely wrong-signed / wrong-side reading (F-010, F-013 Population A)

## Cheap decisive test (recommended before acting)

Submit, in the next scored run, a **deliberate no-op** for one Population-B sample (246 is the
cleanest — unique feature, no interpretive doubt, both runs already produced the same solid). If
the no-op also returns ≈ 0.400, the resolution floor is confirmed and the strategy below is
correct. If the no-op returns markedly lower (as 201's did, 0.3256), then 246's 0.400 is a real
interface/topology gain earned by the edit and the shape term is telling us the reading is wrong
after all — in which case F-013's ranked candidates for 246 apply. Cost: one sample-slot in a
pilot run; value: settles the strategy for 4 of 32 samples.

## Remedy candidate — R-014 · size-tiered effort allocation

Compute `dV/vol` from the expected delta **before** implementation (the agent already derives the
expected delta up front on 32/32 samples — F-009 C) and branch:

- **`< 0.1 %` — precision tier.** Interpretation budget: minimal (one grounded reading, no
  candidate-carrying). Implementation budget: maximal, aimed squarely at the 0.4 that *is*
  reachable — zero collateral change: no `BRepAlgoAPI_Defeaturing` whole-body rebuilds (218 round 1
  rebuilt the entire body), no repair cuts far from the edit, no waived tolerance widening
  (241 widened volume-intent from 2 % to 5 % and is the lowest-scoring sample in the run at 0.3083),
  no residual slivers. Every mm³ of collateral change is comparable in size to the edit itself.
- **`0.1 % – 1 %` — normal tier.**
- **`> 1 %` — interpretation tier.** Side/placement choice dominates; apply the hedge (F-010 R-010a)
  and candidate-carrying (F-006 R-006).

Cost: low. Correctness: medium — pending the no-op test above.
