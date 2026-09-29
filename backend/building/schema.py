"""Structured floor-plan data model.

Everything the frontend renders and everything the simulator rasterises comes from
these dataclasses. Units are metres; the origin is the top-left corner of the
building and +y points down (canvas convention).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class Wall:
    x1: float
    y1: float
    x2: float
    y2: float
    thickness: float = 0.5
    kind: str = "wall"  # wall | outer | blocked

    def rect(self) -> Tuple[float, float, float, float]:
        """Axis-aligned rectangle (xmin, ymin, xmax, ymax) covered by the wall."""
        t = self.thickness / 2.0
        if abs(self.x1 - self.x2) < 1e-9:  # vertical
            return (self.x1 - t, min(self.y1, self.y2), self.x1 + t, max(self.y1, self.y2))
        return (min(self.x1, self.x2), self.y1 - t, max(self.x1, self.x2), self.y1 + t)


@dataclass
class Room:
    id: str
    name: str
    x: float
    y: float
    width: float
    height: float
    occupancy: int = 0
    door_id: Optional[str] = None
    kind: str = "room"


@dataclass
class Corridor:
    id: str
    name: str
    x: float
    y: float
    width: float
    height: float
    kind: str = "corridor"  # corridor | lobby


@dataclass
class Door:
    id: str
    x: float
    y: float
    width: float
    orientation: str  # "h" = opening in a horizontal wall, "v" = in a vertical wall
    room_id: str


@dataclass
class ExitDef:
    id: str
    label: str
    x: float
    y: float
    width: float
    orientation: str  # side of the building: N | E | S | W
    blocked: bool = False


@dataclass
class Obstacle:
    id: str
    x: float
    y: float
    width: float
    height: float
    label: str = ""


@dataclass
class Zone:
    id: str
    name: str
    x: float
    y: float
    width: float
    height: float


@dataclass
class Building:
    width: float
    height: float
    wall_thickness: float
    rooms: List[Room] = field(default_factory=list)
    walls: List[Wall] = field(default_factory=list)
    corridors: List[Corridor] = field(default_factory=list)
    doors: List[Door] = field(default_factory=list)
    exits: List[ExitDef] = field(default_factory=list)
    obstacles: List[Obstacle] = field(default_factory=list)
    zones: List[Zone] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def active_exits(self) -> List[ExitDef]:
        return [e for e in self.exits if not e.blocked]
