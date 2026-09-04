"""T9 — the command-line surface: the ONE binding the Claude Code harness needs.

Tool binding is target-conditional (PR-004). For a `harness:claude-code` target the binding
is CLI-first — the agent already has Bash, so the deterministic checkers are reached as
subcommands rather than through an MCP server or an SDK. The spec says as much:
"the deterministic checkers ... live as project Python modules the agent calls — no MCP or
external service required".

Every subcommand prints ONE JSON object on stdout::

    {"ok": <bool>, "command": <str>, "data": {...}, "error": <str>}

and uses its EXIT CODE as the gate: `verify` exits non-zero on invalid geometry, `round`
exits non-zero when the budget is exhausted. This matters because a language model reading
prose can talk itself out of a failure; it cannot talk its way out of a non-zero exit code.

Run it as ``uv run python -m cadtools.cli <subcommand>``.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SUBCOMMANDS: tuple[str, ...] = (
    "analyze",
    "verify",
    "diff",
    "score",
    "grade",
    "gen-pairs",
    "list-recipes",
    "fetch-dataset",
    "round",
    "emit",
    "package",
    "aggregate",
)

LEDGER_FILENAME = "ledger.json"
# Mirrored here so building the parser does not import build123d (geometry_diff pulls in the
# OpenCascade extension); `tests/test_cli.py` pins it to BOTH library defaults (the differ's
# and the scorer's), which `diff --samples` and `score --samples` share.
DEFAULT_DIFF_SAMPLES = 20000
# Mirrored for the same reason: the fractional tolerance shared by `diff --expect-volume-delta`
# and `diff --target-face-area`. Pinned to the library constant by `tests/test_cli.py`.
DEFAULT_INTENT_TOLERANCE = 0.02


@dataclass
class Result:
    ok: bool
    command: str
    data: dict[str, Any]
    error: str = ""
    exit_code: int = 0

    def emit(self) -> int:
        print(
            json.dumps(
                {"ok": self.ok, "command": self.command, "data": self.data, "error": self.error},
                indent=2,
                default=str,
            )
        )
        return self.exit_code


# --- ledger persistence -----------------------------------------------------------


def _ledger_path(runs_root: str, run_id: str, sample_id: str) -> Path:
    return Path(runs_root) / run_id / sample_id / LEDGER_FILENAME


def _load_ledger(runs_root: str, run_id: str, sample_id: str, max_rounds: int):  # type: ignore[no-untyped-def]
    from cadtools.budget import RoundLedger, RoundRecord

    ledger = RoundLedger(run_id=run_id, sample_id=sample_id, max_rounds=max_rounds)
    path = _ledger_path(runs_root, run_id, sample_id)
    if not path.exists():
        return ledger
    payload = json.loads(path.read_text(encoding="utf-8"))
    ledger.max_rounds = int(payload.get("max_rounds", max_rounds))
    ledger._started = int(payload.get("rounds_used", 0))
    ledger.records = [
        RoundRecord(
            round=int(r["round"]),
            valid=bool(r["valid"]),
            score=float(r["score"]),
            checks_passed=bool(r["checks_passed"]),
            failures=list(r["failures"]),
            candidate_path=r.get("candidate_path"),
            report=r.get("report"),
            score_source=str(r.get("score_source", "check-results")),
            waived_checks=list(r.get("waived_checks", [])),
        )
        for r in payload.get("records", [])
    ]
    return ledger


def _save_ledger(runs_root: str, ledger: Any) -> None:
    path = _ledger_path(runs_root, ledger.run_id, ledger.sample_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ledger.to_dict(), indent=2, default=str), encoding="utf-8")


# --- handlers ---------------------------------------------------------------------


def _cmd_analyze(args: argparse.Namespace) -> Result:
    from cadtools.step_io import introspect_file

    return Result(True, "analyze", introspect_file(args.step).to_dict())


def _cmd_verify(args: argparse.Namespace) -> Result:
    from cadtools.validity import check_validity_file

    report = check_validity_file(args.step)
    return Result(
        ok=report.is_valid,
        command="verify",
        data=report.to_dict(),
        error="" if report.is_valid else "; ".join(report.failures),
        exit_code=0 if report.is_valid else 2,
    )


def _cmd_diff(args: argparse.Namespace) -> Result:
    from cadtools.geometry_diff import check_volume_delta, cross_section, diff_files

    report = diff_files(
        args.reference,
        args.candidate,
        require_frame_agreement=not args.allow_repose,
        n_samples=args.n_samples,
    )
    region_min = tuple(args.region_min) if args.region_min else None
    region_max = tuple(args.region_max) if args.region_max else None
    data = report.to_dict()
    data["locality"] = report.locality(region_min, region_max)  # type: ignore[arg-type]
    # R5: a waived check is a FIELD, not a paragraph. `--allow-repose` used to leave no trace
    # in the JSON at all, so a bypassed hard gate reached the ledger as narrative prose.
    data["waivers"] = (
        [
            {
                "check": "frame-agreement",
                "granted": True,
                "flag": "--allow-repose",
                "frame_agreed": report.frame.agree,
                "note": "diagnostic use only; the frame gate did not run as a gate",
            }
        ]
        if args.allow_repose
        else []
    )

    failures: list[str] = []
    if not report.operation_class_ok and not args.allow_retype:
        failures.append(
            "surface-type conservation: the edit destroyed "
            + ", ".join(
                f"{n} {name} face(s) (at most "
                f"{report.surface_type_allowance[name]} explainable by a "
                f"changed_fraction of {report.changed_fraction:.4f})"
                for name, n in sorted(report.surface_types_destroyed.items())
            )
            + " — that is a different operation class than the one requested, not a "
            "different amount of it"
        )
    if not data["locality"]["is_localized_to"] and region_min is not None:
        failures.append(
            "locality: geometry outside the requested region moved by "
            f"{data['locality']['max_distance_outside']:.6f} mm "
            f"(> {report.change_tolerance:.6f} mm tolerance)"
        )

    # F-005 / abc_0352: the VOLUMETRIC intent check. Reported when asked for, and a GATE when
    # asked for — an extent-only reading of "did I do what was asked" cannot see a pad that
    # swept the wrong cross-section, because the wrong pad reaches the same extents.
    if args.expect_volume_delta is not None:
        intent = check_volume_delta(report, args.expect_volume_delta, tolerance=args.tol)
        data["volume_intent"] = intent.to_dict()
        if not intent.within_tolerance:
            failures.append(f"volume intent: {intent.message}")
    else:
        data["volume_intent"] = None

    # Cross-section preservation is REPORTED on every diff (it costs nothing beyond the
    # samples already taken) and GATED only when the target face area is supplied.
    section = cross_section(
        report,
        axis=args.change_axis,
        target_face_area=args.target_face_area,
        tolerance=args.tol,
    )
    data["cross_section"] = section.to_dict() if section else None
    if section is not None and section.preserved is False:
        failures.append(f"cross-section: {section.message}")
    data["checks_passed"] = not failures
    data["failures"] = failures
    return Result(
        ok=not failures,
        command="diff",
        data=data,
        error="; ".join(failures),
        exit_code=0 if not failures else 5,
    )


def _cmd_score(args: argparse.Namespace) -> Result:
    from cadtools.scoring import score_editing_files

    card = score_editing_files(
        args.input, args.candidate, args.ground_truth, n_samples=args.n_samples
    )
    return Result(True, "score", card.to_dict())


def _cmd_grade(args: argparse.Namespace) -> Result:
    from cadtools.complexity import grade_file

    return Result(True, "grade", grade_file(args.step).to_dict())


def _devtools() -> Any:
    """Import the dataset-generation devtools, or explain why they are absent.

    F-003: the answer-key generator shipped in the SAME import namespace as the runtime
    checkers, so installing the tools an eval subject needs necessarily installed the module
    that reconstructs the ground truth. It now lives in a separate distribution that an eval
    profile does not install (see `pyproject.toml`), and this is where that absence surfaces
    as a clean, honest message rather than a traceback.
    """
    try:
        import cadtools_devtools.synthetic_pairs as devtools
    except ImportError as exc:  # pragma: no cover - exercised in the eval profile
        raise RuntimeError(
            "cadtools-devtools is not installed. The synthetic dataset generator is a "
            "DEVELOPMENT tool and is deliberately absent from the eval runtime profile "
            "(installing it inside a scored run would put the answer key in the subject's "
            "own import namespace). Install it with `uv pip install -e ./devtools`."
        ) from exc
    return devtools


def _cmd_gen_pairs(args: argparse.Namespace) -> Result:
    from cadtools.manifest import validate_manifest

    generate_pairs = _devtools().generate_pairs

    manifest = generate_pairs(
        args.input,
        args.out_dir,
        recipes=args.recipes,
        instruction_style=args.instruction_style,
    )
    validate_manifest(manifest)
    if args.manifest:
        Path(args.manifest).parent.mkdir(parents=True, exist_ok=True)
        import yaml

        Path(args.manifest).write_text(yaml.safe_dump(manifest, sort_keys=False), encoding="utf-8")
    return Result(True, "gen-pairs", manifest)


def _cmd_list_recipes(_: argparse.Namespace) -> Result:
    return Result(True, "list-recipes", _devtools().list_recipes())


def _cmd_fetch_dataset(args: argparse.Namespace) -> Result:
    from cadtools.dataset import build_real_inputs_manifest, download_dataset

    report = download_dataset(args.out_dir)
    data: dict[str, Any] = {"download": report.to_dict()}
    if report.status != "ok":
        return Result(False, "fetch-dataset", data, error=report.error, exit_code=3)
    manifest = build_real_inputs_manifest(args.out_dir)
    if args.manifest:
        import yaml

        Path(args.manifest).parent.mkdir(parents=True, exist_ok=True)
        Path(args.manifest).write_text(yaml.safe_dump(manifest, sort_keys=False), encoding="utf-8")
    data["manifest"] = manifest
    return Result(True, "fetch-dataset", data)


def _budget_exhausted(ledger: Any, sink: Any, exc: Exception) -> Result:
    decision = ledger.emit()
    sink.append("budget-exhausted", {"reason": str(exc), "decision": decision.to_dict()})
    return Result(
        ok=False,
        command="round",
        data={
            "budget_exhausted": True,
            "rounds_used": ledger.rounds_used,
            "max_rounds": ledger.max_rounds,
            "decision": decision.to_dict(),
        },
        error=str(exc),
        exit_code=4,
    )


def _cmd_round(args: argparse.Namespace) -> Result:
    """Claim a round, record an outcome against one, or both.

    F-004-1: this used to claim AND record in one indivisible step, with `record_valid`
    defaulting to False — so the documented protocol ("claim a round before you write that
    round's script; record the outcome on that round afterwards") GUARANTEED a phantom
    `valid: false` record on the claim and burned a second slot on the record. 11 of 75
    budgeted rounds were destroyed that way, leaving an effective budget of ~2.5 of 5.

    Three shapes now:

    * bare `round` — CLAIMS the next round and records nothing.
    * `round --round N --record-valid|--record-invalid` — records against an already-claimed
      round; consumes no budget.
    * `round --record-valid|--record-invalid` with no `--round` — records against the most
      recent claimed-but-unrecorded round if there is one, else claims and records in one go
      (the old single-call shape, preserved so it stays correct rather than merely legal).
    """
    from cadtools.aggregate import max_rounds_for_arm
    from cadtools.budget import BudgetExhausted, compute_round_score
    from cadtools.trace import TraceSink

    if args.score is not None:
        return Result(
            ok=False,
            command="round",
            data={},
            error=(
                "--score is not accepted: the harness computes the round score from the "
                "recorded check results, or measures it against a ground truth when you pass "
                "--input/--ground-truth/--candidate. A score the subject reports about its "
                "own attempt cannot rank that subject's attempts (F-002)."
            ),
            exit_code=2,
        )

    arm = "baseline" if args.no_verify_loop else "harness"
    max_rounds = max_rounds_for_arm(arm)
    ledger = _load_ledger(args.runs_root, args.run_id, args.sample_id, max_rounds)
    sink = TraceSink(args.run_id, args.sample_id, root=args.runs_root)

    recording = args.record_valid is not None or args.round_no is not None
    recorded = {r.round for r in ledger.records}

    if not recording:
        try:
            round_no = ledger.start_round()
        except BudgetExhausted as exc:
            return _budget_exhausted(ledger, sink, exc)
    elif args.round_no is not None:
        round_no = args.round_no
    else:
        open_rounds = [n for n in range(1, ledger.rounds_used + 1) if n not in recorded]
        if open_rounds:
            round_no = open_rounds[-1]
        else:
            try:
                round_no = ledger.start_round()
            except BudgetExhausted as exc:
                return _budget_exhausted(ledger, sink, exc)

    score: float | None = None
    score_source = "check-results"
    if recording:
        if round_no < 1:
            return Result(
                ok=False,
                command="round",
                data={"rounds_used": ledger.rounds_used},
                error=(
                    "no round has been claimed yet — run `cadtools.cli round` with no outcome "
                    "flags to claim one, then record against it with --round N"
                ),
                exit_code=4,
            )
        valid = bool(args.record_valid)
        checks_passed = valid and bool(args.checks_passed)
        failures = list(args.failure or [])
        if args.candidate and args.input and args.ground_truth:
            from cadtools.scoring import score_editing_files

            card = score_editing_files(args.input, args.candidate, args.ground_truth)
            score = card.cad_score_proxy
            score_source = "ground-truth-proxy"
        else:
            score = compute_round_score(valid=valid, checks_passed=checks_passed, failures=failures)
        try:
            ledger.record(
                round_no,
                valid=valid,
                score=score,
                checks_passed=checks_passed,
                failures=failures,
                candidate_path=args.candidate,
                score_source=score_source,
                waived_checks=list(args.waive or []),
            )
        except ValueError as exc:
            return Result(
                ok=False,
                command="round",
                data={"round": round_no, "rounds_used": ledger.rounds_used},
                error=str(exc),
                exit_code=4,
            )

    _save_ledger(args.runs_root, ledger)
    sink.append(
        "round",
        {
            "round": round_no,
            "arm": arm,
            "recorded": recording,
            "valid": args.record_valid,
            "score": score,
            "score_source": score_source if recording else None,
            "waived_checks": list(args.waive or []),
            "candidate_path": args.candidate,
        },
    )
    return Result(
        True,
        "round",
        {
            "round": round_no,
            "arm": arm,
            "recorded": recording,
            "score": score,
            "score_source": score_source if recording else None,
            "waived_checks": list(args.waive or []),
            "rounds_used": ledger.rounds_used,
            "rounds_remaining": ledger.rounds_remaining,
            "should_stop": ledger.should_stop(),
            "trace_path": sink.path,
        },
    )


def _cmd_emit(args: argparse.Namespace) -> Result:
    from cadtools.trace import TraceSink

    ledger = _load_ledger(args.runs_root, args.run_id, args.sample_id, args.max_rounds)
    decision = ledger.emit()
    sink = TraceSink(args.run_id, args.sample_id, root=args.runs_root)
    sink.append("emit", decision.to_dict())
    return Result(True, "emit", {**decision.to_dict(), "trace_path": sink.path})


def _cmd_package(args: argparse.Namespace) -> Result:
    from cadtools.package import SubmissionMeta, build_submission

    meta = SubmissionMeta(
        submitter_name=args.submitter_name,
        submission_name=args.submission_name,
        agent_url=args.agent_url,
        notes=args.notes,
        agree_to_publish=args.agree_to_publish,
    )
    report = build_submission(args.samples_root, args.out, meta)
    return Result(True, "package", report.to_dict())


def _cmd_aggregate(args: argparse.Namespace) -> Result:
    from cadtools.aggregate import SampleScore, aggregate_run

    payload = json.loads(Path(args.scores).read_text(encoding="utf-8"))
    scores = [SampleScore(**entry) for entry in payload]
    return Result(True, "aggregate", aggregate_run(args.arm, scores))


# --- parser -----------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cadtools",
        description="Deterministic CAD checkers for the mutagent-brepsmith agent. JSON on stdout.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("analyze", help="Topology/dimension readback of a STEP file.")
    p.add_argument("step")
    p.set_defaults(handler=_cmd_analyze)

    p = sub.add_parser("verify", help="Validity gate. Exits non-zero when invalid.")
    p.add_argument("step")
    p.set_defaults(handler=_cmd_verify)

    p = sub.add_parser("diff", help="Localized-change diff between two STEP bodies.")
    p.add_argument("reference")
    p.add_argument("candidate")
    p.add_argument(
        "--allow-repose",
        action="store_true",
        help=(
            "Do not fail on frame disagreement (diagnostic use only). The waiver is recorded "
            "in the report's `waivers[]` block."
        ),
    )
    p.add_argument(
        "--allow-retype",
        action="store_true",
        help=(
            "Do not fail when the edit destroys more analytic surface types than its changed "
            "fraction explains (diagnostic use only)."
        ),
    )
    p.add_argument(
        "--samples",
        type=int,
        default=DEFAULT_DIFF_SAMPLES,
        dest="n_samples",
        help=(
            "Surface samples per body for the proximity query (default 20000). Lower it for "
            "very dense meshes."
        ),
    )
    p.add_argument(
        "--region-min",
        nargs=3,
        type=float,
        default=None,
        dest="region_min",
        help="X Y Z of the requested change region; enables the locality gate.",
    )
    p.add_argument(
        "--region-max",
        nargs=3,
        type=float,
        default=None,
        dest="region_max",
        help="X Y Z of the requested change region; enables the locality gate.",
    )
    p.add_argument(
        "--expect-volume-delta",
        type=float,
        default=None,
        dest="expect_volume_delta",
        help=(
            "Expected signed volume change in mm^3 (e.g. face_area * depth for a pad, "
            "negative for a pocket). Fails the diff when the measured delta falls outside "
            "--tol. Extents alone cannot see a pad that swept the wrong cross-section."
        ),
    )
    p.add_argument(
        "--target-face-area",
        type=float,
        default=None,
        dest="target_face_area",
        help=(
            "Area in mm^2 of the face the edit was supposed to sweep. Gates cross-section "
            "preservation: |volume_delta| / depth must match it within --tol."
        ),
    )
    p.add_argument(
        "--change-axis",
        choices=["x", "y", "z"],
        default=None,
        dest="change_axis",
        help=(
            "Axis the change was swept along. Default: inferred as the thinnest extent of "
            "the changed region."
        ),
    )
    p.add_argument(
        "--tol",
        type=float,
        default=DEFAULT_INTENT_TOLERANCE,
        dest="tol",
        help=(
            "Fractional tolerance for --expect-volume-delta and --target-face-area "
            f"(default {DEFAULT_INTENT_TOLERANCE})."
        ),
    )
    p.set_defaults(handler=_cmd_diff)

    p = sub.add_parser("score", help="Benchmark-parity scorecard against a ground truth.")
    p.add_argument("--input", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--ground-truth", required=True, dest="ground_truth")
    p.add_argument(
        "--samples",
        type=int,
        default=DEFAULT_DIFF_SAMPLES,
        dest="n_samples",
        help=(
            "Surface samples per body for the F1 proximity query (default 20000). The count "
            "is recorded in the scorecard, so scores taken at different sample counts are "
            "never silently compared."
        ),
    )
    p.set_defaults(handler=_cmd_score)

    p = sub.add_parser("grade", help="Deterministic complexity tier of a STEP file.")
    p.add_argument("step")
    p.set_defaults(handler=_cmd_grade)

    p = sub.add_parser("gen-pairs", help="Generate synthetic (input, instruction, GT) triples.")
    p.add_argument("--input", required=True)
    p.add_argument("--out-dir", required=True, dest="out_dir")
    p.add_argument("--recipes", nargs="*", default=None)
    p.add_argument("--instruction-style", default="precise-quantitative", dest="instruction_style")
    p.add_argument("--manifest", default=None)
    p.set_defaults(handler=_cmd_gen_pairs)

    p = sub.add_parser("list-recipes", help="List the available synthetic edit recipes.")
    p.set_defaults(handler=_cmd_list_recipes)

    p = sub.add_parser("fetch-dataset", help="Download the public benchmark editing samples.")
    p.add_argument("--out-dir", required=True, dest="out_dir")
    p.add_argument("--manifest", default=None)
    p.set_defaults(handler=_cmd_fetch_dataset)

    p = sub.add_parser("round", help="Claim the next edit->verify round. Refuses round 6.")
    p.add_argument("--run-id", required=True, dest="run_id")
    p.add_argument("--sample-id", required=True, dest="sample_id")
    p.add_argument("--runs-root", default="runs", dest="runs_root")
    p.add_argument("--candidate", default=None)
    p.add_argument(
        "--score",
        type=float,
        default=None,
        help=argparse.SUPPRESS,  # accepted only so it can be REFUSED with a reason (F-002)
    )
    p.add_argument(
        "--round",
        type=int,
        default=None,
        dest="round_no",
        help=(
            "Record the outcome against an already-claimed round. Omit it and every "
            "--record-* flag to CLAIM a round without recording anything."
        ),
    )
    p.add_argument(
        "--input",
        default=None,
        help="Input STEP; with --ground-truth, the "
        "harness MEASURES this round's score instead of deriving it.",
    )
    p.add_argument("--ground-truth", default=None, dest="ground_truth")
    p.add_argument(
        "--waive",
        action="append",
        default=None,
        help="Record a WAIVED check by name (machine-readable, not prose). Repeatable.",
    )
    p.add_argument("--failure", action="append", default=None)
    p.add_argument("--record-valid", action="store_true", dest="record_valid")
    p.add_argument("--record-invalid", action="store_false", dest="record_valid")
    p.add_argument("--checks-passed", action="store_true", dest="checks_passed")
    p.add_argument(
        "--no-verify-loop",
        action="store_true",
        dest="no_verify_loop",
        help="Single-shot baseline arm: caps the round budget at 1 (T19).",
    )
    # None, not False: "no outcome flag was supplied" must be distinguishable from
    # "--record-invalid", or a bare claim files a fabricated failure (F-004-1).
    p.set_defaults(handler=_cmd_round, record_valid=None)

    p = sub.add_parser("emit", help="Decide what to write as output.step. Always decides.")
    p.add_argument("--run-id", required=True, dest="run_id")
    p.add_argument("--sample-id", required=True, dest="sample_id")
    p.add_argument("--runs-root", default="runs", dest="runs_root")
    p.add_argument("--max-rounds", type=int, default=5, dest="max_rounds")
    p.set_defaults(handler=_cmd_emit)

    p = sub.add_parser("package", help="Assemble the leaderboard submission zip.")
    p.add_argument("--samples-root", required=True, dest="samples_root")
    p.add_argument("--out", required=True)
    p.add_argument("--submitter-name", required=True, dest="submitter_name")
    p.add_argument("--submission-name", required=True, dest="submission_name")
    p.add_argument("--agent-url", required=True, dest="agent_url")
    p.add_argument("--notes", default="")
    p.add_argument(
        "--agree-to-publish",
        action="store_true",
        dest="agree_to_publish",
        help="Opt IN to publication. Defaults to false: consent is the operator's to give.",
    )
    p.set_defaults(handler=_cmd_package)

    p = sub.add_parser("aggregate", help="Roll per-sample scores into a run summary.")
    p.add_argument("--scores", required=True, help="JSON file: a list of SampleScore objects.")
    p.add_argument("--arm", default="harness", choices=["harness", "baseline"])
    p.set_defaults(handler=_cmd_aggregate)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = args.handler(args)
    except Exception as exc:  # noqa: BLE001 - a CLI must fail as data, not as a traceback
        return Result(
            ok=False,
            command=args.command,
            data={},
            error=f"{type(exc).__name__}: {exc}",
            exit_code=1,
        ).emit()
    return result.emit()


if __name__ == "__main__":  # pragma: no cover - exercised via subprocess in the tests
    sys.exit(main())
