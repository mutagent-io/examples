"""T6 — benchmark-parity scoring.

# @implements local-scorer

Capability `local-scorer`: "Benchmark-parity scoring against a ground truth:
surface-distance F1, volume IoU, Betti-number (b0,b1,b2) topology match, gated by validity."

Every formula here is transcribed from the benchmark's own documentation:

* ``shape_similarity = 0.5 * (surface_distance_F1 + volume_IoU)``
* surface F1: a point matches when the closest point on **the other mesh's surface** lies
  within **0.5 % of the ground-truth bbox diagonal** *and* the normals agree within **20 deg**.
* volume IoU through the **manifold3d** Boolean kernel — the same kernel the grader uses,
  which is what makes the number comparable rather than merely similar.
* ``topology_match = s0 * s1 * s2`` (a PRODUCT, not a mean), with
  ``si = ((min(bi)+1) / (max(bi)+1)) ** alpha``, ``alpha = 2``.
* Betti numbers from the tessellated mesh: union-find components -> ray-cast containment for
  b0/b2 -> ``b1 = b0 + b2 - chi/2`` with ``chi = V - E + F``.
* EDITING composition: ``0.6 * s_renorm + 0.3 * interface + 0.1 * topo_match``, zero if
  invalid, where ``s_renorm = max(0, (shape - b_shape) / (1 - b_shape))`` and ``b_shape`` is
  the shape similarity of the UNEDITED input against the ground truth. A no-op therefore
  earns zero shape credit.

**What this is NOT (A3 / OQ-2).** The `interface_match` axis depends on keep-in / keep-out
sub-volumes authored in the benchmark's private ground-truth repository. We cannot compute
it, and imputing it would silently invent a third of the score. So it is emitted as
``interface: null`` with ``interface_available: false``, and the local number is
renormalized over the 0.7 of weight we CAN compute. It is called ``cad_score_proxy`` and is
never called ``cad_score``: it is not the leaderboard number and must never be reported as
one. The raw, un-renormalized weighted components travel alongside it so the difference is
always auditable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import build123d as bd
import numpy as np

from cadtools.geometry_diff import FrameAgreement, check_frame_agreement
from cadtools.mesh import (
    MeshData,
    edge_triangle_counts,
    euler_characteristic,
    mesh_bbox_diagonal,
    mesh_for_metrics,
    sample_surface_with_normals,
    to_trimesh,
)
from cadtools.proximity import closest_point_chunked
from cadtools.validity import check_validity

# --- benchmark constants ----------------------------------------------------------
F1_DISTANCE_RATIO = 0.005  # 0.5 % of the GT bbox diagonal
F1_NORMAL_TOLERANCE_DEG = 20.0
TOPO_ALPHA = 2
DEFAULT_SAMPLES = 20000

# Editing-task weights, verbatim from docs/metrics.md
WEIGHT_SHAPE = 0.6
WEIGHT_INTERFACE = 0.3
WEIGHT_TOPOLOGY = 0.1

# A3 / OQ-2: the interface axis is unavailable locally, so the proxy renormalizes over the
# weight we can actually compute. BOTH baseline arms must use this identical convention.
PROXY_WEIGHT_TOTAL = WEIGHT_SHAPE + WEIGHT_TOPOLOGY  # 0.7
PROXY_CONVENTION = "cad-score-proxy/v1:interface-null-renormalized-0.7"


@dataclass(frozen=True)
class EditingScorecard:
    """Mirrors the leaderboard's per-sample record — minus the axis we cannot compute."""

    valid: bool
    validity_failures: list[str]
    status: str
    surface_distance_f1: float
    volume_iou: float
    shape_similarity: float
    baseline_shape_similarity: float
    shape_similarity_renormalized: float
    topology_match: float
    betti_ground_truth: tuple[int, int, int]
    betti_candidate: tuple[int, int, int]
    betti_input: tuple[int, int, int]
    cad_score_proxy: float
    frame_agreement: FrameAgreement
    # Sampling provenance (R8): a 2000-sample scorecard must not read like a 20000-sample one.
    n_samples: int = DEFAULT_SAMPLES

    def to_dict(self) -> dict[str, Any]:
        return {
            "convention": PROXY_CONVENTION,
            "valid": self.valid,
            "status": self.status,
            "validity_failures": list(self.validity_failures),
            "surface_distance_f1": self.surface_distance_f1,
            "volume_iou": self.volume_iou,
            "shape_similarity": self.shape_similarity,
            "baseline_shape_similarity": self.baseline_shape_similarity,
            "shape_similarity_renormalized": self.shape_similarity_renormalized,
            "topology_match": self.topology_match,
            # The unavailable axis: null, never imputed (A3 / OQ-2).
            "interface": None,
            "interface_available": False,
            "betti_ground_truth": list(self.betti_ground_truth),
            "betti_candidate": list(self.betti_candidate),
            "betti_input": list(self.betti_input),
            "cad_score_proxy": self.cad_score_proxy,
            "proxy_weight_total": PROXY_WEIGHT_TOTAL,
            "weights": {
                "shape": WEIGHT_SHAPE,
                "interface": WEIGHT_INTERFACE,
                "topology": WEIGHT_TOPOLOGY,
            },
            # Raw, UN-renormalized weighted contributions, so the proxy's gap to the real
            # composite is always visible rather than buried in the renormalization.
            "raw_components": {
                "shape_renormalized": WEIGHT_SHAPE * self.shape_similarity_renormalized,
                "interface": None,
                "topology_match": WEIGHT_TOPOLOGY * self.topology_match,
            },
            "frame_agreement": self.frame_agreement.to_dict(),
            "n_samples": self.n_samples,
        }


