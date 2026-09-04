# BUILD Report — cad-step-editor

| Field | Value |
|---|---|
| Spec | `.mutagent/specs/cad-step-editor/agentspec.yaml` |
| Spec version | `0.1.0` (apiVersion `agentspec.mutagent.io/v0.3.0`) |
| Kind | `Agent` |
| Decision log | `.mutagent/specs/cad-step-editor/agentspec.decisions.md` |
| Selected target | `claude-code` — `harness` / `claude-code` |
| Artifact | `markdown` → `.claude/agents/cad-step-editor.md` |
| Code implementation | Python 3.12 · uv-managed · build123d + trimesh + manifold3d + numpy (support modules for the harness target; not a `format: code` target) |
| Target root | `/home/bruno/dev/mutagent/playground/cad-agents/stl-agent` |
| Verdict | `BUILD COMPLETE — all 9 gates green (B6). Awaiting architect verify (B7).` |

<!-- =========================================================================
     PLAN — frozen BEFORE any target write.
     ========================================================================= -->
## PLAN · frozen before target writes

**Status:** `READY` — architect plan-check returned READY at B4 with five mandatory bounded amendments (A1–A5), all folded in. Original blocking text kept below for the record.

**Superseded status:** `BLOCKED` — awaiting architect plan-check (B4). Three decisions need
confirmation before execution: **OQ-1** (the shipped coverage gate is
TypeScript-only and cannot grade a Python scaffold), **OQ-2** (local CAD-Score
proxy must omit the interface axis — private jig sub-volumes), **OQ-3** (editing
outputs must NOT be canonically re-posed). See *Open questions* below.

**Inputs:** spec + decisions sidecar + selected target `claude-code` + four pinned docs crawled fresh 2026-08-24T07:44Z + read-only repository snapshot
**Source digest:** `agentspec.yaml` sha256 `159894c4ea2480b6…` · `agentspec.decisions.md` sha256 `b81cc825471367c8…`
**Goal:** An operator can run `claude` in this repo, invoke the `cad-step-editor` subagent on any CadGenBench editing sample (`input.step` + `edit_description.txt`), and receive an `output.step` that provably cleared a locally-computed benchmark-parity validity gate, plus a per-sample verification scorecard and a trace — with the 5-round budget enforced by code, not by prompt adherence.

### Environment snapshot (read-only survey)

| Fact | Observed |
|---|---|
| Target root contents | `.claude/`, `.agents/`, `.codex/`, `CLAUDE.md`, `AGENTS.md`, `.mutagent/` — **no** `.claude/agents/` dir yet, no implementation, no drift (greenfield) |
| `uv` | `0.9.17` ✅ |
| `python3` | `3.12.3` ✅ (CadGenBench targets 3.12+) |
| `pytest` | `9.1.1` (system) — will be pinned as a uv dev-dep, not used from system |
| `ruff` / `mypy` | not on host — uv dev-deps (`ruff 0.16.4`, `mypy 2.3.1`) |
| `zip` | Info-ZIP 3.0 ✅ (action `package-submission-zip`) |
| `hf` CLI | present ✅ (`huggingface-cli` deprecated → use `hf`; context `benchmark-dataset` binding must say `hf download`) |
| Dependency resolution | `uv pip compile` **succeeds**: `build123d==0.11.1` on `cadquery-ocp-novtk==7.9.3.1.1` (OpenCascade 7.9), `trimesh==5.0.0`, `manifold3d==3.5.2`, `numpy==2.5.2`, `rtree==1.4.1`, `huggingface-hub==1.28.0` |

### Load-bearing facts extracted from the fresh crawl

**A. Submission contract** (`docs/benchmark/submission.md`, `src/cadgenbench/baseline/package.py` @ `main`):
- One directory per sample; candidate written to `<sample>/output.step` (or `output.stp`) — accepted names are exactly `("output.step", "output.stp")`. **No other files per sample.**
- Zip root holds `meta.json` with **exactly** `submitter_name`, `submission_name`, `agent_url`, `notes` (≤500 chars), `agree_to_publish` (bool).
- A sample dir with no candidate ⇒ `status: "missing"`, `cad_score = 0`. Packager writes an explicit empty dir entry so missing-output samples survive extraction.
- Editing samples additionally have `input.step` in the working dir, but the file written back is still a single `output.step`.

**B. Scoring, editing composition** (`docs/metrics.md` § *Editing tasks: no-op renormalization*):
- Generation: `0.4·shape + 0.4·interface + 0.2·topology`, gated by validity.
- **Editing (our task): `cad_score = 0.6·s_renorm + 0.3·interface + 0.1·topo_match`, `0` if invalid**, where `s_renorm = max(0, (shape_similarity − b_shape)/(1 − b_shape))` and `b_shape = shape_similarity(input.step, GT)`. A no-op caps at `0.4`.
- `shape_similarity = ½(surface_distance_F1 + volume_IoU)`. : points matched when the closest point on the *other mesh's surface* is within **0.5 % of the GT bbox diagonal** *and* normals agree within **20°**. IoU via the **`manifold3d`** Boolean kernel (we pin the same kernel ⇒ true parity).
- `topology_match = s₀·s₁·s₂` (product, not mean), `sᵢ = ((min(bᵢ)+1)/(max(bᵢ)+1))^α`, `α = 2`. Betti from the tessellated mesh: union-find components → ray-cast containment for `b₀`/`b₂` → `b₁ = b₀ + b₂ − χ/2` with `χ = V − E + F`.
- Validity gate (`docs/metrics/cad_validity.md`) requires **all three**: (1) `BRepCheck_Analyzer.IsValid()` clean, (2) every shell closed / no naked edges, (3) tessellation is manifold (each edge ≤2 triangles), closed (`3F = 2E`), orientation-consistent.

**C. Dataset shape** (HF API `siblings`, 360 files, `sha f76f965…`, lastModified 2026-06-08):
- 81 sample dirs. **32 editing samples (the `2xx` dirs)**, each: `input.step`, `edit_description.txt`, `input.mesh.npz`, `description.yaml`, `front/iso/right/top.png`. 49 generation samples (`1xx`) — out of scope (nonGoal).
- `description.yaml` fields confirmed on sample `201`: `description`, `task_type: editing`, `input_files: [input.step]`, `input_type: text+step`.
- Root also ships `sanity_check_submission.py` — but it `import`s `cadgenbench.common.validity`, so it needs the benchmark package installed (see OQ-4).

**D. Claude Code subagent format** (`code.claude.com/docs/en/sub-agents`, fetched 200 — note the pinned `docs.claude.com` URL **301-redirects** to `code.claude.com/docs/en/sub-agents`; the pin is alive, the canonical host moved):
- Project subagents live in `.claude/agents/`, YAML frontmatter + Markdown body; **the body becomes the system prompt** verbatim, and the subagent receives *only* that plus basic env details.
- Required: `name` (lowercase + hyphens, no `:`), `description`. Optional: `tools` (comma-separated; **inherits all** if omitted), `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`.
- `model` accepts `sonnet | opus | haiku | fable | a full model ID (e.g. claude-opus-5) | inherit`; default `inherit`. ⇒ **`model: claude-sonnet-5` is expressible verbatim** (satisfied — no re-target).
- Watcher caveat: creating a scope's *first* agent file in a new `agents/` directory requires a Claude Code restart. `.claude/agents/` does not exist yet ⇒ flag in the handoff.

**E. build123d API** (readthedocs `latest`, doc version **0.11.2**):
- `import_step(filename) → Compound`; `export_step(to_export: Shape, file_path, unit=Unit.MM, write_pcurves=True, precision_mode=PrecisionMode.AVERAGE, *, timestamp=None) → bool`; `import_brep → Shape`; `export_stl`; `Mesher`.
- `Shape.is_valid: bool` — documented as *"True if no defect is detected on the shape S or any of its subshapes. See OCCT `BRepCheck_Analyzer::IsValid`"* ⇒ **exactly** the benchmark's check (1).
- `Shape.tessellate(tolerance: float, angular_tolerance: float = 0.1) → tuple[list[Vector], list[tuple[int,int,int]]]` ⇒ feeds checks (2)/(3) and all mesh metrics.
- `Shape.bounding_box(tolerance=None, optimal=True) → BoundBox`, `.area`, `.volume`, `.solids()`, `.faces()`, `.edges()`, `.geom_type`, `.distance_to()`, `.oriented_bounding_box()`.
- Editing primitives (`operations.html`): `fillet()`, `chamfer()`, `extrude()`, `offset()`, `split()`, `section()`, `revolve()`, `mirror()`, `scale()`, `sweep()`, `loft()`, `add()`, plus `+ - &` boolean algebra on the imported body.

### Task table

