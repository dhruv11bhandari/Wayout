"""Measure floor-plan geometry straight from the uploaded image's pixels.

Nemotron reads a plan's *meaning* well (room names, which openings are marked EXIT, on
which side) but its coordinates are rough: on a clean test plan it dropped every interior
wall, shrank the building to about half size and made doors and corridors 0.2 m wide.
For clean line drawings (dark walls on a light background) the walls can be measured
directly instead:

  1. Walls are the long, thick, straight dark strokes. Morphological openings with long
     thin kernels keep those and drop text, door-swing arcs and thin door leaves.
  2. The largest wall component is the building; its outer ring gives the footprint.
     Gaps in that ring are exterior openings, and only openings that Nemotron reported as
     exits (matched by side and position) become exits. The others are sealed, so an
     ordinary window or unmarked gap never turns into an exit.
  3. Plans rarely carry a scale, so metres come from the exit openings, which are taken
     to be 1.2 m wide - WayOut's own default exit width. (At 1 m, the ordinary doors of a
     typical drawing came out at 0.7-0.8 m, narrower than real doors, and crowds jammed in
     them.) The assumption is reported to the user as an uncertainty.
  4. The walls are resampled onto a 0.1 m grid (the simulator's own resolution). Free
     space is split into rooms and corridors by temporarily closing door-sized gaps.
     Each traced room takes the name of the Nemotron room in the matching position.

If the image doesn't look like a clean plan (no outer wall ring, no matched exit, ...),
`trace_floor_plan` returns None and the caller falls back to Nemotron's own geometry.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.optimize import linear_sum_assignment

from .schema import Building, Corridor, ExitDef, Obstacle, Room, Wall, Zone

CELL_M = 0.1             # resample grid, matches simulation.navigation.RES_FINE
EXIT_DOOR_M = 1.2        # assumed clear width of one marked exit opening (sets the scale)
DOOR_SEAL_M = 0.5        # closing radius that separates rooms at ~1 m doorways
MAX_SIDE_PX = 2000       # larger images are downscaled first (speed; plenty of detail)

SIDES = ("N", "E", "S", "W")


@dataclass
class TracedPlan:
    building: Building
    notes: List[str]


class TracingFailed(Exception):
    """The image doesn't look like a clean line-drawing plan we can measure."""


# --------------------------------------------------------------------------- pixels
def _load_gray(image_bytes: bytes) -> np.ndarray:
    with Image.open(BytesIO(image_bytes)) as im:
        im = im.convert("L")
        scale = MAX_SIDE_PX / max(im.size)
        if scale < 1:
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.BILINEAR)
        return np.asarray(im, dtype=np.uint8)


def _wall_mask(gray: np.ndarray) -> np.ndarray:
    """Long, thick, straight dark strokes = walls (text, arcs and thin door leaves drop out)."""
    dark = gray < 110
    if dark.mean() < 0.005 or dark.mean() > 0.5:
        raise TracingFailed("the image is not a dark-lines-on-light drawing")
    long_px = max(20, round(0.03 * max(gray.shape)))
    thick_px = max(3, round(0.0035 * max(gray.shape)))
    straight = (ndi.binary_opening(dark, structure=np.ones((1, long_px)))
                | ndi.binary_opening(dark, structure=np.ones((long_px, 1))))
    thick = ndi.binary_dilation(ndi.binary_opening(dark, structure=np.ones((thick_px, thick_px))))
    return straight & thick


