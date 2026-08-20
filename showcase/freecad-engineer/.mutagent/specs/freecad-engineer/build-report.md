# Build report — cadbench-crusher (② BUILD, verify leg)

- **Producer**: `ai-architect` build-verify subagent (Context-Inversion review), dispatched 2026-08-13
- **Subject**: `gnucleus-bench/` harness at pre-run state (playbook, runner, offline scorers, calibration, agentspec)
- **Verdict**: **STEER** — 11 ranked findings, 3 score-losing
- **Provenance**: exported verbatim from the session transcript
  (`d1d2aef5-bd59-4d2a-94ad-a3b7fa978665.jsonl`, subagent task `a2c3c137ddb6b820c`,
  89,711 subagent tokens, 38 tool uses, 412s). The build stage itself was hands-on in-session;
  this verify review is the toolchain-produced BUILD artifact.

---

Read: `agentspec.yaml`, `harness/playbook.md`, `run_slice.sh`, `score_offline.py`, `extract_refs.py`, `calib/gear_answer.py`, `README.md`, one full task (`freecad-1db55e40f2`: instruction/task.toml/test.sh/run_scorer.py/spec.json/param_check.py/Dockerfile), the installed `freecad_validator` 0.1.0 source, the harbor patches, and the `smoke-cc2` / `slice-dev` agent+verifier artifacts. Nothing was written or re-run.

# VERDICT: STEER

The implementation is faithful to the spec on every load-bearing structural claim (integrity, gate contract, scorer CLI shapes, offline oracle, preflight). The divergences are recoverable playbook/runner defects — but three of them are score-losing on a full run.

## Verified-good (context-inversion checks that the code passed)

- **Integrity constraint holds** (`agentspec.yaml:63`). `harness/playbook.md` contains zero task IDs, zero per-task dimensions, no sealed-file content. Grader is baked root-only (`environment/Dockerfile`, `chmod -R go-rwx /opt/grader`, `/opt/freecad_validator`); `solution/` is uploaded **only** by `harbor/agents/oracle.py:98` — never for `-a claude-code`; `run_slice.sh:38` injects exactly one extra path. **PASS.**
- **Scorer CLI contract matches the playbook verbatim** — positional `(spec_json, candidate_fcstd)` at `scorers/spec_consistency.py:102-104` and `(reference, candidate)` at `scorers/geometry.py:138-139`. No guessed API.
- **`"categories": []` in the reconstructed spec is harmless** — `categories` is never read by the validator (grep-confirmed); category refinement is driven by the case-local `param_check.py`, not the spec field.
- **The gear-stock rule at `playbook.md:207-211` is empirically true**: across all 31 gear tasks, `|printed OD − m·(z+2)| / m·(z+2)` maxes at **0.571 %** (`freecad-ab46933317`), 0 tasks exceed the 1 % `tol_scalar`. The claim is safe.
- **`extract_refs.py`'s `PartShape.brp` assumption holds** — I resolved `Document.xml` object→file ownership for all 100 references: `Body` owns `PartShape.brp` in 100/100; `refs.json` has 100 entries, 0 errors, `solids == 1` everywhere.

## Findings (ranked)

**1. HIGH — the in-container self-check is a strict *lower bound*, but the playbook orders the agent to iterate to 1.0.** `harness/playbook.md:59-62`. The graded run stages `param_check.py` next to the candidate (`tests/test.sh`, `SCORE_DIR` symlink) so `ConsistencyChecker` runs the category refinement at `consistency/checker.py:140-146`; the agent's `/app/answer.FCStd` has no such file, so it only ever gets the generic per-kind pass. `_reclassify_against` (`consistency/categories/base.py:57-72`) walks **only** `not_found` and `inconsistent` — it can never demote a `consistent` finding. So graded ≥ self-check, always. For the ~32-task gear family this is severe: `base_diameter`, `addendum`, `dedendum`, `whole_depth`, `clearance`, `circular_pitch`, `tooth_thickness` are derivable only by `GearCategory.derived_candidates` (`consistency/categories/gear.py:282-300`), i.e. ~8 of 17 keys on `freecad-1db55e40f2` are unreachable generically. The agent will burn its 6-iteration budget and may **distort geometry that already matched the reference to 0.000 %** chasing a phantom `not_found`. *Fix: add to §B — "the self-check omits the grader's per-family refinement, so it is a floor, not the grade; if a derived/standards parameter reports `not_found` while the analytic volume matches, record it and finish — never change geometry."*

