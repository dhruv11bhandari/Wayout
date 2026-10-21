"""Static, geometry-derived features for the ML surrogate.

None of these come from simulation output: they are computed from the design
parameters and the floor-plan geometry (plus the seeded initial agent placement), so the
surrogate can answer without running a simulation.

`n_floors` / `floor_height` let the same feature vector describe a whole multi-floor
building, not just one floor plate: a single-floor building is simply the `n_floors=1`
case (no floor above it, nothing to descend). For a real multi-floor design, callers pass
the ground floor's own `BuildingParams` (its real exits are where the building's occupants
actually leave) together with `n_floors`, `floor_height`, and `occupancy_override` set to
the *building-wide* occupant count - because it is that total, funnelled down through the
stairwells, that ultimately has to clear the ground floor's exits. See
`ml/generate_dataset.py` for how the training rows for this are produced (real
`simulate_building()` runs, exactly like the single-floor rows are real
`LocalSimulationEngine` runs).
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

import numpy as np

from building import BuildingParams
from simulation.agents import spawn_agents
from simulation.multi_floor import FLOOR_HEIGHT_DEFAULT
from simulation.navigation import get_environment

FLOW = 1.3  # persons / (m s): textbook specific flow, used only to build a ratio feature

FEATURE_NAMES = [
    "occupancy",
    "num_exits",
    "total_exit_width",
    "corridor_width",
    "floor_area",
    "mean_path_dist",
    "max_path_dist",
    "room_count",
    "intersection_count",
    "agent_speed",
    "narrowest_passage",
    "occ_per_corridor_m",
    "occ_per_exit_m",
    "flow_limited_time_s",
    "walk_time_max_s",
    "n_floors",
    "floor_height",
]

def extract_features(
    params: BuildingParams,
    n_floors: float = 1,
    floor_height: float = FLOOR_HEIGHT_DEFAULT,
    occupancy_override: Optional[float] = None,
) -> Tuple[np.ndarray, Dict[str, float]]:
    """Feature vector for one floor plate, optionally standing in for a whole building.

    `n_floors` / `floor_height` describe the building above `params` (both default to the
    single-floor case: 1 floor, no descent). `occupancy_override`, when given, replaces
    `params.occupancy` in every occupancy-derived feature - use this for a multi-floor
    building's *total* occupant count while still deriving the geometry features
    (path distances, room/intersection counts, ...) from the ground floor's own layout.
    """
    p = params.normalized()
    env = get_environment(p)
    b = env.building
    spawn = spawn_agents(b, p)
    d_min = env.distance_to_exits(spawn.xy).min(axis=0)
    widths = [e.width for e in env.exits]
    total_w = float(sum(widths))
    narrow = float(min([p.corridor_width] + widths))
    occ = float(p.occupancy) if occupancy_override is None else float(occupancy_override)
    f = {
        "occupancy": occ,
        "num_exits": float(len(env.exits)),
        "total_exit_width": total_w,
        "corridor_width": p.corridor_width,
        "floor_area": float(b.meta["floor_area"]),
        "mean_path_dist": float(d_min.mean()),
        "max_path_dist": float(d_min.max()),
        "room_count": float(b.meta["room_count"]),
        "intersection_count": float(b.meta["intersection_count"]),
        "agent_speed": p.agent_speed,
        "narrowest_passage": narrow,
        "occ_per_corridor_m": occ / p.corridor_width,
        "occ_per_exit_m": occ / total_w,
        "flow_limited_time_s": occ / (FLOW * min(p.corridor_width, total_w)),
        "walk_time_max_s": float(d_min.max()) / p.agent_speed,
        "n_floors": float(n_floors),
        "floor_height": float(floor_height),
    }
    return np.array([f[k] for k in FEATURE_NAMES], dtype=np.float64), f
