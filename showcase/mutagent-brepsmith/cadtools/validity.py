"""T4 — the validity gate, transcribed from the benchmark's `docs/metrics/cad_validity.md`.

# @implements validity-checker

Validity is the floor of the whole benchmark: an invalid output scores **zero** on every
other axis. The doc requires ALL THREE of:

1. ``BRepCheck_Analyzer::IsValid()`` reports no defect — build123d exposes exactly this as
   ``Shape.is_valid``.
2. Every shell is closed / the body has no naked edges.
3. The tessellation is manifold (each edge shared by at most two triangles), closed
   (``3F == 2E``) and orientation-consistent.

Condition 3 is judged the way the GRADER judges it (parity-001): the official gate
tessellates through an escalating deflection ladder and accepts the body when ANY rung yields a
closed orientable manifold, so a part whose closure is only a meshing artefact of the requested
deflection is NOT rejected. Our own stricter observation is kept — as `strict_mesh_closed` and
the `strictness` notes — but it never changes the pass/fail VERDICT. A verdict stricter than the
grader's is not conservative: validity zero-cascades over every other axis, so it is a wrong
score.

The doc ALSO lists diagnostics — tiny faces, extreme aspect ratios, loose BREP tolerance —
that are explicitly advisory. They are reported here, and they NEVER gate. Conflating an
advisory with a failure would make the agent chase phantom defects inside its 5-round budget.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import build123d as bd

from cadtools.mesh import (
    DEFLECTION_LADDER,
    MeshData,
    edge_triangle_counts,
    is_closed_mesh,
    is_manifold_mesh,
    is_orientation_consistent,
    naked_edges,
    robust_tessellate,
)

# Advisory-only thresholds (from the same doc). None of these gate validity.
ADVISORY_MIN_FACE_AREA = 1e-3  # mm^2
ADVISORY_MAX_ASPECT_RATIO = 1000.0
ADVISORY_MAX_BREP_TOLERANCE = 0.1  # mm


@dataclass(frozen=True)
class ValidityReport:
    """Pass/fail plus the NAMED reason — the agent's fix loop needs the locus, not a bool."""

    is_valid: bool
    brep_well_formed: bool
    shells_closed: bool
    mesh_manifold: bool
    mesh_closed: bool
    orientation_consistent: bool
    n_naked_edges: int
    n_non_manifold_edges: int
    n_faces: int
    n_mesh_triangles: int
    mesh_deflection_divisor: int
    strict_mesh_closed: bool
    min_face_area: float
    max_aspect_ratio: float
    max_brep_tolerance: float
    failures: list[str] = field(default_factory=list)
    advisories: list[str] = field(default_factory=list)
    #: Findings STRICTER than the official gate's verdict. Reported, never scored.
    strictness: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "brep_well_formed": self.brep_well_formed,
            "shells_closed": self.shells_closed,
            "mesh_manifold": self.mesh_manifold,
            "mesh_closed": self.mesh_closed,
            "orientation_consistent": self.orientation_consistent,
            "n_naked_edges": self.n_naked_edges,
            "n_non_manifold_edges": self.n_non_manifold_edges,
            "n_faces": self.n_faces,
            "n_mesh_triangles": self.n_mesh_triangles,
            "mesh_deflection_divisor": self.mesh_deflection_divisor,
            "strict_mesh_closed": self.strict_mesh_closed,
            "min_face_area": self.min_face_area,
            "max_aspect_ratio": self.max_aspect_ratio,
            "max_brep_tolerance": self.max_brep_tolerance,
            "failures": list(self.failures),
            "advisories": list(self.advisories),
            "strictness": list(self.strictness),
        }


