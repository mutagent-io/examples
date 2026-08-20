# Showcase — agents built with MutagenT

**Each entry here is a finished agent that MutagenT built, published together with the ADL artifacts
that produced it.**

The point of a showcase entry is not just the agent — it's the *paper trail*. A reader should be able
to follow the whole lifecycle: what was specified, what was built from that spec, how it was
evaluated, what the verdict was, and what got diagnosed and fixed along the way. Preserving those
artifacts is a first-class purpose of this folder.

Distinct from [`../cookbooks/`](../cookbooks/), which holds short single-task recipes. A cookbook
entry teaches one API call; a showcase entry shows one complete agent and its history.

## Layout convention

**`showcase/<agent-name>/` is the agent's source tree. MutagenT's own artifacts live under
`showcase/<agent-name>/.mutagent/`.** Read the folder and you see a normal project; open `.mutagent/`
and you see how it was built.

```
showcase/<agent-name>/
  README.md                        What it does, how it was built, how to run it
  src/ …                           The agent's source — laid out however its framework dictates
  package.json | pyproject.toml    Its own manifest; entries are independent

  .mutagent/                       MutagenT's artifacts, stage-namespaced
    config.yaml
    specs/<name>/agentspec.yaml    ① SPEC   — the validated spec it was built from
    specs/<name>/build-report.md   ② BUILD  — what the builder did
    simulatte/runs/                          simulated runs
    evaluator/runs/ · reports/     ③ EVALUATE — criteria, scores, gate verdict
    diagnostics/reports/           ④ DIAGNOSE — root causes and ranked remedies
    ship/runs/                     ⑥ SHIP
    traces/                                  the evidence the stages ran on
```

Do not flatten artifacts up into the source tree, and do not hand-invent paths — commit `.mutagent/`
as the toolchain wrote it. That is what makes one entry comparable to the next.

Everything under `.mutagent/` is optional: an agent that never reached EVALUATE simply has no
`evaluator/`. Say so in the README rather than shipping an empty folder.

`.mutagent/` is normally gitignored in a working project. Here it is committed on purpose —
preserving it is the point of the folder. That makes scrubbing non-optional: traces and reports quote
real inputs.

## What a showcase README must state

- **What the agent does** — one paragraph, no internal shorthand.
- **Which stages it went through** — and which it did not. Do not imply an eval verdict that
  does not exist.
- **How to run it**, including every environment variable it needs.
- **When it was last verified to run**, and against which MutagenT version. An unverified agent
  should say so explicitly.

## Adding a showcase entry

1. Build the agent with MutagenT (`*mutagent`, or the individual lifecycle skills) in whatever
   project owns it — not here.
2. Copy the project into `showcase/<agent-name>/`: source tree at the top level, and its `.mutagent/`
   directory along with it, structure intact.
3. Scrub secrets and customer data before committing — API keys, real names, real documents. Pay
   particular attention to `.mutagent/traces/` and the stage reports, which quote real inputs
   verbatim. See the repo `.gitignore` for the patterns already excluded.
4. Write the README against the checklist above.
5. Add a row to the index below.

## Entries

| Agent | What it does | Stages covered | Last verified |
|---|---|---|---|
| [`freecad-engineer`](./freecad-engineer/) | Self-verifying mechanical-CAD agent (Claude Code + Opus 5, single-file definition) that writes parametric FreeCAD PartDesign scripts from natural-language part specs | SPEC · BUILD (verify) · EVALUATE · DIAGNOSE | 2026-08-19 |
