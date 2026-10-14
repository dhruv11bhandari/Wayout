"""Vision assisted floor-plan extraction for image and single-page PDF uploads."""
from __future__ import annotations

import base64
from io import BytesIO
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List

from pydantic import BaseModel, Field, ValidationError, model_validator

from building import Building, Corridor, Door, ExitDef, Obstacle, Room, Wall, Zone

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MODEL_DEFAULT = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"


class PlanJSON(BaseModel):
    width: float = Field(gt=4, le=300)
    height: float = Field(gt=4, le=300)
    wall_thickness: float = Field(default=0.2, gt=0.05, le=1.5)
    walls: List[Dict[str, Any]] = Field(min_length=4, max_length=1000)
    rooms: List[Dict[str, Any]] = Field(min_length=1, max_length=200)
    corridors: List[Dict[str, Any]] = Field(default_factory=list, max_length=200)
    doors: List[Dict[str, Any]] = Field(default_factory=list, max_length=500)
    exits: List[Dict[str, Any]] = Field(min_length=1, max_length=20)
    obstacles: List[Dict[str, Any]] = Field(default_factory=list, max_length=500)
    uncertainties: List[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def validate_plan(self):
        for wall in self.walls:
            x1, y1, x2, y2 = (float(wall[k]) for k in ("x1", "y1", "x2", "y2"))
            if abs(x1-x2) > 1e-4 and abs(y1-y2) > 1e-4:
                raise ValueError("Walls must be horizontal or vertical for this simulator.")
            if max(abs(x1), abs(x2)) > self.width + 1 or max(abs(y1), abs(y2)) > self.height + 1:
                raise ValueError("Wall coordinates exceed the floor dimensions.")
        for room in self.rooms:
            x, y = float(room["x"]), float(room["y"])
            width, height = float(room["width"]), float(room["height"])
            if min(width, height) <= 1:
                raise ValueError("Rooms must be larger than one metre in both directions.")
            if x < 0 or y < 0 or x + width > self.width or y + height > self.height:
                raise ValueError("Room coordinates exceed the floor dimensions.")
        return self


@dataclass
class ImportedPlan:
    building: Building
    uncertainties: List[str]
    source_name: str


def _decode_upload(filename: str, content_type: str, raw: bytes):
    if not raw or len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Choose a file smaller than 20 MB.")
    ext = os.path.splitext(filename.lower())[1]
    if ext == ".pdf" or content_type == "application/pdf":
        try:
            import fitz
            doc = fitz.open(stream=raw, filetype="pdf")
            if doc.page_count != 1:
                raise ValueError("For now, upload one floor plan per PDF (one page).")
            pix = doc[0].get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
            mime = "image/png"
            return mime, pix.tobytes("png")
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Could not read this PDF. Try a clear PNG or JPEG export.") from exc
    allowed = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
    mime = allowed.get(ext)
    if not mime:
        raise ValueError("Supported uploads: PNG, JPG, WEBP, or a single-page PDF.")
    if mime == "image/webp":
        # NVIDIA's hosted Omni endpoint documents JPEG/PNG image input. Convert
        # WebP uploads to PNG so the UI's advertised WebP support actually works.
        try:
            from PIL import Image
            with Image.open(BytesIO(raw)) as image:
                image.load()
                if image.width * image.height > 40_000_000:
                    raise ValueError("This image has too many pixels. Export it at a lower resolution and try again.")
                converted = BytesIO()
                image.convert("RGB").save(converted, format="PNG", optimize=True)
                return "image/png", converted.getvalue()
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("Could not read this WebP image. Try exporting it as PNG or JPEG.") from exc
    return mime, raw


def _content_from_response(payload: Dict[str, Any]) -> str:
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("Nemotron returned an empty response.") from exc
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(content).strip(), flags=re.I)
    return content