| Task | Verifiable outcome | Exact artifacts | Components + why / doc source | Check → expected result |
|---|---|---|---|---|
| **T1** Project scaffold | `uv sync --frozen` reproduces the toolchain from a lockfile on a clean checkout | `pyproject.toml`, `uv.lock`, `.python-version`, `.gitignore` | uv (host has 0.9.17; spec context `geometry-introspection` binds "python3 (uv-managed environment)"); deps pinned to the resolution proven above — `manifold3d` chosen specifically because `metrics/shape_similarity.md` names it as the IoU kernel | `uv sync --frozen && uv run python -c "import build123d,trimesh,manifold3d,numpy"` → exit 0 |
| **T2** Mesh/tessellation core | One deflection rule + one mesh representation shared by every metric, so validity/diff/score never disagree | `cadtools/mesh.py`, `tests/test_mesh.py` | `Shape.tessellate(tolerance, angular_tolerance)` (build123d import_export/direct API); deflection derived from bbox diagonal, mirroring the benchmark's `deflection_for_bbox(bbox.diagonal)` seen in `sanity_check_submission.py` | `tests/test_mesh.py::test_closed_box_mesh_is_closed_and_manifold` → `3F == 2E`, every edge in exactly 2 triangles |
| **T3** `step-io` | An input STEP round-trips through import→export with topology counts preserved | `cadtools/step_io.py` (`# @implements step-io`), `tests/test_step_io.py` | `import_step() → Compound`, `export_step(shape, path) → bool` (import_export.html § 3D Importers / Exporters); introspection via `.solids()/.faces()/.edges()/.geom_type/.bounding_box()/.volume` | `test_step_io.py::test_roundtrip_preserves_topology` → exported-then-reimported solid/face/edge counts equal the source; `test_export_returns_true`; `test_import_missing_file_raises_valueerror` (doc: *Raises ValueError – can't open file*) |
| **T4** `validity-checker` | A candidate STEP is passed/failed by the *same three conditions* the leaderboard gate applies, with the specific reason named | `cadtools/validity.py` (`# @implements validity-checker`), `tests/test_validity.py` | Three conditions verbatim from `docs/metrics/cad_validity.md`: (1) `Shape.is_valid` ⇔ `BRepCheck_Analyzer::IsValid()`, (2) closed shells / no naked edges, (3) mesh manifold + closed (`3F=2E`) + orientation-consistent. Advisory diagnostics (min face area `<0.001 mm²`, aspect ratio `>1000`, BREP tol `>0.1 mm`) reported but **never gating**, per the same doc | `test_validity.py::test_clean_box_passes` → `is_valid=True`; `::test_open_shell_fails_watertight` → `is_valid=False` and reason mentions naked edges; `::test_advisory_flags_do_not_gate` → sliver-face part still `is_valid=True` with a non-empty `advisories` list |
| **T5** `geometry-differ` | "Did I change only what was asked?" is answered numerically, not by impression | `cadtools/geometry_diff.py` (`# @implements geometry-differ`), `tests/test_geometry_diff.py` | Symmetric surface-distance field between input and candidate meshes (trimesh proximity / `rtree` index), per-region change map bucketed by an axis-aligned region-of-interest, signed volume delta, Betti delta. Rationale: SOP `edit-one-sample` VERIFY step (b) LOCALITY and criterion `unrelated-geometry-preserved` demand a *localized* diff, which neither the nor the IoU sub-metric provides (`shape_similarity.md` § *What this metric does not test*) | `test_geometry_diff.py::test_identical_bodies_zero_change` → max distance ≈ 0, changed-volume ≈ 0; `::test_hole_added_is_localized` → changed region's bbox contains the hole and the untouched region's max distance < tol; `::test_reports_betti_delta` → `(0,+1,0)` for a through-hole |
| **T6** `local-scorer` | A candidate + ground truth yields a scorecard whose fields and formulas mirror `result.json` | `cadtools/scoring.py` (`# @implements local-scorer`), `tests/test_scoring.py` | Formulas transcribed from `docs/metrics.md` + deep dives: surface- (0.5 % bbox-diagonal radius, 20° normal agreement, matched against the *other surface* not the other point cloud), volume IoU via `manifold3d`, Betti pipeline (union-find → ray-cast containment → `b₁ = b₀+b₂−χ/2`), topo score `s₀·s₁·s₂` with `α=2`, **editing** composition `0.6·s_renorm + 0.3·interface + 0.1·topo` with `s_renorm = max(0,(shape−b_shape)/(1−b_shape))`. Interface axis is **unavailable locally** ⇒ emitted as `null` and the proxy renormalizes over the available `0.7` weight, with `interface_available: false` recorded (OQ-2) | `test_scoring.py::test_identical_meshes_score_one` → = 1.0, IoU = 1.0; `::test_topology_axis_matches_doc_worked_example` → GT `(1,2,0)` vs cand `(1,4,0)` ⇒ `0.360`; GT `(1,0,0)` vs `(2,0,0)` ⇒ `0.444` (both **verbatim from `topo_match.md`**); `::test_noop_edit_renormalizes_to_zero` → feeding `input` as the candidate gives `s_renorm == 0.0`; `::test_proxy_reports_interface_null` |
| **T7** `complexity-grader` | Every STEP gets a reproducible tier so both dataset slices can be stratified | `cadtools/complexity.py` (`# @implements complexity-grader`), `tests/test_complexity.py` | Signals named by the spec (job `grade-complexity`): face/edge/solid counts via `.faces()/.edges()/.solids()`, surface-type variety via `Face.geom_type`, feature density = faces / bbox-diagonal, genus from the T6 Betti computation. Deterministic thresholds → `low|mid|high` matching dataset categories `tier-low/mid/high` | `test_complexity.py::test_plain_box_is_low`; `::test_dense_pattern_part_is_high`; `::test_grading_is_deterministic` → same file graded twice yields byte-identical records; `::test_tiers_are_dataset_category_ids` → tier ∈ {`low`,`mid`,`high`} |
| **T8** `synthetic-pair-generator` | Every dev-set item is a *real* triple: we own the ground truth because we authored the edit | `cadtools/synthetic_pairs.py` (`# @implements synthetic-pair-generator`), `tests/test_synthetic_pairs.py` | Edit recipes applied programmatically to a graded input via build123d ops (`fillet`, `chamfer`, boolean `+/-`, `extrude`, `offset`, `scale`) covering the spec's `editType` axis (`dimension-change`, `feature-add`, `feature-remove`, `pattern-change`, `boolean-combine`); each recipe emits input STEP + a templated instruction in the three `instructionStyle` registers + `ground_truth.step`. **The GT is produced in the input's own coordinate frame** so `b_shape` and all metrics are computed without ICP (see OQ-3) | `test_synthetic_pairs.py::test_triple_is_complete` → all three files exist and GT passes T4 validity; `::test_ground_truth_differs_from_input` → `s_renorm(GT) == 1.0` and `s_renorm(input) == 0.0`; `::test_covers_all_edit_types`; `::test_manifest_entry_schema_valid` |
| **T9** CLI surface + **round-budget ledger** | The 5-round cap is enforced by code that *refuses* round 6 — not by the model remembering | `cadtools/cli.py`, `cadtools/budget.py`, `tests/test_cli.py`, `tests/test_budget.py` | `python -m cadtools.cli <analyze\|verify\|score\|grade\|gen-pairs\|round\|emit\|package>` — argparse, JSON on stdout. This is the **only** binding the harness needs: spec `capabilities.fit` says the checkers "live as project Python modules the agent calls", and target-conditional binding for `harness:claude-code` is CLI-first, **not** MCP. The ledger persists per-sample round state so constraint *"at most 5 edit→verify→fix rounds"* and criterion `budget-and-emission-discipline` become code-checks | `test_budget.py::test_sixth_round_is_refused` → round 6 exits non-zero with `budget_exhausted`; `::test_best_valid_attempt_is_never_overwritten_by_worse` (action `write-outputs` onFailure); `test_cli.py::test_every_subcommand_emits_parseable_json`; `::test_verify_exit_code_is_nonzero_on_invalid` |
| **T10** Observability sink | Every run leaves a discoverable, machine-readable trace for `*eval` / `*diagnose` | `cadtools/trace.py`, `tests/test_trace.py`, `runs/.gitkeep` | JSONL appended to the **relative** path `runs/<run-id>/<sample>/trace.jsonl` (never absolute), one line per round: inputs, generated script path, stdout/stderr, verification report, decision, final emission. Satisfies action `execute-cad-edit-code`'s `evidence` clause ("the generated script, its stdout/stderr, and the per-round verification report are kept per sample") | `test_trace.py::test_round_appends_one_line`; `::test_trace_path_is_relative`; `::test_trace_lines_are_valid_json` |
| **T11** Agent artifact — frontmatter + **verbatim** system prompt | The subagent loads, runs on the pinned model, and its system prompt is byte-identical to the spec's | `.claude/agents/cad-step-editor.md` | Frontmatter per the sub-agents doc: `name: cad-step-editor`, `description` (delegation trigger, from `triggers[0].operator-run` + metadata.description), `tools: Read, Write, Edit, Glob, Grep, Bash` (exactly the surface the three `context` and three `actions` bindings need — Bash covers python/uv/hf/zip; **no** WebFetch, no MCP), `model: claude-sonnet-5` (**full-model-ID form is documented as accepted** — honored verbatim, no re-target). Body = `spec.agent.systemPrompt` **verbatim** because the doc states the body *becomes* the system prompt | `tests/test_agent_markdown.py::test_frontmatter_has_required_fields` → `name`+`description` present, `name` is lowercase-hyphen and contains no `:`; `::test_model_pin_is_verbatim` → `model == "claude-sonnet-5"` (the spec constraint string); `::test_system_prompt_is_verbatim_substring_of_body` → **exact** string equality against `spec.agent.systemPrompt` after YAML load; `::test_declared_tools_cover_all_action_bindings` |
| **T12** Agent artifact — persona, workflow, tool protocol | The prompt tells the agent *which command* to run at each workflow node, so VERIFY cannot degenerate into self-assessment | `.claude/agents/cad-step-editor.md` (sections appended **after** the verbatim system prompt) | Renders `spec.agent.workflow.inline` nodes `analyze → plan → implement → verify ⟳(≤5) → emit` as an explicit procedure, each node naming its `cadtools.cli` subcommand and the `runs/` paths; encodes `spec.agent.persona` (role "Mechanical CAD engineer") and the constraint *"Verification is deterministic code, never a second LLM opinion"*; documents the `output.step` filename contract and the **no-upload** boundary (`nonGoals`, action `package-submission-zip` approval `human-gate-downstream`). **Prompt-caching :** the static persona + procedure + tool protocol are placed as one contiguous prefix ahead of any per-sample content — Claude Code caches the subagent system prompt as a stable prefix, so no provider caching API is called by hand | `test_agent_markdown.py::test_all_workflow_nodes_named` → all five node ids appear; `::test_five_round_budget_stated`; `::test_names_cadtools_cli_for_verify`; `::test_never_upload_boundary_present`. **Behavioral adherence is EVALUATE, not BUILD.** |
| **T13** Dataset scaffolding | The two `itemsRef` paths the spec names exist with a documented, validated schema | `datasets/synthetic-edit-pairs/manifest.yaml` (schema stub, empty `items: []`), `datasets/real-inputs-proxy/manifest.yaml`, `datasets/README.md`, `cadtools/manifest.py`, `tests/test_manifest.py` | Paths are taken **verbatim** from `spec.evaluation.datasets[].itemsRef`. Manifest carries per item: sample id, tier, `editType`, `instructionStyle`, input/instruction/GT paths (GT `null` for the proxy slice). Content is produced at run time by T8 / `hf download`; BUILD ships only the schema + validator | `test_manifest.py::test_stub_manifests_validate`; `::test_itemsref_paths_match_spec` → the two paths equal the spec strings exactly; `::test_proxy_items_allow_null_ground_truth` |
| **T14** Dataset acquisition | `hf download` fetches only the 32 editing samples, and grades them without inventing anything | `cadtools/dataset.py`, `tests/test_dataset.py` | Context `benchmark-dataset` binds `hf download` (host has `hf`; `huggingface-cli` is **deprecated and no longer works** — observed). Editing samples are selected by `description.yaml: task_type == editing` (confirmed on sample 201), *not* by the `2xx` numeric prefix, so a dataset revision can't silently break selection. SOP `build-dev-dataset` onFailure: per-file failure report, **never fabricate a ground truth** ⇒ a failed download is recorded as `status: unavailable` | `test_dataset.py::test_editing_filter_uses_task_type` (fixture `description.yaml`s, **no network**); `::test_download_failure_is_reported_not_fabricated`; `::test_generation_samples_are_excluded`. Live download is **EVALUATE/run-time, not a BUILD gate** (network). |
| **T15** Submission packaging | The zip the operator uploads matches the packager's byte contract | `cadtools/package.py`, `tests/test_package.py` | Mirrors `src/cadgenbench/baseline/package.py` @ `main` exactly: candidate names `("output.step","output.stp")`; root `meta.json` keys `submitter_name`, `submission_name`, `agent_url`, `notes`, `agree_to_publish`; explicit empty-dir zip entries so missing-output samples survive extraction; `agree_to_publish` defaults **false**. Action `package-submission-zip` onFailure ⇒ missing outputs are listed, never padded with placeholders | `test_package.py::test_meta_json_keys_exact` → key set equality with the five names; `::test_missing_sample_dir_preserved_as_empty_entry`; `::test_agree_to_publish_defaults_false`; `::test_no_placeholder_files_written`; `::test_packing_report_lists_missing_samples` |
| **T16** build123d fixtures (**generated, never downloaded**) | The whole suite runs offline and deterministically | `tests/fixtures.py`, `tests/conftest.py` | Fixtures built in build123d code per instruction: `make_box()`, `make_plate_with_through_hole()` (Betti `(1,1,0)`), `make_plate_with_blind_pocket()` (Betti `(1,0,0)` — the doc's *"blind features are topologically trivial"* case), `make_two_disjoint_blocks()` (`(2,0,0)`), `make_hollow_ball()` (`(1,0,1)`), `make_open_shell()` (invalid), `make_sliver_face_part()` (advisory-only). These reproduce the exact rows of the `topo_match.md` Betti table, which is what makes T6's parity assertions meaningful | `tests/test_fixtures.py::test_fixture_betti_numbers_match_doc_table` → each fixture's `(b₀,b₁,b₂)` equals the documented row; `::test_no_test_touches_the_network` (asserts no `hf`/`requests` call in the suite) |
| **T17** build123d API pin smoke | A build123d upgrade breaks loudly at BUILD, not silently at run time | `tests/test_api_pin.py` | The crawled docs are version **0.11.2** while the resolved wheel is **0.11.1** (see Risk). This test asserts the exact surface the plan relies on: `import_step`/`export_step`/`import_brep` importable from `build123d`, `Shape.is_valid` is a `bool` property, `Shape.tessellate` accepts `(tolerance, angular_tolerance)`, `bounding_box(optimal=True)` accepted | `test_api_pin.py::test_documented_signatures_exist` → passes on the pinned version, fails with a named symbol on drift |
| **T18** Spec-coverage gate, Python-adapted | Every `capabilities.code[].id` provably has an implementing module *and* a referencing test | `tests/test_spec_coverage.py`, `scripts/check_coverage.py` | semantics, language-adapted: reads `.mutagent/specs/cad-step-editor/agentspec.yaml` → for each `spec.capabilities.code[].id`, asserts a `cadtools/*.py` file carries `# @implements <id>` and ≥1 `tests/test_*.py` imports that module. **Necessary because the shipped `scripts/verify/spec-impl-coverage.ts` collects only `*.ts` files (`e.name.endsWith(".ts")`, tests matched by `\.test\.ts$`) and would therefore report all six capabilities missing on any Python scaffold** — see OQ-1 | `test_spec_coverage.py::test_every_capability_has_module_and_test` → all six of `step-io`, `validity-checker`, `geometry-differ`, `local-scorer`, `complexity-grader`, `synthetic-pair-generator` resolve; a deliberately-renamed marker fails the test |
| **T19** Baseline-comparison hook | The headline thesis can be measured, with the loop as the only variable | `cadtools/cli.py --no-verify-loop` flag, `cadtools/aggregate.py`, `tests/test_aggregate.py` | Criterion `beats-same-model-baseline` needs a same-model single-shot arm. BUILD supplies the *apparatus*: a flag that skips VERIFY/ITERATE (round budget 1, same prompt) and an aggregator producing `run_summary.json`-shaped output (`aggregate_score`, `validity_rate`, `n_valid/n_invalid/n_missing`, `per_sample_scores`) per `submission.md` § *Run-level*. **Running the two arms and comparing is EVALUATE.** | `test_aggregate.py::test_summary_shape_matches_contract` → key set matches the documented `run_summary.json`; `::test_missing_sample_scores_zero`; `::test_no_verify_loop_caps_rounds_at_one` |
| **T20** Repo entry doc | An operator (or a future session) can run the thing without re-deriving it | `cadtools/README.md` | Records the uv bootstrap, the `cadtools.cli` subcommands, the `runs/` trace layout, and the local-vs-leaderboard scoring caveats (interface axis absent, no ICP alignment). **Does not touch the root `CLAUDE.md` / `AGENTS.md`** — those belong to the MutagenT install | Rendered links resolve; `test_docs.py::test_readme_lists_every_cli_subcommand` |

### Requirement → task traceability

| Spec requirement | Tasks |
|---|---|
| SOP `edit-one-sample` | T3, T4, T5, T9, T10, T11, T12 |
| SOP `build-dev-dataset` | T7, T8, T13, T14 |
| SOP `package-submission` | T15, T19 |
| job `apply-step-edit` | T3, T5, T9, T12 |
| job `grade-complexity` | T7 |
| job `build-synthetic-pairs` | T8, T13 |
| job `score-locally` | T6, T19 |
| `capabilities.code` ×6 | T3, T4, T5, T6, T7, T8 (gate: T18) |
| `context` sample-inputs / benchmark-dataset / geometry-introspection | T11 (`tools:` grant), T14, T9 |
| `actions` execute-cad-edit-code / write-outputs / package-submission-zip | T9+T10, T9, T15 |
| Agent artifact (persona · verbatim prompt · triggers · 5-round loop) | T11, T12 |
| Constraint "≤5 rounds, always emit" | T9 (code-enforced), T12 (stated) |
| Constraint "verification is code, never a second LLM" | T4/T5/T6 exist as code; T12 forbids self-assessment; no delegate/subagent is scaffolded |
| `evaluation.datasets[].itemsRef` | T13 |
| Observability | T10 |

**Build checks:** lint · typecheck · build · tests · coverage · target smoke

```bash
# run from the target root
uv sync --frozen                                              # build (env is the "build" step for Python)
uv run ruff format --check .                                  # lint (format)
uv run ruff check .                                           # lint (rules)
uv run mypy cadtools                                          # typecheck (strict on cadtools/)
uv run python -c "import cadtools, build123d, trimesh, manifold3d"   # import smoke
uv run pytest -q                                              # tests (incl. T18 coverage gate)
uv run python scripts/check_coverage.py # *coverage —, Python-adapted (OQ-1)
uv run python -c "import yaml,pathlib; d=pathlib.Path('.claude/agents/cad-step-editor.md').read_text(); \
  fm=yaml.safe_load(d.split('---')[1]); assert fm['name']=='cad-step-editor' and fm['model']=='claude-sonnet-5'"  # target smoke
```

Also run, and report honestly whatever it says (expected: not applicable to a Python scaffold — OQ-1):
`.claude/skills/mutagent-builder/scripts/cli/run.sh .claude/skills/mutagent-builder/scripts/verify/spec-impl-coverage.ts .mutagent/specs/cad-step-editor/agentspec.yaml .`

**EVALUATE later (not run at BUILD):** all five `evaluation.criteria` are behavioral over real geometry and belong to ③ EVALUATE, not to this build's gates — `output-always-valid` (needs a run over the 32 editing samples), `unrelated-geometry-preserved`, `edit-matches-instruction` (needs the synthetic triples generated and per-tier thresholds set), `budget-and-emission-discipline` (BUILD proves the *mechanism* refuses round 6; EVALUATE proves the agent stays inside it in the wild), `beats-same-model-baseline` (needs both arms run). Likewise all five `evaluation.scenarios` (`parametric-dimension-edit`, `feature-add-remove`, `complex-multifeature-edit`, `ambiguous-or-impossible-instruction`, `degenerate-input`), the live `hf download`, and any leaderboard submission.

## Pinned docs crawled (fresh, by purpose)

> `WebFetch` is disabled in this session; the crawl was performed with `curl` over the live network at **2026-08-24T07:44Z**. No vendored or cached copy was read (satisfied). Raw responses retained in the session scratchpad.

| purpose | pinned URL | result | what it supplied |
|---|---|---|---|
| `benchmark-contract` | `https://github.com/huggingface/cadgenbench` | **200** (+ `raw.githubusercontent.com/.../main/README.md` 200, `docs/benchmark/submission.md` 200, `docs/metrics.md` 200, `docs/metrics/{cad_validity,shape_similarity,topo_match,interface_match}.md` 200, `src/cadgenbench/baseline/package.py` 200) | submission layout, `meta.json` key set, validity gate's three conditions, editing no-op renormalization + weights, surface- tolerances, IoU kernel, Betti pipeline + worked examples |
| `benchmark-data` | `https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data` | **200** (+ HF API `sha f76f965…`, 360 siblings; `201/description.yaml` + `201/edit_description.txt` + `README.md` + `sanity_check_submission.py` fetched) | 81 fixtures / 32 editing samples, per-sample file inventory, `description.yaml` field names, the local sanity-check script's dependency on the `cadgenbench` package |
| `cad-library` | `https://build123d.readthedocs.io/en/latest/` | **200** (`import_export.html`, `direct_api_reference.html`, `operations.html`, `cheat_sheet.html`, `key_concepts.html`) | exact `import_step`/`export_step` signatures, `Shape.is_valid` ⇔ `BRepCheck_Analyzer::IsValid`, `tessellate()` signature, topology accessors, the editing-operation vocabulary. **Docs are v0.11.2** |
| `agent-format` | `https://docs.claude.com/en/docs/claude-code/sub-agents` | **200 after redirect → `https://code.claude.com/docs/en/sub-agents`** | `.claude/agents/` scope + precedence, the full frontmatter field table, `model` accepting a full model ID, body-becomes-system-prompt, the new-directory restart caveat |

**Doc-pin note (not a blocker):** the `agent-format` pin now 301s to a different host. The content is live and current, so the target is not blocked; the spec's `documentation[]` URL may be worth refreshing to `https://code.claude.com/docs/en/sub-agents` on the next spec touch. Reported, not silently fixed (the card is not mine to mutate).

## Planned hierarchy

```text
/home/bruno/dev/mutagent/playground/cad-agents/stl-agent
├── .claude/agents/cad-step-editor.md      # ← THE spec artifact (target claude-code, format markdown)
├── pyproject.toml                          # uv project: deps + [tool.ruff] + [tool.mypy] + [tool.pytest.ini_options]
├── uv.lock                                 # committed; `uv sync --frozen` is the build gate
├── .python-version                         # 3.12
├── cadtools/ # project-local Python the agent calls over Bash (CLI-first)
│   ├── __init__.py
│   ├── mesh.py                             # T2  shared tessellation + deflection rule
│   ├── step_io.py                          # T3  # @implements step-io
│   ├── validity.py                         # T4  # @implements validity-checker
│   ├── geometry_diff.py                    # T5  # @implements geometry-differ
│   ├── scoring.py                          # T6  # @implements local-scorer
│   ├── complexity.py                       # T7  # @implements complexity-grader
│   ├── synthetic_pairs.py                  # T8  # @implements synthetic-pair-generator
│   ├── budget.py                           # T9  5-round ledger (code-enforced constraint)
│   ├── cli.py                              # T9  python -m cadtools.cli <subcommand>
│ ├── trace.py # T10 JSONL observability sink
│   ├── manifest.py                         # T13 dataset manifest schema + validator
│   ├── dataset.py                          # T14 hf download + editing-sample selection
│   ├── package.py                          # T15 submission zip + meta.json
│   ├── aggregate.py                        # T19 run_summary.json-shaped aggregation
│   └── README.md                           # T20
├── tests/                                  # pytest; fixtures generated by build123d, never downloaded
│   ├── conftest.py
│   ├── fixtures.py                         # T16 box / through-hole / blind-pocket / two-blocks / hollow-ball / open-shell / sliver
│   ├── test_mesh.py  test_step_io.py  test_validity.py  test_geometry_diff.py
│   ├── test_scoring.py  test_complexity.py  test_synthetic_pairs.py
│   ├── test_budget.py  test_cli.py  test_trace.py  test_manifest.py
│   ├── test_dataset.py  test_package.py  test_aggregate.py
│   ├── test_fixtures.py  test_api_pin.py   # T16, T17
│   ├── test_agent_markdown.py              # T11/T12 artifact fidelity vs the spec
│ ├── test_spec_coverage.py # T18, Python-adapted
│   └── test_docs.py                        # T20
├── scripts/check_coverage.py               # T18 standalone *coverage entry point
├── datasets/                               # itemsRef paths taken verbatim from the spec
│   ├── README.md
│   ├── synthetic-edit-pairs/manifest.yaml  # schema stub; items generated at run time
│   └── real-inputs-proxy/manifest.yaml
└── runs/                                   # trace + artifact sink: runs/<run-id>/<sample>/{output.step,report.json,trace.jsonl}
    └── .gitkeep
```

*Untouched by this build:* `CLAUDE.md`, `AGENTS.md`, `.agents/`, `.codex/`, `.claude/skills/` — the MutagenT install. The only pre-existing tree we add to is `.claude/`, and only by creating `.claude/agents/`.

### Open questions for the plan-check (B4)

- **OQ-1 — the coverage gate cannot grade this scaffold.** `scripts/verify/spec-impl-coverage.ts` walks for `*.ts` only and matches tests by `\.test\.ts$`; run against a Python target it will find zero modules and report all six capabilities missing. **Proposed:** T18 implements the identical semantics for Python (`# @implements <id>` + a referencing `tests/test_*.py`) as both a pytest test and a standalone script, and the build report records the shipped script's output verbatim as not-applicable rather than as a pass. **Confirm this is acceptable, or direct me to extend the shipped script instead.**
- **OQ-2 — the local CAD-Score proxy cannot include the interface axis.** `interface_match` depends on authored keep-in/keep-out sub-volumes held in the private GT repo (the spec already lists this under `unknowns`). Proposed: emit `interface: null`, `interface_available: false`, and report a proxy renormalized over the remaining `0.6 + 0.1` weight, *plus* the raw components — never presenting the proxy as the leaderboard number. **Confirm the renormalization convention.**
- **OQ-3 — no ICP alignment; editing outputs are not canonically re-posed.** The grader aligns candidate→GT with pose-searched ICP, and `submission.md` *recommends* a canonical pose. For **editing**, the GT is a local change to `input.step` in the input's frame, so re-posing our output would destroy that correspondence and re-posing is not required. Proposed: keep the input frame, assert frame agreement (bbox-centre delta within tolerance) instead of implementing ICP, and document the deviation. **Confirm.**
- **OQ-4 — optional cross-check against the real `cadgenbench` package.** Installing it (`pip install -e ".[baseline,dev]"`, Apache-2.0, py3.12) would let `sanity_check_submission.py` validate our validity gate against the authoritative one. It pulls a heavy tree (incl. PyVista/VTK for the baseline extra). Proposed: **out of BUILD scope**, revisited at EVALUATE as a parity check. **Confirm the deferral.**

### Risks

- ** — build123d doc/wheel drift.** Docs read at v0.11.2; the resolver pins v0.11.1. Mitigated by T17 (API pin smoke) which fails loudly and by name on any drift. Not blocking.
- ** — first-agent-in-a-new-directory restart.** `.claude/agents/` does not exist yet; per the sub-agents doc the watcher only covers directories present at session start, so the operator must restart Claude Code once after this build before the subagent is invocable. Surfaced in the handoff, not fixable in code.
- ** — OCP wheel size / install time.** `cadquery-ocp-novtk` is a large native wheel; the first `uv sync` may be slow. Resolution is already proven; only download time is at risk. Non-blocking.
- ** — Betti via ray-casting is tolerance-sensitive.** Containment by ray-cast can misclassify on tangent/degenerate geometry. Mitigated by asserting T16's fixtures against the documented Betti table, which pins our implementation to the doc's own worked examples.
- ** — synthetic edits may not span the real difficulty distribution.** Our generated triples are only as hard as the recipes in T8; real benchmark instructions (e.g. sample 201: *"for each of the four non-circular pockets on the +X side of the central bore, bring their walls … inward by 6 mm"*) reference features by semantic description. This is a dataset-quality risk owned by EVALUATE, recorded here so it is not discovered late.
- ** — no network at BUILD.** Every test is offline by construction (T16); live `hf download` is exercised only at run/EVALUATE time.

<!-- =========================================================================
     BUILD RESULT — appended AFTER execution of the READY plan.
     ========================================================================= -->
## BUILD RESULT · completed after execution

**Executed:** 2026-08-24, phases B5 (execute the READY plan, tests-first) + B6 (gates).
**Overall:** `ALL GREEN` — 9/9 gates pass. 194 tests, 0 failures, 0 skips, 0 xfails.
**Spec back-reference :** this implementation points UP at
`.mutagent/specs/cad-step-editor/agentspec.yaml` (`metadata.id: cad-step-editor`, version `0.1.0`).
The spec was NOT mutated by this build.

### Files changed

37 files written, all inside the planned artifact set. Nothing outside it was touched.

```text
/home/bruno/dev/mutagent/playground/cad-agents/stl-agent
├── .claude/agents/cad-step-editor.md          # THE spec artifact (7 289 B; prompt 2 341 B verbatim + 4 948 B additive)
├── pyproject.toml · uv.lock · .python-version · .gitignore
├── cadtools/                                  # 15 modules + README (2 806 lines)
│   ├── __init__.py          package doc + CAPABILITY_MODULES map
│   ├── mesh.py              T2  shared tessellation / welding / topology primitives
│   ├── step_io.py           T3  # @implements step-io
│   ├── validity.py          T4  # @implements validity-checker
│   ├── geometry_diff.py     T5  # @implements geometry-differ   (+ A4 frame agreement)
│   ├── scoring.py           T6  # @implements local-scorer      (+ A3 proxy convention)
│   ├── complexity.py        T7  # @implements complexity-grader
│   ├── synthetic_pairs.py   T8  # @implements synthetic-pair-generator
│   ├── budget.py            T9  5-round ledger + emission decision (A2)
│   ├── cli.py               T9  12 subcommands, JSON stdout, exit-code gates
│ ├── trace.py T10 JSONL observability sink
│   ├── manifest.py          T13 dataset manifest schema + validator
│   ├── dataset.py           T14 hf download + editing-sample selection
│   ├── package.py           T15 submission zip + meta.json
│   ├── aggregate.py         T19 run summary + harness-vs-baseline comparison
│   └── README.md            T20 operator entry doc
├── tests/                                     # 21 files, 194 tests (3 006 lines)
│   ├── conftest.py          fixtures + session-wide network guard
│   ├── fixtures.py          T16 build123d-GENERATED geometry (nothing downloaded)
│   └── test_*.py            19 test modules (per-file counts below)
├── scripts/check_coverage.py # T18 gate, Python-adapted (OQ-1/A5)
├── datasets/
│   ├── README.md
│   ├── synthetic-edit-pairs/manifest.yaml     # schema stub, items: []
│   └── real-inputs-proxy/manifest.yaml        # schema stub, items: []
└── runs/.gitkeep                              # trace + artifact sink root
```

**Untouched, as required:** `CLAUDE.md`, `AGENTS.md`, `.agents/`, `.codex/`, `.claude/skills/`,
and every pre-existing file under `.claude/agents/` (10 sibling agents). `.mutagent/` was
written ONLY at this report path.

Per-file test counts:

| File | Tests | | File | Tests |
|---|---:|---|---|---:|
| `test_scoring.py` | 21 | | `test_validity.py` | 9 |
| `test_agent_markdown.py` | 17 | | `test_mesh.py` | 9 |
| `test_cli.py` | 15 | | `test_fixtures.py` | 9 |
| `test_geometry_diff.py` | 12 | | `test_complexity.py` | 9 |
| `test_synthetic_pairs.py` | 11 | | `test_step_io.py` | 8 |
| `test_budget.py` | 11 | | `test_spec_coverage.py` | 8 |
| `test_aggregate.py` | 11 | | `test_manifest.py` | 8 |
| `test_package.py` | 10 | | `test_dataset.py` | 8 |
| `test_trace.py` | 7 | | `test_docs.py` | 6 |
| `test_api_pin.py` | 5 | | **total** | **194** |

### TDD gates

All nine run from the target root. Output is the real, verbatim tail.

| # | Gate | Result |
|---|---|---|
| 1 | `uv sync --frozen` | **PASS** (exit 0) |
| 2 | `uv run ruff format --check .` | **PASS** (exit 0) |
| 3 | `uv run ruff check .` | **PASS** (exit 0) |
| 4 | `uv run mypy cadtools` | **PASS** (exit 0) |
| 5 | import smoke | **PASS** (exit 0) |
| 6 | `uv run pytest -q` | **PASS** (exit 0) — 194 passed |
| 7 | `uv run python scripts/check_coverage.py` | **PASS** (exit 0) — 6/6 capabilities |
| 8 | shipped `spec-impl-coverage.ts` | **NOT APPLICABLE** (exit 1) — see A5 below; *not* recorded as a pass |
| 9 | frontmatter target smoke | **PASS** (exit 0) |

```text
### GATE 1: uv sync --frozen
Audited 71 packages in 9ms
exit=0

### GATE 2: ruff format --check .
40 files already formatted
exit=0

### GATE 3: ruff check .
All checks passed!
exit=0

### GATE 4: mypy cadtools
Success: no issues found in 15 source files
exit=0

### GATE 5: import smoke
imports ok 0.1.0
exit=0

### GATE 6: uv run pytest -q
........................................................................ [ 37%]
........................................................................ [ 74%]
..................................................                       [100%]
194 passed in 71.61s (0:01:11)
pytest exit=0

### GATE 9: frontmatter target smoke
frontmatter smoke OK — name=cad-step-editor model=claude-sonnet-5 tools=Read, Write, Edit, Glob, Grep, Bash
systemPrompt byte-verbatim prefix: 2341 bytes; additive remainder: 4948 bytes
exit=0
```

Never run with `--no-verify`. No gate was skipped, relaxed, or re-scoped to pass.

### Spec implementation coverage

`uv run python scripts/check_coverage.py` — **verbatim output, exit 0**:

```text
tool-id                   module                  test                      covered
------------------------  ----------------------  ------------------------  -------
step-io                   step_io.py              test_cli.py               ✓
validity-checker          validity.py             fixtures.py               ✓
geometry-differ           geometry_diff.py        test_geometry_diff.py     ✓
local-scorer              scoring.py              fixtures.py               ✓
complexity-grader         complexity.py           test_complexity.py        ✓
synthetic-pair-generator  synthetic_pairs.py      test_synthetic_pairs.py   ✓
[coverage] PASS — all 6 code capabilit(y/ies) implemented + tested.
```

**Read the `test` column carefully.** It names the FIRST file that references the module, not
the best one, because the shipped gate's semantics are `find` (first match) and A5 required
those semantics be mirrored rather than improved. `tests/` is walked in sorted order, so
`fixtures.py` (which imports `cadtools.validity` and `cadtools.scoring` to assert the
documented Betti table) sorts ahead of the dedicated modules. The dedicated tests DO exist and
DO run — `test_validity.py` (9 tests), `test_scoring.py` (21), `test_step_io.py` (8). The full
mapping is:

| Capability | Module | Dedicated test module | Tests |
|---|---|---|---|
| `step-io` | `cadtools/step_io.py` | `tests/test_step_io.py` | 8 |
| `validity-checker` | `cadtools/validity.py` | `tests/test_validity.py` | 9 |
| `geometry-differ` | `cadtools/geometry_diff.py` | `tests/test_geometry_diff.py` | 12 |
| `local-scorer` | `cadtools/scoring.py` | `tests/test_scoring.py` | 21 |
| `complexity-grader` | `cadtools/complexity.py` | `tests/test_complexity.py` | 9 |
| `synthetic-pair-generator` | `cadtools/synthetic_pairs.py` | `tests/test_synthetic_pairs.py` | 11 |

No `backed_by` refs are declared in this spec, so the dangling-ref check is vacuously clean.

### Amendment dispositions (A1–A5)

| # | Amendment | Disposition | Where |
|---|---|---|---|
| **A1** | Byte-for-byte prefix assertion on the system prompt; additive-only remainder; keep the model-pin test; T12 appendix recorded as approximated/extended | **DONE** | `tests/test_agent_markdown.py::test_system_prompt_is_the_exact_leading_prefix_of_the_body` (asserts both `body[:len(p)] == p` and the UTF-8 byte slice), `::test_remainder_after_the_prompt_is_additive_only` (remainder non-empty, opens on a `---` boundary, prompt occurs exactly once at index 0, prompt not repeated in the remainder), `::test_model_pin_is_verbatim` retained. The `.md` is GENERATED by copying `spec.agent.systemPrompt` programmatically — it was never retyped. |
| **A2** | `test_budget_exhaustion_still_emits`, `test_all_checks_pass_exits_early`, and assert the ledger COUNT is exactly 5 | **DONE** | `tests/test_budget.py::test_ledger_allows_exactly_five_implement_verify_iterations` asserts `iterations == 5` (not merely that a 6th is refused), plus `::test_sixth_round_is_refused`, `::test_all_checks_pass_exits_early` (asserts `iterations == 1` and `rounds_remaining == 4`), `::test_budget_exhaustion_still_emits` (exhausted budget reaches EMIT with `status == "least-broken"` and a reason). Enforced in `cadtools/budget.py`; exposed through `cli.py round` (exit 4) and `cli.py emit`. |
| **A3** | Field is `cad_score_proxy` (never `cad_score`), `interface: null`, `interface_available: false`, raw un-renormalized components, identical convention on both arms | **DONE** | `cadtools/scoring.py`: `PROXY_CONVENTION = "cad-score-proxy/v1:interface-null-renormalized-0.7"`, `EditingScorecard.to_dict()` emits `cad_score_proxy`, `interface: None`, `interface_available: False`, `proxy_weight_total: 0.7`, `weights{}`, and `raw_components{shape_renormalized, interface: None, topology_match}`. Tests `::test_proxy_never_named_cad_score`, `::test_proxy_reports_interface_null`, `::test_proxy_reports_raw_unrenormalized_components`. Both arms: `cadtools/aggregate.py` stamps the same `convention` on every summary, and `compare_arms` **raises** if two summaries disagree on convention or sample set (`test_aggregate.py::test_compare_arms_requires_the_same_convention`). |
| **A4** | Frame agreement is a HARD failing check (bbox centre + extent delta); mis-posed pairs fail loudly; deviation row cited | **DONE** | `cadtools/geometry_diff.py::check_frame_agreement` + `FrameDisagreementError`; raised by `diff_shapes` AND by `scoring.score_editing_sample`. Tolerance is 10 % of the reference bbox diagonal — deliberately generous so a legitimate dimension change passes while a re-pose fails (`test_geometry_diff.py::test_frame_agreement_passes_for_a_legitimate_dimension_change` vs `::test_frame_agreement_fails_for_a_translated_body` / `::test_frame_agreement_fails_for_a_rotated_body` / `::test_diff_raises_loudly_on_a_mis_posed_pair`, `test_scoring.py::test_mis_posed_candidate_fails_loudly`). Deviation row below. |
| **A5** | T18 mirrors the shipped gate's failure vocabulary; run the shipped script and record verbatim as not-applicable, never as a pass; carry OQ-4, the doc-pin 301 and into the EVALUATE handoff | **DONE** | `scripts/check_coverage.py` emits `[coverage] PASS — …` / `[coverage] STEER — uncovered: …`, exit 0/1, and reuses the shipped reason strings (`no module carries …`, `… has no test referencing it`, `dangling job.backed_by → …`). `tests/test_spec_coverage.py::test_cli_vocabulary_mirrors_the_shipped_gate` pins the wording. Shipped-script output recorded verbatim below. Handoff items carried. |

#### A5 — shipped TypeScript gate, verbatim output

`.claude/skills/mutagent-builder/scripts/cli/run.sh
.claude/skills/mutagent-builder/scripts/verify/spec-impl-coverage.ts
.mutagent/specs/cad-step-editor/agentspec.yaml .` → **real exit code 1**:

```text
tool-id            module                          test                 covered
─────────────────  ──────────────────────────────  ───────────────────  ───────
step-io            —                               —                    ✗
  └─ no module carries `// @implements step-io`
validity-checker   —                               —                    ✗
  └─ no module carries `// @implements validity-checker`
geometry-differ    —                               —                    ✗
  └─ no module carries `// @implements geometry-differ`
local-scorer       —                               —                    ✗
  └─ no module carries `// @implements local-scorer`
complexity-grader  —                               —                    ✗
  └─ no module carries `// @implements complexity-grader`
synthetic-pair-generator  —                               —                    ✗
  └─ no module carries `// @implements synthetic-pair-generator`
[coverage] STEER — uncovered: step-io, validity-checker, geometry-differ, local-scorer, complexity-grader, synthetic-pair-generator
```

**Classification: not-applicable — TypeScript-only collector.** This is NOT a pass, and it is
NOT a real STEER. The script walks for files ending in `.ts` (`e.name.endsWith(".ts")`) and
matches tests by `\.test\.ts$`; against a Python scaffold it finds zero candidate files, so
every capability is reported uncovered regardless of what was built. The result is exactly
what OQ-1 predicted, and it is recorded here rather than suppressed. The load-bearing gate for
this target is gate 7 (`scripts/check_coverage.py`), which implements identical semantics for
Python and returned PASS.

### Plan-to-actual delta

| # | Planned | Actual | Why |
|---|---|---|---|
| | `.claude/agents/` does not exist; creating it triggers Risk (restart needed) | The directory **already existed** with 10 MutagenT agents at build time | The environment changed between the survey and execution. is *softened*, not eliminated — the directory was present at session start, so the watcher covers it, but a running session still will not see a newly-added file until it restarts. Still carried in the handoff. |
| | build123d resolves to `0.11.1` (docs read at `0.11.2`, Risk) | Confirmed `0.11.1`; `trimesh 5.0.0`, `manifold3d`, `numpy 2.5.2`, `cadquery-ocp-novtk` | T17 (`tests/test_api_pin.py`, 5 tests) passes against the pinned wheel: every documented symbol and signature the scaffold relies on exists. is now guarded by a test rather than by hope. |
| | mypy "strict on `cadtools/`" | `strict = true` with **seven** relaxations (`pyproject.toml` lines 49–59): `disable_error_code = ["no-any-return", "misc", "type-arg", "unused-ignore"]`, plus `disallow_untyped_calls = false`, `disallow_subclassing_any = false`, `warn_return_any = false`, plus the pre-planned `ignore_missing_imports = true` | **An earlier version of this row disclosed only `type-arg` and `unused-ignore`; that was inaccurate and is corrected here.** Rationale per code: `type-arg` — build123d's `Shape` is generic over its OCCT wrapper, and spelling `Shape[Any]` at ~25 boundaries adds noise without safety. `unused-ignore` — OCP's stubs vary between wheels, so `# type: ignore` on OCP imports is required on some builds and unused on others. `no-any-return` / `misc` / `warn_return_any` / `disallow_subclassing_any` — build123d and trimesh return untyped values across almost every call. `disallow_untyped_calls` — measured exposure: re-enabling only the two originally-disclosed codes surfaces exactly **4** errors, all `no-untyped-call` at trimesh boundaries (trimesh ships no stubs). The relaxations are therefore third-party-boundary noise, not suppressed findings in our own code — but the claim "every other strict check is on" was false and has been removed. One **real** bug did survive the relaxations and was caught: `Solid.intersect` returns `ShapeList \| None`, which `_fill_hole` dereferenced unguarded (now raises a named error). Rationale is recorded in `pyproject.toml`. |
| | ruff `exclude = [...]` | `extend-exclude = [...]` | `exclude` REPLACES ruff's defaults, which pulled `.venv` into the lint (8 104 files, 100 660 findings). `extend-exclude` keeps the defaults. Recorded in `pyproject.toml`. |
| | T16 check: `test_no_test_touches_the_network` "asserts no `hf`/`requests` call in the suite" | Implemented as a **session-wide socket guard** in `conftest.py` (`socket.socket.connect` and `socket.create_connection` raise `NetworkAccessDenied`), asserted by `test_fixtures.py::test_no_test_touches_the_network` | A lexical grep for suspicious tokens can be spelled around; closing the socket layer cannot. Strictly stronger than planned. |
| | T20 check: "Rendered links resolve" | Replaced with `test_docs.py::test_relative_links_resolve`, a real runner that resolves every relative markdown link against the filesystem | Per the architect's in-passing note: the original check had no executable meaning. `tests/test_docs.py` added to T20's artifacts (6 tests). |
| | `cadtools/__init__.py` listed in the tree but assigned to no task | Assigned and written: package docstring (import-surface rationale) + `__version__` + `CAPABILITY_MODULES` map | Per the architect's in-passing note. |
| | Betti pipeline lives in `scoring.py` (T6); `geometry_diff.py` (T5) needs it for `betti_delta` | Kept in `scoring.py` as planned; `geometry_diff` imports it **function-locally** | `scoring` imports `check_frame_agreement` from `geometry_diff` (A4), so a module-level import would cycle. The plan's module assignment is preserved; the import site is documented in code. |
| | CLI subcommands `analyze\|verify\|score\|grade\|gen-pairs\|round\|emit\|package` (8) | 12: the planned 8 plus `diff`, `list-recipes`, `fetch-dataset`, `aggregate` | `diff` is required by SOP VERIFY step (b) (LOCALITY) and was implicit in T5; `fetch-dataset` surfaces T14; `aggregate` surfaces T19; `list-recipes` surfaces T8. Each is a thin CLI face on an already-planned module — no new capability. |
| | (not planned) | `cadtools/step_io.py::_detached` context manager | Discovered during T3: `import_step` returns a shape whose `parent` is an unlabelled assembly `Compound`, and build123d's STEP writer walks up to it and fails with `RuntimeError: Failed to write STEP file` on **any** import→export round-trip. Every editing sample is an import→export round-trip, so without this the agent could not emit a single `output.step`. Caught by `test_step_io.py::test_roundtrip_preserves_topology`. |
| | (not planned) | `validity.py::_brep_naked_edges` uses OCCT's `TopExp::MapShapesAndAncestors` | The first implementation keyed edges geometrically and reported every through-hole and every sphere as leaking (a cylinder's seam edge is legitimately used once; a sphere's pole edges are degenerate). The ancestor map uses OCCT's own shape identity and skips degenerate edges. Caught by `test_validity.py::test_through_hole_part_passes` / `::test_hollow_ball_passes`. |
| | (not planned) | `scoring.py::betti_numbers` probes containment from a point **on** each shell, not its centroid | The centroid of a hollow body's OUTER shell lies inside its INNER shell, so a centroid probe reported both shells as enclosed and returned `(0,0,2)` for the hollow ball instead of `(1,0,1)`. Caught by `test_scoring.py::test_betti_hollow_ball_has_an_enclosed_void`. Mitigates Risk alongside the 5-direction majority vote. |
| | `runs/<run-id>/<sample>/…` sink | As planned, plus `ledger.json` in the same directory | The round budget must survive across separate CLI invocations (each `round` call is its own process), so the ledger is persisted beside the trace. Documented in `cadtools/README.md`. |

**No planned task was dropped.** T1–T20 are all implemented.

### Fidelity + loss (builder's claimed fidelity — the authoritative table is the architect's, B7)

| Spec element | Disposition | Note |
|---|---|---|
| `agent.systemPrompt` | **verbatim** | Byte-for-byte leading prefix of the artifact body; copied programmatically, asserted by A1 test. |
| `agent.persona`, `agent.workflow.inline` (5 nodes), `agent.triggers` | **approximated/extended** | Rendered as the T12 appendix AFTER the verbatim prompt: a node→command table, the round-budget protocol, the output contract, the scoring caveats and the boundaries. This is additive prose, not a restatement — it adds the *tool bindings* the spec does not enumerate. Behavioural adherence is EVALUATE, not BUILD. |
| `agent.operatingType: automation` | **implicit** | Expressed as a manual-trigger subagent with no autonomous scheduling. No target primitive corresponds. |
| `capabilities.code` ×6 | **implemented** | Coverage table above; gate 7 PASS. |
| `capabilities.skills: []`, `delegates: []` | **honoured** | No skill and no subagent is scaffolded — which is also what keeps "verification is code, never a second LLM opinion" structurally true. |
| `context.sample-inputs` / `geometry-introspection` / `benchmark-dataset` | **implemented** | `tools: Read, Write, Edit, Glob, Grep, Bash` grant; `cadtools.cli` for introspection; `cadtools/dataset.py` for `hf`. |
| `actions.execute-cad-edit-code` (+ evidence clause) | **implemented** | `runs/<run>/<sample>/round-<n>.py` + `trace.jsonl` capture script, output and per-round report. |
| `actions.write-outputs` (onFailure: never overwrite a better attempt) | **implemented** | `budget.RoundLedger.best_valid` — highest score, ties to the EARLIEST round; a valid attempt never loses to an invalid one however high it scores. |
| `actions.package-submission-zip` (approval: human-gate-downstream) | **implemented** | `cadtools/package.py` + `cli package`. No upload path exists anywhere in the scaffold; `agree_to_publish` defaults false. |
| Constraint "≤5 rounds, always emit" | **implemented (code-enforced)** | A2. |
| Constraint "verification is deterministic code" | **implemented** | All checkers are pure geometry; the prompt forbids self-assessment; no LLM is invoked from `cadtools`. |
| Constraint "model pinned to claude-sonnet-5" | **verbatim** | `model: claude-sonnet-5` in frontmatter (the full-model-ID form is documented as accepted; no re-target). |
| Constraint "all work is local; submission is a human act" | **implemented** | Packaging only; boundaries section in the artifact. |
| `evaluation.datasets[].itemsRef` ×2 | **implemented (schema only)** | Stub manifests with `items: []`; paths asserted equal to the spec strings. |
| **`interface_match` axis of the CAD Score** | **LOSS — cannot be computed locally** | Keep-in/keep-out sub-volumes are authored privately (the spec already lists this under `unknowns`). Emitted as `interface: null` / `interface_available: false`, proxy renormalized over 0.7, raw components retained. Per A3/OQ-2. |
| **ICP pose alignment used by the grader** | **DEVIATION — deliberate, cited** | `submission.md` *recommends* a canonical pose. For EDITING, the ground truth is a local change to `input.step` in the input's own frame, so re-posing would destroy the correspondence `b_shape = shape_similarity(input, GT)` depends on. No ICP is implemented; instead frame agreement is a HARD failing check (A4/OQ-3). Consequence: a candidate that IS legitimately re-posed will be rejected rather than aligned. |
| **Absolute leaderboard parity** | **LOSS — unverified at BUILD** | Our validity gate and metrics are transcribed from the docs and anchored to the docs' worked Betti examples, but they have never been run against the authoritative `cadgenbench` implementation. Deferred to EVALUATE per OQ-4. |
| `evaluation.criteria` ×5, `evaluation.scenarios` ×5 | **deferred to EVALUATE** | All are behavioural over real geometry. BUILD proves the *mechanisms* (validity gate exists and fails correctly; the differ localizes; the ledger refuses round 6; both arms exist and are comparable); it does not prove the agent's behaviour in the wild. |

**Silence about loss would be a failure, so, stated plainly:** the local number is a proxy
missing 30 % of the real composite's weight, it has never been cross-checked against the
authoritative implementation, and the synthetic dev set's difficulty is bounded by the six
recipes in T8 — real instructions (e.g. sample 201's "for each of the four non-circular pockets
on the +X side of the central bore…") reference features semantically in a way our recipes do
not. Risk stands, unmitigated by this build.

### Provider best-practices (dogfood) + observability

- **Prompt caching:** the artifact places the entire static payload — persona, procedure, tool
  protocol, budget rules, boundaries — as ONE contiguous prefix ahead of any per-sample
  content, which is what Claude Code caches for a subagent system prompt. No provider caching
  API is called by hand (the sub-agents doc gives no such API for this target; inventing one
  would have been a guess).
- **Observability sink:** `runs/<run-id>/<sample-id>/trace.jsonl`, append-only JSONL, one
  object per event with `{ts, seq, run_id, sample_id, event, data}`. Paths are **relative**,
  asserted by `test_trace.py::test_trace_path_is_relative`. `trace.iter_run_traces()` lets
  EVALUATE/DIAGNOSE discover traces with no configuration.
- **UniTF capture wrap (secondary):** NOT scaffolded. This target is a
  `harness:claude-code` subagent, not a bare code agent, so the harness is the run boundary
  and there is no `runAgent` entry point to wrap. The JSONL sink above is the evidence source.

### Verifier findings

_pending — architect verify (B7)._

## EVALUATE handoff bundle

Carried forward per A5, plus what B5/B6 surfaced:

1. **OQ-4 parity cross-check (named item, deferred from BUILD by approved ruling).** Install the
   real `cadgenbench` package (`pip install -e ".[baseline,dev]"`, Apache-2.0, py3.12) and run
   the dataset's own `sanity_check_submission.py` against our outputs, to check our validity
   gate and metric transcriptions against the authoritative implementation. It pulls a heavy
   tree (PyVista/VTK via the `baseline` extra), which is why it is not a build gate. **Until
   this runs, "benchmark-parity" is a claim about our reading of the docs, not a measured fact.**
2. **The proxy structurally omits 30 % of the composite's weight — thresholds must account for
   it.** EVALUATE will set its pass thresholds against `cad_score_proxy`, which is NOT the
   leaderboard's `cad_score`: the `interface_match` axis carries **0.3 of the 1.0 editing
   weight** and depends on keep-in / keep-out sub-volumes authored in the benchmark's private
   ground-truth repository, so it cannot be computed here. It is emitted as `interface: null`
   with `interface_available: false`, and the proxy is renormalized over the remaining
   `0.6 + 0.1 = 0.7`. Two consequences EVALUATE must handle explicitly: (a) a per-tier threshold
   calibrated on the proxy says nothing about the 30 % of the score it never observed — a
   candidate can clear every local threshold and still lose leaderboard points on interface
   match; (b) the harness-vs-baseline comparison (`beats-same-model-baseline`) is a comparison
   of proxies, valid only because BOTH arms use the identical convention — it does not
   generalise to a claimed `cad_score` delta. Do not report a proxy figure as a benchmark
   score, and state the omitted axis wherever a threshold or a delta is published.
3. **Agent-format doc-pin 301.** `spec.targets[claude-code].documentation[agent-format]` points
   at `https://docs.claude.com/en/docs/claude-code/sub-agents`, which 301-redirects to
   `https://code.claude.com/docs/en/sub-agents`. The content is live and current, so the target
   is not blocked. Reported, not silently fixed — the card is not the builder's to mutate.
4. **Risk — Claude Code restart before the subagent is invocable.** `.claude/agents/` already
 existed at build time (delta), so the watcher covers the directory; but a session that was
   already running when `cad-step-editor.md` was written will not see it. **Restart Claude Code
   once before invoking the subagent.**
5. **Risk — synthetic difficulty gap.** The six T8 recipes are dimensionally parameterised
   but structurally simple. Real benchmark instructions reference features by semantic
   description. Set per-tier pass thresholds from the REAL slice, not from the synthetic one.
6. **Both arms, one convention.** `aggregate.compare_arms` refuses to compare runs with
   different conventions or sample sets. Run the baseline arm with `cli round --no-verify-loop`
   (round budget 1, same model, same prompt) so the loop is the only variable.
7. **Frame discipline is enforced.** A candidate exported in a different pose raises
   `FrameDisagreementError` rather than scoring badly. If EVALUATE sees that error, it is a
   pipeline bug (something re-posed the output), not a bad edit.
8. **Not run at BUILD, by design:** every `evaluation.criteria` (×5) and `evaluation.scenarios`
   (×5), the live `hf download`, and any leaderboard submission.

<!-- =========================================================================
     B7 VERIFY — independent architect verification. Appended by ai-architect.
     Read-only on source: no file outside this report was written by B7.
     ========================================================================= -->
## B7 · Architect VERIFY — independent

**Method:** Context-Inversion. Every gate was RE-RUN from the target root by the verifier; no
reported result was accepted on trust. A1 byte-fidelity was re-derived independently from the
YAML rather than read off the builder's test. The write boundary was checked by mtime sweep, not
by the builder's file list.

### Independent gate re-run

| # | Gate | Builder reported | **Verifier re-ran** | Agree |
|---|---|---|---|---|
| 1 | `uv sync --frozen` | PASS | **PASS** — `Audited 71 packages` | ✅ |
| 2 | `uv run ruff format --check .` | PASS | **PASS** — `40 files already formatted` | ✅ |
| 3 | `uv run ruff check .` | PASS | **PASS** — `All checks passed!` | ✅ |
| 4 | `uv run mypy cadtools` | PASS | **PASS** — `no issues found in 15 source files` | ✅ (see V1 on its *strictness*) |
| 6 | `uv run pytest -q` | 194 passed | **194 passed in 76.60s**, 0 fail / 0 skip / 0 xfail | ✅ |
| 7 | `uv run python scripts/check_coverage.py` | PASS 6/6 | **PASS 6/6**, exit 0 | ✅ |
| 8 | shipped `spec-impl-coverage.ts` | NOT APPLICABLE (exit 1) | classification **upheld** — the collector is `.ts`-only; a false STEER, correctly not recorded as a pass | ✅ |
| 9 | frontmatter target smoke | PASS | **PASS** — `name=cad-step-editor`, `model=claude-sonnet-5` | ✅ |

**Claimed-green is actually green.** No ABORT condition on the TDD leg. Independently confirmed
the suite contains no `skip` / `xfail` / mocked-away assertions, so the 194 are real.

**A1 re-derived independently.** Loaded `spec.agent.systemPrompt` from the YAML, stripped the
artifact's frontmatter, compared byte slices:

```text
spec systemPrompt : 2341 bytes  sha256 53cf947a7004acb4…
artifact body[:n] : 2341 bytes  sha256 53cf947a7004acb4…
EXACT PREFIX MATCH: True    occurrences in body: 1 (at index 0)    additive remainder: 4948 bytes
```

The prompt is byte-verbatim, appears exactly once, at index 0, and the remainder opens on a
`---` boundary — additive only. ** honored; no prompt drift.**

**Model intent.** `model: claude-sonnet-5` verbatim in frontmatter, matching the spec
constraint string at `spec.intent.constraints[0]`. **No silent swap — no ABORT condition.**

**Write boundary — CLEAN.** mtime sweep over the whole target root: every file modified in the
build window (09:51–11:08) is inside the planned artifact set. Confirmed **untouched** at their
pre-build 08:54 timestamps: `CLAUDE.md`, `AGENTS.md`, `.agents/`, `.codex/`, `.claude/skills/`,
and all **10 sibling agents** in `.claude/agents/`. `.mutagent/specs/` is untouched since 09:32 —
**the spec was not mutated by this build (confirmed).** `.mutagent/` was written only at
the report path.

### Fidelity + loss table (authoritative — B7)

| # | Spec requirement | Implemented where | Check → observed | Disposition |
|---|---|---|---|---|
| 1 | SOP `edit-one-sample` (analyze→plan→implement→verify→iterate≤5→emit) | artifact §Tool protocol; `cli.py`, `budget.py` | node→command table present; `round` refuses 6th | **honored** |
| 2 | SOP `build-dev-dataset` | `dataset.py`, `synthetic_pairs.py`, `complexity.py`, `manifest.py` | `test_dataset.py` (8), `test_synthetic_pairs.py` (11) | **honored** |
| 3 | SOP `package-submission` (+ never upload) | `package.py`, artifact §Boundaries | `test_package.py` (10); no upload path exists in the scaffold | **honored** |
| 4 | job `apply-step-edit` | `step_io.py`, `geometry_diff.py`, `cli.py` | round-trip + diff tests green | **honored** |
| 5 | job `grade-complexity` | `complexity.py` | `test_complexity.py` incl. determinism | **honored** |
| 6 | job `build-synthetic-pairs` | `synthetic_pairs.py` | covers all 5 `editType` values | **honored** |
| 7 | job `score-locally` | `scoring.py` | 21 tests; Betti worked examples from `topo_match.md` reproduced | **honored** (interface axis — row 22) |
| 8 | constraint ≤5 rounds, always emit | `budget.py` `MAX_ROUNDS = 5` | `iterations == 5` asserted; 6th refused; exhausted budget still emits | **honored (code-enforced)** |
| 9 | constraint "verification is deterministic code, never a 2nd LLM" | all checkers pure geometry; artifact §Verification is code | no LLM call in `cadtools/`; `delegates: []` respected | **honored** |
| 10 | constraint model pinned `claude-sonnet-5` | frontmatter | verbatim, re-verified | **honored** |
| 11 | constraint all work local; submission is a human act | `package.py`; artifact §Boundaries | `agree_to_publish` defaults false | **honored** |
| 12 | nonGoals (generation task, no upload, no GUI) | — | nothing scaffolded for any of the three | **honored** |
| 13 | `context.sample-inputs` [read, list] | `tools:` grant Read/Glob/Grep | frontmatter smoke | **honored** |
| 14 | `context.benchmark-dataset` [download] via `hf` | `dataset.py` | selection keys on `task_type == editing`, not the `2xx` prefix | **honored** |
| 15 | `context.geometry-introspection` [execute-readonly-analysis] | `cli analyze` / `grade` | JSON readback | **honored** |
| 16 | `actions.execute-cad-edit-code` + evidence clause | `trace.py`, `runs/<run>/<sample>/` | script + stdout/stderr + per-round report captured | **honored** |
| 17 | `actions.write-outputs` onFailure (never overwrite a better attempt) | `budget.RoundLedger.best_valid` | valid never loses to invalid; ties to earliest round | **honored** |
| 18 | `actions.package-submission-zip`, approval `human-gate-downstream` | `package.py` + artifact §Boundaries | packaging autonomous, upload absent by construction | **honored** |
| 19 | `capabilities.code` ×6 | 6 modules with `# @implements` | gate 7 PASS 6/6, re-run by verifier | **honored** |
| 20 | `capabilities.skills: []` / `delegates: []` | — | none scaffolded | **honored** |
| 21 | `agent.systemPrompt` | artifact body prefix | byte-verbatim, re-derived (above) | **honored (verbatim)** |
| 22 | `agent.persona` / `workflow.inline` 5 nodes / `triggers` | artifact appendix | all 5 node ids rendered with their bound command; bounded loop stated | **approximated/extended** — additive prose adding tool bindings the spec does not enumerate; behavioral adherence is EVALUATE |
| 23 | `agent.operatingType: automation` | manual-trigger subagent | no target primitive corresponds | **approximated** (correctly disclosed) |
| 24 | `targets[claude-code].artifact` markdown @ `.claude/agents/cad-step-editor.md` | present, 7 869 B | frontmatter valid per the sub-agents doc | **honored** |
| 25 | `evaluation.datasets[].itemsRef` ×2 | stub manifests | paths asserted byte-equal to the spec strings | **honored (schema only)** |
| 26 | **`interface_match` — 30 % of the editing composite** | not computable locally | `interface: null`, `interface_available: false`, renormalized over 0.7, named `cad_score_proxy` | **UNSUPPORTED — disclosed** (spec `unknowns[2]`; A3/OQ-2) |
| 27 | **ICP pose alignment** | not implemented; hard frame check instead | `FrameDisagreementError` raised loudly | **deviation — deliberate, cited** (A4/OQ-3) |
| 28 | **Absolute leaderboard parity** | transcribed from docs, never run against `cadgenbench` | — | **UNVERIFIED — disclosed** (OQ-4 → EVALUATE) |
| 29 | `evaluation.criteria` ×5, `scenarios` ×5 | mechanisms only | — | **deferred to EVALUATE** (correctly — all behavioral over real geometry) |

**Disposition counts:** honored 21 · approximated/extended 2 · unsupported-but-disclosed 2 ·
deliberate cited deviation 1 · deferred-to-EVALUATE 1 (covering 10 spec elements) · **omitted 0**.

**Unreported loss: none material.** The three honest losses (interface axis, unmeasured parity,
 synthetic simplicity) are each stated in the builder's own table AND in plain prose. This is
the standard B7 exists to enforce, and it was met. Two bounded corrections follow.

### Findings

**V1 — STEER (bounded, documentation-only). Delta row understates the mypy relaxation.**
 states the typecheck is strict "with `type-arg` and `unused-ignore` disabled (plus the
pre-planned `ignore_missing_imports`)" and asserts **"Every other strict check is on."**
`pyproject.toml` `[tool.mypy]` (lines 49–59) actually also sets:

```toml
disable_error_code = ["no-any-return", "misc", "type-arg", "unused-ignore"]   # 4, not 2
disallow_untyped_calls = false
disallow_subclassing_any = false
warn_return_any = false
```

Gate 4 is therefore weaker than the report claims, and "every other strict check is on" is
false. Verifier measured the real exposure — re-running mypy with **only** the two disclosed
codes disabled surfaces exactly **4** additional errors:

```text
cadtools/geometry_diff.py:290  Call to untyped function "closest_point"          [no-untyped-call]
cadtools/scoring.py:178        Call to untyped function "RayMeshIntersector"     [no-untyped-call]
cadtools/scoring.py:190        Call to untyped function "intersects_location"    [no-untyped-call]
cadtools/scoring.py:277        Call to untyped function "closest_point"          [no-untyped-call]
```

All four are `no-untyped-call` at **trimesh** boundaries — a third-party library that ships no
stubs. The suppressions are **substantively defensible**; the defect is the *report*, which
overstates the gate's strength in the permanent build record. Per B7's "silence about loss is a
failure", an under-described gate relaxation is a reportable loss.
**Amendment:** rewrite to enumerate all four disabled codes and the three relaxed flags,
state the 4 masked `no-untyped-call` findings and that they are untyped-third-party boundaries,
and delete the sentence "Every other strict check is on." **No code change. No gate re-run.**

**V2 — STEER (bounded, documentation-only). The 30 % interface loss is not a discrete EVALUATE
handoff item.** The loss is well disclosed in the fidelity table (row 26) and in the plain-prose
paragraph, but the EVALUATE handoff bundle gives discrete numbered items to the other two honest
losses (parity → item 1 → item 4) and none to this one; it appears only obliquely via item 5
("both arms, one convention"). EVALUATE will set per-tier pass thresholds against
`cad_score_proxy`, a number structurally missing 30 % of the composite's weight and therefore not
comparable to any leaderboard figure.
**Amendment:** add a numbered handoff item stating that `cad_score_proxy` covers 0.7 of the
editing composite, that thresholds must be set on the proxy's own scale, and that no proxy value
may be reported as a CAD Score. **No code change.**

**Not findings (checked, correct as built):** the `.ts`-only shipped-gate result is correctly
classified not-applicable rather than laundered into a pass (A5); `check_coverage.py` faithfully
mirrors the shipped gate's semantics *including* its first-match `test` column, and the report
pre-empts the misread– are each justified, and are three real bugs the tests
caught, not rationalizations; deferring all 10 `evaluation.criteria`/`scenarios` to EVALUATE is
the correct BUILD boundary.

### VERDICT

> ## STEER
>
> The build is **faithful, doc-grounded, and genuinely green** — all 9 gates independently
> re-run and reproduced, the system prompt byte-verbatim, the model pin honored, the write
> boundary clean, the spec unmutated, zero omitted requirements. There is **no ABORT condition**
> and **no source defect**.
>
> STEER is issued solely for **V1** and **V2**: two bounded, cited, **documentation-only**
> corrections to the build report's own accuracy — an understated gate relaxation (V1) and one
> honest loss missing from the EVALUATE handoff (V2). The Actor amends this report's row and
> handoff bundle; **no source file, no test, and no gate is touched**, so no re-run is required.
> On re-review of those two edits alone this becomes PROCEED.

**Verifier:** ai-architect (B7) · read-only · no source file written.

---

## DELTA — 2026-08-24 · bugfix: null per-face triangulation crashed the Betti pipeline

**Scope:** bounded bugfix. Writes limited to `cadtools/mesh.py`, `tests/`, and
`datasets/benchmark-complexity/` (regenerated by `datasets/grade_editing_samples.py`).
No spec change, no capability change, no gate relaxation.

### The bug

`cadtools.scoring.betti_numbers` — reached through `cadtools.mesh.tessellate` — raised

```
AttributeError: 'NoneType' object has no attribute 'NbNodes'
```

on `datasets/cadgenbench-data/242/input.step` (879 faces: 326 CYLINDER, 250 TORUS, 190
BSPLINE). `analyze` succeeded (it reads the BREP, not the mesh); `grade`, `verify` and
`score` all crashed, and sample 242 was the single `status: unavailable` record in
`benchmark-complexity/records.jsonl`.

### Root cause

BRepMesh does not guarantee a triangulation for every face. On this part it silently gives
up on **two TORUS patches of minor radius 0.5** (face indices 10 and 46, areas 2.95 and
6.32 mm²), leaving `BRep_Tool.Triangulation_s` returning a **null handle**. `tessellate`
delegated to build123d's `Shape.tessellate`, which dereferences that handle unguarded —
`poly.NbNodes()` on `None`. The trigger is the **angular** tolerance, not the linear
deflection: the same two faces stay null across deflections from 0.02 to 0.97 (a 50x
sweep), and mesh cleanly the moment the angular tolerance is relaxed past 0.1 rad. The
part's own deflection (0.243) is ~0.49x the torus minor radius, which is where BRepMesh's
angular criterion cannot place a valid fan.

### The fix

`cadtools/mesh.py` now performs the per-face triangulation readback itself instead of
delegating to build123d, so the null handle is a case it handles rather than a crash.
Recovery is a capped ladder, `ANGULAR_TOLERANCE_LADDER = (0.1, 0.2, 0.3)`:

* **The linear deflection is never touched** — it is what bounds surface deviation and
  therefore benchmark parity. Only the angular tolerance (fan density around curvature)
  relaxes.
* The ladder **stops at the first rung that triangulates every face**, so relaxation is
  minimal. Sample 242 lands on 0.2 rad.
* Re-meshing is done on the **whole shape**, not on the offending face alone. BRepMesh is
  incremental and caches the per-face failure, so only a clean re-mesh retries; and
  re-meshing a lone face re-discretizes its shared edges and cracks the mesh open along
  them (measured: 335 naked edges versus 0).
* Rung 0 reproduces build123d's `Shape.mesh` call exactly (same relative flag, parallel
  flag, and "skip if an adequate triangulation exists" guard), so **shapes that never
  needed relaxation are meshed bit-for-bit as before** — the pre-existing suite is
  unaffected, and `TessellationReport.relaxed` is `False` for every one of them.

**Correctness, not merely non-crashing.** The ladder's cap is evidence-driven. Sample 242
ships the benchmark's own reference tessellation (`input.mesh.npz`: closed, manifold,
chi = -20, **betti = (1, 11, 0)**), which is the ground truth the fix is held to:

| angular tolerance | null faces | betti | verdict |
|---|---|---|---|
| 0.1 | 2 | — | crash (the bug) |
| 0.2 | 0 | (1, 11, 0) | **correct** — selected |
| 0.3 | 0 | (1, 11, 0) | correct |
| 0.5 | 0 | (1, 8, 0) | WRONG — curvature detail lost |
| 1.0 | 0 | (1, 0, 0) | WRONG — the part collapses to a ball |

This is also why **"skip the bad face" was rejected**: dropping faces 10 and 46 does not
crash, but it holes the body open and yields **b1 = 5 against the reference's 11** — the
silent wrongness that is worse than the crash.

Faces still null after the last rung are dropped **and reported**, never absorbed: the new
`tessellate_with_report()` returns a `TessellationReport` naming the skipped face indices
(`complete` is `False`), and `tessellate()` emits an `IncompleteTessellationWarning` saying
the mesh has holes and its topology is not trustworthy. `tessellate()` keeps its exact
former signature and return type, so no call site changed.

### New tests

`tests/test_mesh_null_triangulation.py` (11 tests). A minimal *generated* fixture could not
be produced — the failure needs spline-trimmed torus patches, and four construction
families (plain/trimmed tori, filleted boxes, fillet-plus-boolean splits, and a directly
built trimmed `Geom_ToroidalSurface` at the failing UV bounds) all meshed cleanly across a
deflection sweep. So the crash path is pinned two ways:

* **Data-free**, by stubbing `_face_triangulation` to return null: no `AttributeError`; the
  skipped faces are reported; a partial mesh is left open and flagged; and a face null at
  rung 0 but meshable at rung 1 is *recovered*, restoring a closed box with chi = 2.
* **On the real trigger**, sample 242, guarded by `skipif` on the downloaded file: it
  tessellates, relaxation is required, no face is dropped, `grade` runs end to end, and
  **betti matches the shipped reference mesh exactly**.

### Verification

* `uv run pytest -q` — **204 passed** (194 pre-existing + 11 new, minus the one
  pre-existing unrelated failure noted below). Tessellation output for every
  previously-passing shape is unchanged.
* `uv run ruff check .` clean · `uv run ruff format --check .` clean · `uv run mypy
  cadtools tests` clean (37 source files).
* Determinism re-confirmed on 242: repeated calls on the same object and on a fresh import
  all produce identical vertices/faces and `(1, 11, 0)`.
* `cadtools grade` and `cadtools verify` both now complete on 242. `verify` returns a real
  verdict — `is_valid: false`, on 2 non-manifold tessellation edges with `n_naked_edges: 0`,
  alongside sliver advisories (min face area 5.9e-10 mm², max aspect ratio 4.0e8). That is
  a genuine property of this part, independent of this bug, and no longer a crash.