def check_validity(shape: bd.Shape, mesh: MeshData | None = None) -> ValidityReport:
    """Apply the benchmark's three gating conditions plus the advisory diagnostics.

    ``mesh`` is treated as the REQUESTED-deflection (rung-1) tessellation, exactly what a
    caller that already meshed this body holds. When it is not a closed manifold the gate
    escalates down the official deflection ladder before ruling, so passing a mesh in never
    buys a stricter verdict than not passing one.
    """
    ladder = robust_tessellate(shape, mesh=mesh)
    mesh = ladder.mesh

    failures: list[str] = []
    strictness: list[str] = []

    # --- condition 1: BRepCheck_Analyzer::IsValid ---
    brep_well_formed = bool(shape.is_valid)
    if not brep_well_formed:
        failures.append("BREP is not well-formed (BRepCheck_Analyzer::IsValid reported a defect)")

    # --- condition 2: closed shells / no naked edges ---
    open_edges = _brep_naked_edges(shape)
    mesh_naked = naked_edges(mesh)
    n_naked = len(open_edges) if open_edges is not None else len(mesh_naked)
    shells_closed = n_naked == 0
    if not shells_closed:
        failures.append(f"body is not watertight: {n_naked} naked edge(s) / open shell")

    # --- condition 3: mesh manifold + closed + orientation-consistent ---
    counts = edge_triangle_counts(mesh)
    n_non_manifold = sum(1 for c in counts.values() if c > 2)
    mesh_manifold = is_manifold_mesh(mesh)
    mesh_closed = is_closed_mesh(mesh)
    orientation_consistent = is_orientation_consistent(mesh)
    if not mesh_manifold:
        failures.append(
            f"tessellation is non-manifold: {n_non_manifold} edge(s) shared by >2 triangles"
        )
    if not mesh_closed:
        failures.append("tessellation is not closed (3F != 2E; open boundary in the mesh)")
    if not orientation_consistent:
        failures.append("tessellation has inconsistent triangle orientation")

    # Stricter-than-the-grader observations. The official gate accepts a body that closes at
    # ANY ladder rung, so an open rung-1 mesh is a MESHING artefact here, not a defect of the
    # body — reported so a reader can see it, kept out of `failures` so it cannot score.
    if ladder.escalated and ladder.closed_manifold:
        strictness.append(
            f"stricter-than-official: at the requested deflection "
            f"({ladder.deflection:.6g} mm) the tessellation was NOT a closed manifold "
            f"({len(naked_edges(ladder.requested_mesh))} open edge(s), "
            f"{ladder.requested_mesh.n_faces} triangles); it closed at deflection/"
            f"{ladder.divisor} ({mesh.n_faces} triangles), which is the official "
            f"convention (DEFLECTION_LADDER={DEFLECTION_LADDER}), so the VERDICT follows "
            f"the grader and this is a report only"
        )

    faces = shape.faces()
    min_face_area = float(min((f.area for f in faces), default=0.0))
    max_aspect = _max_face_aspect_ratio(faces)
    max_tol = _max_brep_tolerance(shape)

    advisories: list[str] = []
    if faces and min_face_area < ADVISORY_MIN_FACE_AREA:
        advisories.append(
            f"advisory: minimum face area {min_face_area:.3e} mm^2 is below "
            f"{ADVISORY_MIN_FACE_AREA:.0e} mm^2 (sliver face) — not a validity failure"
        )
    if max_aspect > ADVISORY_MAX_ASPECT_RATIO:
        advisories.append(
            f"advisory: maximum face aspect ratio {max_aspect:.1f} exceeds "
            f"{ADVISORY_MAX_ASPECT_RATIO:.0f} — not a validity failure"
        )
    if max_tol > ADVISORY_MAX_BREP_TOLERANCE:
        advisories.append(
            f"advisory: maximum BREP tolerance {max_tol:.3e} mm exceeds "
            f"{ADVISORY_MAX_BREP_TOLERANCE} mm — not a validity failure"
        )

    return ValidityReport(
        is_valid=not failures,
        brep_well_formed=brep_well_formed,
        shells_closed=shells_closed,
        mesh_manifold=mesh_manifold,
        mesh_closed=mesh_closed,
        orientation_consistent=orientation_consistent,
        n_naked_edges=n_naked,
        n_non_manifold_edges=n_non_manifold,
        n_faces=len(faces),
        n_mesh_triangles=mesh.n_faces,
        mesh_deflection_divisor=ladder.divisor,
        strict_mesh_closed=ladder.requested_closed_manifold,
        min_face_area=min_face_area,
        max_aspect_ratio=max_aspect,
        max_brep_tolerance=max_tol,
        failures=failures,
        advisories=advisories,
        strictness=strictness,
    )


def check_validity_file(path: str | Path) -> ValidityReport:
    """Import a STEP file and gate it. The CLI's `verify` entry point."""
    from cadtools.step_io import import_step_file

    return check_validity(import_step_file(path))


def _brep_naked_edges(shape: bd.Shape) -> list[Any] | None:
    """BREP-level naked edges via OCCT's own edge -> face ancestor map.

    A hand-rolled geometric edge key is WRONG here: a cylinder's seam edge and a sphere's
    degenerate pole edges are legitimately used once (or are degenerate), so a naive
    "used by exactly one face" rule reports every through-hole and every sphere as leaking.
    ``TopExp::MapShapesAndAncestors`` uses OCCT's shape identity, and degenerate edges are
    skipped explicitly, so only a genuine open boundary is reported.

    Returns None when the topology cannot be walked, so the caller falls back to the
    mesh-level boundary rather than silently declaring the body watertight.
    """
    try:
        from OCP.BRep import BRep_Tool  # type: ignore[import-not-found]
        from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE  # type: ignore[import-not-found]
        from OCP.TopExp import TopExp  # type: ignore[import-not-found]
        from OCP.TopoDS import TopoDS  # type: ignore[import-not-found]
        from OCP.TopTools import (  # type: ignore[import-not-found]
            TopTools_IndexedDataMapOfShapeListOfShape,
        )

        ancestors = TopTools_IndexedDataMapOfShapeListOfShape()
        TopExp.MapShapesAndAncestors_s(shape.wrapped, TopAbs_EDGE, TopAbs_FACE, ancestors)
        open_edges: list[Any] = []
        for i in range(1, ancestors.Extent() + 1):
            edge = TopoDS.Edge_s(ancestors.FindKey(i))
            if BRep_Tool.Degenerated_s(edge):
                continue
            if ancestors.FindFromIndex(i).Extent() < 2:
                open_edges.append(edge)
        return open_edges
    except Exception:  # noqa: BLE001 - fall back to the mesh boundary
        return None


def _max_face_aspect_ratio(faces: list[bd.Face]) -> float:
    worst = 0.0
    for face in faces:
        try:
            size = face.bounding_box().size
            dims = sorted(d for d in (size.X, size.Y, size.Z) if d > 1e-12)
            if len(dims) >= 2:
                worst = max(worst, float(dims[-1] / dims[0]))
        except Exception:  # noqa: BLE001 - a diagnostic must never break the gate
            continue
    return worst


def _max_brep_tolerance(shape: bd.Shape) -> float:
    worst = 0.0
    try:
        from OCP.BRep import BRep_Tool  # type: ignore[import-not-found]

        for vertex in shape.vertices():
            worst = max(worst, float(BRep_Tool.Tolerance_s(vertex.wrapped)))
    except Exception:  # noqa: BLE001 - a diagnostic must never break the gate
        return worst
    return worst
