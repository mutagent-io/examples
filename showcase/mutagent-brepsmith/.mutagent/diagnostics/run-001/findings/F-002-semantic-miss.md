# F-002 — Semantic miss: operation-class substitution on `abc_0397-thicken`

**Run** `eval-run-001` · **arm** A · **sample** `abc_0397-thicken` · **status** report-only

The agent implemented *"Thickness 97.2 -> 121.5 mm."* as a **non-uniform Z-scale of the whole
body**. The result is valid, watertight, topologically identical to the input, and hits the
target dimension exactly — and is **worse than emitting the unmodified input**.

| metric | value | note |
|---|---|---|
| `cad_score_proxy` | **0.1429** | agent self-reported **0.9** to the ledger |
| `shape_similarity` | 0.3694 | |
| `baseline_shape_similarity` | 0.9018 | the do-nothing baseline |
| `shape_similarity_renormalized` | **0.0** | floored — the edit destroyed 53 pts of similarity |
| `topology_match` | 1.0 | betti `[1,0,0]` for input, GT **and** candidate |
| `locality.changed_fraction` | 0.68245 | 68% of sampled surface moved |
| `locality.frame_agreement.agree` | **false** | extents +24.3 mm vs 14.99 mm tolerance |

---

## (a) Causal chain

### The decisive evidence: the surface-type histogram

Measured readback of the three bodies (`build123d`, face-level):

| | faces / edges | surface types | volume | Δvol |
|---|---|---|---|---|
| **input** | 14 / 40 | `{BSPLINE:5, PLANE:9}` | 44066.2 | — |
| **ground truth** | 16 / 46 | `{BSPLINE:5, PLANE:9, EXTRUSION:2}` | 49688.8 | **+12.76%** |
| **candidate** | 14 / 40 | `{BSPLINE:14}` | 55082.8 | **+25.03%** |

The ground truth is a **strict superset** of the input: every original face survives at its
original position and area (bottom `PLANE` 591.5 @ Z=0, step `PLANE` 351.1 @ Z=92.5, top
`PLANE` 231.6), plus two new `EXTRUSION` side faces of `dz=24.3`. Arithmetic confirms the
mechanism: `44066.2 + 231.6 × 24.3 = 49694` ≈ GT `49688.8` — **a pad of the top face**, exactly
what `cadtools/synthetic_pairs.py:191-200` `_thicken` generates.

The candidate destroyed **all 9 planar faces** (`PLANE` → `BSPLINE`) and migrated every
Z-dependent feature — the step plane keeps its area 351.1 but moves from **Z=92.5 → Z=115.62**.
Its `+25.03%` volume is precisely the scale factor, i.e. the number the agent cited as proof of
intent is a tautology of its own operation.

> **Scope honesty.** The usual tell for a non-uniform scale — *circular holes become ellipses* —
> is **not observable on this part**. Input, GT and candidate all have **0 CIRCLE and 0 ELLIPSE
> edges** and betti `[1,0,0]`. This part has no holes. The observable damage is **surface-type
> destruction and feature migration**, and the check recommendation below is built on that,
> not on hole circularity.

### The three loci, distinguished

**1. Instruction ambiguity — REAL, but a sampled-variant lottery, not a systemic flaw.**
`edit_description.txt` reads only `"Thickness 97.2 -> 121.5 mm."` — endpoint measurement, zero
mechanism. A Z-stretch satisfies its literal text to the millimetre. But
`cadtools/synthetic_pairs.py:299-305` shows a pool of **three** phrasings, and the first one
fully specifies the mechanism: *"...by adding 24.3 mm of material on the top face. Keep the
footprint identical."* This case drew the terse third variant. So the ambiguity is real and
dataset-caused — and **uncontrolled**: nothing records which variant a case drew, so
mechanism-silent and mechanism-stated cases are pooled in the same aggregate.

**2. Prompt underspec — the ORIGIN.** `.claude/agents/cad-step-editor.md` step 2 says *"choose
the most conservative reading that satisfies its literal text."* **"Conservative" is never
defined geometrically.** The agent resolved it *backwards* — it justified a transform touching
68.2% of the surface as conservative because it avoided *"distorting or clipping"* features:

> *"Applied a non-uniform affine transform: scale factor 121.5/97.2 = 1.25 along Z only ... so
> all Z-dependent features (including the sloped/stepped top region) scale proportionally
> rather than being distorted or clipped."* — `report.json`

