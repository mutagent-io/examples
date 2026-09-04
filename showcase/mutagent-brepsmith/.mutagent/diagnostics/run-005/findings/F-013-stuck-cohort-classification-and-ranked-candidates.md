# F-013 — The ~0.400 cohort splits into two populations with different remedies; ranked re-read candidates per sample

- **Confidence:** high for the classification; per-candidate confidence stated individually
- **Scope:** 201, 202, 203, 218, 229, 243, 246 (+ 238 and 241 as adjacent cases)
- **Question:** Q3

## Reading the number 0.400

`score = 0.6·shape(renormalized vs no-op, clamped at 0) + 0.3·interface + 0.1·topology`.
**0.4000 exactly ⇒ interface and topology are FULL and shape is clamped to zero.**

Calibration point — a literal no-op does *not* score 0.400: run-004's sample 201 made no
geometric change whatsoever (`checks.intent: "fail-waived — no geometric change was made"`,
`max_distance 3.07e-08`, `changed_fraction 0.0`) and scored **0.3256**. So interface+topology are
themselves scored against ground truth, and landing on exactly 0.4000 means the output's B-rep
interface and topology **match ground truth perfectly** while its shape reads as no better than
doing nothing. That combination is the diagnostic signature used below.

## Population split

| | dV/vol | run-004 vs run-005 reading | signature | remedy class |
|---|---|---|---|---|
| **A. Genuinely mis-read** — 201, 202, 203, 229 (+238) | 3.2 – 4.4 % (238: 3.8 %) | different readings, or the same wrong one | shape resolvable at this edit size (225 at 6.7 %, 230 at 8.2 %, 207 at 10.6 % all score > 0.95) | re-read (candidates below) |
| **B. Shape-unresolvable** — 218, 243, 246 (+241) | **0.015 – 0.10 %** — the four smallest edits in the run | two *different* implementations returned the **identical** score to 4 dp | perfect interface+topology but zero shape is self-contradictory unless the shape term cannot resolve the edit | stop spending interpretation budget; optimise interface/topology (see F-014) |

