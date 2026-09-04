# mutagent-brepsmith — a CAD-editing agent with deterministic verification

A Claude Code subagent that edits STEP CAD files from natural-language change requests,
verifying every edit with **code, not model self-assessment**. Built with
[MutagenT](https://mutagent.io)'s ADL loop (spec → build → evaluate → diagnose → optimize),
and evaluated on the [CadGenBench](https://github.com/huggingface/cadgenbench) editing task.

**Thesis:** a verification-loop harness on a cheaper model (claude-sonnet-5) beats the same
lab's frontier single-shot baseline at CAD editing.

## How it works

The agent (`.claude/agents/mutagent-brepsmith.md`) runs a fixed SOP per sample:

1. **Analyze** the input STEP (topology, dimensions, feature inventory) with `cadtools`.
2. **Plan** the edit and its quantitative acceptance criteria (expected volume delta,
   target face area, change axis).
3. **Implement** the edit as a build123d script.
4. **Verify with code** — never with model judgment:
   - validity gate aligned with the official grader (watertight manifold,
     `DEFLECTION_LADDER` retessellation),
   - locality diff (nothing outside the edit region moved),
   - surface-type conservation and frame agreement,
   - volumetric intent (`--expect-volume-delta`, cross-section discrimination).
5. **Iterate** up to 5 rounds — the budget is enforced by a code ledger
   (`cadtools round`), not by the model's memory.
6. **Emit** the best *valid* attempt. Validity zeroes every other score axis on the
   benchmark, so guaranteed-valid emission is the highest-leverage harness feature.

All checkers double as a local benchmark-parity scorer (`cadtools score`), validated
against the official `cadgenbench` package (validity verdict agreement 8/8, topology
exact, shape-score correlation 0.90–0.94).

## Quickstart

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/), plus the
[Claude Code](https://claude.com/claude-code) CLI.

```bash
cd showcase/mutagent-brepsmith
uv sync                      # installs cadtools + build123d/OCP toolchain
uv run pytest tests/ -q      # 210 deterministic geometry tests

# run the agent on a sample: a folder holding input.step + an instruction
claude  # then ask: "Use the mutagent-brepsmith agent on runs/my-sample/:
        #  <edit instruction>, emit output.step"
```

The agent discovers `cadtools` via `uv run python -m cadtools.cli ...` inside its
workspace; no other setup is needed.

## Results (editing task, 32 real benchmark samples)

- **Official validity 29/32 (0.906)** — measured with the official `cadgenbench`
  validity gate; ties the top HF baseline (Claude Fable 5). The 3 invalid outputs
  inherit their defects from the unmodified benchmark inputs (verified: the inputs
  fail the same gate) and survived 9 repair strategies.
- 25/32 samples converged in a single verification round; 2 used the full 5-round budget.
- Leaderboard submission (editing-only, Sonnet-5 arm) prepared; the Opus-5 arm and the
  generation task are the next phase.

## What is deliberately NOT here

The source tree is the minimal runnable agent; the ADL paper trail (spec, decisions,
build report, evaluator runs, diagnostics) is committed under `.mutagent/` per the showcase
convention. What stays in the development project: the complexity-graded practice dataset
with its ground-truth generator, the per-sample run workspaces (large binary STEP trees),
and the isolation audit that proves a scored run can never import the generator
(`cadtools_devtools` lives in a separate, never-installed distribution). Six test files
that exercise those dev-only assets are omitted here for the same reason.

## Lifecycle stages covered (ADL paper trail in `.mutagent/`)

- ① **SPEC**: validated agent card + decision log.. (`.mutagent/specs/cad-step-editor/`)
- ② **BUILD**: build report with plan, fidelity table and verifier verdict (same folder)
- ③ **EVALUATE**: `.mutagent/evaluator/` holds the synthetic-slice runs (run-001/003), the
  official-scorer parity study (parity-001), both scored benchmark runs (run-004 Sonnet-5 arm,
  editing 0.5059; run-005 Opus-5 xhigh arm, editing 0.6669, validity 32/32) and leaderboard intel.
  Official per-sample scores are committed as `official-result.json` per run.
- ④ **DIAGNOSE**: `.mutagent/diagnostics/` with findings F-001..F-017 and ranked remedy reports;
  run-005's report steered the +0.16 optimize cycle.
- ⑤ OPTIMIZE ran as one full cycle (run-004 -> diagnose -> run-005); ⑥ SHIP and `traces/` are not
  included: per-sample execution traces live in the working project's `runs/` tree (large binary
  STEP workspaces) and are not part of this snapshot.

Not implied: no eval-suite gate verdict beyond the benchmark scores above; the leaderboard entry is
submitted but not yet maintainer-validated.

## Environment

Requires the Claude Code CLI authenticated against Anthropic (interactive login, or
`ANTHROPIC_API_KEY` exported). No other environment variables are needed; all geometry checks run
locally.

**Last verified to run: 2026-08-28** (test suite 210 passing in this folder) against MutagenT
config v0.3.0.
