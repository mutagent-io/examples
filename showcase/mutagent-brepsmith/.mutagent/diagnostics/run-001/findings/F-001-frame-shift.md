# F-001-frame-shift — abc_0365-thicken

**Verdict: there is no frame shift.** The premise of the failure report is false. `output.step` is in
the input's coordinate frame. The defect is in the **dataset ground truth**, amplified by a
**mislabelling scorer check**. The round-3 "2mm overlap slab" is not causal.

## 1. The measurement that settles it

Measured with the repo's own `.venv` via `cadtools.step_io.import_step_file().bounding_box()`:

| body | bbox min | bbox size (X, Y, Z) |
|---|---|---|
| `input.step` | `(-0.0, -40.0, -40.0)` | `(145.0, 80.0, 165.0)` |
| `ground_truth.step` | `(-0.0, -40.0, -40.0)` | `(145.0, **106.25**, 165.0)` |
| `output.step` (candidate) | `(-0.0, -40.0, -40.0)` | `(145.0, 80.0, **206.25**)` |

All three share an identical minimum corner. There is no translation and no rotation anywhere in
the triple.

The instruction (`edit_description.txt`):

> Increase the overall thickness from 165.0 mm to 206.25 mm by adding 41.25 mm of material on the
> top face. Keep the footprint identical.

- **Candidate**: Z 165 → 206.25, footprint 145×80 unchanged. **Satisfies both clauses exactly.**
- **Ground truth**: Y 80 → 106.25, Z unchanged at 165. **Violates both clauses.**

The answer key contradicts its own question.

## 2. Why the scorer said "frame-disagreement"

`cadtools/scoring.py:340` runs `check_frame_agreement(gt_mesh, candidate_mesh)` as its *first* act
and hard-raises. `check_frame_agreement` (`geometry_diff.py:143-186`) gates on **two** quantities:

```python
centre_delta = norm((ref_lo + ref_hi)/2 - (cand_lo + cand_hi)/2)   # :163
extent_delta = norm((ref_hi - ref_lo) - (cand_hi - cand_lo))       # :164
```

For two bodies sharing an origin corner but differing in size, `centre_delta` is *arithmetically
forced* to be exactly half of `extent_delta`. The score card shows precisely that:

```
centre_delta 24.44710987705213      extent_delta 48.89381762227994
```

and 48.8938 is exactly `norm((145,106.25,165) − (145,80,206.25))` = `norm((0, −26.25, 41.25))`.
Every digit of the "frame" evidence is reproducible from the *sizes* alone. Nothing in it measures
pose.

`FRAME_TOLERANCE_RATIO = 0.10` (`geometry_diff.py:49`) caps any size change at 24.4mm for this
244mm-diagonal part — but the `thicken` recipe family deliberately changes a dimension by 25% of
the Z extent (41.25mm). **The check cannot pass the very edits it must grade.** Its own docstring
at `:46-49` claims otherwise.

## 3. The origin

`cadtools/synthetic_pairs.py:191-200`:

```python
amount = round(bbox.size.Z * 0.25, 3)     # measured on Z
face = _top_planar_face(shape)            # :89-93 — max by center().Z, no normal test
grown = bd.extrude(face, amount)          # grows along the FACE NORMAL
return _solid(shape.fuse(grown)), {"old_thickness": round(bbox.size.Z, 3),
                                   "new_thickness": round(bbox.size.Z + amount, 3)}
```

The magnitude is measured on Z; the direction is whatever the selected face happens to face. This
part's top is a domed cylinder/torus/bspline blend with **no +Z-facing planar face**, so
`_top_planar_face` returns a sideways face and the growth lands in Y. The metadata dict is then
**asserted, never re-measured**, and the instruction is rendered from it.

`validate_manifest` (`manifest.py:86-137`) checks key presence, id uniqueness, tier/edit_type enums
and paths. **No geometric assertion ever connects `ground_truth.step` to the sentence describing
it.** That is the root cause: the pipeline can publish an unsatisfiable pair, and did.

