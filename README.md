# MutagenT Examples

**This repo showcases agents built with MutagenT — and preserves the artifacts they were built from.**

MutagenT conducts the Agentic Development Lifecycle (ADL): **spec → build → evaluate → diagnose →
optimize → ship**. Every stage produces artifacts — an `agentspec.yaml`, a build report, an eval
suite and its verdict, a diagnostics report. Those artifacts are the interesting part: they show
*how* an agent came to be, not just what it ended up as. This repo keeps them next to the agents
they produced.

## Two folders

| Folder | Holds | Read it when |
|---|---|---|
| [`showcase/`](showcase/) | **Built agents + their ADL artifacts.** `showcase/<agent-name>/` is the agent's source tree; MutagenT's own artifacts — spec, build report, eval runs and verdict, diagnostics, traces — sit under `showcase/<agent-name>/.mutagent/`. | You want to see what a finished, evaluated agent looks like end to end. |
| [`cookbooks/`](cookbooks/) | **Ready-to-run examples.** Short, self-contained recipes for one task each — CLI, SDKs, MCP, hooks. | You want working code you can copy and run in minutes. |

Each folder has its own `README.md` with the layout convention and how to add an entry.

## Getting MutagenT

The ADL skill bundle installs into your own project, not into this repo:

```bash
pnpx @mutagent/helix init      # installs the lifecycle skills into <your project>/.claude
```

Then boot the conductor in your coding agent:

```
claude   →   *mutagent
```

> `@mutagent/helix` is not on the public npm registry yet. Until it publishes, the individual
> lifecycle stages are available on their own — `@mutagent/evaluator` for EVALUATE and
> `@mutagent/diagnostics` for DIAGNOSE — alongside the `@mutagent/cli`.

## Status

**Both folders are empty scaffolds today.** The layout conventions are settled and documented —
what is missing is the entries, and those are landing now.

Earlier versions of this repo carried examples for product surfaces that have since been retired.
Rather than leave them as code that no longer runs against anything, they were removed. What you see
here is the structure the new entries are being written into.

## Requirements

Per-entry. Each showcase and cookbook entry declares its own runtime, dependencies, and environment
variables in its own README — there is no repo-wide toolchain to install.
