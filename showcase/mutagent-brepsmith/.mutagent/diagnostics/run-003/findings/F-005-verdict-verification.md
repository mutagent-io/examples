# F-005 — run-003 verdict machinery verification

Report-only. All geometry measured directly from the run's own STEP artifacts via OCP
(`BRepGProp.VolumeProperties_s`, `BRepAdaptor_Surface`, face `Orientation()`). No fixes, no
rescoring.

---

## Q1 — Is the GT adjudication correct?

**Verdict: correct on 20 of 21 quarantines; wrong on 1 (abc_0281). All three suspicions
about the adjudicator are refuted — the defect is in the GT generator, not the adjudicator.**

### The three suspicions, tested

| Suspicion | Verdict | Evidence |
|---|---|---|
| (a) radius-vs-diameter confusion | **REFUTED** | Every stated number equals exactly `2 x radius` of a real cylindrical face in the input: 5.08 = 2x2.54 (abc_0010), 46.6 = 2x23.3 (abc_0259), 40.0 = 2x20.0 (abc_0361), 37.0 = 2x18.5 (abc_0281). Units and factor are consistent on both sides. |
| (b) surface-normal orientation bug in the concavity test | **REFUTED** | An independent reimplementation (face `TopAbs_REVERSED`) reproduces the adjudicator's `input_concave_cyl_diameters` **exactly** on all 22 cases — e.g. abc_0259 `[36.0, 41.8]`, abc_0128 `[3.0, 4.0, 4.9, 17.0]`, abc_0361 `[]`. Two independent implementations agree. |
| (c) walls are stepped / countersunk / partial, so diameter-match is the wrong probe | **PARTIALLY TRUE, NOT CAUSAL** | The selected faces are frequently partial arcs (u-span 6.5deg to 360deg). But partiality does not separate the classes — **convexity does, perfectly**: 20/21 quarantined selected a CONVEX face; the 1 `gt-ok` case and the 1 false quarantine selected a CONCAVE one. |

### The real root cause — GT generator, not adjudicator

`devtools/cadtools_devtools/synthetic_pairs.py`:

- `_cylindrical_axes` (:274-302) returns **every** `GeomAbs_Cylinder` face with **no concavity
  filter** — it never reads `Orientation()` or a normal.
- `_fill_hole` (:338) then takes `max(axes, key=lambda a: a[2])` — the largest radius.

On real ABC parts the largest-radius cylinder is usually a **convex outer boss or fillet arc**,
not a bore. The recipe then fuses a bbox-trimmed full-length **rod** through the part.

- `RECIPE_CLAIMS["fill-hole"]` (:460) asserts only `{volume: +1, footprint: (0,1,2)}`. The
  corrupted GT satisfies **both** — volume rises (a rod is added) and the bbox is unchanged
  because the plug is intersected with the input's own envelope first. The consistency gate is
  structurally blind to this defect.

### Per-case measurement (selected face convexity vs. adjudication)

