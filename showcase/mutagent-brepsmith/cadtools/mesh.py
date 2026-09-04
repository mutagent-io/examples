"""T2 — the single tessellation rule shared by validity, diff and scoring.

Rationale: the benchmark's validity gate, its shape-similarity metric and its Betti
pipeline all run over *the tessellated mesh*. If each of our modules meshed with its own
deflection, validity and scoring could disagree about the same body. So exactly one
deflection rule and one welded mesh representation live here, and every other module
imports them.

Deflection mirrors the benchmark's ``deflection_for_bbox(bbox.diagonal)``: linear
deflection is a fixed fraction of the bounding-box diagonal, clamped so that tiny and
huge parts both mesh sanely.
"""

from __future__ import annotations

import warnings
from collections import defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.TopAbs import TopAbs_Orientation
from OCP.TopLoc import TopLoc_Location

if TYPE_CHECKING:  # pragma: no cover - typing only
    import build123d as bd

# Fraction of the bbox diagonal used as the OCCT linear deflection.
DEFLECTION_RATIO = 0.001
MIN_DEFLECTION = 1e-4
MAX_DEFLECTION = 1.0
ANGULAR_TOLERANCE = 0.1
# Vertex welding precision, in units of the deflection.
WELD_RATIO = 0.1

# BRepMesh does not always triangulate every face. When it gives up on one,
# ``BRep_Tool.Triangulation_s`` returns a NULL handle, and build123d's own
# ``Shape.tessellate`` dereferences it unguarded -- ``AttributeError: 'NoneType' object has
# no attribute 'NbNodes'``. That is why tessellation is reimplemented here rather than
# delegated to build123d.
#
# The recovery relaxes the ANGULAR tolerance only, never the linear deflection. This is not
# arbitrary: the deflection is what bounds surface deviation (and therefore benchmark
# parity), while the angular tolerance only controls fan density around curvature. On the
# observed failures the deflection is irrelevant -- the same faces stay null from 0.02 to
# 0.97 -- and the angular tolerance is the whole story.
#
# The ladder stops at the FIRST rung that triangulates every face, so relaxation stays
# minimal, and it is capped deliberately. Measured on CadGenBench sample 242, whose two
# unmeshable faces are TORUS patches of minor radius 0.5 (the sample ships the benchmark's
# own reference mesh: chi = -20, betti = (1, 11, 0)):
#
#     angle   null faces   betti        verdict
#     0.1     2            --           crash (the bug)
#     0.2     0            (1, 11, 0)   correct
#     0.3     0            (1, 11, 0)   correct
#     0.5     0            (1,  8, 0)   WRONG -- curvature detail lost
#     1.0     0            (1,  0, 0)   WRONG -- the part collapses to a ball
#
# So a coarser mesh is not "more robust"; past ~0.3 rad it is silently wrong, which is the
# one outcome worse than crashing. Faces still null at the last rung are dropped AND
# reported -- see :class:`TessellationReport` and :class:`IncompleteTessellationWarning`.
ANGULAR_TOLERANCE_LADDER = (ANGULAR_TOLERANCE, 0.2, 0.3)


class IncompleteTessellationWarning(UserWarning):
    """Warned when faces remain untriangulated after the whole relaxation ladder.

    The resulting mesh has holes where those faces should be, so every topological
    quantity derived from it (closedness, Euler characteristic, Betti numbers) is
    suspect. Callers must treat such a mesh as unusable rather than merely imperfect.
    """


@dataclass(frozen=True)
class MeshData:
    """A welded triangle mesh: unique vertices + integer triangle indices."""

    vertices: np.ndarray  # (V, 3) float64
    faces: np.ndarray  # (F, 3) int64

    @property
    def n_vertices(self) -> int:
        return int(self.vertices.shape[0])

    @property
    def n_faces(self) -> int:
        return int(self.faces.shape[0])

    def triangles(self) -> np.ndarray:
        """(F, 3, 3) array of triangle corner coordinates."""
        return self.vertices[self.faces]

    def face_normals(self) -> np.ndarray:
        tris = self.triangles()
        n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        lengths = np.linalg.norm(n, axis=1, keepdims=True)
        lengths[lengths == 0] = 1.0
        return n / lengths

    def face_areas(self) -> np.ndarray:
        tris = self.triangles()
        return 0.5 * np.linalg.norm(
            np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]), axis=1
        )


