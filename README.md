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

### Standalone binary — no Node, no npm

The fastest path. Ships the Helix conductor, the lifecycle skills, and a bundled harness as
one self-contained binary.

```bash
curl -fsSL https://install.mutagent.io/helix | bash
mutagent-helix                       # launch
```

Verify the install:

```bash
mutagent-helix --version
mutagent-helix doctor --strict
```

An Oh My Pi flavour is published alongside it:

```bash
curl -fsSL https://install.mutagent.io/helix-omp | bash
```

### Into an existing coding agent

If you already work in Claude Code and want the lifecycle skills in your project:

```bash
pnpx @mutagent/helix init            # into <your project>/.claude
pnpx @mutagent/helix init --global   # ... or into ~/.claude
pnpx @mutagent/helix doctor          # report what is installed
```

Then boot the conductor:

```
claude   →   *mutagent
```

> **Availability.** The binary above is live now. `@mutagent/helix` is not on the public npm
> registry yet — until it lands, use the binary, or install the stages that are already
> published: `@mutagent/evaluator`, `@mutagent/diagnostics`, and `@mutagent/cli`.

## Status

`showcase/` has its first entry — [`freecad-engineer`](showcase/freecad-engineer/), a
self-verifying FreeCAD CAD agent, published with the spec it was built from, its build report,
its evaluation runs and scorecard, and its diagnostics reports. `cookbooks/` is still a
scaffold; recipes land there next.

## Requirements

Per-entry. Each showcase and cookbook entry declares its own runtime, dependencies, and environment
variables in its own README — there is no repo-wide toolchain to install.
