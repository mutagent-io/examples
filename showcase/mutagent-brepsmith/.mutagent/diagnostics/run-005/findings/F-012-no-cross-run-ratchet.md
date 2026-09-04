# F-012 — There is no cross-run ratchet: run-005 re-derived every reading from scratch with no knowledge of which run-004 readings had scored

- **Confidence:** high
- **Scope:** both major regressions (238, 214) = −0.676, i.e. 82 % of all loss mass in the run
- **Question:** Q2

## Evidence

`grep -c "eval-run-004\|run-004\|previous run" runs/eval-run-005/armA/*/report.json` returns **zero
matches across all 32 reports.** No run-005 report references a prior run's reading, output,
score, or rejected alternative. run-005's `interpretation.rejected_readings` lists are derived
independently each time — which is why 238's list contains the symmetric reading as a fresh
"serious contender" rather than as *the reading that scored 0.7772 six days earlier*.

Total loss mass in run-005 = **−0.8214**. Of that, 238 (−0.3772) and 214 (−0.2988) = **−0.676**.
Both are cases where the previous run's scored reading was on run-005's own candidate list and was
argued away on a preference heuristic:

| id | run-004 reading (scored) | present in run-005's list? | why discarded |
|---|---|---|---|
| 238 | symmetric 2.5 + 2.5 mm trim, 0.7772 | **yes**, `rejected_readings[1]`, called "a serious contender" | "the conservatism rule is fewest entities changed" |
| 214 | sleeve over the bore's own 54 mm span, fillet left in place, 0.8620 | **yes**, `rejected_readings[3]` | "rejected as less physical" |

Neither discard cites a *measurement* that contradicts the prior reading. Both cite a stylistic
preference. In both cases the prior reading was worth +0.30 to +0.38.

## The rule (this is the one the brief asked for, stated precisely)

**R-012 — Scored-reading ratchet.**

> When the plausible-reading set for a sample contains a reading that a **previously scored run**
> emitted, that reading becomes the **incumbent**. Changing away from the incumbent requires
> **positive evidence**: a measurement on the model that the incumbent reading contradicts, or an
> official score showing the incumbent underperformed. Preference heuristics — "fewer entities
> changed", "more physical", "conventional up-direction", "less destructive" — are **not**
> positive evidence and may not displace an incumbent.
>
> Corollary A: if the incumbent scored ≥ 0.6, it may only be displaced by a challenger that is
> *also built and emitted alongside it* (candidate-carrying, F-006 R-006) — never by argument alone.
> Corollary B: if the incumbent scored ≤ 0.41 (shape-zero), it is **anti-**incumbent: the reading is
> known-wrong and must be excluded from the candidate set, not re-derived (see F-013, where run-005
> independently re-derived 246's and 243's run-004 readings and re-scored 0.4000 identically).

## Mechanism to implement it

The agent currently receives only `input.step` + the instruction. Add a **per-sample prior file**
assembled deterministically from the previous run's artifacts before dispatch:

```
{ sample_id, prior_run_id, prior_score, prior_reading_summary,
  prior_rejected_readings[], prior_method_notes, verdict: incumbent | anti-incumbent | none }
```

Sources already exist: `runs/eval-run-00N/armA/<id>/report.json` (readings, rejected readings,
method notes) joined to `.mutagent/evaluator/run-00N/official-result.json → per_sample_scores`
(scores). No new measurement is required — this is pure bookkeeping the pipeline is currently
throwing away.

Guardrail against overfitting: the prior file must carry the *reading*, not the *output geometry*,
and the ratchet must be a burden-of-proof rule rather than a hard lock, so that genuinely better
readings (the 17 wins, all of which displaced anti-incumbents scoring ≤ 0.50) still get through.
Note that **every one of the 17 wins displaced a run-004 reading that had scored ≤ 0.5657**, and
**both regressions displaced readings that had scored ≥ 0.7772** — a single threshold near 0.6
separates the two populations cleanly with no misclassification.

## Cost / correctness

Cost: **low** (a join over two existing JSON artifacts, plus one paragraph of policy in the agent
spec). Correctness: **high** — the threshold is empirically clean on 32/32 samples, and the two
regressions it would have blocked are worth **+0.021 on the editing mean** on their own
(0.676 / 32).
