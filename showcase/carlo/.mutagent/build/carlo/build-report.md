# BUILD Report — carlo

| Field | Value |
|---|---|
| Spec | `.mutagent/specs/carlo/agentspec.yaml` |
| Spec version | `agentspec.mutagent.io/v0.3.0` · metadata.version `0.1.0` (amended post-PLAN: –) |
| Kind | `Agent` |
| Decision log | `.mutagent/specs/carlo/agentspec.decisions.md` (–) |
| Selected target | `car-bench-python-docker` — `harness` / car-bench (local run.py agent factory + IJCAI Track 1 Docker evaluator interface) |
| Artifact | `code` → `carlo/` |
| Code implementation | `typescript` · `bun (runtime + test) + Docker (digest-pinned GHCR image for submission), plus a minimal Python bridge for local run.py integration` |
| Target root | `<repo>` (git `github.com/bruno-mutagent/carlo`, branch `main`) |
| Verdict | B4: **READY** (conditions C1–C3, Rulings 1–2) · B5–B6 executed · B7: **STEER** — one bounded amendment (env-activated backbone swap in the shipped image) **applied and re-verified**; all gates green |

> **PLAN revision 2 (2026-08-24).** Revision 1 planned a Python core. Operator switched the stack to **TypeScript on bun** with the **A2A 1.0 server as the primary artifact** and a minimal Python bridge for `run.py` (spec amended + re-validated; decisions –). This section supersedes revision 1 in full. It was frozen before any target write and is preserved verbatim; BUILD RESULT below records what actually happened.

<!-- =========================================================================
     PLAN — frozen BEFORE any target write. Engineer drafts; architect checks
     read-only. Status must be READY before BUILD RESULT is written.
     ========================================================================= -->
## PLAN · frozen before target writes

**Status:** `READY` — architect plan-check returned READY on 2026-08-24 with binding conditions **C1** (absent-capability routing test), **C2** (T13/T8 dependency restatement), **C3** (jobs trace row), **RULING 1** (dependency-free A2A encoder + mandatory negative contract test), **RULING 2** (arg-repair deviation retained with boundaries). All applied in place during B5 — see *Binding-condition disposition* in BUILD RESULT. **All six revision-1 plan questions are now closed** (Q1/Q2/Q4 by operator disposition; **Q3 closed by live probe evidence**, see *Verified-by-probe facts*; Q5 recorded non-blocking; Q6 EVALUATE-stage). **Nothing else blocks READY.** Two items need an architect nod inside the plan check rather than a separate question: the A2A wire implementation choice (own minimal handler vs `@a2a-js/sdk@1.0.1`, G-A) and the retained arg-repair deviation.

**Inputs:** amended spec + decisions sidecar (–) + selected target + FRESH doc crawl + live capability probes + repository snapshot (clean; **no `carlo/` exists**).

**Source digest:**
- `CAR-bench/car-bench` @ `111df1c950c9c4061d1e29fc8deeb37e6efbd739` (2026-08-21) — **the commit to pin into `third_party/` per **
- `CAR-bench/car-bench-ijcai` @ `68769c8b48199bd99ede4373d217253703f53c6f` (2026-07-27)
- `CAR-bench/car-bench-agentbeats` @ `ad69df62cb195afce74ad11eefa5eb0ab9e9743d` (2026-02-23)
- `a2aproject/A2A` `specification/a2a.proto` @ `main`, crawled 2026-08-24 (authoritative wire field names)
- `a2aproject/a2a-python` `utils/constants.py`, `client/card_resolver.py` @ `main`, crawled 2026-08-24
- `googleapis.github.io/js-genai` (release docs) crawled 2026-08-24; npm `@google/genai` resolved **2.18.0**; npm `@a2a-js/sdk` latest **1.0.1** (2026-07-28)
- `hf://datasets/johanneskirmayr/car-bench-dataset` lastModified `2026-02-12`, MIT
- Host toolchain observed: **bun 1.3.14**, node v24.15.0, python 3.12.3, docker present, uv 0.9.17

**Goal:** A `carlo/` bun+TypeScript package whose **A2A 1.0 server** answers the IJCAI Track 1 evaluator turn-for-turn from a `linux/amd64` Docker image, driven by one gate-structured core over `gemini-3.5-flash` on Vertex at temperature 0 with thinking explicitly disabled — plus a **minimal Python bridge** that plugs into `run.py`'s `custom_agent_factory` and forwards each turn to that same server over the same wire, so local dev, baseline measurement and evals exercise the production code path.

### Verified-by-probe facts (live, read-only; each closes a revision-1 unknown)

These were executed against the real services from a scratch directory (nothing written under `carlo/`). They replace assumptions with evidence:

| # | Probe | Result | Consequence for the plan |
|---|---|---|---|
| P1 | `bun add @google/genai` under bun 1.3.14 | resolves **2.18.0**, 41 packages incl. `google-auth-library`, `gaxios`, `gcp-metadata` | bun can host the backbone SDK; **G-B** (bun is not a *documented* target) is de-risked but still recorded |
| P2 | `new GoogleGenAI({vertexai:true, project, location})` under bun | constructs; `client.vertexai === true`; `{enterprise:true}` also constructs | JS keeps the `vertexai` flag; T2/T9 pass it **explicitly**, never relying on env auto-pickup |
| P3 | live `generateContent` with **no** explicit credentials | authenticated successfully (returned a Vertex **API-level** error, not an auth error); `~/.config/gcloud/application_default_credentials.json` exists (written 2026-08-24 16:38) | ** is stale** — ADC is present *and works under bun*. Gates still run mock-backbone; this only removes an EVALUATE precondition |
| P4 | `gemini-3.5-flash` across regions | **`global` → OK**; `us-central1` → 404; `us-east5` → 404 (`gemini-2.5-flash` works in both `global` and `us-central1`) | **Q3 closed.** The spec's model pin **is satisfiable** (holds, no re-targeting) but **only at `GOOGLE_CLOUD_LOCATION=global`**. This becomes the config default and a startup precondition check |
| P5 | `thinkingConfig:{thinkingBudget:0}` on `gemini-3.5-flash` | accepted; `thoughtsTokenCount: 0`, total **74** tokens — vs **257** tokens and 183 thought-tokens with thinking left at its default | Thinking is **ON by default** for this model (**G-E**). Explicitly disabling it is load-bearing for both the temperature-0 consistency constraint and `cost-below-frontier` (~3.5× on this sample) |
| P6 | `parametersJsonSchema` with a CAR-bench-shaped OpenAI schema (`enum`, `required`) + `automaticFunctionCalling:{disable:true}` | returned `functionCalls: [{name:'open_close_sunroof', args:{position:'open', percentage:50}, id:'call_67995'}]` | The pass-through tool-schema design works end to end: evaluator schema in, `{name, args, id}` out, ready for the `{tool_name, arguments}` renderer — no schema translation layer needed |

### The wire, established from source (this is what the whole design hangs on)

The Track 1 "Docker/evaluator interface" is **not** a bespoke protocol and **not** an SDK-coupled one. Read from `car-bench-ijcai/src/agentbeats/tool_provider.py::talk_to_agent_with_parts_sync` → `src/agentbeats/sync_client.py::send_message_with_parts_sync`, the evaluator's agent-under-test path is a plain `httpx.Client().post`:

- **Request:** `POST <agent_url>` · headers `Content-Type: application/a2a+json`, `A2A-Version: 1.0` · body `{"jsonrpc":"2.0","id":"<hex>","method":"SendMessage","params":{"message": MessageToDict(<a2a.v1.Message>)}}` — protobuf JSON mapping, i.e. lowerCamelCase `messageId` / `contextId` / `taskId`, `role: "ROLE_USER"`, `parts: [{"text": …} | {"data": …}]`, `metadata: {"source": "user"|"environment"}`.
- **Response:** must be `{"result":{"message": <a2a.v1.Message JSON>}}`, parsed by the evaluator with **`ParseDict(..., Message())` and no `ignore_unknown_fields`** — so any stray or mis-cased field in our response is a hard `ParseError` that kills the run. Field allowlist from `a2aproject/A2A specification/a2a.proto`: `Message{messageId(req), contextId, taskId, role(req), parts(req), metadata, extensions, referenceTaskIds}`, `Part{oneof: text|raw|url|data} + metadata, filename, mediaType`, where `Part.data` is a `google.protobuf.Value` (any JSON).
- **No task machinery needed:** returning the `message` payload leaves `status` absent, and `tool_provider` treats absent as `"completed"` (`outputs.get("status","completed") != "completed"` → raise). Returning a `Task` would drag in the whole state enum for no benefit.
- **`contextId` must be minted and echoed by us.** The evaluator sends `contextId=None` on the first turn, then replays whatever our response carried (`tool_provider` lines 72–82). If we never return one, every turn looks like a fresh conversation and per-task history is lost — **G-H**, and a required test.
- **The agent card is still required**, but only as a readiness probe: `run_scenario.py::check_endpoint` calls `A2ACardResolver(base_url).get_agent_card()`. Path is `/.well-known/agent-card.json` and the RPC URL is `/` (`a2a-python/src/a2a/utils/constants.py`: `AGENT_CARD_WELL_KNOWN_PATH`, `DEFAULT_RPC_URL`, `PROTOCOL_VERSION_1_0`). The card is parsed with **`ignore_unknown_fields=True`** plus legacy-field compat (`client/card_resolver.py::parse_agent_card`), so a small correct card is enough.

