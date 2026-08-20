#!/usr/bin/env python3
"""Extract reference measurements (volume/area/sorted bbox/surface-type areas,
solid count) for every task into harness/refs.json — dev-loop measurement
material only; never exposed to the agent.

Reads PartShape.brp (the Body's own shape) from each reference.FCStd via OCP.
Run with the cadgenbench venv python (has OCP).
"""
import json
import sys
import tempfile
import os
import zipfile
from pathlib import Path

from OCP.BRepTools import BRepTools
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Shape
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE
from OCP.TopoDS import TopoDS
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_SurfaceType
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

SURF_NAMES = {
    GeomAbs_SurfaceType.GeomAbs_Plane: "Plane",
    GeomAbs_SurfaceType.GeomAbs_Cylinder: "Cylinder",
    GeomAbs_SurfaceType.GeomAbs_Cone: "Cone",
    GeomAbs_SurfaceType.GeomAbs_Sphere: "Sphere",
    GeomAbs_SurfaceType.GeomAbs_Torus: "Toroid",
    GeomAbs_SurfaceType.GeomAbs_BSplineSurface: "BSplineSurface",
    GeomAbs_SurfaceType.GeomAbs_SurfaceOfExtrusion: "SurfaceOfExtrusion",
    GeomAbs_SurfaceType.GeomAbs_SurfaceOfRevolution: "SurfaceOfRevolution",
}


def load_shape(fcstd: Path) -> TopoDS_Shape | None:
    with zipfile.ZipFile(fcstd) as z:
        if "PartShape.brp" not in z.namelist():
            return None
        data = z.read("PartShape.brp")
    with tempfile.NamedTemporaryFile(suffix=".brp", delete=False) as f:
        f.write(data)
        p = f.name
    s = TopoDS_Shape()
    BRepTools.Read_s(s, p, BRep_Builder())
    os.unlink(p)
    return None if s.IsNull() else s


def measure(s: TopoDS_Shape) -> dict:
    gv = GProp_GProps(); BRepGProp.VolumeProperties_s(s, gv)
    ga = GProp_GProps(); BRepGProp.SurfaceProperties_s(s, ga)
    ns = 0
    ex = TopExp_Explorer(s, TopAbs_SOLID)
    while ex.More():
        ns += 1; ex.Next()
    box = Bnd_Box(); BRepBndLib.Add_s(s, box, False)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    by_type: dict[str, float] = {}
    ex = TopExp_Explorer(s, TopAbs_FACE)
    while ex.More():
        face = TopoDS.Face_s(ex.Current())
        st = SURF_NAMES.get(BRepAdaptor_Surface(face).GetType(), "Other")
        gf = GProp_GProps(); BRepGProp.SurfaceProperties_s(face, gf)
        by_type[st] = by_type.get(st, 0.0) + gf.Mass()
        ex.Next()
    return {
        "volume": gv.Mass(),
        "area": ga.Mass(),
        "solids": ns,
        "bbox_sorted": sorted([xmax - xmin, ymax - ymin, zmax - zmin]),
        "surface_area_by_type": {k: round(v, 3) for k, v in sorted(by_type.items())},
    }


def main() -> int:
    root = Path(__file__).resolve().parent.parent / "tasks" / "cad-bench"
    out = {}
    for task in sorted(root.iterdir()):
        ref = task / "solution" / "reference.FCStd"
        if not ref.is_file():
            continue
        spec = json.loads((task / "environment" / "grader" / "spec.json").read_text())
        s = load_shape(ref)
        if s is None:
            out[task.name] = {"error": "no PartShape.brp"}
            continue
        rec = measure(s)
        rec["name"] = spec["name"]
        out[task.name] = rec
    dest = Path(__file__).resolve().parent / "refs.json"
    dest.write_text(json.dumps(out, indent=1))
    print(f"wrote {dest} ({len(out)} tasks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
