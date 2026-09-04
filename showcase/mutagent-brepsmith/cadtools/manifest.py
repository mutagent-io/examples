"""T13 — the dataset manifest schema and its validator.

The two manifest paths are taken VERBATIM from `spec.evaluation.datasets[].itemsRef`; if
they drift, the spec points at files that do not exist, so `tests/test_manifest.py` asserts
the equality against the spec file itself rather than against a copy of the strings.

BUILD ships the schema and the validator. The ITEMS are produced at run time — synthetic
triples by :mod:`cadtools.synthetic_pairs`, real inputs by :mod:`cadtools.dataset` — because
generating them needs either geometry work or a download, neither of which belongs in a
build gate.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import yaml

SYNTHETIC_MANIFEST = "datasets/synthetic-edit-pairs/manifest.yaml"
REAL_INPUTS_MANIFEST = "datasets/real-inputs-proxy/manifest.yaml"

# Case-dimension vocabularies, verbatim from spec.evaluation.datasets[].caseDimensions.
TIERS = ("low", "mid", "high")
EDIT_TYPES = (
    "dimension-change",
    "feature-add",
    "feature-remove",
    "pattern-change",
    "boolean-combine",
)
INSTRUCTION_STYLES = ("precise-quantitative", "colloquial", "terse")

SCHEMA_VERSION = 1


class ManifestValidationError(ValueError):
    """Raised when a manifest violates the schema. Never downgraded to a warning."""


@dataclass(frozen=True)
class ManifestItem:
    """One dataset item. `ground_truth_path` is None for the real-inputs proxy slice."""

    id: str
    tier: str
    edit_type: str | None
    instruction_style: str | None
    input_path: str
    instruction_path: str
    ground_truth_path: str | None
    status: str = "ok"
    notes: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def empty_manifest(dataset_id: str) -> dict[str, Any]:
    return {"schema_version": SCHEMA_VERSION, "dataset_id": dataset_id, "items": []}


def write_manifest(path: str | Path, dataset_id: str, items: list[ManifestItem]) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "items": [i.to_dict() for i in items],
    }
    p.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
    return p


def load_manifest(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        raise ManifestValidationError(f"manifest not found: {p}")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    if data is None:
        raise ManifestValidationError(f"manifest is empty: {p}")
    return data


def validate_manifest(manifest: dict[str, Any]) -> None:
    """Validate a loaded manifest. Raises :class:`ManifestValidationError` on any violation."""
    if not isinstance(manifest, dict):
        raise ManifestValidationError("manifest must be a mapping")
    for key in ("schema_version", "dataset_id", "items"):
        if key not in manifest:
            raise ManifestValidationError(f"manifest is missing required key: {key}")
    items = manifest["items"]
    if items is None:
        raise ManifestValidationError("items must be a list (use [] for an empty manifest)")
    if not isinstance(items, list):
        raise ManifestValidationError("items must be a list")

    seen: set[str] = set()
    for index, item in enumerate(items):
        where = f"items[{index}]"
        if not isinstance(item, dict):
            raise ManifestValidationError(f"{where} must be a mapping")
        for key in ("id", "tier", "input_path", "instruction_path", "ground_truth_path"):
            if key not in item:
                raise ManifestValidationError(f"{where} is missing required key: {key}")

        item_id = str(item["id"])
        if item_id in seen:
            raise ManifestValidationError(f"{where}: duplicate item id {item_id!r}")
        seen.add(item_id)

        if item["tier"] not in TIERS:
            raise ManifestValidationError(f"{where}: tier {item['tier']!r} is not one of {TIERS}")
        edit_type = item.get("edit_type")
        if edit_type is not None and edit_type not in EDIT_TYPES:
            raise ManifestValidationError(
                f"{where}: edit_type {edit_type!r} is not one of {EDIT_TYPES}"
            )
        style = item.get("instruction_style")
        if style is not None and style not in INSTRUCTION_STYLES:
            raise ManifestValidationError(
                f"{where}: instruction_style {style!r} is not one of {INSTRUCTION_STYLES}"
            )

        for key in ("input_path", "instruction_path", "ground_truth_path"):
            value = item.get(key)
            if value is None:
                continue  # ground_truth_path is legitimately null on the proxy slice
            if Path(str(value)).is_absolute():
                raise ManifestValidationError(
                    f"{where}: {key} must be a relative path, got {value!r}"
                )


def validate_manifest_file(path: str | Path) -> None:
    validate_manifest(load_manifest(path))