def _building_box(walls: np.ndarray) -> Tuple[np.ndarray, Tuple[int, int, int, int]]:
    # Drop small isolated fragments first (north arrows, scale bars, bits of lettering)
    # so they can't be bridged onto the building below.
    pieces, n_pieces = ndi.label(walls, structure=np.ones((3, 3)))
    if n_pieces == 0:
        raise TracingFailed("no walls were found")
    piece_sizes = ndi.sum(walls, pieces, range(1, n_pieces + 1))
    walls = np.isin(pieces, 1 + np.flatnonzero(piece_sizes >= 0.01 * piece_sizes.sum()))
    # Exit and door gaps split the outer wall into separate pieces, so group strokes that
    # are within a door's width of each other before picking the building.
    bridge = max(15, round(0.10 * max(walls.shape)))
    grouped = ndi.maximum_filter(walls.astype(np.uint8), size=bridge) > 0
    labels, n = ndi.label(grouped, structure=np.ones((3, 3)))
    if n == 0:
        raise TracingFailed("no walls were found")
    sizes = ndi.sum(walls, labels, range(1, n + 1))
    ring = walls & (labels == (1 + int(np.argmax(sizes))))
    ys, xs = np.nonzero(ring)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    h, w = walls.shape
    if (x1 - x0) < 0.25 * w or (y1 - y0) < 0.25 * h:
        raise TracingFailed("no building outline spans the drawing")
    # Keep every wall stroke inside the outline (inner walls may not touch the ring).
    box = np.zeros_like(walls)
    box[y0:y1 + 1, x0:x1 + 1] = True
    return walls & box, (x0, y0, x1, y1)


def _outer_thickness(walls: np.ndarray, box: Tuple[int, int, int, int]) -> float:
    """Median depth of the wall band measured inward from each edge of the outline."""
    x0, y0, x1, y1 = box
    runs: List[int] = []

    def run_len(line: np.ndarray) -> int:
        off = np.flatnonzero(~line)
        return int(off[0]) if off.size else len(line)

    for x in np.linspace(x0, x1, 40).astype(int):
        runs += [run_len(walls[y0:y1 + 1, x]), run_len(walls[y0:y1 + 1, x][::-1])]
    for y in np.linspace(y0, y1, 40).astype(int):
        runs += [run_len(walls[y, x0:x1 + 1]), run_len(walls[y, x0:x1 + 1][::-1])]
    runs = [r for r in runs if r > 0]
    if not runs:
        raise TracingFailed("the building outline has no measurable wall")
    return float(np.median(runs))


def _openings(walls: np.ndarray, box: Tuple[int, int, int, int], t_out: float) -> List[Dict[str, Any]]:
    """Gaps in the outer wall ring: [{side, lo, hi}] in pixels along that side."""
    x0, y0, x1, y1 = box
    inset = max(1, int(round(t_out / 2)))
    lines = {
        "N": walls[y0 + inset, x0:x1 + 1], "S": walls[y1 - inset, x0:x1 + 1],
        "W": walls[y0:y1 + 1, x0 + inset], "E": walls[y0:y1 + 1, x1 - inset],
    }
    starts = {"N": x0, "S": x0, "W": y0, "E": y0}
    out: List[Dict[str, Any]] = []
    for side, line in lines.items():
        coverage = line.mean()
        if coverage < 0.5:
            raise TracingFailed(f"the {side} side of the outline is mostly missing")
        padded = np.concatenate([[True], line, [True]])
        edges = np.flatnonzero(np.diff(padded.astype(np.int8)))
        for a, b in zip(edges[::2], edges[1::2]):
            if a <= 2 * t_out or b >= len(line) - 2 * t_out:   # corner artefacts
                continue
            if b - a >= max(6.0, 1.2 * t_out):
                out.append({"side": side, "lo": starts[side] + int(a), "hi": starts[side] + int(b)})
    return out


# --------------------------------------------------------------------------- grid helpers
def _resample(mask: np.ndarray, nx: int, ny: int, threshold: float = 0.3) -> np.ndarray:
    """Area-average a pixel mask onto an nx-by-ny grid; a cell is set if >= threshold covered."""
    im = Image.fromarray((mask * 255).astype(np.uint8)).resize((nx, ny), Image.BOX)
    return np.asarray(im, dtype=np.float32) / 255.0 >= threshold


