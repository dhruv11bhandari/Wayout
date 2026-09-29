"""Developer tool: render the floor plan, agents and density peak to a PNG with matplotlib.

    python -m utils.debug_plot out.png [corridor_width] [occupancy]
"""
from __future__ import annotations

import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Rectangle

sys.path.insert(0, ".")
from building import BuildingParams, build_geometry  # noqa: E402
from simulation import LocalSimulationEngine, SimConfig  # noqa: E402


def draw_building(ax, b):
    ax.set_facecolor("#0a1322")
    for c in b.corridors:
        ax.add_patch(Rectangle((c.x, c.y), c.width, c.height, fc="#12233b", ec="none"))
    for r in b.rooms:
        ax.add_patch(Rectangle((r.x, r.y), r.width, r.height, fc="#0e1a2c", ec="none"))
    for w in b.walls:
        x0, y0, x1, y1 = w.rect()
        ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fc="#ff5555" if w.kind == "blocked" else "#9db8d8", ec="none"))
    for o in b.obstacles:
        ax.add_patch(Rectangle((o.x, o.y), o.width, o.height, fc="#3a4d68", ec="#9db8d8"))
    for e in b.exits:
        ax.plot(e.x, e.y, "s", color="#34d399", ms=6)
        ax.text(e.x, e.y, e.label, color="#34d399", fontsize=7)
    ax.set_xlim(-3, b.width + 3); ax.set_ylim(b.height + 3, -3); ax.set_aspect("equal")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "debug.png"
    cw = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
    occ = int(sys.argv[3]) if len(sys.argv) > 3 else 120
    p = BuildingParams(corridor_width=cw, occupancy=occ)
    b = build_geometry(p)
    r = LocalSimulationEngine().simulate(p, SimConfig())
    pos = np.array(r["trajectories"]["positions"]).reshape(r["trajectories"]["n_frames"], -1, 2)
    T = r["clearance_time"]
    times = [0, 0.15 * T, 0.35 * T, 0.6 * T]
    fig, axs = plt.subplots(3, 2, figsize=(16, 13), facecolor="#060b14")
    axs = axs.ravel()
    for ax, tt in zip(axs[:4], times):
        draw_building(ax, b)
        f = min(int(tt / r["trajectories"]["frame_dt"]), pos.shape[0] - 1)
        ev = np.array([np.inf if v is None else v for v in r["agents"]["evac_time"]])
        vis = ev > tt
        ax.scatter(pos[f][vis, 0], pos[f][vis, 1], s=14, c="#38bdf8")
        ax.set_title(f"t={tt:.0f}s  remaining={vis.sum()}", color="w", fontsize=9)
    ax = axs[4]
    draw_building(ax, b)
    g = np.array(r["density_grid"]["peak"])
    ax.imshow(g, extent=(0, g.shape[1] * 0.5, g.shape[0] * 0.5, 0), cmap="inferno", alpha=0.8, vmin=0, vmax=4)
    bn = r["bottleneck"]
    if bn["region"]:
        reg = bn["region"]
        ax.add_patch(Rectangle((reg["x0"], reg["y0"]), reg["x1"] - reg["x0"], reg["y1"] - reg["y0"], fill=False, ec="cyan", lw=2))
    ax.set_title(f"peak density (max {r['max_density']}) bottleneck={bn['label']}", color="w", fontsize=9)
    ax = axs[5]
    tl = r["timeline"]
    ax.plot(tl["t"], tl["evacuated"], label="evacuated")
    for k, v in tl["exits"].items():
        ax.plot(tl["t"], v, "--", label=f"exit {k}")
    ax.legend(); ax.set_title(f"clearance {r['clearance_time']}s avg {r['average_time']}s", fontsize=9)
    plt.tight_layout(); plt.savefig(out, dpi=70)
    print(out, r["clearance_time"], r["max_density"], bn["label"])


if __name__ == "__main__":
    main()