@dataclass(frozen=True)
class TessellationReport:
    """What it took to mesh a shape — and, crucially, whether the result is COMPLETE.

    ``skipped_faces`` holds the indices (into ``shape.faces()``) that BRepMesh never
    triangulated. A non-empty tuple means the mesh has holes that are an artefact of
    meshing rather than a property of the body, so it must not be scored.
    """

    deflection: float
    angular_tolerance: float
    relaxed: bool
    skipped_faces: tuple[int, ...]
    n_faces: int

    @property
    def complete(self) -> bool:
        """True when every face of the shape contributed triangles."""
        return not self.skipped_faces


def bbox_diagonal(shape: bd.Shape) -> float:
    """Length of the axis-aligned bounding-box diagonal, in model units."""
    bbox = shape.bounding_box()
    size = bbox.size
    return float(np.sqrt(size.X**2 + size.Y**2 + size.Z**2))


def deflection_for_bbox(diagonal: float) -> float:
    """The one deflection rule. Deterministic and pure."""
    return float(min(MAX_DEFLECTION, max(MIN_DEFLECTION, DEFLECTION_RATIO * diagonal)))


def _mesh_shape(shape: bd.Shape, deflection: float, angular_tolerance: float, force: bool) -> None:
    """Run BRepMesh over the whole shape.

    ``force`` drops any existing triangulation first. That is required to move UP the
    ladder: BRepMesh is *incremental* and remembers that it already failed on a face, so
    re-running it in place leaves the face null no matter how the tolerance moves. Only a
    clean re-mesh retries — and re-meshing the whole shape (rather than the offending face
    alone) is what keeps neighbouring faces sharing one edge discretization. Re-meshing the
    lone face instead re-discretizes its shared edges and cracks the mesh open along them
    (measured on sample 242: 335 naked edges versus 0).

    The non-forced path mirrors build123d's ``Shape.mesh`` exactly — same relative flag,
    same parallel flag, same "skip if an adequate triangulation already exists" guard — so
    a shape that never needs relaxation is meshed precisely as it was before this fix.
    """
    if shape.wrapped is None:
        raise ValueError("Cannot tessellate an empty shape")
    if force:
        BRepTools.Clean_s(shape.wrapped)
    elif BRepTools.Triangulation_s(shape.wrapped, deflection):
        return
    BRepMesh_IncrementalMesh(shape.wrapped, deflection, True, angular_tolerance, True)


def _face_triangulation(face: bd.Face) -> Any | None:
    """The face's triangulation plus its placement, or ``None`` when BRepMesh made none.

    This is the exact call whose null return build123d dereferences unguarded.
    """
    location = TopLoc_Location()
    triangulation = BRep_Tool.Triangulation_s(face.wrapped, location)
    if triangulation is None:
        return None
    return triangulation, location


def _collect_faces(
    shape: bd.Shape,
) -> tuple[list[list[float]], list[tuple[int, int, int]], list[int]]:
    """Read back per-face triangles, recording which faces yielded nothing."""
    vertices: list[list[float]] = []
    triangles: list[tuple[int, int, int]] = []
    skipped: list[int] = []
    offset = 0

    for index, face in enumerate(shape.faces()):
        result = _face_triangulation(face)
        if result is None:
            skipped.append(index)
            continue
        triangulation, location = result
        transform = location.Transformation()
        reverse = face.wrapped.Orientation() == TopAbs_Orientation.TopAbs_REVERSED

        for node in range(1, triangulation.NbNodes() + 1):
            point = triangulation.Node(node).Transformed(transform)
            vertices.append([point.X(), point.Y(), point.Z()])

        for triangle in triangulation.Triangles():
            a, b, c = triangle.Value(1), triangle.Value(2), triangle.Value(3)
            if reverse:
                triangles.append((a + offset - 1, c + offset - 1, b + offset - 1))
            else:
                triangles.append((a + offset - 1, b + offset - 1, c + offset - 1))

        offset += triangulation.NbNodes()

    return vertices, triangles, skipped


