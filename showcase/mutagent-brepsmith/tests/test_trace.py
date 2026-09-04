"""T10 — the observability sink (dogfood F21): every run leaves discoverable evidence."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from cadtools.trace import TRACE_FILENAME, TraceSink, read_trace


@pytest.fixture
def sink(tmp_path: Path) -> TraceSink:
    return TraceSink(run_id="run-001", sample_id="201", root=tmp_path / "runs")


def test_round_appends_one_line(sink: TraceSink) -> None:
    sink.append("round", {"round": 1, "decision": "retry"})
    sink.append("round", {"round": 2, "decision": "emit"})
    assert len(sink.absolute_path.read_text().strip().splitlines()) == 2


def test_trace_path_is_relative(sink: TraceSink) -> None:
    """F21: the sink path recorded in reports must be relative, never absolute."""
    assert not os.path.isabs(sink.path)
    assert sink.path == str(Path("runs") / "run-001" / "201" / TRACE_FILENAME)


def test_trace_lines_are_valid_json(sink: TraceSink) -> None:
    sink.append("analyze", {"n_faces": 6})
    sink.append("verify", {"is_valid": True})
    for line in sink.absolute_path.read_text().strip().splitlines():
        payload = json.loads(line)
        assert set(payload) >= {"ts", "run_id", "sample_id", "event", "data"}


def test_read_trace_roundtrips(sink: TraceSink) -> None:
    sink.append("emit", {"path": "output.step"})
    events = read_trace(sink.absolute_path)
    assert len(events) == 1
    assert events[0]["event"] == "emit"
    assert events[0]["data"]["path"] == "output.step"


def test_sink_creates_its_directory(tmp_path: Path) -> None:
    s = TraceSink(run_id="r", sample_id="s", root=tmp_path / "deep" / "runs")
    s.append("start", {})
    assert s.absolute_path.exists()


def test_events_are_ordered_and_monotonic(sink: TraceSink) -> None:
    for i in range(5):
        sink.append("round", {"round": i})
    events = read_trace(sink.absolute_path)
    assert [e["data"]["round"] for e in events] == [0, 1, 2, 3, 4]
    assert [e["seq"] for e in events] == [0, 1, 2, 3, 4]


def test_artifact_paths_are_relative(sink: TraceSink) -> None:
    """Round artifacts (script, output, report) are addressed relative to the repo root."""
    assert not os.path.isabs(sink.artifact_path("output.step"))
    assert sink.artifact_path("output.step").endswith("runs/run-001/201/output.step")
