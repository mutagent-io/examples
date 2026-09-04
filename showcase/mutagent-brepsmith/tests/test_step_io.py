"""T3 — capability `step-io`: STEP round-trip + topology introspection."""

from __future__ import annotations

from pathlib import Path

import build123d as bd
import pytest

from cadtools.step_io import (
    TopologyReport,
    export_step_file,
    import_step_file,
    introspect,
)


def test_import_returns_a_shape(box_step: Path) -> None:
    shape = import_step_file(box_step)
    assert isinstance(shape, bd.Shape)
    assert len(shape.solids()) == 1


def test_import_missing_file_raises_valueerror(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        import_step_file(tmp_path / "does-not-exist.step")


def test_export_returns_true(tmp_path: Path, box: bd.Solid) -> None:
    out = tmp_path / "out.step"
    assert export_step_file(box, out) is True
    assert out.exists() and out.stat().st_size > 0


def test_roundtrip_preserves_topology(tmp_path: Path, through_hole_step: Path) -> None:
    source = import_step_file(through_hole_step)
    out = tmp_path / "roundtrip.step"
    export_step_file(source, out)
    reimported = import_step_file(out)
    a, b = introspect(source), introspect(reimported)
    assert (a.n_solids, a.n_faces, a.n_edges) == (b.n_solids, b.n_faces, b.n_edges)
    assert a.volume == pytest.approx(b.volume, rel=1e-6)


def test_introspect_reports_expected_fields(box_step: Path) -> None:
    report = introspect(import_step_file(box_step))
    assert isinstance(report, TopologyReport)
    assert report.n_solids == 1
    assert report.n_faces == 6
    assert report.n_edges == 12
    assert report.volume > 0
    assert report.area > 0
    assert len(report.bbox_min) == 3 and len(report.bbox_max) == 3
    assert report.bbox_diagonal > 0
    assert report.surface_types == {"PLANE": 6}


def test_introspect_reports_curved_surface_types(through_hole_step: Path) -> None:
    report = introspect(import_step_file(through_hole_step))
    assert "CYLINDER" in report.surface_types


def test_report_is_json_serializable(box_step: Path) -> None:
    import json

    payload = introspect(import_step_file(box_step)).to_dict()
    assert json.loads(json.dumps(payload))["n_faces"] == 6


def test_export_creates_parent_directories(tmp_path: Path, box: bd.Solid) -> None:
    out = tmp_path / "nested" / "deeper" / "out.step"
    assert export_step_file(box, out) is True
    assert out.exists()
