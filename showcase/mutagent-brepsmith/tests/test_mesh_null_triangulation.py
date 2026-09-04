"""Regression: a face OCCT refuses to triangulate must not crash — or corrupt — the mesh.

BRepMesh does not always return a triangulation for every face. When it gives up on one,
``BRep_Tool.Triangulation_s`` hands back a NULL handle, and build123d's own
``Shape.tessellate`` dereferences it unguarded::

    AttributeError: 'NoneType' object has no attribute 'NbNodes'

That is the crash this module pins. But not-crashing is the easy half: a dropped face
punches a hole in the mesh, and the Betti pipeline reads holes as topology. So these tests
assert the *recovery* is correct, not merely quiet.

The real-world trigger (CadGenBench sample 242) is exercised at the bottom, guarded by a
skip so the suite still runs without the downloaded dataset. The logic itself is pinned by
generated fixtures and by a stubbed null face, which need no data at all.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import build123d as bd
import numpy as np
import pytest

from cadtools import mesh as mesh_mod
from cadtools.mesh import (
    ANGULAR_TOLERANCE_LADDER,
    MeshData,
    bbox_diagonal,
    deflection_for_bbox,
    euler_characteristic,
    is_closed_mesh,
    naked_edges,
    tessellate,
    tessellate_with_report,
)
from cadtools.scoring import betti_numbers

REPO_ROOT = Path(__file__).resolve().parents[1]
SAMPLE_242 = REPO_ROOT / "datasets" / "cadgenbench-data" / "242" / "input.step"
SAMPLE_242_MESH = REPO_ROOT / "datasets" / "cadgenbench-data" / "242" / "input.mesh.npz"


# --- the ladder's shape -----------------------------------------------------------


def test_ladder_starts_at_the_shared_angular_tolerance() -> None:
    """Rung 0 must be the normal rule, so a healthy shape is meshed exactly as before."""
    assert ANGULAR_TOLERANCE_LADDER[0] == mesh_mod.ANGULAR_TOLERANCE


def test_ladder_relaxes_monotonically_and_stays_capped() -> None:
    """Past ~0.3 rad the tessellation is too coarse to carry real topology (see mesh.py)."""
    assert list(ANGULAR_TOLERANCE_LADDER) == sorted(ANGULAR_TOLERANCE_LADDER)
    assert len(set(ANGULAR_TOLERANCE_LADDER)) == len(ANGULAR_TOLERANCE_LADDER)
    assert ANGULAR_TOLERANCE_LADDER[-1] <= 0.3


# --- healthy shapes are untouched -------------------------------------------------


def test_healthy_shape_never_leaves_the_first_rung(box: bd.Solid) -> None:
    """No null faces => no relaxation, so existing results stay bit-for-bit what they were."""
    _, report = tessellate_with_report(box)
    assert report.angular_tolerance == mesh_mod.ANGULAR_TOLERANCE
    assert not report.relaxed
    assert report.complete
    assert report.skipped_faces == ()


def test_report_mesh_matches_plain_tessellate(plate_with_through_hole: bd.Solid) -> None:
    """``tessellate`` is exactly the mesh half of ``tessellate_with_report``."""
    plain = tessellate(plate_with_through_hole)
    reported, _ = tessellate_with_report(plate_with_through_hole)
    assert np.array_equal(plain.faces, reported.faces)
    assert np.allclose(plain.vertices, reported.vertices)


def test_report_counts_every_face(box: bd.Solid) -> None:
    _, report = tessellate_with_report(box)
    assert report.n_faces == len(box.faces()) == 6
    assert report.deflection == deflection_for_bbox(bbox_diagonal(box))


# --- a null triangulation must not crash, and must be accounted for ---------------


def test_null_triangulation_does_not_raise_attributeerror(
    monkeypatch: pytest.MonkeyPatch, box: bd.Solid
) -> None:
    """The bug, in miniature: force every face to come back null and demand no crash.

    Before the fix this raised ``AttributeError: 'NoneType' object has no attribute
    'NbNodes'`` from inside build123d's ``Shape.tessellate``.
    """
    monkeypatch.setattr(mesh_mod, "_face_triangulation", lambda face: None)

    with pytest.warns(mesh_mod.IncompleteTessellationWarning):
        result, report = tessellate_with_report(box)

    assert isinstance(result, MeshData)
    assert result.n_faces == 0
    # Never silently wrong: the dropped faces are named, not absorbed.
    assert not report.complete
    assert len(report.skipped_faces) == report.n_faces == 6


def test_a_skipped_face_is_flagged_rather_than_quietly_dropped(
    monkeypatch: pytest.MonkeyPatch, box: bd.Solid
) -> None:
    """One unmeshable face => an open mesh, and the report says so."""
    real = mesh_mod._face_triangulation

    def drop_face_three(face: bd.Face) -> Any | None:
        faces = box.faces()
        if face.wrapped.IsSame(faces[3].wrapped):
            return None
        return real(face)

    monkeypatch.setattr(mesh_mod, "_face_triangulation", drop_face_three)

    with pytest.warns(mesh_mod.IncompleteTessellationWarning):
        result, report = tessellate_with_report(box)

    assert report.skipped_faces == (3,)
    assert not report.complete
    # The hole is real and must be visible, not papered over.
    assert not is_closed_mesh(result)
    assert naked_edges(result)


def test_relaxation_is_attempted_before_giving_up(
    monkeypatch: pytest.MonkeyPatch, box: bd.Solid
) -> None:
    """A face null at rung 0 but meshable at rung 1 must be RECOVERED, not skipped."""
    real = mesh_mod._face_triangulation
    seen: list[float] = []
    original_mesh = mesh_mod._mesh_shape

    def spy(shape: bd.Shape, deflection: float, angular_tolerance: float, force: bool) -> None:
        seen.append(angular_tolerance)
        original_mesh(shape, deflection, angular_tolerance, force)

    def null_on_first_rung(face: bd.Face) -> Any | None:
        if seen and seen[-1] == mesh_mod.ANGULAR_TOLERANCE:
            return None
        return real(face)

    monkeypatch.setattr(mesh_mod, "_mesh_shape", spy)
    monkeypatch.setattr(mesh_mod, "_face_triangulation", null_on_first_rung)

    result, report = tessellate_with_report(box)

    assert seen[0] == mesh_mod.ANGULAR_TOLERANCE
    assert report.relaxed
    assert report.angular_tolerance == ANGULAR_TOLERANCE_LADDER[1]
    assert report.complete and report.skipped_faces == ()
    # Recovered, so the box is whole again.
    assert is_closed_mesh(result)
    assert euler_characteristic(result) == 2


# --- the real trigger -------------------------------------------------------------


@pytest.mark.skipif(not SAMPLE_242.exists(), reason="CadGenBench sample 242 not downloaded")
def test_sample_242_tessellates_instead_of_crashing() -> None:
    """The reported bug, end to end.

    Sample 242 has two small-minor-radius TORUS patches that BRepMesh will not triangulate
    at the shared 0.1 rad angular tolerance, at ANY linear deflection.
    """
    from cadtools.step_io import import_step_file

    shape = import_step_file(str(SAMPLE_242))
    result, report = tessellate_with_report(shape)

    assert result.n_faces > 0
    # Both torus patches must be RECOVERED by relaxation, not dropped: they carry real
    # area (2.95 and 6.32 mm^2) and dropping them holes the body open.
    assert report.complete, f"faces dropped: {report.skipped_faces}"
    assert report.relaxed, "the bug reproduces only if rung 0 leaves null faces"
    assert report.angular_tolerance > mesh_mod.ANGULAR_TOLERANCE


@pytest.mark.skipif(
    not (SAMPLE_242.exists() and SAMPLE_242_MESH.exists()),
    reason="CadGenBench sample 242 not downloaded",
)
def test_sample_242_betti_matches_the_shipped_reference_mesh() -> None:
    """Correctness, not just non-crashing.

    The sample ships the benchmark's own tessellation. Skipping the two null faces yields
    b1 = 5; the reference says b1 = 11. So a "skip the bad face" fix would be silently
    WRONG, and this test is what rules it out.
    """
    from cadtools.step_io import import_step_file

    reference = np.load(SAMPLE_242_MESH)
    reference_mesh = MeshData(vertices=reference["vertices"], faces=reference["triangles"])
    expected = betti_numbers(reference_mesh)
    assert expected == (1, 11, 0), "reference mesh changed; re-derive the expectation"

    ours = tessellate(import_step_file(str(SAMPLE_242)))
    assert betti_numbers(ours) == expected


@pytest.mark.skipif(not SAMPLE_242.exists(), reason="CadGenBench sample 242 not downloaded")
def test_sample_242_grades_end_to_end() -> None:
    """``grade``/``verify`` crashed on this sample; complexity grading is the shared path."""
    from cadtools.complexity import grade_file

    record = grade_file(SAMPLE_242)
    assert record.tier in {"low", "mid", "high"}
    assert record.n_faces == 879
