"""Test path setup: the bridge module plus the harness repo root (run.py lives there, not in the
installed package)."""

import pathlib
import sys

BRIDGE = pathlib.Path(__file__).resolve().parent
HARNESS = BRIDGE.parent / "third_party" / "car-bench"

for path in (BRIDGE, HARNESS):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
