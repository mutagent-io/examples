"""T2 — one deflection rule, one mesh representation shared by every metric."""

from __future__ import annotations

import build123d as bd
import numpy as np

from cadtools.mesh import (
    MeshData,
    bbox_diagonal,
    deflection_for_bbox,
    edge_triangle_counts,
    euler_characteristic,
    is_closed_mesh,
    is_manifold_mesh,
    is_orientation_consistent,
    tessellate,
)


def test_deflection_scales_with_bbox_diagonal() -> None:
    small = deflection_for_bbox(10.0)
    large = deflection_for_bbox(1000.0)
    assert 0 < small < large
    # deterministic + pure
    assert deflection_for_bbox(10.0) == small


def test_bbox_diagonal_of_unit_box(box: bd.Solid) -> None:
    d = bbox_diagonal(box)
    assert np.isclose(d, np.sqrt(3) * 10.0, rtol=1e-6)


def test_tessellate_returns_meshdata_with_arrays(box: bd.Solid) -> None:
    mesh = tessellate(box)
    assert isinstance(mesh, MeshData)
    assert mesh.vertices.ndim == 2 and mesh.vertices.shape[1] == 3
    assert mesh.faces.ndim == 2 and mesh.faces.shape[1] == 3
    assert mesh.faces.dtype.kind in "iu"
    assert len(mesh.faces) >= 12


def test_closed_box_mesh_is_closed_and_manifold(box: bd.Solid) -> None:
    mesh = tessellate(box)
    counts = edge_triangle_counts(mesh)
    assert all(c == 2 for c in counts.values()), "every edge must belong to exactly 2 triangles"
    assert is_manifold_mesh(mesh)
    assert is_closed_mesh(mesh)
    assert is_orientation_consistent(mesh)
    n_faces = len(mesh.faces)
    n_edges = len(counts)
    assert 3 * n_faces == 2 * n_edges


def test_open_shell_mesh_is_not_closed(open_shell: bd.Shell) -> None:
    mesh = tessellate(open_shell)
    assert not is_closed_mesh(mesh)
    assert 3 * len(mesh.faces) != 2 * len(edge_triangle_counts(mesh))


def test_euler_characteristic_of_a_box_is_two(box: bd.Solid) -> None:
    assert euler_characteristic(tessellate(box)) == 2


def test_euler_characteristic_of_a_torus_like_body(plate_with_through_hole: bd.Solid) -> None:
    # genus-1 closed surface -> chi = 0
    assert euler_characteristic(tessellate(plate_with_through_hole)) == 0


def test_tessellation_is_deterministic(box: bd.Solid) -> None:
    a = tessellate(box)
    b = tessellate(box)
    assert np.array_equal(a.faces, b.faces)
    assert np.allclose(a.vertices, b.vertices)


def test_mesh_welds_duplicate_vertices(box: bd.Solid) -> None:
    """Raw OCCT tessellation emits per-face vertex copies; metrics need a welded mesh."""
    mesh = tessellate(box)
    assert len(mesh.vertices) == 8, "a welded box mesh has exactly 8 unique vertices"
