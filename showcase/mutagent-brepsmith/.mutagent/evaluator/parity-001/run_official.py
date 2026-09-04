#!/usr/bin/env python
"""Parity driver: run the OFFICIAL cadgenbench metrics on 8 (arm, fixture) pairs
and record them next to our local cad_score_proxy components.

Runs inside .venv-cadgenbench (official package). Writes only under
.mutagent/evaluator/parity-001/.
"""
from __future__ import annotations

import json
import sys
import time
import traceback
from pathlib import Path

ROOT = Path("/home/bruno/dev/mutagent/playground/cad-agents/stl-agent")
PARITY = ROOT / ".mutagent/evaluator/parity-001"
SCORES = ROOT / ".mutagent/evaluator/rescore-002/scores"
RUNS = ROOT / "runs/eval-run-001"
CASES = ROOT / "datasets/synthetic-edit-pairs/cases"

PAIRS = [
    ("armA", "abc_0397-thicken"),
    ("armA", "abc_0285-hole-pattern"),
    ("armA", "abc_0228-boss-union"),
    ("armA", "abc_0396-corner-fillet"),
    ("armB", "abc_0067-fill-hole"),
    ("armB", "abc_0152-through-hole"),
    ("armB", "abc_0374-through-hole"),
    ("armB", "abc_0380-boss-union"),
]

from cadgenbench import __version__ as CGB_VERSION
from cadgenbench.common.validity import analyze_step
from cadgenbench.eval.shape_similarity import compare_step_files
from cadgenbench.eval.topo_match import topo_match
from cadgenbench.eval.edit_baseline import (
    compute_edit_baseline,
    renormalize_shape,
    EDITING_AXIS_WEIGHTS,
)
from cadgenbench.eval.evaluate import _cad_score

WORK = PARITY / "work"
WORK.mkdir(parents=True, exist_ok=True)

# Cache official no-op baselines per fixture (fixture constant).
_baseline_cache: dict[str, dict] = {}


def official_baseline(fixture: str) -> dict:
    if fixture not in _baseline_cache:
        cache_file = WORK / f"baseline__{fixture}.json"
        if cache_file.exists():
            _baseline_cache[fixture] = json.loads(cache_file.read_text())
        else:
            b = compute_edit_baseline(
                CASES / fixture / "input.step",
                CASES / fixture / "ground_truth.step",
            )
            cache_file.write_text(json.dumps(b, indent=1))
            _baseline_cache[fixture] = b
    return _baseline_cache[fixture]


def score_pair(arm: str, fixture: str) -> dict:
    rec: dict = {"arm": arm, "id": fixture, "cadgenbench_version": CGB_VERSION}
    out_step = RUNS / arm / fixture / "output.step"
    gt_step = CASES / fixture / "ground_truth.step"
    rec["candidate"] = str(out_step)

    t0 = time.time()
    # --- official validity gate (same as sanity_check_submission.py) ---
    try:
        analysis = analyze_step(out_step)
        val = analysis.validation
        rec["official_validity"] = {
            "is_valid": bool(val.is_valid),
            "is_watertight": bool(val.is_watertight),
            "topology_errors": list(val.topology_errors)[:10],
        }
    except Exception as exc:
        rec["official_validity"] = {"is_valid": False, "load_error": str(exc)}

    if not rec["official_validity"]["is_valid"]:
        rec["official_cad_score"] = 0.0
        rec["official_status"] = "invalid"
        rec["elapsed_s"] = round(time.time() - t0, 1)
        return rec

    # --- official shape similarity (with official ICP alignment) ---
    aligned_out = WORK / f"{arm}__{fixture}__aligned.step"
    comparison = compare_step_files(out_step, gt_step, align=True,
                                    aligned_output=aligned_out)
    scores = comparison.scores
    rec["official_shape"] = {k: scores.get(k) for k in scores}
    rec["official_shape_diagnostics"] = getattr(comparison, "diagnostics", None)
    if getattr(comparison, "metric_errors", None):
        rec["official_metric_errors"] = comparison.metric_errors

    # --- official topology match (Betti numbers) ---
    topo = topo_match(out_step, gt_step).to_dict()
    rec["official_topology"] = topo

    # --- official editing renormalization vs no-op baseline ---
    baseline = official_baseline(fixture)
    b_shape = baseline.get("shape_similarity_score")
    raw_shape = scores.get("shape_similarity_score")
    shape_renorm = (
        renormalize_shape(float(raw_shape), float(b_shape))
        if raw_shape is not None and b_shape is not None else None
    )
    rec["official_edit"] = {
        "baseline_shape_similarity": b_shape,
        "shape_similarity_raw": raw_shape,
        "shape_similarity_renormalized": shape_renorm,
    }

    # --- official cad_score (editing weights, no interface jig => renorm /0.7)
    rec["official_cad_score"] = _cad_score(
        scores=scores,
        interface_metrics={},
        topology_metrics=topo,
        validation={"is_valid": True},
        shape_score=shape_renorm,
        weights=EDITING_AXIS_WEIGHTS,
    )
    rec["official_status"] = "ok"
    rec["elapsed_s"] = round(time.time() - t0, 1)
    return rec


def main() -> int:
    out_path = PARITY / "official_raw.jsonl"
    done = set()
    if out_path.exists():
        for line in out_path.read_text().splitlines():
            r = json.loads(line)
            done.add((r["arm"], r["id"]))
    with out_path.open("a") as fh:
        for arm, fixture in PAIRS:
            if (arm, fixture) in done:
                print(f"skip {arm} {fixture} (done)", flush=True)
                continue
            print(f"scoring {arm} {fixture} ...", flush=True)
            try:
                rec = score_pair(arm, fixture)
            except Exception:
                rec = {"arm": arm, "id": fixture, "official_status": "error",
                       "error": traceback.format_exc()}
            fh.write(json.dumps(rec) + "\n")
            fh.flush()
            print(f"  -> {rec.get('official_status')} "
                  f"cad_score={rec.get('official_cad_score')}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