### Dataset regeneration

`datasets/grade_editing_samples.py` re-run in full. Sample 242 now grades
**tier `high`** (score 21.91, genus 11, feature density 3.62, surface-type variety 6,
879 faces / 2078 edges / 1203 vertices, bbox diagonal 243.0 mm) — its genus of 11 agrees
with the reference mesh's b1. Distribution moves from 31 graded / 1 unavailable to
**32 graded / 0 unavailable**, tier counts `low 0 · mid 1 · high 31` (was `high 30`), and
the `unavailable` list is now empty. The `high` tier's genus range is unchanged (0–25), so
242 does not move any tier boundary.

**Incidental artifact change:** the regenerated `records.jsonl` writes `input_path` as an
absolute path, where the previous file held repo-relative paths. This is the current
script's own behavior (`ROOT = Path(__file__).resolve().parent`), not a change made here;
flagged because it makes the file diff wider than the single 242 record.

### Pre-existing, NOT introduced here — then resolved by follow-up

`tests/test_manifest.py::test_stub_manifests_exist_and_validate` was failing, asserting
`manifest["items"] == []` for `datasets/real-inputs-proxy/manifest.yaml`, which now holds
32 populated items. That manifest was written at 11:29 by the dataset step, before any edit
in this delta; the assertion described a stub that had since been filled in. It was
unrelated to tessellation, so it was reported rather than silently re-baselined.

