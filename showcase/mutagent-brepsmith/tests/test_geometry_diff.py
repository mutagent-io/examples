"""T5 — capability `geometry-differ`: "did I change only what was asked?", numerically.

Also covers amendment A4: frame agreement is a HARD failing check, so a mis-posed pair
fails loudly instead of being silently scored as a bad edit.
"""

from __future__ import annotations

import build123d as bd
import numpy as np
import pytest
from fixtures import (
    ELL_BBOX_FACE_AREA,
    ELL_FACE_AREA,
    ELL_NOTCH_HEIGHT,
    ELL_NOTCH_WIDTH,
    ELL_PAD_DEPTH,
)

from cadtools.geometry_diff import (
    FrameDisagreementError,
    check_frame_agreement,
    check_volume_delta,
    cross_section,
    diff_shapes,
)


def test_identical_bodies_zero_change(plate: bd.Solid) -> None:
    report = diff_shapes(plate, plate)
    assert report.max_distance == pytest.approx(0.0, abs=1e-6)
    assert report.volume_delta == pytest.approx(0.0, abs=1e-9)
    assert report.changed_fraction == pytest.approx(0.0, abs=1e-9)
    assert report.changed_bbox_min is None and report.changed_bbox_max is None


def test_hole_added_is_localized(plate: bd.Solid, plate_with_corner_hole: bd.Solid) -> None:
    report = diff_shapes(plate, plate_with_corner_hole)
    assert report.changed_bbox_min is not None and report.changed_bbox_max is not None
    lo = np.asarray(report.changed_bbox_min)
    hi = np.asarray(report.changed_bbox_max)
    # the hole is a radius-2 cylinder centred at (4, 4) through a 5 mm plate
    assert lo[0] <= 2.2 and hi[0] >= 5.8
    assert lo[1] <= 2.2 and hi[1] >= 5.8
    # ...and nothing outside that region moved
    outside = report.max_distance_outside(region_min=(1.0, 1.0, -1.0), region_max=(7.0, 7.0, 6.0))
    assert outside < 1e-6
    assert report.volume_delta < 0, "cutting a hole removes material"


def test_global_edit_is_not_localized(plate: bd.Solid, thicker_plate: bd.Solid) -> None:
    report = diff_shapes(plate, thicker_plate)
    outside = report.max_distance_outside(region_min=(1.0, 1.0, -1.0), region_max=(7.0, 7.0, 6.0))
    assert outside > 0.5, "a thickness change moves geometry everywhere, not just in one region"
    assert report.volume_delta > 0


def test_reports_betti_delta(plate: bd.Solid, plate_with_through_hole: bd.Solid) -> None:
    report = diff_shapes(plate, plate_with_through_hole)
    assert report.betti_ref == (1, 0, 0)
    assert report.betti_cand == (1, 1, 0)
    assert report.betti_delta == (0, 1, 0)


def test_blind_pocket_does_not_change_topology(
    plate: bd.Solid, plate_with_blind_pocket: bd.Solid
) -> None:
    assert diff_shapes(plate, plate_with_blind_pocket).betti_delta == (0, 0, 0)


def test_report_is_json_serializable(plate: bd.Solid, plate_with_corner_hole: bd.Solid) -> None:
    import json

    payload = diff_shapes(plate, plate_with_corner_hole).to_dict()
    assert json.loads(json.dumps(payload))["betti_delta"] == [0, 1, 0]


# --- A4: frame agreement is a HARD check ------------------------------------------


def test_frame_agreement_passes_for_a_localized_edit(
    plate: bd.Solid, plate_with_corner_hole: bd.Solid
) -> None:
    agreement = check_frame_agreement(plate, plate_with_corner_hole)
    assert agreement.agree is True
    assert agreement.centre_delta < agreement.tolerance


def test_frame_agreement_passes_for_a_legitimate_dimension_change(
    plate: bd.Solid, thicker_plate: bd.Solid
) -> None:
    """A real edit changes extents; the frame check must not confuse that with mis-posing."""
    assert check_frame_agreement(plate, thicker_plate).agree is True


def test_frame_agreement_fails_for_a_translated_body(plate: bd.Solid) -> None:
    moved = plate.moved(bd.Location((100.0, 0.0, 0.0)))
    agreement = check_frame_agreement(plate, moved)
    assert agreement.agree is False
    assert "centre" in agreement.message.lower()


def test_frame_agreement_fails_for_a_rotated_body(plate_with_corner_hole: bd.Solid) -> None:
    rotated = plate_with_corner_hole.rotate(bd.Axis.X, 90)
    assert check_frame_agreement(plate_with_corner_hole, rotated).agree is False