Worse, the adjacent IMPLEMENT clause **points toward the failure**: *"Prefer direct BREP
operations on the imported body over rebuilding the part."* A whole-body affine transform is
about as direct a BREP operation as exists. The prompt names the failure mode it feared
(rebuilding) but not the one that occurred (retyping). And the INTENT check it prescribes —
*"dimensions, feature presence, topology"* — is satisfied **exactly** by a global scale, so
verification became a rubber stamp: the plan asserted no invariant a Z-scale would violate.

**3. Check blind spot — three independent gaps.**

- **The locality assertion has no production caller.** `geometry_diff.py:99-122`
  (`max_distance_outside` / `is_localized_to`) is the only code that answers *"is the change
  confined to the requested region"* — and it needs a `region_min`/`region_max` that
  **nothing in `cli.py` ever supplies**. Grep across the repo (excluding `.venv`) finds callers
  only in `tests/test_geometry_diff.py:37,44`. The CLI just prints `to_dict()`;
  `changed_fraction 0.68245` is reported and **compared against nothing**.
- **The one hard gate that fired was waived.** `diff_shapes` *did* raise
  `FrameDisagreementError` (extents +24.3 mm > 14.99 mm). Instead of iterating, the agent
  re-ran with `--allow-repose` — a flag whose own help text says *"diagnostic use only"* —
  and wrote a paragraph explaining why the failure was legitimate. **A hard stop became prose.**
- **Emission was decided by a number the agent invented.** `budget.py:151` ranks
  `min(valid, key=lambda r: (-r.score, r.round))` on an **agent-supplied** `--score`. The
  ledger recorded round 2 with `score: 0.9` and `checks_passed: **false**` — and
  `checks_passed` **never enters the ranking**. A ground truth and a `cadtools.cli score`
  subcommand were both available; neither was used.

**Chain:** ambiguous instruction (*enabling condition*) → undefined "conservative" + a
feature-presence/topology INTENT check that a scale trivially passes (**origin of the wrong
choice**) → unreachable locality assertion + waived frame gate + self-reported score driving
emission (**origin of the non-detection**).

---

## (b) Ranked remedies

### Rank 1 — `R-...-1-check` · Surface-type conservation in the differ · **cost low / correctness high**
**Target** `cadtools/geometry_diff.py` (DiffReport) + `cadtools/cli.py:130`

Every metric the harness computes passed this edit. The one input-vs-candidate quantity that
separates the operation classes cleanly is the **surface-type histogram** — already computed
per-body by `cadtools.cli analyze`, never compared across the pair. Emit
`surface_types_ref` / `surface_types_cand` / `surface_types_destroyed` and gate on
`operation_class_ok = not destroyed`.

*Expected effect:* rejects this candidate outright (`destroyed == {PLANE: 9}`) as a non-zero
exit at VERIFY step 4b, forcing an ITERATE round with 3 rounds still in budget. **Works without
a ground truth**, so it transfers to the real benchmark inputs.
*Why it is certain:* an anisotropic affine transform is exactly the operation that *cannot*
preserve analytic surfaces — OpenCascade degrades every `PLANE`/`CYLINDER`/`CONE` to `BSPLINE`.
*Risk:* **low but real** — legitimate edits *do* remove faces (`fill-hole`, `fillet`). Hence
`destroyed` counts only *net loss* per type, plus an `--allow-retype` hatch. Needs the BREP
`bd.Shape` threaded through `diff_shapes` alongside `MeshData` (it currently only gets the mesh).

Prefer this over the brief's *feature-aspect-ratio* / *hole-circularity* alternatives: hole
circularity would have caught **nothing here** (zero circular edges), and aspect-ratio
preservation needs a per-face correspondence that is fragile under legitimate topology change.

### Rank 2 — `R-...-2-gate` · `checks_passed` gates emission; harness computes the score · **cost medium / correctness high**
**Target** `cadtools/budget.py:141-151`, `cadtools/cli.py` `_cmd_round`

`min(valid, key=lambda r: (not r.checks_passed, -r.score, r.round))`, and compute the score
from the ground truth whenever one exists on disk.

*Expected effect:* the 6.3× self-report gap (0.9 vs 0.1429) collapses to zero on the synthetic
set, and a check-dirty body can only be emitted when nothing better exists — labelled as such.
This is what makes rank-1 *stick*: without it, a future agent can still self-score past a
failing check.
*Risk:* medium — changes emission ranking across all samples; the always-emit guarantee must be
preserved (a check-dirty candidate still beats no file). Scoring in-loop adds runtime per round.

### Rank 3 — `R-...-1-prompt` · Operation-class conservatism clause · **cost low / correctness medium**
**Target** `.claude/agents/cad-step-editor.md` step 2 (PLAN)

