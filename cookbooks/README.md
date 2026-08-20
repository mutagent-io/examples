# Cookbooks — ready-to-run examples

**Each entry here is a short, self-contained example that runs as-is.** One task per entry, minimal
dependencies, copy-paste friendly.

Industry-convention naming (cf. the OpenAI and LangChain cookbooks): runnable reference code, not
test fixtures and not a framework.

Distinct from [`../showcase/`](../showcase/), which publishes complete agents alongside the ADL
artifacts that produced them. A showcase entry tells the story of one agent; a cookbook entry answers
one "how do I …?" in as few lines as possible.

## What belongs here

Recipes against the current MutagenT surface:

- **CLI** — `mutagent` workspaces, providers, agents, skills, install, hooks
- **SDKs** — the TypeScript SDK and the Python SDK
- **MCP** — driving MutagenT from an MCP client
- **Coding-agent hooks** — wiring MutagenT into Claude Code, Codex, or Pi sessions
- **ADL skills** — invoking a single lifecycle skill directly rather than through the conductor

What does *not* belong: anything targeting prompt management, the optimizer product surface, or
platform tracing. All three were retired in July 2026.

## Layout convention

```
cookbooks/<recipe-name>/
  README.md              The task, prerequisites, env vars, exact run command
  src/ | main.py         The code — small enough to read in one sitting
  package.json | pyproject.toml
```

Recipe names read as tasks, not products: `install-an-agent`, `stream-a-run`, `wire-claude-code-hooks`.

## What a cookbook README must state

- **The one task** the recipe performs.
- **Prerequisites** — runtime version, an account or key if one is needed.
- **Every environment variable**, with how to obtain each.
- **The exact command to run it**, and what correct output looks like.
- **When it was last verified to run**, and against which MutagenT version.

## Adding a recipe

1. Create `cookbooks/<recipe-name>/` with its own manifest — recipes are independent, with no
   shared lockfile or workspace.
2. Keep it to one task. Two tasks means two recipes.
3. Run it from a clean checkout before committing. A recipe that has not been run is not a recipe.
4. Never commit keys or customer data.
5. Add a row to the index below.

## Recipes

_None yet._ This folder is a scaffold — the repo's previous recipes targeted the retired tracing
surface and were removed. New recipes land here.

| Recipe | Task | Runtime | Last verified |
|---|---|---|---|
| — | — | — | — |