def _call_nemotron(filename: str, content_type: str, raw: bytes) -> Dict[str, Any]:
    api_key = os.environ.get("NEMOTRON_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Nemotron is not configured. Add NEMOTRON_API_KEY to the local .env file and restart WayOut.")
    mime, image_bytes = _decode_upload(filename, content_type, raw)
    data_url = f"data:{mime};base64," + base64.b64encode(image_bytes).decode("ascii")
    prompt = """Analyze the uploaded architectural floor plan image and return exactly one valid JSON object. Do not include Markdown, comments, explanations, or text outside the JSON.
Your task is to reconstruct a simple 2D axis-aligned floor plan in metres.
Coordinate system:
- Use the top-left corner of the building footprint as `{ "x": 0, "y": 0 }`.
- `x` increases to the right.
- `y` increases downward.
- All dimensions must be in metres.
- Use only finite numbers. Do not use strings for numeric values.
- Round coordinates and dimensions to 2 decimal places.
Scale:
- If printed dimensions are visible, use them.
- If printed dimensions are not visible or incomplete, estimate a plausible scale from the drawing and mention the uncertainty.
- Do not mix pixels and metres in the output.
Important geometry rules:
- The floor plan must be axis-aligned only.
- Every wall must be horizontal or vertical.
- For each wall, either `x1 == x2` or `y1 == y2`.
- Do not output diagonal walls.
- Represent door openings as gaps in walls, not as walls crossing through doors.
- Rooms, corridors, lobbies, doors, exits, and obstacles must stay inside the building footprint.
- Do not invent rooms, labels, exits, stairs, or obstacles that are not visible.
- If something is unclear, include it in `uncertainties`.
Required JSON schema:
{
  "width": number,
  "height": number,
  "wall_thickness": number,
  "walls": [
    {
      "x1": number,
      "y1": number,
      "x2": number,
      "y2": number,
      "thickness": number,
      "kind": "exterior" | "interior"
    }
  ],
  "rooms": [
    {
      "id": string,
      "name": string,
      "x": number,
      "y": number,
      "width": number,
      "height": number
    }
  ],
  "corridors": [
    {
      "id": string,
      "name": string,
      "x": number,
      "y": number,
      "width": number,
      "height": number,
      "kind": "corridor" | "lobby"
    }
  ],
  "doors": [
    {
      "id": string,
      "x": number,
      "y": number,
      "width": number,
      "orientation": "h" | "v",
      "room_id": string
    }
  ],
  "exits": [
    {
      "id": string,
      "label": string,
      "x": number,
      "y": number,
      "width": number,
      "orientation": "N" | "E" | "S" | "W"
    }
  ],
  "obstacles": [
    {
      "id": string,
      "x": number,
      "y": number,
      "width": number,
      "height": number,
      "label": string
    }
  ],
  "uncertainties": [
    string
  ]
}
Validation requirements:
- Return all required top-level fields, even if some arrays are empty.
- `width`, `height`, and `wall_thickness` must be positive numbers.
- Include at least four exterior wall segments forming the outer building boundary.
- Include at least one walkable area in `rooms` or `corridors`.
- Include at least one exit only if a door, gate, or exit to the outside is clearly visible.
- For an exit:
  - `"N"` means the exit lies on the top building edge, so `y` must be `0`.
  - `"S"` means the exit lies on the bottom building edge, so `y` must equal `height`.
  - `"W"` means the exit lies on the left building edge, so `x` must be `0`.
  - `"E"` means the exit lies on the right building edge, so `x` must equal `width`.
- Door orientation:
  - Use `"h"` for a horizontal doorway in a horizontal wall.
  - Use `"v"` for a vertical doorway in a vertical wall.
- `room_id` in each door must match the `id` of the room or corridor that the door connects to.
- Use simple IDs like `"room_1"`, `"corridor_1"`, `"door_1"`, `"exit_1"`, `"wall_1"` is not needed for walls.
- If the drawing has labels, copy visible labels exactly.
- If a label is unreadable, use a neutral name like `"Room 1"` and add an uncertainty.
- Prefer a simple valid approximation over an overly detailed invalid reconstruction.
Before answering, internally check:
1. The output is valid JSON.
2. All required fields are present.
3. All wall segments are horizontal or vertical.
4. Exterior walls outline the building.
5. Door openings do not overlap solid wall segments.
6. Exits are on the correct building edge.
7. All dimensions are in metres.
Return only the JSON object."""
    req = urllib.request.Request(
        (os.environ.get("NEMOTRON_ENDPOINT") or "https://integrate.api.nvidia.com/v1").rstrip("/") + "/chat/completions",
        data=json.dumps({
            "model": os.environ.get("NEMOTRON_MODEL") or MODEL_DEFAULT,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]}],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
            "max_tokens": 6000,
            "chat_template_kwargs": {"enable_thinking": False},
            "stream": False,
        }).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        if exc.code in (401, 403):
            raise RuntimeError("Nemotron rejected the API key. Check the local key and endpoint settings.") from exc
        raise RuntimeError(f"Nemotron request failed ({exc.code}): {detail}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Could not reach NVIDIA Nemotron. Check the network and try again.") from exc
    try:
        return json.loads(_content_from_response(result))
    except (json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError("Nemotron could not return a valid floor-plan description. Try a clearer plan image.") from exc


def _building_from_json(data: Dict[str, Any]) -> ImportedPlan:
    try:
        plan = PlanJSON.model_validate(data)
        walls = [Wall(float(w["x1"]), float(w["y1"]), float(w["x2"]), float(w["y2"]),
                      float(w.get("thickness", plan.wall_thickness)), str(w.get("kind", "wall"))) for w in plan.walls]
        rooms = [Room(str(r.get("id", f"room-{i+1}")), str(r.get("name", f"Room {i+1}")),
                      float(r["x"]), float(r["y"]), float(r["width"]), float(r["height"]))
                 for i, r in enumerate(plan.rooms)]
        corridors = [Corridor(str(c.get("id", f"space-{i+1}")), str(c.get("name", f"Walkway {i+1}")),
                              float(c["x"]), float(c["y"]), float(c["width"]), float(c["height"]),
                              str(c.get("kind", "corridor"))) for i, c in enumerate(plan.corridors)]
        doors = [Door(str(d.get("id", f"door-{i+1}")), float(d["x"]), float(d["y"]), float(d["width"]),
                      str(d["orientation"]), str(d.get("room_id", ""))) for i, d in enumerate(plan.doors)]
        exits = [ExitDef(str(e.get("id", chr(65+i))), str(e.get("label", f"Exit {i+1}")), float(e["x"]), float(e["y"]),
                         float(e["width"]), str(e["orientation"]).upper(), False) for i, e in enumerate(plan.exits)]
        obstacles = [Obstacle(str(o.get("id", f"obstacle-{i+1}")), float(o["x"]), float(o["y"]),
                              float(o["width"]), float(o["height"]), str(o.get("label", "")))
                     for i, o in enumerate(plan.obstacles)]
        for exit_def in exits:
            if exit_def.orientation not in ("N", "S", "E", "W") or exit_def.width <= 0:
                raise ValueError("Every exit needs a valid side and width.")
            on_edge = {
                "N": abs(exit_def.y) <= 0.5,
                "S": abs(exit_def.y-plan.height) <= 0.5,
                "E": abs(exit_def.x-plan.width) <= 0.5,
                "W": abs(exit_def.x) <= 0.5,
            }[exit_def.orientation]
            if not on_edge:
                raise ValueError(f"{exit_def.label} must lie on the edge indicated by its orientation.")
        if not exits:
            raise ValueError("At least one exit must touch the outside edge of the floor plan.")
        building = Building(plan.width, plan.height, plan.wall_thickness, rooms, walls, corridors, doors, exits,
                            obstacles, [Zone(r.id, r.name, r.x, r.y, r.width, r.height) for r in rooms],
                            {"source": "nemotron_upload", "geometry_review_required": True})
        return ImportedPlan(building, plan.uncertainties, "Nemotron vision extraction")
    except (ValidationError, KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Nemotron returned a floor plan WayOut cannot simulate: {exc}") from exc


def parse_uploaded_plan(filename: str, content_type: str, raw: bytes) -> ImportedPlan:
    return _building_from_json(_call_nemotron(filename, content_type, raw))


def building_to_payload(building: Building, floor: int = 0, occupancy: int = 140):
    data = building.to_dict()
    for room in data["rooms"]:
        room["occupancy"] = 0
    data.update({"floor": floor, "role": "ground", "initial_agents": [], "paths": [],
                 "params": {"occupancy": occupancy, "corridor_width": 2.0, "exit_width": 1.2,
                            "num_exits": len(building.exits), "agent_speed": 1.3, "blocked_exits": [], "seed": 42}})
    return data