def test_diff_raises_loudly_on_a_mis_posed_pair(plate: bd.Solid) -> None:
    """A4: mis-posed pairs FAIL, they are never quietly scored as a bad edit."""
    moved = plate.moved(bd.Location((100.0, 0.0, 0.0)))
    with pytest.raises(FrameDisagreementError):
        diff_shapes(plate, moved)


def test_diff_can_be_forced_past_frame_disagreement(plate: bd.Solid) -> None:
    moved = plate.moved(bd.Location((100.0, 0.0, 0.0)))
    report = diff_shapes(plate, moved, require_frame_agreement=False)
    assert report.frame.agree is False
    assert report.max_distance > 50


# --- R5 / F-001: the pose test is SIZE-INVARIANT ---------------------------------------


def test_frame_check_passes_a_legitimate_large_dimension_change(plate: bd.Solid) -> None:
    """abc_0365, reduced to its arithmetic. A 25% growth about a SHARED origin corner is not
    a re-pose: `centre_delta` is forced to exactly half `extent_delta`, so every digit of the
    old "frame" evidence was reproducible from the SIZES alone. Fails on the pre-R5 tree,
    where extent_delta 41.25 exceeded a tolerance of 23.38."""
    grown = bd.Solid.make_box(20.0, 20.0, 5.0 + 20.0)  # plate is 20 x 20 x 5, min at origin
    agreement = check_frame_agreement(plate, grown)
    assert agreement.agree is True
    assert agreement.pose_delta == pytest.approx(0.0, abs=1e-9)
    assert agreement.extent_delta > agreement.tolerance
    assert agreement.shape_divergence is True, "a size change is a SHAPE finding, and is said"


def test_frame_check_still_fails_a_real_repose(plate: bd.Solid) -> None:
    """The pairing is the point: the pose/shape distinction must not be 'fixed' by raising
    FRAME_TOLERANCE_RATIO until the gate stops firing."""
    moved = plate.moved(bd.Location((200.0, 0.0, 0.0)))
    assert check_frame_agreement(plate, moved).agree is False

    oblong = bd.Solid.make_box(30.0, 10.0, 5.0)
    spun = oblong.rotate(bd.Axis.Z, 90)
    spun_agreement = check_frame_agreement(oblong, spun)
    assert spun_agreement.agree is False
    assert spun_agreement.axis_permutation is True


def test_a_pure_resize_about_the_centre_is_also_not_a_repose(plate: bd.Solid) -> None:
    grown = bd.Solid.make_box(24.0, 24.0, 6.0).moved(bd.Location((-2.0, -2.0, -0.5)))
    assert check_frame_agreement(plate, grown).agree is True


def test_the_frame_message_separates_size_from_pose(plate: bd.Solid) -> None:
    """F-001's report had to say in prose what the JSON could not: which of the two it was."""
    grown = bd.Solid.make_box(20.0, 20.0, 25.0)
    assert "shape finding" in check_frame_agreement(plate, grown).message
    moved = plate.moved(bd.Location((200.0, 0.0, 0.0)))
    assert "translation" in check_frame_agreement(plate, moved).message


# --- R3 / F-002: surface-type conservation ----------------------------------------------


def test_a_localized_edit_conserves_its_surface_types(
    plate: bd.Solid, plate_with_corner_hole: bd.Solid
) -> None:
    report = diff_shapes(plate, plate_with_corner_hole)
    assert report.surface_types_available is True
    assert report.operation_class_ok is True
    assert report.surface_types_destroyed == {}


def test_an_anisotropic_scale_destroys_every_plane_and_is_caught(plate: bd.Solid) -> None:
    """THE F-002 candidate: a non-uniform Z scale. Valid, watertight, topologically
    identical, dimensionally exact — and it retypes all 6 PLANE faces to BSPLINE, because an
    anisotropic affine transform is exactly the operation that cannot preserve an analytic
    surface. Every metric the harness computed passed this edit."""
    scaled = plate.transform_geometry(bd.Matrix([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1.25, 0]]))
    report = diff_shapes(plate, scaled)
    destroyed = report.surface_types_destroyed
    assert destroyed.get("PLANE"), f"expected destroyed planes, got {destroyed}"
    assert report.operation_class_ok is False


