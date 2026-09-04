# F-015 — Waiver audit: surface-type-conservation waivers are mostly legitimate; intent-class waivers are the ones that hide defects (Q4)

- **Confidence:** medium-high
- **Scope:** 17 of 32 run-005 samples carry ≥1 waiver

## Aggregate

| group | n | mean score |
|---|---|---|
| any waiver | 17 | 0.6339 |
| no waiver | 15 | 0.7042 |

A −0.07 gap — within the run-to-run noise band (F-017) and confounded by the fact that hard
samples both need waivers and score badly. **Waivers as a class are not a red flag.** Breaking
them out by class is more informative:

| waiver class | n | mean | samples |
|---|---|---|---|
| surface-type conservation | 9 | 0.5962 | 203 (.405) · 205 (.998) · 206 (.743) · 208 (.612) · 218 (.400) · 238 (.400) · 243 (.400) · 247 (.802) · 249 (.607) |
| mesh-validity / local closure | 6 | 0.7844 | 207 (.995) · 217 (.517) · 240 (.600) · 242 (.876) · 248 (.938) · 250 (.781) |
| **intent / cross-section** | **4** | 0.6805 | 240 (.600) · **241 (.308)** · 242 (.876) · 248 (.938) |

## Class-by-class verdict

### Surface-type conservation — legitimate, and its allowance model is simply wrong for two operation classes

The waiver text on the wins states the case precisely and correctly:

- 205: "the destroyed cylinders **ARE** the two holes the instruction orders removed" → 0.9975
- 206: "the destroyed cylinders **ARE** the three holes the instruction orders removed" → 0.7427
- 203: "The check's allowance is proportional to the changed volume fraction, which is the right
  model for a **DIMENSION** edit and the wrong one for a **FEATURE-DELETION** edit… Destroying them
  IS the requested operation, not collateral damage" → 0.4047 (its problem is the reading, F-013)
- 218: "Those two half-tori ARE the fillet the instruction orders removed… The alternative that
  satisfied the checker's letter — leaving the fillet in place — would not perform the edit at all"

Its spread is enormous (0.400 → 0.998), so it carries essentially no diagnostic signal about
correctness. **It is not hiding defects; it is misfiring on feature-deletion and feature-removal
operation classes.** The right fix is to correct the allowance model rather than keep waiving:
for delete-feature edits the allowance should be *the face inventory of the named feature*, not a
volume-fraction proportion.

One caveat: two of the three exact-0.4000 samples (218, 238, 243) carry this waiver, so the
*combination* "surface-type waiver **and** score exactly 0.4000" occurs 3 times. But the
correlation runs through interpretation difficulty, not through the waiver.

### Mesh-validity / local-closure — the highest-scoring waiver class

Mean 0.7844, the best of the three. These are the inherited-defect repairs (240, 250, 202, 217)
and stricter-than-official local tessellation checks. Waiving a check that is *stricter than the
official gate* is correct behaviour and was worth the three invalid→valid recoveries
(202, 217, 240 = **+1.513**, 26 % of all gain). No defects hidden.

### Intent / volume — **this is the class that hides defects**

The intent check is the only local check that asks "did you do the right amount of the right
thing". Waiving it removes the last correctness signal from the loop (F-006).

- **241 — `"volume-intent tolerance widened from 2% to 5%"` — 0.3083, the lowest score in run-005.**
  Same feature identified in both runs; run-005 widened the tolerance rather than resolving the
  disagreement, and scored below the 0.400 shape-zero line (i.e. it lost interface points too).
- **run-004's 201 is the extreme case:** `intent: {"status": "fail-waived", "reason": "no
  geometric change was made; instruction not satisfied", "waived": true}` — a **literal no-op was
  waived through and emitted**, scoring 0.3256. This is a waiver hiding a total failure, and it is
  the single clearest instance in either run.
- 240 waived "mesh-based volume intent / cross-section" and scored 0.6003 — acceptable, but it is
  also the sample where the two runs identified **completely different features** (a 50×50 mm
  pedestal foot vs a 13.7×15.3 mm rounded-rectangle cap), so the intent expectation was never a
  real constraint on the reading.
- 242 and 248 waived intent narrowly and scored well (0.876, 0.938), so the class is not uniformly
  bad — but the two low outliers are both intent waivers.

## Remedy candidate — R-015

1. **Make intent waivers non-emitting.** A waived intent check must block emission and force
   another round or an explicit interpretation re-open, never a "score 1.0 from check-results".
   The absolute floor: *never waive an intent check whose reason is that no change was made*
   (run-004 201).
2. **Never widen a tolerance to pass.** 241 widened 2 % → 5 % and is the run's worst sample.
   A tolerance disagreement is evidence about the *reading*, not about the tolerance.
3. **Fix the surface-type allowance model instead of waiving it.** Allowance for a
   delete-feature / remove-feature edit = the face inventory of the named feature (run-005's own
   waiver texts already compute exactly this — promote it from prose to code). This removes 9 of 17
   waivers and restores the check's diagnostic power for the cases where it *should* fire.
4. Keep the mesh-validity waivers as they are.

Cost: low-medium. Correctness: medium-high — item 1 and 2 are directly evidenced by the two
worst-scoring samples in the two runs; item 3 is a cleanup with no score risk.
