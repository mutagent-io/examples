# Contributing

Thanks for looking. This repository holds two kinds of entry, and they have different bars.

- **`cookbooks/<recipe-name>/`** — a short, self-contained example that answers one "how do I …?"
  and runs as-is.
- **`showcase/<agent-name>/`** — a complete agent, published together with the MutagenT artifacts
  that produced it.

Each folder's own `README.md` is the authority on its layout convention and on what its entry
READMEs must state. Read the target folder's README before you write anything into it.

## The bar for any entry

1. **Run what you commit.** An example that has not been run is not an example. If you could not run
   it, say so plainly in its README rather than implying it works.
2. **Record when you last verified it**, and against which MutagenT version.
3. **Keep entries independent.** No workspace, no shared lockfile, no repo-wide toolchain. Every
   entry declares its own runtime, dependencies, and environment variables, so a broken entry never
   breaks its neighbours and a reader can copy one folder out and run it.
4. **Update the folder's index table** in the same pull request.

## Never commit

- API keys, tokens, or any other credential. `.env` is gitignored; keep it that way.
- Customer data, real names, or real documents.
- Private infrastructure URLs.

## Showcase artifacts need extra care

A showcase entry commits its `.mutagent/` directory — the spec, the build report, the eval runs and
verdict, the diagnostics reports, and the traces. That is the point of the folder: the paper trail is
what makes one entry comparable to the next.

It is also the highest-risk content in this repository. **Stage reports and traces quote their real
inputs verbatim.** Before you commit an artifact set, read it — particularly everything under
`.mutagent/traces/` and `.mutagent/diagnostics/`.

Two rules follow from that:

- **Artifacts are published exactly as the toolchain wrote them.** Do not reformat them, do not
  hand-invent paths, and do not flatten them up into the source tree.
- **If an artifact contains something that should not be public, fix it at the source** — in the run,
  or in the toolchain that produced it — and regenerate. Editing a published artifact to make it pass
  makes the public copy a lie about what actually happened.

## Automated checks

Every push and pull request runs:

- `node scripts/public-scrub/sweep.mjs .` — a deterministic scan for internal references,
  client identities, and credential shapes. `scripts/public-scrub/sweep-rules.mjs` holds the
  patterns; its denylist is base64-encoded so the file can pass its own gate.
- **gitleaks**, over the full history as well as the working tree.

Both must be green. If the sweep flags your entry, read the file and line it names — it prints
both — and fix the source.

## Pull requests

Open one PR per entry. Every PR needs an approving review from a code owner before it can merge, and
`main` requires linear history, so rebase rather than merge if your branch falls behind.

## Security

Do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE) that covers this repository.
