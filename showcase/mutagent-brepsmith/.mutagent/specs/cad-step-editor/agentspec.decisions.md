# cad-step-editor — decision log

> Sidecar to `agentspec.yaml` (spec.decisionsRef). Records consequential interview decisions,
> their rationale, and rejected alternatives. Interview: 2026-08-24, *spec (Helix ① SPEC).

## Phase 1 scope: EDITING task only
Operator decision. CadGenBench has two tasks (Generation from drawing · Editing of a STEP file).
Phase 1 targets editing only; drawing interpretation is an explicit nonGoal deferred to phase 2.
The editing task supplies real STEP files usable for complexity grading and dataset construction.

## Thesis: harness > model spend (model pinned to claude-sonnet-5)
The benchmark claim is that a verification-loop harness on a CHEAPER model beats the same
model's raw baseline (stretch: the leaderboard top). Sonnet-5 chosen over Haiku (geometry
reasoning risk) and over deciding-later (extra eval round). The baseline may have to be produced
in-house as a single-shot run — recorded as an unknown.
Rejected: most-capable model (would undercut the thesis).

## CAD toolchain: build123d
Modern code-CAD on the OpenCascade kernel; native STEP round-trip; pip/uv installable;
code-first fits an agent that writes and re-runs scripts.
Rejected: CadQuery (stiffer API for BREP surgery on imports), raw pythonOCC (verbose,
error-prone for an LLM), FreeCAD (heavyweight, slow iteration).

## Full deterministic verify loop, budget 5 rounds
After each edit: re-import → validity gate (watertight manifold) → locality diff → quantitative
intent check; iterate ≤5 rounds; always emit the best VALID attempt. Grounded in the benchmark's
scoring: validity is a gate that zeroes all other components, so guaranteed-valid emission is
the highest-leverage harness feature.
Rejected: validity-only (leaves shape/topology errors uncaught), single-shot (measures the raw
model, undercuts the thesis), unbounded loop (cost risk), LLM verifier (non-reproducible,
2× cost — verification is code, per operator).

## Structure: one agent + deterministic checkers
Single CAD-engineer agent; all verification is scripted geometry code that doubles as the local
benchmark scorer. Rejected: LLM-verifier subagent, planner/coder/verifier pipeline (attribution
of wins gets murky; more build surface).

## Dev dataset: synthetic edit pairs (ground-truth ownership)
Benchmark ground truth is private, so the dev set is built by programmatically applying KNOWN
edits to complexity-graded public STEPs → full (input, instruction, ground-truth output)
triples with benchmark-parity local scoring (validity · surface · volume IoU · Betti).
A second, proxy-scored slice of real benchmark inputs serves as pre-submission check.
Complexity grading is deterministic (face/edge/solid counts, surface variety, feature density,
genus) and stratifies both slices.

## Autonomy boundary: everything local; the operator submits
The agent runs Python, reads/writes the workspace, downloads the public HF dataset, and
packages the submission zip autonomously. Uploading to the leaderboard Space is exclusively a
human act (also a nonGoal). Rejected: no-network (needless friction), auto-submission
(irreversible outward action).

## Kind: Agent · operatingType: automation · target: harness claude-code (markdown)
One autonomous subject with a persona and operative prompt; runs one-shot end-to-end per
sample/batch; realized as a Claude Code agent-markdown definition with project-local Python
modules for the deterministic checkers. Chosen after the capability inventory (code checkers,
no skills, no delegates) per the intent-first ordering.

## Dataset sourcing: public real parts preferred over synthetic (operator, 2026-08-24, post-BUILD)
Operator direction at dataset-build time: source additional PUBLIC STEP data of complexity
comparable to the benchmark inputs and PREFER/WEIGHT it above purely synthetic constructions.
Edits are still applied programmatically (ground truth stays ours — unchanged), but the input
parts should be real-world models wherever possible; synthetic-from-primitives only fills
coverage gaps the public pool cannot. Complexity matching against the benchmark's graded
distribution decides admission. Spec's dataset section to be reconciled on next card touch
(*sync-spec) — recorded here so the card's evolution stays auditable.

## Two-stage model strategy: dev on Sonnet, final on Opus 5 xhigh (operator, 2026-08-24)
Leaderboard recon showed all serious entries are single-shot model baselines (top: Claude
Fable 5 baseline, 0.4514; validity even at the top only 96.3%). Operator direction: develop
and iterate on claude-sonnet-5 (cheap), then switch the SAME harness to claude-opus-5 at
extra-high reasoning effort for the max-performance submission run. Supersedes 's single-pin
partially: the harness-beats-baseline thesis claim stays anchored to the Sonnet arm (harness
vs own single-shot baseline, same model); the leaderboard-top attempt runs the Opus arm.
Two submissions planned from one harness; model is a frontmatter-level swap, thresholds and
checkers are model-independent. Spec constraint line to be reconciled on next card touch.

## Remodel-first gated strategy + stage budgets (operator, 2026-08-28)
Operator direction after the run-004/run-005 score autopsy (validity solved; interpretation
and shape mechanics are the residual gap; leaderboard leader plausibly remodel-based).
The agent gains a PREFERRED remodel-first path: parametrically reconstruct the part (or,
middle option, only the affected feature region) in build123d code, gated by a deterministic
fidelity check BEFORE any edit — Hausdorff distance (chunked closest-point, both directions),
volume agreement, Betti match; surface-type histogram is advisory. Only a gate-passing
remodel may be edited (by changing the code, not surgery); a gate failure falls back to the
existing surgical B-rep path unchanged. Output remains STEP (never STL) — exact surfaces are
what the hidden interface axis rewards. Round budget becomes stage-scoped: ≤6 rounds for
remodel-to-gate, ≤5 for edit-and-verify (ledger --budget). Rejected: mandatory remodel-first
(31/32 benchmark parts grade high-complexity; a global remodel with small error risks the
interface/topology score the untouched-B-rep path gets for free). Spec reconcile queued with
 (*sync-spec).