def test_the_rule_is_proportional_not_absolute() -> None:
    """Legitimate edits DO remove faces (fill-hole, fillet), so the gate is proportionality:
    an edit that moved 68% of the surface may take 7 of 9 planes — not all 9."""
    from cadtools.geometry_diff import surface_type_destruction

    destroyed, allowance, ok = surface_type_destruction({"PLANE": 9}, {"PLANE": 0}, 0.68245)
    assert destroyed == {"PLANE": 9}
    assert allowance == {"PLANE": 7}
    assert ok is False

    _, _, ok_small = surface_type_destruction({"CYLINDER": 1}, {}, 0.02)
    assert ok_small is True, "a fill-hole removing its one cylinder is a legitimate edit"

    _, _, ok_total = surface_type_destruction({"PLANE": 9}, {"PLANE": 0}, 1.0)
    assert ok_total is True, "an edit that moved everything may retype everything"


def test_surface_types_are_unavailable_on_bare_meshes(plate: bd.Solid) -> None:
    """Honest absence: a mesh has no BREP surface types, so the check reports that it did not
    run rather than silently passing."""
    from cadtools.mesh import tessellate

    report = diff_shapes(tessellate(plate), tessellate(plate))
    assert report.surface_types_available is False
    assert report.operation_class_ok is True


# --- R3: the locality assertion finally has a caller ------------------------------------


def test_locality_block_reports_the_explicit_region(
    plate: bd.Solid, plate_with_corner_hole: bd.Solid
) -> None:
    report = diff_shapes(plate, plate_with_corner_hole)
    block = report.locality((1.0, 1.0, -1.0), (7.0, 7.0, 6.0))
    assert block["region_source"] == "explicit"
    assert block["is_localized_to"] is True
    assert block["max_distance_outside"] < 1e-6


def test_locality_block_falls_back_to_the_measured_region(
    plate: bd.Solid, thicker_plate: bd.Solid
) -> None:
    report = diff_shapes(plate, thicker_plate)
    block = report.locality()
    assert block["region_source"] == "measured-changed-bbox"
    assert block["region_min"] is not None


# --- R6 / F-004-2: chunked distance -----------------------------------------------------


def test_chunking_does_not_change_the_distances(
    monkeypatch: pytest.MonkeyPatch, plate: bd.Solid, plate_with_corner_hole: bd.Solid
) -> None:
    """`closest_point` is pure per-point with no cross-point reduction, so batching changes
    only the allocation schedule. If that is ever untrue, this test says so."""
    import cadtools.geometry_diff as gd
    import cadtools.proximity as prox

    monkeypatch.setattr(prox, "MIN_CHUNK", 64)
    monkeypatch.setattr(prox, "MAX_CHUNK", 64)
    many = gd.diff_shapes(plate, plate_with_corner_hole, n_samples=2000)

    monkeypatch.setattr(prox, "MIN_CHUNK", 100000)
    monkeypatch.setattr(prox, "MAX_CHUNK", 100000)
    one = gd.diff_shapes(plate, plate_with_corner_hole, n_samples=2000)

    assert np.array_equal(many._distances, one._distances)
    assert many.max_distance == one.max_distance


def test_the_report_carries_its_sample_count(plate: bd.Solid) -> None:
    """The abc_0365 evidence had to state the reduced sample count in prose because the JSON
    did not carry it. A 3000-sample diff must not read like a 20000-sample one."""
    report = diff_shapes(plate, plate, n_samples=750)
    assert report.to_dict()["n_samples"] == 750


@pytest.mark.slow
def test_a_dense_mesh_diffs_under_the_memory_ceiling(hollow_ball: bd.Solid) -> None:
    """F-004-2: two agents were SIGKILLed (exit 137) at ~3.8 GB per proximity query on a
    dense curved mesh at the default 20000 samples, with no diff and no error message."""
    import tracemalloc

    from cadtools.geometry_diff import DEFAULT_SAMPLES
    from cadtools.proximity import DISTANCE_CHUNK_BYTES

    tracemalloc.start()
    try:
        diff_shapes(hollow_ball, hollow_ball, n_samples=DEFAULT_SAMPLES)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 4 * DISTANCE_CHUNK_BYTES, f"peak {peak / 1e6:.0f} MB"


# --- run-003 F-005 (abc_0352): VOLUMETRIC intent, because extents cannot see it ----------


def test_the_two_pads_are_indistinguishable_by_bbox_extents(
    ell_prism_padded_by_profile: bd.Solid, ell_prism_padded_by_bbox: bd.Solid
) -> None:
    """The premise of the defect: an extent-only intent check CANNOT separate these two.

    Both pads reach the same X extent by the same amount, and their bounding boxes agree to
    the last digit. The wrong one carries the notch volume as well.
    """
    right = ell_prism_padded_by_profile.bounding_box()
    wrong = ell_prism_padded_by_bbox.bounding_box()
    for axis in ("X", "Y", "Z"):
        assert getattr(right.size, axis) == pytest.approx(getattr(wrong.size, axis), abs=1e-9)
    assert ell_prism_padded_by_bbox.volume > ell_prism_padded_by_profile.volume


