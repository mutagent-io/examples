"""T9 — the CLI: the ONLY binding the Claude Code harness needs (PR-004, CLI-first)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from fixtures import ELL_BBOX_FACE_AREA, ELL_FACE_AREA, ELL_PAD_DEPTH

from cadtools.cli import SUBCOMMANDS, main


def _run(args: list[str], capsys: pytest.CaptureFixture[str]) -> tuple[int, dict]:
    code = main(args)
    out = capsys.readouterr().out
    return code, json.loads(out)


def test_every_subcommand_is_registered() -> None:
    assert set(SUBCOMMANDS) == {
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
    }


def test_analyze_emits_parseable_json(box_step: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code, payload = _run(["analyze", str(box_step)], capsys)
    assert code == 0
    assert payload["ok"] is True
    assert payload["data"]["n_faces"] == 6


def test_verify_exit_code_is_zero_on_valid(
    box_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, payload = _run(["verify", str(box_step)], capsys)
    assert code == 0
    assert payload["data"]["is_valid"] is True


def test_verify_exit_code_is_nonzero_on_invalid(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The gate must be usable from a shell `if`: invalid geometry exits non-zero."""
    import build123d as bd

    from cadtools.step_io import export_step_file

    box = bd.Solid.make_box(10, 10, 10)
    shell = bd.Shell(sorted(box.faces(), key=lambda f: f.center().Z)[:-1])
    path = tmp_path / "leaky.step"
    export_step_file(shell, path)

    code, payload = _run(["verify", str(path)], capsys)
    assert code != 0
    assert payload["data"]["is_valid"] is False
    assert payload["data"]["failures"]


