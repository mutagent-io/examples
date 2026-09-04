"""cadtools — deterministic CAD geometry checkers for the `mutagent-brepsmith` agent.

This package is the code half of the agent defined in `.claude/agents/mutagent-brepsmith.md`
and specified in the MutagenT AgentSpec (development workspace). The agent reaches it
through `Bash` as `python -m cadtools.cli <subcommand>` (target-conditional tool binding,
PR-004: a `harness:claude-code` target is CLI-first, not MCP).

The organising rule of the package: **verification is code, never a second opinion.** Every
module here answers a question about geometry by measuring it, and reports the measurement
plus the reason — never a bare verdict, because the agent's fix loop needs the locus of the
defect, not just its existence.

Import surface is deliberately lazy: `build123d` pulls in a large OpenCascade extension, so
submodules are imported on use rather than eagerly re-exported here. Import what you need::

    from cadtools.validity import check_validity_file
    from cadtools.scoring import score_editing_sample
"""

from __future__ import annotations

__version__ = "0.1.0"

#: Capability ids from `spec.capabilities.code[]`, mapped to their implementing modules.
#: The authoritative check is `scripts/check_coverage.py` (the PR-024 gate); this mapping is
#: for humans reading the package, and the gate is what fails a build.
CAPABILITY_MODULES: dict[str, str] = {
    "step-io": "cadtools.step_io",
    "validity-checker": "cadtools.validity",
    "geometry-differ": "cadtools.geometry_diff",
    "local-scorer": "cadtools.scoring",
    "complexity-grader": "cadtools.complexity",
    # NOT `cadtools.*`: the ground-truth generator ships in a SEPARATE distribution that an
    # eval profile does not install, so a scored run cannot import the answer key (F-003).
    # This entry names where the capability lives; it is not an invitation to install it.
    "synthetic-pair-generator": "cadtools_devtools.synthetic_pairs",
}

__all__ = ["CAPABILITY_MODULES", "__version__"]
