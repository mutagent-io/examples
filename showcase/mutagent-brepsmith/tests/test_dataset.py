"""T14 — dataset acquisition and editing-sample selection. Offline: no live download here."""

from __future__ import annotations

from pathlib import Path

import yaml

from cadtools.dataset import (
    REPO_ID,
    build_real_inputs_manifest,
    download_dataset,
    select_editing_samples,
)
from cadtools.manifest import validate_manifest


def _make_sample(root: Path, sample_id: str, task_type: str) -> Path:
    d = root / sample_id
    d.mkdir(parents=True)
    (d / "description.yaml").write_text(
        yaml.safe_dump(
            {
                "description": f"sample {sample_id}",
                "task_type": task_type,
                "input_files": ["input.step"] if task_type == "editing" else [],
                "input_type": "text+step",
            }
        )
    )
    if task_type == "editing":
        (d / "input.step").write_text("ISO-10303-21;\nENDSEC;\n")
        (d / "edit_description.txt").write_text("make the hole bigger\n")
    return d


def test_editing_filter_uses_task_type(tmp_path: Path) -> None:
    """Selection keys on description.yaml task_type, NOT on the 2xx directory-name prefix.

    A dataset revision that renumbers its directories must not silently change which samples
    we run.
    """
    _make_sample(tmp_path, "101", "generation")
    _make_sample(tmp_path, "201", "editing")
    _make_sample(tmp_path, "999", "editing")  # editing, despite not being a 2xx id
    selected = select_editing_samples(tmp_path)
    assert sorted(s.sample_id for s in selected) == ["201", "999"]


def test_generation_samples_are_excluded(tmp_path: Path) -> None:
    _make_sample(tmp_path, "101", "generation")
    _make_sample(tmp_path, "102", "generation")
    assert select_editing_samples(tmp_path) == []


def test_samples_without_description_are_skipped_not_guessed(tmp_path: Path) -> None:
    (tmp_path / "300").mkdir()
    _make_sample(tmp_path, "201", "editing")
    assert [s.sample_id for s in select_editing_samples(tmp_path)] == ["201"]


def test_download_failure_is_reported_not_fabricated(tmp_path: Path) -> None:
    """SOP `build-dev-dataset` onFailure: report per file; NEVER fabricate a ground truth."""

    def broken_downloader(**kwargs: object) -> str:
        raise RuntimeError("network unreachable")

    report = download_dataset(tmp_path / "data", downloader=broken_downloader)
    assert report.status == "unavailable"
    assert "network unreachable" in report.error
    assert report.local_dir is None
    assert report.n_editing_samples == 0


def test_successful_download_reports_the_editing_sample_count(tmp_path: Path) -> None:
    data_root = tmp_path / "data"

    def fake_downloader(**kwargs: object) -> str:
        _make_sample(data_root, "101", "generation")
        _make_sample(data_root, "201", "editing")
        return str(data_root)

    report = download_dataset(data_root, downloader=fake_downloader)
    assert report.status == "ok"
    assert report.n_editing_samples == 1
    assert report.n_generation_samples == 1


def test_real_inputs_manifest_has_null_ground_truth(tmp_path: Path) -> None:
    _make_sample(tmp_path, "201", "editing")
    _make_sample(tmp_path, "202", "editing")
    manifest = build_real_inputs_manifest(tmp_path, base=tmp_path)
    validate_manifest(manifest)
    assert manifest["dataset_id"] == "real-inputs-proxy"
    assert len(manifest["items"]) == 2
    assert all(item["ground_truth_path"] is None for item in manifest["items"])
    assert all(not Path(item["input_path"]).is_absolute() for item in manifest["items"])


def test_manifest_records_ungradable_samples_as_unavailable(tmp_path: Path) -> None:
    """The stub STEP files here cannot be graded; that is recorded, not silently defaulted."""
    _make_sample(tmp_path, "201", "editing")
    manifest = build_real_inputs_manifest(tmp_path, base=tmp_path)
    item = manifest["items"][0]
    assert item["status"] == "unavailable"
    assert item["notes"]