Corroboration: the agent's **round-1** did exactly what the GT recipe does (extrude the max-centre-Z
planar face along its normal) and got the same +Y growth (`report.json:10-11`). The agent then
correctly rejected it as wrong — i.e. **the agent's round-1 was the ground truth**, and rounds 2–3
were the agent reasoning its way *away* from the answer key toward the instruction.

## 4. Why the agent's verify loop could never catch this

`_cmd_verify` (`cli.py:113-123`) calls `check_validity_file` and nothing else. `grep -n frame
cadtools/validity.py` returns **nothing**. Verify has no frame check and no ground-truth access —
it was never the frame authority the failure narrative assumes.

The frame check lives only in `diff` (`cli.py:126-132`) and `score` (`cli.py:135-139`), and `diff`'s
reference is the **input**, never the GT — which the agent does not possess. Structurally, no agent
running this toolchain can detect a GT/instruction contradiction.

## 5. The evaluator's three suspects — all disconfirmed

| suspect | verdict | evidence |
|---|---|---|
| round-3 "2mm overlap slab" | **not causal** | `round-3.py:20-26` sinks the base to `bbox.max.Z - 2.0` and raises height to `amount + 2.0`; the overlap is absorbed inside existing material. Measured candidate `bbox.max.Z = 166.25 = 125.0 + 41.25` exactly. Zero bbox error. |
| reduced `n_samples` (OOM) | **not causal** | `check_frame_agreement` reads `mesh_bbox` only and never calls `sample_surface` (which is invoked separately at `:211-212`). `n_samples` cannot affect it. The scorer also ran reduced (`n_samples: 5000`, `sample_reduction: true`) and flagged identically. |
| `--allow-repose` | **contributory, not causal** | It only flips `require_frame_agreement` in the `diff` path against the *input*; it has no reach into the scorer. It did convert a hard A4 assert into advisory prose in `report.json:44` — a real bypass worth closing (R-004), but the assertion it silenced was itself a false positive here. |

## 6. Decisive scope evidence

armA and armB report `centre_delta 24.44710987705213` / `extent_delta 48.89381762227994` **to the
last digit**. Two independently-run agents — one with the verify loop, one without — converged on
the same instruction-faithful Z-thickened body. A defect in the agent procedure cannot reproduce
identically across both arms; a defect in the shared ground truth necessarily does.

Cluster scope: `frame-disagreement` appears in exactly 3 of 40 score files — armA and armB
`abc_0365-thicken`, plus `armB/abc_0067-fill-hole` (**separate cluster, not analyzed here**).

## 7. Taxonomy

| dim | value | locus |
|---|---|---|
| WHAT | `wrong-output` | a valid, instruction-correct body is scored `0.0` and labelled with a false cause |
| WHY | `spec-mismatch` | ground-truth geometry contradicts the instruction rendered from the same call |
| WHERE | `dataset-generator` | `cadtools/synthetic_pairs.py:191-200` + `:89-93`; amplified at `geometry_diff.py:163-172` and `scoring.py:340-346` |

## 8. Where the defect lives (b)

**Both — but not where the report says, and not in equal measure.**

1. **cadtools / dataset generator (root, ~70%)** — `_thicken` grows the wrong axis and asserts
   unmeasured metadata; nothing validates GT against instruction.
2. **cadtools / scorer (amplifier, ~25%)** — A4 conflates pose with shape, cannot pass a legitimate
   25% dimension change, and hard-zeros before any diagnostic signal is computed, so the failure is
   reported under a cause that does not exist.
3. **Agent procedure (~5%)** — the `--allow-repose` / direct-API downgrade turned a hard assertion
   into narrative prose that reached the ledger as `valid, score 0.85`. Harmless here; a real hazard
   in general. The agent's geometric reasoning was **correct throughout**.

