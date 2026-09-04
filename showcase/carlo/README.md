# CARlo — a CAR-bench agent built by the MutagenT lifecycle

**What it does.** CARlo is an in-car voice-assistant agent for CAR-bench (IJCAI-ECAI 2026,
Track 1). It answers driver requests — navigation, climate, media, vehicle controls — by calling
the benchmark's vehicle tool API under its behaviour policies. The deployed configuration is
deliberately minimal: schema-validated tool calls with in-turn retry, an inventory-grounded
capability check, five general behaviour rules, temperature 0 and high reasoning effort on
`gemini-3.5-flash` (Vertex AI). On the public 129-task training split it beats the raw-model
baseline (Pass^3 0.605 vs 0.566, identical harness both arms) at about $0.25 per episode.

This folder holds two things:

| Path | What |
|---|---|
| [`carlo/`](./carlo/) | The agent: TypeScript on bun, an A2A 1.0 server as the primary entrypoint, a thin Python bridge for local runs, the test suite and the docs. Its README covers requirements, configuration, run and verify. |
| [`.mutagent/`](./.mutagent/) | The ADL paper trail — spec, build report, evaluator verdicts, diagnostics and the cost ledger — committed as the toolchain wrote it. |

## Lifecycle stages covered

- ① **SPEC** — `.mutagent/specs/carlo/agentspec.yaml` (AgentSpec 0.3.0) and its decision log
  `agentspec.decisions.md`. The spec is the source of truth; the implementation points up to it.
- ② **BUILD** — `.mutagent/build/carlo/build-report.md`: the frozen plan, the fidelity table and
  the hermetic verify gates (lint, typecheck, mocked-backbone tests, bridge tests).
- ③ **EVALUATE** — `.mutagent/evaluator/`: the smoke verdicts (2026-08-25), two full-train runs
  (2026-08-25 and 2026-08-26) and the thinking-level ablation (2026-08-26). Final gate on the
  2026-08-26 run: **PASS**.
- ④ **DIAGNOSE** — `.mutagent/diagnostics/`: trace forensics on the smoke and train runs (base,
  hallucination and disambiguation findings) plus a mined competitor report.
- ⑤ **OPTIMIZE** — one full cycle. The original six-gate scaffold was convicted by the eval loop
  and retired in favour of the minimal arm; it stays in the codebase behind the default flag as
  the A/B arm.
- `.mutagent/costs/ledger.json` — token-accurate spend per run.

Not included: ⑥ SHIP and `traces/`. Per-task traces stay in the development project
(`CARLO_TRACE_DIR`), and the submission image is built from `carlo/Dockerfile` following the
organizers' instructions.

Not implied: the leaderboard comparison is self-evaluated on the public training split and is
indicative, not an official entry.

## How to run it

Requirements, every environment variable, and the verify gates are in
[`carlo/README.md`](./carlo/README.md). In short: bun 1.3+, Vertex AI access via
application-default credentials, and `GOOGLE_CLOUD_LOCATION=global` (the model resolves only
there).

```bash
cd carlo && bun install
CARLO_MINIMAL=1 GOOGLE_CLOUD_PROJECT=<project> GOOGLE_CLOUD_LOCATION=global bun run src/a2a/server.ts
```

## Last verified

2026-08-26, the full-train confirm run recorded in
`.mutagent/evaluator/train-2026-08-26/verdict.md` (129 tasks × 3 trials, gemini-3.5-flash on
Vertex). MutagenT: AgentSpec 0.3.0 via the Helix ADL skill bundle (agentspec · builder ·
evaluator · diagnostics).
