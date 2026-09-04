"""T15 — submission packaging, mirroring the benchmark's own packager byte-for-byte.

Contract (from `docs/benchmark/submission.md` + `src/cadgenbench/baseline/package.py`):

* one directory per sample at the ZIP ROOT, containing the candidate and nothing else;
* the candidate filename is exactly `output.step` or `output.stp`;
* `meta.json` at the zip root with EXACTLY the keys `submitter_name`, `submission_name`,
  `agent_url`, `notes` (<= 500 chars), `agree_to_publish`;
* a sample with no candidate gets an EXPLICIT EMPTY DIRECTORY ENTRY, so it survives
  extraction and is graded as `status: "missing"` / `cad_score = 0` rather than vanishing.

Two deliberate refusals, both from the spec:

* `agree_to_publish` defaults to **false** — consent to publish is the operator's to give.
* a missing output is LISTED in the packing report and never padded with a placeholder file.
  A placeholder would turn an honest zero into an invalid submission.

Uploading is out of scope by design (`nonGoals`): this produces a zip and hands it over.
"""

from __future__ import annotations

import json
import os
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

META_KEYS: tuple[str, ...] = (
    "submitter_name",
    "submission_name",
    "agent_url",
    "notes",
    "agree_to_publish",
)
CANDIDATE_NAMES: tuple[str, ...] = ("output.step", "output.stp")
MAX_NOTES_CHARS = 500


@dataclass(frozen=True)
class SubmissionMeta:
    """The root `meta.json`. Exactly five keys — no more, no fewer."""

    submitter_name: str
    submission_name: str
    agent_url: str
    notes: str = ""
    agree_to_publish: bool = False

    def __post_init__(self) -> None:
        if len(self.notes) > MAX_NOTES_CHARS:
            raise ValueError(
                f"notes must be at most {MAX_NOTES_CHARS} characters (got {len(self.notes)})"
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "submitter_name": self.submitter_name,
            "submission_name": self.submission_name,
            "agent_url": self.agent_url,
            "notes": self.notes,
            "agree_to_publish": bool(self.agree_to_publish),
        }


@dataclass(frozen=True)
class PackingReport:
    """What went into the archive, and — more importantly — what did not."""

    zip_path: str
    n_samples: int
    n_present: int
    missing: list[str]

    @property
    def n_missing(self) -> int:
        return len(self.missing)

    def to_dict(self) -> dict[str, Any]:
        return {
            "zip_path": self.zip_path,
            "n_samples": self.n_samples,
            "n_present": self.n_present,
            "n_missing": self.n_missing,
            "missing": list(self.missing),
        }


def find_candidate(sample_dir: Path) -> Path | None:
    for name in CANDIDATE_NAMES:
        candidate = sample_dir / name
        if candidate.exists():
            return candidate
    return None


def build_submission(
    samples_root: str | Path,
    zip_path: str | Path,
    meta: SubmissionMeta,
    base: str | Path | None = None,
) -> PackingReport:
    """Assemble the submission archive and report exactly what is missing from it."""
    root = Path(samples_root)
    if not root.exists():
        raise ValueError(f"sample root does not exist: {root}")
    sample_dirs = sorted(d for d in root.iterdir() if d.is_dir())
    if not sample_dirs:
        raise ValueError(
            f"no sample directories under {root} — refusing to write an empty submission"
        )

    out = Path(zip_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    missing: list[str] = []
    present = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("meta.json", json.dumps(meta.to_dict(), indent=2) + "\n")
        for sample_dir in sample_dirs:
            candidate = find_candidate(sample_dir)
            if candidate is None:
                missing.append(sample_dir.name)
                # Explicit empty-directory entry: the sample must survive extraction so the
                # grader records it as `missing` rather than losing it silently.
                zf.writestr(zipfile.ZipInfo(f"{sample_dir.name}/"), b"")
                continue
            present += 1
            zf.write(candidate, f"{sample_dir.name}/{candidate.name}")

    anchor = Path(base) if base is not None else None
    reported_path = (
        Path(os.path.relpath(out, anchor)).as_posix() if anchor is not None else str(out)
    )
    return PackingReport(
        zip_path=reported_path,
        n_samples=len(sample_dirs),
        n_present=present,
        missing=missing,
    )
