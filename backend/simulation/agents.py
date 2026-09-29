"""Agent spawning and per-agent attributes."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np

from building import Building, BuildingParams

MIN_SPACING = 0.55


@dataclass
class Spawn:
    xy: np.ndarray            # (n, 2) initial positions
    zone: List[str]           # room id / 'corridor' / 'lobby' per agent
    room_counts: Dict[str, int]


def _largest_remainder(weights: np.ndarray, total: int) -> np.ndarray:
    if total <= 0:
        return np.zeros(len(weights), dtype=int)
    share = weights / weights.sum() * total
    base = np.floor(share).astype(int)
    rem = total - base.sum()
    order = np.argsort(-(share - base))
    base[order[:rem]] += 1
    return base


def _sample_rect(rng, rect, k, placed, avoid=()) -> List[Tuple[float, float]]:
    x0, y0, x1, y1 = rect
    out: List[Tuple[float, float]] = []
    for _ in range(k):
        best = None
        for _try in range(80):
            x = rng.uniform(x0, x1); y = rng.uniform(y0, y1)
            if any(ax0 <= x <= ax1 and ay0 <= y <= ay1 for ax0, ay0, ax1, ay1 in avoid):
                continue
            best = (x, y)
            if all((x - px) ** 2 + (y - py) ** 2 >= MIN_SPACING ** 2 for px, py in placed + out):
                break
        if best is None:
            best = ((x0 + x1) / 2, (y0 + y1) / 2)
        out.append(best)
    return out


def spawn_agents(building: Building, params: BuildingParams) -> Spawn:
    """Deterministic (seeded) placement: ~88% in rooms, ~12% circulating in corridor/lobby."""
    p = params.normalized()
    rng = np.random.default_rng(p.seed)
    N = p.occupancy
    n_circ = int(round(0.12 * N))
    n_room = N - n_circ

    rooms = building.rooms
    areas = np.array([r.width * r.height for r in rooms], dtype=float)
    factors = rng.uniform(0.6, 1.5, len(rooms))
    counts = _largest_remainder(areas * factors, n_room)

    placed: List[Tuple[float, float]] = []
    zone: List[str] = []
    room_counts: Dict[str, int] = {}
    for r, c in zip(rooms, counts):
        m = 0.6
        rect = (r.x + m, r.y + m, r.x + r.width - m, r.y + r.height - m)
        pts = _sample_rect(rng, rect, int(c), placed)
        placed += pts; zone += [r.id] * len(pts)
        room_counts[r.id] = len(pts)

    corr = next(c for c in building.corridors if c.kind == "corridor")
    lobby = next(c for c in building.corridors if c.kind == "lobby")
    n_corr = int(round(0.6 * n_circ)); n_lob = n_circ - n_corr
    cm = min(0.35, corr.height / 2 - 0.3)
    pts = _sample_rect(rng, (corr.x + 1.5, corr.y + cm, corr.x + corr.width - 3.0, corr.y + corr.height - cm), n_corr, placed)
    placed += pts; zone += ["corridor"] * len(pts)
    avoid = [(o.x - 0.6, o.y - 0.6, o.x + o.width + 0.6, o.y + o.height + 0.6) for o in building.obstacles]
    pts = _sample_rect(rng, (lobby.x + 2.0, lobby.y + 2.0, lobby.x + lobby.width - 2.0, lobby.y + lobby.height - 2.0),
                       n_lob, placed, avoid)
    placed += pts; zone += ["lobby"] * len(pts)
    room_counts["corridor"] = n_corr
    room_counts["lobby"] = n_lob
    return Spawn(np.array(placed, dtype=np.float64), zone, room_counts)


def agent_attributes(n: int, p: BuildingParams, seed: int, max_delay: float):
    """Speed / radius / reaction-delay per agent (seeded, independent of geometry)."""
    rng = np.random.default_rng(seed + 7919)
    v0 = p.agent_speed * np.clip(rng.normal(1.0, 0.10, n), 0.75, 1.25)
    radius = np.clip(rng.normal(0.25, 0.02, n), 0.20, 0.30)
    delay = rng.uniform(0.0, max_delay, n)
    return v0, radius, delay
