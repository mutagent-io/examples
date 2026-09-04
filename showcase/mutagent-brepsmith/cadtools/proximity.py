"""The ONE memory-bounded proximity query, shared by the differ and the scorer.

# @implements geometry-differ
# @implements local-scorer

WHY THIS MODULE EXISTS. ``trimesh.proximity.closest_point`` materialises the whole
(point x candidate-triangle) cross product in a SINGLE allocation (~200 bytes per pair), so
on a dense curved mesh at the default 20000 samples the working set reaches multiple GB and
the process is SIGKILLed with no result and no error message — exit 137, an empty stdout, and
a run that looks like a hang (F-004-2).

R6 bounded that allocation inside :mod:`cadtools.geometry_diff` only. The scorer kept its own
unchunked ``closest_point`` call, and rescore-002 was killed four times by it
(``abc_0054-boss-union`` and ``abc_0368-fill-hole``, in BOTH arms). Two copies of a memory
rule is one copy too many: the budgeted batching lives HERE, once, and both callers use it.

The query is pure per-point — there is no cross-point reduction of any kind — so batching
changes only the allocation schedule. Distances and triangle ids come out bit-identical to
the single-shot call, in the same order, which is what
``test_chunking_does_not_change_the_distances`` (differ) and
``test_scoring_chunking_does_not_change_the_f1`` (scorer) pin.

The batch size is MEASURED rather than guessed: the first slice runs at :data:`MIN_CHUNK` and
reports its own candidates-per-point via ``nearby_faces``, which sets the size of every slice
after it. The ``trimesh`` object — and therefore its AABB tree — is built ONCE per target.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from cadtools.mesh import MeshData, to_trimesh

# Peak working-set ceiling for ONE proximity batch.
DISTANCE_CHUNK_BYTES = 256 * 1024 * 1024
MIN_CHUNK = 256
MAX_CHUNK = 4096
BYTES_PER_CANDIDATE_PAIR = 200.0


def chunk_size_for(tm: Any, probe: np.ndarray) -> int:
    """Batch size that keeps one proximity query inside the byte budget, measured on a probe."""
    import trimesh

    try:
        candidates = trimesh.proximity.nearby_faces(tm, probe)
        per_point = max(1.0, sum(len(c) for c in candidates) / max(1, len(probe)))
    except Exception:  # noqa: BLE001 - a probe failure must not fail the query
        per_point = 1.0
    budget = DISTANCE_CHUNK_BYTES / (BYTES_PER_CANDIDATE_PAIR * per_point)
    return int(np.clip(budget, MIN_CHUNK, MAX_CHUNK))


def closest_point_chunked(tm: Any, points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """``(distances, triangle_ids)`` for each point, computed within the byte budget.

    Same values, same order, same dtype semantics as
    ``trimesh.proximity.closest_point(tm, points)[1:]`` — only the peak allocation differs.
    The triangle ids are returned because the scorer's F1 needs the matched face's NORMAL,
    not merely the distance; the differ ignores them.
    """
    if len(points) == 0:
        return np.zeros(0), np.zeros(0, dtype=np.int64)
    import trimesh

    chunk = MIN_CHUNK
    distances: list[np.ndarray] = []
    triangle_ids: list[np.ndarray] = []
    index = 0
    while index < len(points):
        batch = points[index : index + chunk]
        _, batch_distances, batch_ids = trimesh.proximity.closest_point(tm, batch)
        distances.append(np.asarray(batch_distances, dtype=np.float64))
        triangle_ids.append(np.asarray(batch_ids, dtype=np.int64))
        if index == 0:
            chunk = chunk_size_for(tm, batch)
        index += len(batch)
    return np.concatenate(distances), np.concatenate(triangle_ids)


def surface_distances(points: np.ndarray, target: MeshData) -> np.ndarray:
    """Distance from each point to the closest point on the target mesh's SURFACE.

    Surface distance, not nearest-sampled-point distance: matching point clouds against each
    other systematically overestimates agreement on coarsely tessellated faces.
    """
    if points.size == 0 or target.n_faces == 0:
        return np.zeros(len(points))
    return closest_point_chunked(to_trimesh(target), points)[0]


__all__ = [
    "BYTES_PER_CANDIDATE_PAIR",
    "DISTANCE_CHUNK_BYTES",
    "MAX_CHUNK",
    "MIN_CHUNK",
    "chunk_size_for",
    "closest_point_chunked",
    "surface_distances",
]