| case | adjudication | selected d | concave? | u-span | vol frac | faces | concave diams present |
|---|---|---|---|---|---|---|---|
| abc_0010 | gt-mismatch | 5.08 | convex | 256.1 | +0.04 | 99->92 | [1.016, 2.032] |
| abc_0032 | gt-mismatch | 54.0 | convex | 12.7 | +0.63 | 186->43 | [2.5 … 50.165] |
| abc_0067 | gt-mismatch | 15.0 | convex | 360.0 | +0.56 | 99->10 | [1.1, 3.0, 5.0] |
| abc_0102 | gt-mismatch | 6.0 | convex | 54.9 | +0.23 | 160->133 | **[]** |
| **abc_0128** | **gt-ok** | **17.0** | **CONCAVE** | 90.0 | +0.14 | 117->120 | [3, 4, 4.9, **17.0**] |
| abc_0170 | gt-mismatch | 26.35 | convex | 23.5 | +1.38 | 250->112 | [3, 5.75, 17.35, 22.35] |
| abc_0184 | gt-mismatch | 23.825 | convex | 360.0 | +1.59 | 135->7 | [1.22, 3.51, 4.78] |
| abc_0201 | gt-mismatch | 48.441 | convex | 10.8 | +0.29 | 682->5 | [4.83, 20.41, 26.36] |
| abc_0219 | gt-mismatch | 24.32 | convex | 10.8 | +0.78 | 115->14 | [2.26, 3.81, 15.0] |
| abc_0254 | gt-mismatch | 38.1 | convex | 180.0 | +0.86 | 229->5 | [1.22, 4.0, 8.0] |
| abc_0259 | gt-mismatch | 46.6 | convex | 114.6 | **+3.00** | 94->12 | [36.0, 41.8] |
| abc_0270 | gt-mismatch | 60.0 | convex | 36.9 | +2.89 | 108->21 | [2 … 49.8] |
| **abc_0281** | **gt-mismatch (WRONG)** | **37.0** | **CONCAVE** | **360.0** | +0.93 | 139->139 | [2, 3.5, 6, 10, **37.0**] |
| abc_0282 | gt-mismatch | 23.2 | convex | 48.3 | +2.69 | 112->44 | [3.2 … 20.0] |
| abc_0300 | gt-mismatch | 7.0 | convex | 360.0 | **+3.95** | 100->3 | **[]** |
| abc_0348 | gt-mismatch | 21.2 | convex | 360.0 | +3.45 | 44->5 | [1.0, 16.1] |
| abc_0349 | gt-mismatch | 44.0 | convex | 66.1 | +1.58 | 21->21 | [5.4, 10.0] |
| abc_0358 | gt-mismatch | 19.0 | convex | 360.0 | +1.60 | 35->6 | **[]** |
| abc_0361 | gt-mismatch | 40.0 | convex | 90.0 | +2.65 | 21->9 | **[]** |
| abc_0368 | gt-mismatch | 9.525 | convex | 360.0 | +1.29 | 28->6 | **[]** |
| abc_0372 | gt-mismatch | 65.0 | convex | 6.5 | +0.92 | 18->28 | [21.5, 30.6] |
| abc_0378 | gt-mismatch | 134.0 | convex | 20.6 | +0.37 | 45->10 | [6.5 … 28.0] |

Perfect separation: convex-selected <-> `gt-mismatch` on 20/21; concave-selected <-> real fill on 2/2.

### Re-classification of the requested decisive cases

| case | re-classification | measured basis |
|---|---|---|
| **abc_0259** | **adjudicator-correct / genuinely-defective-GT** | Selected face is a **convex 46.6 mm outer arc** (114.6deg span). Vol 914.6 -> 3,657.7 mm3 (**x4.0**), faces 94 -> 12. Real concave cavities are 36.0 and 41.8 mm. GT filled no cavity — it welded a disc chunk onto a thin arc part. armB's 1.0 means armB *reproduced the corruption*, not that it solved the task. |
| **abc_0361** | **adjudicator-correct / genuinely-defective-GT** | Input has **zero concave cylinders**. Selected convex 40.0 mm boss (90deg span). Vol 2,538.1 -> 9,263.0 mm3 (**x3.65**), faces 21 -> 9. |
| **abc_0010** | **adjudicator-correct / genuinely-defective-GT** | Selected convex 5.08 mm shaft (256deg span). Real cavities are 1.016 and 2.032 mm. armA's "no cavity at 5.08" was right. |
| **abc_0102** | **adjudicator-correct / genuinely-defective-GT** | Input has **zero concave cylinders**. Selected convex 6.0 mm (54.9deg arc). armA's "no cavity" was right. |
| **abc_0300 / abc_0358 / abc_0368** | **adjudicator-correct / genuinely-defective-GT** | All three: zero concave cylinders in input; selected a convex 360deg face; vol frac +3.95 / +1.60 / +1.29. |
| **abc_0281** | **ADJUDICATOR-WRONG (GT filled a real hole)** | Selected face measures **CONCAVE d = 37.0 mm, 360deg span, axis (-1,0,0)**, origin (32.5, 40.0, 23.5). Measured GT-input delta **88,167.2 mm3** vs the maximum possible X-axis plug `pi x 18.5^2 x 85.0 = 91,392.9 mm3` — **96.5%**, i.e. the cylinder was void for essentially its whole length. **Real diameter 37.0 mm; stated diameter `null`.** |
| **abc_0128** (control) | **adjudicator-correct (gt-ok confirmed)** | Selected **CONCAVE 17.0 mm** = stated 17.0. Clean boolean: `GT - input` = 1 lump, 12,726.55 mm3; `input - GT` = **EMPTY**. A textbook fill. |

