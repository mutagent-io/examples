"""T20 — the entry doc is checked by a real runner, not by eye.

The plan originally carried a check reading "rendered links resolve", which is not something
a build gate can execute. It is replaced here by two checks that actually run: every CLI
subcommand is documented, and every relative link in the README resolves to a file on disk.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from cadtools.cli import SUBCOMMANDS

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


@pytest.fixture(scope="module")
def readme(repo_root: Path) -> Path:
    path = repo_root / "cadtools" / "README.md"
    assert path.exists()
    return path


def test_readme_lists_every_cli_subcommand(readme: Path) -> None:
    text = readme.read_text(encoding="utf-8")
    missing = [c for c in SUBCOMMANDS if f"`{c}`" not in text]
    assert missing == [], f"undocumented subcommands: {missing}"


def test_readme_documents_no_subcommand_that_does_not_exist(readme: Path) -> None:
    """A doc that promises a command the CLI does not have is worse than no doc."""
    table = [
        line for line in readme.read_text(encoding="utf-8").splitlines() if line.startswith("| `")
    ]
    documented = {line.split("`")[1] for line in table}
    invented = documented - set(SUBCOMMANDS) - _module_names()
    assert invented == set(), f"documented but nonexistent: {invented}"


def _module_names() -> set[str]:
    return {p.name for p in (Path(__file__).resolve().parents[1] / "cadtools").glob("*.py")}


def test_relative_links_resolve(readme: Path) -> None:
    """A real link runner: every relative markdown link must point at an existing file."""
    broken = []
    for target in LINK_RE.findall(readme.read_text(encoding="utf-8")):
        if target.startswith(("http://", "https://", "#")):
            continue
        if not (readme.parent / target.split("#")[0]).resolve().exists():
            broken.append(target)
    assert broken == [], f"broken relative links: {broken}"


def test_readme_records_the_scoring_caveats(readme: Path) -> None:
    """The proxy caveats must survive in the operator-facing doc, not only in the code."""
    text = readme.read_text(encoding="utf-8")
    assert "cad_score_proxy" in text
    assert "interface_available: false" in text
    assert "ICP" in text


def test_readme_documents_the_run_artifact_layout(readme: Path) -> None:
    text = readme.read_text(encoding="utf-8")
    for artifact in ("trace.jsonl", "ledger.json", "output.step", "runs/"):
        assert artifact in text


def test_readme_does_not_claim_to_own_the_mutagent_install(readme: Path) -> None:
    text = readme.read_text(encoding="utf-8")
    assert "CLAUDE.md" in text and "left alone" in text
