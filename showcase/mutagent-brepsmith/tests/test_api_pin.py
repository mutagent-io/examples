"""T17 — build123d API pin smoke.

The plan was written against build123d docs v0.11.2 while the resolver pins a
possibly-older wheel (Risk R1). This test asserts, by name, the exact surface the
rest of the scaffold relies on, so an upgrade/downgrade breaks loudly at BUILD.
"""

from __future__ import annotations

import inspect

import build123d as bd


def test_documented_top_level_symbols_exist() -> None:
    for symbol in ("import_step", "export_step", "import_brep", "export_stl", "Mesher"):
        assert hasattr(bd, symbol), f"build123d.{symbol} is missing on the pinned wheel"


def test_shape_is_valid_is_a_bool_property() -> None:
    box = bd.Solid.make_box(1, 1, 1)
    assert isinstance(box.is_valid, bool)


def test_tessellate_accepts_tolerance_and_angular_tolerance() -> None:
    sig = inspect.signature(bd.Shape.tessellate)
    assert "tolerance" in sig.parameters
    assert "angular_tolerance" in sig.parameters
    verts, tris = bd.Solid.make_box(1, 1, 1).tessellate(0.05, 0.1)
    assert len(verts) >= 8
    assert len(tris) >= 12
    assert len(tris[0]) == 3


def test_bounding_box_accepts_optimal_kwarg() -> None:
    bbox = bd.Solid.make_box(2, 3, 4).bounding_box(optimal=True)
    assert bbox.size.X > 0 and bbox.size.Y > 0 and bbox.size.Z > 0


def test_topology_accessors_exist() -> None:
    box = bd.Solid.make_box(1, 1, 1)
    assert len(box.solids()) == 1
    assert len(box.faces()) == 6
    assert len(box.edges()) == 12
    assert box.faces()[0].geom_type is not None
    assert box.volume > 0
    assert box.area > 0
