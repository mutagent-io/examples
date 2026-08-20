#!/usr/bin/env python3
"""Offline re-grade: score a candidate answer.FCStd against the LOCAL copy of a
task's reference + spec, inside the task's own FreeCAD docker image, using the
task's own tests/run_scorer.py. Produces the exact number the benchmark verifier
would produce (scoring is deterministic and hermetic).

Usage:
    score_offline.py TASK_DIR CANDIDATE_FCSTD [--image IMG] [--json]

The reference/spec live in TASK_DIR/environment/grader/ (also mirrored in
TASK_DIR/solution/). These files are measurement material for the harness dev
loop ONLY — nothing from them may ever be fed to the agent under test.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def find_image(task_dir: Path) -> str:
    """Prefer the pinned shared env image; fall back to a task-named image.
    Never match dangling <none> entries; always announce the choice."""
    out = subprocess.run(
        ["docker", "images", "--format", "{{.Repository}}:{{.Tag}}"],
        capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    candidates = [l for l in out if "<none>" not in l]
    for line in candidates:
        if line.startswith("cadbench-env:"):
            print(f"[score_offline] image: {line}", file=sys.stderr)
            return line
    for line in candidates:
        if task_dir.name in line:
            print(f"[score_offline] image: {line}", file=sys.stderr)
            return line
    sys.exit("no cadbench-env image found — docker build -t cadbench-env <task>/environment first")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir", type=Path)
    ap.add_argument("candidate", type=Path)
    ap.add_argument("--image", default=None)
    ap.add_argument("--json", action="store_true", help="print reward.json to stdout")
    args = ap.parse_args()

    task_dir = args.task_dir.resolve()
    candidate = args.candidate.resolve()
    grader = task_dir / "environment" / "grader"
    scorer = task_dir / "tests" / "run_scorer.py"
    for p in (grader / "reference.FCStd", grader / "spec.json", scorer):
        if not p.is_file():
            sys.exit(f"missing: {p}")
    # Mirror the live verifier's zero paths (tests/test.sh): a missing or
    # symlinked candidate scores 0, not an error.
    if candidate.is_symlink():
        print(f"{task_dir.name}  score=0.0  (candidate is a symlink)")
        return 0
    if not candidate.is_file():
        print(f"{task_dir.name}  score=0.0  (no candidate FCStd)")
        return 0

    image = args.image or find_image(task_dir)

    with tempfile.TemporaryDirectory(prefix="score-") as td:
        tdp = Path(td)
        (tdp / "out").mkdir()
        # Stage candidate next to param_check.py (the checker auto-discovers it there).
        stage = tdp / "stage"
        stage.mkdir()
        (stage / "answer.FCStd").write_bytes(candidate.read_bytes())
        pc = grader / "param_check.py"
        if pc.is_file():
            # test.sh uses ln -s to dodge a truncation race under concurrency;
            # mirror it (the mount below exposes the grader dir read-only).
            (stage / "param_check.py").symlink_to("/x/param_check.py")

        cmd = [
            "docker", "run", "--rm", "--network=none",
            "-v", f"{scorer}:/x/run_scorer.py:ro",
            "-v", f"{grader / 'reference.FCStd'}:/x/reference.FCStd:ro",
            "-v", f"{grader / 'spec.json'}:/x/spec.json:ro",
            *(["-v", f"{pc}:/x/param_check.py:ro"] if pc.is_file() else []),
            "-v", f"{stage}:/x/stage:ro",
            "-v", f"{tdp / 'out'}:/x/out",
            "--entrypoint", "python3", image,
            "/x/run_scorer.py",
            "--reference", "/x/reference.FCStd",
            "--candidate", "/x/stage/answer.FCStd",
            "--spec", "/x/spec.json",
            "--reward-txt", "/x/out/reward.txt",
            "--reward-json", "/x/out/reward.json",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        reward_json = tdp / "out" / "reward.json"
        if not reward_json.is_file():
            print(r.stdout[-3000:], file=sys.stderr)
            print(r.stderr[-3000:], file=sys.stderr)
            sys.exit("scorer produced no reward.json")
        data = json.loads(reward_json.read_text())
        if args.json:
            print(json.dumps(data, indent=2))
        else:
            print(f"{task_dir.name}  score={data.get('score')}")
            for k in ("geometry_similarity", "cad_spec_consistency", "reason"):
                if k in data:
                    print(f"  {k}: {data[k]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
