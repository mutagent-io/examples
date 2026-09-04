#!/usr/bin/env python3
"""Merge official cadgenbench numbers with our cad_score_proxy records and
compute per-axis agreement stats. Runs on plain python3 (stdlib only)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path("/home/bruno/dev/mutagent/playground/cad-agents/stl-agent")
PARITY = ROOT / ".mutagent/evaluator/parity-001"
SCORES = ROOT / ".mutagent/evaluator/rescore-002/scores"

official = {}
for line in (PARITY / "official_raw.jsonl").read_text().splitlines():
    r = json.loads(line)
    official[(r["arm"], r["id"])] = r

records = []
for (arm, fid), off in official.items():
    prox = json.loads((SCORES / f"{arm}__{fid}.json").read_text())
    sc = prox["scorecard"]
    rec = {
        "arm": arm, "id": fid,
        "proxy": {
            "status": prox["status"],
            "valid": sc.get("valid"),
            "surface_distance_f1": sc.get("surface_distance_f1"),
            "volume_iou": sc.get("volume_iou"),
            "shape_similarity": sc.get("shape_similarity"),
            "baseline_shape_similarity": sc.get("baseline_shape_similarity"),
            "shape_similarity_renormalized": sc.get("shape_similarity_renormalized"),
            "topology_match": sc.get("topology_match"),
            "betti_candidate": sc.get("betti_candidate"),
            "betti_ground_truth": sc.get("betti_ground_truth"),
            "cad_score_proxy": prox.get("cad_score_proxy"),
            "validity_failures": sc.get("validity_failures"),
        },
        "official": {
            "status": off.get("official_status"),
            "is_valid": off.get("official_validity", {}).get("is_valid"),
            "validity_errors": off.get("official_validity", {}).get("topology_errors"),
            "shape": off.get("official_shape"),
            "topology": off.get("official_topology"),
            "edit": off.get("official_edit"),
            "cad_score": off.get("official_cad_score"),
            "elapsed_s": off.get("elapsed_s"),
        },
    }
    records.append(rec)

records.sort(key=lambda r: (r["arm"], r["id"]))
with (PARITY / "records.jsonl").open("w") as fh:
    for r in records:
        fh.write(json.dumps(r) + "\n")

# ---------------- agreement stats ----------------

def spearman(xs, ys):
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        rk = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                rk[order[k]] = avg
            i = j + 1
        return rk

    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    dx = sum((a - mx) ** 2 for a in rx) ** 0.5
    dy = sum((b - my) ** 2 for b in ry) ** 0.5
    return num / (dx * dy) if dx and dy else None


def pearson(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    dx = sum((a - mx) ** 2 for a in xs) ** 0.5
    dy = sum((b - my) ** 2 for b in ys) ** 0.5
    return num / (dx * dy) if dx and dy else None


validity_agree = []
for r in records:
    pv = bool(r["proxy"]["valid"])
    ov = bool(r["official"]["is_valid"])
    validity_agree.append({"arm": r["arm"], "id": r["id"], "proxy": pv,
                           "official": ov, "agree": pv == ov})

valid_recs = [r for r in records if r["official"]["is_valid"] and r["proxy"]["valid"]]


def axis_pairs(getter_p, getter_o):
    ps, os_, ids = [], [], []
    for r in valid_recs:
        p, o = getter_p(r), getter_o(r)
        if p is None or o is None:
            continue
        ps.append(float(p)); os_.append(float(o)); ids.append(f"{r['arm']}/{r['id']}")
    return ps, os_, ids


axes = {
    "surface_distance_f1": (
        lambda r: r["proxy"]["surface_distance_f1"],
        lambda r: (r["official"]["shape"] or {}).get("shape_surface_distance_f1"),
    ),
    "volume_iou": (
        lambda r: r["proxy"]["volume_iou"],
        lambda r: (r["official"]["shape"] or {}).get("shape_volume_iou"),
    ),
    "shape_similarity_raw": (
        lambda r: r["proxy"]["shape_similarity"],
        lambda r: (r["official"]["shape"] or {}).get("shape_similarity_score"),
    ),
    "baseline_shape_similarity": (
        lambda r: r["proxy"]["baseline_shape_similarity"],
        lambda r: (r["official"]["edit"] or {}).get("baseline_shape_similarity"),
    ),
    "shape_similarity_renormalized": (
        lambda r: r["proxy"]["shape_similarity_renormalized"],
        lambda r: (r["official"]["edit"] or {}).get("shape_similarity_renormalized"),
    ),
    "topology_match": (
        lambda r: r["proxy"]["topology_match"],
        lambda r: (r["official"]["topology"] or {}).get("score"),
    ),
    "final_score": (
        lambda r: r["proxy"]["cad_score_proxy"],
        lambda r: r["official"]["cad_score"],
    ),
}

axis_stats = {}
for name, (gp, go) in axes.items():
    ps, os_, ids = axis_pairs(gp, go)
    diffs = [abs(a - b) for a, b in zip(ps, os_)]
    axis_stats[name] = {
        "n": len(ps),
        "pearson": round(pearson(ps, os_), 4) if len(ps) > 2 else None,
        "spearman": round(spearman(ps, os_), 4) if len(ps) > 2 else None,
        "mean_abs_diff": round(sum(diffs) / len(diffs), 4) if diffs else None,
        "max_abs_diff": round(max(diffs), 4) if diffs else None,
        "max_abs_diff_case": ids[diffs.index(max(diffs))] if diffs else None,
        "pairs": [
            {"case": i, "proxy": round(p, 4), "official": round(o, 4)}
            for i, p, o in zip(ids, ps, os_)
        ],
    }

# ordering disagreements on final score (all 8, invalid scored 0/0)
finals = [
    (f"{r['arm']}/{r['id']}",
     float(r["proxy"]["cad_score_proxy"] if r["proxy"]["cad_score_proxy"] is not None
           else 0.0),
     float(r["official"]["cad_score"]))
    for r in records
]
order_disagreements = []
for i in range(len(finals)):
    for j in range(i + 1, len(finals)):
        a, b = finals[i], finals[j]
        dp, do = a[1] - b[1], a[2] - b[2]
        if dp * do < 0 and abs(dp) > 1e-6 and abs(do) > 1e-6:
            order_disagreements.append({
                "pair": [a[0], b[0]],
                "proxy": [round(a[1], 4), round(b[1], 4)],
                "official": [round(a[2], 4), round(b[2], 4)],
            })

summary = {
    "parity_id": "parity-001",
    "cadgenbench_version": official[list(official)[0]].get("cadgenbench_version"),
    "n_pairs": len(records),
    "validity": {
        "n": len(validity_agree),
        "n_agree": sum(v["agree"] for v in validity_agree),
        "cases": validity_agree,
    },
    "axis_stats": axis_stats,
    "final_score_order_disagreements": order_disagreements,
    "spearman_final_all8": round(
        spearman([f[1] for f in finals], [f[2] for f in finals]), 4),
}
(PARITY / "summary.json").write_text(json.dumps(summary, indent=1))
print(json.dumps({k: v for k, v in summary.items() if k != "axis_stats"}, indent=1))
for name, st in axis_stats.items():
    print(name, {k: st[k] for k in ("n", "pearson", "spearman", "mean_abs_diff",
                                     "max_abs_diff", "max_abs_diff_case")})
