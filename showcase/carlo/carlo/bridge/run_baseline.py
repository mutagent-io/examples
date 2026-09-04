"""Measure the RAW gemini-3.5-flash baseline — the bar `beats-flash-baseline` is defined against.

`spec.intent.unknowns[0]`: "The exact raw gemini-3.5-flash Pass^3 baseline on each split — must be
measured first, as the success bar is defined against it." (decisions: MEASURE FIRST.)

This runs the SAME harness, splits, trials and simulated-user configuration as `run_local.py`, with
`custom_agent_factory=None` so the harness's stock `ToolCallingAgent` drives the bare backbone
(car-bench/run.py:392-407) — no CARlo scaffold anywhere in the loop. The only difference between the
two runs is the agent, which is what makes the comparison causal.

EVALUATE-stage: this makes live model calls and takes hours on a full split. It is never run by a
BUILD gate.

    bridge/.venv/bin/python bridge/run_baseline.py --task-type all --task-split train --num-trials 3
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from datetime import datetime

BRIDGE = pathlib.Path(__file__).resolve().parent
HARNESS = BRIDGE.parent / "third_party" / "car-bench"
for path in (BRIDGE, HARNESS):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import run as car_bench_run  # noqa: E402

# The spec's pinned backbone. LiteLLM addresses Vertex as `vertex_ai/<model>`; the harness passes
# `--model-provider` straight through to litellm.
BASELINE_MODEL = "gemini-3.5-flash"
BASELINE_PROVIDER = "vertex_ai"


def build_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Measure the raw gemini-3.5-flash CAR-bench baseline.")
    parser.add_argument("--task-type", default="all", choices=["all", "base", "hallucination", "disambiguation"])
    parser.add_argument("--task-split", default="train", choices=["all", "train", "test"])
    parser.add_argument("--num-tasks", type=int, default=-1)
    parser.add_argument("--num-trials", type=int, default=3)
    parser.add_argument("--max-concurrency", type=int, default=1)
    parser.add_argument("--model", default=BASELINE_MODEL)
    parser.add_argument("--model-provider", default=BASELINE_PROVIDER)
    parser.add_argument("--user-model", default="gemini-2.5-flash")
    parser.add_argument("--user-model-provider", default="gemini")
    parser.add_argument("--policy-evaluator-model", default="gemini-2.5-flash")
    parser.add_argument("--policy-evaluator-model-provider", default="gemini")
    parser.add_argument("--log-dir", default="results/baseline")
    parser.add_argument("--ckpt-tag", default=None)
    parser.add_argument("--task-id-filter", nargs="*", default=None)
    args = parser.parse_args()

    defaults = {
        "env": "car_voice_assistant",
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
        setattr(args, key, value) if not hasattr(args, key) else None
    return args


def main() -> None:
    args = build_args()
    # A fixed --ckpt-tag pins the checkpoint name so run.py RESUMES it (task indices already
    # in the file are skipped) — long runs survive interruption. Default: timestamped (fresh).
    stamp = args.ckpt_tag or datetime.now().strftime("%m%d%H%M%S")
    ckpt = f"{args.log_dir}/{args.task_type}_{args.task_split}/raw-flash_{stamp}.json"

    # custom_agent_factory=None => the harness's stock agent, i.e. the BARE backbone.
    results = car_bench_run.run(args=args, ckpt_path=ckpt, custom_agent_factory=None)
    car_bench_run.display_metrics(results)
    print(f"\nBaseline results: {ckpt}")
    print("Compare with: bun -e \"import {computeMetrics,compareToBaseline} ...\" (src/baseline.ts)")


if __name__ == "__main__":
    main()
