"""Parametric building generator.

`build_geometry(params)` turns a handful of design parameters into the structured
floor-plan JSON model (walls, rooms, corridors, doors, exits). The default building
is a single-storey wing: two rows of rooms on either side of a main corridor that
funnels into a large lobby with exits on its north / east / south sides. An optional
fourth exit sits at the west end of the corridor.

Layout (default parameters, metres):

     EXIT A (N)
        ^
  +----------+---------------------+
  | rooms N  |                     |
  +--door----+   L O B B Y         > EXIT B (E)
  <== main corridor ==>  (island,   |
  | rooms S  |   pillars)          |
  +----------+---------------------+
        EXIT D (S) optional; EXIT C (W) at the far end of the corridor
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, replace
from typing import Dict, List, Optional, Sequence, Tuple

from .schema import Building, Corridor, Door, ExitDef, Obstacle, Room, Wall, Zone

EXIT_ORDER = ["A", "B", "C", "D"]
EXIT_SIDE = {"A": "North", "B": "East", "C": "West", "D": "South"}
WALL_T = 0.5
DOOR_W = 1.0


@dataclass(frozen=True)
class BuildingParams:
    # ---- design parameters exposed in the UI --------------------------------
    occupancy: int = 140
    corridor_width: float = 2.0
    exit_width: float = 1.2
    num_exits: int = 2
    agent_speed: float = 1.3
    blocked_exits: Tuple[str, ...] = ()
    seed: int = 42
    # ---- layout knobs (varied when generating the ML training set) ----------
    rooms_per_side: int = 4
    room_width: float = 10.0
    lobby_width: float = 24.0
    height: float = 40.0

    def normalized(self) -> "BuildingParams":
        n_exits = int(min(4, max(1, round(self.num_exits))))
        active = EXIT_ORDER[:n_exits]
        blocked = tuple(sorted({b.upper() for b in self.blocked_exits if b.upper() in active}))
        if len(blocked) >= len(active):  # never allow every exit to be blocked
            blocked = tuple(b for b in blocked if b != active[0])
        return replace(
            self,
            occupancy=int(min(400, max(10, round(self.occupancy)))),
            corridor_width=round(min(6.0, max(0.8, float(self.corridor_width))) * 20) / 20,
            exit_width=round(min(4.0, max(0.6, float(self.exit_width))) * 20) / 20,
            num_exits=n_exits,
            agent_speed=round(min(2.0, max(0.5, float(self.agent_speed))) * 20) / 20,
            blocked_exits=blocked,
            seed=int(self.seed),
            rooms_per_side=int(min(6, max(2, self.rooms_per_side))),
            room_width=float(min(18.0, max(8.0, self.room_width))),
            lobby_width=float(min(34.0, max(14.0, self.lobby_width))),
            height=float(min(52.0, max(28.0, self.height))),
        )

    def geometry_key(self) -> Tuple:
        """Parameters that change geometry (occupancy / speed / seed do not)."""
        p = self.normalized()
        return (p.corridor_width, p.exit_width, p.num_exits, p.blocked_exits,
                p.rooms_per_side, p.room_width, p.lobby_width, p.height)

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["blocked_exits"] = list(self.blocked_exits)
        return d

    @staticmethod
    def from_dict(d: Dict) -> "BuildingParams":
        allowed = BuildingParams.__dataclass_fields__.keys()
        kw = {k: v for k, v in d.items() if k in allowed}
        if "blocked_exits" in kw:
            kw["blocked_exits"] = tuple(kw["blocked_exits"] or ())
        return BuildingParams(**kw).normalized()


def default_params() -> BuildingParams:
    return BuildingParams().normalized()


# --------------------------------------------------------------------------- #
# geometry helpers
# --------------------------------------------------------------------------- #
def _split(a: float, b: float, gaps: Sequence[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Split the interval [a, b] into pieces separated by gaps."""
    pieces: List[Tuple[float, float]] = []
    cur = a
    for g0, g1 in sorted(gaps):
        if g0 > cur + 1e-9:
            pieces.append((cur, g0))
        cur = max(cur, g1)
    if b > cur + 1e-9:
        pieces.append((cur, b))
    return pieces


def _hwall(y: float, x1: float, x2: float, gaps=(), kind="wall") -> List[Wall]:
    return [Wall(a, y, b, y, WALL_T, kind) for a, b in _split(x1, x2, gaps)]


def _vwall(x: float, y1: float, y2: float, gaps=(), kind="wall") -> List[Wall]:
    return [Wall(x, a, x, b, WALL_T, kind) for a, b in _split(y1, y2, gaps)]