Edit sizes (`|ΔV| / input mesh volume`, computed from
`datasets/cadgenbench-data/<id>/input.mesh.npz` and the reports' expected deltas):
218 = 0.00015 · 246 = 0.00028 · 241 = 0.00057 · 243 = 0.00100 — then a gap — 248 = 0.00196 (0.9378),
206 = 0.00200 (0.7427), 205 = 0.00269 (0.9975). The four smallest are the four stuck; the next
three up score 0.74–1.00. Pearson r(log10 dV/vol, score) = **+0.311** overall — weak globally,
decisive in the tail.

## Common phrasing signature of the cohort

Every one of the seven fails at least one of these, and **none** of them can be pinned by a unique
absolute dimension that is actually present in the model:

| id | relative vs absolute | feature named by | direction word | dimension contradiction |
|---|---|---|---|---|
| 201 | relative ("inward by 6mm") | count + negative predicate ("four **non-circular** pockets") | **"inward"** — frame-of-reference ambiguous | — |
| 202 | absolute (+10 mm) | 3-clause spatial locator | "+Z", "upper" | frame mismatch (desc Z = file Y) |
| 203 | count (7 → 5) | "impeller blades" | — | *which* two is under-determined |
| 218 | none (remove a feature) | "central boss", "outer diameter" | **"+Z side"** — contradicted by the model | — |
| 229 | absolute (15 → 10 mm) | "the **lone** horizontal bore" | "horizontal" | **no r=7.5 face exists anywhere** |
| 243 | ratio + absolute (1.5 → 3) | "threaded boss with outer radius 7.5" | — | which surface moves is unstated |
| 246 | relative (−1 mm) | "hex boss" (unique) | — | which end loses the material |

Contrast the ≥ 0.95 cohort (205, 207, 212, 225, 230, 231, 248): every one states either an exact
current dimension that **matches a measured face** (230: "76.2 mm" → seven r=38.1 faces; 248:
"30 mm" → a face pair exactly 30.000 apart; 207: "30 mm from base") or a purely positional target
resolvable by measurement (205, 206). **The discriminator is not "relative vs absolute" — it is
whether the instruction contains at least one clause that a measurement can confirm or refute.**
Where every clause is unfalsifiable, the agent has nothing to steer by and F-006 applies.

## Ranked re-read candidates, per sample

### 201 — *"For each of the four non-circular pockets on the +X side of the central bore, bring their walls (faces with long axis along Y) inward by 6mm."* (0.3256 → 0.3365)

Decisive evidence: run-005's chosen reading moved 82,275 mm³ (3.2 % of the body) and gained
**+0.0109 over run-004's literal no-op**. The chosen reading is shape-worthless; the pocket
identification (four non-circular inner wires on the bottom face, `analysis.pocket_identification`)
is almost certainly right, so the error is in **which walls move, and in which direction.**

1. **`rejected_readings[3]` — "inward" = toward the central bore axis** (part frame, not pocket
   frame). *Confidence: medium-high.* The sentence's only stated datum is "the central bore"; run-005
   rejected this by asserting the pocket is the frame of reference, which is a preference, not a
   measurement. Under this reading every Y-long wall translates −X by 6 mm (the pockets migrate
   toward the bore) — a materially different shape from what was built.
2. **`rejected_readings[1]` — move only the four bore-side r=117.538 cylinders**, dropping the
   two x=166.239 planes. *Confidence: medium.* run-005 rejected it for being a subset of its own
   union reading — but "their walls (faces with long axis along Y)" per *pocket* has exactly one
   such face in P2 and P4, so the symmetric-across-pockets reading is the four cylinders.
3. **`rejected_readings[2]` — uniform 6 mm shrink of every pocket wall.** *Confidence: low-medium.*
   Explicitly contradicts the parenthetical, but it is the reading a CAD author would most likely
   have implemented as a single offset operation.

### 202 — *"…For the smaller of the two bores, there is an upper opening… Raise this surface by 10mm in the +Z direction."* (invalid → 0.3963)

The frame remap (desc Z = file Y, F-007) and the add-material sign (`Common(prism, input) = 0.0 mm³`,
F-009) are both **grounded** and should be kept. The residual error is target-face selection, and
run-005's "up = +Y" argument is circular: it inferred the up-direction *from the candidate it had
already chosen* ("the target is called the UPPER opening and it is the higher of the two
candidates").

1. **`rejected_readings[1]` — face1963, the r 35…37 annulus at y = −47.5.** *Confidence: medium.*
   Rejected because "it faces −Y (downward)" — but if the description's +Z maps to file **−Y**, this
   is the upper opening and face1961 is the lower one. The remap's sign was never independently
   established; only the axis was.
2. **`rejected_readings[2]` — face1759, the r 81…91 annulus at y = −97.5.** *Confidence: low-medium.*
   Rejected as belonging to the larger bore and at "22.5 % along the part" rather than halfway —
   both defensible, but the r 81…91 vs r 95 assignment deserves a re-check.
3. Re-derive the +Z sign independently: which end of the file's Y axis is "up" should be settled
   by the part's own mounting features / the larger bore's counterbore direction, not by the
   candidate.

### 203 — *"Reduce the number of impeller blades from 7 to 5."* (0.1843 → 0.4047)

**This is the highest-confidence reversal in the whole diagnosis.** Both runs deleted two of the
seven original blades and left the other five in their original positions. run-005 removed only
the blade material (−102,579 mm³, 3.3 %) with the five survivors reproducing their input volumes
exactly — and still scored **shape ≈ 0.008**. If ground truth were any 2-of-7 deletion, an output
that preserves the hub, backplate, shroud, bore, top disc and five original blades would score
*very high* shape, not zero. **Ground truth is therefore almost certainly not a subset deletion.**

1. **`rejected_readings[0]` — rebuild the pattern as five EVENLY SPACED blades at 72°.**
   *Confidence: high.* run-005 rejected this on an expected-overlap calculation ("keeping 5 of the
   original 7 shares ~3.57 blades on average with a 'delete two' ground truth… keeping the originals
   therefore dominates for every prior") — that calculation was explicitly conditioned on a prior
   over ground truths, and the 0.4047 score **falsifies that prior**. Re-run the same calculation
   with `P(subset deletion) ≈ 0` and re-patterning wins outright.
   Implementation note from run-005's own report: the seed angle is unrecoverable from the B-rep
   (blades differ by up to 4.5 % in volume; one lacks an r=2 cylinder face). Mitigate by keeping the
   two survivors nearest 72°-multiples in place and rotating copies of a representative blade into
   the three remaining slots, phasing the pattern on the best-fitting original blade.
2. **`rejected_readings[1]` — delete two adjacent blades.** *Confidence: low.* Same subset-deletion
   family that the score has just falsified; listed only for completeness.
3. Also worth ruling out cheaply: that 0.4047 reflects the two residual "blade-footprint ridges"
   (`known_imperfection`: 1298.52 + 938.93 mm³, 0.071 % of the body) rather than the reading. Cheap
   test — a clean subset deletion with zero residue; if it still reads ≈ 0.400, candidate 1 is
   confirmed.

### 229 — *"Decrease the diameter of the lone horizontal bore from 15mm to 10mm."* (0.3711 → 0.4012)

**Different readings, both wrong.** run-004 targeted the r=4.0 pure-X-axis face (d = 8 mm) —
"the only face with a pure single global-X axis direction… taken as the target despite the
dimension mismatch". run-005 targeted the r=12.5 Y-axis bore (d = 25 mm) and set it to the stated
endpoint r=5.0. Neither found an r=7.5 anywhere ("no face has radius 7.5 mm anywhere in the model,
on any axis" — both runs agree independently).

1. **`rejected_readings[0]` — apply the stated DELTA (−5 mm diameter) to the identified feature:
   d 25 → 20, i.e. r 12.5 → 10.0.** *Confidence: medium-high.* run-005 rejected it on the argument
   that "the endpoint '10mm' is the imperative; the 'from 15mm' clause… carries no operative
   content." That reasoning is backwards for a benchmark whose ground truths are produced by
   parametric edits: when the *stated start* is wrong, the *stated end* is derived from the same
   wrong start, so the **delta is the surviving invariant**, whereas the endpoint is not. Note the
   independent corroboration from sample 204, where the same situation arose (stated 20 mm, measured
   24 mm) and taking the stated endpoint scored only 0.4243 / 0.5146.
2. **Ratio reading — d 25 × (10/15) = 16.667** (`rejected_readings[1]`). *Confidence: low-medium.*
   Preserves the stated proportion; worth building as a third candidate since it is one line of code.
3. **Re-open feature identification under the frame remap** (`rejected_readings[2]`, the Z-axis
   bores). *Confidence: low.* run-005's uniqueness argument ("r=3 appears 3×, r=5 twice") is sound.

### 218 — *"Remove the fillet from the outer diameter of the central boss on the +Z side of the part."* (0.3975 → 0.4000) — **Population B**

Both runs removed a different feature; both scored shape zero; the edit is **0.015 % of the body**,
the smallest in the run. run-004 removed the two CONE faces of the 45° edge break at the r=75
pillar's top (z = 14.5…15, **on the +Z side as stated**); run-005 removed the TORUS R=97 r=2 fillet
at the base of the r=95 collar (z = −12…−10, on the **−Z** side, justified by an unsupported
up-axis flip — see F-007's counter-evidence). The render
(`datasets/cadgenbench-data/218/renders/iso.png`) confirms the +Z face is a plain flat teardrop
plate with no protruding boss, so run-005's observation was correct even though its inference was
underdetermined.

1. **The TORUS blend at the root of the r=75 central pillar on the +Z face**, if one exists —
   this is the literal reading of *every* clause simultaneously ("central boss" + "outer diameter"
   + "fillet" (torus, not cone) + "+Z side"). *Confidence: medium, unverified —* run-004's round 1
   found TORUS faces near axis (70,0) at major radii **97.0 and 178.5** and discarded them as
   "unrelated small internal rib/pocket fillets" without recording their Z positions. **The R=178.5
   ring has never been examined and is the top action item.**
2. run-004's CONE edge break at z = 14.5…15 (i.e. revert to run-004). *Confidence: low* — it
   already scored shape-zero, and it is a chamfer, not a fillet.
3. Given the Population-B classification, cap effort here: do the R=178.5 probe, then optimise
   for interface/topology conservation and accept 0.400.

### 243 — *"Double the thickness of the threaded boss with outer radius 7.5 mm from 1.5 mm to 3 mm."* (0.4000 → 0.4000) — **Population B**

**Different readings, both exactly 0.4000.** run-004 kept OD = 7.5 and shrank the bore to r=4.5
(removes material, consumes thread detail); run-005 kept the bore and grew OD to r=9.0 (adds
material, preserves the thread). The two exhaust the sensible reading space and returned an
identical score, which is the Population-B signature.

1. **`rejected_readings[1]` — split the growth (OD → 8.25, bore → 5.25).** *Confidence: low.*
   Unsupported by the text; listed because it is the only untried member of the family and is the
   symmetric hedge (F-010 R-010a) between two readings that have each been shown to score zero.
2. **`rejected_readings[2]` — read 7.5 mm as the POST-edit outer radius** (so the boss currently has
   OD 6.0 and the edit grows the wall outward to 7.5 while the bore stays). *Confidence: low-medium.*
3. Cap effort; treat as Population B.

### 246 — *"Decrease the height of the hex boss by 1 mm."* (0.4000 → 0.4000) — **Population B**

**Same reading twice, byte-identical score.** run-004 sliced a 1 mm band out of the plain prism at
z = 29.3…30.3 and translated everything above down 1 mm; run-005 dropped everything above
z = 30.706 by 1 mm and deleted the slab it stood on. These produce the *same solid*: top face
31.706 → 30.706 with the 1 mm rim round preserved. Feature identification is not in doubt (the
model has exactly one hexagonal face, six LINE edges, and the report enumerates the six side
planes). Edit size = 0.028 % of the body.

1. **`rejected_readings[0]` — plane-cut the top 1 mm off at z = 30.706**, sacrificing the rim round
   and leaving a 13.86 mm across-flats flat top. *Confidence: low-medium.* It is the only reading
   that yields a *different solid*, and it is what a naive ground-truth generator (a plane cut)
   would produce.
2. **`rejected_readings[1]` — shorten from the base.** *Confidence: low.* Cuts through the base
   fillet ring.
3. Cap effort; treat as Population B.

## Remedy candidates

- **R-013a — route Population A through candidate-carrying (F-006 R-006).** Expected value is
  concentrated in **203** (high-confidence reversal to the 72° re-pattern), **229** (delta-not-
  endpoint), **201** (bore-frame "inward"), **202** (target face under the corrected +Z sign).
  Four samples × ~0.4 of headroom ≈ **+0.05 on the editing mean.**
- **R-013b — the "unfalsifiable instruction" trigger.** Before implementation, check whether at
  least one clause of the instruction is confirmable by measurement (an exact dimension that
  matches a face; a uniquely-satisfying topological predicate; a direction word with a measurable
  referent). If **zero** clauses are confirmable, the sample is high-risk by construction — carry
  two candidates and prefer the hedge (F-010 R-010a). All seven stuck samples trip this; none of
  the seven ≥0.95 samples do. Cost: low, purely diagnostic.
- **R-013c — cap effort on Population B** (dV/vol < 0.1 %): see F-014.
