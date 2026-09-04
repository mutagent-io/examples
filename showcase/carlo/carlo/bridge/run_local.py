"""Run CAR-bench locally against the CARlo A2A server (EVALUATE-stage; makes LIVE model calls).

    # terminal 1 — the agent under test
    GOOGLE_CLOUD_PROJECT=... GOOGLE_CLOUD_LOCATION=global bun run src/a2a/server.ts

    # terminal 2 — the harness
    bridge/.venv/bin/python bridge/run_local.py --task-type base --task-split train --num-tasks 3 \
        --user-model gemini-2.5-flash --user-model-provider gemini

This calls the harness's own `run()` with `custom_agent_factory=make_carlo`
(car-bench/run.py:370-390), so the benchmark, the environment, the simulated user and the reward
calculators are all the real ones — CARlo only supplies the agent.

CARlo-minimal arm (the ④ DIAGNOSE ablation) is an ENV FLIP on the SERVER process only — the
bridge is just an HTTP client, so nothing here changes:

    # terminal 1 — the agent under test, minimal arm
    CARLO_MINIMAL=1 CARLO_TRACE_DIR=traces/minimal \
        GOOGLE_CLOUD_PROJECT=... GOOGLE_CLOUD_LOCATION=global bun run src/a2a/server.ts
    # the startup banner must read `minimal=true thinkingBudget=-1`

NOTE: the harness's simulated user and policy judge need their own provider credentials
(`GEMINI_API_KEY`, or `--user-model-provider vertex_ai` for ADC). That is the evaluator side, not
CARlo's backbone.
"""

from __future__ import annotations

import pathlib
import sys
from datetime import datetime

BRIDGE = pathlib.Path(__file__).resolve().parent
HARNESS = BRIDGE.parent / "third_party" / "car-bench"
for path in (BRIDGE, HARNESS):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import run as car_bench_run  # noqa: E402  (path setup must precede this import)

from carlo_bridge import DEFAULT_SERVER_URL, make_carlo  # noqa: E402


def main() -> None:
    parser = car_bench_run.argparse.ArgumentParser(
        parents=[], description="Run CAR-bench with CARlo as the agent under test."
    )
    # Reuse the harness's own flags by delegating to its parser where possible.
    parser.add_argument("--task-type", default="base", choices=["all", "base", "hallucination", "disambiguation"])
    parser.add_argument("--task-split", default="train", choices=["all", "train", "test"])
    parser.add_argument("--num-tasks", type=int, default=1)
    parser.add_argument("--num-trials", type=int, default=1)
    parser.add_argument("--max-concurrency", type=int, default=1)
    parser.add_argument("--user-model", default="gemini-2.5-flash")
    parser.add_argument("--user-model-provider", default="gemini")
    parser.add_argument("--policy-evaluator-model", default="gemini-2.5-flash")
    parser.add_argument("--policy-evaluator-model-provider", default="gemini")
    parser.add_argument("--log-dir", default="results")
    parser.add_argument("--ckpt-tag", default=None)
    parser.add_argument("--task-id-filter", nargs="*", default=None)
    parser.add_argument("--carlo-server-url", default=DEFAULT_SERVER_URL)
    args = parser.parse_args()

    # Fill in the remaining flags run() expects with the harness's own defaults.
    defaults = {
        "env": "car_voice_assistant",
        "model": "carlo",
        "model_provider": None,
        "agent_strategy": "tool-calling",
        "temperature": 0.0,
        "task_id_filter": None,
        "seed": 10,
        "shuffle": 0,
        "user_strategy": "llm",
        "policy_evaluator_strategy": "llm",
        "evaluate_policy": True,
        "score_tool_execution_errors": True,
        "score_policy_errors": True,
        "use_user_as_a_tool_tools": False,
        "thinking": False,
        "user_thinking": True,
        "reasoning_effort": "none",
        "interleaved_thinking": False,
        "remove_non_standard_fields_from_tools": False,
        "planning_and_thinking_tool": True,
    }
    for key, value in defaults.items():
        if not hasattr(args, key):
            setattr(args, key, value)

    # A fixed --ckpt-tag pins the checkpoint name so run.py RESUMES it (task indices already
    # in the file are skipped) — long runs survive interruption. Default: timestamped (fresh).
    stamp = args.ckpt_tag or datetime.now().strftime("%m%d%H%M%S")
    ckpt = f"{args.log_dir}/{args.task_type}_{args.task_split}/carlo_{stamp}.json"

    results = car_bench_run.run(args=args, ckpt_path=ckpt, custom_agent_factory=make_carlo)
    car_bench_run.display_metrics(results)
    print(f"\nResults: {ckpt}")


if __name__ == "__main__":
    main()
