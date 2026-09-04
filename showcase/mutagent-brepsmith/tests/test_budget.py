"""T9 — the round-budget ledger.

The spec's constraint is "at most 5 edit->verify->fix rounds, and the agent ALWAYS emits an
output". A constraint the model merely remembers is not a constraint, so it is enforced by
code here and asserted below. Covers amendment A2.
"""

from __future__ import annotations

import pytest

from cadtools.budget import (
    MAX_ROUNDS,
    BudgetExhausted,
    RoundLedger,
    compute_round_score,
)


def _ledger(**kwargs: object) -> RoundLedger:
    return RoundLedger(run_id="r", sample_id="s", **kwargs)  # type: ignore[arg-type]


def test_max_rounds_is_five() -> None:
    assert MAX_ROUNDS == 5


def test_ledger_allows_exactly_five_implement_verify_iterations() -> None:
    """A2 — assert the COUNT of iterations, not merely that a sixth is refused."""
    ledger = _ledger()
    iterations = 0
    while ledger.can_start_round():
        round_no = ledger.start_round()
        iterations += 1
        ledger.record(round_no, valid=False, score=0.1 * round_no, failures=["still broken"])
    assert iterations == 5
    assert ledger.rounds_used == 5
    assert ledger.rounds_remaining == 0


def test_sixth_round_is_refused() -> None:
    ledger = _ledger()
    for _ in range(MAX_ROUNDS):
        n = ledger.start_round()
        ledger.record(n, valid=False, score=0.0, failures=["nope"])
    assert ledger.can_start_round() is False
    with pytest.raises(BudgetExhausted):
        ledger.start_round()


def test_all_checks_pass_exits_early() -> None:
    """A2 — a fully passing round terminates the loop; the budget is a cap, not a quota."""
    ledger = _ledger()
    iterations = 0
    while ledger.can_start_round() and not ledger.should_stop():
        n = ledger.start_round()
        iterations += 1
        ledger.record(n, valid=True, score=1.0, checks_passed=True)
    assert iterations == 1
    assert ledger.should_stop() is True
    assert ledger.rounds_remaining == MAX_ROUNDS - 1
    decision = ledger.emit()
    assert decision.status == "valid"
    assert decision.round == 1


def test_budget_exhaustion_still_emits() -> None:
    """A2 — an exhausted budget must still reach EMIT with the least-broken candidate."""
    ledger = _ledger()
    for i in range(MAX_ROUNDS):
        n = ledger.start_round()
        ledger.record(
            n,
            valid=False,
            score=0.0,
            failures=["a"] * (MAX_ROUNDS - i),  # round 5 is the least broken
        )
    assert ledger.can_start_round() is False
    decision = ledger.emit()
    assert decision.status == "least-broken"
    assert decision.round == 5
    assert decision.reason
    assert decision.record is not None


def test_best_valid_attempt_is_never_overwritten_by_worse() -> None:
    ledger = _ledger()
    ledger.record(ledger.start_round(), valid=True, score=0.8)
    ledger.record(ledger.start_round(), valid=True, score=0.3)
    assert ledger.best_valid is not None
    assert ledger.best_valid.score == 0.8
    assert ledger.emit().round == 1


def test_a_valid_attempt_always_beats_an_invalid_one_however_pretty() -> None:
    ledger = _ledger()
    ledger.record(ledger.start_round(), valid=False, score=0.99, failures=["not watertight"])
    ledger.record(ledger.start_round(), valid=True, score=0.20)
    decision = ledger.emit()
    assert decision.status == "valid"
    assert decision.round == 2


def test_emit_with_no_attempts_is_reported_not_faked() -> None:
    decision = _ledger().emit()
    assert decision.status == "none"
    assert decision.record is None
    assert decision.reason


def test_single_round_mode_caps_at_one() -> None:
    """T19 — the same-model single-shot baseline arm shares this ledger, capped at 1."""
    ledger = _ledger(max_rounds=1)
    n = ledger.start_round()
    ledger.record(n, valid=True, score=0.5)
    assert ledger.can_start_round() is False
    assert ledger.rounds_used == 1