def test_expected_volume_delta_passes_the_face_profile_pad(
    ell_prism: bd.Solid, ell_prism_padded_by_profile: bd.Solid
) -> None:
    report = diff_shapes(ell_prism, ell_prism_padded_by_profile, n_samples=4000)
    intent = check_volume_delta(report, ELL_FACE_AREA * ELL_PAD_DEPTH)
    assert intent.within_tolerance is True
    assert intent.relative_error < 0.01
    assert intent.expected_delta == pytest.approx(ELL_FACE_AREA * ELL_PAD_DEPTH)


def test_expected_volume_delta_fails_the_bounding_rectangle_pad(
    ell_prism: bd.Solid, ell_prism_padded_by_bbox: bd.Solid
) -> None:
    """The abc_0352 miss, caught: same extents, unrequested material."""
    report = diff_shapes(ell_prism, ell_prism_padded_by_bbox, n_samples=4000)
    intent = check_volume_delta(report, ELL_FACE_AREA * ELL_PAD_DEPTH)
    assert intent.within_tolerance is False
    unrequested = ELL_NOTCH_WIDTH * ELL_NOTCH_HEIGHT * ELL_PAD_DEPTH
    assert intent.measured_delta - intent.expected_delta == pytest.approx(unrequested, rel=1e-3)
    assert "expected" in intent.message


def test_expected_volume_delta_honours_an_explicit_tolerance(
    ell_prism: bd.Solid, ell_prism_padded_by_bbox: bd.Solid
) -> None:
    report = diff_shapes(ell_prism, ell_prism_padded_by_bbox, n_samples=4000)
    expected = ELL_FACE_AREA * ELL_PAD_DEPTH
    assert check_volume_delta(report, expected, tolerance=0.5).within_tolerance is True
    assert check_volume_delta(report, expected, tolerance=0.01).within_tolerance is False


def test_expected_zero_volume_delta_is_not_a_division_by_zero(plate: bd.Solid) -> None:
    intent = check_volume_delta(diff_shapes(plate, plate, n_samples=1000), 0.0)
    assert intent.within_tolerance is True
    assert intent.relative_error == pytest.approx(0.0)


def test_cross_section_recovers_the_target_face_for_the_profile_pad(
    ell_prism: bd.Solid, ell_prism_padded_by_profile: bd.Solid
) -> None:
    report = diff_shapes(ell_prism, ell_prism_padded_by_profile, n_samples=8000)
    section = cross_section(report, target_face_area=ELL_FACE_AREA)
    assert section is not None
    assert section.axis == "x", "the thinnest changed extent is the extrusion axis"
    assert section.depth == pytest.approx(ELL_PAD_DEPTH, rel=0.02)
    assert section.implied_area == pytest.approx(ELL_FACE_AREA, rel=0.02)
    assert section.preserved is True
    # the sampled footprint is an L, not its bounding rectangle
    assert section.fill_ratio < 0.95
    assert section.footprint_area == pytest.approx(ELL_FACE_AREA, rel=0.20)


def test_cross_section_flags_the_bounding_rectangle_sweep(
    ell_prism: bd.Solid, ell_prism_padded_by_bbox: bd.Solid
) -> None:
    report = diff_shapes(ell_prism, ell_prism_padded_by_bbox, n_samples=8000)
    section = cross_section(report, target_face_area=ELL_FACE_AREA)
    assert section is not None
    assert section.preserved is False
    assert section.implied_area == pytest.approx(ELL_BBOX_FACE_AREA, rel=0.02)
    assert section.area_ratio is not None and section.area_ratio > 1.3
    assert section.fill_ratio > 0.95, "the changed footprint fills its bounding rectangle"


def test_cross_section_axis_can_be_named_explicitly(
    ell_prism: bd.Solid, ell_prism_padded_by_profile: bd.Solid
) -> None:
    report = diff_shapes(ell_prism, ell_prism_padded_by_profile, n_samples=4000)
    section = cross_section(report, axis="z")
    assert section is not None
    assert section.axis == "z"
    assert section.axis_source == "explicit"


def test_cross_section_is_none_when_nothing_changed(plate: bd.Solid) -> None:
    assert cross_section(diff_shapes(plate, plate, n_samples=1000)) is None