def tessellate_with_report(
    shape: bd.Shape, deflection: float | None = None
) -> tuple[MeshData, TessellationReport]:
    """Tessellate a shape, relaxing the angular tolerance only as far as it must.

    Returns the welded mesh alongside a :class:`TessellationReport` recording which
    angular tolerance produced it and whether any face was ultimately dropped. Use this
    rather than :func:`tessellate` wherever an incomplete mesh has to be *handled* rather
    than merely warned about.
    """
    if deflection is None:
        deflection = deflection_for_bbox(bbox_diagonal(shape))

    vertices: list[list[float]] = []
    triangles: list[tuple[int, int, int]] = []
    skipped: list[int] = []
    angular_tolerance = ANGULAR_TOLERANCE_LADDER[0]

    for rung, angular_tolerance in enumerate(ANGULAR_TOLERANCE_LADDER):
        _mesh_shape(shape, deflection, angular_tolerance, force=rung > 0)
        vertices, triangles, skipped = _collect_faces(shape)
        if not skipped:
            break

    n_faces = len(shape.faces())
    report = TessellationReport(
        deflection=float(deflection),
        angular_tolerance=float(angular_tolerance),
        relaxed=angular_tolerance != ANGULAR_TOLERANCE_LADDER[0],
        skipped_faces=tuple(skipped),
        n_faces=n_faces,
    )

    if skipped:
        warnings.warn(
            f"{len(skipped)} of {n_faces} faces could not be triangulated even at an "
            f"angular tolerance of {angular_tolerance} rad (face indices {list(skipped)}); "
            "the mesh has holes there and its topology (closedness, Euler characteristic, "
            "Betti numbers) is NOT trustworthy",
            IncompleteTessellationWarning,
            stacklevel=2,
        )

    verts = np.asarray(vertices, dtype=np.float64)
    faces = np.asarray(triangles, dtype=np.int64)
    if verts.size == 0 or faces.size == 0:
        empty = MeshData(vertices=verts.reshape(0, 3), faces=faces.reshape(0, 3))
        return empty, report
    return _weld(verts, faces, tolerance=deflection * WELD_RATIO), report


def tessellate(shape: bd.Shape, deflection: float | None = None) -> MeshData:
    """Tessellate a build123d shape into a welded :class:`MeshData`.

    OCCT emits per-face vertex copies, so coincident corners appear multiple times.
    Every downstream topology test (manifoldness, closedness, Euler characteristic,
    connected components) requires welded vertices, so welding happens here, once.

    Faces that BRepMesh refuses to triangulate are recovered by relaxing the angular
    tolerance (see :data:`ANGULAR_TOLERANCE_LADDER`); any that survive that are dropped
    with an :class:`IncompleteTessellationWarning`. Call :func:`tessellate_with_report`
    when that distinction has to be acted on rather than logged.
    """
    return tessellate_with_report(shape, deflection)[0]


def mesh_for_metrics(shape: bd.Shape, deflection: float | None = None) -> MeshData:
    """The mesh every metric should score: the first ladder rung that is a closed manifold.

    The official pipeline routes its validity gate AND its metric mesh accessors through one
    robust tessellation, so the body it declares valid is the body it measures. Scoring a
    rung-1 mesh that our own gate has just ruled a meshing artefact would reintroduce the
    divergence one layer down: `armB/abc_0067-fill-hole` passes validity at deflection/4 with
    Betti (1, 0, 0), while its open rung-1 mesh reads (1, 1, 0) and scores a phantom
    topology mismatch.
    """
    return robust_tessellate(shape, deflection).mesh


def _weld(vertices: np.ndarray, faces: np.ndarray, tolerance: float) -> MeshData:
    tolerance = max(tolerance, 1e-9)
    keys = np.round(vertices / tolerance).astype(np.int64)
    _, unique_index, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    new_vertices = vertices[unique_index]
    new_faces = inverse.reshape(-1)[faces]
    # Drop degenerate triangles created by welding.
    keep = (
        (new_faces[:, 0] != new_faces[:, 1])
        & (new_faces[:, 1] != new_faces[:, 2])
        & (new_faces[:, 0] != new_faces[:, 2])
    )
    return MeshData(vertices=new_vertices, faces=new_faces[keep])


def edge_triangle_counts(mesh: MeshData) -> dict[tuple[int, int], int]:
    """Map each undirected edge to the number of triangles incident on it."""
    counts: dict[tuple[int, int], int] = defaultdict(int)
    for tri in mesh.faces:
        a, b, c = int(tri[0]), int(tri[1]), int(tri[2])
        for u, v in ((a, b), (b, c), (c, a)):
            counts[(u, v) if u < v else (v, u)] += 1
    return dict(counts)


