"""Grid-based navigation: wall-distance field + potential field to each exit.

Pipeline
--------
1. Rasterise walls/obstacles to a fine boolean grid (0.10 m).
2. Euclidean distance transform -> distance-to-wall field (+ gradient) used by the
   social-force wall repulsion and for collision handling.
3. Coarser navigation grid (0.20 m). For every exit, Dijkstra (scipy csgraph) over
   the free cells gives the distance-to-exit potential; wall-hugging cells cost a
   little extra so routes keep off the walls.
4. The steepest-descent direction of that potential is pre-computed per exit; agents
   sample it (bilinear) to get their desired walking direction.

This module is deliberately self-contained so a GPU implementation can replace it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Dict, List, Tuple

import numpy as np
from scipy import ndimage
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from building import Building, BuildingParams, build_geometry

RES_FINE = 0.1
RES_NAV = 0.2
MARGIN = 1.0

_NORMALS = {"N": (0.0, -1.0), "S": (0.0, 1.0), "E": (1.0, 0.0), "W": (-1.0, 0.0)}


@dataclass
class ExitGeom:
    id: str
    label: str
    x: float
    y: float
    width: float
    normal: np.ndarray   # outward unit normal
    tangent: np.ndarray


def _bilinear(field: np.ndarray, x: np.ndarray, y: np.ndarray, ox: float, oy: float, res: float) -> np.ndarray:
    ny, nx = field.shape[:2]
    fx = (x - ox) / res - 0.5
    fy = (y - oy) / res - 0.5
    i0 = np.floor(fx).astype(np.int64)
    j0 = np.floor(fy).astype(np.int64)
    tx = (fx - i0)[:, None]
    ty = (fy - j0)[:, None]
    i0c = np.clip(i0, 0, nx - 1)
    i1c = np.clip(i0 + 1, 0, nx - 1)
    j0c = np.clip(j0, 0, ny - 1)
    j1c = np.clip(j0 + 1, 0, ny - 1)
    return (field[j0c, i0c] * (1 - tx) * (1 - ty) + field[j0c, i1c] * tx * (1 - ty)
            + field[j1c, i0c] * (1 - tx) * ty + field[j1c, i1c] * tx * ty)


class Environment:
    """Immutable simulation environment for one building geometry."""

    def __init__(self, building: Building):
        self.building = building
        self.W, self.H = building.width, building.height
        self.ox = self.oy = -MARGIN
        nx = int(round((self.W + 2 * MARGIN) / RES_FINE))
        ny = int(round((self.H + 2 * MARGIN) / RES_FINE))
        self.nx, self.ny = nx + (nx % 2), ny + (ny % 2)
        self.exits: List[ExitGeom] = []
        for e in building.active_exits():
            n = np.array(_NORMALS[e.orientation])
            self.exits.append(ExitGeom(e.id, e.label, e.x, e.y, e.width, n, np.array([-n[1], n[0]])))
        self._rasterise()
        self._wall_field()
        self._build_navigation()

    # ------------------------------------------------------------------ fine grid
    def _fill(self, arr: np.ndarray, rect: Tuple[float, float, float, float]) -> None:
        x0, y0, x1, y1 = rect
        i0 = int(round((x0 - self.ox) / RES_FINE)); i1 = int(round((x1 - self.ox) / RES_FINE))
        j0 = int(round((y0 - self.oy) / RES_FINE)); j1 = int(round((y1 - self.oy) / RES_FINE))
        arr[max(j0, 0):max(j1, 0), max(i0, 0):max(i1, 0)] = True

    def _rasterise(self) -> None:
        blocked = np.zeros((self.ny, self.nx), dtype=bool)
        for w in self.building.walls:
            self._fill(blocked, w.rect())
        for o in self.building.obstacles:
            self._fill(blocked, (o.x, o.y, o.x + o.width, o.y + o.height))
        self.blocked = blocked

    def _wall_field(self) -> None:
        edt = ndimage.distance_transform_edt(~self.blocked)
        dist = np.maximum(edt * RES_FINE - RES_FINE / 2, 0.0)
        gy, gx = np.gradient(dist)
        mag = np.hypot(gx, gy)
        ok = mag > 1e-3
        gx = np.where(ok, gx / np.where(ok, mag, 1), 0.0)
        gy = np.where(ok, gy / np.where(ok, mag, 1), 0.0)
        self.wall_field = np.stack([dist, gx, gy], axis=-1).astype(np.float32)
        self.dist = dist.astype(np.float32)

    # ---------------------------------------------------------------- nav grid
    def _build_navigation(self) -> None:
        ny_n, nx_n = self.ny // 2, self.nx // 2
        self.nx_n, self.ny_n = nx_n, ny_n
        d = self.dist
        dn = 0.25 * (d[0::2, 0::2] + d[1::2, 0::2] + d[0::2, 1::2] + d[1::2, 1::2])
        cx = self.ox + (np.arange(nx_n) + 0.5) * RES_NAV
        cy = self.oy + (np.arange(ny_n) + 0.5) * RES_NAV
        CX, CY = np.meshgrid(cx, cy)
        inside = (CX > 0) & (CX < self.W) & (CY > 0) & (CY < self.H)
        free = (dn >= 0.12) & inside
        self.nav_free = free
        pen = 1.0 + 0.5 * np.clip(1.0 - dn / 0.5, 0.0, 1.0)

        idx = -np.ones(free.shape, dtype=np.int64)
        idx[free] = np.arange(int(free.sum()))
        n_nodes = int(free.sum())
        fp = np.pad(free, 1)
        ip = np.pad(idx, 1, constant_values=-1)
        pp = np.pad(pen, 1, constant_values=1.0)
        rows, cols, wts = [], [], []
        for dx, dy in ((1, 0), (0, 1), (1, 1), (1, -1)):
            sl = (slice(1 + dy, ny_n + 1 + dy), slice(1 + dx, nx_n + 1 + dx))
            ok = free & fp[sl]
            if dx != 0 and dy != 0:  # forbid corner cutting
                ok &= fp[1:ny_n + 1, 1 + dx:nx_n + 1 + dx] & fp[1 + dy:ny_n + 1 + dy, 1:nx_n + 1]
            step = RES_NAV * (math.sqrt(2.0) if dx and dy else 1.0)
            rows.append(idx[ok]); cols.append(ip[sl][ok])
            wts.append(step * 0.5 * (pen[ok] + pp[sl][ok]))
        r, c, w = np.concatenate(rows), np.concatenate(cols), np.concatenate(wts)
        g = csr_matrix((w, (r, c)), shape=(n_nodes, n_nodes))
        graph = g + g.T

        E = len(self.exits)
        D = np.full((E, ny_n, nx_n), np.inf, dtype=np.float64)
        DIR = np.zeros((E, ny_n, nx_n, 2), dtype=np.float32)
        for k, ex in enumerate(self.exits):
            off_in = -((CX - ex.x) * ex.normal[0] + (CY - ex.y) * ex.normal[1])
            lat = np.abs((CX - ex.x) * ex.tangent[0] + (CY - ex.y) * ex.tangent[1])
            seeds = free & (off_in >= 0.0) & (off_in <= 0.15) & (lat <= ex.width / 2.0)
            if not seeds.any():  # extremely narrow exit: relax
                seeds = free & (off_in >= 0.0) & (off_in <= 0.35) & (lat <= ex.width / 2.0 + RES_NAV)
            dist_nodes = dijkstra(graph, directed=False, indices=idx[seeds], min_only=True)
            Dk = np.full(free.shape, np.inf)
            Dk[free] = dist_nodes
            D[k] = Dk
            DIR[k] = self._direction_field(Dk, seeds, ex)
        self.D = D
        # nearest-valid fill so every cell (even wall-adjacent ones) has a value
        self.D_fill = np.empty_like(D, dtype=np.float32)
        for k in range(E):
            valid = np.isfinite(D[k])
            inds = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
            self.D_fill[k] = np.where(valid, D[k], D[k][inds[0], inds[1]] + 1.0).astype(np.float32)
        self.DIR = DIR
        self.exit_widths = np.array([e.width for e in self.exits], dtype=np.float64)

    def _direction_field(self, Dk: np.ndarray, seeds: np.ndarray, ex: ExitGeom) -> np.ndarray:
        ny_n, nx_n = Dk.shape
        finite = np.isfinite(Dk)
        Dp = np.pad(np.where(finite, Dk, np.inf), 1, constant_values=np.inf)
        wx = np.zeros_like(Dk); wy = np.zeros_like(Dk)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nb = Dp[1 + dy:ny_n + 1 + dy, 1 + dx:nx_n + 1 + dx]
                with np.errstate(invalid="ignore"):
                    dec = Dk - nb
                dec = np.where(np.isfinite(dec) & finite, np.maximum(dec, 0.0), 0.0)
                inv = 1.0 / math.hypot(dx, dy)
                wx += dec * dx * inv
                wy += dec * dy * inv
        mag = np.hypot(wx, wy)
        ok = mag > 1e-9
        dirx = np.where(ok, wx / np.where(ok, mag, 1), 0.0)
        diry = np.where(ok, wy / np.where(ok, mag, 1), 0.0)
        dirx[seeds] = ex.normal[0]
        diry[seeds] = ex.normal[1]
        valid = ok | seeds
        inds = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
        return np.stack([dirx[inds[0], inds[1]], diry[inds[0], inds[1]]], axis=-1).astype(np.float32)

    # ------------------------------------------------------------------ queries
    def wall_sample(self, pos: np.ndarray) -> np.ndarray:
        """(n,3) array of [distance-to-wall, grad_x, grad_y] at positions."""
        return _bilinear(self.wall_field, pos[:, 0], pos[:, 1], self.ox, self.oy, RES_FINE)

    def is_blocked(self, pos: np.ndarray) -> np.ndarray:
        i = np.floor((pos[:, 0] - self.ox) / RES_FINE).astype(np.int64)
        j = np.floor((pos[:, 1] - self.oy) / RES_FINE).astype(np.int64)
        oob = (i < 0) | (i >= self.nx) | (j < 0) | (j >= self.ny)
        out = np.ones(len(pos), dtype=bool)
        good = ~oob
        out[good] = self.blocked[j[good], i[good]]
        return out

    def _nav_index(self, pos: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        i = np.clip(np.floor((pos[:, 0] - self.ox) / RES_NAV).astype(np.int64), 0, self.nx_n - 1)
        j = np.clip(np.floor((pos[:, 1] - self.oy) / RES_NAV).astype(np.int64), 0, self.ny_n - 1)
        return j, i

    def distance_to_exits(self, pos: np.ndarray) -> np.ndarray:
        """(E, n) path-cost distance from positions to each open exit (metres, wall-penalised)."""
        j, i = self._nav_index(pos)
        return self.D_fill[:, j, i].astype(np.float64)

    def desired_direction(self, pos: np.ndarray, target: np.ndarray) -> np.ndarray:
        d = np.empty((len(pos), 2), dtype=np.float64)
        fx = (pos[:, 0] - self.ox) / RES_NAV - 0.5
        fy = (pos[:, 1] - self.oy) / RES_NAV - 0.5
        i0 = np.floor(fx).astype(np.int64); j0 = np.floor(fy).astype(np.int64)
        tx = (fx - i0)[:, None]; ty = (fy - j0)[:, None]
        i0c = np.clip(i0, 0, self.nx_n - 1); i1c = np.clip(i0 + 1, 0, self.nx_n - 1)
        j0c = np.clip(j0, 0, self.ny_n - 1); j1c = np.clip(j0 + 1, 0, self.ny_n - 1)
        F = self.DIR
        d = (F[target, j0c, i0c] * (1 - tx) * (1 - ty) + F[target, j0c, i1c] * tx * (1 - ty)
             + F[target, j1c, i0c] * (1 - tx) * ty + F[target, j1c, i1c] * tx * ty)
        n = np.hypot(d[:, 0], d[:, 1])
        return d / np.maximum(n, 1e-6)[:, None]

    def evac_paths(self) -> List[Dict]:
        """Follow the potential from each room centre to its best exit (for display)."""
        out = []
        if not self.exits:
            return out
        for r in self.building.rooms:
            door = next((d for d in self.building.doors if d.id == r.door_id), None)
            p = np.array([[r.x + r.width / 2, r.y + r.height / 2]])
            ex_i = int(np.argmin(self.distance_to_exits(p)[:, 0]))
            pts = [p[0].copy()]
            if door is not None:  # walk through the door first
                pts.append(np.array([door.x, door.y]))
                p = np.array([[door.x, door.y + (0.6 if r.id.startswith("N") else -0.6)]])
            target = np.array([ex_i])
            for _ in range(700):
                step = self.desired_direction(p, target)
                p = p + step * 0.3
                ex = self.exits[ex_i]
                rel = p[0] - np.array([ex.x, ex.y])
                if rel @ ex.normal > 0 or np.linalg.norm(rel) < 0.4:
                    break
                if len(pts) == 0 or np.linalg.norm(p[0] - pts[-1]) >= 1.8:
                    pts.append(p[0].copy())
            ex = self.exits[ex_i]
            pts.append(np.array([ex.x, ex.y]))
            out.append({"room_id": r.id, "exit_id": ex.id,
                        "points": [[round(float(a), 2), round(float(b), 2)] for a, b in pts]})
        return out


@lru_cache(maxsize=32)
def _cached_env(key: Tuple, params: BuildingParams, label_prefix: str) -> Environment:
    return Environment(build_geometry(params, label_prefix))


def get_environment(params: BuildingParams, label_prefix: str = "Exit") -> Environment:
    """`label_prefix="Stair"` is how multi_floor.py gets "Stair A"/"Stair B" labels on
    every floor above the ground - see build_geometry()."""
    p = params.normalized()
    return _cached_env(p.geometry_key() + (label_prefix,), p, label_prefix)
