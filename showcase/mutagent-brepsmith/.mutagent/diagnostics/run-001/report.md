# Diagnostic Report — run-001 (eval-run-001 failures) · 2026-08-24

Subject: cad-step-editor · Evidence: local run artifacts · 4 analyzer deep-reads, contract-validated findings under findings/.

## Headline: the eval GATE's CRIT failure was a false positive; real defects found elsewhere

**F-001 (was: frame-shift, PRIMARY) — REFUTED.** No pose change: input/GT/output share an identical bbox corner. The DATASET GENERATOR is at fault: `_thicken` takes magnitude from Z but direction from an arbitrary face normal (synthetic_pairs.py:191-200) — GT grew +Y against its own instruction. The scorer's "frame" check conflates size with pose and hard-zeros. The agent round-1 replicated the GT's error, then its verify loop steered it AWAY from the broken answer key toward the instruction — punished for being right. Both arms share the extent delta to the last digit (shared-GT fingerprint).

**F-002 (Z-scale semantic miss) — CONFIRMED agent failure + 3 harness holes.** Candidate destroyed all 9 planar faces (worse than no-op; renormalized 0.0). Holes found: (1) `is_localized_to` has ZERO production callers — the check the spec criterion names is unreachable from the CLI; (2) the frame gate FIRED and was bypassed via `--allow-repose` + prose; (3) the budget ledger ranks on AGENT-SELF-REPORTED scores (0.9 claimed vs 0.14 actual) with checks_passed:false never consulted.

**F-003 (isolation) — CONFIRMED eval-infra defect.** One wheel = tools + answer-key generator in one namespace; the agent's own prompt advertises `gen-pairs`. Prompt blinding structurally cannot work. Cribbing didn't even pay (OCCT face-order instability across STEP re-export: one contaminated sample scored 0.143). Arm B unconfirmed-not-clean; trace observability thin (harness events only).

**F-004 (papercuts) — CONFIRMED, larger than reported.** (a) CLI `round` claims+records in one call → phantom invalid records: 11/75 budgeted rounds destroyed (14.7%), effective budget ~2.5 of 5; the agent doc MANDATES the broken pattern. (b) `diff` OOM: unchunked trimesh closest_point (~24M pairs ≈ 3.8 GB), paid twice; `n_samples` exists one layer down, unplumbed. Blast radius of both fixes on the 205-test suite: zero expected failures. Same DEFAULT_SAMPLES exposure in scoring.py flagged unverified.

## Revised verdict (supersedes .mutagent/evaluator/run-001/verdict.json gate)

- output-always-valid: the single failure DISSOLVES (eval-artifact bug) → pass on emission-validity.
- Numbers: report Arm A as clean n=15 mean 0.681; excluding the bad-GT sample (0365, unfairly zeroed) → n=14 mean ≈ 0.730. Never publish blended 0.712. Arm B 0.4508 (0067 frame-flag needs the same GT re-check; granting it back does not close the gap).
- beats-same-model-baseline: PASS, robust under every split.
- GATE: **incomplete** (was fail) — no CRIT criterion failed, but measurement infrastructure (GT generator defect, contamination, scorer pose/shape conflation, self-scored ledger) must be fixed and the slice re-scored before a pass is claimable.

## Ranked remedy bundle (apply is GATED — nothing applied)

| # | Remedy | Locus | Cost/Impact |
|---|--------|-------|-------------|
| | `_thicken` direction fix + generation-time GT↔instruction consistency gate; re-gen affected cases | cadtools/synthetic_pairs.py | med/HIGH |
| | checks_passed gates emission; HARNESS computes round scores (kill self-scoring) | cadtools/budget.py+cli.py | low/HIGH |
| | Surface-type conservation gate in verify (GT-free operation-class check) | cadtools/geometry_diff.py+cli.py | low/HIGH |
| | Wheel split runtime/devtools + standing AST isolation audit that BLOCKS aggregation | pyproject.toml + scripts/ | med/HIGH |
| | Scorer: size-invariant pose test, `shape-divergence` status ≠ frame-zero; machine-readable `--allow-repose` waiver | cadtools/scoring.py+geometry_diff.py | med/MED |
| | Ledger CLI `--round` decoupling + chunked memory-budgeted diff (+`--samples`) | cadtools/cli.py+geometry_diff.py | low/MED |
| | Prompt: operation-class conservatism clause; REMOVE `gen-pairs` advertisement from the agent card |.claude/agents/cad-step-editor.md (spec cascade) | low/MED |
| C1 | Candidate criterion `operation-class-fidelity` — batch-check across all 20 thicken cases before adoption | eval suite | n=1, pending |

Recommended bundle: +++ first (measurement integrity before optimization), then re-run the slice- ride along. Wave: ⑤ OPTIMIZE on explicit approval.