**The one adjudicator bug** — the acceptance test is *"a concave face matches the stated
diameter"*. Four cases drew the vague render variant and carry `stated_diameter_mm: null`
(abc_0170, abc_0254, abc_0281, abc_0349): the match count is then trivially 0 and the case
fails closed regardless of geometry. It only changed the outcome for **abc_0281**, whose
adjudication record *itself lists the 37.0 mm cavity* in `input_concave_cyl_diameters` while
declaring no match. The other three are convex-selected and genuinely defective anyway —
right answer, wrong reason.

**Also: the adjudicator script is not in the worktree.** Only `gt-adjudication.json` exists.
The 21-case quarantine is currently unreproducible.

---

## Q2 — RCA of the two -0.8571 armA losses

Both losses land on **exactly** `0.14285714285714288` = `0.1 / 0.7`. That is the score floor:
`shape_similarity_renormalized` clamps to 0 when the candidate is less similar to GT than the
unedited input is, leaving only the topology term over `proxy_weight_total = 0.7`
(interface null, weight 0.3 dropped). Frame agrees and Betti numbers are identical across
input/GT/both candidates on both cases — neither loss is a pose or topology failure.

### abc_0352-thicken — **agent semantic miss** (not GT, not scorer)

Instruction: *"Increase the part's extent along X from 48.08 mm to 60.1 mm by adding 12.02 mm
of material on the +X-facing (right-hand) face."*

| | volume (mm3) | faces | bbox size (mm) |
|---|---|---|---|
| input | 33,163.12 | 29 | 48.080 x 60.155 x 38.494 |
| GT | 36,817.20 | 31 | 60.100 x 60.155 x 38.494 |
| **armA** | **60,996.52** | 34 | 60.100 x 60.155 x 38.494 |
| armB | 36,817.20 | 31 | 60.100 x 60.155 x 38.494 |

Booleans: `GT - armA = 0.00` (armA is a **strict superset**), `armA - GT = 24,179.32 mm3`
(**+65.7%**). armB: both directions 0.00 — **identical to GT**.

Cause, from the scripts:

```python
# armB (round script) — matches the GT recipe exactly
boss = extrude(target_face, amount=12.02)          # face PROFILE swept
# armA (round-2.py) — the miss
pad = Box(pad_dx, bb.size.Y, bb.size.Z)            # full bbox RECTANGLE swept
```

The GT recipe `_thicken` is `shape.fuse(bd.extrude(face, requested))` — the face's own
profile. armA swept the bounding rectangle, adding the void between the face silhouette and
its bounding box.

**Why verify did not catch it:** armA's `report.json` records
`intent: "pass (X extent 48.08 -> 60.1 mm, +12.02mm; Y extent unchanged 60.154576mm; Z extent
unchanged 38.494010mm; surface types preserved…)"`. All three extents are **identical** between
armA and GT — an extent-only intent check is structurally incapable of detecting a
cross-section error. There is no volume or added-region assertion in the loop. armA even
caught a *related* error in round 1 ("pad box included a 5mm margin on Y/Z") and fixed only the
margin, not the rectangle.

### abc_0356-boss-union — **agent miss on a genuinely ambiguous instruction**

Instruction (vague variant): *"Stick a round pad on top in the middle — roughly 25.738 mm
across and 8.97 mm tall."* — **states no X/Y.**

| | volume (mm3) | faces | boss cylinder axis (r = 12.869) |
|---|---|---|---|
| input | 9,318.66 | 48 | — |
| GT | 13,985.60 | 53 | (0.00, **35.28**, 8.13) |
| **armA** | **13,985.60** | **53** | (0.00, **19.35**, 8.13) |
| armB | 13,985.60 | 53 | (0.00, **35.28**, 8.13) |

A **pure translation error of 15.93 mm in Y**. Identical radius, identical height, identical
z-base, identical total volume to 2 dp, identical face count. The offset is **1.24 x the boss
radius**, so the two discs barely overlap — armA's boss occupies material where GT has none
*and* omits material where GT has some (double penalty), which is why its shape similarity
0.6924 falls below the do-nothing baseline 0.7571. **The score ordering is correct.**

