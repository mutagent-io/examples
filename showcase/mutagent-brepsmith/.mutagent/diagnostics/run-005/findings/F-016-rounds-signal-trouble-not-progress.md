# F-016 — Rounds-used is a difficulty signal, not a quality lever: iteration never repaired a reading (Q5)

- **Confidence:** high
- **Scope:** all 32 samples

## The correlation

run-005 (`rounds_used` from each report, joined to `per_sample_scores`):

| rounds | n | mean | median |
|---|---|---|---|
| 1 | 18 | **0.7289** | 0.7330 |
| 2 | 6 | 0.5953 | 0.5925 |
| 3 | 7 | 0.5782 | 0.4012 |
| 5 | 1 | 0.6003 | — |
| **≥2 combined** | **14** | **0.5871** | 0.5025 |

Spearman ρ(rounds_used, score) = **−0.311**. Same direction in run-004: 5-round samples (214, 217)
averaged 0.4310, the worst bucket there too.

## Why — iteration is spent entirely on boolean robustness

Reading the round notes across all 14 multi-round samples in run-005: **the interpretation was
fixed at round 1 in every single one; only the implementation changed.**

- 201: "round 1 extracted the pocket voids with a tall clipping box whose top lay outside the part,
  leaking exterior space… round 2 built the swept material from the wall faces themselves"
- 202: "rounds 1 and 2 both failed the tessellation because the annulus was built independently of
  the model… round 3 extruded the target face itself"
- 218: "round 1 used `BRepAlgoAPI_Defeaturing`: correct volume but it rebuilt the whole body…
  round 2 was a double-claim bookkeeping error recorded invalid with no candidate"
- 224: "round 1 let the drill cutter span the whole Z range… round 2 limited it to the drill's real extent"
- 225: "rounds 1 and 2 built the new envelope as a revolved profile… each left a 0.0209 mm² untessellatable sliver"
- 229: "rounds 1–2 failed on coincident-surface booleans (280 non-manifold edges; then slivers).
  Eight recipes were measured; a boolean fuzzy value of 1e-4 was the fix"
- 231 (1 round, for contrast): "A boolean fuzzy value of 1e-4 **emptied the result here** and was set to 0"
- 248: "geometry correct, official gate failed… fix: isolate the block with a prism built in its own frame"
- 203: "radii 137.0, 139.0, 139.2, 139.5, 139.8, 139.9, 139.95 and 139.99 were all tried"

So `rounds_used` measures **how boolean-hostile the part is** (dense feature-rich castings,
coincident surfaces, thin sheets, untessellatable inherited blends), and boolean-hostile parts are
also the ones where features are hard to identify. The correlation is confounded, not causal —
extra rounds do not *make* the score worse.

But the flip side is the actionable half: **iteration has never once fixed a wrong reading in
run-005**, because the loop has no signal that a reading is wrong (F-006). The multi-round samples
that ended at ≈0.400 (201, 218, 229, 243) each spent 2–3 rounds perfecting the execution of a
reading that scores zero. run-004 is the interesting counterexample: its 5-round samples (214, 217)
and 2-round 218 **did** re-identify their targets across rounds, and 218's re-identification was a
genuine improvement in reasoning even though the score did not follow.

## Implication for round budget

Do **not** cut the round budget — rounds are buying validity, and validity recovery was worth
+1.513 (26 % of all gain: 202, 217, 240). Instead, **change what a round is allowed to be spent
on**: at present 100 % of rounds go to implementation. Reserve at least one round on ambiguous
samples for building the runner-up reading (F-006 R-006).

## Remedy candidate — R-016

1. Treat `rounds_used ≥ 3` as a **triage flag**, not a quality metric: it marks a boolean-hostile
   part, which should trigger the size-tiered collateral discipline of F-014 R-014 (no whole-body
   rebuilds, no repair cuts near the edit, watch for slivers).
2. **Split the round budget by purpose**: `implementation_rounds` (as today) and at least one
   `interpretation_round` on any sample flagged by the unfalsifiable-instruction trigger
   (F-013 R-013b) or by a non-unique feature predicate (F-009 R-009 item 2).
3. Carry forward the run-005 boolean playbook as fixed knowledge rather than per-sample
   rediscovery — it is the main consumer of rounds today: fuzzy value 1e-4 fixes coincident-surface
   failures (229) but empties results elsewhere (231), so try 0 first then 1e-4; extrude the target
   face's own profile rather than rebuilding it analytically (202, 209, 211, 215, 245, 250 — every
   one of these was clean); `SkipClean.clean=False` throughout; avoid `Defeaturing` on dense bodies
   (218, and run-004's 214/218 same-domain merge cascade).

Cost: low. Correctness: high for items 1 and 3, medium for item 2 (it trades implementation
robustness for interpretation coverage, and validity is worth more per round today).
