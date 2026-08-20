#!/usr/bin/env python3
"""Batch offline re-grade of a harbor job dir: score every trial's answer.FCStd
against its task's local reference and print the per-task table + mean combined —
the implementation of the agentspec's `combined-score` criterion.

Usage: score_all.py JOBS_DIR... [--image IMG]
Missing answers score 0.0, exactly as the benchmark counts them.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASKS = HERE.parent / "tasks" / "cad-bench"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("jobs", nargs="+", type=Path)
    ap.add_argument("--image", default="cadbench-env:latest")
    args = ap.parse_args()

    rows = []
    for job in args.jobs:
        for trial in sorted(job.iterdir()):
            m = re.match(r"(freecad-[0-9a-f]+)__", trial.name)
            if not m:
                continue
            task = m.group(1)
            fcstd = trial / "agent" / "answer" / "answer.FCStd"
            if not fcstd.is_file():
                rows.append((task, 0.0, None, None, "no answer.FCStd"))
                continue
            r = subprocess.run(
                [sys.executable, str(HERE / "score_offline.py"),
                 str(TASKS / task), str(fcstd), "--image", args.image, "--json"],
                capture_output=True, text=True,
            )
            try:
                d = json.loads(r.stdout)
                rows.append((task, d["score"], d.get("geometry_similarity"),
                             d.get("cad_spec_consistency"), ""))
            except Exception:
                rows.append((task, 0.0, None, None,
                             (r.stdout + r.stderr)[-120:].replace("\n", " ")))

    if not rows:
        sys.exit("no trials found")
    print(f"{'task':<24} {'combined':>8} {'geom':>6} {'spec':>6}  note")
    for task, s, g, c, note in rows:
        gs = f"{g:.3f}" if g is not None else "-"
        cs = f"{c:.3f}" if c is not None else "-"
        print(f"{task:<24} {s:>8.4f} {gs:>6} {cs:>6}  {note}")
    mean = sum(r[1] for r in rows) / len(rows)
    print(f"\nmean combined over {len(rows)} trials: {mean:.4f}  (target > 0.906)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
