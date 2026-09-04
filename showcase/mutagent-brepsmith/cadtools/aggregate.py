"""T19 — run-level aggregation and the same-model baseline comparison.

The headline claim in the spec is `beats-same-model-baseline`: the harness on
claude-sonnet-5 beats the SAME model run single-shot. For that comparison to mean anything,
the loop must be the ONLY variable — same model, same prompt, same scorer, same samples.
BUILD supplies the apparatus:

* :func:`max_rounds_for_arm` — the `baseline` arm is the identical pipeline with the round
  budget capped at 1 (no VERIFY/ITERATE), which is what `--no-verify-loop` sets.
* :func:`aggregate_run` — a `run_summary.json`-shaped roll-up matching the documented
  run-level fields.
* :func:`compare_arms` — refuses to compare two runs that used different scoring conventions
  or different sample sets (A3). A comparison across conventions is not a weaker result, it
  is a meaningless one, so it raises rather than returning a number.

Actually RUNNING the two arms belongs to EVALUATE, not to this build.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from cadtools.budget import MAX_ROUNDS
from cadtools.scoring import PROXY_CONVENTION

ARMS: dict[str, int] = {
    # the full harness: analyze -> plan -> implement -> verify (loop) -> emit
    "harness": MAX_ROUNDS,
    # the single-shot control: same model, same prompt, no verify loop
    "baseline": 1,
}

RUN_SUMMARY_KEYS: tuple[str, ...] = (
    "arm",
    "convention",
    "n_samples",
    "n_valid",
    "n_invalid",
    "n_missing",
    "validity_rate",
    "aggregate_score",
    "mean_rounds_used",
    "per_sample_scores",
    "per_sample_status",
)


@dataclass(frozen=True)
class SampleScore:
    """One sample's outcome. `status` is `ok` or `missing` — missing scores zero."""

    sample_id: str
    status: str
    valid: bool
    cad_score_proxy: float
    rounds_used: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "sample_id": self.sample_id,
            "status": self.status,
            "valid": self.valid,
            "cad_score_proxy": self.cad_score_proxy,
            "rounds_used": self.rounds_used,
        }


def max_rounds_for_arm(arm: str) -> int:
    if arm not in ARMS:
        raise ValueError(f"unknown arm {arm!r}; known arms: {sorted(ARMS)}")
    return ARMS[arm]


def aggregate_run(arm: str, scores: Sequence[SampleScore]) -> dict[str, Any]:
    """Roll up one arm's per-sample scores into the documented run-level shape."""
    if arm not in ARMS:
        raise ValueError(f"unknown arm {arm!r}; known arms: {sorted(ARMS)}")

    n = len(scores)
    n_missing = sum(1 for s in scores if s.status == "missing")
    n_valid = sum(1 for s in scores if s.valid and s.status != "missing")
    # A missing file is an invalid outcome for the run, not an absent one: the leaderboard
    # scores it zero, so it must dilute the aggregate rather than be excluded from it.
    n_invalid = n - n_valid

    per_sample = {
        s.sample_id: (0.0 if s.status == "missing" else float(s.cad_score_proxy)) for s in scores
    }
    total = sum(per_sample.values())

    return {
        "arm": arm,
        "convention": PROXY_CONVENTION,
        "n_samples": n,
        "n_valid": n_valid,
        "n_invalid": n_invalid,
        "n_missing": n_missing,
        "validity_rate": (n_valid / n) if n else 0.0,
        "aggregate_score": (total / n) if n else 0.0,
        "mean_rounds_used": (sum(s.rounds_used for s in scores) / n) if n else 0.0,
        "per_sample_scores": per_sample,
        "per_sample_status": {s.sample_id: s.status for s in scores},
    }


def compare_arms(harness: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    """Compare two run summaries. Refuses any comparison that is not like-for-like."""
    if harness.get("convention") != baseline.get("convention"):
        raise ValueError(
            "cannot compare runs scored under different conventions: "
            f"{harness.get('convention')!r} vs {baseline.get('convention')!r}"
        )
    if set(harness.get("per_sample_scores", {})) != set(baseline.get("per_sample_scores", {})):
        raise ValueError(
            "cannot compare runs over different sample sets — both arms must cover the "
            "same samples for the loop to be the only variable"
        )
    delta = float(harness["aggregate_score"]) - float(baseline["aggregate_score"])
    return {
        "convention": harness["convention"],
        "harness_arm": harness["arm"],
        "baseline_arm": baseline["arm"],
        "harness_aggregate_score": harness["aggregate_score"],
        "baseline_aggregate_score": baseline["aggregate_score"],
        "harness_validity_rate": harness["validity_rate"],
        "baseline_validity_rate": baseline["validity_rate"],
        "delta": delta,
        "beats_baseline": delta > 0,
        "n_samples": harness["n_samples"],
    }