## 9. Ranked remedies

| # | remedy | target | cost | correctness |
|---|---|---|---|---|
| 1 | `R-001-thicken-axis` — extrude along +Z or refuse the sample; re-measure metadata | `cadtools/synthetic_pairs.py:89-93, 191-200` | medium | high |
| 2 | `R-002-gt-instruction-assert` — generation-time GT↔instruction consistency gate | `cadtools/synthetic_pairs.py` (`generate_pairs`) | medium | high |
| 3 | `R-003-separate-pose-from-shape` — size-invariant pose test; `shape-divergence` status | `cadtools/geometry_diff.py:143-186`, `scoring.py:340-346` | medium | medium |
| 4 | `R-004-verify-surfaces-frame` — frame status in `verify`; machine-readable waiver flag | `cadtools/cli.py:113-132` | low | medium |

Full `rationale` / `whyWorks` / `applyInstructions` / `assumptions` per remedy are in
`F-001-frame-shift.json`.

## 10. Regression-test recipe (reproduces this exact miss)

Add to `tests/test_synthetic_pairs.py` — **each must FAIL on the current tree**:

```python
def test_thicken_grows_z_not_a_side_face(domed_top_part):
    """abc_0365 regression: a part whose top is a dome has no +Z-facing planar face.
    _top_planar_face returns a SIDE face, so extrude() grows Y while the metadata
    claims Z. Fails today: gt Y 80 -> 106.25, Z unchanged at 165."""
    gt, meta = _thicken(domed_top_part)
    b0, b1 = domed_top_part.bounding_box(), gt.bounding_box()
    assert b1.size.Z == pytest.approx(b0.size.Z + meta["amount"], abs=1e-3)
    assert (b1.size.X, b1.size.Y) == pytest.approx((b0.size.X, b0.size.Y), abs=1e-3)


@pytest.mark.parametrize("case", ALL_GENERATED_CASES)
def test_ground_truth_satisfies_its_own_instruction(case):
    """Property test over every emitted pair: the realized GT bbox delta must match
    the metadata the instruction prose was rendered from."""
    inp, gt, meta = load_case(case)
    assert_pair_consistent(inp, gt, case.recipe, meta)
```

Add to `tests/test_geometry_diff.py`:

```python
def test_frame_check_passes_legitimate_large_dimension_change(part_165mm):
    """A 25% Z growth about a SHARED origin corner is not a re-pose.
    Fails today: extent_delta 41.25 > tolerance 23.38 (ratio 0.10 * diagonal)."""
    grown = grow_z(part_165mm, 41.25)          # same bbox min corner
    assert check_frame_agreement(part_165mm, grown).agree


def test_frame_check_still_fails_a_real_repose(part_165mm):
    """Guard against fixing the above by simply loosening the tolerance."""
    moved = part_165mm.locate(bd.Location((200, 0, 0)))   # pure translation
    assert not check_frame_agreement(part_165mm, moved).agree
    spun = part_165mm.rotate(bd.Axis.Z, 90)               # pure rotation
    assert not check_frame_agreement(part_165mm, spun).agree
```

And an end-to-end guard in `tests/test_scoring.py`:

```python
def test_instruction_faithful_candidate_is_not_zeroed_as_frame_disagreement():
    """The exact abc_0365 miss: candidate satisfies the instruction, shares the input's
    origin corner, and is currently scored 0.0 with status 'frame-disagreement'."""
    card = score_editing_files(INPUT_0365, CAND_0365, GT_0365)
    assert "frame-disagreement" not in card.validity_failures
```

The pairing of the two `geometry_diff` tests is the important part: it pins the *distinction*
between pose and shape, so the bug cannot be "fixed" by raising `FRAME_TOLERANCE_RATIO` until the
gate stops firing.

---
*Report-only. No files under `cadtools/`, `runs/`, `datasets/` or `.mutagent/evaluator/` were
modified.*
