# CARlo (carlo) — decision log

Interview: 2026-08-24, `*spec` (mutagent-agentspec 0.3.0). Operator: Bruno.

## Goal: beat the raw-Flash baseline, not the frontier
**Decision:** Success = harnessed gemini-3.5-flash beats the raw gemini-3.5-flash Pass^3
baseline on all three task families, train + holdout, at well-below-frontier cost.
**Rejected:** "beat Opus/GPT-5" (welcome side effect, not the bar); "top-N leaderboard"
(outcome not controllable).
**Why:** Cleanest causal proof the scaffold adds value; cost was an explicit operator goal.

## Track 1 (Open), single configuration
**Decision:** Build for the IJCAI-ECAI 2026 Track 1 Docker/evaluator interface; local
run.py agent factory for development. Track 2 is a non-goal for v0.1.
**Rejected:** Track 2 (would force gpt-oss backbone); both-tracks (premature).

## Backbone: gemini-3.5-flash via Vertex AI
**Decision:** Operator-fixed backbone. Access through Google Vertex AI (gcloud ADC +
google-genai SDK Vertex mode), configured via env vars — matches the competition's
env-var-only provider rule. No fine-tuning; harness-only gains.
**Source:** operator statement + operator's Vertex/gcloud setup this session.

## The six-gate playbook with risk-triggered escalation
**Decision:** Ingest→feasibility→ambiguity→policy-precheck→arg-selfcheck→close, one
backbone call/step default, +1 verify pass only on flagged risk (state change,
ambiguity, capability doubt). Temperature 0 everywhere.
**Rejected:** always-verify (≈2x cost; deferred as an eval-loop experiment, not a spec
default).
**Why:** Each gate maps 1:1 to a scored CAR-bench reward component; Pass^3 punishes
variance, so consistency mechanisms are load-bearing.

## Conservative uncertainty posture (tunable)
**Decision:** When stuck after one clarifying exchange: defer/refuse honestly.
**Operator note:** "whatever performs best on the benchmark" — treat as a HYPOTHESIS the
eval loop may overturn, not dogma.

## Single agent, internal passes
**Decision:** kind: Agent. Gates are internal reasoning passes over one backbone, not
separate members.
**Rejected:** MultiAgent crew (more cost/variance/machinery; revisit only on plateau).

## Train/holdout discipline
**Decision:** Tune on the 129-task train split only; the 125-task public test split is a
milestone-only holdout proxying the hidden competition set. Tuning on it invalidates it.
**Rejected:** "use everything freely."

## Target: one Python core, two thin adapters
**Decision:** Python (car-bench native), `agent/` in this project; adapters for (a) local
run.py Agent factory, (b) the competition Docker wire contract (digest-pinned GHCR image).

## Open unknowns carried into BUILD
- Raw-Flash Pass^3 baseline per split — MEASURE FIRST (defines the success bar).
- Risk-triggered vs always-verify — eval-loop experiment.
- Conservative vs best-effort posture — eval-loop experiment.
- Competition deadlines — check car-bench-ijcai repo before submission planning.

## Stack switch: TypeScript + bun, A2A-primary (2026-08-24, post-PLAN)
**Decision:** Operator switched implementation to TypeScript on bun. The A2A 1.0 server
(the IJCAI Track 1 wire contract) is the PRIMARY artifact; a minimal Python bridge plugs
into run.py's custom-agent factory and forwards turns over HTTP for local dev/baseline/evals.
**Why:** The competition interface is language-agnostic Docker/A2A — nothing forces Python;
bun/TS matches the operator's tooling; the stock spec-impl-coverage gate reads TS natively
(dissolves plan question Q1). **Rejected:** Python core (original plan revision 1).

## Turn bound amended 40 → 50
**Decision:** maxIterations 50, matching every official competition scenario's max_steps=50.
Avoids self-truncation at turns 41–50. (Plan question Q2, operator-approved.)

## Harness installed from GitHub at build time
**Decision:** Clone CAR-bench into third_party/ now, commit pinned in the build report; the
build smoke proves the Python bridge against the REAL harness. EVALUATE needs the install
regardless. (Plan question Q4, operator-approved.)

## Vertex ADC pending
Build proceeds against a mocked backbone; operator will run
`gcloud auth application-default login` before any live run (probe found project
<gcp-project> configured, ADC absent). Re-probe before EVALUATE.
