"""T5 — localized-change verification.

# @implements geometry-differ

Capability `geometry-differ`: "Compare two STEP bodies (mesh distance fields, volume delta,
per-region change maps) to verify the edit is localized to the requested region and
unrelated geometry is preserved."

Why this exists separately from the scorer: the benchmark's shape-similarity metric is a
GLOBAL aggregate. Its own documentation notes that neither the surface F1 nor the volume
IoU tells you *where* a body changed, so neither can answer the SOP's VERIFY step (b)
(LOCALITY) or the evaluation criterion `unrelated-geometry-preserved`. This module answers
that question directly: a symmetric surface-distance field, the set of points that actually
moved, their bounding box, the signed volume delta, and the Betti delta.

**Frame agreement (A4).** For the EDITING task the ground truth is a local change to
`input.step` expressed in the input's own coordinate frame, so we deliberately do NOT
canonically re-pose outputs and we do NOT run ICP (that would destroy the correspondence
the whole metric depends on). The price of that choice is that a mis-posed pair would score
as a catastrophically bad edit rather than as an error. So pose agreement is checked
explicitly and HARD: a disagreeing pair raises :class:`FrameDisagreementError`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import build123d as bd
import numpy as np

from cadtools.mesh import (
    MeshData,
    mesh_bbox,
    mesh_bbox_diagonal,
    mesh_for_metrics,
    mesh_volume,
    sample_surface,
)
from cadtools.proximity import surface_distances

# Points that moved by more than this fraction of the reference bbox diagonal count as
# "changed". Deliberately the same 0.5% radius the benchmark's surface-F1 metric uses, so
# "unchanged here" means the same thing to the differ and to the scorer.
CHANGE_TOLERANCE_RATIO = 0.005
# Frame agreement tolerance, as a fraction of the reference bbox diagonal. Generous on
# purpose: it must pass a legitimate dimensional edit (which does move the centroid and the
# extents) while failing a gross re-pose (translation by ~a part length, or a 90 deg spin).
FRAME_TOLERANCE_RATIO = 0.10
DEFAULT_SAMPLES = 20000


class FrameDisagreementError(RuntimeError):
    """Raised when two bodies are not posed in the same coordinate frame (A4)."""


@dataclass(frozen=True)
class FrameAgreement:
    """Pose agreement, measured SIZE-INVARIANTLY (F-001/R5).

    The original check gated on raw `centre_delta` and `extent_delta`. For two bodies sharing
    a bbox corner those are arithmetically locked together — `centre_delta == extent_delta/2`
    exactly — so a legitimate 25% dimension change was reported as a "frame disagreement" and
    hard-zeroed, with every digit of the evidence reproducible from the SIZES alone. Nothing
    in it measured pose.

    The two quantities are now separated:

    * ``pose_delta`` — centre movement AFTER removing the part any resize about a fixed point
      would explain (a resize moves the centre by at most half the extent change). A pure
      translation shows up here in full; a pure resize shows up as zero.
    * ``axis_permutation`` — the extents changed, but the SORTED extents did not: the same box
      re-oriented, i.e. a rotation. (A 90 deg spin of a part with two equal extents is
      invisible to any bbox test; that limit is inherent to comparing boxes, not to this rule.)

    ``shape_divergence`` is the third state: same pose, different size. That is a SHAPE
    finding, not a frame finding, and it must never be reported under the frame label.
    """

    agree: bool
    centre_delta: float
    extent_delta: float
    tolerance: float
    reference_diagonal: float
    message: str
    pose_delta: float = 0.0
    sorted_extent_delta: float = 0.0
    axis_permutation: bool = False
    shape_divergence: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "agree": self.agree,
            "centre_delta": self.centre_delta,
            "extent_delta": self.extent_delta,
            "pose_delta": self.pose_delta,
            "sorted_extent_delta": self.sorted_extent_delta,
            "axis_permutation": self.axis_permutation,
            "shape_divergence": self.shape_divergence,
            "tolerance": self.tolerance,
            "reference_diagonal": self.reference_diagonal,
            "message": self.message,
        }


@dataclass(frozen=True)
class DiffReport:
    """Where, how much, and what kind of change — the LOCALITY evidence."""

    max_distance: float
    mean_distance: float
    change_tolerance: float
    changed_fraction: float
    changed_bbox_min: tuple[float, float, float] | None
    changed_bbox_max: tuple[float, float, float] | None
    volume_ref: float
    volume_cand: float
    volume_delta: float
    volume_delta_fraction: float
    betti_ref: tuple[int, int, int]
    betti_cand: tuple[int, int, int]
    betti_delta: tuple[int, int, int]
    frame: FrameAgreement
    # sample points + their distances, retained so region queries need no re-sampling
    _points: np.ndarray
    _distances: np.ndarray
    # --- operation-class evidence (F-002): the analytic-surface fingerprint of the pair ---
    surface_types_ref: dict[str, int] = field(default_factory=dict)
    surface_types_cand: dict[str, int] = field(default_factory=dict)
    surface_types_destroyed: dict[str, int] = field(default_factory=dict)
    surface_type_allowance: dict[str, int] = field(default_factory=dict)
    operation_class_ok: bool = True
    surface_types_available: bool = False
    # --- sampling provenance (F-004-2): a 3000-sample diff must not read like a 20000 one --
    n_samples: int = DEFAULT_SAMPLES

    def max_distance_outside(
        self,
        region_min: tuple[float, float, float],
        region_max: tuple[float, float, float],
    ) -> float:
        """Largest surface movement OUTSIDE the requested region of interest.

        This is the number that answers "unrelated geometry preserved": it must stay within
        tolerance for a localized edit, whatever the global similarity says.
        """
        lo = np.asarray(region_min, dtype=np.float64)
        hi = np.asarray(region_max, dtype=np.float64)
        inside = np.all((self._points >= lo) & (self._points <= hi), axis=1)
        outside = self._distances[~inside]
        return float(outside.max()) if outside.size else 0.0

    def is_localized_to(
        self,
        region_min: tuple[float, float, float],
        region_max: tuple[float, float, float],
        tolerance: float | None = None,
    ) -> bool:
        tol = self.change_tolerance if tolerance is None else tolerance
        return self.max_distance_outside(region_min, region_max) <= tol

    def to_dict(self) -> dict[str, Any]:
        return {
            "max_distance": self.max_distance,
            "mean_distance": self.mean_distance,
            "change_tolerance": self.change_tolerance,
            "changed_fraction": self.changed_fraction,
            "changed_bbox_min": list(self.changed_bbox_min) if self.changed_bbox_min else None,
            "changed_bbox_max": list(self.changed_bbox_max) if self.changed_bbox_max else None,
            "volume_ref": self.volume_ref,
            "volume_cand": self.volume_cand,
            "volume_delta": self.volume_delta,
            "volume_delta_fraction": self.volume_delta_fraction,
            "betti_ref": list(self.betti_ref),
            "betti_cand": list(self.betti_cand),
            "betti_delta": list(self.betti_delta),
            "frame_agreement": self.frame.to_dict(),
            "surface_types_ref": dict(self.surface_types_ref),
            "surface_types_cand": dict(self.surface_types_cand),
            "surface_types_destroyed": dict(self.surface_types_destroyed),
            "surface_type_allowance": dict(self.surface_type_allowance),
            "operation_class_ok": self.operation_class_ok,
            "surface_types_available": self.surface_types_available,
            "n_samples": self.n_samples,
        }

    def locality(
        self,
        region_min: tuple[float, float, float] | None = None,
        region_max: tuple[float, float, float] | None = None,
    ) -> dict[str, Any]:
        """The `unrelated-geometry-preserved` evidence, as a reportable block.

        F-002 found `max_distance_outside` / `is_localized_to` had ZERO production callers:
        the only code that answers "is the change confined to the requested region" was
        reachable from the tests and from nowhere else, while the criterion that names it was
        written against it. This is the reporting surface that gives them one.

        With no explicit region, the report falls back to the region the diff MEASURED (the
        changed bbox), which quantifies how much movement sits outside the detected change —
        a real number, not a tautology, because the changed bbox is derived from the points
        above tolerance while this reads every sample outside it.
        """
        explicit = region_min is not None and region_max is not None
        lo = region_min if explicit else self.changed_bbox_min
        hi = region_max if explicit else self.changed_bbox_max
        if lo is None or hi is None:
            return {
                "region_min": None,
                "region_max": None,
                "region_source": "explicit" if explicit else "measured-changed-bbox",
                "max_distance_outside": 0.0,
                "is_localized_to": True,
                "tolerance": self.change_tolerance,
            }
        return {
            "region_min": list(lo),
            "region_max": list(hi),
            "region_source": "explicit" if explicit else "measured-changed-bbox",
            "max_distance_outside": self.max_distance_outside(lo, hi),
            "is_localized_to": self.is_localized_to(lo, hi),
            "tolerance": self.change_tolerance,
        }


def check_frame_agreement(
    reference: bd.Shape | MeshData,
    candidate: bd.Shape | MeshData,
    tolerance_ratio: float = FRAME_TOLERANCE_RATIO,
) -> FrameAgreement:
    """A4 — assert both bodies live in the same coordinate frame, without ICP.

    SIZE-INVARIANT (R5): a body that merely changed size is not mis-posed, however large the
    change. Only two things fail this check — a translation the resize cannot explain, and a
    permutation of the extents (a rotation). See :class:`FrameAgreement` for why the previous
    raw-delta form could not pass the very edits it had to grade.
    """
    ref = _as_mesh(reference)
    cand = _as_mesh(candidate)
    ref_lo, ref_hi = mesh_bbox(ref)
    cand_lo, cand_hi = mesh_bbox(cand)
    diagonal = float(np.linalg.norm(ref_hi - ref_lo))
    if diagonal <= 0:
        diagonal = 1.0
    tolerance = tolerance_ratio * diagonal

    ref_extent = ref_hi - ref_lo
    cand_extent = cand_hi - cand_lo
    centre_delta = float(np.linalg.norm((ref_lo + ref_hi) / 2 - (cand_lo + cand_hi) / 2))
    extent_delta = float(np.linalg.norm(ref_extent - cand_extent))
    sorted_extent_delta = float(np.linalg.norm(np.sort(ref_extent) - np.sort(cand_extent)))

    # A resize about ANY fixed point moves the bbox centre by at most half the extent change
    # (exactly half when the fixed point is a corner, zero when it is the centre). Whatever is
    # left over after subtracting that budget is genuine translation.
    pose_delta = max(0.0, centre_delta - extent_delta / 2.0)
    # Extents changed, but the MULTISET of extents did not: the same box, re-oriented.
    axis_permutation = extent_delta > tolerance and sorted_extent_delta <= tolerance

    problems = []
    if pose_delta > tolerance:
        problems.append(
            f"bbox centre moved {centre_delta:.4f} mm, of which {pose_delta:.4f} mm cannot be "
            f"explained by the {extent_delta:.4f} mm size change (> {tolerance:.4f} mm "
            "tolerance) — that residual is a translation"
        )
    if axis_permutation:
        problems.append(
            f"the bbox extents were permuted rather than resized (extent delta "
            f"{extent_delta:.4f} mm, but the sorted extents differ by only "
            f"{sorted_extent_delta:.4f} mm) — that is a rotation, not an edit"
        )
    agree = not problems
    shape_divergence = extent_delta > tolerance and not axis_permutation
    if agree:
        message = "bodies are posed in the same frame"
        if shape_divergence:
            message += (
                f"; their SIZES differ by {extent_delta:.4f} mm, which is a shape finding, "
                "not a pose one"
            )
    else:
        message = "frame disagreement: " + "; ".join(problems)
    return FrameAgreement(
        agree=agree,
        centre_delta=centre_delta,
        extent_delta=extent_delta,
        tolerance=tolerance,
        reference_diagonal=diagonal,
        message=message,
        pose_delta=pose_delta,
        sorted_extent_delta=sorted_extent_delta,
        axis_permutation=axis_permutation,
        shape_divergence=shape_divergence,
    )


def surface_type_destruction(
    reference_types: dict[str, int],
    candidate_types: dict[str, int],
    changed_fraction: float,
) -> tuple[dict[str, int], dict[str, int], bool]:
    """`(destroyed, allowance, ok)` — the GT-free operation-class check (F-002).

    An anisotropic affine transform is the one operation that CANNOT preserve analytic
    surfaces: OpenCascade retypes every PLANE/CYLINDER/CONE it touches to BSPLINE. On
    `abc_0397-thicken` the candidate destroyed all 9 planar faces while passing every other
    metric the harness computed — valid, watertight, topologically identical, dimensionally
    exact, and worse than emitting the unmodified input.

    Legitimate edits DO remove faces (`fill-hole` closes a cylinder, `corner-fillet` replaces
    planes), so the rule is not "destroyed must be empty". It is proportionality: an edit that
    moved `changed_fraction` of the surface may destroy at most that share of each surface
    type, rounded up, and never fewer than one. A 68%-of-the-surface edit may take 7 of 9
    planes; taking all 9 is a different operation than the one requested.

    Ground-truth-free by construction, so it transfers to the real benchmark inputs where no
    answer key exists.
    """
    destroyed: dict[str, int] = {}
    allowance: dict[str, int] = {}
    for name, count in reference_types.items():
        lost = count - candidate_types.get(name, 0)
        if lost > 0:
            destroyed[name] = lost
            allowance[name] = max(1, math.ceil(changed_fraction * count))
    ok = all(destroyed[name] <= allowance[name] for name in destroyed)
    return destroyed, allowance, ok


def diff_shapes(
    reference: bd.Shape | MeshData,
    candidate: bd.Shape | MeshData,
    n_samples: int = DEFAULT_SAMPLES,
    change_tolerance: float | None = None,
    require_frame_agreement: bool = True,
) -> DiffReport:
    """Symmetric surface diff of two bodies posed in the same frame."""
    ref = _as_mesh(reference)
    cand = _as_mesh(candidate)
    # The BREP surface types are only knowable from the BREP, so the operation-class check is
    # available exactly when both sides were handed in as shapes rather than as bare meshes.
    types_available = isinstance(reference, bd.Shape) and isinstance(candidate, bd.Shape)

    frame = check_frame_agreement(ref, cand)
    if require_frame_agreement and not frame.agree:
        raise FrameDisagreementError(
            f"{frame.message}. Editing outputs must stay in the input's coordinate frame "
            "(no canonical re-pose, no ICP) — re-export the candidate without moving it, "
            "or pass require_frame_agreement=False to diff a knowingly re-posed pair."
        )

    diagonal = mesh_bbox_diagonal(ref) or 1.0
    tol = CHANGE_TOLERANCE_RATIO * diagonal if change_tolerance is None else change_tolerance

    ref_pts = sample_surface(ref, n_samples, seed=0)
    cand_pts = sample_surface(cand, n_samples, seed=1)
    d_ref = _surface_distance(ref_pts, cand)
    d_cand = _surface_distance(cand_pts, ref)

    points = np.vstack([ref_pts, cand_pts]) if ref_pts.size and cand_pts.size else np.zeros((0, 3))
    distances = np.concatenate([d_ref, d_cand]) if points.size else np.zeros(0)

    changed = distances > tol
    changed_fraction = float(changed.mean()) if distances.size else 0.0
    if changed.any():
        moved = points[changed]
        changed_lo = tuple(float(x) for x in moved.min(axis=0))
        changed_hi = tuple(float(x) for x in moved.max(axis=0))
    else:
        changed_lo = None
        changed_hi = None

    vol_ref = abs(mesh_volume(ref))
    vol_cand = abs(mesh_volume(cand))
    betti_ref = _betti(ref)
    betti_cand = _betti(cand)

    if types_available:
        from cadtools.step_io import surface_type_histogram

        types_ref = surface_type_histogram(reference)  # type: ignore[arg-type]
        types_cand = surface_type_histogram(candidate)  # type: ignore[arg-type]
        destroyed, allowance, class_ok = surface_type_destruction(
            types_ref, types_cand, changed_fraction
        )
    else:
        types_ref, types_cand, destroyed, allowance, class_ok = {}, {}, {}, {}, True

    return DiffReport(
        max_distance=float(distances.max()) if distances.size else 0.0,
        mean_distance=float(distances.mean()) if distances.size else 0.0,
        change_tolerance=float(tol),
        changed_fraction=changed_fraction,
        changed_bbox_min=changed_lo,  # type: ignore[arg-type]
        changed_bbox_max=changed_hi,  # type: ignore[arg-type]
        volume_ref=vol_ref,
        volume_cand=vol_cand,
        volume_delta=vol_cand - vol_ref,
        volume_delta_fraction=(vol_cand - vol_ref) / vol_ref if vol_ref else 0.0,
        betti_ref=betti_ref,
        betti_cand=betti_cand,
        betti_delta=(
            betti_cand[0] - betti_ref[0],
            betti_cand[1] - betti_ref[1],
            betti_cand[2] - betti_ref[2],
        ),
        frame=frame,
        _points=points,
        _distances=distances,
        surface_types_ref=types_ref,
        surface_types_cand=types_cand,
        surface_types_destroyed=destroyed,
        surface_type_allowance=allowance,
        operation_class_ok=class_ok,
        surface_types_available=types_available,
        n_samples=n_samples,
    )


def diff_files(
    reference_path: str,
    candidate_path: str,
    require_frame_agreement: bool = True,
    n_samples: int = DEFAULT_SAMPLES,
) -> DiffReport:
    from cadtools.step_io import import_step_file

    return diff_shapes(
        import_step_file(reference_path),
        import_step_file(candidate_path),
        n_samples=n_samples,
        require_frame_agreement=require_frame_agreement,
    )


# --- volumetric intent (run-003 F-005 / abc_0352) ----------------------------------
#
# The failure this answers: a `thicken` candidate padded the target face with a box spanning
# the face's whole BOUNDING RECTANGLE instead of extruding the face's own profile. All three
# bbox extents matched the ground truth exactly — the agent's `report.json` recorded
# `intent: "pass (X extent 48.08 -> 60.1 mm, ...)"` — while the body carried +65.7% material
# nobody asked for. An extent-only intent check is STRUCTURALLY incapable of seeing that: a
# pad and a bloated pad reach the same extent. Volume can see it, and so can the cross-section
# the change actually swept.

#: Default tolerance for the intent checks, as a FRACTION of the expected quantity.
DEFAULT_INTENT_TOLERANCE = 0.02
#: Cells across the wider footprint axis are chosen from the changed-sample count so each
#: occupied cell holds several samples; these bound that choice.
MIN_FOOTPRINT_GRID = 8
MAX_FOOTPRINT_GRID = 64
#: Target samples per occupied footprint cell. Below this the grid reads as holes that are
#: only sampling noise; far above it the estimate is needlessly coarse.
FOOTPRINT_SAMPLES_PER_CELL = 8

_AXES = ("x", "y", "z")


@dataclass(frozen=True)
class VolumeIntent:
    """Did the edit add (or remove) the amount of material the instruction implies?

    `expected_delta` is the agent's own arithmetic — for a pad, ``face_area * depth``; for a
    pocket, minus the same. The check is the comparison the agent cannot fake by reading its
    script, because `measured_delta` comes from the meshed bodies.
    """

    expected_delta: float
    measured_delta: float
    absolute_error: float
    relative_error: float
    tolerance: float
    within_tolerance: bool
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "expected_delta": self.expected_delta,
            "measured_delta": self.measured_delta,
            "absolute_error": self.absolute_error,
            "relative_error": self.relative_error,
            "tolerance": self.tolerance,
            "within_tolerance": self.within_tolerance,
            "message": self.message,
        }


@dataclass(frozen=True)
class CrossSection:
    """The cross-section the change actually swept, versus the one it was meant to sweep.

    Two independent readings of the same question, because they fail differently:

    * ``implied_area`` = ``|volume_delta| / depth`` — exact for a prismatic add/remove, no
      sampling error, and the number that separates a face-profile sweep from a bounding-box
      sweep outright (304.0 mm^2 vs 2315.6 mm^2 on abc_0352).
    * ``footprint_area`` — the changed samples projected onto the plane perpendicular to the
      change axis and measured on an occupancy grid. An ESTIMATE (``grid`` records its
      resolution), but it sees SHAPE: ``fill_ratio`` near 1.0 means the change covered its own
      bounding rectangle, which is exactly what sweeping a bbox does.

    ``preserved`` is None when no ``target_face_area`` was supplied — the block is then a
    report, not a gate.
    """

    axis: str
    axis_source: str
    depth: float
    implied_area: float
    footprint_area: float
    bounding_rect_area: float
    fill_ratio: float
    grid: int
    changed_samples: int
    target_face_area: float | None
    area_ratio: float | None
    tolerance: float
    preserved: bool | None
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "axis": self.axis,
            "axis_source": self.axis_source,
            "depth": self.depth,
            "implied_area": self.implied_area,
            "footprint_area": self.footprint_area,
            "bounding_rect_area": self.bounding_rect_area,
            "fill_ratio": self.fill_ratio,
            "grid": self.grid,
            "changed_samples": self.changed_samples,
            "target_face_area": self.target_face_area,
            "area_ratio": self.area_ratio,
            "tolerance": self.tolerance,
            "preserved": self.preserved,
            "message": self.message,
        }


def check_volume_delta(
    report: DiffReport,
    expected_delta: float,
    tolerance: float = DEFAULT_INTENT_TOLERANCE,
) -> VolumeIntent:
    """Compare the measured volume change against the one the instruction implies.

    `tolerance` is a fraction of `expected_delta`. When the expectation is zero the fraction
    has no denominator, so the measured delta is compared against zero as a fraction of the
    reference volume instead — "this edit must not change the volume" stays checkable.
    """
    measured = report.volume_delta
    absolute_error = abs(measured - expected_delta)
    denominator = abs(expected_delta) if expected_delta else abs(report.volume_ref)
    relative_error = absolute_error / denominator if denominator else 0.0
    ok = relative_error <= tolerance
    if ok:
        message = (
            f"volume delta {measured:.4f} mm^3 matches the expected {expected_delta:.4f} mm^3 "
            f"(relative error {relative_error:.4%} <= {tolerance:.4%})"
        )
    else:
        message = (
            f"volume delta {measured:.4f} mm^3, expected {expected_delta:.4f} mm^3 — off by "
            f"{measured - expected_delta:+.4f} mm^3 ({relative_error:.4%} > {tolerance:.4%} "
            "tolerance). Identical bbox extents do not make this right: material outside the "
            "requested cross-section reaches the same extents"
        )
    return VolumeIntent(
        expected_delta=expected_delta,
        measured_delta=measured,
        absolute_error=absolute_error,
        relative_error=relative_error,
        tolerance=tolerance,
        within_tolerance=ok,
        message=message,
    )


def cross_section(
    report: DiffReport,
    axis: str | None = None,
    target_face_area: float | None = None,
    tolerance: float = DEFAULT_INTENT_TOLERANCE,
) -> CrossSection | None:
    """The changed region's footprint perpendicular to the change axis.

    Returns None when nothing changed (there is no region to describe) or when the changed
    region is degenerate along the chosen axis, which makes ``volume / depth`` meaningless.

    With no explicit `axis`, the axis is INFERRED as the thinnest extent of the changed
    region: an add/remove of depth `d` over a cross-section leaves a slab, and the slab's
    thinnest direction is the one it was swept along. Name the axis explicitly when the change
    is not slab-shaped.
    """
    changed = report._distances > report.change_tolerance
    if not bool(changed.any()):
        return None
    points = report._points[changed]
    lo = points.min(axis=0)
    hi = points.max(axis=0)
    extents = hi - lo

    if axis is None:
        index = int(np.argmin(extents))
        axis_source = "inferred-thinnest-changed-extent"
    else:
        if axis.lower() not in _AXES:
            raise ValueError(f"axis must be one of {_AXES}, got {axis!r}")
        index = _AXES.index(axis.lower())
        axis_source = "explicit"
    depth = float(extents[index])
    if depth <= 0.0:
        return None

    others = [i for i in range(3) if i != index]
    footprint_area, bounding_rect_area, grid = _footprint_area(
        points[:, others], lo[others], hi[others]
    )
    fill_ratio = footprint_area / bounding_rect_area if bounding_rect_area else 0.0
    implied_area = abs(report.volume_delta) / depth

    if target_face_area is None:
        area_ratio: float | None = None
        preserved: bool | None = None
        message = (
            f"changed region is {depth:.4f} mm deep along {_AXES[index]}; it sweeps "
            f"{implied_area:.4f} mm^2 of cross-section (sampled footprint "
            f"{footprint_area:.4f} mm^2, {fill_ratio:.2%} of its own bounding rectangle). "
            "Pass the target face area to gate this"
        )
    else:
        area_ratio = implied_area / target_face_area if target_face_area else 0.0
        preserved = abs(implied_area - target_face_area) <= tolerance * abs(target_face_area)
        if preserved:
            message = (
                f"the change sweeps {implied_area:.4f} mm^2, matching the target face "
                f"{target_face_area:.4f} mm^2 ({area_ratio:.4f}x)"
            )
        else:
            message = (
                f"the change sweeps {implied_area:.4f} mm^2 over a depth of {depth:.4f} mm, "
                f"but the target face is {target_face_area:.4f} mm^2 ({area_ratio:.4f}x it). "
                f"The sampled footprint fills {fill_ratio:.2%} of its own bounding rectangle"
                + (
                    " — that is the signature of sweeping the face's BOUNDING RECTANGLE "
                    "instead of its profile"
                    if fill_ratio > 0.95 and area_ratio > 1.0
                    else ""
                )
            )
    return CrossSection(
        axis=_AXES[index],
        axis_source=axis_source,
        depth=depth,
        implied_area=implied_area,
        footprint_area=footprint_area,
        bounding_rect_area=bounding_rect_area,
        fill_ratio=fill_ratio,
        grid=grid,
        changed_samples=int(points.shape[0]),
        target_face_area=target_face_area,
        area_ratio=area_ratio,
        tolerance=tolerance,
        preserved=preserved,
        message=message,
    )


def _footprint_area(
    projected: np.ndarray, lo: np.ndarray, hi: np.ndarray
) -> tuple[float, float, int]:
    """Occupancy-grid area of a 2-D point projection, with its bounding rectangle.

    Deliberately an ESTIMATE: boundary cells count in full, so the number is biased slightly
    high and must never be used as an exact area. Its job is the SHAPE question — does the
    changed region fill its own bounding rectangle, or only part of it?
    """
    span = hi - lo
    bounding_rect_area = float(span[0] * span[1])
    n = int(projected.shape[0])
    grid = int(round(math.sqrt(max(n, 1) / FOOTPRINT_SAMPLES_PER_CELL)))
    grid = max(MIN_FOOTPRINT_GRID, min(MAX_FOOTPRINT_GRID, grid))
    if span[0] <= 0 or span[1] <= 0:
        return 0.0, bounding_rect_area, grid
    cell = span / grid
    idx = np.floor((projected - lo) / cell).astype(np.int64)
    np.clip(idx, 0, grid - 1, out=idx)
    occupied = np.unique(idx[:, 0] * grid + idx[:, 1]).size
    return float(occupied * cell[0] * cell[1]), bounding_rect_area, grid


# --- helpers ----------------------------------------------------------------------


def _as_mesh(shape: bd.Shape | MeshData) -> MeshData:
    return shape if isinstance(shape, MeshData) else mesh_for_metrics(shape)


def _surface_distance(points: np.ndarray, target: MeshData) -> np.ndarray:
    """Distance from each point to the closest point on the target mesh's SURFACE.

    A thin alias for :func:`cadtools.proximity.surface_distances`, which owns the ONE
    byte-budgeted batching rule the differ and the scorer share (R6, then R8: the scorer had
    its own unchunked copy of the same query and was OOM-killed by it four times).
    """
    return surface_distances(points, target)


def _betti(mesh: MeshData) -> tuple[int, int, int]:
    # Local import: the Betti pipeline lives with the scorer (it is a scoring metric), and
    # the scorer imports this module's frame check. Importing here avoids the cycle.
    from cadtools.scoring import betti_numbers

    return betti_numbers(mesh)