**Follow-up (orchestrator-authorized).** Confirmed as stale-by-lifecycle-progress rather
than corruption, and fixed. The test is renamed `test_shipped_manifests_exist_and_validate`
and now asserts the item **contract in either lifecycle state** — empty stub *or* populated
— and never emptiness:

* every item has a non-empty `id`;
* `input_path` and `instruction_path` must **exist on disk** (a manifest naming absent files
  is worse than an empty one);
* `ground_truth_path` is checked **per slice** via `GROUND_TRUTH_REQUIRED`: required and
  existing for `synthetic-edit-pairs`, and required to be **null** for `real-inputs-proxy`,
  whose ground truth is private to the benchmark — a non-null path there would mean one was
  invented.

The assertions were checked for teeth against a sandbox with the dataset symlinked so only
the mutated field differed: the unmutated manifest passes, while a missing input file, an
invented proxy ground truth, and a blank id are each caught by their own rule. Current
state exercised: `synthetic-edit-pairs` still an empty stub (0 items, so its stub state is
unchanged), `real-inputs-proxy` 32 items all validating.

**Full suite is now green: 205 passed, 0 failed.** `ruff check`, `ruff format --check` and
`mypy` remain clean.

*For the record (no action):* the concurrent writers observed during this work were the
parallel ABC-acquisition agent (`datasets/abc-raw/`) and the orchestrator appending
decisions to the spec sidecar — both expected.

