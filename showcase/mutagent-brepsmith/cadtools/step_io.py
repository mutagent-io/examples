"""T3 — STEP round-trip and topology introspection.

# @implements step-io

Capability `step-io` from the spec: "Round-trip STEP files through build123d/OpenCascade:
import, entity inspection, export."

This is the only module that touches STEP files on disk. Everything else in `cadtools`
works on the `build123d.Shape` / `MeshData` level, so the file contract (naming, export
options, error behaviour) is stated exactly once.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import build123d as bd

from cadtools.mesh import bbox_diagonal

# The benchmark accepts exactly these candidate filenames per sample directory.
CANDIDATE_NAMES: tuple[str, ...] = ("output.step", "output.stp")


@dataclass(frozen=True)
class TopologyReport:
    """The readback the agent's ANALYZE step plans against. Never a guess — always measured."""

    n_solids: int
    n_shells: int
    n_faces: int
    n_edges: int
    n_vertices: int
    volume: float
    area: float
    bbox_min: tuple[float, float, float]
    bbox_max: tuple[float, float, float]
    bbox_size: tuple[float, float, float]
    bbox_diagonal: float
    surface_types: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "n_solids": self.n_solids,
            "n_shells": self.n_shells,
            "n_faces": self.n_faces,
            "n_edges": self.n_edges,
            "n_vertices": self.n_vertices,
            "volume": self.volume,
            "area": self.area,
            "bbox_min": list(self.bbox_min),
            "bbox_max": list(self.bbox_max),
            "bbox_size": list(self.bbox_size),
            "bbox_diagonal": self.bbox_diagonal,
            "surface_types": dict(self.surface_types),
        }


def import_step_file(path: str | Path) -> bd.Shape:
    """Import a STEP file.

    Raises:
        ValueError: if the file does not exist or OpenCascade cannot read it. This mirrors
            build123d's own documented behaviour ("Raises ValueError - can't open file").
    """
    p = Path(path)
    if not p.exists():
        raise ValueError(f"can't open file: {p}")
    try:
        shape = bd.import_step(str(p))
    except Exception as exc:  # noqa: BLE001 - normalise every reader failure to ValueError
        raise ValueError(f"can't read STEP file {p}: {exc}") from exc
    if shape is None:
        raise ValueError(f"can't read STEP file {p}: importer returned nothing")
    return shape


@contextmanager
def _detached(shape: bd.Shape) -> Iterator[bd.Shape]:
    """Temporarily detach a shape from its assembly parent for export.

    `import_step` hands back a shape whose ``parent`` is an *unlabelled* assembly Compound.
    build123d's STEP writer walks up to that parent when building the document, and the
    empty label makes ``writer.Write`` return a non-Done status — surfacing as
    ``RuntimeError: Failed to write STEP file`` on any import -> export round-trip.
    Exporting the shape detached writes exactly the body we were handed, unchanged, and
    the caller's object is restored on the way out.
    """
    parent = getattr(shape, "parent", None)
    if parent is None:
        yield shape
        return
    shape.parent = None
    try:
        yield shape
    finally:
        shape.parent = parent


def export_step_file(shape: bd.Shape, path: str | Path) -> bool:
    """Export a shape to STEP, creating parent directories. Returns the exporter's status."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with _detached(shape) as detached:
        return bool(bd.export_step(detached, str(p)))


def find_candidate(sample_dir: str | Path) -> Path | None:
    """Return the sample's candidate output STEP, or None when the sample has no output.

    A sample directory with no candidate is `status: "missing"` / `cad_score = 0` on the
    leaderboard — it is never an error here, it is a reported state.
    """
    d = Path(sample_dir)
    for name in CANDIDATE_NAMES:
        candidate = d / name
        if candidate.exists():
            return candidate
    return None


def introspect(shape: bd.Shape) -> TopologyReport:
    """Measure a shape: counts, mass properties, bounding box, surface-type histogram."""
    faces = shape.faces()
    bbox = shape.bounding_box()
    surface_types = Counter(_geom_type_name(f) for f in faces)
    return TopologyReport(
        n_solids=len(shape.solids()),
        n_shells=len(shape.shells()),
        n_faces=len(faces),
        n_edges=len(shape.edges()),
        n_vertices=len(shape.vertices()),
        volume=float(shape.volume),
        area=float(shape.area),
        bbox_min=(float(bbox.min.X), float(bbox.min.Y), float(bbox.min.Z)),
        bbox_max=(float(bbox.max.X), float(bbox.max.Y), float(bbox.max.Z)),
        bbox_size=(float(bbox.size.X), float(bbox.size.Y), float(bbox.size.Z)),
        bbox_diagonal=bbox_diagonal(shape),
        surface_types=dict(sorted(surface_types.items())),
    )


def introspect_file(path: str | Path) -> TopologyReport:
    """Convenience: import then introspect, for the CLI's `analyze` subcommand."""
    return introspect(import_step_file(path))


def surface_type_histogram(shape: bd.Shape) -> dict[str, int]:
    """`{surface type: face count}` for a body — the analytic-surface fingerprint.

    Already computed inside :func:`introspect`; exposed separately because the differ needs
    to compare the histogram ACROSS a pair, which is the one input-vs-candidate quantity that
    separates "material was added" from "the body was transformed" without a ground truth
    (F-002). An anisotropic affine transform is exactly the operation that cannot preserve
    analytic surfaces: OpenCascade degrades every PLANE/CYLINDER/CONE it touches to BSPLINE.
    """
    return dict(sorted(Counter(_geom_type_name(f) for f in shape.faces()).items()))


def _geom_type_name(face: bd.Face) -> str:
    geom_type = face.geom_type
    name = getattr(geom_type, "name", None)
    return str(name if name is not None else geom_type).upper()
