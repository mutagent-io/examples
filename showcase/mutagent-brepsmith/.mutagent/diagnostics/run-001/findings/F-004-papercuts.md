# F-004 — Tooling papercuts (eval-run-001, cluster 4)

**Severity** LOW · **Independent reports** 3 · **Status** report-only, no code changed
**Structured findings** `.mutagent/diagnostics/run-001/findings/F-004-papercuts.json` (contract gate: PASS, 2 findings)

Two defects, both in the *tool surface* rather than in the underlying libraries. Neither
corrupted an emitted `output.step` in this run; both cost the agents real budget and forced
documented-protocol violations to recover.

---

## A — Budget-ledger round double-count (`F-004-1`)

### Causal chain

| | |
|---|---|
| **WHAT** | `wrong-output` — a ledger record is filed against round N+1 instead of the round whose script produced it, and the phantom claim record is a fabricated `valid:false` failure. |
| **WHY** | `tool-missing` — there is no CLI affordance to record an outcome against an already-claimed round. |
| **WHERE** | `tool-definition` — `cadtools/cli.py:190-226` (`_cmd_round`) and `cadtools/cli.py:337-353` (the `round` subparser). |

1. **`_cmd_round` claims and records in one indivisible step.** `cadtools/cli.py:201`
   runs `round_no = ledger.start_round()`; `cadtools/cli.py:218-225` then runs
   `ledger.record(round_no, valid=args.record_valid, ...)` **unconditionally**. There is no
   claim-only path.
2. **A bare claim therefore writes a fabricated failure.** `cadtools/cli.py:353` sets
   `record_valid=False` as the argparse default, so `cadtools.cli round` with no outcome flag
   files `{valid:false, score:0.0, failures:[], candidate_path:null}` for a round whose script
   has not run yet.
3. **The follow-up record call cannot address that round.** The subparser
   (`cadtools/cli.py:337-353`) exposes `--candidate/--score/--failure/--record-valid/--record-invalid`
   but **no `--round`**, and `_cmd_round`'s only source of a round number is `start_round()`.
   So `round --record-valid --score 0.9` burns a second slot and files the real outcome as round 2.
4. **The ledger layer is not at fault.** `cadtools/budget.py:99-136` already separates
   `start_round() -> int` from `record(round_no, ...)`, and `budget.py:122-125` even guards
   `1 <= round_no <= self._started`. The CLI simply never uses the decoupling.
5. **ORIGIN — the documented protocol requires the two-call shape the CLI cannot serve.**
   `.claude/agents/cad-step-editor.md:84-86`:

   > - Claim a round *before* you write that round's script.
   > - After verifying, record the outcome **on that round** (`--record-valid --score <s>` or
   >   `--record-invalid --failure "<reason>"`) so the ledger can pick the best attempt.

   The agents were not misusing the tool — obeying the documented protocol *guarantees* the
   double-count.

### Measured impact

Ledger `rounds_used` vs `report.json` `rounds[]` across `runs/eval-run-001/armA`:

| | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **ledger.json** (`rounds_used`) | 4 | 9 | 1 | 1 |
| **report.json** (real iterations) | 13 | 1 | 1 | — |

- **11 of 15 samples** carry exactly one phantom leading record.
- **11 of 75 budgeted rounds destroyed (14.7 %)** — the effective budget was ~2.5 of 5.
- `abc_0365-thicken` reached **4/5 used for 3 real attempts** — one iteration from a spurious
  `budget_exhausted`.
- Three agents self-reported it in prose, e.g. `abc_0123-fill-hole/report.json`
  `note_on_rounds`: *"A ledger-usage slip caused round 1 to be recorded with default
  valid=false before its real outcome was known, consuming an extra round."*
- The four "clean" ledgers (`abc_0011`, `abc_0067`, `abc_0098`, `abc_0128`) are correct **by
  accident** — those agents made a single combined `round --record-valid` call, silently
  skipping the claim-before-implement step the SOP mandates.

### Ranked remedies

**R-004-1a — decouple claim from record** (cost `low`, correctness `high`)
`record_valid` default `False` → `None` sentinel; add `--round N` (defaults to the latest
*started* round, not a new one); branch `_cmd_round` so a bare call claims without recording
and a record call never re-enters `start_round()`. Full diff in the JSON.

**R-004-1b — regression tests** (cost `low`, correctness `high`)
Four new `tests/test_cli.py` cases pinning: claim+record == 1 round with the outcome on the
producing round; bare claim writes no record; recording an unclaimed round exits non-zero;
five claim/record pairs fit the budget. Test 1 fails on the current build.

---

## B — `cadtools diff` OOM at 20000 samples (`F-004-2`)

### Causal chain

| | |
|---|---|
| **WHAT** | `missing-output` — the process is SIGKILLed (exit 137); no diff report, no error message. |
| **WHY** | `tool-missing` — no chunking, no memory ceiling, and no CLI knob to lower the sample count. |
| **WHERE** | `tool-definition` — `cadtools/geometry_diff.py:279-291`, `:211-217`, `:258-269`; `cadtools/cli.py:126-132`, `:301-309`. |

1. **Two agents hit exit 137** on `abc_0365-thicken` and `abc_0368-fill-hole`, each reporting
   ~3.8 GB per proximity query, and each ruling out a geometry defect first (`verify` and
   `analyze` complete; a self-diff of input-vs-input at 20000 samples succeeds).
2. **The memory is not the sample points.** `cadtools/geometry_diff.py:290` hands the full
   array to `trimesh.proximity.closest_point`; 20000 × 3 × 8 B is only **480 KB**. The
   multi-GB allocation is created inside that call.
