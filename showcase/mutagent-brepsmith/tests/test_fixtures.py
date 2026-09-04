"""T16 — the generated fixtures reproduce the benchmark's own Betti table.

This is what makes the scoring assertions meaningful: our topology pipeline is pinned to
the documented worked examples, not to its own output.
"""

from __future__ import annotations

import socket

import build123d as bd
import pytest

from cadtools.mesh import tessellate
from cadtools.scoring import betti_numbers
from cadtools.validity import check_validity

DOC_BETTI_TABLE = {
    "box": (1, 0, 0),
    "plate_with_through_hole": (1, 1, 0),
    "plate_with_blind_pocket": (1, 0, 0),
    "two_disjoint_blocks": (2, 0, 0),
    "hollow_ball": (1, 0, 1),
}


@pytest.mark.parametrize("fixture_name,expected", sorted(DOC_BETTI_TABLE.items()))
def test_fixture_betti_numbers_match_doc_table(
    fixture_name: str, expected: tuple[int, int, int], request: pytest.FixtureRequest
) -> None:
    shape = request.getfixturevalue(fixture_name)
    assert betti_numbers(tessellate(shape)) == expected


def test_valid_fixtures_are_valid(
    box: bd.Solid,
    plate: bd.Solid,
    plate_with_through_hole: bd.Solid,
    plate_with_blind_pocket: bd.Solid,
    hollow_ball: bd.Solid,
    sliver_face_part: bd.Solid,
) -> None:
    for shape in (
        box,
        plate,
        plate_with_through_hole,
        plate_with_blind_pocket,
        hollow_ball,
        sliver_face_part,
    ):
        assert check_validity(shape).is_valid is True


def test_invalid_fixture_is_invalid(open_shell: bd.Shell) -> None:
    assert check_validity(open_shell).is_valid is False


def test_edit_pair_fixtures_differ(plate: bd.Solid, plate_with_corner_hole: bd.Solid) -> None:
    assert plate.volume > plate_with_corner_hole.volume


def test_no_test_touches_the_network() -> None:
    """The suite is offline by construction — the guard is real, not aspirational."""
    from conftest import NetworkAccessDenied

    with pytest.raises(NetworkAccessDenied):
        socket.create_connection(("huggingface.co", 443), timeout=1)
    with pytest.raises(NetworkAccessDenied):
        socket.socket().connect(("huggingface.co", 443))