**2. HIGH — the documented self-check command does not work as written; the fix is undocumented.** `harness/playbook.md:46-56`. The image sets `ENV PYTHONPATH=/opt:/opt/freecad_validator:${FREECAD_LIB}`, and `/opt/freecad_validator` is mode-700 root-only, so it shadows the `pip install --user` copy. Direct evidence in `jobs/smoke-cc2/freecad-0603c53148__eMoxfun/agent/claude-code.txt` lines 36 → 38 → 48: the agent burned three turns rediscovering this and only succeeded with `PYTHONPATH=` scoped to the FreeCAD libs. On 100 tasks that is 100× the waste, and a less persistent trajectory will conclude "validator unavailable" and drop both verification legs — which are the entire safety net for the ~40 uncalibrated long-tail tasks. *Fix: paste the exact working invocation into the playbook (`pip install --user …; PYTHONPATH=/opt/conda/lib:/opt/conda/Mod:/opt/conda/share/Mod python3 -m freecad_validator.scorers.…`).*

**3. HIGH — no convention for inch/diametral-pitch specs.** `harness/playbook.md:110-117` covers only metric module gears. 11 tasks declare `diametral_pitch`; 9 write parameters as unit-conversion **expressions** (`- pitch_diameter = 1/2 in * 25.4 = 12.7 mm`); `freecad-fc1e98cd09` has **no `gear_module` at all** — it must be derived as `25.4/DP`. Nothing tells the agent that the operative value is the *final evaluated mm number*, and a mis-read is a 12.7×–25.4× geometry error (score 0). *Fix: two lines — "a key parameter written as an expression evaluates to the LAST number on the line, in mm" and "if only `diametral_pitch` is given, `m = 25.4/DP`".*

**4. MEDIUM — the spec's declared PyPI-unreachable fallback exists nowhere in the implementation.** `agentspec.yaml:134` promises "fall back to the analytic cross-check alone and state so; never skip verification silently"; `playbook.md` §Verification loop has no fallback clause at all. Spec↔impl coverage gap, and it compounds finding 2. *Fix: add the two-sentence fallback to §B/§C.*

**5. MEDIUM — the concurrency constraint is not enforced by the runner.** `harness/run_slice.sh:13` (`N=${N:-2}`) defaults correctly but accepts `N=8`; `agentspec.yaml:69` states `<= 2` as a hard constraint. The preflight enforces the two venv patches but not this. *Fix: `[ "$N" -le 2 ] || { echo "FATAL: N>2 violates the usage-limit constraint"; exit 1; }`.*

**6. MEDIUM — preflight validates the venv patches but not the two things most likely to waste a 100-task run.** `harness/run_slice.sh:18-30`: `$TOK` is never checked non-empty or unexpired (`claudeAiOauth.expiresAt` is right there), and a mistyped task id becomes an `-i` filter that silently matches nothing. There is also no usage-limit triage: a mid-run limit hit produces zero-scored trials indistinguishable from genuine CAD failures, and the wrapper has no rerun-failed mode. *Fix: assert `$TOK` non-empty + `expiresAt > now`, assert each `-i` id resolves to a `tasks/cad-bench/<id>` directory, and add a `--rerun-failed` path keyed on `result.json` terminal reason.*

**7. MEDIUM — the primary evaluation criterion has no implementation.** `agentspec.yaml:244-246` defines `combined-score` as the mean over 100 tasks "via `harness/score_offline.py`", but `score_offline.py:38-96` scores exactly one task and prints one line. There is no aggregator. *Fix: add a batch mode / `score_all.sh` emitting the per-task table plus the mean.*