3. **trimesh 5.0.0 flattens the whole cross product in one shot.** `closest_point` computes
   per-point candidate faces via `nearby_faces`, then

   ```python
   all_candidates = np.concatenate(candidates)
   tile_idxs      = np.repeat(np.arange(len(points)), num_candidates)
   query_point    = points[tile_idxs, :]
   query_tri      = triangles[all_candidates]
   ```

   With `K = Σ candidates`, `query_tri` alone is `K×3×3` float64 = **72 B/candidate**, and
   `_corresponding()` plus `query_vector` / `query_distance` add several more K-sized
   temporaries — **~150-200 B per pair live at once**. Dense curved meshes have many small
   triangles with heavily overlapping AABBs, so candidates-per-point runs into the thousands;
   `K ≈ 24 M` reproduces the reported 3.8 GB. No batching, no ceiling.
4. **`diff_shapes` pays it twice and keeps both.** `geometry_diff.py:213-214` runs the
   symmetric ref→cand and cand→ref queries back to back; the results are retained as
   `_points` / `_distances` (`geometry_diff.py:96-97`). A mesh that merely strains the first
   query is killed by the second — matching the report's *"when run twice"*.
5. **ORIGIN — the mitigation exists one layer down and is unreachable.** `diff_shapes`
   accepts `n_samples` (`geometry_diff.py:192`), but `diff_files` (`:258-269`) neither takes
   nor forwards it, and the `diff` subparser (`cli.py:301-309`) defines only `reference`,
   `candidate`, `--allow-repose`. Both agents had to **abandon the CLI** and hand-drive
   `diff_shapes` from a Python script at `n_samples=3000` to complete a mandatory VERIFY step.

### Ranked remedies

**R-004-2a — chunked distance + `--samples` flag** (cost `medium`, correctness `high`)
Batch `_surface_distance` with an adaptive, memory-budgeted chunk (`DISTANCE_CHUNK_BYTES =
256 MB`, chunk sized from measured candidates-per-point, clipped to 256…4096), build the
trimesh object once outside the loop, forward `n_samples` through `diff_files`, and expose
`--samples` on the CLI. **Distances are bit-identical** — `closest_point` is pure per-point
with no cross-point reduction, so batching changes only the allocation schedule. ~3.8 GB at
B=20000 → ~200 MB at B=1024 (20×). Full diff in the JSON.

**R-004-2b — regression tests, `@pytest.mark.slow`** (cost `medium`, correctness `medium`)
Dense curved fixture + `tracemalloc` peak-memory ceiling at the full 20000 samples (slow),
chunk-size-invariance assertion (`np.array_equal` on `_distances` between many-chunk and
one-chunk runs, fast), and a `--samples` CLI test. Register the `slow` marker in
`pyproject.toml`.

---

## Blast radius — 205-test suite

Suite collects **205 tests** (`pytest --collect-only -q`). Expected failures from either
remedy: **0**.

### Defect A

| Surface | Tests | Effect |
|---|---|---|
| `tests/test_budget.py` | 11 | **Untouched.** `RoundLedger`'s API is unchanged — the fix is confined to the CLI adapter. |
| `tests/test_cli.py` round cases | 4 (`:121`, `:133`, `:153`, `:161`) | **All stay green.** `:121`/`:133`/`:161` pass `--record-invalid` explicitly, so `store_false` still yields `False` and the record path fires. `:153` calls `round` bare but asserts only that `trace.jsonl` exists, which the claim path still writes (`cli.py:227-236`). |
| `tests/test_agent_markdown.py` | 17 (3 round-related, `:116-118`) | `assert "5 rounds" / "at most 5" / "round 6"` — the Step-7 doc edit must preserve those substrings. |
| `tests/test_docs.py` | 6 (1 touches `ledger.json` at `:68`) | Artifact-name assertion only; filename unchanged. |

**Risk:** the `record_valid=None` sentinel is the only semantic change to an existing flag.
Any out-of-repo caller relying on bare `round` recording an implicit failure would change
behaviour — that is the defect, so the change is intentional.

### Defect B

| Surface | Tests | Effect |
|---|---|---|
| `tests/test_geometry_diff.py` | 12 | **All stay green** — chunking is numerically identical, and the small plate fixtures produce one chunk anyway. |
| `tests/test_scoring.py` | 21 (1 imports `FrameDisagreementError`, `:180`) | Untouched — `check_frame_agreement` is not modified. |
| `tests/test_synthetic_pairs.py` | 1 imports `check_frame_agreement` (`:51`) | Untouched. |
| `tests/test_cli.py` diff | none currently | New `--samples` test is additive. |
| `tests/test_api_pin.py` | pins `bd.Shape.tessellate` only (`:26`) | No `cadtools` signature is pinned; adding `n_samples` to `diff_files` is safe. |
| `tests/test_agent_markdown.py:123` | `assert "cadtools.cli diff" in body` | Substring survives an additive flag mention. |

**Risk:** `pyproject.toml`'s `[tool.pytest.ini_options]` was not read; if it already defines
`addopts` or a `slow` marker, Step 5 of R-004-2b must reconcile rather than add. Flagged as an
`unverified` assumption in the JSON.

### Unclosed exposure

`cadtools/scoring.py:58` carries the **same** `DEFAULT_SAMPLES = 20000`, used at
`scoring.py:246-257`. It matches through `_match_fraction` / `sample_surface_with_normals`
(`:273`) rather than `closest_point`, so the allocation shape likely differs and no `score`
OOM appeared in this run — but that path was **not traced**. Worth a follow-up slice.