Root of the disagreement — `_boss_union` (:429-434) defines "middle" as the **bbox footprint
centre** (`cx = bbox.min.X + size.X/2`, `cy = bbox.min.Y + size.Y/2` -> (0.000, 35.278)). armA
used the **top planar face centroid** (0.00006, 19.3484) — a defensible reading of "on top in
the middle". The recipe's *verbose* variant states `centred at X={x} mm, Y={y} mm`; this case
drew the vague variant that **discards the coordinates the answer key depends on**. So this is
a **GT<->instruction underspecification defect** (a second generator defect class, distinct
from the fill-hole one) with armA's reading a reasonable loser rather than a plain blunder.

### Scorer assessment

Not an artifact in **sign** — both armA outputs genuinely are worse than doing nothing. It *is*
an artifact in **magnitude**: every sub-baseline output collapses to the same 0.142857
regardless of severity (**7 armA and 5 armB samples sit exactly on this floor**), so a
per-sample delta of -0.8571 is not proportional to error size and such deltas are not
comparable across samples inside a mean.

**Separately: `interface_available` is `false` on 48/48 samples in both arms.** 30% of the
rubric weight was never computed for the entire run; all scores are renormalised over 0.7.
This is disclosed in the convention string (`cad-score-proxy/v1:interface-null-renormalized-0.7`)
but not in the headline.

---

## Q3 — Which headline is honest?

**None of the three as offered. The honest headline is the corrected n=28, published as an
explicitly re-scoped four-recipe result, with fill-hole capability broken out as
incomplete-pending-dataset-repair.**

- **n=27 as computed — not honest.** It excludes abc_0281, whose GT measurably fills a real
  37.0 mm through-hole. One of the 21 quarantines is a false exclusion.
- **incomplete-pending-dataset-repair for the whole run — overstates the damage.** 27 samples
  across four recipe classes are sound and their GT was never in question. The A-vs-B
  comparison is also unaffected: both arms were scored on identical sample sets at every stage
  (`validity_rate 1.0`, no `missing_outputs`, no `score_failures` in either).
- **Corrected n=28 — defensible, but only with its scope stated.**

Arithmetic on the run's **own already-computed** scores (no rescoring — abc_0281 was scored in
the quarantine bucket):

| arm | headline n=27 | + abc_0281 | corrected n=28 |
|---|---|---|---|
| armA | 0.7820 | 0.1616 | **0.7598** |
| armB | 0.8059 | 0.1445 | **0.7823** |

armB still leads by ~0.023; **the ordering and the A/B conclusion are unchanged.**

### Mandatory caveats on any published headline

1. **Recipe mix collapsed.** Designed slice: fill-hole 22, thicken 14, boss-union 5,
   through-hole 4, hole-pattern 3 (n=48, fill-hole = **46%**). Headline n=27: thicken 14,
   boss-union 5, through-hole 4, hole-pattern 3, fill-hole **1** (**4%**). The mean answers a
   narrower question than the slice was built to ask.
2. **Fill-hole capability is unmeasured.** Even corrected, n=2 (abc_0128, abc_0281) — and both
   arms score near the floor on both (armA 0.1307 / 0.1616; armB 0.1312 / 0.1445). Report as
   **incomplete-pending-dataset-repair**, not inside the aggregate mean.
3. **The 20 exclusions are a root-caused generator defect** (F-005-1), not a scoring judgement
   call. State it so, or the quarantine reads as cherry-picking.
4. **30% of the rubric was never evaluated** (`interface_available: false`, 48/48).
5. **Sub-baseline outputs are compressed to a single floor value** (0.1/0.7); 7 armA + 5 armB
   samples sit exactly on it.
6. **The adjudicator is unreproducible** — no script is checked in.

---

## Artifacts

- `/home/bruno/dev/mutagent/playground/cad-agents/stl-agent/.mutagent/diagnostics/run-003/findings/F-005-verdict-verification.json` (5 findings, contract-validated PASS)
- `/home/bruno/dev/mutagent/playground/cad-agents/stl-agent/.mutagent/diagnostics/run-003/findings/F-005-verdict-verification.md` (this file)