def build_geometry(params: BuildingParams, label_prefix: str = "Exit") -> Building:
    """Generate the structured floor plan for the given parameters (no occupants yet).

    `label_prefix` only changes how exits are *labelled* ("Exit A" vs "Stair A") - the
    geometry, navigation and simulation are identical either way. `multi_floor.py` passes
    "Stair" for every floor above the ground so bottleneck/exit-utilization labels read
    correctly (e.g. "Stair B Approach" rather than "Exit B Approach")."""
    p = params.normalized()
    T = WALL_T
    n = p.rooms_per_side
    rw = p.room_width
    LX = n * rw                      # x where the wing ends and the lobby begins
    LW = p.lobby_width
    W = LX + LW
    H = p.height
    cy = H / 2.0
    cw = p.corridor_width
    ew = p.exit_width
    yn = cy - cw / 2.0 - T / 2.0     # wall centre-line north of the corridor
    ys = cy + cw / 2.0 + T / 2.0     # wall centre-line south of the corridor
    xa = LX + LW / 2.0               # x of the north / south lobby exits

    active_ids = EXIT_ORDER[: p.num_exits]
    exit_pos = {
        "A": (xa, 0.0, "N"),
        "B": (W, cy, "E"),
        "C": (0.0, cy, "W"),
        "D": (xa, H, "S"),
    }

    def gap_for(eid: str) -> List[Tuple[float, float]]:
        if eid not in active_ids:
            return []
        x, y, side = exit_pos[eid]
        c = x if side in ("N", "S") else y
        return [(c - ew / 2.0, c + ew / 2.0)]

    walls: List[Wall] = []
    # outer envelope (with exit gaps)
    walls += _hwall(0.0, -T / 2, W + T / 2, gap_for("A"), "outer")
    walls += _hwall(H, -T / 2, W + T / 2, gap_for("D"), "outer")
    walls += _vwall(W, 0.0, H, gap_for("B"), "outer")
    walls += _vwall(0.0, 0.0, H, gap_for("C"), "outer")
    # lobby wall, split by the corridor mouth
    walls += _vwall(LX, 0.0, yn + T / 2)
    walls += _vwall(LX, ys - T / 2, H)
    # partitions between rooms
    for k in range(1, n):
        walls += _vwall(k * rw, 0.0, yn)
        walls += _vwall(k * rw, ys, H)
    # corridor walls with door gaps
    door_gaps = [((k + 0.5) * rw - DOOR_W / 2, (k + 0.5) * rw + DOOR_W / 2) for k in range(n)]
    walls += _hwall(yn, 0.0, LX, door_gaps)
    walls += _hwall(ys, 0.0, LX, door_gaps)

    # exits (blocked exits get a wall across the gap so they are impassable)
    exits: List[ExitDef] = []
    for eid in active_ids:
        x, y, side = exit_pos[eid]
        blocked = eid in p.blocked_exits
        exits.append(ExitDef(eid, f"{label_prefix} {eid}", x, y, ew, side, blocked))
        if blocked:
            (g0, g1), = gap_for(eid)
            if side in ("N", "S"):
                walls.append(Wall(g0, y, g1, y, T, "blocked"))
            else:
                walls.append(Wall(x, g0, x, g1, T, "blocked"))

    # rooms + doors
    rooms: List[Room] = []
    doors: List[Door] = []
    for k in range(n):
        x0 = k * rw + T / 2
        wroom = rw - T
        cx = (k + 0.5) * rw
        rn = Room(f"N{k + 1}", f"Room {101 + k}", x0, T / 2, wroom, yn - T, 0, f"D-N{k + 1}")
        rs = Room(f"S{k + 1}", f"Room {201 + k}", x0, ys + T / 2, wroom, H - ys - T, 0, f"D-S{k + 1}")
        rooms += [rn, rs]
        doors.append(Door(f"D-N{k + 1}", cx, yn, DOOR_W, "h", rn.id))
        doors.append(Door(f"D-S{k + 1}", cx, ys, DOOR_W, "h", rs.id))

    corridors = [
        Corridor("main", "Main Corridor", T / 2, yn + T / 2, LX - T, cw, "corridor"),
        Corridor("lobby", "Lobby", LX + T / 2, T / 2, LW - T, H - T, "lobby"),
    ]

    obstacles = [
        Obstacle("desk", LX + 0.30 * LW, cy - 4.0, 3.0, 8.0, "Reception"),
        Obstacle("col1", LX + 0.62 * LW, H * 0.27, 1.0, 1.0, ""),
        Obstacle("col2", LX + 0.62 * LW, H * 0.73 - 1.0, 1.0, 1.0, ""),
    ]

    zones: List[Zone] = []
    zw = (LX - 3.0) / 3.0
    for i, nm in enumerate(["West Corridor", "Central Corridor", "East Corridor"]):
        zones.append(Zone(f"corr{i}", nm, i * zw, yn, zw, ys - yn))
    zones.append(Zone("entrance", "Lobby Entrance", LX - 3.0, yn, 9.0, ys - yn))
    zones.append(Zone("lobby", "Lobby", LX, 0.0, LW, H))
    for r in rooms:
        zones.append(Zone(r.id, r.name, r.x, r.y, r.width, r.height))

    area = (sum(r.width * r.height for r in rooms)
            + sum(c.width * c.height for c in corridors)
            - sum(o.width * o.height for o in obstacles))

    b = Building(W, H, T, rooms, walls, corridors, doors, exits, obstacles, zones)
    b.meta = {
        "layout": {"rooms_per_side": n, "room_width": rw, "lobby_width": LW, "height": H,
                   "wing_length": LX, "corridor_y": cy},
        "floor_area": round(area, 2),
        "room_count": len(rooms),
        "door_count": len(doors),
        "intersection_count": len(doors) + 1,  # door T-junctions + corridor/lobby junction
        "name": "Demo Building - Ground Floor",
    }
    return b


def zone_label(building: Building, x: float, y: float, allow_door: bool = True) -> str:
    """Human-readable name for a location (used to label bottlenecks)."""
    for e in building.active_exits():
        if math.hypot(x - e.x, y - e.y) <= 4.5:
            return f"{e.label} Approach"
    for d in (building.doors if allow_door else []):
        if abs(x - d.x) <= 1.6 and abs(y - d.y) <= 1.6:
            room = next((r for r in building.rooms if r.id == d.room_id), None)
            if room:
                return f"{room.name} Door"
    for z in building.zones:
        if z.x <= x <= z.x + z.width and z.y <= y <= z.y + z.height:
            return z.name
    return "Building"
