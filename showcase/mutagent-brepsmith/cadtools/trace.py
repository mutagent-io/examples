"""T10 — the observability sink (dogfood F21).

Without a discoverable, machine-readable record of what the agent did, the EVALUATE and
DIAGNOSE stages have nothing to read: they would be reduced to re-running the agent and
believing its narration. So every round appends one JSON line carrying the inputs it saw,
the script it generated, that script's stdout/stderr, the verification report, and the
decision it took. This also satisfies the spec's `execute-cad-edit-code` evidence clause.

Layout (relative to the repository root — NEVER an absolute path)::

    runs/<run-id>/<sample-id>/trace.jsonl   # one JSON object per line, append-only
    runs/<run-id>/<sample-id>/output.step   # the emitted candidate
    runs/<run-id>/<sample-id>/report.json   # the final verification report
    runs/<run-id>/<sample-id>/round-<n>.py  # the generated build123d script per round

Line contract (one object per line, newline-delimited)::

    {"ts": <iso8601-utc>, "seq": <int>, "run_id": <str>, "sample_id": <str>,
     "event": <str>, "data": {...}}

`seq` is a per-sink monotonic counter, so the ordering survives even if two events land in
the same clock tick.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

TRACE_FILENAME = "trace.jsonl"
DEFAULT_ROOT = "runs"


class TraceSink:
    """Append-only JSONL sink for one (run, sample) pair."""

    def __init__(
        self,
        run_id: str,
        sample_id: str,
        root: str | Path = DEFAULT_ROOT,
        repo_root: str | Path | None = None,
    ) -> None:
        self.run_id = run_id
        self.sample_id = sample_id
        self._root = Path(root)
        self._repo_root = Path(repo_root) if repo_root is not None else Path.cwd()
        self._seq = 0

    # --- paths ---------------------------------------------------------------

    @property
    def directory(self) -> Path:
        return self._root / self.run_id / self.sample_id

    @property
    def absolute_path(self) -> Path:
        return self.directory / TRACE_FILENAME

    @property
    def path(self) -> str:
        """The sink path as it must appear in reports: RELATIVE, POSIX-style."""
        return self._relative(self.absolute_path)

    def artifact_path(self, name: str) -> str:
        """Relative path of a sibling artifact (output.step, report.json, round-1.py)."""
        return self._relative(self.directory / name)

    def _relative(self, path: Path) -> str:
        try:
            return (
                path.relative_to(self._repo_root).as_posix()
                if path.is_absolute()
                else path.as_posix()
            )
        except ValueError:
            # The sink lives outside the repo (a tmp dir in tests): keep the tail, which is
            # still relative — an absolute path must never reach a report.
            parts = path.parts
            anchor = parts.index(self._root.name) if self._root.name in parts else -3
            return Path(*parts[anchor:]).as_posix()

    # --- writing -------------------------------------------------------------

    def append(self, event: str, data: dict[str, Any]) -> dict[str, Any]:
        """Append one event. Returns the record that was written."""
        record = {
            "ts": datetime.now(UTC).isoformat(),
            "seq": self._seq,
            "run_id": self.run_id,
            "sample_id": self.sample_id,
            "event": event,
            "data": data,
        }
        self._seq += 1
        self.directory.mkdir(parents=True, exist_ok=True)
        with self.absolute_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, default=str) + "\n")
        return record

    def write_artifact(self, name: str, content: str) -> str:
        """Write a sibling artifact and return its RELATIVE path."""
        self.directory.mkdir(parents=True, exist_ok=True)
        (self.directory / name).write_text(content, encoding="utf-8")
        return self.artifact_path(name)


def read_trace(path: str | Path) -> list[dict[str, Any]]:
    """Read a trace back. Malformed lines are skipped, never silently 'repaired'."""
    p = Path(path)
    if not p.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def iter_run_traces(root: str | Path = DEFAULT_ROOT, run_id: str | None = None) -> Iterable[Path]:
    """Discover every trace file under `runs/`, so EVALUATE can find them without config."""
    base = Path(root) / run_id if run_id else Path(root)
    if not base.exists():
        return []
    return sorted(base.rglob(TRACE_FILENAME))


def is_relative_path(path: str) -> bool:
    return not os.path.isabs(path)