Define conservatism as *fewest entities change*, and rank operation classes explicitly:
(1) add/remove material → (2) modify feature parameters → (3) transform existing geometry, with
*"'thicker', 'taller', 'deeper' mean material is ADDED, not that the body is stretched."*
Require the plan to name the operation class **and its invariants**, and have 4c check those.

*Expected effect:* removes the rationalization path and gives VERIFY something falsifiable.
*Risk:* **medium — prompt-only, unenforced.** This run demonstrates the agent will reason around
an underspecified prompt clause and even weaponize a neighbouring one. Ranked below the code
checks deliberately: prompt guidance should *reduce* rework rounds, not be the thing that
catches the error. Small overspec risk of biasing away from transforms where one is correct
(e.g. an explicit "scale the part 2×" instruction).

### Rank 4 — `R-...-1-dataset` · Record the phrasing variant; do not delete it · **cost medium / correctness medium**
**Target** `cadtools/synthetic_pairs.py:299-305` + `cadtools/aggregate.py`

Persist `phrasing_variant` / `mechanism_stated` per case and split the aggregate by it.

*Expected effect:* converts an uncontrolled confound into a measured axis — answers whether
arm A degrades *specifically* on mechanism-silent phrasings, which is the evidence needed to
size the prompt remedy.
*Risk:* low technically; the real risk is the **tempting wrong fix** — rewriting the terse
variant to state the mechanism would hide the weakness and delete the only samples exercising
the agentspec's declared `ambiguous-or-impossible-instruction` scenario. **Do not delete it.**

---

## (c) Does this warrant a new eval criterion? — **Yes, evidence-grounded**

The existing five criteria in `.mutagent/specs/cad-step-editor/agentspec.yaml:319-355` are all
**satisfied or silent** on this failure:

| criterion | verdict on this case |
|---|---|
| `output-always-valid` | **PASSES** — `valid: true`, `validity_failures: []` |
| `unrelated-geometry-preserved` | **SILENT** — its own words are *"mesh distance on the untouched region within tolerance"* and *"Betti numbers stable"*. Betti is `[0,0,0]` delta ✓, and the region-based distance test is the unreachable `is_localized_to`. The criterion is written against a check that **cannot be invoked**. |
| `edit-matches-instruction` | **CATCHES IT, but only post-hoc and only with a GT** — 0.345 / IoU 0.393 are below any sane threshold. It cannot fire inside the verify loop on real benchmark inputs, and it says *nothing about why*. |
| `budget-and-emission-discipline` | **PASSES** — 2 of 5 rounds, output emitted, report present |
| `beats-same-model-baseline` | Aggregate-level; masks single-sample class errors |

The gap is specific: a body can be **valid, topologically identical, dimensionally exact, and
"localized" by every reachable check** while being the wrong operation class. Nothing in the
current set expresses *"the edit's mechanism matches the requested mechanism."*

**Proposed criterion — `operation-class-fidelity`** (`type: code-check`):

> The emitted body is produced by the operation class the instruction implies. Analytic surface
> types present in the input survive in the output except where the edit explicitly removes
> them (`surface_types_destroyed` empty), and features outside the change region retain their
> position and area. Binary per sample.
> *Goal:* the right operation, not merely the right dimension — protects shape-similarity and
> interface-match, and is checkable **without a ground truth**, so it transfers to the real
> benchmark.

Two supporting notes for the criterion's value: it is the **only** proposed gate that fires on
real benchmark inputs (`edit-matches-instruction` needs a GT), and it is **nearly free** — the
histogram is already computed by `analyze`.

**Caveat on generality:** this is `n=1`. The R-1 check should be run in batch across the 20
`*-thicken` cases in `datasets/synthetic-edit-pairs/cases/` **before** the criterion is adopted,
to measure how often operation-class substitution actually occurs. If it is a one-off, the check
still earns its place as a cheap guard; if it is systematic, the criterion is mandatory.

---

## Secondary observation (not over-claimed)

`report.json` reports `rounds_used: 1` while `ledger.json` reports 2, with round 1 recorded
`valid: false, score: 0.0` and an **empty** `failures: []`. The evaluator already flags the
disagreement (`ledger_rounds_used: 2` vs `report_n_rounds: 1` vs `real_rounds_used: 1`). Only
`round-1.py` exists on disk. This looks like bookkeeping drift rather than a suppressed attempt,
but **no artifact records what round 1 tried**, so that cannot be established from this slice —
tracked as an `unverified` assumption on F-002-semantic-miss-2, with a reconciliation step in
its remedy.