def test_ledger_is_json_serializable() -> None:
    import json

    ledger = _ledger()
    ledger.record(ledger.start_round(), valid=True, score=0.5)
    payload = json.loads(json.dumps(ledger.to_dict()))
    assert payload["max_rounds"] == MAX_ROUNDS
    assert payload["rounds_used"] == 1
    assert payload["decision"]["status"] == "valid"


def test_recording_an_unstarted_round_is_rejected() -> None:
    ledger = _ledger()
    with pytest.raises(ValueError):
        ledger.record(3, valid=True, score=1.0)


def test_recording_the_same_round_twice_is_rejected() -> None:
    """A round is recorded once. Re-scoring an attempt after the fact is not bookkeeping."""
    ledger = _ledger()
    n = ledger.start_round()
    ledger.record(n, valid=True, score=0.5)
    with pytest.raises(ValueError, match="already has a recorded outcome"):
        ledger.record(n, valid=True, score=0.9)


# --- F-002: checks_passed gates emission ------------------------------------------------


def test_a_high_score_with_failing_checks_never_beats_a_low_one_that_passed() -> None:
    """THE F-002 regression, in the numbers it actually happened with.

    `abc_0397-thicken` recorded round 2 as `score: 0.9, checks_passed: false` against a
    measured proxy of 0.1429, and won emission because `checks_passed` was recorded and then
    consulted by nothing. It must now lose to any check-clean candidate, however much lower
    that candidate scores.
    """
    ledger = _ledger()
    ledger.record(ledger.start_round(), valid=True, score=0.9, checks_passed=False)
    ledger.record(ledger.start_round(), valid=True, score=0.14, checks_passed=True)

    assert ledger.best_valid is not None
    assert ledger.best_valid.round == 2
    assert ledger.best_valid.score == 0.14
    decision = ledger.emit()
    assert decision.status == "valid"
    assert decision.round == 2


def test_a_check_dirty_candidate_is_still_emitted_when_nothing_cleaner_exists() -> None:
    """The always-emit guarantee survives the new ranking: a flawed body beats no file."""
    ledger = _ledger()
    ledger.record(ledger.start_round(), valid=True, score=0.3, checks_passed=False)
    decision = ledger.emit()
    assert decision.status == "valid"
    assert decision.round == 1
    assert "no round passed its verification checks" in decision.reason


def test_checks_passed_outranks_score_but_validity_outranks_both() -> None:
    ledger = _ledger()
    ledger.record(ledger.start_round(), valid=False, score=1.0, checks_passed=True)
    ledger.record(ledger.start_round(), valid=True, score=0.05, checks_passed=False)
    assert ledger.emit().round == 2


# --- the harness computes the score -----------------------------------------------------


def test_score_is_derived_from_the_recorded_check_results() -> None:
    """Every input is a gate OUTCOME, so the number is reproducible from the ledger alone."""
    assert compute_round_score(valid=False, checks_passed=True, failures=[]) == 0.0
    assert compute_round_score(valid=True, checks_passed=False, failures=["not localized"]) == 0.5
    assert compute_round_score(valid=True, checks_passed=False, failures=[]) == 0.7
    assert compute_round_score(valid=True, checks_passed=True, failures=[]) == 1.0


def test_the_derived_score_is_monotone_in_the_checks() -> None:
    """A strictly better set of outcomes must not score lower — otherwise the ranking lies."""
    worse = compute_round_score(valid=True, checks_passed=False, failures=["a", "b"])
    better = compute_round_score(valid=True, checks_passed=True, failures=[])
    assert better > worse


def test_records_carry_their_score_provenance_and_any_waiver() -> None:
    ledger = _ledger()
    ledger.record(
        ledger.start_round(),
        valid=True,
        score=0.5,
        score_source="ground-truth-proxy",
        waived_checks=["frame-agreement"],
    )
    payload = ledger.to_dict()["records"][0]
    assert payload["score_source"] == "ground-truth-proxy"
    assert payload["waived_checks"] == ["frame-agreement"]
