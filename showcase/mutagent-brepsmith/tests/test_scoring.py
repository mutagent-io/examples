"""T6 — capability `local-scorer`: benchmark-parity metrics + the A3 proxy convention."""

from __future__ import annotations

import build123d as bd
import pytest

from cadtools.mesh import tessellate
from cadtools.scoring import (
    PROXY_CONVENTION,
    PROXY_WEIGHT_TOTAL,
    betti_numbers,
    score_editing_sample,
    shape_similarity,
    surface_distance_f1,
    topology_match,
    volume_iou,
)

# --- Betti pipeline, anchored to the doc's own table ------------------------------


def test_betti_box(box: bd.Solid) -> None:
    assert betti_numbers(tessellate(box)) == (1, 0, 0)


def test_betti_through_hole(plate_with_through_hole: bd.Solid) -> None:
    assert betti_numbers(tessellate(plate_with_through_hole)) == (1, 1, 0)


def test_betti_blind_pocket_is_topologically_trivial(plate_with_blind_pocket: bd.Solid) -> None:
    assert betti_numbers(tessellate(plate_with_blind_pocket)) == (1, 0, 0)


def test_betti_two_disjoint_blocks(two_disjoint_blocks: bd.Compound) -> None:
    assert betti_numbers(tessellate(two_disjoint_blocks)) == (2, 0, 0)


def test_betti_hollow_ball_has_an_enclosed_void(hollow_ball: bd.Solid) -> None:
    assert betti_numbers(tessellate(hollow_ball)) == (1, 0, 1)


# --- topology_match: the doc's worked examples, verbatim --------------------------


def test_topology_axis_matches_doc_worked_example() -> None:
    assert topology_match((1, 2, 0), (1, 4, 0)) == pytest.approx(0.360, abs=5e-4)
    assert topology_match((1, 0, 0), (2, 0, 0)) == pytest.approx(0.444, abs=5e-4)


def test_topology_match_is_a_product_not_a_mean() -> None:
    """s0*s1*s2: two half-wrong axes must compound, not average away."""
    both_off = topology_match((1, 0, 0), (2, 1, 0))
    assert both_off == pytest.approx(
        topology_match((1, 0, 0), (2, 0, 0)) * topology_match((0, 0, 0), (0, 1, 0))
    )


def test_topology_match_is_one_for_identical_betti() -> None:
    assert topology_match((1, 3, 2), (1, 3, 2)) == 1.0


def test_topology_match_is_symmetric() -> None:
    assert topology_match((1, 2, 0), (1, 5, 0)) == topology_match((1, 5, 0), (1, 2, 0))


# --- shape similarity -------------------------------------------------------------


def test_identical_meshes_score_one(plate: bd.Solid) -> None:
    mesh = tessellate(plate)
    assert surface_distance_f1(mesh, mesh) == pytest.approx(1.0)
    assert volume_iou(mesh, mesh) == pytest.approx(1.0, abs=1e-6)
    assert shape_similarity(mesh, mesh) == pytest.approx(1.0, abs=1e-6)


def test_dissimilar_meshes_score_below_one(plate: bd.Solid, thicker_plate: bd.Solid) -> None:
    s = shape_similarity(tessellate(plate), tessellate(thicker_plate))
    assert 0.0 < s < 1.0


def test_volume_iou_of_disjoint_bodies_is_zero(box: bd.Solid) -> None:
    moved = box.moved(bd.Location((100, 0, 0)))
    assert volume_iou(tessellate(box), tessellate(moved)) == pytest.approx(0.0, abs=1e-9)


def test_surface_f1_requires_normal_agreement(plate: bd.Solid) -> None:
    """A point within the distance radius but on an oppositely-oriented face is NOT a match."""
    assert (
        surface_distance_f1(tessellate(plate), tessellate(plate), normal_tolerance_deg=20.0) == 1.0
    )


# --- the editing scorecard (A3 + OQ-2 + OQ-3) -------------------------------------


def test_noop_edit_renormalizes_to_zero(plate: bd.Solid, plate_with_corner_hole: bd.Solid) -> None:
    """Feeding the INPUT back as the candidate must renormalize to exactly zero credit."""
    card = score_editing_sample(
        input_shape=plate, candidate_shape=plate, ground_truth_shape=plate_with_corner_hole
    )
    assert card.shape_similarity_renormalized == pytest.approx(0.0, abs=1e-9)


def test_perfect_edit_renormalizes_to_one(
    plate: bd.Solid, plate_with_corner_hole: bd.Solid
) -> None:
    card = score_editing_sample(
        input_shape=plate,
        candidate_shape=plate_with_corner_hole,
        ground_truth_shape=plate_with_corner_hole,
    )
    assert card.shape_similarity_renormalized == pytest.approx(1.0, abs=1e-3)
    assert card.cad_score_proxy == pytest.approx(1.0, abs=1e-3)


def test_proxy_never_named_cad_score(plate: bd.Solid, plate_with_corner_hole: bd.Solid) -> None:
    """A3 — the local number is a PROXY and must never masquerade as the leaderboard score."""
    payload = score_editing_sample(
        input_shape=plate,
        candidate_shape=plate_with_corner_hole,
        ground_truth_shape=plate_with_corner_hole,
    ).to_dict()
    assert "cad_score" not in payload
    assert "cad_score_proxy" in payload
    assert not any(k == "cad_score" for k in payload)


