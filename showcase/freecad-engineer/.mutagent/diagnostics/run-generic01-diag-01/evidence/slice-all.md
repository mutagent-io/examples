# Evidence — slice-all (run-generic01-diag-01)

Entity: `unitf-agent` · model `claude-opus-5` · audience `PRODUCT` · 11 traces · codeAccess=false
Findings JSON: `/tmp/findings-slice-all.json` and `./slice-all.json` (contract gate: PASS, 6 findings)

## Score table (this run vs baseline)

| task | score | geom | spec | volume_diff | area_diff | bbox_diff | surface_types | baseline score |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| freecad-8450a6402b (elbow flange) | 0.153 | 0.083 | 1.000 | 46.921% | 23.611% | 12.667% | 0.827 | 0.152 |
| freecad-b55517ee4b (disk brake) | 0.167 | 0.091 | 1.000 | 6.461% | 13.348% | 12.500% | 0.911 | **1.000** |
| freecad-e50de66084 (bearing inner ring) | 0.503 | 0.336 | 1.000 | 17.743% | 2.190% | 9.261% | 0.669 | 0.503 |
| freecad-b849a4d94e (rear drive shaft) | 0.589 | 0.418 | 1.000 | 2.951% | 3.437% | 1.282% | 0.983 | **1.000** |
| freecad-740b422c57 (slotted spring pin) | 0.621 | 0.450 | 1.000 | 5.562% | 3.124% | 0.143% | 0.981 | 0.621 |
| freecad-14da78600e (disc spring) | 0.626 | 0.514 | 0.800 | 2.231% | 1.936% | 0.000% | 0.784 | **1.000** |
| freecad-264ab71adf (disc spring w/ flats) | 0.773 | 0.630 | 1.000 | 7.899% | 0.358% | 0.000% | 0.802 | 0.605 |
| freecad-c4bad6c5af (slotted headless pin) | 0.800 | **1.000** | 0.667 | 0.000% | 0.000% | 0.000% | 1.000 | 0.378 |
| freecad-58a1b82005 (spline + smooth shaft) | 0.901 | 0.820 | 1.000 | 0.273% | 0.213% | 0.025% | 0.729 | 0.662 |
| freecad-d733bfa285 (filleted spline) | 0.920 | 0.852 | 1.000 | 0.231% | 0.137% | 0.007% | 0.788 | 0.990 |
| freecad-0fe9d9e3ce (mounting flange) | **0.000** | **1.000** | **0.000** | 0.000% | 0.000% | 0.000% | 1.000 | **1.000** |

## Derived scoring facts (fitted from the 11 reward.json records)

- `score = harmonic mean(geometry_similarity, cad_spec_consistency)`. Verified exactly on
  all 11 rows (e.g. 2·1.0·0.6667/1.6667 = 0.8000; 2·0.0827·1.0/1.0827 = 0.1528). **A zero in
  either sub-metric zeroes the task.**
- `geometry_similarity` ≈ `0.10·surface_types + ~0.32·volume + ~0.43·surface_area + ~0.14·bbox`
  (fitted; weights approximate — see F-slice-all-6 assumption).
- Volume sub-score falls to 0 at ≈ **0.6%** relative difference (0.231% → 0.637, 0.273% →
  0.563, 2.231% → 0.000). Surface-area sub-score falls to 0 at ≈ **6%** (2.190% → 0.660,
  3.437% → 0.464). **Volume is ~10× tighter than area** — the playbook's uniform
  "volume 0.1% / area 1%" understates the volume cliff.

## Cluster map

| cluster | tasks | origin |
|---|---|---|
| Circular analytic cross-check (self-confirming) | 9/11 | system-prompt (playbook §Verification A) |
| Missing free parameter guessed | 8450a6402b | system-prompt (no derivation rule) |
| Verifier spec-zero on perfect geometry | 0fe9d9e3ce | harness-side |
| Convention geometry-correct but spec-lossy | c4bad6c5af | system-prompt (recovery technique not captured) |
| Run-to-run interpretation variance | 7/11 (4 down, 3 up) | system-prompt (no interpretation ledger) |
| Surface-type mix off on spline/disc-spring | 6/11 | system-prompt (family conventions unvalidated) |

## Key verbatim evidence

- `tr a913ea60 msg 104`: «Analytic V : 2007894.9893303823 rel.diff: 8.117030592922681e-16»
  → graded «volume_diff=46.921% (Far)».
- `tr a913ea60 msg 109`: «**Flange thickness is not in the spec.** I assumed a standard **20 mm** plate».
- `tr a913ea60 msg 109`: «`SketchBendOuter` carries a named driving constraint `ElbowAngle` = 90°,
  and both `BendOuter.Angle` and `BoreBend.Angle` are bound to it by expression … the geometry is unchanged».
- `tr 75a0555b msg 26` (agent, on `/app/answer.FCStd`): «consistency_rate=1.000 (6/6 consistent)»
  vs verifier reward.json on the same file: «consistency_rate=0.000 (0/5 consistent, 5 inconsistent,
  0 not_found)». `verifier/test-stdout.txt` is 0 bytes; `reward.txt` is `0.000000`.
- `tr c38c8881 msg 90`: «flanges sit inside the 1000 mm extent, so `shaft_length` is the overall axial length».
- `tr 327a4d5b msg 44`: «The three height parameters are mutually over-determined … so I solved
  `rise + t/cos(atan(rise/b)) = 0.6` for the rise».
- `tr 79a5d994 msg 16`: «the 2 flagged are `chamfer_length` / `chamfer_angle`, deliberately unmodelled
  on this family» → spec 0.667 on an otherwise perfect part.

## Notes

- All 11 traces completed; no partial-emit. Tier 1/2 pattern library produced no loop,
  empty-output, error-spike or token-cap matches; every finding is Tier 3/4.
- `cacheStatus` is `unknown` on all 11 traces — no cache or cost claim is made in any finding.
