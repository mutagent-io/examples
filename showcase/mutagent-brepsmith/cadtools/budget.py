"""T9 — the round-budget ledger: the 5-round cap as code, not as prompt adherence.

Two spec constraints meet here:

* "Every sample gets at most 5 edit->verify->fix rounds" — enforced by
  :meth:`RoundLedger.start_round`, which REFUSES round 6 rather than trusting the agent to
  count. A budget the model merely remembers is not a budget.
* "the agent always emits an output — a valid imperfect STEP beats no STEP" — enforced by
  :meth:`RoundLedger.emit`, which always returns a decision: the best VALID attempt if one
  exists, otherwise the least-broken candidate with the failure recorded. Exhausting the
  budget is never a reason to emit nothing, because a missing file scores zero on the
  leaderboard while a flawed-but-valid one does not.

Ranking is lexicographic and deliberately blunt: **validity first, CHECKS second, score
third**. An invalid candidate never outranks a valid one however high it scores, because
validity gates the entire CAD Score — and a candidate whose verification checks FAILED never
outranks one whose checks passed, however high its score.

That middle term is F-002. `abc_0397-thicken` recorded `score: 0.9, checks_passed: false`
against a measured proxy of 0.1429, and won emission, because `checks_passed` was recorded
and then never consulted. Two changes close it:

* :func:`RoundLedger.best_valid` ranks on `(not checks_passed, -score, round)`, so the
  check-dirty candidate can only be emitted when nothing cleaner exists — and the decision
  says so.
* the score itself is **computed by the harness** from recorded check results
  (:func:`compute_round_score`) or measured against a ground truth by the CLI. It is never
  taken from the agent's own estimate. A number the subject invents cannot rank the subject's
  own attempts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MAX_ROUNDS = 5

#: Harness-side score weights. These are gate OUTCOMES, not opinions: each is recorded by a
#: deterministic checker (`verify` exit code, the verification checks, the failure list), so
#: the resulting score is reproducible from the ledger alone.
SCORE_WEIGHT_VALID = 0.5
SCORE_WEIGHT_CHECKS_PASSED = 0.3
SCORE_WEIGHT_NO_FAILURES = 0.2


def compute_round_score(
    *,
    valid: bool,
    checks_passed: bool = False,
    failures: list[str] | None = None,
) -> float:
    """The round score, DERIVED from the recorded check results — never self-reported.

    F-002: the ledger ranked on an agent-supplied `--score`, and the subject supplied 0.9 for
    a candidate the scorer measured at 0.1429. The fix is not to distrust the number harder;
    it is to stop accepting one. Where a ground truth exists the CLI measures the real proxy
    instead (`cadtools.cli round --input ... --ground-truth ...`); where none exists — which
    is the case on the real benchmark — this checklist is what the harness can honestly say.

    Validity gates everything, exactly as it does in the CAD Score itself.
    """
    if not valid:
        return 0.0
    score = SCORE_WEIGHT_VALID
    if checks_passed:
        score += SCORE_WEIGHT_CHECKS_PASSED
    if not (failures or []):
        score += SCORE_WEIGHT_NO_FAILURES
    return round(score, 6)


class BudgetExhausted(RuntimeError):
    """Raised when a round is started beyond the budget."""


@dataclass(frozen=True)
class RoundRecord:
    round: int
    valid: bool
    score: float
    checks_passed: bool
    failures: list[str]
    candidate_path: str | None
    report: dict[str, Any] | None
    #: How `score` was arrived at. "check-results" = derived from this record's own gate
    #: outcomes; "ground-truth-proxy" = measured by the scorer against a GT. There is no
    #: "self-reported" value, and that is the point (F-002).
    score_source: str = "check-results"
    #: Checks the operator explicitly WAIVED for this round, machine-readable so a waiver is
    #: a queryable field rather than a paragraph of prose in report.json (F-001/R5).
    waived_checks: list[str] = field(default_factory=list)

    @property
    def brokenness(self) -> int:
        """How broken this candidate is — used to pick the least-broken fallback."""
        return len(self.failures)

    def to_dict(self) -> dict[str, Any]:
        return {
            "round": self.round,
            "valid": self.valid,
            "score": self.score,
            "checks_passed": self.checks_passed,
            "failures": list(self.failures),
            "candidate_path": self.candidate_path,
            "report": self.report,
            "score_source": self.score_source,
            "waived_checks": list(self.waived_checks),
        }


@dataclass(frozen=True)
class EmissionDecision:
    """What gets written as `output.step`, and why. There is always an answer."""

    status: str  # "valid" | "least-broken" | "none"
    round: int | None
    record: RoundRecord | None
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "round": self.round,
            "record": self.record.to_dict() if self.record else None,
            "reason": self.reason,
        }


@dataclass
class RoundLedger:
    """Per-sample round state. Persisted through the trace sink by the CLI."""

    run_id: str
    sample_id: str
    max_rounds: int = MAX_ROUNDS
    records: list[RoundRecord] = field(default_factory=list)
    _started: int = 0

    # --- budget ---------------------------------------------------------------

    @property
    def rounds_used(self) -> int:
        return self._started

    @property
    def rounds_remaining(self) -> int:
        return max(0, self.max_rounds - self._started)

    def can_start_round(self) -> bool:
        return self._started < self.max_rounds

    def start_round(self) -> int:
        """Claim the next round number, or refuse. Returns a 1-based round number."""
        if not self.can_start_round():
            raise BudgetExhausted(
                f"round budget exhausted for sample {self.sample_id}: "
                f"{self.max_rounds} of {self.max_rounds} rounds used. "
                "Emit the best attempt seen — never start round "
                f"{self.max_rounds + 1}."
            )
        self._started += 1
        return self._started

    def record(
        self,
        round_no: int,
        *,
        valid: bool,
        score: float = 0.0,
        checks_passed: bool = False,
        failures: list[str] | None = None,
        candidate_path: str | None = None,
        report: dict[str, Any] | None = None,
        score_source: str = "check-results",
        waived_checks: list[str] | None = None,
    ) -> RoundRecord:
        if round_no < 1 or round_no > self._started:
            raise ValueError(
                f"round {round_no} was never started (rounds started: {self._started})"
            )
        if any(r.round == round_no for r in self.records):
            raise ValueError(
                f"round {round_no} already has a recorded outcome — a round is recorded once, "
                "so an attempt cannot be re-scored after the fact"
            )
        entry = RoundRecord(
            round=round_no,
            valid=valid,
            score=float(score),
            checks_passed=bool(checks_passed),
            failures=list(failures or []),
            candidate_path=candidate_path,
            report=report,
            score_source=score_source,
            waived_checks=list(waived_checks or []),
        )
        self.records.append(entry)
        return entry

    # --- selection ------------------------------------------------------------

    @property
    def best_valid(self) -> RoundRecord | None:
        """Best VALID attempt: CHECKS-PASSED first, then score, then the EARLIEST round.

        F-002: `checks_passed` was recorded on every round and consulted by nothing, so a
        candidate that failed its own verification could win emission on a score it reported
        about itself. Sorting on `not checks_passed` first means a check-dirty body is
        emitted only when no check-clean one exists — which preserves the always-emit
        guarantee (a check-dirty candidate still beats no file) while removing the incentive.

        Earliest-wins on ties matters: a later round must not displace an equally good earlier
        one, which is the ledger half of the `write-outputs` onFailure clause ("never
        overwrite a previous best attempt with a worse one").
        """
        valid = [r for r in self.records if r.valid]
        if not valid:
            return None
        return min(valid, key=lambda r: (not r.checks_passed, -r.score, r.round))

    @property
    def least_broken(self) -> RoundRecord | None:
        """Fewest validity failures, then highest score, then latest round."""
        if not self.records:
            return None
        return min(self.records, key=lambda r: (r.brokenness, -r.score, -r.round))

    def should_stop(self) -> bool:
        """Loop exit condition, verbatim from the spec: all checks pass OR budget exhausted."""
        if not self.can_start_round():
            return True
        return any(r.checks_passed and r.valid for r in self.records)

    def emit(self) -> EmissionDecision:
        """ALWAYS returns a decision — that is the point of this method."""
        best = self.best_valid
        if best is not None:
            return EmissionDecision(
                status="valid",
                round=best.round,
                record=best,
                reason=(
                    f"emitting the best valid attempt (round {best.round}, "
                    f"score {best.score:.4f} from {best.score_source}, "
                    f"checks_passed={best.checks_passed}) of {len(self.records)} "
                    f"recorded round(s)"
                    + (
                        "; no round passed its verification checks, so this is the "
                        "least-dirty valid body rather than a clean one"
                        if not best.checks_passed
                        else ""
                    )
                ),
            )
        fallback = self.least_broken
        if fallback is not None:
            return EmissionDecision(
                status="least-broken",
                round=fallback.round,
                record=fallback,
                reason=(
                    f"no attempt passed validity in {self.rounds_used} round(s); emitting the "
                    f"least-broken candidate (round {fallback.round}, "
                    f"{fallback.brokenness} failure(s): {'; '.join(fallback.failures)}). "
                    "A missing file scores zero; a flawed one may not."
                ),
            )
        return EmissionDecision(
            status="none",
            round=None,
            record=None,
            reason=(
                "no round produced a candidate at all — nothing to emit. This is reported, "
                "never padded with a placeholder file."
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "sample_id": self.sample_id,
            "max_rounds": self.max_rounds,
            "rounds_used": self.rounds_used,
            "rounds_remaining": self.rounds_remaining,
            "records": [r.to_dict() for r in self.records],
            "decision": self.emit().to_dict(),
        }