def is_manifold_mesh(mesh: MeshData) -> bool:
    """Manifold: no edge is shared by more than two triangles."""
    return all(count <= 2 for count in edge_triangle_counts(mesh).values())


def is_closed_mesh(mesh: MeshData) -> bool:
    """Closed/watertight: every edge is shared by exactly two triangles (so 3F == 2E)."""
    counts = edge_triangle_counts(mesh)
    if not counts:
        return False
    if any(count != 2 for count in counts.values()):
        return False
    return 3 * mesh.n_faces == 2 * len(counts)


def is_orientation_consistent(mesh: MeshData) -> bool:
    """Consistent winding: each shared edge is traversed in opposite directions."""
    seen: dict[tuple[int, int], int] = defaultdict(int)
    for tri in mesh.faces:
        a, b, c = int(tri[0]), int(tri[1]), int(tri[2])
        for u, v in ((a, b), (b, c), (c, a)):
            seen[(u, v)] += 1
    for (u, v), count in seen.items():
        if count > 1:
            return False
        if seen.get((v, u), 0) > 1:
            return False
    return True


def naked_edges(mesh: MeshData) -> list[tuple[int, int]]:
    """Edges incident on exactly one triangle — the mesh-level boundary."""
    return [edge for edge, count in edge_triangle_counts(mesh).items() if count == 1]


# --- adaptive (escalating) tessellation — the grader's closure convention ----------
#
# Divisors applied to the REQUESTED deflection, coarsest first, mirroring the official
# ``cadgenbench.common.mesh.DEFLECTION_LADDER``. Rung 1 IS the requested deflection, so a part
# that already meshes closed is meshed exactly as it was before this ladder existed; finer rungs
# are reached only when a coarser one fails the closed/manifold checks.
#
# This is a VERDICT-alignment device, not a quality knob (parity-001, armB/abc_0067-fill-hole).
# The official validity gate routes every tessellation through ``robust_tessellate_shape`` and
# accepts a body when ANY rung yields a closed orientable manifold. Meshing once and publishing
# that single rung's open boundary as a validity failure made us STRICTER than the grader — and
# because the benchmark zero-cascades on invalidity, a stricter verdict is a WRONG score, not a
# safe one. What we detect beyond the grader is reported (see `ValidityReport.strictness`),
# never scored.
DEFLECTION_LADDER: tuple[int, ...] = (1, 4, 16, 32)


def is_closed_manifold(mesh: MeshData) -> bool:
    """The grader's mesh-gate predicate: closed AND manifold AND orientation-consistent."""
    return is_manifold_mesh(mesh) and is_closed_mesh(mesh) and is_orientation_consistent(mesh)


@dataclass(frozen=True)
class LadderResult:
    """The mesh the gate should judge, plus what the STRICT (rung-1) mesh looked like.

    ``mesh`` is the first rung that produced a closed orientable manifold — or, when no rung
    did, the FINEST rung tried (the official code likewise reports the finest rung's failure).
    ``requested_*`` preserve the rung-1 observation so a caller can report where it is stricter
    than the grader without ever letting that strictness change the verdict.
    """

    mesh: MeshData
    deflection: float
    divisor: int
    closed_manifold: bool
    requested_mesh: MeshData
    requested_closed_manifold: bool

    @property
    def escalated(self) -> bool:
        return self.divisor != 1


