#!/usr/bin/env python3
"""Render answer.FCStd solids (PartShape.brp) to PNG via OCP tessellation + matplotlib."""
import sys, zipfile, tempfile, os
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from OCP.BRepTools import BRepTools
from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.TopoDS import TopoDS_Shape, TopoDS
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE
from OCP.TopLoc import TopLoc_Location

def load(fcstd):
    with zipfile.ZipFile(fcstd) as z:
        data = z.read("PartShape.brp")
    with tempfile.NamedTemporaryFile(suffix=".brp", delete=False) as f:
        f.write(data); p = f.name
    s = TopoDS_Shape(); BRepTools.Read_s(s, p, BRep_Builder()); os.unlink(p)
    return s

def tris(shape, defl=0.15):
    BRepMesh_IncrementalMesh(shape, defl, False, 0.3, True)
    out = []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        face = TopoDS.Face_s(ex.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            trsf = loc.Transformation()
            pts = []
            for i in range(1, tri.NbNodes()+1):
                pnt = tri.Node(i).Transformed(trsf)
                pts.append((pnt.X(), pnt.Y(), pnt.Z()))
            pts = np.array(pts)
            for i in range(1, tri.NbTriangles()+1):
                a,b,c = tri.Triangle(i).Get()
                out.append(pts[[a-1,b-1,c-1]])
        ex.Next()
    return np.array(out)

def render(fcstd, out_png, title, elev=28, azim=-55):
    t = tris(load(fcstd))
    fig = plt.figure(figsize=(5,5), dpi=110)
    ax = fig.add_subplot(111, projection="3d")
    # simple lambert shading
    n = np.cross(t[:,1]-t[:,0], t[:,2]-t[:,0])
    n = n/ (np.linalg.norm(n,axis=1,keepdims=True)+1e-12)
    light = np.array([0.4,0.35,0.85]); light/=np.linalg.norm(light)
    inten = np.clip(np.abs(n@light), 0.15, 1.0)
    cols = np.outer(inten, np.array([0.45,0.62,0.85]))
    pc = Poly3DCollection(t, facecolors=np.clip(cols,0,1), edgecolor="none")
    ax.add_collection3d(pc)
    lo, hi = t.min(axis=(0,1)), t.max(axis=(0,1))
    c, r = (lo+hi)/2, (hi-lo).max()/2
    for f,cc in zip((ax.set_xlim,ax.set_ylim,ax.set_zlim), c): f(cc-r, cc+r)
    ax.set_axis_off(); ax.view_init(elev=elev, azim=azim)
    fig.tight_layout(pad=0)
    fig.savefig(out_png, bbox_inches="tight", transparent=True, pad_inches=0.05)
    plt.close(fig)
    print("wrote", out_png)

if __name__ == "__main__":
    outdir = Path("gnucleus-bench/renders"); outdir.mkdir(exist_ok=True)
    jobs = Path("gnucleus-bench/jobs")
    picks = {
        "spur gear z=80":            "slice-dev2-rerun/freecad-1db55e40f2__fuv7Q5J",
        "gear stock z=12 undercut":  "slice-dev2/freecad-ab46933317__kzLwkjd",
        "disc spring":               "slice-dev2/freecad-14da78600e__uvxhirP",
        "connecting rod":            "slice-dev/freecad-da772a2e0b__bjA4TYt",
        "shaft with 2 keyways":      "slice-dev2/freecad-e74ef5c003__NvuQimn",
        "hex flange nut":            "slice-dev2/freecad-539c2a6856__FNuP9ZM",
        "11-section stepped shaft":  "slice-dev2/freecad-5c60c7a002__UMD3dFq",
        "round mounting flange":     "slice-dev2/freecad-0fe9d9e3ce__FdPBmCw",
    }
    for title, rel in picks.items():
        f = jobs/rel/"agent"/"answer"/"answer.FCStd"
        if not f.is_file(): print("MISSING", f); continue
        slug = title.replace(" ","-").replace("=","")
        render(f, outdir/f"{slug}.png", title)
