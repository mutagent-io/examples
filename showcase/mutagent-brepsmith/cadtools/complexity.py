"""T7 — deterministic geometric-complexity grading.

# @implements complexity-grader

Capability `complexity-grader`: "Deterministic geometric-complexity grading of a STEP file
(face/edge/solid counts, surface-type variety, feature density, genus) into tiers for
dataset stratification."

The tier vocabulary is `low` / `mid` / `high`, matching the spec's dataset categories
`tier-low` / `tier-mid` / `tier-high` exactly — a grader whose tiers do not match the
dataset's categories cannot stratify it.

Determinism matters more than sophistication here: the same file must always grade the same
way, or the dev/validation split silently changes between runs and score comparisons across
runs become meaningless. So the score is a fixed weighted sum of measured signals with fixed
cut points — no sampling, no randomness, no learned thresholds.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import build123d as bd

from cadtools.mesh import bbox_diagonal, tessellate

TIERS: tuple[str, str, str] = ("low", "mid", "high")

# Cut points on the composite score. Chosen so a prismatic block sits well inside `low` and
# a dense feature pattern sits well inside `high`, leaving `mid` for parts with a handful of
# interacting features.
MID_THRESHOLD = 1.0
HIGH_THRESHOLD = 2.5

# Signal weights (fixed; see the module docstring on determinism).
W_FACES = 0.02
W_SURFACE_VARIETY = 0.25
W_FEATURE_DENSITY = 0.6
W_GENUS = 0.06
W_MULTI_SOLID = 0.3


@dataclass(frozen=True)
class ComplexityRecord:
    """Raw signals + the tier, as the spec's job `grade-complexity` requires."""

    n_solids: int
    n_faces: int
    n_edges: int
    n_vertices: int
    surface_types: dict[str, int]
    surface_type_variety: int
    bbox_diagonal: float
    feature_density: float
    genus: int
    score: float
    tier: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "n_solids": self.n_solids,
            "n_faces": self.n_faces,
            "n_edges": self.n_edges,
            "n_vertices": self.n_vertices,
            "surface_types": dict(self.surface_types),
            "surface_type_variety": self.surface_type_variety,
            "bbox_diagonal": self.bbox_diagonal,
            "feature_density": self.feature_density,
            "genus": self.genus,
            "score": self.score,
            "tier": self.tier,
        }


def grade_complexity(shape: bd.Shape) -> ComplexityRecord:
    """Grade a body. Pure and deterministic: same input, byte-identical record."""
    from cadtools.scoring import betti_numbers

    faces = shape.faces()
    surface_types = dict(sorted(Counter(_geom_type_name(f) for f in faces).items()))
    diagonal = bbox_diagonal(shape) or 1.0
    # Faces per unit of bbox diagonal: a proxy for how densely featured the part is,
    # normalised so a big simple part does not outrank a small intricate one.
    feature_density = len(faces) / diagonal

    betti = betti_numbers(tessellate(shape))
    genus = betti[1]

    score = (
        W_FACES * len(faces)
        + W_SURFACE_VARIETY * len(surface_types)
        + W_FEATURE_DENSITY * feature_density
        + W_GENUS * genus
        + W_MULTI_SOLID * max(0, len(shape.solids()) - 1)
    )
    tier = "high" if score >= HIGH_THRESHOLD else "mid" if score >= MID_THRESHOLD else "low"

    return ComplexityRecord(
        n_solids=len(shape.solids()),
        n_faces=len(faces),
        n_edges=len(shape.edges()),
        n_vertices=len(shape.vertices()),
        surface_types=surface_types,
        surface_type_variety=len(surface_types),
        bbox_diagonal=float(diagonal),
        feature_density=float(feature_density),
        genus=int(genus),
        score=float(score),
        tier=tier,
    )


def grade_file(path: str | Path) -> ComplexityRecord:
    from cadtools.step_io import import_step_file

    return grade_complexity(import_step_file(path))


def _geom_type_name(face: bd.Face) -> str:
    geom_type = face.geom_type
    name = getattr(geom_type, "name", None)
    return str(name if name is not None else geom_type).upper()
