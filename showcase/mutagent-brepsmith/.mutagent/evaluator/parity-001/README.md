# parity-001 — local proxy scorer vs OFFICIAL cadgenbench scorer

Date: 2026-08-25 · Official package: `cadgenbench 0.1.0` installed from
`git+https://github.com/huggingface/cadgenbench` into the isolated venv
`.venv-cadgenbench` (project env untouched).

## What was run

8 (arm, fixture) pairs from `rescore-002` (candidate = `runs/eval-run-001/<arm>/<id>/output.step`,
GT = `datasets/synthetic-edit-pairs/cases/<id>/ground_truth.step` — we hold GT, so the private
GT repo was not needed). For each pair the OFFICIAL code paths were called directly:

- validity gate: `cadgenbench.common.validity.analyze_step` (same gate as
  `sanity_check_submission.py`)
- shape: `cadgenbench.eval.shape_similarity.compare_step_files(align=True)` (official ICP alignment)
- topology: `cadgenbench.eval.topo_match.topo_match` (Betti b0/b1/b2)
- editing renormalization: `compute_edit_baseline(input.step, gt.step)` +
  `renormalize_shape` (official no-op baseline, computed here since our fixtures ship no
  committed `edit_baseline.json`)
- final score: `cadgenbench.eval.evaluate._cad_score` with `EDITING_AXIS_WEIGHTS`
  (shape .6 / interface .3 / topology .1; interface absent ⇒ weights renormalize over 0.7 —
  identical convention to our `cad-score-proxy/v1:interface-null-renormalized-0.7`).

Driver: `run_official.py` (runs in `.venv-cadgenbench`); merge + stats: `build_report.py`.
Raw official output: `official_raw.jsonl`; merged per-pair: `records.jsonl`; stats: `summary.json`.

## Headline results

| pair | proxy | official | note |
|---|---|---|---|
| armA/abc_0228-boss-union | 1.0000 | 1.0000 | exact |
| armA/abc_0285-hole-pattern | 0.0514 | 0.0514 | exact |
| armA/abc_0396-corner-fillet | **1.0000** | **0.2996** | DISAGREE — renorm instability, see below |
| armA/abc_0397-thicken | 0.1429 | 0.1429 | exact (both renorm shape to 0) |
| armB/abc_0067-fill-hole | **0.0000 (invalid)** | **0.1429 (valid)** | validity DISAGREE, see below |
| armB/abc_0152-through-hole | 0.0229 | 0.0229 | exact |
| armB/abc_0374-through-hole | 0.9772 | 0.9682 | close |
| armB/abc_0380-boss-union | 1.0000 | 1.0000 | exact |

- Validity verdict agreement: **7/8**.
- Final score (7 both-valid pairs): Pearson 0.85, Spearman 0.75, mean |Δ| 0.10; 5/7 agree to 4 dp.
- Spearman over all 8 (invalid as 0): 0.73.
- Per-axis (n=7): surface ρₛ 0.90 (mean |Δ| 0.076), volume IoU ρₛ 0.94 (0.040),
  raw shape ρₛ 0.75 (0.058), no-op baseline ρₛ 0.93 (0.016), renormalized shape
  ρₛ 0.73 (mean |Δ| 0.118, max 0.817), topology (Betti) **identical on all 7** (ρ = 1.0, Δ = 0).

## Disagreement cases

### 1. armB/abc_0067-fill-hole — validity verdict flips (proxy invalid, official valid)
Our scorer rejects with `tessellation is not closed (3F != 2E; open boundary in the mesh)`.
The official `analyze_step` reports `is_valid=True, watertight=True` and the official
topo pipeline meshes it into a closed manifold (1866 triangles, Betti 1/0/0). Our
tessellation-closure gate is stricter than the grader's (likely a deflection/mesh-parameter
difference in our mesher). Impact bounded: official still renormalizes shape to 0
(raw 0.266 < baseline 0.516), so the official score is the topology-only floor
0.1/0.7 = 0.1429 vs our hard 0. This case had been excluded from the rescore-002 clean set
as `contaminated_armA`, but the armB verdict itself is a real scorer divergence.

### 2. armA/abc_0396-corner-fillet — renormalization instability near b_shape → 1
Proxy: raw shape 1.0000, baseline 0.9970 → renorm 1.0. Official: raw 0.9640,
baseline 0.9559 → renorm 0.1828 → score 0.2996. The raw-shape numbers differ by only
0.036 and the baselines by 0.041 (well within cross-implementation sampling/alignment
noise), but with headroom (1 − b) of only 0.004 (ours) / 0.044 (official) the renormalized
axis amplifies that noise to a 0.70 final-score gap. Note the official authoring gate exists
precisely to reject fixtures with too little headroom — by our own baseline this fixture has
~0.3% headroom and would likely be rejected at official authoring time. Treat tiny-edit
fixtures (corner-fillet on small parts) as renorm-unstable in our harness.

### 3. armA/abc_0397-thicken — component-level divergence, same final score
Official raw shape 0.700 (0.727, IoU 0.673) vs proxy 0.369 (0.345, IoU 0.393) —
the largest component gaps in the set, plausibly because the official pipeline ICP-aligns
the candidate before scoring while the geometry here is displaced. Both implementations
still floor the renormalized shape at 0 (raw < baseline 0.888/0.902), so both report
exactly 0.1429. Component parity is weaker than final-score parity on displaced bodies.

## Ordering disagreements (final score)

- (armA/abc_0396-corner-fillet, armB/abc_0374-through-hole): proxy 1.0 > 0.977;
  official 0.300 < 0.968 — order flips (driver: case 2 above).
- (armB/abc_0067-fill-hole vs armA/abc_0285-hole-pattern and vs armB/abc_0152-through-hole):
  order flips because proxy hard-zeros the case official deems valid (case 1 above).

All other pairwise orderings agree.

## Honest limitations / what was NOT comparable

- **Interface axis**: not comparable — our fixtures have no jig sub-volume files, so
  `interface_score` has no inputs on either side. Both scorers drop the axis and renormalize
  over 0.7; the convention matches, the axis itself is untested.
- **Official end-to-end `evaluate_result`** was not invoked as-is (it also produces renders /
  turntables); the metric math was called through the same functions it uses
  (`compare_step_files`, `topo_match`, `renormalize_shape`, `_cad_score`). One deviation:
  `evaluate_result` derives one shared tessellation deflection from the GT bbox and applies it
  to the candidate; our driver let `analyze_step`/`topo_match` use their per-part defaults.
  This can shift mesh-derived numbers slightly (it did not change any verdict here except
  possibly contributing to case 1).
- **Official no-op baselines** were computed locally with the official function (our dataset is
  not part of the official GT repo, so no committed `edit_baseline.json` exists). The official
  leaderboard would use its own committed baselines for its own fixtures.
- n=8 is a spot check, not a calibration; Spearman on 7–8 points has wide error bars.

## Verdict

The proxy is a faithful stand-in for the official scorer on clear cases (5/8 exact to 4 dp,
topology axis identical everywhere) and diverges exactly where expected: (a) our stricter
tessellation-closure validity gate, and (b) near-zero-headroom editing fixtures where the
no-op renormalization amplifies implementation noise. Recommended follow-ups: relax/align the
mesh-closure gate with `analyze_step`, and flag fixtures with baseline headroom < ~0.05 as
renorm-unstable rather than trusting either scorer's renormalized shape there.