def _rects(mask: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """Cover a boolean grid with rectangles (i0, j0, i1, j1), merging identical row runs."""
    done: List[Tuple[int, int, int, int]] = []
    open_runs: Dict[Tuple[int, int], int] = {}   # (i0, i1) -> starting row
    for j in range(mask.shape[0] + 1):
        runs = set()
        if j < mask.shape[0]:
            row = np.concatenate([[False], mask[j], [False]])
            e = np.flatnonzero(np.diff(row.astype(np.int8)))
            runs = {(int(a), int(b)) for a, b in zip(e[::2], e[1::2])}
        for run in list(open_runs):
            if run not in runs:
                done.append((run[0], open_runs.pop(run), run[1], j))
        for run in runs:
            open_runs.setdefault(run, j)
    return done


def _match_names(centres: List[Tuple[float, float]], hints: List[Dict[str, Any]],
                 plan_w: float, plan_h: float) -> List[Optional[str]]:
    """Give each traced room the name of the Nemotron room at the same relative position."""
    names: List[Optional[str]] = [None] * len(centres)
    if not centres or not hints or plan_w <= 0 or plan_h <= 0:
        return names
    hint_c = []
    for r in hints:
        try:
            hint_c.append(((float(r["x"]) + float(r["width"]) / 2) / plan_w,
                           (float(r["y"]) + float(r["height"]) / 2) / plan_h))
        except (KeyError, TypeError, ValueError):
            hint_c.append((9.0, 9.0))
    cost = np.array([[np.hypot(cx - hx, cy - hy) for hx, hy in hint_c] for cx, cy in centres])
    rows, cols = linear_sum_assignment(cost)
    for r, c in zip(rows, cols):
        if cost[r, c] <= 0.35:
            names[r] = str(hints[c].get("name") or "").strip() or None
    return names


# --------------------------------------------------------------------------- main
def trace_floor_plan(image_bytes: bytes, hints: Dict[str, Any]) -> TracedPlan:
    """Build a simulation-ready Building from the image, using Nemotron's JSON (`hints`)
    only for meaning: exit labels/sides and room names. Raises TracingFailed when the
    image can't be measured reliably."""
    gray = _load_gray(image_bytes)
    walls_px, box = _building_box(_wall_mask(gray))
    x0, y0, x1, y1 = box
    t_out = _outer_thickness(walls_px, box)
    openings = _openings(walls_px, box, t_out)
    if not openings:
        raise TracingFailed("the outer wall has no openings")

    # ---- which openings are exits: only those Nemotron reported (side + position) ----
    hint_exits = [e for e in hints.get("exits") or [] if str(e.get("orientation", "")).upper() in SIDES]
    if not hint_exits:
        raise TracingFailed("Nemotron reported no marked exits to confirm")
    try:
        plan_w, plan_h = float(hints.get("width") or 0), float(hints.get("height") or 0)
    except (TypeError, ValueError):
        plan_w = plan_h = 0.0
    chosen: Dict[int, Dict[str, Any]] = {}
    notes: List[str] = []
    for e in hint_exits:
        side = str(e["orientation"]).upper()
        cands = [k for k, o in enumerate(openings) if o["side"] == side and k not in chosen]
        if not cands:
            notes.append(f"{e.get('label', 'An exit')} was reported on the {side} side, "
                         "but no opening was found there in the drawing; it was left out.")
            continue
        along = (x1 - x0) if side in ("N", "S") else (y1 - y0)
        try:
            rel = float(e["x"]) / plan_w if side in ("N", "S") else float(e["y"]) / plan_h
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            rel = 0.5
        start = x0 if side in ("N", "S") else y0
        k = min(cands, key=lambda c: abs(((openings[c]["lo"] + openings[c]["hi"]) / 2 - start) / along - rel))
        chosen[k] = e
    if not chosen:
        raise TracingFailed("none of Nemotron's exits matched an opening in the drawing")

    # ---- scale: marked exit openings are taken as ~1 m single exit doors ----
    exit_px = float(np.median([openings[k]["hi"] - openings[k]["lo"] for k in chosen]))
    m_per_px = EXIT_DOOR_M / exit_px
    W = (x1 - x0 + 1) * m_per_px
    H = (y1 - y0 + 1) * m_per_px
    if not (6.0 <= max(W, H) <= 150.0):
        raise TracingFailed(f"the estimated building size ({W:.0f} x {H:.0f} m) is implausible")
    nx, ny = max(10, round(W / CELL_M)), max(10, round(H / CELL_M))
    W, H = nx * CELL_M, ny * CELL_M
    sx, sy = nx / (x1 - x0 + 1), ny / (y1 - y0 + 1)   # cells per pixel

    grid = _resample(walls_px[y0:y1 + 1, x0:x1 + 1], nx, ny)
    t_cells = max(1, round(t_out * sx))

    # ---- exits on the grid; seal every exterior opening that is not a confirmed exit ----
    exits: List[ExitDef] = []
    used_ids = set()
    for k, o in enumerate(openings):
        side = o["side"]
        lo = (o["lo"] - (x0 if side in ("N", "S") else y0)) * (sx if side in ("N", "S") else sy)
        hi = (o["hi"] - (x0 if side in ("N", "S") else y0)) * (sx if side in ("N", "S") else sy)
        i0, i1 = int(np.floor(lo)), int(np.ceil(hi))
        band = slice(0, t_cells + 1) if side in ("N", "W") else slice(-(t_cells + 1), None)
        if k not in chosen:
            if side in ("N", "S"):
                grid[band, i0:i1] = True
            else:
                grid[i0:i1, band] = True
            notes.append(f"An unlabelled opening on the {side} side was treated as wall "
                         "(only openings marked as exits are used).")
            continue
        e = chosen[k]
        # Clear the full opening through the wall band so the doorway is never pinched.
        if side in ("N", "S"):
            grid[band, i0:i1] = False
        else:
            grid[i0:i1, band] = False
        width = (i1 - i0) * CELL_M
        mid = (i0 + i1) / 2 * CELL_M
        ex_id = "".join(ch for ch in str(e.get("id") or "") if ch.isalnum() or ch in "-_")[:24] or chr(65 + len(exits))
        while ex_id in used_ids:
            ex_id += "x"
        used_ids.add(ex_id)
        x = mid if side in ("N", "S") else (0.0 if side == "W" else W)
        y = mid if side in ("E", "W") else (0.0 if side == "N" else H)
        exits.append(ExitDef(ex_id, str(e.get("label") or f"Exit {len(exits) + 1}"), round(x, 2), round(y, 2),
                             round(width, 2), side, False))

    # ---- walkable space must connect to an exit; tiny pockets become wall ----
    free = ~grid
    lab, n = ndi.label(free)
    reach = set()
    for ex in exits:
        i = min(nx - 1, int(ex.x / CELL_M)); j = min(ny - 1, int(ex.y / CELL_M))
        win = lab[max(0, j - t_cells - 1):j + t_cells + 2, max(0, i - t_cells - 1):i + t_cells + 2]
        reach |= set(int(v) for v in np.unique(win) if v)
    obstacles: List[Obstacle] = []
    for comp in range(1, n + 1):
        if comp in reach:
            continue
        cells = lab == comp
        if cells.sum() * CELL_M ** 2 < 1.0:
            grid |= cells                                  # wall-thickness artefact
            continue
        grid |= cells                                      # closed room: not walkable
        js, is_ = np.nonzero(cells)
        obstacles.append(Obstacle(f"closed-{len(obstacles) + 1}", float(is_.min() * CELL_M), float(js.min() * CELL_M),
                                  float((is_.max() - is_.min() + 1) * CELL_M), float((js.max() - js.min() + 1) * CELL_M),
                                  "No door found"))
        notes.append("An enclosed area has no door to the rest of the building; nobody is placed there.")
    free = ~grid

    # ---- rooms vs corridors: close door-sized gaps, then split the free space ----
    seal = round(DOOR_SEAL_M / CELL_M)
    # Treat the whole outer wall band as solid here, exit doorways included, so a room
    # with an exit in its own wall still reads as a clean rectangle. (Doorways stay
    # walkable in the simulation; this only affects room / corridor labelling.)
    solid = grid.copy()
    solid[:t_cells + 1, :] = solid[-(t_cells + 1):, :] = True
    solid[:, :t_cells + 1] = solid[:, -(t_cells + 1):] = True
    free = ~solid
    sealed = free & ~ndi.binary_dilation(solid, structure=np.ones((3, 3)), iterations=seal)
    seeds, n_spaces = ndi.label(sealed)
    if n_spaces == 0:
        raise TracingFailed("no walkable space was found inside the walls")
    sizes = ndi.sum(sealed, seeds, range(1, n_spaces + 1))
    keep = [k + 1 for k, s in enumerate(sizes) if s * CELL_M ** 2 >= 0.25]

    def grow(rect: Tuple[int, int, int, int]) -> Tuple[int, int, int, int]:
        """Push a core rectangle back out to the walls (whole edges must stay free)."""
        i0, j0, i1, j1 = rect
        for _ in range(seal + 1):
            moved = False
            if i0 > 0 and free[j0:j1, i0 - 1].all():
                i0 -= 1; moved = True
            if i1 < nx and free[j0:j1, i1].all():
                i1 += 1; moved = True
            if j0 > 0 and free[j0 - 1, i0:i1].all():
                j0 -= 1; moved = True
            if j1 < ny and free[j1, i0:i1].all():
                j1 += 1; moved = True
            if not moved:
                break
        return i0, j0, i1, j1

    # Each space's *core* (free cells at least DOOR_SEAL_M from any wall) is a clean
    # rectangle for an ordinary room and a cross / L / strip for circulation. Rooms and
    # corridor pieces are those cores grown back out to the walls, so occupants are only
    # ever placed in open floor, never in slivers along a wall or inside a doorway.
    rooms: List[Room] = []
    corridors: List[Corridor] = []
    room_centres: List[Tuple[float, float]] = []
    for comp in keep:
        core = seeds == comp
        js, is_ = np.nonzero(core)
        bbox = (int(is_.min()), int(js.min()), int(is_.max()) + 1, int(js.max()) + 1)
        fill = core.sum() / ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
        if fill >= 0.9:
            i0, j0, i1, j1 = grow(bbox)
            rooms.append(Room(f"room-{len(rooms) + 1}", f"Room {len(rooms) + 1}", i0 * CELL_M, j0 * CELL_M,
                              (i1 - i0) * CELL_M, (j1 - j0) * CELL_M))
            room_centres.append(((i0 + i1) / 2 / nx, (j0 + j1) / 2 / ny))
            continue
        taken = np.zeros_like(free)
        pieces = sorted((grow(r) for r in _rects(core)), key=lambda r: -(r[2] - r[0]) * (r[3] - r[1]))
        for i0, j0, i1, j1 in pieces:
            # Stay inside the outer wall (cores can reach into exit doorways) and skip
            # pieces mostly covered already, so corridor area isn't counted twice.
            i0, j0 = max(i0, t_cells), max(j0, t_cells)
            i1, j1 = min(i1, nx - t_cells), min(j1, ny - t_cells)
            if i1 <= i0 or j1 <= j0 or (i1 - i0) * (j1 - j0) * CELL_M ** 2 < 1.0:
                continue
            if taken[j0:j1, i0:i1].mean() > 0.5:
                continue
            taken[j0:j1, i0:i1] = True
            corridors.append(Corridor(f"corridor-{len(corridors) + 1}", "Corridor", i0 * CELL_M, j0 * CELL_M,
                                      (i1 - i0) * CELL_M, (j1 - j0) * CELL_M, "corridor"))
    for room, name in zip(rooms, _match_names(room_centres, list(hints.get("rooms") or []), plan_w, plan_h)):
        if name:
            room.name = name
    if not rooms and not corridors:
        raise TracingFailed("no rooms or corridors could be separated")

    # ---- walls: rectangles on the 0.1 m grid ----
    walls: List[Wall] = []
    for i0, j0, i1, j1 in _rects(grid):
        w_m, h_m = (i1 - i0) * CELL_M, (j1 - j0) * CELL_M
        if w_m >= h_m:
            yc = (j0 + j1) / 2 * CELL_M
            walls.append(Wall(i0 * CELL_M, yc, i1 * CELL_M, yc, h_m, "wall"))
        else:
            xc = (i0 + i1) / 2 * CELL_M
            walls.append(Wall(xc, j0 * CELL_M, xc, j1 * CELL_M, w_m, "wall"))

    notes.insert(0, f"Walls were measured from the drawing itself. The drawing has no scale, so each marked exit "
                    f"is assumed to be {EXIT_DOOR_M:.1f} m wide, giving a building of about {W:.1f} x {H:.1f} m.")
    building = Building(
        round(W, 2), round(H, 2), round(t_cells * CELL_M, 2), rooms, walls, corridors, [], exits, obstacles,
        [Zone(r.id, r.name, r.x, r.y, r.width, r.height) for r in rooms],
        {"source": "nemotron_upload", "geometry_source": "traced", "geometry_review_required": True},
    )
    return TracedPlan(building, notes)