**8. MEDIUM — `find_image` can silently score against the wrong image.** `harness/score_offline.py:22-35` returns the first `docker images` line containing the task name, else the first containing `freecad`; `<none>:<none>` dangling entries and stale rebuilds both match, and the choice is never printed. A wrong-FreeCAD-version image makes the "exact offline oracle" claim false. *Fix: skip `<none>` tags, require an exact task-name match or an explicitly pinned `cadbench-env` tag, and echo the chosen image.*

**9. LOW-MEDIUM — the offline oracle is optimistic relative to the live verifier.** `harness/score_offline.py:56-81` reproduces the scoring call but not `tests/test.sh`'s zero paths (missing FCStd → 0, symlinked FCStd → 0), and stages `param_check.py` by copy where `test.sh` deliberately uses `ln -s` to dodge a documented truncation race under concurrency. *Fix: mirror both guards and the symlink.*

**10. LOW — `/tmp/spec.json` is hand-retyped, and the parser is text-based.** `harness/playbook.md:50-53` vs `spec/parser.py:189-219`: consistency is parsed out of the `key_parameters` blob, so dropped `# ISO 54` comment lines, altered unit spacing (the smoke log wrote `= 107.156mm`, the sealed spec uses `107.156 mm`) or a skipped line changes the self-check's parse relative to the sealed spec. *Fix: instruct writing the JSON via a `python3 - <<'EOF'` heredoc with `json.dumps`, copying every key-parameter line including its trailing `#` comment, then echoing back the parsed key list to confirm the count.*

**11. INFO (already remediated) — do not parse the existing job artifacts.** `harbor/trial/trial.py:814` carries the `len(secret) < 8` guard, but it is dated 13:25 while `jobs/smoke-cc2/.../verifier/reward.json` is 13:24 — every digit `1` in the smoke-cc2 and slice-dev artifacts is `[REDACTED]`. Those scores must be re-derived via `score_offline.py`, not read. `slice-dev2` onward should be clean.

## Single highest-leverage improvement before the 100-task run

**Rewrite §Verification loop B/C of `harness/playbook.md`** to carry (a) the exact copy-pasteable `PYTHONPATH`-scoped validator invocation, (b) the explicit statement that the self-check is a *floor* — the grader applies per-family refinement the agent cannot run, so a `not_found` on a derived parameter with a matching analytic volume is **not** a defect to fix, and (c) the PyPI-unreachable fallback the spec already promises.

That one block touches all 100 tasks: it is the difference between a verification loop that actually runs (the sole protection for the ~40 uncalibrated long-tail families) and one that silently degrades, and it removes the only mechanism in the current design that can convert an already-perfect gear into a zero.

---

## Disposition (recorded post-review, 2026-08-13)

All 11 findings were applied before the full 100-task run:

- **1, 4** → playbook §B rewritten: floor-not-grade semantics + PyPI-unreachable fallback (§D).
- **2, 10** → exact `PYTHONPATH`-scoped invocations and the `python3 - <<'EOF'` heredoc spec.json recipe pasted verbatim into §B/§C.
- **3** → interpretation rules: expression-evaluates-to-last-mm-number + `m = 25.4/DP`.
- **5, 6** → `run_slice.sh`: concurrency guard, token expiry check, task-id existence check; `run_batch.sh` re-runs zero-scored trials.
- **7** → `harness/score_all.py` batch aggregator (per-task table + mean).
- **8, 9** → `score_offline.py`: pinned `cadbench-env:latest`, `<none>`-tag skip, image echoed, live zero-paths mirrored, `param_check.py` staged by symlink.
- **11** → smoke-cc2/slice-dev scores excluded; both tasks re-ran in later batches.

Regression check after applying: the patched offline scorer still graded the calibration gear at 1.0; the subsequent dev slice scored 9/9 perfect. Outcome runs: `final_run_scores.json` 0.9471 (2026-08-13), `generic_run_scores.json` 0.9605 (2026-08-19).