# --- Betti pipeline ---------------------------------------------------------------


def connected_components(mesh: MeshData) -> list[np.ndarray]:
    """Split the mesh into edge-connected triangle groups by union-find."""
    n = mesh.n_faces
    if n == 0:
        return []
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    edge_owner: dict[tuple[int, int], int] = {}
    for face_index, tri in enumerate(mesh.faces):
        a, b, c = int(tri[0]), int(tri[1]), int(tri[2])
        for u, v in ((a, b), (b, c), (c, a)):
            key = (u, v) if u < v else (v, u)
            other = edge_owner.get(key)
            if other is None:
                edge_owner[key] = face_index
            else:
                union(other, face_index)

    groups: dict[int, list[int]] = {}
    for face_index in range(n):
        groups.setdefault(find(face_index), []).append(face_index)
    return [np.asarray(v, dtype=np.int64) for v in groups.values()]


def _submesh(mesh: MeshData, face_indices: np.ndarray) -> MeshData:
    faces = mesh.faces[face_indices]
    used = np.unique(faces)
    remap = {int(old): i for i, old in enumerate(used)}
    new_faces = np.vectorize(remap.__getitem__)(faces).reshape(-1, 3)
    return MeshData(vertices=mesh.vertices[used], faces=new_faces.astype(np.int64))


def _is_inside(point: np.ndarray, shell: MeshData) -> bool:
    """Ray-cast containment: odd crossing count in a majority of directions means inside.

    Several directions are voted on because a single ray can graze a tangent face or hit an
    edge exactly, which is the classic failure mode of ray-cast containment (Risk R4).
    """
    import trimesh

    intersector = trimesh.ray.ray_triangle.RayMeshIntersector(to_trimesh(shell))
    directions = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.577, 0.577, 0.577],
            [-0.577, 0.577, -0.577],
        ]
    )
    votes = 0
    for direction in directions:
        locations, _, _ = intersector.intersects_location(
            ray_origins=point.reshape(1, 3), ray_directions=direction.reshape(1, 3)
        )
        if len(locations) % 2 == 1:
            votes += 1
    return votes * 2 > len(directions)


def betti_numbers(mesh: MeshData) -> tuple[int, int, int]:
    """(b0, b1, b2) of the tessellated body, per the benchmark's documented pipeline."""
    components = connected_components(mesh)
    if not components:
        return (0, 0, 0)

    shells = [_submesh(mesh, indices) for indices in components]

    # A shell enclosed by another shell bounds a VOID (contributes to b2) rather than a
    # separate connected component of the solid (b0).
    enclosed = [False] * len(shells)
    if len(shells) > 1:
        for i, shell in enumerate(shells):
            # The probe must lie ON this shell, not at its centroid: the centroid of the
            # OUTER shell of a hollow body sits inside the INNER shell, which would report
            # both shells as enclosed and collapse b0 to zero.
            probe = shell.triangles()[0].mean(axis=0)
            for j, other in enumerate(shells):
                if i == j:
                    continue
                if _is_inside(probe, other):
                    enclosed[i] = True
                    break

    b0 = sum(1 for flag in enclosed if not flag)
    b2 = sum(1 for flag in enclosed if flag)
    chi = euler_characteristic(mesh)
    b1 = b0 + b2 - chi // 2 if chi % 2 == 0 else b0 + b2 - int(round(chi / 2))
    return (b0, max(b1, 0), b2)