def robust_tessellate(
    shape: bd.Shape,
    deflection: float | None = None,
    ladder: tuple[int, ...] = DEFLECTION_LADDER,
    mesh: MeshData | None = None,
) -> LadderResult:
    """Tessellate, escalating to a finer deflection until the mesh is a closed manifold.

    ``mesh`` lets a caller hand in the rung-1 mesh it already holds, so the common case (a part
    that meshes closed straight away) costs no extra tessellation at all.

    The shape's cached triangulation is CLEANED after an escalation. OCCT stores the last
    triangulation on the shape and ``BRepTools.Triangulation_s`` treats a finer one as adequate
    for any coarser request, so leaving a rung-32 mesh attached would silently hand every later
    ``tessellate(shape)`` a finer mesh than it asked for — and two metrics computed from two
    different meshes are not comparable.
    """
    if not ladder:
        raise ValueError("the deflection ladder must list at least one divisor")
    if deflection is None:
        deflection = deflection_for_bbox(bbox_diagonal(shape))

    requested = mesh if mesh is not None else tessellate(shape, deflection)
    requested_ok = is_closed_manifold(requested)
    if requested_ok and ladder[0] == 1:
        return LadderResult(
            mesh=requested,
            deflection=float(deflection),
            divisor=1,
            closed_manifold=True,
            requested_mesh=requested,
            requested_closed_manifold=True,
        )

    current, divisor, ok = requested, int(ladder[0]), requested_ok
    for rung in ladder:
        if rung == 1:
            current, divisor, ok = requested, 1, requested_ok
        else:
            current = tessellate(shape, deflection / rung)
            divisor, ok = int(rung), is_closed_manifold(current)
        if ok:
            break

    if divisor != 1 and shape.wrapped is not None:
        BRepTools.Clean_s(shape.wrapped)

    return LadderResult(
        mesh=current,
        deflection=float(deflection),
        divisor=int(divisor),
        closed_manifold=bool(ok),
        requested_mesh=requested,
        requested_closed_manifold=bool(requested_ok),
    )


def euler_characteristic(mesh: MeshData) -> int:
    """chi = V - E + F over the welded mesh."""
    return mesh.n_vertices - len(edge_triangle_counts(mesh)) + mesh.n_faces


def mesh_volume(mesh: MeshData) -> float:
    """Signed volume via the divergence theorem; sign follows the winding."""
    tris = mesh.triangles()
    if tris.size == 0:
        return 0.0
    cross = np.cross(tris[:, 1], tris[:, 2])
    return float(np.einsum("ij,ij->i", tris[:, 0], cross).sum() / 6.0)


def mesh_bbox(mesh: MeshData) -> tuple[np.ndarray, np.ndarray]:
    """(min_corner, max_corner) of the mesh's axis-aligned bounding box."""
    if mesh.n_vertices == 0:
        zeros = np.zeros(3)
        return zeros, zeros
    return mesh.vertices.min(axis=0), mesh.vertices.max(axis=0)


def mesh_bbox_diagonal(mesh: MeshData) -> float:
    lo, hi = mesh_bbox(mesh)
    return float(np.linalg.norm(hi - lo))


def sample_surface(mesh: MeshData, n_points: int, seed: int = 0) -> np.ndarray:
    """Area-weighted uniform sample of points on the mesh surface (deterministic)."""
    if mesh.n_faces == 0:
        return np.zeros((0, 3))
    areas = mesh.face_areas()
    total = areas.sum()
    if total <= 0:
        return np.zeros((0, 3))
    rng = np.random.default_rng(seed)
    face_idx = rng.choice(mesh.n_faces, size=n_points, p=areas / total)
    tris = mesh.triangles()[face_idx]
    u = rng.random((n_points, 1))
    v = rng.random((n_points, 1))
    over = (u + v) > 1
    u[over] = 1 - u[over]
    v[over] = 1 - v[over]
    return tris[:, 0] + u * (tris[:, 1] - tris[:, 0]) + v * (tris[:, 2] - tris[:, 0])


def sample_surface_with_normals(
    mesh: MeshData, n_points: int, seed: int = 0
) -> tuple[np.ndarray, np.ndarray]:
    """Area-weighted surface sample plus each sample's face normal (deterministic)."""
    if mesh.n_faces == 0:
        return np.zeros((0, 3)), np.zeros((0, 3))
    areas = mesh.face_areas()
    total = areas.sum()
    if total <= 0:
        return np.zeros((0, 3)), np.zeros((0, 3))
    rng = np.random.default_rng(seed)
    face_idx = rng.choice(mesh.n_faces, size=n_points, p=areas / total)
    tris = mesh.triangles()[face_idx]
    u = rng.random((n_points, 1))
    v = rng.random((n_points, 1))
    over = (u + v) > 1
    u[over] = 1 - u[over]
    v[over] = 1 - v[over]
    pts = tris[:, 0] + u * (tris[:, 1] - tris[:, 0]) + v * (tris[:, 2] - tris[:, 0])
    return pts, mesh.face_normals()[face_idx]


def to_trimesh(mesh: MeshData):  # type: ignore[no-untyped-def]
    """Adapt to a ``trimesh.Trimesh`` for proximity queries and boolean kernels."""
    import trimesh

    return trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, process=False)