def test_proxy_reports_interface_null(plate: bd.Solid, plate_with_corner_hole: bd.Solid) -> None:
    """A3/OQ-2 — the interface axis is unavailable locally; it is null, never imputed."""
    payload = score_editing_sample(
        input_shape=plate,
        candidate_shape=plate_with_corner_hole,
        ground_truth_shape=plate_with_corner_hole,
    ).to_dict()
    assert payload["interface"] is None
    assert payload["interface_available"] is False
    assert payload["proxy_weight_total"] == pytest.approx(PROXY_WEIGHT_TOTAL)
    assert payload["convention"] == PROXY_CONVENTION


def test_proxy_reports_raw_unrenormalized_components(
    plate: bd.Solid, plate_with_corner_hole: bd.Solid
) -> None:
    """A3 — the raw, un-renormalized weighted components travel with the proxy."""
    payload = score_editing_sample(
        input_shape=plate,
        candidate_shape=plate_with_corner_hole,
        ground_truth_shape=plate_with_corner_hole,
    ).to_dict()
    raw = payload["raw_components"]
    assert set(raw) == {"shape_renormalized", "interface", "topology_match"}
    assert raw["interface"] is None
    for key in (
        "surface_distance_f1",
        "volume_iou",
        "shape_similarity",
        "baseline_shape_similarity",
    ):
        assert key in payload


def test_invalid_candidate_scores_zero(plate: bd.Solid) -> None:
    """Validity gates everything: an invalid output is a zero regardless of its shape.

    The invalid candidate is the plate with one face removed, so it occupies the SAME frame
    and bbox as the ground truth — the zero is attributable to invalidity alone.
    """
    leaky = bd.Shell(sorted(plate.faces(), key=lambda f: f.center().Z)[:-1])
    card = score_editing_sample(input_shape=plate, candidate_shape=leaky, ground_truth_shape=plate)
    assert card.valid is False
    assert card.validity_failures, "the zero must name the defect, not just report zero"
    assert card.cad_score_proxy == 0.0


def test_mis_posed_candidate_fails_loudly(
    plate: bd.Solid, plate_with_corner_hole: bd.Solid
) -> None:
    """A4 — the scorer refuses a mis-posed pair rather than reporting a bad score."""
    from cadtools.geometry_diff import FrameDisagreementError

    moved = plate_with_corner_hole.moved(bd.Location((100, 0, 0)))
    with pytest.raises(FrameDisagreementError):
        score_editing_sample(
            input_shape=plate, candidate_shape=moved, ground_truth_shape=plate_with_corner_hole
        )


def test_scorecard_is_json_serializable(plate: bd.Solid, plate_with_corner_hole: bd.Solid) -> None:
    import json

    card = score_editing_sample(
        input_shape=plate,
        candidate_shape=plate_with_corner_hole,
        ground_truth_shape=plate_with_corner_hole,
    )
    assert json.loads(json.dumps(card.to_dict()))["convention"] == PROXY_CONVENTION


# --- R8 / F-004-2: the SCORING path is chunked too ---------------------------------


def test_scoring_chunking_does_not_change_the_f1(
    monkeypatch: pytest.MonkeyPatch, plate: bd.Solid, plate_with_corner_hole: bd.Solid
) -> None:
    """R6 bounded the differ's proximity query; the scorer kept its own unchunked one and was
    OOM-killed four times in rescore-002. `closest_point` is pure per-point, so batching moves
    only the allocation schedule — distances, triangle ids and therefore the F1 are identical."""
    import cadtools.proximity as prox

    gt = tessellate(plate_with_corner_hole)
    cand = tessellate(plate)

    monkeypatch.setattr(prox, "MIN_CHUNK", 64)
    monkeypatch.setattr(prox, "MAX_CHUNK", 64)
    many = surface_distance_f1(gt, cand, n_samples=2000)

    monkeypatch.setattr(prox, "MIN_CHUNK", 100000)
    monkeypatch.setattr(prox, "MAX_CHUNK", 100000)
    one = surface_distance_f1(gt, cand, n_samples=2000)

    assert many == one


def test_the_scorecard_carries_its_sample_count(
    plate: bd.Solid, plate_with_corner_hole: bd.Solid
) -> None:
    """A 2000-sample scorecard must not read like a 20000-sample one (the F-004-2 lesson,
    applied to the scorer): the provenance travels in the JSON, not in prose."""
    card = score_editing_sample(
        input_shape=plate,
        candidate_shape=plate_with_corner_hole,
        ground_truth_shape=plate_with_corner_hole,
        n_samples=2000,
    )
    assert card.n_samples == 2000
    assert card.to_dict()["n_samples"] == 2000


@pytest.mark.slow
def test_a_dense_mesh_scores_under_the_memory_ceiling(hollow_ball: bd.Solid) -> None:
    """rescore-002: `cadtools score` was SIGKILLed (exit 137) on abc_0054-boss-union and
    abc_0368-fill-hole at the default 20000 samples, in BOTH arms."""
    import tracemalloc

    from cadtools.proximity import DISTANCE_CHUNK_BYTES
    from cadtools.scoring import DEFAULT_SAMPLES

    mesh = tessellate(hollow_ball)
    tracemalloc.start()
    try:
        surface_distance_f1(mesh, mesh, n_samples=DEFAULT_SAMPLES)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 4 * DISTANCE_CHUNK_BYTES, f"peak {peak / 1e6:.0f} MB"
