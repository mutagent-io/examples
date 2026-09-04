"""T14 — public dataset acquisition and editing-sample selection.

The spec's `benchmark-dataset` context binds the `hf download` CLI. `huggingface-cli` is
deprecated and no longer works, so the modern `hf` entry point (and its
`huggingface_hub.snapshot_download` Python equivalent, used here) is the binding.

**Selection keys on `description.yaml: task_type == "editing"`, never on the `2xx`
directory-name prefix.** The numeric prefix is a convention of the current revision; the
field is the contract. If a future revision renumbers, a prefix filter would silently change
which samples we run, and the change would show up only as an unexplained score movement.

**Failures are reported, never papered over.** A download failure yields
`status: "unavailable"` with the error text. A sample we cannot grade is recorded as
`unavailable` with a note. The SOP is explicit: never fabricate a ground truth.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from cadtools.manifest import SCHEMA_VERSION

REPO_ID = "HuggingAI4Engineering/cadgenbench-data"
REPO_TYPE = "dataset"
EDITING_TASK_TYPE = "editing"
DESCRIPTION_FILE = "description.yaml"
INPUT_STEP = "input.step"
INSTRUCTION_FILE = "edit_description.txt"

Downloader = Callable[..., str]


@dataclass(frozen=True)
class SampleRef:
    """One benchmark sample directory on disk."""

    sample_id: str
    directory: Path
    task_type: str
    description: str
    input_step: Path | None
    instruction: Path | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "sample_id": self.sample_id,
            "directory": str(self.directory),
            "task_type": self.task_type,
            "description": self.description,
            "input_step": str(self.input_step) if self.input_step else None,
            "instruction": str(self.instruction) if self.instruction else None,
        }


@dataclass(frozen=True)
class DownloadReport:
    status: str  # "ok" | "unavailable"
    repo_id: str
    local_dir: str | None
    n_editing_samples: int
    n_generation_samples: int
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "repo_id": self.repo_id,
            "local_dir": self.local_dir,
            "n_editing_samples": self.n_editing_samples,
            "n_generation_samples": self.n_generation_samples,
            "error": self.error,
        }


def _default_downloader(**kwargs: Any) -> str:
    from huggingface_hub import snapshot_download

    return str(snapshot_download(**kwargs))


def download_dataset(
    out_dir: str | Path,
    repo_id: str = REPO_ID,
    downloader: Downloader | None = None,
) -> DownloadReport:
    """Fetch the public dataset snapshot. A failure is DATA, not an exception."""
    target = Path(out_dir)
    fetch = downloader if downloader is not None else _default_downloader
    try:
        local = fetch(
            repo_id=repo_id,
            repo_type=REPO_TYPE,
            local_dir=str(target),
        )
    except Exception as exc:  # noqa: BLE001 - the failure is reported, never fabricated over
        return DownloadReport(
            status="unavailable",
            repo_id=repo_id,
            local_dir=None,
            n_editing_samples=0,
            n_generation_samples=0,
            error=str(exc),
        )
    root = Path(local)
    editing = select_editing_samples(root)
    generation = [s for s in _iter_samples(root) if s.task_type != EDITING_TASK_TYPE]
    return DownloadReport(
        status="ok",
        repo_id=repo_id,
        local_dir=str(root),
        n_editing_samples=len(editing),
        n_generation_samples=len(generation),
    )


def _iter_samples(root: str | Path) -> list[SampleRef]:
    base = Path(root)
    if not base.exists():
        return []
    samples: list[SampleRef] = []
    for description_file in sorted(base.glob(f"*/{DESCRIPTION_FILE}")):
        directory = description_file.parent
        try:
            meta = yaml.safe_load(description_file.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            continue  # an unreadable descriptor is skipped, never guessed at
        step = directory / INPUT_STEP
        instruction = directory / INSTRUCTION_FILE
        samples.append(
            SampleRef(
                sample_id=directory.name,
                directory=directory,
                task_type=str(meta.get("task_type", "")),
                description=str(meta.get("description", "")),
                input_step=step if step.exists() else None,
                instruction=instruction if instruction.exists() else None,
            )
        )
    return samples


def select_editing_samples(root: str | Path) -> list[SampleRef]:
    """Every sample whose `description.yaml` declares `task_type: editing`."""
    return [s for s in _iter_samples(root) if s.task_type == EDITING_TASK_TYPE]


def build_real_inputs_manifest(
    root: str | Path,
    base: str | Path | None = None,
) -> dict[str, Any]:
    """Manifest for the `real-inputs-proxy` slice: no ground truth, tier graded where possible."""
    from cadtools.complexity import grade_file

    anchor = Path(base) if base is not None else Path.cwd()
    items: list[dict[str, Any]] = []
    for sample in select_editing_samples(root):
        tier = "low"
        status = "ok"
        notes: str | None = None
        if sample.input_step is None:
            status = "unavailable"
            notes = "no input.step in the sample directory"
        else:
            try:
                tier = grade_file(sample.input_step).tier
            except Exception as exc:  # noqa: BLE001 - an ungradable sample is recorded as such
                status = "unavailable"
                notes = f"complexity grading failed: {exc}"
        items.append(
            {
                "id": sample.sample_id,
                "tier": tier,
                "edit_type": None,
                "instruction_style": None,
                "input_path": _relpath(sample.directory / INPUT_STEP, anchor),
                "instruction_path": _relpath(sample.directory / INSTRUCTION_FILE, anchor),
                # This slice has NO ground truth. Null is the honest value.
                "ground_truth_path": None,
                "status": status,
                "notes": notes,
            }
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "dataset_id": "real-inputs-proxy",
        "items": items,
    }


def _relpath(path: str | Path, base: Path) -> str:
    return Path(os.path.relpath(Path(path), base)).as_posix()
