"""T19 — run aggregation + the same-model baseline arm (criterion `beats-same-model-baseline`)."""

from __future__ import annotations

import json

import pytest

from cadtools.aggregate import (
    ARMS,
    RUN_SUMMARY_KEYS,
    SampleScore,
    aggregate_run,
    compare_arms,
    max_rounds_for_arm,
)
from cadtools.scoring import PROXY_CONVENTION


def _scores() -> list[SampleScore]:
    return [
        SampleScore(sample_id="201", status="ok", valid=True, cad_score_proxy=0.8, rounds_used=2),
        SampleScore(sample_id="202", status="ok", valid=False, cad_score_proxy=0.0, rounds_used=5),
        SampleScore(
            sample_id="203", status="missing", valid=False, cad_score_proxy=0.0, rounds_used=0
        ),
    ]


def test_summary_shape_matches_contract() -> None:
    summary = aggregate_run("harness", _scores())
    assert set(summary) == set(RUN_SUMMARY_KEYS)


def test_missing_sample_scores_zero() -> None:
    summary = aggregate_run("harness", _scores())
    assert summary["n_missing"] == 1
    assert summary["n_valid"] == 1
    assert summary["n_invalid"] == 2
    assert summary["per_sample_scores"]["203"] == 0.0
    # aggregate is over ALL samples, so a missing file dilutes the mean rather than hiding
    assert summary["aggregate_score"] == pytest.approx(0.8 / 3)
    assert summary["validity_rate"] == pytest.approx(1 / 3)


def test_no_verify_loop_caps_rounds_at_one() -> None:
    assert max_rounds_for_arm("baseline") == 1
    assert max_rounds_for_arm("harness") == 5


def test_arms_are_named_and_bounded() -> None:
    assert set(ARMS) == {"harness", "baseline"}


def test_unknown_arm_is_rejected() -> None:
    with pytest.raises(ValueError, match="arm"):
        max_rounds_for_arm("vibes")
    with pytest.raises(ValueError, match="arm"):
        aggregate_run("vibes", _scores())


def test_summary_carries_the_proxy_convention() -> None:
    """A3 — the local number is always labelled as the proxy it is."""
    summary = aggregate_run("harness", _scores())
    assert summary["convention"] == PROXY_CONVENTION
    assert "cad_score" not in summary


def test_compare_arms_requires_the_same_convention() -> None:
    """A3 — both arms must use the IDENTICAL convention, or the comparison is meaningless."""
    harness = aggregate_run("harness", _scores())
    baseline = aggregate_run("baseline", _scores())
    result = compare_arms(harness, baseline)
    assert result["convention"] == PROXY_CONVENTION
    assert result["delta"] == pytest.approx(0.0)
    assert result["beats_baseline"] is False

    baseline["convention"] = "some-other-convention"
    with pytest.raises(ValueError, match="convention"):
        compare_arms(harness, baseline)


def test_compare_arms_requires_the_same_samples() -> None:
    harness = aggregate_run("harness", _scores())
    baseline = aggregate_run("baseline", _scores()[:2])
    with pytest.raises(ValueError, match="same samples"):
        compare_arms(harness, baseline)


def test_compare_arms_detects_a_win() -> None:
    better = [
        SampleScore(sample_id="201", status="ok", valid=True, cad_score_proxy=0.9, rounds_used=3),
        SampleScore(sample_id="202", status="ok", valid=True, cad_score_proxy=0.5, rounds_used=4),
        SampleScore(sample_id="203", status="ok", valid=True, cad_score_proxy=0.4, rounds_used=1),
    ]
    result = compare_arms(aggregate_run("harness", better), aggregate_run("baseline", _scores()))
    assert result["beats_baseline"] is True
    assert result["delta"] > 0


def test_summary_is_json_serializable() -> None:
    assert json.loads(json.dumps(aggregate_run("harness", _scores())))["arm"] == "harness"


def test_empty_run_is_reported_not_divided_by_zero() -> None:
    summary = aggregate_run("harness", [])
    assert summary["n_samples"] == 0
    assert summary["aggregate_score"] == 0.0
    assert summary["validity_rate"] == 0.0