**Consequence:** the server surface is **two routes** — `GET /.well-known/agent-card.json` and `POST /`. That is why the plan implements the wire directly on `Bun.serve` with a strict, tested encoder rather than adopting `@a2a-js/sdk@1.0.1` sight-unseen (see **G-A**); the binding constraint is the Python client's exact bytes, not an SDK's abstractions.

### Goal-based task table

| Task | Verifiable outcome | Exact artifacts | Components + why / doc source | Check → expected result |
|---|---|---|---|---|
| **T1 — bun/TS skeleton** | `bun install` is lockfile-reproducible; typecheck, lint and test all run | `carlo/package.json`, `carlo/bun.lock`, `carlo/tsconfig.json`, `carlo/biome.json`, `carlo/.gitignore`, `carlo/.dockerignore`, `carlo/.env.example`, `carlo/src/index.ts` | bun as runtime **and** test runner (spec toolchain). `tsconfig` strict + `noUncheckedIndexedAccess`; typecheck via `tsc --noEmit`; lint/format via Biome (one dev dep, no plugin tree). `@google/genai` pinned **`>=2.18.0 <3.0.0`** — the SDK's own docs advise pinning `<3.0.0` because 3.0.0 changes AFC invocation and requires Node 22+ (`js-genai` release docs, landing warning). Test files named `*.test.ts` so both `bun test` and the coverage gate's `/\.test\.ts$/` matcher see them. | `bun install --frozen-lockfile` → exit 0; `bun x tsc --noEmit` → exit 0; `bun x biome check.` → exit 0; `bun test` → collects |
| **T2 — env-var-only config** | Every model/provider/credential knob is env-settable; `global` region default is enforced | `carlo/src/config.ts`, `carlo/tests/config.test.ts` | Parsed once into a frozen object: `CARLO_MODEL` (default `gemini-3.5-flash`), `CARLO_TEMPERATURE` (`0`), `CARLO_THINKING_BUDGET` (`0`), `GOOGLE_CLOUD_PROJECT`, **`GOOGLE_CLOUD_LOCATION` (default `global` — P4: this model resolves *only* at `global` on the probed project)**, `GOOGLE_GENAI_USE_VERTEXAI`/`GOOGLE_GENAI_USE_ENTERPRISE`, `CARLO_MAX_TURNS` (`50`), `CARLO_VERIFY_MODE`, `CARLO_TRACE_DIR`, `PORT`/`HOST`. Mandated by the competition rule that every model/provider/deployment/API-base/tier/effort selector be env-configurable, with no secrets baked into the image (`car-bench-ijcai/README.md#submission-instructions`, `#c-ghcr-image-validation`). Startup logs the resolved model+location (a `us-central1` misconfiguration otherwise surfaces only as a runtime 404). | unit: env matrix → expected config; missing required var → error naming the var; default location is `global`; `bun x biome`/grep → no key-shaped literal anywhere in `carlo/` |
| **T3 — operative system prompt, verbatim** | Shipped prompt is byte-identical to `spec.agent.systemPrompt` | `carlo/src/prompts.ts`, `carlo/tests/prompts.test.ts`, `carlo/tests/fixtures/system-prompt.txt` | `SYSTEM_PROMPT` = the spec's 7 ABSOLUTE RULES block as **operative text**. Layered **after** the evaluator's `System:` policy text, never replacing it — the 19 policies are scored against their originals and altering them "will likely result in error" (`development-guide.md#policy-compliance`). Sent via `config.systemInstruction` (P6-verified) so the static prefix stays stable for provider caching. | unit: `SYSTEM_PROMPT` equals a fixture **extracted from `agentspec.yaml` at test time**, so a spec edit fails the test; unit: composed instruction contains the evaluator wiki verbatim and ahead of CARlo's rules |
| **T4 — `capability-inventory`** | The live per-task tool set is exactly what the evaluator declared this session | `carlo/src/inventory.ts` (`// @implements capability-inventory`), `carlo/tests/inventory.test.ts`, `carlo/tests/fixtures/tools-info.json` (+ `-removed-tool`, `-removed-param`) | Pure parser over the OpenAI-function-calling tool list arriving in the first-turn data Part `{"tools":[…]}` (`development-guide.md#first-message-task-initialization`); the evaluator has already stripped `planning_tool`/`think` and the task's `removed_part` (`car-bench/car_bench/orchestrator.py:126-136`). Rebuilt per task from the **current** payload — never a remembered superset (`spec.context[tool-definitions]`; hallucination construction in `car-bench/README.md#2-hallucination-tasks`). | unit: 58-tool fixture → counts/params/enums match; removed-tool fixture → `hasTool(...) === false`; removed-param fixture → tool present, param absent; malformed entry → excluded, no throw; two tasks with different tool sets → zero leakage |
| **T5 — `policy-compiler`** | The evaluator's policy wiki becomes an explicit checklist gating state changes | `carlo/src/policy.ts` (`// @implements policy-compiler`), `carlo/tests/policy.test.ts`, `carlo/tests/fixtures/wiki.md` | Compiles the `System:` text into `PolicyRule{id, text, appliesToTools[], prerequisites[], ordering[], condition}` once per task. Fixture is the **real** `car_bench/envs/car_voice_assistant/wiki.md` (19 policies), which carries runtime placeholders substituted by the harness (`run.py:173-188`) — so the compiler tolerates substituted and raw text alike. Per spec `onFailure`: unparsable policy ⇒ empty checklist for that part, every capability claim `unverified` — **fail toward caution** (`sop[ingest-task-frame].onFailure`). | unit: real wiki → weather-before-sunroof and sunshade-before-sunroof attach to `open_close_sunroof` with the right prerequisite/ordering; empty/garbage wiki → empty checklist, `unverified: true`, no throw; placeholder-bearing wiki → parses |
| **T6 — `arg-validator`** | No schema-invalid tool call is ever emitted | `carlo/src/validator.ts` (`// @implements arg-validator`), `carlo/tests/validator.test.ts` | Pure JSON-Schema-level validation against T4's inventory: tool exists, required present, types/enums correct, **no invented parameters**; no LLM (`spec.capabilities.code[arg-validator]`). Returns structured findings so T8 repairs-and-revalidates **once** then re-plans (`sop[arg-selfcheck]`). Serves `no-invalid-tool-calls` ↔ harness `r_tool_execution`/`tool_execution_errors` (`car_bench/types.py::RewardInfo`). Emits ordinary JSON args without pre-coercion — the evaluator normalizes numeric types against the exposed schema (`development-guide.md#option-2-tool-calls-only`). | unit: valid → ok; missing required / wrong type / out-of-enum / unknown param / unknown tool → distinct findings; repaired call revalidates clean; validator never mutates its input |
| **T7 — `escalation-controller`** | Exactly one extra verify pass, only on flagged risk | `carlo/src/escalation.ts` (`// @implements escalation-controller`), `carlo/tests/escalation.test.ts` | Pure predicate over draft + gate findings: state-changing call ∨ detected ambiguity ∨ capability doubt → **exactly one** verify pass; else single-pass (`sop[risk-triggered-escalation]`). "State-changing" is derived from the inventory, mirroring CAR-bench's own `set_apis/` vs `get_apis/` split (27 set / 29 get / 2 no-op, `car-bench/README.md#key-features`), never a hardcoded name list. `CARLO_VERIFY_MODE ∈ {risk,always,never}` makes the deferred always-verify experiment an env flip (`spec.intent.unknowns[1]`). Contradiction ⇒ the more conservative wins (`…onFailure`). | unit: get-only → 0 extra; set-api → exactly 1; ambiguity → 1; capability-doubt → 1; two risks in one step → still 1; modes honored; conservative-wins arbitration |
| **T8 — `gate-pipeline`** | One turn ⇒ exactly one benchmark-visible step, gates in spec order, bounded at 50 | `carlo/src/pipeline.ts` (`// @implements gate-pipeline`), `carlo/src/types.ts`, `carlo/tests/pipeline.test.ts`, `carlo/tests/fixtures/transcript-{base,hallucination,disambiguation}.json` | The transport-agnostic core: `decideNextStep(TurnInput) => TurnDecision`. Order per spec: ingest (once/task) → feasibility (T4) → ambiguity → **draft (1 backbone call)** → policy pre-check (T5) → arg self-check (T6) → risk-triggered verify (T7) → emit (`spec.agent.workflow.inline`). Defensive turn counter bounded by `CARLO_MAX_TURNS` = **50** (matching every official scenario's `max_steps = 50`), whose overflow **exit is a clean close** — a short confirm/limit statement, never a throw, never silence (`sop[close-cleanly].onFailure`). Aggregates per-step usage for the adapters. | unit (mocked backbone): hallucination fixture → **zero** tool calls + honest limit text + alternative; internally-resolvable ambiguity → resolved with **no** question; unresolvable → exactly **one** question, zero state changes; sunroof fixture → weather-get ordered before the sunroof set; bad-arg draft → repaired once or re-planned, never emitted invalid; gate order asserted by a recorder; turn 51 → clean-close, no throw; **1** backbone call on a no-risk turn, **2** on a risk turn |
| **T9 — `vertex-client`** | Every backbone call is temperature 0, thinking off, on the pinned model, with usage captured | `carlo/src/backbone/vertex.ts` (`// @implements vertex-client`), `carlo/tests/vertex-client.test.ts` | `new GoogleGenAI({vertexai: true, project, location})` — P2-verified under bun; ADC supplies credentials (`js-genai` prerequisites: `gcloud auth application-default login`, auth options per `GoogleAuthOptions`). `models.generateContent({model, contents, config:{systemInstruction, temperature: 0, tools:[{functionDeclarations:[…]}], automaticFunctionCalling:{disable: true}, thinkingConfig:{thinkingBudget: 0}}})` — **all four verified live in P5/P6**. Tool schemas pass through **untouched** via `parametersJsonSchema` (the primary documented JS pattern, `js-genai#function-calling`), which is what keeps tool and parameter names byte-identical as the rules demand (`agent-under-test-harnessing.md#important-design-rules`). Reads `response.functionCalls` → `{name, args, id}`. Tool results replay as `functionResponse` parts. Usage from `response.usageMetadata`: `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `cachedContentTokenCount`, `totalTokenCount` — **all optional; P4 showed a response with `candidatesTokenCount` absent entirely**, so summing must be undefined-safe. Bounded retry with backoff; **no silent model fallback** (an unsatisfiable pin THROWs). | unit (SDK module mocked, **no network**): every call carries `temperature: 0`, `thinkingBudget: 0`, AFC disabled and the configured model; `parametersJsonSchema` is referentially the input schema (no rewrite into `parameters`); `functionCalls` → `{tool_name, arguments}` with names preserved; usage summed across passes with fields missing/undefined; transient error → retried; persistent error → typed throw naming the model, and **no other model string ever appears in any call**; client constructed with explicit `project`/`location`, never an apiKey |
| **T10 — A2A wire codec** | Our bytes are exactly what the evaluator's strict parser accepts | `carlo/src/a2a/wire.ts`, `carlo/tests/wire.test.ts`, `carlo/tests/fixtures/golden/*.json` | Decode: JSON-RPC envelope → `{method:"SendMessage", params.message}`; parts dispatched on which key is present (`text` vs `data`), first-turn `"System: …\n\nUser: …"` split, `{"tools":[…]}`, `{"tool_results":[{tool_name, tool_call_id, content}]}`, the `"none"` empty-message sentinel, and `metadata.source ∈ {user, environment}` as an advisory tag (`development-guide.md#inbound-message-metadata`; `src/turn_metrics.py` constants). Encode: a **strict allowlist** encoder emitting only `a2a.v1.Message` fields (`messageId`, `contextId`, `taskId`, `role:"ROLE_AGENT"`, `parts`, `metadata`) — because the evaluator parses with `ParseDict` **without** `ignore_unknown_fields` (`sync_client.py`), one stray key fails the run. Field names taken from `a2aproject/A2A specification/a2a.proto`. **Golden fixtures are generated with the real Python `a2a-sdk`** (`MessageToDict` / `ParseDict`) in `bridge/gen_golden_fixtures.py` — offline, no LLM, no evaluator — so the contract test is checked against the genuine serializer rather than my reading of it. | unit: each golden request decodes to the expected turn input; unit: every encoded response round-trips through the **real** `ParseDict(..., Message())` (run in the bridge venv) with zero unknown fields; unit: an intentionally polluted response is **rejected** by that same check (the gate is proven to bite); unit: `role` serializes as `"ROLE_AGENT"`, `data` parts as raw JSON values |
| **T11 — `harness-adapters` A: A2A server (PRIMARY)** | The container answers the Track 1 turn contract, with correct metrics and per-task isolation | `carlo/src/a2a/server.ts` (`// @implements harness-adapters`), `carlo/src/a2a/executor.ts`, `carlo/src/a2a/card.ts`, `carlo/tests/a2a-server.test.ts` | `Bun.serve` with exactly the two routes the evaluator uses: `GET /.well-known/agent-card.json` (readiness probe via `A2ACardResolver`, `run_scenario.py:47-58`; path from `a2a-python/utils/constants.py`) and `POST /` (`DEFAULT_RPC_URL`). Card mirrors the reference fields — name, description, version, `defaultInputModes/OutputModes`, `supportedInterfaces:[{url, protocolBinding:"JSONRPC", protocolVersion:"1.0"}]`, capabilities, skills (`car-bench-ijcai/src/track_1_agent_under_test/server.py::prepare_agent_card`); parsed leniently (`ignore_unknown_fields=True`). Executor keeps history **per `contextId`**, **mints a `contextId` when the inbound has none and echoes it on every response** (G-H — without this the evaluator's `tool_provider` replays `None` and each turn starts a new conversation). `turn_metrics` attaches **only** on a final response carrying no tool-call part, aggregating `prompt_tokens`/`completion_tokens`/`thinking_tokens`/`cost`/`model`/`num_llm_calls`/`avg_llm_call_time_ms`/`num_passes` over all internal passes of that step; never `turn_time_ms` (`development-guide.md#response-metadata`). Behavior goes in parts, never metadata (`#message-parts-vs-metadata`). | unit (in-process fetch against `Bun.serve`): first-turn request → text and/or `{"tool_calls":[{tool_name, arguments}]}` data part; tool-results turn → matched and consumed; **two `contextId`s → zero history bleed**; missing inbound `contextId` → one is minted and echoed, and the follow-up turn with that id continues the same conversation; `turn_metrics` absent on a tool-call turn, present and correctly summed on the final turn; card route → 200 and a body that the real `parse_agent_card` accepts (checked in the bridge venv); unknown method → JSON-RPC error, process stays up |
| **T12 — `harness-adapters` B: Python bridge** | Local `run.py` drives CARlo through the **same** wire as the competition | `carlo/bridge/carlo_bridge.py`, `carlo/bridge/run_local.py`, `carlo/bridge/pyproject.toml`, `carlo/bridge/gen_golden_fixtures.py`, `carlo/bridge/test_bridge.py` | Implements the two-method ABC — `get_init_state(system_prompt, initial_observation) -> AgentState`, `generate_next_message(state, tools_info) -> (message, state)` (`car-bench/car_bench/agents/base.py`) — and is wired in via `run(args, ckpt_path, custom_agent_factory=make_carlo)` with the documented `(tools_info, wiki, args) -> Agent` signature (`run.py:370-390`; `car-bench/README.md#custom-agent-factory`). Each turn it performs **the evaluator's own outbound mapping** — first turn `System:/User:` text part + `{"tools":…}` data part; tool-result turns `{"tool_results":[…]}`; else a plain user text part (a faithful mirror of `src/evaluator/car_bench_evaluator.py:345-380`) — POSTs it to the bun server, and converts the response back into the OpenAI-style assistant dict the orchestrator expects (`tool_calls[{id, function:{name, arguments: <JSON string>}}]`; the orchestrator json-decodes `arguments` and appends the `role:"tool"` messages itself, `orchestrator.py:22-38,169-212`). State fields per `AgentState` (`car_bench/types.py`); `turn_counter` is the orchestrator's. **One wire, both entrypoints** — local runs therefore regression-test the production path. `a2a-sdk` (PyPI, real) is a bridge dev dep so fixtures use the genuine serializer. | unit (bun server stubbed-backbone, launched by the test): a scripted 3-turn task yields well-formed assistant dicts, `arguments` a JSON **string**, unique ids; cost/token fields accumulate monotonically; **target smoke :** the real `car_bench` from `third_party/` is imported and `run.py`'s factory path drives the bridge against a stubbed-backbone CARlo server for ≥1 turn — asserting `issubclass(CarloBridge, car_bench.agents.base.Agent)` and both method signatures equal the ABC's |
| **T13 — observability sink** | Every run leaves a discoverable, machine-readable trace | `carlo/src/trace.ts`, `carlo/tests/trace.test.ts`, `carlo/traces/.gitkeep` | Per-task JSONL under a **relative** `CARLO_TRACE_DIR` (default `carlo/traces/`), one line per turn: transcript delta, tool-def digest, gate findings, draft, verify decision, emitted step, usage/cost, timings, repair events. This is the evidence `*eval`/`*diagnose` read (dogfood). Append-only, line-buffered; must never alter or fail the decision path; never contains credentials. | unit: 3-turn task → N parseable lines each with `taskId`/`turn`/`emitted`/`usage`; unwritable dir → decision still returned, warning logged; no env value or credential substring appears in any line |
| **T14 — Docker submission image** | A `linux/amd64` image serves the A2A contract with no baked secrets | `carlo/Dockerfile`, `carlo/scenarios/local_smoke.toml`, `carlo/scenarios/local_docker_smoke.toml`, `carlo/scenarios/scenario.toml`, `carlo/tests/scenarios.test.ts` | `oven/bun` base **pinned to a digest** (bun is the runtime; version drift would be silent), non-root user, `bun install --frozen-lockfile --production`, `EXPOSE 8080`, entrypoint = the A2A server bound to `0.0.0.0` — structurally mirroring the organizer baseline image (`car-bench-ijcai/src/track_1_agent_under_test/Dockerfile.track-1-agent-under-test`). `scenario.toml` follows the submission template verbatim: official `[evaluator] image = "ghcr.io/car-bench/car-bench-evaluator:latest"`, `[agent_under_test].image` a **public digest-pinned** GHCR ref, `[agent_under_test.env]` **names only** with `${VAR:?}`/`${VAR:-}`, `[config] task_split="hidden"`, counts `-1`, `num_trials=3`, `max_steps=50` (`car-bench-ijcai/README.md#submission-instructions`). Declares `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (= `global`, P4) as organizer-provided (Q5 open). | BUILD: `docker build --platform linux/amd64` → exit 0 (daemon unavailable ⇒ record a gap, never fake); container starts and serves the card route; `docker history`/grep → no secret literal; unit: `scenario.toml` asserts official evaluator image, `@sha256:` pinned agent image, `task_split=="hidden"`, all counts `-1`, and no env **value** that looks like a secret |
| **T15 — baseline measurement harness (code now, run at EVALUATE)** | The raw-Flash bar is measurable with one command, same harness, no scaffold | `carlo/bridge/run_baseline.py`, `carlo/src/baseline.ts`, `carlo/tests/baseline.test.ts` | `beats-flash-baseline` is defined against a number that does not exist yet (`spec.intent.unknowns[0]`; "MEASURE FIRST"). Ships the instrument: same `run.py`, same splits/trials/user-simulator config, `custom_agent_factory=None` with `--model gemini-3.5-flash` so the stock `ToolCallingAgent` runs the bare backbone (`run.py:392-407`), plus a TS comparator reproducing the harness's own Pass^k formula (`run.py::display_metrics`: `comb(c,k)/comb(num_trials,k)` averaged over tasks) so scaffold-vs-baseline is computed identically per task type and overall. **Execution is EVALUATE-stage** (live Vertex, hours). | unit: comparator on synthetic results JSON reproduces hand-computed Pass^3/Pass@3 per type and overall; unit: config-parity assertion — baseline and CARlo runs differ **only** in the factory argument; **EVALUATE:** the actual numbers on train + holdout |
| **T16 — benchmark-boundary guards** | The harness provably cannot cheat | `carlo/tests/boundary.test.ts` | Encodes the prohibitions as executable checks: no CAR-bench tool executed in-process; no shell/file/browser/network capability in the decision loop; no reading of task/answer-key/mock-data files; no tool renaming or argument restructuring on emission; benchmark-visible actions only in parts (`agent-under-test-harnessing.md#agentic-harness-boundaries`; `spec.intent.constraints[benchmark boundary]`). | unit: the import graph of `pipeline.ts`/`a2a/*` contains no child-process/fs-write/outbound-fetch module (the backbone module is the one sanctioned egress, and the trace sink the one sanctioned write); emitted names/args round-trip byte-identical against the declared schema |
| **T17 — coverage gate (now native)** | Every `spec.capabilities.code[].id` has a marked module and a referencing test | *(no new artifact — markers live in T4–T12 sources)* | The stack switch dissolves revision-1's Q1: `spec-impl-coverage.ts::walkTs` collects `.ts` files, excludes `node_modules`/dot-dirs, treats `/\.test\.ts$/` as tests, and matches `@implements\s+<id>`. All seven ids get a `// @implements` marker in a `.ts` module, each with a `*.test.ts` importing it by basename. `harness-adapters` is marked in `src/a2a/server.ts` (the primary entrypoint) — the Python bridge is invisible to a `.ts` walker, so the marker must not live only in `bridge/`. | `scripts/cli/run.sh scripts/verify/spec-impl-coverage.ts .mutagent/specs/carlo/agentspec.yaml carlo/` → `[coverage] PASS`, and the id→module→test table goes into BUILD RESULT |
| **T18 — README + operator entity card inputs** | An operator can run local smoke, docker smoke and a submission build from the README alone | `carlo/README.md` | Documents both entrypoints, the env matrix (**including `GOOGLE_CLOUD_LOCATION=global`** and why, P4), the trace sink, the `third_party/` pin, and every command; links every doc pin used. Backwards reference only — points **up** to `spec_id: carlo`. | check: every README command is either exercised by a BUILD gate or explicitly labelled EVALUATE-stage; the spec back-reference line is present |

**Dependencies:** T1 → {T2, T3}; T2 → T9; T4 → {T6, T7, T8}; T5 → T8; {T6, T7, T9} → T8; T10 → T11; {T8, T10} → T11; T11 → T12; T13 → {T8, T11}; {T11, T12} → T14; T12 → T15; all → {T16, T17, T18}.
**Execution order (tests-first per task):** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T9 → T8 → T13 → T10 → T11 → T12 → T14 → T15 → T16 → T17 → T18.

### Requirement → artifact trace (intent → design → target → tests → evidence)

| Spec element | Target output | Tests | Evidence |
|---|---|---|---|
| `sop[ingest-task-frame]` | T5 + T4, run once per task in T8 `ingest` | `policy.test.ts`, `inventory.test.ts`, `pipeline.test.ts` | trace `phase=ingest` (checklist + inventory digest) |
| `sop[feasibility-gate]` / job `acknowledge-missing-capability` | T8 feasibility gate over T4 | `pipeline.test.ts` hallucination cases | trace `gate=feasibility`, zero emitted calls |
| `sop[ambiguity-gate]` / job `route-ambiguity-correctly` | T8 ambiguity gate | `pipeline.test.ts` internal/user cases | trace `gate=ambiguity`, question count |
| `sop[policy-precheck]` | T8 pre-check over T5 | `pipeline.test.ts` ordering case | trace `gate=policy`, ordered plan |
| `sop[arg-selfcheck]` | T6 + T8 repair-once | `validator.test.ts`, `pipeline.test.ts` | trace `gate=args`, `repairs=n` |
| `sop[close-cleanly]` | T8 clean-close path | `pipeline.test.ts` turn-cap case | trace `phase=close` |
| `sop[risk-triggered-escalation]` | T7 + T8 | `escalation.test.ts`, `pipeline.test.ts` | `num_passes` in trace + `turn_metrics` |
| `agent.systemPrompt` (verbatim) | T3 | `prompts.test.ts` (fixture extracted from the spec) | prompt bytes in trace header |
| `agent.workflow.inline` (`maxIterations: 50`) | T8 bounded loop | `pipeline.test.ts` turn-51 case | trace turn index bound |
| `actions[emit-tool-call-request]` | T10/T11/T12 emission only, never execution | `boundary.test.ts`, wire + server tests | emitted parts / assistant dicts |
| `constraints[temperature 0]`, `[one call per step]` | T9 + T7 | `vertex-client.test.ts`, `escalation.test.ts` | per-call kwargs in trace |
| `constraints[env-var config]` | T2 + T14 `scenario.toml` | `config.test.ts`, `scenarios.test.ts` | `.env.example`, scenario env names |
| `constraints[cost below frontier]` | T9 usage accounting (+ thinking disabled, P5) + T15 comparator | `vertex-client.test.ts`, `baseline.test.ts` | per-task token totals in trace + `turn_metrics.cost` |
| `jobs[fulfill-base-task]` | T8 full gate loop (policy pre-check + arg self-check) driving a compliant tool sequence; T11/T12 emit it | `pipeline.test.ts` (ordering, repair-once, unrepairable-drop), `a2a-server.test.ts` (multi-turn tool-result consumption), `test_bridge.py` (3-turn task through the real harness path) | trace `gate=policy` ordered plan + `emit` lines per turn; harness `r_actions_final`/`r_tool_subset` at EVALUATE |
| `jobs[acknowledge-missing-capability]` | T4 + feasibility enforcement in T8 | `pipeline.test.ts` C1 cases, `validator.test.ts` C1 block | trace `gate=feasibility verdict=block`, zero emitted calls |
| `jobs[route-ambiguity-correctly]` | T8 ambiguity gate (internal-resolution challenge) | `pipeline.test.ts` challenge / asked-anyway / exhausted cases | trace `gate=ambiguity` with `unqueried` + `redraftedTo` |
| `capabilityFit` "one core, two thin entrypoints" | T8 core; T11 + T12 entrypoints over **one** wire | `a2a-server.test.ts`, `test_bridge.py` | bridge and evaluator exercise the same codec |

### Build checks (run at BUILD)

- **lint** — `bun x biome check carlo/` → clean
- **typecheck** — `bun x tsc --noEmit` → clean
- **build** — `bun install --frozen-lockfile` reproducible; `bun build src/a2a/server.ts` bundles; `docker build --platform linux/amd64` → exit 0
- **tests** — `bun test` all green, **backbone SDK mocked, evaluator stubbed; no live Vertex call, no benchmark run, no network in any gate** (posture retained even though P3 shows ADC now works — gates stay hermetic and deterministic)
- **wire contract** — golden A2A fixtures generated and strict-parsed with the **real Python `a2a-sdk`** in the bridge venv (offline)
- **coverage** — `spec-impl-coverage.ts` over `carlo/`, natively (T17) → `[coverage] PASS`
- **target smoke** — the real `car_bench` at the pinned commit in `third_party/` drives `run.py`'s factory through the bridge against a stubbed-backbone CARlo server

### EVALUATE later (not run at BUILD)

Every behavioral criterion in `spec.evaluation` and all three scenarios: `final-state-correct`, `required-info-tools-called`, `no-invalid-tool-calls`, `no-policy-violations`, `acknowledges-missing-capability`, `correct-ambiguity-routing`, `beats-flash-baseline`, `cost-below-frontier`; scenarios `base-task`, `hallucination-task`, `disambiguation-task`; **the raw-`gemini-3.5-flash` baseline run (T15 execution)** that defines the `beats-flash-baseline` bar; the HuggingFace dataset download; local `car-bench-run` smoke and full-split runs on `car-bench-train`; the milestone-only `car-bench-public-test` holdout (never tuned against); the docker-compose evaluator smoke and GHCR validation; **the first true end-to-end A2A exchange with the real evaluator** (G-F — the local `run.py` path never speaks A2A, and the ijcai evaluator needs `GEMINI_API_KEY` for the simulated user and policy judge).
**EVALUATE preconditions:** ADC present (P3: satisfied as of 2026-08-24 16:38 — re-probe before running), `GOOGLE_CLOUD_LOCATION=global` (P4), and an evaluator-side `GEMINI_API_KEY` or `--user-model-provider vertex_ai` (Q6).

## Pinned docs crawled (fresh, by purpose)

| Purpose (spec) | URL | Crawled | Load-bearing facts extracted |
|---|---|---|---|
| benchmark harness + custom-agent interface | https://github.com/CAR-bench/car-bench | ✅ `111df1c9` | `Agent` ABC = `get_init_state` + `generate_next_message`; `run(args, ckpt_path, custom_agent_factory)` with `(tools_info, wiki, args) -> Agent`; `AgentOrchestrator.execute` owns the loop, injects `env.wiki`, strips `planning_tool`/`think` + `removed_part`, converts assistant messages to `Action`s and appends `role=tool` results; `AgentState` fields; reward fields (`r_actions_final`, `r_tool_subset`, `r_tool_execution`, `r_policy`, `r_user_end_conversation`); Pass^k formula; 129 train / 125 test; **not on PyPI** — clone-installed |
| competition interface, submission + rules (Track 1) | https://github.com/CAR-bench/car-bench-ijcai | ✅ `68769c8b` | **The agent-under-test transport is a raw JSON-RPC `SendMessage` POST** (`sync_client.py`), not SDK-mediated; strict `ParseDict` on our response; `contextId` echo behavior (`tool_provider.py`); card-based readiness probe (`run_scenario.py`); inbound part shapes + `metadata.source`; outbound `{"tool_calls":[{tool_name, arguments}]}`; `turn_metrics` rules; harness boundaries; submission = public digest-pinned GHCR image + `scenario.toml` on the official evaluator image + env-var-only model config; `max_steps = 50` |
| modular agent development against the harness | https://github.com/CAR-bench/car-bench-agentbeats | ✅ `ad69df62` | Same conceptual contract but **pre-1.0** (`TextPart`/`DataPart` classes), explicitly superseded by `car-bench-ijcai`. Background only |
| tasks + mock-world dataset | https://huggingface.co/datasets/johanneskirmayr/car-bench-dataset | ✅ 2026-02-12 rev | MIT; `tasks/{family}_{train,test}.jsonl` (matches the amended `itemsRef`); mock world under `mock_data/`; auto-downloaded on first harness run — CARlo never reads it (boundary rule) |
| backbone SDK (Vertex AI mode, TypeScript) | https://googleapis.github.io/js-genai/ | ✅ 2026-08-24 | `new GoogleGenAI({enterprise\|vertexai, project, location})`; env path is **NodeJS-only** (`GOOGLE_GENAI_USE_ENTERPRISE`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`); ADC via `gcloud auth application-default login`, options per `GoogleAuthOptions` (google-auth-library **node**); function calling via `parametersJsonSchema` + `tools:[{functionDeclarations}]` + `response.functionCalls`; `toolConfig.functionCallingConfig`; Node 20+ now, **22+ from 3.0.0**, AFC moves to Chats in 3.0.0 → **pin `<3.0.0`** |
| (wire authority, added by necessity) | https://github.com/a2aproject/A2A `specification/a2a.proto` · https://github.com/a2aproject/a2a-python | ✅ 2026-08-24 | `Message{messageId, contextId, taskId, role, parts, metadata, extensions, referenceTaskIds}`; `Part{oneof text\|raw\|url\|data, metadata, filename, mediaType}`, `data` is a `google.protobuf.Value`; `SendMessageResponse{oneof task\|message}`; `AGENT_CARD_WELL_KNOWN_PATH='/.well-known/agent-card.json'`, `DEFAULT_RPC_URL='/'`, `VERSION_HEADER='A2A-Version'`, `PROTOCOL_VERSION_1_0='1.0'`; `parse_agent_card` uses `ignore_unknown_fields=True` + legacy compat |

### Doc-extraction gaps (recorded, not guessed)

**New with the TypeScript switch:**

- **G-A — `@a2a-js/sdk@1.0.1` exists but its JSON mapping is unverified offline.** An official TS SDK is published (latest 1.0.1, 2026-07-28, deps `jose`+`uuid`). No crawled doc states whether its server emits/accepts byte-for-byte what the evaluator's protobuf-`MessageToDict`/`ParseDict` path requires. Since the evaluator bypasses card-based client construction for agent turns and speaks exactly one method at one URL, the plan implements the two routes directly on `Bun.serve` with a strict tested encoder (T10/T11). **Architect call:** approve the dependency-free wire, or direct adoption of `@a2a-js/sdk` — either way it must pass the same golden-fixture contract test.
- **G-B — bun is not a documented runtime for `@google/genai`.** The docs say Node 20+ (22+ from 3.0.0) and the Vertex auth path is explicitly node-flavoured (`google-auth-library-nodejs`). Empirically it works (P1–P6 on bun 1.3.14 / `@google/genai` 2.18.0, including a real authenticated Vertex call). Mitigation: pin the SDK `<3.0.0`, pin the bun base image by digest, and keep a documented node-runtime fallback switch in the Dockerfile. Recorded because "works today on this host" is not "supported".
- **G-C — the js-genai landing docs do not cover `thinkingConfig`, `automaticFunctionCalling`, `systemInstruction`, `temperature` or `usageMetadata`.** Those live in typedoc interface pages not enumerated by the crawl. Rather than guess, each was **verified live** (P5/P6) and cross-read against the Python SDK reference, whose field semantics are identical modulo camelCase. Flagged as doc thinness, with evidence substituted.
- **G-D — `gemini-3.5-flash` is region-restricted.** On project `<gcp-project>` it resolves at `global` only (404 at `us-central1` and `us-east5`; `gemini-2.5-flash` works at both). Harmless locally now that the default is `global`, but a **submission risk**: organizers run their own project/region and may not have this model at their location — it compounds Q5 and belongs in the submission notes.
- **G-E — thinking is ON by default for this model.** A trivial turn spent 183 thought-tokens / 257 total, versus 74 total with `thinkingBudget: 0` (P5). The spec's temperature-0 consistency constraint and the cost criterion therefore both depend on an **explicit** thinking-disable, not on a provider default.
- **G-F — no BUILD-stage end-to-end A2A exchange is possible.** The local `run.py` path never speaks A2A, and the ijcai evaluator needs an LLM key for the simulated user and policy judge. BUILD verifies the wire against golden fixtures produced by the **genuine** `a2a-sdk` serializer; the first real exchange is an EVALUATE-stage event.
- **G-G — task-state machinery deliberately unimplemented.** Returning a `message` payload leaves `status` absent, which `tool_provider` treats as `"completed"`. Streaming, `Task`, artifacts and the `TaskState` enum are out of scope. Declared as a simplification with citation rather than silently omitted.
- **G-H — `contextId` minting is a hidden requirement.** Derived from `tool_provider.py:72-82`: the evaluator replays whatever `contextId` our response carried, and sends none on the first turn. Documented nowhere in the guides; it gets its own test (T11).

**Carried over from revision 1 (unchanged by the stack switch):**

- **G-1 — `GOOGLE_GENAI_USE_VERTEXAI` is legacy/undocumented.** The JS docs name only `GOOGLE_GENAI_USE_ENTERPRISE`; `vertexai` survives as a constructor option (P2). Mitigated by passing it explicitly and accepting either env spelling.
- **G-2 — provider prompt-caching is not documented for this path.** Only explicit context caching exists in the SDK reference; the organizer references use LiteLLM's Anthropic-style `cache_control: ephemeral`, which has no `@google/genai` equivalent. Posture: stable static-first prefix ordering only, record `cachedContentTokenCount` when reported, defer explicit caching until a measurement justifies it (dogfood, partial).
- **G-3 — `car-bench` is not on PyPI** (404). Resolved by : clone at the pinned commit into `third_party/`.
- **G-4 — competition deadlines/prize details unpublished** (`README.md#submission-instructions`). Matches `spec.intent.unknowns[2]`; blocks submission planning only.
- **G-5 — task-count discrepancy** (car-bench README prose "248" vs its own table and the ijcai README "254"). Immaterial; EVALUATE uses 129 train / 125 test per the spec.
- **G-6 — `car-bench-agentbeats` contradicts `car-bench-ijcai`** on the A2A part API. Resolved in favor of `car-bench-ijcai`; recorded because the spec pins the stale doc.
- *(Revision-1 gap "spec `itemsRef` cites a non-existent `task_splits.json`" is now **closed** — the amended spec cites the per-family jsonl paths.)*

### Question status

| # | Question | Status |
|---|---|---|
| Q1 | Coverage gate is TypeScript-only | **CLOSED** — dissolved by; the stock gate now walks our sources natively (T17) |
| Q2 | Turn bound 40 vs 50 | **CLOSED** — spec amended to `maxIterations: 50`; `CARLO_MAX_TURNS` default 50 |
| Q3 | Model availability / env spelling / thinking posture | **CLOSED by evidence** — P2/P4/P5: model available at `location=global` only; `vertexai` flag works; `thinkingBudget: 0` accepted and materially cheaper. Model pin honored verbatim |
| Q4 | Install `car-bench` from GitHub | **CLOSED** — approved; pinned at `111df1c9`, smoke drives the real `run.py` factory |
| Q5 | Organizer credential shape for Vertex | **OPEN, non-blocking** — carried as a recorded unknown; compounded by G-D (region restriction). Submission-time concern only |
| Q6 | Evaluator-side LLM key for local runs | **OPEN, EVALUATE-stage** — `GEMINI_API_KEY` or `--user-model-provider vertex_ai` |
| — | Arg-repair deviation (spec `arg-selfcheck` vs the harnessing doc's "pass through invalid calls") | **RETAINED as a conscious, cited deviation** for the architect to weigh — CARlo repairs only its **own pre-emission draft**, never converting an unavailable tool into an available one (which is what the doc actually forbids), and every repair is trace-logged |

## Planned hierarchy

```text
carlo/
├── package.json                        # bun; scripts: typecheck | lint | test | build | serve
├── bun.lock
├── tsconfig.json                       # strict, noUncheckedIndexedAccess
├── biome.json
├── Dockerfile                          # oven/bun@sha256 pinned, non-root, EXPOSE 8080 -> a2a server
├── .dockerignore
├── .gitignore                          # traces/, results/, third_party/, node_modules/
├── .env.example                        # NAMES ONLY (incl. GOOGLE_CLOUD_LOCATION=global)
├── README.md
├── scenarios/
│   ├── local_smoke.toml
│   ├── local_docker_smoke.toml
│   └── scenario.toml                   # SUBMISSION: digest-pinned image, task_split="hidden"
├── src/
│   ├── index.ts
│   ├── config.ts                       # T2  env-var-only settings
│   ├── prompts.ts                      # T3  SYSTEM_PROMPT verbatim from the spec
│   ├── types.ts                        # T8  TurnInput / TurnDecision / ToolCallRequest / GateFinding
│   ├── inventory.ts                    # T4  @implements capability-inventory
│   ├── policy.ts                       # T5  @implements policy-compiler
│   ├── validator.ts                    # T6  @implements arg-validator
│   ├── escalation.ts                   # T7  @implements escalation-controller
│   ├── pipeline.ts                     # T8  @implements gate-pipeline  (transport-agnostic core)
│   ├── trace.ts                        # T13 JSONL observability sink
│   ├── baseline.ts                     # T15 Pass^k comparator
│   ├── backbone/
│   │   └── vertex.ts                   # T9  @implements vertex-client (@google/genai, Vertex mode)
│   └── a2a/
│       ├── wire.ts                     # T10 strict proto-JSON codec (allowlist encoder)
│       ├── card.ts                     # T11 agent card (/.well-known/agent-card.json)
│       ├── executor.ts                 # T11 per-contextId store, turn_metrics, contextId minting
│       └── server.ts                   # T11 @implements harness-adapters  (PRIMARY entrypoint)
├── tests/                              # bun test; *.test.ts (also what the coverage gate matches)
│   ├── fixtures/
│   │   ├── tools-info.json | -removed-tool.json | -removed-param.json
│   │   ├── wiki.md
│   │   ├── transcript-{base,hallucination,disambiguation}.json
│   │   ├── system-prompt.txt           # extracted from agentspec.yaml at test time
│   │   ├── results-sample.json
│   │   └── golden/                     # A2A request/response bytes from the REAL a2a-sdk
│   ├── config.test.ts | prompts.test.ts | inventory.test.ts | policy.test.ts
│   ├── validator.test.ts | escalation.test.ts | pipeline.test.ts | vertex-client.test.ts
│   ├── wire.test.ts | a2a-server.test.ts | trace.test.ts | scenarios.test.ts
│   ├── baseline.test.ts | boundary.test.ts
│   └── helpers/mock-backbone.ts
├── bridge/                             # T12 minimal Python bridge (local dev / baseline / evals)
│   ├── pyproject.toml                  # car-bench (path dep -> third_party), a2a-sdk, pytest
│   ├── carlo_bridge.py                 # car_bench Agent ABC -> HTTP -> bun A2A server
│   ├── run_local.py                    # run(..., custom_agent_factory=make_carlo)
│   ├── run_baseline.py                 # raw gemini-3.5-flash, no scaffold, identical config
│   ├── gen_golden_fixtures.py          # real MessageToDict/ParseDict -> tests/fixtures/golden
│   └── test_bridge.py                  # bridge unit + REAL-harness target smoke
├── third_party/
│ └── car-bench/ # cloned @ 111df1c9, gitignored, commit pinned above
└── traces/                             # T13 runtime sink (gitignored, .gitkeep tracked)
```

<!-- =========================================================================
     BUILD RESULT — appended AFTER execution of the READY plan.
     ========================================================================= -->
## BUILD RESULT · completed after execution

**Executed 2026-08-24 (B5 → B6).** The frozen PLAN was executed tests-first. **All gates are green.**
Nothing was committed to git — the tree is left dirty for the parent session.

### Setup vs gate execution — the network boundary (watch-item)

Three SETUP steps used the network, all before/outside gate execution and all pinned:

| Setup step | Command | Pin |
|---|---|---|
| TS dependencies | `bun install` | `bun.lock`; `@google/genai` resolved **2.18.0** (range `>=2.18.0 <3.0.0`) |
| Harness clone | `git clone …/car-bench.git carlo/third_party/car-bench` + `git checkout 111df1c9` | **`111df1c950c9c4061d1e29fc8deeb37e6efbd739`** (2026-08-21) — verified after checkout |
| Bridge venv | `uv venv` + `uv pip install a2a-sdk httpx pytest -e ../third_party/car-bench` | `a2a-sdk>=1.0.0` (the genuine serializer); car-bench from the pinned clone |
| Base image digest | registry manifest HEAD for `oven/bun:1.3.14-alpine` | `sha256:5acc90a9…83c0` — **resolved from the registry, not invented** |

**Gate EXECUTION is hermetic**: no live Vertex call, no benchmark run, no outbound HTTP in any gate.
The backbone is mocked in every TS test; the bridge smoke runs the real server against the
deterministic `StubBackbone`, supplied through the `CarloServerOptions.backbone` **injection seam**
(`tests/helpers/test-server.ts`) — never an environment flag, so nothing in the shipped artifact can
select it. The only sockets a gate opens are loopback ones to the locally-spawned server, plus the
docker-gated `image.test.ts`, which talks to a container on `127.0.0.1`.

### Gate results (verbatim commands + outcomes)

| # | Command | Result |
|---|---|---|
| G1 | `bun x biome check src tests` | `Checked 32 files in 32ms. No fixes applied.` — **exit 0**, 0 errors, 0 warnings |
| G2 | `bun x tsc --noEmit` | no output — **exit 0** |
| G3 | `bun test` | `125 pass · 0 fail · 461 expect() calls · Ran 125 tests across 15 files` — **exit 0** (was 119/14 pre-STEER; +6 tests: 2 static in `boundary.test.ts`, 4 in the new `image.test.ts`) |
| G4 | `bun build src/a2a/server.ts --target=bun --outdir=dist` | `Bundled 101 modules in 73ms · server.js 1.26 MB` — **exit 0** |
| G5 | `scripts/cli/run.sh scripts/verify/spec-impl-coverage.ts .mutagent/specs/carlo/agentspec.yaml carlo/` | `[coverage] PASS — all 7 code tool(s) implemented + tested.` — **exit 0** |
| G6 | `bridge/.venv/bin/python -m pytest bridge/test_bridge.py -q` | `13 passed in 4.19s` — **exit 0** (presented separately; the `.ts`-only coverage gate cannot see Python) |
| G7 | `docker build --platform linux/amd64 -t carlo:build .` | `exporting manifest sha256:b04b4ea6…4593 · naming to docker.io/library/carlo:build` — **exit 0** |
| G8 | container smoke (post-STEER): `docker run -e CARLO_TEST_BACKBONE=1 carlo:build` + card GET + `SendMessage` POST | card `name: carlo · JSONRPC 1.0`; `/app/src/backbone` = `vertex.ts` only; `/app` has no `tests`/`bridge`; the turn returns **no stub** but `backbone call failed for model "gemini-3.5-flash" at location "global": Could not load the default credentials` — **exit 0** |
| G9 | `docker history --no-trunc carlo:build` secret/test-flag grep | **0 matches** (no API-key shapes, no `CARLO_TEST_BACKBONE`) |
| G10 | `bun test tests/image.test.ts` (B7 amendment) | `4 pass · 0 fail` — **exit 0**; skips loudly if the image is absent |

**Pre-STEER note:** the original G8 exercised a *stubbed* turn inside the image
(`{"tool_calls":[{"tool_name":"get_car_color"...}]}`). That smoke was only possible **because** of
the defect B7 found; it has been replaced by the assertion above that the production image refuses
the stub path.

**Two TDD failures were real defects, found and fixed (not adjusted away):**

1. **Policy over-attachment.** The first `orderingFor` derivation attached *any* co-mentioned state
   change, so a rule that names the sunroof and the fog lights together (LLM-POL:008) would have
   forced `set_fog_lights` before opening the sunroof, and AUT-POL:010 would have forced climate
   actions before opening a window. Fixed with two cited rules: an ordering requires an explicit
   **sequencing cue** (`only if` / `before` / `already` / `in parallel` …), and it binds only the
   rule's **primary** action (first-mentioned state change, ties to the more specific name).
   Derivations now: sunroof → prereq `get_weather` + `get_sunroof_and_sunshade_position`, ordering
   `open_close_sunshade`; window → clean.
2. **Gate ordering masked capability absence.** Feasibility enforcement originally lived inside the
   arg self-check, *after* the policy pre-check — so an absent-parameter draft got redirected to a
   prerequisite lookup and the honest-limit path never fired. Feasibility enforcement now runs
   immediately after the draft, ahead of the policy gate (this is what C1 demands).

Two further failures were **test-double defects**, fixed in the doubles: the mock backbone stored the
caller's transcript array by reference (later appends looked like history bleed), and one test used
an array for `preference_categories` where the real schema declares an object — the validator was
correct to reject it.

### Files changed

**52 files created under `carlo/`** (~4,700 lines of TypeScript + ~880 lines of Python; nothing
outside `carlo/` except this report). Post-STEER: `src/backbone/stub.ts` moved to
`tests/helpers/stub-backbone.ts`; `tests/helpers/test-server.ts` and `tests/image.test.ts` added.

```text
carlo/
├── package.json · bun.lock · tsconfig.json · biome.json · Dockerfile · README.md
├── .env.example · .gitignore · .dockerignore
├── scenarios/  scenario.toml (submission) · local_smoke.toml · local_docker_smoke.toml
├── src/                                                                     lines
│   ├── types.ts          shared vocabulary + TraceSink interface (C2)         196
│   ├── config.ts         env-var-only settings                                124
│   ├── prompts.ts        SYSTEM_PROMPT (generated FROM the spec)               23
│   ├── inventory.ts      @implements capability-inventory                     121
│   ├── policy.ts         @implements policy-compiler                          213
│   ├── validator.ts      @implements arg-validator                            203
│   ├── escalation.ts     @implements escalation-controller                     86
│   ├── pipeline.ts       @implements gate-pipeline                            565
│   ├── trace.ts          JSONL observability sink                              72
│   ├── baseline.ts       Pass^k / Pass@k comparator                           103
│   ├── index.ts          public surface                                        41
│   ├── backbone/vertex.ts  @implements vertex-client                          211
│   └── a2a/  wire.ts 292 · executor.ts 158 · server.ts 116 (@implements harness-adapters) · card.ts 48
├── tests/   15 × *.test.ts + helpers/{mock-backbone,stub-backbone,test-server}.ts
│   └── fixtures/  tools-info{,-removed-tool,-removed-param}.json (58 real tools) ·
│                  wiki.md (real 19-policy wiki) · system-prompt.txt ·
│                  golden/ request-{first,tool-results,user}.json (real a2a-sdk output)
├── bridge/  carlo_bridge.py 223 · test_bridge.py 311 · gen_golden_fixtures.py 129 ·
│            run_local.py 90 · run_baseline.py 92 · conftest.py 12 · pyproject.toml
├── third_party/car-bench/   cloned @ 111df1c9 (gitignored)
└── traces/.gitkeep
```

### Spec implementation coverage

Stock `spec-impl-coverage.ts` over `carlo/`, verbatim output:

| tool-id | module | test | covered |
|---|---|---|---|
| `policy-compiler` | `policy.ts` | `policy.test.ts` | ✓ |
| `capability-inventory` | `inventory.ts` | `policy.test.ts` | ✓ |
| `gate-pipeline` | `pipeline.ts` | `pipeline.test.ts` | ✓ |
| `arg-validator` | `validator.ts` | `validator.test.ts` | ✓ |
| `escalation-controller` | `escalation.ts` | `pipeline.test.ts` | ✓ |
| `vertex-client` | `vertex.ts` | `vertex-client.test.ts` | ✓ |
| `harness-adapters` | `server.ts` | `boundary.test.ts` | ✓ |

`[coverage] PASS — all 7 code tool(s) implemented + tested.`

*Note on the gate's matching:* it binds the first test file that references a module's basename, so
`capability-inventory` and `escalation-controller` show `policy.test.ts` / `pipeline.test.ts`.
Dedicated suites also exist (`inventory.test.ts` 7 tests, `escalation.test.ts` 7 tests) — the gate's
attribution is looser than the actual coverage, never the reverse.

### Binding-condition disposition

| Condition | How it was applied | Evidence |
|---|---|---|
| **C1** — unknown tool / absent parameter must route to feasibility and never be repaired | `ValidationCode` split into repairable (missing-required, type-mismatch, enum-violation) vs **non-repairable** (`unknown-tool`, `unknown-parameter`); `toGateFindings` sends the latter to `gate: feasibility, verdict: block`; `feasibilityCheck` runs before the policy gate and returns an honest-limit statement; `repairCall` returns `null` for both cases | `validator.test.ts` C1 describe-block (3 tests) + `pipeline.test.ts` "C1: an UNKNOWN TOOL…" and "C1: an ABSENT PARAMETER…" + `repairCall` refusal tests |
| **C2** — fix the T13/T8 dependency inconsistency | **Chose the restatement option** (no reorder): `TraceSink` is declared in `src/types.ts` and injected into `GatePipeline`; the pipeline never imports the concrete writer. Recorded in the module header of `types.ts` and `pipeline.ts` | `pipeline.test.ts` "a failing trace sink never breaks the decision path"; `trace.ts` implements the interface separately |
| **C3** — add a `jobs[fulfill-base-task]` trace row | Added to the PLAN trace table, together with the other two jobs for symmetry | PLAN § *Requirement → artifact trace* |
| **RULING 1** — dependency-free encoder, cited allowlist, MANDATORY negative test | `@a2a-js/sdk` is **not** a dependency. `wire.ts` carries the `a2a.proto` field lists in its header with the pinned crawl date; `assertAllowlisted` enforces them at emit time | `wire.test.ts` "allowlists match a2a.proto exactly" + **3 negative tests** (polluted message, v0.3 `kind` part, wrong role) and `test_bridge.py` **2 negative tests** proving the REAL `ParseDict` raises `ParseError` on a polluted message and a v0.3-style part |
| **RULING 2** — arg-repair deviation boundaries | `repairCall` only normalizes enum case and numeric strings; it never touches `toolName`, never invents or drops a parameter, and returns `null` on any absence. Exactly one attempt, then the call is dropped and re-planned. Every repair is trace-logged with `before`/`after` | `pipeline.test.ts` repair/before-after trace test + "an unrepairable draft is DROPPED"; `boundary.test.ts` byte-identical round-trip; carried into the EVALUATE handoff below |

### Fidelity + loss (silence about loss is a failure)

| Requirement | Where implemented | Check → observed | Disposition |
|---|---|---|---|
| `agent.systemPrompt` verbatim | `src/prompts.ts` (generated from the card) | `prompts.test.ts` re-extracts from `agentspec.yaml` → byte-identical | **honored** |
| Evaluator policy never replaced | `composeSystemInstruction` | policy text first, CARlo's rules after | **honored** |
| `sop[ingest-task-frame]` (+ onFailure) | `inventory.ts`, `policy.ts`, `GatePipeline.frameFor` | ingest traced once/task; empty/garbage wiki → empty checklist + `unverified` | **honored** |
| `sop[feasibility-gate]` | inventory-bounded draft + `feasibilityCheck` | C1 tests → 0 tool calls, honest limit | **honored** |
| `sop[ambiguity-gate]` | ambiguity challenge re-draft | 3 tests (challenge / asked-anyway / exhausted) | **honored — mechanism differs from PLAN**, see delta 1 |
| `sop[policy-precheck]` | `policyPrecheck` + `prerequisitesFor`/`orderingFor` | weather + sunshade scheduled before the sunroof | **honored (approximated derivation)**, see below |
| `sop[arg-selfcheck]` (repair once, else re-plan) | `validator.ts` + `argSelfCheck` + `repairCall` | repaired-then-emitted; unrepairable dropped | **honored, with the cited deviation (RULING 2)** |
| `sop[close-cleanly]` (+ onFailure) | turn-cap clean close, limit statements | turn 51 → text, no throw, no silence | **honored** |
| `sop[risk-triggered-escalation]` | `escalation.ts` + pipeline | 1 call no-risk / 2 calls risky; two risks still one pass | **honored** |
| `agent.workflow` `maxIterations: 50` | `CARLO_MAX_TURNS` default 50 | `config.test.ts`, `pipeline.test.ts` | **honored** |
| `actions[emit-tool-call-request]` — request only | `a2a/wire.ts`, `executor.ts`, bridge | `boundary.test.ts`: no tool executor anywhere in `src/` | **honored** |
| **Backbone is the spec-pinned model, unswappable at runtime ** | `src/a2a/server.ts` — sole seam `options.backbone ?? new VertexBackbone(...)`; `assertLiveReady` unconditional | `boundary.test.ts` (no stub/flag in `src/`, guard unguarded) + `image.test.ts` (no stub module in the image; the retired flag yields a real `gemini-3.5-flash` attempt, not a stub) | **honored — after the B7 STEER.** The first build shipped an env-activated swap; see delta 5 |
| Temperature 0 · one call/step · env-var config | `config.ts`, `vertex.ts` | every request carries `temperature: 0`; no secret literal in the tree | **honored** |
| Cost below frontier | `mapUsage` + `turn_metrics` + `thinkingBudget: 0` | tokens aggregated per assistant step; thinking off (74 vs 257 tokens on the probe turn) | **instrumented; the criterion itself is EVALUATE-stage** |
| Never tune on the public test split | `run_baseline.py` / `run_local.py` default to `train`; README states the rule | — | **honored (procedural)** |
| **Prompt-caching best-practice (dogfood)** | static-first prefix ordering only (`systemInstruction` + tool declarations before transcript) | no explicit `caches.create`; `cachedContentTokenCount` is captured when the provider reports it | **APPROXIMATED / DEFERRED** — gap G-2: `@google/genai` documents only *explicit* context caching, and the organizer references use LiteLLM's Anthropic-style `cache_control` which has no js-genai equivalent. Deferred until a measurement justifies the TTL/cost trade-off. Not silently dropped |
| **Policy prerequisite derivation** | `policy.ts` heuristics over the wiki's `AUT-POL`/`LLM-POL` anchors | verified against the real 19-policy wiki for sunroof/window/fog-lights | **APPROXIMATED** — it is a text-derived checklist, not a formal semantics of the policies. It is deliberately over-inclusive on *information-gathering* prerequisites (extra `get_*` calls are harmless and help `r_tool_subset`) and conservative on orderings. Real-world adequacy is an EVALUATE question |
| **Ambiguity "internal sources" list** | `INTERNAL_RESOLUTION_HINTS` (4 tool names) | tests cover present/exhausted | **APPROXIMATED** — a fixed hint list, not a general theory of resolvability. Named as a first tuning candidate in the handoff |
| **A2A task/streaming machinery** | not implemented | — | **UNSUPPORTED, deliberate (G-G)** — returning a `message` payload leaves `status` absent, which `tool_provider` treats as `completed`. Streaming, `Task`, artifacts and `TaskState` are out of scope for this contract |
| **`@a2a-js/sdk` adoption** | not adopted | — | **UNSUPPORTED, deliberate (G-A, RULING 1)** — the binding constraint is the Python client's exact bytes; a hand-rolled allowlist encoder is verified against the genuine serializer instead |

### Plan-to-actual delta

1. **Ambiguity gate mechanism changed (design-level, same intent).** PLAN said the gate would
   *substitute* an internal-resolution lookup for a premature question. In execution that proved
   unsound: the real `get_user_preferences` schema **requires** `preference_categories` (an object),
   so substituting would mean inventing arguments — precisely what the spec forbids. The gate now
   spends the ambiguity risk budget on **one re-draft** whose critique names the still-unqueried
   sources, and lets the model produce valid arguments; if it still asks, the question stands.
   Ambiguity is already a declared risk trigger, so this consumes the *same* single extra pass
   rather than adding one (`extraPassSpent` suppresses a second escalation).
2. **Feasibility enforcement moved ahead of the policy gate** (C1 requirement, see above).
3. **Policy `ordering` derivation tightened** with a sequencing-cue + primary-action rule (defect 1).
4. **T13 (trace) landed before T8 (pipeline)** in file order because C2's interface lives in
   `types.ts`; the planned execution order was otherwise followed.
5. **A stub backbone was added** (not in the planned tree) — the hermetic backbone the bridge smoke
   needs. **It first shipped in the image; corrected under the B7 STEER.**

   *As first built (defect):* `src/backbone/stub.ts` was statically imported by `src/a2a/server.ts`
   and activated by `CARLO_TEST_BACKBONE=1`, which **also** short-circuited `assertLiveReady`. The
   Dockerfile copies `src/`, so the module shipped, and the flag is an environment variable —
   which organizers control in official runs. That is an env-activated backbone-swap channel in the
 submitted artifact and a model-intent hole by analogy to. My BUILD RESULT wording
   ("test-only by construction and asserted absent from the image") was **an overclaim**: the cited
   `scenarios.test.ts` assertion only proved the flag is not *set* in the Dockerfile text, which
   says nothing about the module being present or the flag being live.

   *As corrected (architect's option 1, applied in place):* the module moved to
   `tests/helpers/stub-backbone.ts`; `src/` now contains **no** reference to it or to the flag; the
   only backbone seam is `CarloServerOptions.backbone`, reached from
   `tests/helpers/test-server.ts`, which the bridge fixture spawns; `assertLiveReady` runs
   **unconditionally** in `startServer`. `.dockerignore` already excluded `tests`.

   *What is now actually proven* (not asserted by narration):
   - `boundary.test.ts` — no file under `src/` references `StubBackbone`/`CARLO_TEST_BACKBONE`/
     `stubEnabled`; the single construction site is `options.backbone ?? new VertexBackbone(...)`;
     `assertLiveReady(config);` appears unguarded.
   - `image.test.ts` (4 tests, against the BUILT image) — `/app/src/backbone/` contains exactly
     `vertex.ts`; `/app` has no `tests`/`bridge`; grep for the retired flag inside the image returns
     `NO_MATCH`; and a live turn against the production image **with `CARLO_TEST_BACKBONE=1` set**
     returns no stubbed turn but a real backbone attempt:
     `{"error":{"code":-32603,"message":"backbone call failed for model \"gemini-3.5-flash\" at location \"global\": Could not load the default credentials..."}}`
   - These tests SKIP (loudly, via `console.warn`) when the image is absent, so `bun test` stays
     portable; the docker gate is what guarantees they execute.
6. **Fixtures are richer than planned**: `tools-info.json` holds all **58 real tool schemas**
   extracted from the pinned harness sources via AST (stdlib only), not a hand-written subset.
7. **Not built (correctly deferred, unchanged from PLAN):** any live benchmark run, the HF dataset
   download, GHCR publication, and the real end-to-end A2A exchange with the official evaluator.

### Verifier findings

**B7 verdict: STEER** — one bounded amendment; everything else verified PROCEED-quality (the
architect independently re-ran all gates green and confirmed C1–C3 and both rulings in code, and
ruled all four PLAN deltas legitimate).

**The finding — unreported loss (accepted, my error).** BUILD RESULT delta 5 claimed the stub
backbone was "test-only by construction and asserted absent from the image". That was false on both
counts: the Dockerfile copies `src/` (so `src/backbone/stub.ts` shipped), `server.ts` imported it
statically and activated it on `CARLO_TEST_BACKBONE=1`, and that same flag **also bypassed
`assertLiveReady`**, the model/region guard. The cited test only proved the flag was not *set* in the
Dockerfile text. Since organizers control env vars in official runs, the submitted image carried an
env-activated backbone-swap channel — a model-intent hole by analogy to.

**Amendment applied (architect's option 1, no design re-open, no other files):** the stub moved to
`tests/helpers/stub-backbone.ts` and is injected through the pre-existing
`CarloServerOptions.backbone` seam by `tests/helpers/test-server.ts` (which the bridge fixture now
spawns); the env flag is gone from `src/` entirely; `assertLiveReady` runs unconditionally at
startup. Option 2 (a build-time inert constant) was not needed — option 1 broke nothing: the bridge
smoke required only a one-line change of spawn target.

**Re-verified after the amendment:** G1 lint, G2 typecheck, G3 `bun test` (125 pass), G5 coverage
(7/7 — re-run because files moved), G6 bridge (13 pass — re-run because its fixture changed), G7
docker build, G8 container smoke, G10 image assertions. All green; see the gate table.

Remaining for B7 sign-off: confirm the corrected delta-5 wording and the new fidelity row state
exactly what the tests prove, and that the approximated/deferred rows (prompt-caching, policy
derivation, ambiguity hints) still read honestly.

## EVALUATE handoff bundle

| Item | Path |
|---|---|
| Spec + decisions | `.mutagent/specs/carlo/agentspec.yaml` · `agentspec.decisions.md` |
| Build report | `.mutagent/build/carlo/build-report.md` |
| Implementation root | `carlo/` |
| Trace sink (evidence for `*eval` / `*diagnose`) | `carlo/traces/` (`CARLO_TRACE_DIR`, relative), one JSONL per task |
| Primary entrypoint | `bun run carlo/src/a2a/server.ts` (A2A 1.0 on `:8080`) |
| Local harness entrypoint | `carlo/bridge/run_local.py` (needs the server running) |
| **Baseline instrument** | `carlo/bridge/run_baseline.py` — **run this FIRST** |
| Pinned harness | `carlo/third_party/car-bench` @ `111df1c9` |
| ChangeRequestResponse | n/a — this BUILD was not EDD-triggered |

**Preconditions before any live run**
1. **ADC**: present and verified working under bun on 2026-08-24 16:38 (`~/.config/gcloud/application_default_credentials.json`). **This makes decision in the sidecar STALE** — the sidecar is not edited here; `ai-architect` should reconcile it via `#sync-spec`. Re-probe before a long run.
2. **`GOOGLE_CLOUD_LOCATION=global`** — `gemini-3.5-flash` 404s at `us-central1`/`us-east5` on this project (G-D).
3. **Evaluator-side credentials** — the simulated user and policy judge need `GEMINI_API_KEY` or `--user-model-provider vertex_ai` (Q6).

**Order of work at EVALUATE**
1. Measure the raw-Flash baseline on **train** (3 trials, all three families) — the bar does not exist yet.
2. Run the harnessed agent under identical settings; compare with `compareToBaseline` (strictly-above).
3. Only at a declared milestone, score the **test** split. Never tune against it.

**Open questions carried forward**
- **Q5** (non-blocking, submission-time): the submission env template is API-key shaped while Vertex needs ADC; `scenario.toml` declares `GOOGLE_APPLICATION_CREDENTIALS` pending organizer guidance. Compounded by G-D if organizers run a different project/region.
- **G-4**: competition deadlines still unpublished.
- **Carried deviation (RULING 2)**: CARlo repairs only its own pre-emission draft (enum case, numeric strings), never a tool name, never converting unavailable into available; one attempt then re-plan; every repair trace-logged. The evaluator should treat any hallucination-family regression as a signal to re-examine this.

**First tuning candidates for the OPTIMIZE loop** (each is an env flip or a small localized edit):
`CARLO_VERIFY_MODE=always` (the deferred always-verify experiment, `spec.intent.unknowns[1]`), the
conservative-vs-best-effort posture (`spec.intent.unknowns[2]`), the `INTERNAL_RESOLUTION_HINTS`
list, and the policy prerequisite/ordering heuristics.
