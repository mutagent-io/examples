"""Print the task ids of a split that do NOT yet have 3 completed trials in a checkpoint.

run.py's checkpoint is append-only logging, not resume — the trial loop reruns every selected
index. Real resume therefore lives here: list what's missing, pass it via --task-id-filter.

Usage: remaining_tasks.py <task_type> <task_split> <ckpt_path> [num_trials=3]
Prints space-separated task ids (empty output = nothing left to run).
"""

from __future__ import annotations

import collections
import json
import pathlib
import sys

BRIDGE = pathlib.Path(__file__).resolve().parent
HARNESS = BRIDGE.parent / "third_party" / "car-bench"
for path in (BRIDGE, HARNESS):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from car_bench.envs import get_env  # noqa: E402


def main() -> None:
    task_type, task_split, ckpt = sys.argv[1], sys.argv[2], sys.argv[3]
    num_trials = int(sys.argv[4]) if len(sys.argv) > 4 else 3

    env = get_env(
        "car_voice_assistant",
        user_strategy="llm",
        user_model="gemini-2.5-flash",
        user_provider="vertex_ai",
        policy_evaluator_strategy="llm",
        policy_evaluator_model="gemini-2.5-flash",
        policy_evaluator_provider="vertex_ai",
        task_type=task_type,
        task_split=task_split,
    )
    all_ids = [t.task_id for t in env.tasks]

    done = collections.Counter()
    p = pathlib.Path(ckpt)
    if p.exists():
        for r in json.loads(p.read_text()):
            # count only records that actually scored (an infra-error record has no reward_info
            # but does carry reward — count it anyway: it consumed a trial slot in this file)
            done[(r.get("task_id"), r.get("trial", 0))] += 1
        trials_per_task = collections.Counter(tid for (tid, _trial) in done)
    else:
        trials_per_task = collections.Counter()

    remaining = [tid for tid in all_ids if trials_per_task[tid] < num_trials]
    print("REMAINING: " + " ".join(remaining))


if __name__ == "__main__":
    main()
