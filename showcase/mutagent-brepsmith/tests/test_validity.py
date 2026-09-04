"""T4 — capability `validity-checker`: the benchmark's three-condition gate, verbatim."""

from __future__ import annotations

import build123d as bd

from cadtools.validity import ADVISORY_MIN_FACE_AREA, check_validity, check_validity_file


def test_clean_box_passes(box: bd.Solid) -> None:
    report = check_validity(box)
    assert report.is_valid is True
    assert report.brep_well_formed is True
    assert report.shells_closed is True
    assert report.mesh_manifold is True
    assert report.mesh_closed is True
    assert report.orientation_consistent is True
    assert report.failures == []


def test_through_hole_part_passes(plate_with_through_hole: bd.Solid) -> None:
    assert check_validity(plate_with_through_hole).is_valid is True


def test_hollow_ball_passes(hollow_ball: bd.Solid) -> None:
    assert check_validity(hollow_ball).is_valid is True


def test_open_shell_fails_watertight(open_shell: bd.Shell) -> None:
    report = check_validity(open_shell)
    assert report.is_valid is False
    assert report.shells_closed is False or report.mesh_closed is False
    joined = " ".join(report.failures).lower()
    assert "naked" in joined or "not closed" in joined
    assert report.n_naked_edges > 0


def test_advisory_flags_do_not_gate(sliver_face_part: bd.Solid) -> None:
    """A sliver face is diagnostic noise, never a validity failure (per the benchmark doc)."""
    report = check_validity(sliver_face_part)
    assert report.is_valid is True
    assert report.advisories, "the sliver face must be reported as an advisory"
    assert any("face area" in a.lower() for a in report.advisories)
    assert report.min_face_area < ADVISORY_MIN_FACE_AREA


def test_plain_box_has_no_advisories(box: bd.Solid) -> None:
    assert check_validity(box).advisories == []


def test_report_is_json_serializable(box: bd.Solid) -> None:
    import json

    payload = check_validity(box).to_dict()
    assert json.loads(json.dumps(payload))["is_valid"] is True


def test_check_validity_file_roundtrip(box_step) -> None:  # type: ignore[no-untyped-def]
    assert check_validity_file(box_step).is_valid is True


def test_all_three_conditions_are_reported_independently(box: bd.Solid) -> None:
    """The gate names WHICH condition failed — a bare boolean cannot drive a fix loop."""
    report = check_validity(box)
    payload = report.to_dict()
    for key in (
        "brep_well_formed",
        "shells_closed",
        "mesh_manifold",
        "mesh_closed",
        "orientation_consistent",
    ):
        assert key in payload