def topology_match(
    betti_a: tuple[int, int, int], betti_b: tuple[int, int, int], alpha: int = TOPO_ALPHA
) -> float:
    """s0 * s1 * s2 with si = ((min+1)/(max+1))**alpha. Symmetric, and a PRODUCT."""
    score = 1.0
    for a, b in zip(betti_a, betti_b, strict=True):
        lo, hi = (a, b) if a <= b else (b, a)
        score *= ((lo + 1) / (hi + 1)) ** alpha
    return float(score)


# --- shape similarity -------------------------------------------------------------


def surface_distance_f1(
    ground_truth: MeshData,
    candidate: MeshData,
    n_samples: int = DEFAULT_SAMPLES,
    distance_ratio: float = F1_DISTANCE_RATIO,
    normal_tolerance_deg: float = F1_NORMAL_TOLERANCE_DEG,
) -> float:
    """Symmetric F1 over surface samples, matched by distance AND normal agreement."""
    if ground_truth.n_faces == 0 or candidate.n_faces == 0:
        return 0.0
    radius = distance_ratio * (mesh_bbox_diagonal(ground_truth) or 1.0)
    cos_limit = float(np.cos(np.deg2rad(normal_tolerance_deg)))

    recall = _match_fraction(ground_truth, candidate, radius, cos_limit, n_samples, seed=0)
    precision = _match_fraction(candidate, ground_truth, radius, cos_limit, n_samples, seed=1)
    if precision + recall == 0:
        return 0.0
    return float(2 * precision * recall / (precision + recall))


def _match_fraction(
    source: MeshData,
    target: MeshData,
    radius: float,
    cos_limit: float,
    n_samples: int,
    seed: int,
) -> float:
    """Fraction of `source` samples matched on `target` by distance AND normal agreement.

    The proximity query runs through :func:`cadtools.proximity.closest_point_chunked`, so peak
    memory is bounded by the shared byte budget rather than by ``n_samples`` (R8). The
    unchunked call this replaced allocated the entire (sample x candidate-triangle) cross
    product at once and was SIGKILLed four times in rescore-002 on dense meshes; the values
    are identical, only the allocation schedule differs.
    """
    points, normals = sample_surface_with_normals(source, n_samples, seed=seed)
    if points.size == 0:
        return 0.0
    tm = to_trimesh(target)
    distances, triangle_ids = closest_point_chunked(tm, points)
    target_normals = target.face_normals()[triangle_ids]
    # Unsigned agreement: a coincident surface may be wound either way after a boolean.
    alignment = np.abs(np.einsum("ij,ij->i", normals, target_normals))
    matched = (distances <= radius) & (alignment >= cos_limit)
    return float(matched.mean())


def volume_iou(ground_truth: MeshData, candidate: MeshData) -> float:
    """Volume IoU through the manifold3d Boolean kernel — the grader's own kernel."""
    import manifold3d as m3

    a = _to_manifold(ground_truth)
    b = _to_manifold(candidate)
    if a is None or b is None:
        return 0.0
    del m3
    union = (a + b).volume()
    if union <= 0:
        return 0.0
    return float((a ^ b).volume() / union)


def _to_manifold(mesh: MeshData):  # type: ignore[no-untyped-def]
    import manifold3d as m3

    if mesh.n_faces == 0:
        return None
    manifold = m3.Manifold(m3.Mesh(mesh.vertices.astype(np.float32), mesh.faces.astype(np.uint32)))
    return None if manifold.is_empty() else manifold


def shape_similarity(
    ground_truth: MeshData, candidate: MeshData, n_samples: int = DEFAULT_SAMPLES
) -> float:
    """0.5 * (surface F1 + volume IoU)."""
    return 0.5 * (
        surface_distance_f1(ground_truth, candidate, n_samples=n_samples)
        + volume_iou(ground_truth, candidate)
    )


def renormalize_editing_shape(similarity: float, baseline: float) -> float:
    """s_renorm = max(0, (shape - b_shape) / (1 - b_shape)); a no-op edit lands on zero."""
    denominator = 1.0 - baseline
    if denominator <= 1e-12:
        return 0.0
    return float(max(0.0, (similarity - baseline) / denominator))


