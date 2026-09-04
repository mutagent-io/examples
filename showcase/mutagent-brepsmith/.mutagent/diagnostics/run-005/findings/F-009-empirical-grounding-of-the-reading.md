# F-009 — Two empirical grounding habits explain the remaining wins: material-side probing and unique-signature search (Q1)

- **Confidence:** high
- **Scope:** ~+1.9 of the +5.916 win mass

## A. Determine add-vs-remove by point classification, never by intuition

run-004 repeatedly inferred the material side from what the verb "sounded like"; run-005
classified points and let the measurement decide. Every time the two runs disagreed on the SIGN of
the operation, run-005 won.

| id | run-004 sign | run-005 sign, with its probe | Δ |
|---|---|---|---|
| 244 | **CUT** — "enlarging → grows the smooth void, consuming material between r=20 and r=50 … CUT the annular pie-wedge" | **ADD** — "CONCAVE. Point classification along the corner bisector: solid at r≥21, void at r≤19. The material lies OUTSIDE the blend cylinder, so growing the radius ADDS material into the corner — which is what 'to increase the strength of the part' calls for, and confirms the reading" | **+0.4536** |
| 202 | **REMOVE** — "shift an internal shoulder 10 mm along its bore axis", expected −16053 mm³ | **ADD** — "the swept region was verified to be entirely void (`Common(prism, input) = 0.0 mm³`), so the operation is unambiguously add-material", +15696 mm³ | **+0.3963** |
| 245 | extend the pad −Z | extend after sectioning at z=−12 to prove the three flanges are the only load path | **+0.3034** |

Sources: `runs/eval-run-005/armA/{202,244,245}/report.json` → `interpretation.chosen` /
`interpretation.convexity`; `runs/eval-run-004/armA/{202,244,245}/report.json`.

244 is decisive: the two runs performed **opposite-signed** operations on the identical face, and
the empirically-grounded sign was worth +0.45. Note also the secondary confirmation channel —
run-005 used the instruction's *purpose* clause ("to increase the strength of the part") as an
independent check on the sign it had measured. Cross-checking a measured sign against the stated
engineering intent is a cheap, high-yield habit.

## B. Identify the feature by a UNIQUE topological signature, not by proximity or best fit

| id | run-004 | run-005 | Δ |
|---|---|---|---|
| 248 | "**Best-effort** identification in a very dense (1197-face) casting … **LOWER CONFIDENCE**: a best-effort match on the 30 mm z-separation cue plus nearby small cylindrical bosses, **not a geometrically unambiguous single candidate**" | "The **only** face in the model that is a TRUE rectangle bounded by a single 4-LINE wire and belongs to a block of height 30 is #1003 … Height = 30.000 mm exactly" | **+0.5378** |
| 240 | 50×50 mm square silhouette found by Z-level cross-sectioning near the central bore stack (a pedestal foot) | "The **only planar face in the model whose outer wire is a rounded rectangle (4 LINE + 4 CIRCLE edges) with a circular inner wire**: face #469" | **+0.6003** |
| 207 | "truncate 3 boss heights" | "cut every boss off at z = 29.502 − 30 = −0.498, leaving each boss **exactly 30 mm from base to end** with its diameters, bore and root fillet untouched" | **+0.6340** |
| 205 | target found after discarding a candidate that "satisfied the same-Y and +Y criteria **on paper**" but was solid | target confirmed void before implementation; frame mapping stated | **+0.6118** |

The pattern: run-005 converts each noun in the instruction into a **checkable topological
predicate** ("outer wire = 4 LINE edges" for *rectangular*; "4 LINE + 4 CIRCLE edges with a
circular inner wire" for *square boss with rounded corners and a central bore*; "6 LINE edges" for
*hex*) and then requires the predicate to match **exactly one** face in the model. When run-004
instead ranked candidates by "closest match", it picked the wrong feature and said so in its own
report.

## C. State the expected volume delta and its derivation BEFORE building

Universal in run-005 (32/32 reports carry `expected_volume_delta_derivation`, most with the phrase
"Stated before implementation"), absent in run-004. Measured intent errors in run-005 are
routinely 1e-5 to 4e-4 relative. This did not by itself buy score — 238 has a 0.000405 intent
error and a zero shape score — but it is what made the *implementation* reliable enough that the
remaining losses are purely interpretive.

## Remedy candidate — R-009

1. **Never emit a sign (add/remove) that was not established by point classification or a
   `Common()` volume probe of the swept region.** Record the probe result verbatim.
2. **Feature identification must produce a uniqueness proof**: the predicate set derived from the
   instruction's nouns must match exactly one candidate. If it matches ≥2, or 0, that is a hard
   trigger for the candidate-carrying path (F-006 R-006) — *not* for a best-effort pick.
3. Cross-check the measured sign against any purpose clause in the instruction.

Cost: low. Correctness: high.