---

# OPTIMIZE delta — remedy bundle – (diagnostics run-001) · 2026-08-24

⑤ OPTIMIZE pass against `.mutagent/diagnostics/run-001/report.md` and findings F-001…F-004.
Operator-approved bundle, applied tests-first, suite green throughout. **The eval slice was
NOT re-run and no score was re-computed here — re-scoring is the evaluator's act, not the
builder's.**

## Per-remedy result

| # | Status | Files touched | What landed |
|---|---|---|---|
| **** | **done** | `devtools/cadtools_devtools/synthetic_pairs.py`, `tests/test_synthetic_pairs.py`, `tests/fixtures.py`, `tests/conftest.py` | `_thicken` selects its face by **outward NORMAL** (`_upward_planar_face`), not by centre-Z position, so the direction comes from the same axis as the magnitude; it re-measures `amount`/`old_thickness`/`new_thickness` **from the produced body** and raises `PairConsistencyError` if the measurement disagrees with the request; a part with no +Z-facing planar face is **REFUSED** (`status: unavailable`), never guessed. New generation-time gate `check_pair_consistency` / `assert_pair_consistent` (table `RECIPE_CLAIMS`) runs inside `generate_pair` **before any file is written**, asserting per recipe: frame discipline (bbox min corner unchanged, every recipe), growth axis + amount, footprint invariance, and volume-delta sign. |
| **** | **done** | `cadtools/budget.py`, `cadtools/cli.py`, `tests/test_budget.py`, `tests/test_cli.py` | `best_valid` ranks `(not checks_passed, -score, round)` — a check-dirty candidate is emitted only when nothing cleaner exists, and the decision reason says so (the always-emit guarantee is preserved). `--score` is **refused** by the CLI with a reason; the harness computes the round score from recorded check outcomes (`compute_round_score`: validity 0.5 / checks 0.3 / failure-free 0.2, invalid ⇒ 0.0) or **measures** `cad_score_proxy` when `--input/--candidate/--ground-truth` are supplied. Records carry `score_source`. |
| **** | **done** | `cadtools/geometry_diff.py`, `cadtools/step_io.py`, `cadtools/cli.py`, `tests/test_geometry_diff.py`, `tests/test_cli.py` | New `step_io.surface_type_histogram`; `DiffReport` carries `surface_types_ref/cand/destroyed`, `surface_type_allowance`, `operation_class_ok`, `surface_types_available`. Rule is **proportional, not absolute** (`surface_type_destruction`): an edit that moved `changed_fraction` of the surface may destroy at most `max(1, ceil(changed_fraction × count))` faces of each type — so 9 destroyed PLANEs at `changed_fraction 0.68245` fails (allowance 7) while a fill-hole taking its one CYLINDER passes. `cadtools.cli diff` **exits 5** on violation, with `--allow-retype` as the explicit hatch. `is_localized_to` / `max_distance_outside` now have production callers via `DiffReport.locality`, emitted on every diff (explicit `--region-min/--region-max` gates and fails; otherwise the measured changed-bbox region is reported). |
| **** | **done** | `devtools/pyproject.toml`, `devtools/cadtools_devtools/__init__.py`, `pyproject.toml`, `cadtools/__init__.py`, `cadtools/cli.py`, `cadtools/README.md`, `scripts/check_coverage.py`, `scripts/check_isolation.py`, `tests/test_isolation.py`, `tests/conftest.py` | `synthetic_pairs.py` moved out of the `cadtools` namespace into a **separate distribution** `cadtools-devtools`. Runtime wheel is unchanged (`packages = ["cadtools"]`), so the eval profile install line `uv pip install.` yields a venv where `import cadtools.synthetic_pairs` **and** `import cadtools_devtools` both fail; dev profile is `uv pip install -e. -e./devtools`. `gen-pairs` / `list-recipes` stay registered and degrade to a clean, actionable error (`cli._devtools`, lazy import — no module-scope runtime dependency, pinned by test). `scripts/check_isolation.py` AST-audits `round-*.py` for denied imports (incl. `importlib.import_module` with a literal target), answer-key path literals, shelled `gen-pairs`/`list-recipes`, and unresolvable `exec`/`subprocess` hatches; non-zero exit; an empty audit is a **failure**, never a pass. |
| **** | **done** | `cadtools/geometry_diff.py`, `cadtools/scoring.py`, `cadtools/budget.py`, `cadtools/cli.py`, `tests/test_geometry_diff.py`, `tests/test_cli.py` | `check_frame_agreement` is **size-invariant**: `pose_delta = max(0, centre_delta − extent_delta/2)` (a resize about any fixed point moves the centre by at most half the extent change, so a pure resize scores 0) and `axis_permutation` (extents changed but sorted extents did not ⇒ a rotation). `shape_divergence` is reported as a third state. `EditingScorecard.status ∈ {ok, shape-divergence, invalid}` — a size disagreement is scored and labelled, not zeroed under the frame label; `FrameDisagreementError` is now reserved for genuine pose disagreement. `--allow-repose` writes a machine-readable `waivers[]` block into the diff report, and `round --waive <check>` writes `waived_checks[]` into the ledger record. |
| **** | **done** | `cadtools/cli.py`, `cadtools/geometry_diff.py`, `tests/test_cli.py`, `tests/test_geometry_diff.py`, `pyproject.toml` | Ledger: `record_valid` default `None`; `--round N`; bare `round` = **claim only**; an outcome without `--round` lands on the open claim rather than burning a slot; `recorded` in the response; double-recording a round is rejected. Diff: `_surface_distance` chunked under `DISTANCE_CHUNK_BYTES = 256 MB` with a measured candidates-per-point batch size (`MIN_CHUNK 256 … MAX_CHUNK 4096`), trimesh built **once**; `n_samples` forwarded through `diff_files`; `--samples` on the CLI; `n_samples` in the report. `slow` marker registered (`addopts = "-ra -m 'not slow'"`). |
| **** | **done, with a flag** | `.claude/agents/cad-step-editor.md` | `gen-pairs` / `list-recipes` advertisement **removed**, replaced by an explicit statement that the generator is not part of the tool surface. New appendix section *"Operation-class conservatism — what step 2 means by 'conservative'"*: the three-tier operation ranking, "thicker/taller/deeper mean material is ADDED, not that the body is stretched", preserve unnamed surface types on a dimension change, name the operation class + its invariants in the plan, and the explicit warning that the neighbouring "prefer direct BREP operations" clause does not license a whole-body transform. Verify table and round-budget section updated for the new gates and the claim/record protocol. |

### flag (for ai-architect, not actioned here)

The clause belongs in **PLAN (step 2)**, which lives **inside** `spec.agent.systemPrompt`
(2327 bytes, ending `"...never upload them.\n"`) — the region
`test_agent_markdown.py::test_system_prompt_is_the_exact_leading_prefix_of_the_body` pins
byte-for-byte. Editing the card there without the spec would break the prefix property; editing
the spec is a definition change and therefore ai-architect's, not this actor's. **The clause is
staged in the appendix.** `"5 rounds"`, `"at most 5"` and `"round 6"` are intact; all 17
`test_agent_markdown` tests pass. Recommended cascade: fold the conservatism clause into
`spec.agent.systemPrompt` step 2, re-emit the card, drop the appendix duplicate.

## Dataset repair — thicken cases (F-001 follow-up)

`datasets/synthetic-edit-pairs/regen_thicken.py` audits every published `thicken` triple
against the claim its own instruction makes, and regenerates the rejects.

**19 thicken cases audited · 6 rejected · 0 regenerated · 6 REFUSED.**

| id | why the published GT was rejected | regeneration outcome |
|---|---|---|
| `abc_0011-thicken` | Z grew 0.0 mm, instruction claims 5.15 mm | refused — no +Z-facing planar face |
| `abc_0056-thicken` | Z grew 7.8411 mm, instruction claims 7.9 mm | refused — no +Z-facing planar face |
| `abc_0150-thicken` | Z grew 1.6217 mm, instruction claims 6.379 mm | refused — extruding the +Z face grows Z by 1.6217 mm |
| `abc_0232-thicken` | Z grew 0.0 mm, instruction claims 11.271 mm | refused — extruding the +Z face grows Z by 0.0 mm |
| `abc_0352-thicken` | footprint dY = 8.4662 mm; Z grew 4.5764 mm vs 9.624 mm claimed | refused — extruding the +Z face grows Z by 0.0 mm |
| `abc_0365-thicken` | footprint dY = 26.25 mm; Z grew 0.0 mm vs 41.25 mm claimed (**the F-001 case, reproduced exactly**) | refused — no +Z-facing planar face |

**No ground truth was rewritten, because none could be produced honestly.** Three cases have
no +Z-facing planar face at all; three have one whose extrusion does not grow the Z extent by
the amount the instruction states (the planar face is an interior ledge below the true top).
Fabricating a GT for these is the F-001 defect itself, so the six are marked
`status: unsatisfiable-gt` in `datasets/synthetic-edit-pairs/manifest.yaml` with the
per-case reason, and their case directories are left byte-identical as evidence.
`input.step` was never modified for any case.

**Scope correction worth stating: this is 6 of 19 thicken cases (32%), not the single
`abc_0365` the diagnosis found.** The remaining 13 thicken cases pass the gate.
`tests/test_dataset_integrity.py` pins both the marking and (slow) the property over every
still-published triple.

## Gate results

| Gate | Command | Result |
|---|---|---|
| format | `uv run ruff format --check .` | **PASS** — 45 files already formatted |
| lint | `uv run ruff check .` | **PASS** — all checks passed |
| typecheck | `uv run mypy cadtools` | **PASS** — 14 source files |
| typecheck | `uv run mypy devtools/cadtools_devtools scripts` | **PASS** — 4 source files |
| tests | `uv run pytest -q` | **PASS** — **271 passed**, 2 deselected (slow) |
| tests | `uv run pytest -q -m ''` | **PASS** — **273 passed** (incl. the tracemalloc ceiling) |
| coverage | `uv run python scripts/check_coverage.py` | **PASS** — 6/6 capabilities (`synthetic-pair-generator` now resolves in `devtools/`) |
| isolation | `uv run python scripts/check_isolation.py runs/eval-run-001` | **FAIL, exit 1 — CORRECT.** 5 violations across 23 scripts: exactly the five contaminated Arm-A samples F-003 named, zero false positives on the other 18. The committed run-001 fixtures are supposed to fail this gate. |

Suite grew **205 → 273** tests (+68). Every new gate was written red-first: the tests fail to
even import on the pre-fix tree, `test_claim_then_record_consumes_exactly_one_round` sees two
records with a leading `valid:false` on the old CLI, and
`test_frame_check_passes_a_legitimate_large_dimension_change` fails on the old raw-delta check.

## Not done here (deliberate)

* **No eval re-run and no re-scoring.** The evaluator owns that.
* **C1 `operation-class-fidelity`** was not added to the eval suite — it is an eval-criterion
 change, and the batch evidence it was gated on now exists (the check runs on every diff).
* **F-002 rank-4** (`phrasing_variant` / `mechanism_stated` recorded per case, aggregate split
  by it) was **not** implemented — out of the approved bundle.
* **Arm-B isolation remains unconfirmed, and this audit structurally cannot confirm it.** All
  23 scripts it scanned are Arm-A's; `runs/eval-run-001/armB/` contains **no `round-*.py` at
  all** (the single-shot baseline arm left none), so there is nothing to AST-audit. F-003's
  open item stands: absence of a `contamination` block is not evidence of absence. Closing it
  needs the arm to emit its round scripts, or a different evidence source entirely.

---

## the scoring path's proximity query, bounded (closing fix, 2026-08-24)

 bounded the differ's `closest_point` allocation but left `cadtools/scoring.py` with its own
unchunked copy of the same query at `DEFAULT_SAMPLES = 20000`, and rescore-002 was SIGKILLed by
it four times (exit 137 on `abc_0054-boss-union` and `abc_0368-fill-hole`, in BOTH arms), forcing
a hand-driven 5000-sample fallback; `cadtools score` exposed no `--samples`, so the operator had
no lever at all. does not duplicate the helper — it MOVES it: the byte-budgeted batching
rule now lives once in the new `cadtools/proximity.py`
(`closest_point_chunked` returning distances AND triangle ids, `surface_distances`,
`chunk_size_for`, the 256 MB `DISTANCE_CHUNK_BYTES` budget), `geometry_diff._surface_distance`
is a thin alias for it, and `scoring._match_fraction` — which needs the matched face's normal,
not merely the distance — consumes the same batched call. `score` gained `--samples` (forwarded
through `score_editing_files` → `score_editing_sample` → `surface_distance_f1`/`shape_similarity`),
and the scorecard now carries `n_samples`, so a 5000-sample score can never again be silently
compared with a 20000-sample one. Written tests-first: a fast chunk-invariance test on the
scoring path (`MIN_CHUNK`/`MAX_CHUNK` monkeypatched to 64 vs 100000 → identical on a small
fixture), a scorecard-provenance test, a `score --samples` CLI test, and the slow-marked
tracemalloc ceiling pattern reused for `surface_distance_f1` at full samples; the existing
test was repointed at the shared module. Gates: `ruff format --check` PASS (46 files),
`ruff check` PASS, `mypy cadtools scripts devtools` PASS (19 files), `pytest -q` **275 passed**,
3 deselected (suite 273 → 278 collected, +5), `check_coverage.py` **PASS 6/6**. Empirically
verified on the case that OOM'd: `uv run cadtools score` on `armA/abc_0054-boss-union` at the
DEFAULT 20000 samples now completes (exit 0, 40 s, peak RSS **1.06 GB** — no OOM) and returns
`cad_score_proxy = 0.999999999968029` against the rescore-002 record's `0.9999999999686681`,
a delta of **6.4e-13** (< 1e-6). Re-running at the recorded `--samples 5000` reproduces that
record **bit-exactly** on every axis, which isolates the residual: chunking is value-neutral, and
the 1.7e-3 movement in `baseline_shape_similarity` is ordinary sampling variance between 5000 and
20000 samples — precisely the difference the new `n_samples` field now makes visible.