# --- the scorecard ----------------------------------------------------------------


def score_editing_sample(
    input_shape: bd.Shape | MeshData,
    candidate_shape: bd.Shape | MeshData,
    ground_truth_shape: bd.Shape | MeshData,
    require_frame_agreement: bool = True,
    n_samples: int = DEFAULT_SAMPLES,
) -> EditingScorecard:
    """Score one editing sample against its ground truth. Validity gates everything."""
    from cadtools.geometry_diff import FrameDisagreementError

    input_mesh = _as_mesh(input_shape)
    candidate_mesh = _as_mesh(candidate_shape)
    gt_mesh = _as_mesh(ground_truth_shape)

    frame = check_frame_agreement(gt_mesh, candidate_mesh)
    if require_frame_agreement and not frame.agree:
        raise FrameDisagreementError(
            f"{frame.message}. The editing ground truth is expressed in the input's own "
            "coordinate frame and is scored without ICP, so a re-posed candidate cannot be "
            "scored — it must be re-exported in the input frame."
        )
    # R5: a candidate the same size test would once have zeroed under the "frame" label is
    # reported as what it actually is — a SHAPE disagreement — and is still scored. The
    # scorecard says which, so a reader never has to reconstruct the cause from the deltas.

    validity = (
        check_validity(candidate_shape, candidate_mesh)
        if isinstance(candidate_shape, bd.Shape)
        else None
    )
    valid = validity.is_valid if validity is not None else True
    failures = list(validity.failures) if validity is not None else []

    f1 = surface_distance_f1(gt_mesh, candidate_mesh, n_samples=n_samples)
    iou = volume_iou(gt_mesh, candidate_mesh)
    similarity = 0.5 * (f1 + iou)
    baseline = shape_similarity(gt_mesh, input_mesh, n_samples=n_samples)
    s_renorm = renormalize_editing_shape(similarity, baseline)

    betti_gt = betti_numbers(gt_mesh)
    betti_cand = betti_numbers(candidate_mesh)
    betti_input = betti_numbers(input_mesh)
    topo = topology_match(betti_gt, betti_cand)

    # R5: a candidate that once would have been zeroed under the "frame" label is reported as
    # what it actually is — a SHAPE disagreement — and is still scored. The scorecard names the
    # state, so a reader never has to reconstruct the cause from the raw deltas.
    status = "invalid" if not valid else ("shape-divergence" if frame.shape_divergence else "ok")
    proxy = 0.0
    if valid:
        proxy = (WEIGHT_SHAPE * s_renorm + WEIGHT_TOPOLOGY * topo) / PROXY_WEIGHT_TOTAL

    return EditingScorecard(
        valid=valid,
        status=status,
        validity_failures=failures,
        surface_distance_f1=f1,
        volume_iou=iou,
        shape_similarity=similarity,
        baseline_shape_similarity=baseline,
        shape_similarity_renormalized=s_renorm,
        topology_match=topo,
        betti_ground_truth=betti_gt,
        betti_candidate=betti_cand,
        betti_input=betti_input,
        cad_score_proxy=float(proxy),
        frame_agreement=frame,
        n_samples=n_samples,
    )


def score_editing_files(
    input_path: str,
    candidate_path: str,
    ground_truth_path: str,
    n_samples: int = DEFAULT_SAMPLES,
) -> EditingScorecard:
    from cadtools.step_io import import_step_file

    return score_editing_sample(
        import_step_file(input_path),
        import_step_file(candidate_path),
        import_step_file(ground_truth_path),
        n_samples=n_samples,
    )


def _as_mesh(shape: bd.Shape | MeshData) -> MeshData:
    """Mesh through the ladder — the metric must score the body the gate accepted."""
    return shape if isinstance(shape, MeshData) else mesh_for_metrics(shape)


__all__ = [
    "DEFAULT_SAMPLES",
    "EditingScorecard",
    "PROXY_CONVENTION",
    "PROXY_WEIGHT_TOTAL",
    "betti_numbers",
    "connected_components",
    "edge_triangle_counts",
    "renormalize_editing_shape",
    "score_editing_files",
    "score_editing_sample",
    "shape_similarity",
    "surface_distance_f1",
    "topology_match",
    "volume_iou",
]
