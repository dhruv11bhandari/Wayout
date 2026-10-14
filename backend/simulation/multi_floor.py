"""Multi-floor evacuation orchestration.

Wayout's core simulator (`LocalSimulationEngine`) models one connected floor plate. A
multi-floor building is not a separate physics model - it is the SAME simulator, run
once per floor, chained through the stairwells:

  1. Every floor shares one building footprint (room count, room size, lobby size,
     overall dimensions - the same parametric generator used everywhere else in
     Wayout). The ground floor (index 0) keeps its real building exits. Every floor
     above it swaps those for exactly two stair portals ("Stair A", "Stair B"),
     mechanically identical `ExitDef` gaps - same navigation, same queue-aware exit
     choice, same social-force dynamics.
  2. The TOP floor is simulated first, on its own. Every agent who reaches a stair
     portal has a real, measured arrival time there (`agents.evac_time` /
     `agents.exit`), which already reflects real queuing at that portal - the same
     flow-capacity-aware mechanism that governs queuing at any building exit.
  3. That arrival becomes a *scheduled arrival* on the floor below (see
     `simulator.ScheduledAgent`), landing at a fixed interior point in that floor's
     lobby, delayed by the time it takes to walk down one flight:

         transit_time = floor_height / STAIR_DESCENT_SPEED

     `STAIR_DESCENT_SPEED` is an approximate downward-stair walking speed taken from
     pedestrian-movement literature, not a fitted or measured value - it is labelled as
     such everywhere it is surfaced (API, UI, README), matching this repository's
     existing practice for its other hand-chosen constants (see `social_force.py`).
  4. The floor below is then simulated with its own occupants PLUS the scheduled
     arrivals from above, under the identical social-force engine. Repeat down to the
     ground floor, whose real exits are where people actually leave the building.

Whole-building clearance time is the ground floor's clearance time: the moment the last
person, wherever they started, is actually outside.

Known simplification (stated, not hidden): queuing BETWEEN floors that share one
stairwell - e.g. floor 3's occupants merging into floor 2's occupants already using the
same flight - is not modelled. Each flight is treated as unconstrained once an agent is
on it. Queuing AT a stair entrance (on the floor the agent is leaving) is real.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from building import BuildingParams
from .simulator import LocalSimulationEngine, ScheduledAgent, SimConfig

STAIR_DESCENT_SPEED = 0.6          # m/s - approximate literature value, not calibrated
STAIR_IDS: Tuple[str, str] = ("A", "B")
FLOOR_HEIGHT_DEFAULT = 3.5         # m
MIN_FLOORS, MAX_FLOORS = 1, 6


@dataclass(frozen=True)
class MultiFloorParams:
    n_floors: int = 3
    occupancy: Tuple[int, ...] = (167, 167, 166)   # per floor, ground first
    corridor_width: float = 2.0
    exit_width: float = 1.2        # ground-floor building exits
    stair_width: float = 1.5       # upper-floor stair portals
    num_exits: int = 2             # ground floor real exits
    agent_speed: float = 1.3
    blocked_exits: Tuple[str, ...] = ()               # ground floor only
    blocked_stairs: Tuple[Tuple[int, str], ...] = ()  # (floor_index, stair_id) hazard pairs
    floor_height: float = FLOOR_HEIGHT_DEFAULT
    seed: int = 42
    rooms_per_side: int = 4
    room_width: float = 10.0
    lobby_width: float = 24.0
    height: float = 40.0

    def normalized(self) -> "MultiFloorParams":
        n = int(min(MAX_FLOORS, max(MIN_FLOORS, round(self.n_floors))))
        occ = tuple(int(min(400, max(10, round(o)))) for o in self.occupancy[:n])
        while len(occ) < n:
            occ = occ + (occ[-1] if occ else 140,)
        blocked_stairs = tuple((fi, sid) for fi, sid in self.blocked_stairs if 1 <= fi < n and sid in STAIR_IDS)
        return MultiFloorParams(
            n_floors=n, occupancy=occ, corridor_width=self.corridor_width, exit_width=self.exit_width,
            stair_width=self.stair_width, num_exits=self.num_exits, agent_speed=self.agent_speed,
            blocked_exits=self.blocked_exits, blocked_stairs=blocked_stairs, floor_height=max(2.4, self.floor_height),
            seed=self.seed, rooms_per_side=self.rooms_per_side, room_width=self.room_width,
            lobby_width=self.lobby_width, height=self.height,
        )

    def floor_params(self, i: int) -> BuildingParams:
        """The BuildingParams for floor i (0 = ground)."""
        if i == 0:
            n_exits_here, blocked_here, ew = self.num_exits, self.blocked_exits, self.exit_width
        else:
            n_exits_here = 2
            blocked_here = tuple(sid for (fi, sid) in self.blocked_stairs if fi == i)
            ew = self.stair_width
        occ = self.occupancy[i] if i < len(self.occupancy) else self.occupancy[-1]
        return BuildingParams(
            occupancy=occ, corridor_width=self.corridor_width, exit_width=ew, num_exits=n_exits_here,
            agent_speed=self.agent_speed, blocked_exits=blocked_here, seed=self.seed + i * 97,
            rooms_per_side=self.rooms_per_side, room_width=self.room_width, lobby_width=self.lobby_width,
            height=self.height,
        ).normalized()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "n_floors": self.n_floors, "occupancy": list(self.occupancy), "corridor_width": self.corridor_width,
            "exit_width": self.exit_width, "stair_width": self.stair_width, "num_exits": self.num_exits,
            "agent_speed": self.agent_speed, "blocked_exits": list(self.blocked_exits),
            "blocked_stairs": [list(x) for x in self.blocked_stairs], "floor_height": self.floor_height,
            "seed": self.seed, "rooms_per_side": self.rooms_per_side, "room_width": self.room_width,
            "lobby_width": self.lobby_width, "height": self.height,
        }

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "MultiFloorParams":
        allowed = {f for f in MultiFloorParams.__dataclass_fields__}
        kw = {k: v for k, v in d.items() if k in allowed}
        if "occupancy" in kw:
            kw["occupancy"] = tuple(int(x) for x in kw["occupancy"])
        if "blocked_exits" in kw:
            kw["blocked_exits"] = tuple(kw["blocked_exits"])
        if "blocked_stairs" in kw:
            kw["blocked_stairs"] = tuple((int(a), str(b)) for a, b in kw["blocked_stairs"])
        return MultiFloorParams(**kw).normalized()


def default_multi_floor(occupancy_total: int = 500, n_floors: int = 3) -> MultiFloorParams:
    base = occupancy_total // n_floors
    rem = occupancy_total - base * n_floors
    occ = tuple(base + (1 if i < rem else 0) for i in range(n_floors))
    return MultiFloorParams(n_floors=n_floors, occupancy=occ).normalized()


def stair_landing_points(mfp: MultiFloorParams) -> Dict[str, Tuple[float, float]]:
    """Fixed interior lobby point each stair discharges onto, on the floor below.

    Kept clear of the lobby's reception-desk / column obstacles and independent of how
    many real exits the receiving floor has (so it is always valid, even landing onto a
    ground floor with only 1 active exit).
    """
    LX = mfp.rooms_per_side * mfp.room_width
    LW = mfp.lobby_width
    H = mfp.height
    cy = H / 2.0
    lx = LX + 0.75 * LW
    return {"A": (lx, cy - 0.15 * H), "B": (lx, cy + 0.15 * H)}


def simulate_building(mfp: MultiFloorParams, config: Optional[SimConfig] = None) -> Dict[str, Any]:
    """Run every floor, top to bottom, chaining stairwell arrivals. Returns per-floor
    results plus whole-building metrics. Every number comes from a real
    `LocalSimulationEngine.simulate()` call - see the module docstring for how floors
    connect and what is (and is not) modelled between them."""
    mfp = mfp.normalized()
    cfg = config or SimConfig()
    engine = LocalSimulationEngine()
    n = mfp.n_floors
    floor_params = [mfp.floor_params(i) for i in range(n)]
    landing = stair_landing_points(mfp)

    results: List[Optional[Dict[str, Any]]] = [None] * n
    pending: List[List[ScheduledAgent]] = [[] for _ in range(n)]

    for i in range(n - 1, -1, -1):
        floor_cfg = SimConfig(
            dt=cfg.dt, max_time=cfg.max_time, record=cfg.record, record_dt=cfg.record_dt,
            density_dt=cfg.density_dt, max_reaction_delay=cfg.max_reaction_delay,
            dynamic_exit_choice=cfg.dynamic_exit_choice, reassess_dt=cfg.reassess_dt,
            switch_margin_s=cfg.switch_margin_s, seed=None, extra_agents=pending[i],
            label_prefix=("Exit" if i == 0 else "Stair"),
        )
        r = engine.simulate(floor_params[i], floor_cfg)
        results[i] = r
        if i > 0 and r.get("agents"):
            transit = mfp.floor_height / STAIR_DESCENT_SPEED
            evac = r["agents"]["evac_time"]
            exits_hit = r["agents"]["exit"]
            for e_t, e_id in zip(evac, exits_hit):
                if e_t is None or e_id not in landing:
                    continue
                x, y = landing[e_id]
                pending[i - 1].append(ScheduledAgent(x=x, y=y, t=e_t + transit))

    ground = results[0]
    bottlenecks = []
    for i, r in enumerate(results):
        b = dict(r["bottleneck"]); b["floor"] = i
        bottlenecks.append(b)
    scored = [b for b in bottlenecks if b.get("x") is not None]
    global_bottleneck = max(scored, key=lambda b: b["score"]) if scored else bottlenecks[0]

    total_agents = sum(r["total_agents"] - r["extra_agents_injected"] for r in results)

    return {
        "params": mfp.to_dict(),
        "n_floors": n,
        "completed": all(r["completed"] for r in results),
        "total_agents": total_agents,
        "evacuated": ground["evacuated"],
        "clearance_time": ground["clearance_time"],
        "average_time": ground["average_time"],
        "median_time": ground["median_time"],
        "max_density": round(max(r["max_density"] for r in results), 3),
        "bottleneck": global_bottleneck,
        "bottlenecks_by_floor": bottlenecks,
        "exit_utilization": ground["exit_utilization"],
        "timeline": ground["timeline"],
        "floors": results,
        "floor_height": mfp.floor_height,
        "stair_descent_speed": STAIR_DESCENT_SPEED,
        "stair_landing_points": {k: list(v) for k, v in landing.items()},
        "engine": {
            "name": "MultiFloorOrchestrator", "per_floor_engine": engine.name, "device": "CPU (NumPy)",
            "compute_time_s": round(sum(r["engine"]["compute_time_s"] for r in results), 2),
        },
    }
