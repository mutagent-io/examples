"""T7 — capability `complexity-grader`: deterministic tiers for dataset stratification."""

from __future__ import annotations

import build123d as bd

from cadtools.complexity import TIERS, ComplexityRecord, grade_complexity, grade_file


def test_plain_box_is_low(box: bd.Solid) -> None:
    record = grade_complexity(box)
    assert isinstance(record, ComplexityRecord)
    assert record.tier == "low"
    assert record.n_faces == 6
    assert record.n_edges == 12
    assert record.n_solids == 1
    assert record.genus == 0


def test_dense_pattern_part_is_high() -> None:
    """A dense hole pattern must land in the top tier, not merely 'above low'."""
    plate = bd.Solid.make_box(60, 60, 4)
    for i in range(6):
        for j in range(6):
            hole = bd.Solid.make_cylinder(1.5, 12).locate(
                bd.Location((5 + i * 10.0, 5 + j * 10.0, -4))
            )
            plate = plate.cut(hole).solids()[0]
    record = grade_complexity(plate)
    assert record.tier == "high"
    assert record.genus == 36


def test_mid_tier_exists_between_the_extremes() -> None:
    plate = bd.Solid.make_box(40, 40, 5)
    for i in range(3):
        hole = bd.Solid.make_cylinder(2.0, 15).locate(bd.Location((10 + i * 10.0, 20.0, -5)))
        plate = plate.cut(hole).solids()[0]
    plate = plate.fillet(1.0, plate.edges().filter_by(bd.Axis.Z)).solids()[0]
    assert grade_complexity(plate).tier == "mid"


def test_grading_is_deterministic(plate_with_through_hole: bd.Solid) -> None:
    a = grade_complexity(plate_with_through_hole).to_dict()
    b = grade_complexity(plate_with_through_hole).to_dict()
    assert a == b


def test_tiers_are_dataset_category_ids(plate_with_through_hole: bd.Solid) -> None:
    """The tier vocabulary must match the spec's dataset categories tier-low/mid/high."""
    assert TIERS == ("low", "mid", "high")
    assert grade_complexity(plate_with_through_hole).tier in TIERS


def test_record_carries_the_signals_the_spec_names(plate_with_through_hole: bd.Solid) -> None:
    payload = grade_complexity(plate_with_through_hole).to_dict()
    for key in (
        "n_faces",
        "n_edges",
        "n_solids",
        "surface_type_variety",
        "surface_types",
        "feature_density",
        "genus",
        "tier",
        "score",
    ):
        assert key in payload


def test_surface_variety_counts_distinct_types(plate_with_through_hole: bd.Solid) -> None:
    record = grade_complexity(plate_with_through_hole)
    assert record.surface_type_variety >= 2  # planes + the cylindrical bore
    assert "CYLINDER" in record.surface_types


def test_grade_file_roundtrip(through_hole_step) -> None:  # type: ignore[no-untyped-def]
    assert grade_file(through_hole_step).tier in TIERS


def test_record_is_json_serializable(box: bd.Solid) -> None:
    import json

    assert json.loads(json.dumps(grade_complexity(box).to_dict()))["tier"] == "low"