---

## Post-parity remedy wave — T1 closure alignment · T2 headroom gate · T3 axis-aware thicken (2026-08-25)

Three defects that parity-001 surfaced, each fixed tests-first. All numbers below are measured,
not asserted.

### T1 — the closure VERDICT now matches the grader's convention

parity-001's single validity disagreement was `armB/abc_0067-fill-hole`: we rejected it
("tessellation is not closed, 3F != 2E; 8 open edges") where the official
`cadgenbench.common.validity.analyze_step` returns `is_valid=True, watertight=True`. The rule was
never different — the MESH was. The official gate tessellates through `robust_tessellate_shape`,
which walks a bounded deflection ladder (`DEFLECTION_LADDER = (1, 4, 16, 32)`) and accepts the body
when ANY rung yields a closed orientable manifold; we meshed once, at the requested deflection, and
published that rung's open boundary as a validity failure. Since validity zero-cascades over every
other axis, being stricter than the grader is not caution, it is a wrong score: we hard-zeroed a
candidate the leaderboard scores 0.1429.

`cadtools/mesh.py` gained the same ladder (`DEFLECTION_LADDER`, `is_closed_manifold`,
`robust_tessellate` → `LadderResult`), and `check_validity` now rules on the accepted rung. What we
detect BEYOND the grader is kept but demoted to a report: `ValidityReport.strict_mesh_closed`
(the rung-1 observation), `mesh_deflection_divisor` (the rung that ruled), and a `strictness` note
listing the divergence — never a `failure`, never a differing verdict. A part that already meshes
closed is meshed exactly as before (divisor 1, empty `strictness`), and the shape's cached
triangulation is cleaned after an escalation so no later call is silently handed a finer mesh.

The alignment had to go one layer deeper to be real: `scoring._as_mesh` and `geometry_diff._as_mesh`
now route through the shared `mesh_for_metrics` chokepoint, so the metric measures the body the gate
accepted. Without that, abc_0067 passed validity at deflection/4 while the topology axis still read
its OPEN rung-1 mesh as Betti (1, 1, 0) and charged a phantom mismatch.

Both scorers on the disputed pair, after the change:

| axis | ours (before) | ours (after) | OFFICIAL analyze_step / eval |
|---|---|---|---|
| validity verdict | **invalid** (3F != 2E) | **valid** | **valid** (`is_valid=True, watertight=True`, `topology_errors=()`) |
| requested deflection | 0.033778 mm | 0.033778 mm | 0.03378 mm (`mesh.perform d=0.03378`) |
| accepted rung | — (rejected) | **/4** → 0.008445 mm, 4896 tri | **/4** → `mesh.perform d=0.008445` |
| Betti (candidate) | (1, 1, 0) — open mesh | **(1, 0, 0)** | **(1, 0, 0)** |
| topology_match | 0.25 | **1.0** | **1.0** |
| shape (raw / baseline / renorm) | 0.019 / 0.554 / 0.0 | 0.249 / 0.554 / 0.0 | 0.266 / 0.516 / 0.0 |
| final | **0.0000 (hard zero)** | **0.1429** | **0.1429** |

Validity agreement over the parity set is now **8/8**. The other direction is pinned too: a box
shell missing a face still fails BOTH gates (ours on naked edges, official on
`BRepCheck_Shell.Closed`), and no ladder rung closes it — `tests/test_validity_official_alignment.py`
asserts all four rungs stay open.

### T2 — renormalization headroom is now gated at authoring time, and the shipped set is audited

parity-001 case 2: `abc_0396-corner-fillet` had raw-shape and baseline agreeing between the two
scorers to within 0.036 / 0.041 — sampling noise — and final scores of 1.0000 vs 0.2996, because
the editing axis divides by `1 - b_shape` and that fixture's headroom is ~0.003. The fixture is the
defect, not the scorer.

`cadtools_devtools.synthetic_pairs` gained `MIN_BASELINE_HEADROOM = 0.05`, `baseline_headroom`
(measured through the SAME `shape_similarity` + metric-mesh accessor the scorer renormalizes by),
`assert_baseline_headroom`, and `RenormInstabilityError`. `generate_pair` refuses below the floor
BEFORE writing anything (same discipline as the F-001 consistency gate); `generate_pairs` reports the
refusal as `status: renorm-unstable` data rather than a crash. `GeneratedPair.baseline_headroom` is
carried into the manifest note.

Audit of the 86 published triples (`datasets/synthetic-edit-pairs/audit_headroom.py --apply`,
per-case numbers in `headroom-audit.json`): **38 of 86 are below the 0.05 floor** and are now marked
`status: renorm-unstable` — MARKED, never deleted, since their geometry and instructions are correct
and they remain valid validity/topology fixtures. Median headroom across the set is 0.054, so the
dataset sits astride the threshold: worst cases are `abc_0215-through-hole` (0.0000),
`abc_0123-fill-hole` (0.0001), `abc_0230-thicken` (0.0004); nearest misses `abc_0045-hole-pattern`
and `abc_0318-hole-pattern` (0.0499). `abc_0396-corner-fillet`, the parity case, measures 0.0030.
By edit type the flags fall on feature-add 10/14, boolean-combine 10/15, pattern-change 9/12,
dimension-change 5/19, feature-remove 4/26 — the small-feature recipes on large real parts. That is
a genuine limit of the recipe/part pairing (a centred through hole removes pi/64 ~ 4.9% of ANY square
plate), not a metric artefact, and it is now visible in the manifest instead of hiding inside a
renormalized score.

### T3 — thicken selects its axis FROM the part, and says so

`_thicken` hard-coded +Z (magnitude from the Z extent, direction from a +Z-facing planar face), so
six pairs whose parts offer no +Z growth face had to ship `status: unsatisfiable-gt`. The recipe now
picks the growth face off the part: planar, axis-aligned normal (0.999), pointing along a POSITIVE
axis, sitting ON that axis's bbox maximum, largest by area with deterministic tie-breaks. The
instruction is rendered from those params and NAMES the axis and the face, so GT and instruction
agree by construction on any part the recipe accepts. The consistency gate follows suit: the
`thicken` claim resolves its axis from `params["axis"]` (`AXIS_FROM_PARAMS` / `OTHER_AXES`), so a GT
that grew Y is correct beside a sentence saying Y and WRONG beside one saying Z — a fixed-axis gate
cannot tell those apart. Negative-facing faces are still refused: growing that way pushes the body
past its own bbox minimum, which the no-ICP frame discipline reads as a re-pose.

Outcome for the six (`regen_thicken_axis.py --apply`, recorded under `repairs` in
generation-summary.json). Every one clears the consistency gate AND the new headroom gate:

| case | outcome | axis | headroom | note |
|---|---|---|---|---|
| abc_0011-thicken | **replaced** → `abc_0001-thicken` | Z | 0.543 | own part regenerated fine but left 0.045 headroom — below the T2 floor; swapped for a fresh HIGH-tier admission |
| abc_0056-thicken | regenerated | **Y** | 0.534 | +Y-facing (rear) face |
| abc_0150-thicken | regenerated | **X** | 0.104 | +X-facing face |
| abc_0232-thicken | regenerated | **Y** | 0.111 | +Y-facing face |
| abc_0352-thicken | regenerated | **X** | 0.092 | +X-facing face |
| abc_0365-thicken | **replaced** → `abc_0350-thicken` | Z | 0.597 | no axis-aligned planar growth face at ALL (its positive faces are set back from the boundary); swapped for a fresh MID-tier admission |

`status: unsatisfiable-gt` is now absent from the manifest and from the allowed vocabulary; both
swaps keep their tier and record `replaces=<old id>` in the note. The superseded case directories
stay on disk untouched so earlier runs that reference them remain reproducible. `regen_thicken.py`'s
audit is axis-aware: it reads the axis out of the PUBLISHED sentence (with an explicit
`LEGACY_Z_MARKERS` fallback for the 13 pre-T3 thicken pairs, whose thickness/top-face phrasing makes
the same implicit +Z claim audited them against) and checks that axis grew 25% while the other two
did not.

### Gates

| Gate | Command | Result |
|---|---|---|
| format | `uv run ruff format --check .` | **PASS** — 48 files |
| lint | `uv run ruff check .` | **PASS** |
| typecheck | `uv run mypy cadtools devtools scripts tests` | **PASS** — 45 source files |
| tests | `uv run pytest -q` | **PASS** — **297 passed**, 4 deselected (slow) |
| coverage | `uv run python scripts/check_coverage.py` | **PASS** — 6/6 capabilities |
| isolation | `uv run python scripts/check_isolation.py runs/eval-run-001` | **FAIL, exit 1 — CORRECT/unchanged.** The same 5 Arm-A contamination violations across 23 scripts; the committed run-001 fixtures are supposed to fail this gate. |

Suite grew **275 → 297** (+22): `tests/test_validity_official_alignment.py` (6, red on the pre-fix
tree — abc_0067 was rejected), `tests/test_headroom_gate.py` (7), plus new axis-aware thicken and
consistency-gate cases in `tests/test_synthetic_pairs.py` and the rewritten
`tests/test_dataset_integrity.py` (T3 repair map, status vocabulary, the pinned 38-case
renorm-unstable count, and a slow property test that every repaired pair grew the axis its
instruction names).

### Consequence for scores already on record

`rescore-002` / `eval-run-001` numbers were produced by the pre-T1 scorer and the pre-T2/T3 dataset.
Any candidate hard-zeroed on a tessellation-closure failure, and any editing-axis score on one of the
38 renorm-unstable fixtures, must be treated as stale — re-scoring is the evaluator's call, not this
build's.


---

## Delta — run-003 F-005 fix wave (volumetric intent + ambiguity convention)

Two root-caused agent defects from `.mutagent/diagnostics/run-003/findings/F-005-verdict-verification.md`
(Q2). Tests-first; the verbatim `systemPrompt` prefix was not touched (sha256
`53cf947a7004acb4989133da06bd3b3f4f162cae8e6bcbba987f1e165e3e8156`, 2341 bytes, byte-identical
before and after).

### FIX 1 — the abc_0352 class: extents cannot see a wrong cross-section

`cadtools/geometry_diff.py` gains `check_volume_delta()` / `VolumeIntent` and `cross_section()` /
`CrossSection`, surfaced on the CLI as `diff --expect-volume-delta <mm3> [--tol <frac>]`,
`--target-face-area <mm2>` and `--change-axis {x,y,z}`. Both add `failures[]` entries and take the
diff to exit 5. `cross_section` is REPORTED on every diff (no extra sampling cost) and GATED only
when a target face area is supplied; it carries the exact `implied_area` (`|volume_delta| / depth`)
alongside an occupancy-grid `footprint_area` and its `fill_ratio` — a `fill_ratio` near 1.0 on a
non-rectangular face is the signature of sweeping the face's bounding rectangle. `--tol` defaults to
`DEFAULT_INTENT_TOLERANCE = 0.02`, mirrored in `cli.py` (parser build must not import build123d) and
pinned to the library value by a test.

New fixtures reproduce the defect in miniature: `make_ell_prism` + `make_ell_prism_padded_by_profile`
(right) + `make_ell_prism_padded_by_bbox` (wrong). The two pads have bit-identical bounding boxes and
differ by `30 x 20 x 12 = 7,200 mm3` of unrequested material — the abc_0352 geometry at test scale.

The agent artifact gains two APPENDIX sections (additive region only): *"Verifying INTENT — volume
and cross-section, never extents alone"*, stating the rule and the worked failure (all three extents
identical to GT, volume +65.7% / 24,179.32 mm3), and two new rows in the VERIFY 4c command table.

### FIX 2 — the abc_0356 class: where "the middle" is

Appendix section *"Resolving ambiguity — where 'the middle' is"*: an uncoordinated
"middle"/"centre"/"centred on top" resolves to the **body's bbox footprint centre in XY**, not a face
centroid, unless a specific face is named — with the worked failure (Y = 19.35 vs the key's 35.28, a
15.93 mm translation error, 1.24x the boss radius). No `cadtools` change; this one is a convention,
not a measurement.

### Gates

| Gate | Command | Result |
|---|---|---|
| format | `uv run ruff format --check .` | **PASS** — 48 files |
| lint | `uv run ruff check .` | **PASS** |
| typecheck | `uv run mypy cadtools devtools scripts` | **PASS** — 19 source files |
| tests | `uv run pytest -q` | **PASS** — **316 passed**, 4 deselected (slow) |
| tests (incl. slow) | `uv run pytest -q -m ""` | **PASS** — **320 passed** |
| coverage | `uv run python scripts/check_coverage.py` | **PASS** — 6/6 capabilities |

Suite grew **301 → 320** (+19): 8 in `tests/test_geometry_diff.py`, 8 in `tests/test_cli.py`, 3 in
`tests/test_agent_markdown.py`. All 19 were red before the fix (the CLI/library ones on import and
exit code, the markdown ones on the missing rules).

### Scope note

This wave changes what the agent is TOLD to verify and what the checker CAN verify. It does not
rescore anything: run-003's recorded numbers were produced by an agent without these checks, and the
F-005 GT-generator defect (convex-face `fill-hole`) is untouched here — it remains open.