def test_missing_file_is_a_clean_json_error_not_a_traceback(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, payload = _run(["analyze", str(tmp_path / "nope.step")], capsys)
    assert code != 0
    assert payload["ok"] is False
    assert "can't open file" in payload["error"]


def test_grade_emits_a_tier(box_step: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code, payload = _run(["grade", str(box_step)], capsys)
    assert code == 0
    assert payload["data"]["tier"] == "low"


def test_diff_reports_locality(
    plate_step: Path, plate_with_corner_hole_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, payload = _run(["diff", str(plate_step), str(plate_with_corner_hole_step)], capsys)
    assert code == 0
    assert payload["data"]["betti_delta"] == [0, 1, 0]


def test_score_emits_the_proxy_not_a_cad_score(
    plate_step: Path, plate_with_corner_hole_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, payload = _run(
        [
            "score",
            "--input",
            str(plate_step),
            "--candidate",
            str(plate_with_corner_hole_step),
            "--ground-truth",
            str(plate_with_corner_hole_step),
        ],
        capsys,
    )
    assert code == 0
    assert "cad_score" not in payload["data"]
    assert payload["data"]["interface"] is None


def test_round_refuses_the_sixth_round(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """The budget is enforced by the CLI, not by the model's memory."""
    args = ["round", "--run-id", "r1", "--sample-id", "201", "--runs-root", str(tmp_path)]
    for expected in range(1, 6):
        code, payload = _run([*args, "--record-invalid"], capsys)
        assert code == 0
        assert payload["data"]["round"] == expected
    code, payload = _run([*args, "--record-invalid"], capsys)
    assert code != 0
    assert payload["data"]["budget_exhausted"] is True


def test_round_with_no_verify_loop_caps_at_one(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    args = [
        "round",
        "--run-id",
        "b1",
        "--sample-id",
        "201",
        "--runs-root",
        str(tmp_path),
        "--no-verify-loop",
    ]
    code, _ = _run([*args, "--record-invalid"], capsys)
    assert code == 0
    code, payload = _run([*args, "--record-invalid"], capsys)
    assert code != 0
    assert payload["data"]["budget_exhausted"] is True


def test_round_appends_to_the_trace(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    _run(
        ["round", "--run-id", "r2", "--sample-id", "9", "--runs-root", str(tmp_path)],
        capsys,
    )
    assert (tmp_path / "r2" / "9" / "trace.jsonl").exists()


def test_emit_always_produces_a_decision(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    base = ["--run-id", "r3", "--sample-id", "201", "--runs-root", str(tmp_path)]
    _run(["round", *base, "--record-invalid"], capsys)
    code, payload = _run(["emit", *base], capsys)
    assert code == 0
    assert payload["data"]["status"] in {"valid", "least-broken", "none"}


def test_package_reports_missing_samples(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    samples = tmp_path / "samples"
    (samples / "201").mkdir(parents=True)
    (samples / "201" / "output.step").write_text("ISO-10303-21;\n")
    (samples / "202").mkdir(parents=True)
    code, payload = _run(
        [
            "package",
            "--samples-root",
            str(samples),
            "--out",
            str(tmp_path / "s.zip"),
            "--submitter-name",
            "Bruno",
            "--submission-name",
            "v1",
            "--agent-url",
            "https://example.invalid",
        ],
        capsys,
    )
    assert code == 0
    assert payload["data"]["missing"] == ["202"]
    assert payload["data"]["n_missing"] == 1


# --- F-004-1: claiming a round and recording its outcome are separate acts ---------------


def _ledger_of(tmp_path: Path, run_id: str, sample_id: str) -> dict:
    return json.loads((tmp_path / run_id / sample_id / "ledger.json").read_text())


def test_claim_then_record_consumes_exactly_one_round(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """THE F-004-1 regression, in the exact shape the agent doc MANDATES.

    "Claim a round before you write that round's script. After verifying, record the outcome
    on that round." Obeying that guaranteed a double-count: the claim wrote a fabricated
    `valid: false` record (argparse default), and the record call had no way to address the
    round it belonged to, so it burned a second slot. 11 of 75 budgeted rounds were destroyed
    that way — an effective budget of ~2.5 of 5.
    """
    base = ["--run-id", "r4", "--sample-id", "201", "--runs-root", str(tmp_path)]

    code, payload = _run(["round", *base], capsys)
    assert code == 0
    assert payload["data"]["round"] == 1
    assert payload["data"]["recorded"] is False

    code, payload = _run(["round", *base, "--round", "1", "--record-valid"], capsys)
    assert code == 0
    assert payload["data"]["round"] == 1
    assert payload["data"]["recorded"] is True
    assert payload["data"]["rounds_used"] == 1

    ledger = _ledger_of(tmp_path, "r4", "201")
    assert ledger["rounds_used"] == 1
    assert len(ledger["records"]) == 1
    assert ledger["records"][0]["round"] == 1
    assert ledger["records"][0]["valid"] is True


def test_a_bare_claim_writes_no_record(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """The phantom record was a fabricated failure for a round whose script had not run."""
    base = ["--run-id", "r5", "--sample-id", "201", "--runs-root", str(tmp_path)]
    _run(["round", *base], capsys)
    ledger = _ledger_of(tmp_path, "r5", "201")
    assert ledger["rounds_used"] == 1
    assert ledger["records"] == []


def test_recording_an_unclaimed_round_is_refused(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    base = ["--run-id", "r6", "--sample-id", "201", "--runs-root", str(tmp_path)]
    code, payload = _run(["round", *base, "--round", "3", "--record-valid"], capsys)
    assert code != 0
    assert "never started" in payload["error"]


def test_five_claim_record_pairs_fit_the_budget(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The end-to-end guarantee: the documented protocol now yields the full 5 rounds."""
    base = ["--run-id", "r7", "--sample-id", "201", "--runs-root", str(tmp_path)]
    for expected in range(1, 6):
        code, payload = _run(["round", *base], capsys)
        assert code == 0, payload
        assert payload["data"]["round"] == expected
        code, payload = _run(
            ["round", *base, "--round", str(expected), "--record-invalid", "--failure", "x"],
            capsys,
        )
        assert code == 0, payload
        assert payload["data"]["round"] == expected
    code, payload = _run(["round", *base], capsys)
    assert code != 0
    assert payload["data"]["budget_exhausted"] is True


def test_an_outcome_without_round_lands_on_the_open_claim(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A record with no --round addresses the claimed-but-unrecorded round, not a new one."""
    base = ["--run-id", "r8", "--sample-id", "201", "--runs-root", str(tmp_path)]
    _run(["round", *base], capsys)
    code, payload = _run(["round", *base, "--record-valid"], capsys)
    assert code == 0
    assert payload["data"]["round"] == 1
    assert _ledger_of(tmp_path, "r8", "201")["rounds_used"] == 1


# --- F-002: the harness computes the score, the subject does not report one --------------


def test_a_self_reported_score_is_refused(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """`--score 0.9` against a measured 0.1429 is what won emission in run-001."""
    base = ["--run-id", "r9", "--sample-id", "201", "--runs-root", str(tmp_path)]
    code, payload = _run(["round", *base, "--record-valid", "--score", "0.9"], capsys)
    assert code != 0
    assert "--score is not accepted" in payload["error"]


def test_the_recorded_score_is_derived_from_the_checks(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    base = ["--run-id", "r10", "--sample-id", "201", "--runs-root", str(tmp_path)]
    code, payload = _run(["round", *base, "--record-valid", "--checks-passed"], capsys)
    assert code == 0
    assert payload["data"]["score"] == 1.0
    assert payload["data"]["score_source"] == "check-results"


def test_a_ground_truth_makes_the_harness_measure_the_score(
    tmp_path: Path,
    plate_step: Path,
    plate_with_corner_hole_step: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Where an answer key exists the harness measures rather than derives — and says which."""
    base = ["--run-id", "r11", "--sample-id", "201", "--runs-root", str(tmp_path)]
    code, payload = _run(
        [
            "round",
            *base,
            "--record-valid",
            "--checks-passed",
            "--candidate",
            str(plate_with_corner_hole_step),
            "--input",
            str(plate_step),
            "--ground-truth",
            str(plate_with_corner_hole_step),
        ],
        capsys,
    )
    assert code == 0
    assert payload["data"]["score_source"] == "ground-truth-proxy"
    assert payload["data"]["score"] > 0.9


def test_a_waiver_is_recorded_as_a_field_not_as_prose(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """R5: `--allow-repose` used to turn a hard stop into a paragraph in report.json."""
    base = ["--run-id", "r12", "--sample-id", "201", "--runs-root", str(tmp_path)]
    _run(["round", *base, "--record-valid", "--waive", "frame-agreement"], capsys)
    record = _ledger_of(tmp_path, "r12", "201")["records"][0]
    assert record["waived_checks"] == ["frame-agreement"]


# --- F-002 / R3: the diff gates on operation class and reports locality -------------------


def test_diff_reports_the_surface_type_histograms(
    plate_step: Path, plate_with_corner_hole_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, payload = _run(["diff", str(plate_step), str(plate_with_corner_hole_step)], capsys)
    assert code == 0
    assert payload["data"]["surface_types_ref"]["PLANE"] == 6
    assert payload["data"]["operation_class_ok"] is True
    assert payload["data"]["checks_passed"] is True


def test_diff_fails_when_the_edit_destroys_its_surface_types(
    tmp_path: Path, plate_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The F-002 candidate exits NON-ZERO at VERIFY 4b, with rounds still in budget, instead
    of passing every metric the harness computed."""
    import build123d as bd

    from cadtools.step_io import export_step_file, import_step_file

    plate = import_step_file(str(plate_step))
    scaled = plate.transform_geometry(bd.Matrix([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1.25, 0]]))
    scaled_path = tmp_path / "scaled.step"
    export_step_file(scaled, scaled_path)

    code, payload = _run(["diff", str(plate_step), str(scaled_path)], capsys)
    assert code != 0
    assert payload["data"]["operation_class_ok"] is False
    assert payload["data"]["surface_types_destroyed"]["PLANE"] > 0
    assert "surface-type conservation" in payload["error"]

    code, _ = _run(["diff", str(plate_step), str(scaled_path), "--allow-retype"], capsys)
    assert code == 0, "the escape hatch must exist and must be explicit"


def test_diff_emits_the_locality_block_and_gates_on_an_explicit_region(
    plate_step: Path, plate_with_corner_hole_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """F-002: `is_localized_to` / `max_distance_outside` had ZERO production callers, so the
    criterion that names them was written against a check nothing could invoke."""
    args = ["diff", str(plate_step), str(plate_with_corner_hole_step)]
    code, payload = _run(
        [*args, "--region-min", "1", "1", "-1", "--region-max", "7", "7", "6"], capsys
    )
    assert code == 0
    assert payload["data"]["locality"]["is_localized_to"] is True
    assert payload["data"]["locality"]["region_source"] == "explicit"

    code, payload = _run(
        [*args, "--region-min", "15", "15", "0", "--region-max", "16", "16", "1"], capsys
    )
    assert code != 0
    assert "locality" in payload["error"]


def test_a_waived_frame_check_is_reported_as_a_waiver(
    tmp_path: Path, plate_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    import build123d as bd

    from cadtools.step_io import export_step_file, import_step_file

    moved = import_step_file(str(plate_step)).moved(bd.Location((200.0, 0.0, 0.0)))
    moved_path = tmp_path / "moved.step"
    export_step_file(moved, moved_path)

    code, payload = _run(["diff", str(plate_step), str(moved_path), "--allow-repose"], capsys)
    assert code == 0
    assert payload["data"]["waivers"][0]["check"] == "frame-agreement"
    assert payload["data"]["waivers"][0]["frame_agreed"] is False


def test_diff_accepts_a_samples_flag(
    plate_step: Path, plate_with_corner_hole_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """F-004-2: both agents had to abandon the CLI and hand-drive `diff_shapes` from a Python
    script to complete a MANDATORY verify step, because `n_samples` was unreachable."""
    code, payload = _run(
        ["diff", str(plate_step), str(plate_with_corner_hole_step), "--samples", "500"], capsys
    )
    assert code == 0
    assert payload["data"]["n_samples"] == 500


def test_the_cli_sample_default_matches_the_library(capsys: pytest.CaptureFixture[str]) -> None:
    from cadtools.cli import DEFAULT_DIFF_SAMPLES
    from cadtools.geometry_diff import DEFAULT_SAMPLES

    assert DEFAULT_DIFF_SAMPLES == DEFAULT_SAMPLES


def test_module_entry_point_runs(box_step: Path) -> None:
    """`python -m cadtools.cli` is the exact invocation the agent prompt tells it to use."""
    result = subprocess.run(
        [sys.executable, "-m", "cadtools.cli", "analyze", str(box_step)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["data"]["n_faces"] == 6


def test_score_accepts_a_samples_flag(
    plate_step: Path, plate_with_corner_hole_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """R8: `score` exposed no `--samples`, so an operator facing an OOM on a dense mesh had no
    lever at all — the flag `diff` already had was missing from the command that scores."""
    code, payload = _run(
        [
            "score",
            "--input",
            str(plate_step),
            "--candidate",
            str(plate_with_corner_hole_step),
            "--ground-truth",
            str(plate_with_corner_hole_step),
            "--samples",
            "500",
        ],
        capsys,
    )
    assert code == 0
    assert payload["data"]["n_samples"] == 500


def test_the_cli_sample_default_matches_the_scorer() -> None:
    from cadtools.cli import DEFAULT_DIFF_SAMPLES
    from cadtools.scoring import DEFAULT_SAMPLES

    assert DEFAULT_DIFF_SAMPLES == DEFAULT_SAMPLES


# --- run-003 F-005 (abc_0352): the VOLUMETRIC intent check on the diff surface ------------


def test_diff_expect_volume_delta_passes_a_face_profile_pad(
    ell_prism_step: Path, ell_profile_pad_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, payload = _run(
        [
            "diff",
            str(ell_prism_step),
            str(ell_profile_pad_step),
            "--expect-volume-delta",
            str(ELL_FACE_AREA * ELL_PAD_DEPTH),
            "--samples",
            "4000",
        ],
        capsys,
    )
    assert code == 0
    intent = payload["data"]["volume_intent"]
    assert intent["within_tolerance"] is True
    assert intent["expected_delta"] == pytest.approx(ELL_FACE_AREA * ELL_PAD_DEPTH)
    assert payload["data"]["checks_passed"] is True


def test_diff_expect_volume_delta_fails_the_bounding_rectangle_pad(
    ell_prism_step: Path, ell_bbox_pad_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """run-003 abc_0352: every bbox extent matched the ground truth and the volume did not.

    The agent's own verify reported `intent: pass` on the extents alone; this is the check
    that makes that impossible.
    """
    code, payload = _run(
        [
            "diff",
            str(ell_prism_step),
            str(ell_bbox_pad_step),
            "--expect-volume-delta",
            str(ELL_FACE_AREA * ELL_PAD_DEPTH),
            "--samples",
            "4000",
        ],
        capsys,
    )
    assert code != 0
    assert payload["data"]["volume_intent"]["within_tolerance"] is False
    assert payload["data"]["checks_passed"] is False
    assert "volume intent" in payload["error"]
    # ...while the frame/extent evidence is perfectly happy
    assert payload["data"]["frame_agreement"]["agree"] is True


def test_diff_tol_widens_the_expected_volume_check(
    ell_prism_step: Path, ell_bbox_pad_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    args = [
        "diff",
        str(ell_prism_step),
        str(ell_bbox_pad_step),
        "--expect-volume-delta",
        str(ELL_FACE_AREA * ELL_PAD_DEPTH),
        "--samples",
        "4000",
    ]
    code, payload = _run([*args, "--tol", "0.5"], capsys)
    assert code == 0
    assert payload["data"]["volume_intent"]["tolerance"] == pytest.approx(0.5)


def test_diff_reports_the_changed_region_cross_section_without_being_asked(
    ell_prism_step: Path, ell_profile_pad_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Cross-section preservation is REPORTED on every diff; the target area GATES it."""
    code, payload = _run(
        ["diff", str(ell_prism_step), str(ell_profile_pad_step), "--samples", "6000"], capsys
    )
    assert code == 0
    section = payload["data"]["cross_section"]
    assert section["axis"] == "x"
    assert section["axis_source"].startswith("inferred")
    assert section["footprint_area"] == pytest.approx(ELL_FACE_AREA, rel=0.20)
    assert section["implied_area"] == pytest.approx(ELL_FACE_AREA, rel=0.02)
    assert section["target_face_area"] is None
    assert section["preserved"] is None, "no target area was given, so nothing was gated"


def test_diff_gates_cross_section_against_the_target_face_area(
    ell_prism_step: Path, ell_bbox_pad_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, payload = _run(
        [
            "diff",
            str(ell_prism_step),
            str(ell_bbox_pad_step),
            "--target-face-area",
            str(ELL_FACE_AREA),
            "--samples",
            "6000",
        ],
        capsys,
    )
    assert code != 0
    section = payload["data"]["cross_section"]
    assert section["preserved"] is False
    assert section["implied_area"] == pytest.approx(ELL_BBOX_FACE_AREA, rel=0.02)
    assert "cross-section" in payload["error"]


def test_diff_change_axis_is_explicit_when_named(
    ell_prism_step: Path, ell_profile_pad_step: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, payload = _run(
        [
            "diff",
            str(ell_prism_step),
            str(ell_profile_pad_step),
            "--change-axis",
            "z",
            "--samples",
            "4000",
        ],
        capsys,
    )
    assert code == 0
    assert payload["data"]["cross_section"]["axis"] == "z"
    assert payload["data"]["cross_section"]["axis_source"] == "explicit"


def test_the_cli_intent_tolerance_default_matches_the_library() -> None:
    from cadtools.cli import DEFAULT_INTENT_TOLERANCE as cli_default
    from cadtools.geometry_diff import DEFAULT_INTENT_TOLERANCE as lib_default

    assert cli_default == lib_default
