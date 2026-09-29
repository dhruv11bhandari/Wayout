"""Social-force-inspired pedestrian dynamics (simplified, NOT a research-grade SFM).

acceleration = (v0 * e_desired - v) / tau            driving term toward the exit
             + sum_j A exp((r_ij - d_ij) / B) n_ij    exponential agent-agent repulsion
             + A_w exp((r_i - d_w) / B_w) n_w         exponential wall repulsion

Overlaps are additionally removed by a light position-based contact projection so the
explicit-Euler scheme stays stable at dt = 0.1 s even in dense queues.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree


@dataclass
class ForceParams:
    tau: float = 0.6
    agent_A: float = 4.0
    agent_B: float = 0.30
    agent_cutoff: float = 1.5
    wall_A: float = 4.0
    wall_B: float = 0.20
    max_speed_factor: float = 1.3
    noise: float = 0.5           # std-dev of the random fluctuation acceleration (m/s^2)


def agent_repulsion(pos: np.ndarray, radius: np.ndarray, fp: ForceParams) -> np.ndarray:
    n = len(pos)
    if n < 2:
        return np.zeros((n, 2))
    pairs = cKDTree(pos).query_pairs(fp.agent_cutoff, output_type="ndarray")
    if len(pairs) == 0:
        return np.zeros((n, 2))
    i, j = pairs[:, 0], pairs[:, 1]
    dvec = pos[i] - pos[j]
    d = np.maximum(np.hypot(dvec[:, 0], dvec[:, 1]), 1e-6)
    mag = fp.agent_A * np.exp((radius[i] + radius[j] - d) / fp.agent_B) / d
    fx, fy = dvec[:, 0] * mag, dvec[:, 1] * mag
    ax = np.bincount(i, fx, n) - np.bincount(j, fx, n)
    ay = np.bincount(i, fy, n) - np.bincount(j, fy, n)
    return np.stack([ax, ay], axis=1)


def wall_repulsion(wall_sample: np.ndarray, radius: np.ndarray, fp: ForceParams) -> np.ndarray:
    d = wall_sample[:, 0]
    mag = fp.wall_A * np.exp((radius - d) / fp.wall_B)
    return wall_sample[:, 1:3] * mag[:, None]


def resolve_overlaps(pos: np.ndarray, radius: np.ndarray, iterations: int = 2) -> np.ndarray:
    """Push overlapping agents apart (each takes half of the penetration)."""
    n = len(pos)
    if n < 2:
        return pos
    pos = pos.copy()
    rmax = 2 * float(radius.max())
    for _ in range(iterations):
        pairs = cKDTree(pos).query_pairs(rmax, output_type="ndarray")
        if len(pairs) == 0:
            break
        i, j = pairs[:, 0], pairs[:, 1]
        dvec = pos[i] - pos[j]
        d = np.maximum(np.hypot(dvec[:, 0], dvec[:, 1]), 1e-6)
        pen = radius[i] + radius[j] - d
        m = pen > 0
        if not m.any():
            break
        i, j, dvec, d, pen = i[m], j[m], dvec[m], d[m], pen[m]
        push = (0.5 * 0.9 * pen / d)[:, None] * dvec
        pos[:, 0] += np.bincount(i, push[:, 0], n) - np.bincount(j, push[:, 0], n)
        pos[:, 1] += np.bincount(i, push[:, 1], n) - np.bincount(j, push[:, 1], n)
    return pos
