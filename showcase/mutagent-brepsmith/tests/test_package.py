"""T15 — submission packaging: the zip must match the packager's byte contract exactly."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from cadtools.package import (
    META_KEYS,
    SubmissionMeta,
    build_submission,
)


def _sample(root: Path, name: str, with_output: bool = True, filename: str = "output.step") -> Path:
    d = root / name
    d.mkdir(parents=True)
    if with_output:
        (d / filename).write_text("ISO-10303-21;\nENDSEC;\n")
    return d


@pytest.fixture
def meta() -> SubmissionMeta:
    return SubmissionMeta(
        submitter_name="Bruno",
        submission_name="mutagent-brepsmith v0.1.0",
        agent_url="https://example.invalid/mutagent-brepsmith",
        notes="harness-over-model-spend",
    )


def test_meta_json_keys_exact(tmp_path: Path, meta: SubmissionMeta) -> None:
    root = tmp_path / "samples"
    _sample(root, "201")
    out = tmp_path / "submission.zip"
    build_submission(root, out, meta)
    with zipfile.ZipFile(out) as zf:
        payload = json.loads(zf.read("meta.json"))
    assert set(payload) == set(META_KEYS)
    assert set(META_KEYS) == {
        "submitter_name",
        "submission_name",
        "agent_url",
        "notes",
        "agree_to_publish",
    }


def test_agree_to_publish_defaults_false(tmp_path: Path, meta: SubmissionMeta) -> None:
    """Publication consent is the operator's to give, so it defaults to false."""
    assert meta.agree_to_publish is False
    out = tmp_path / "s.zip"
    root = tmp_path / "samples"
    _sample(root, "201")
    build_submission(root, out, meta)
    with zipfile.ZipFile(out) as zf:
        assert json.loads(zf.read("meta.json"))["agree_to_publish"] is False


def test_notes_longer_than_500_chars_are_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="500"):
        SubmissionMeta(
            submitter_name="a",
            submission_name="b",
            agent_url="c",
            notes="x" * 501,
        )


def test_candidate_is_placed_at_the_sample_root(tmp_path: Path, meta: SubmissionMeta) -> None:
    root = tmp_path / "samples"
    _sample(root, "201")
    out = tmp_path / "s.zip"
    build_submission(root, out, meta)
    with zipfile.ZipFile(out) as zf:
        assert "201/output.step" in zf.namelist()


def test_stp_extension_is_accepted(tmp_path: Path, meta: SubmissionMeta) -> None:
    root = tmp_path / "samples"
    _sample(root, "201", filename="output.stp")
    out = tmp_path / "s.zip"
    report = build_submission(root, out, meta)
    assert report.n_present == 1
    with zipfile.ZipFile(out) as zf:
        assert "201/output.stp" in zf.namelist()


def test_missing_sample_dir_preserved_as_empty_entry(tmp_path: Path, meta: SubmissionMeta) -> None:
    """An explicit empty-dir entry keeps missing-output samples alive through extraction."""
    root = tmp_path / "samples"
    _sample(root, "201")
    _sample(root, "202", with_output=False)
    out = tmp_path / "s.zip"
    build_submission(root, out, meta)
    with zipfile.ZipFile(out) as zf:
        names = zf.namelist()
    assert "202/" in names
    assert not any(n.startswith("202/") and n != "202/" for n in names)


def test_no_placeholder_files_written(tmp_path: Path, meta: SubmissionMeta) -> None:
    """onFailure: report missing outputs; NEVER pad the archive with placeholders."""
    root = tmp_path / "samples"
    _sample(root, "202", with_output=False)
    out = tmp_path / "s.zip"
    build_submission(root, out, meta)
    with zipfile.ZipFile(out) as zf:
        payload_names = [n for n in zf.namelist() if n != "meta.json" and not n.endswith("/")]
    assert payload_names == []


def test_packing_report_lists_missing_samples(tmp_path: Path, meta: SubmissionMeta) -> None:
    root = tmp_path / "samples"
    _sample(root, "201")
    _sample(root, "202", with_output=False)
    _sample(root, "203", with_output=False)
    report = build_submission(root, tmp_path / "s.zip", meta)
    assert report.n_samples == 3
    assert report.n_present == 1
    assert report.missing == ["202", "203"]
    assert report.zip_path.endswith("s.zip")
    assert json.loads(json.dumps(report.to_dict()))["n_missing"] == 2


def test_report_path_is_relative(tmp_path: Path, meta: SubmissionMeta) -> None:
    root = tmp_path / "samples"
    _sample(root, "201")
    report = build_submission(root, tmp_path / "s.zip", meta, base=tmp_path)
    assert not Path(report.zip_path).is_absolute()


def test_empty_sample_root_is_an_error_not_an_empty_zip(
    tmp_path: Path, meta: SubmissionMeta
) -> None:
    root = tmp_path / "samples"
    root.mkdir()
    with pytest.raises(ValueError, match="no sample"):
        build_submission(root, tmp_path / "s.zip", meta)
