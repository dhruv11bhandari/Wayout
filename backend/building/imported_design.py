"""Vision assisted floor-plan extraction for image and single-page PDF uploads."""
from __future__ import annotations

import base64
from io import BytesIO
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List

import certifi

from pydantic import BaseModel, Field, ValidationError, model_validator

from building import Building, Corridor, Door, ExitDef, Obstacle, Room, Wall, Zone
from building.plan_tracing import TracingFailed, trace_floor_plan

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MODEL_DEFAULT = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
RETRY_WAITS_S = (3.0, 8.0)  # pauses before the 2nd and 3rd attempt when NVIDIA is busy
TOTAL_LIMIT_S = 150.0       # whole Nemotron request, retries included (a normal read takes ~30-60 s)
SILENCE_LIMIT_S = 45.0      # give up if NVIDIA sends nothing at all for this long
AT_CAPACITY = ("NVIDIA Nemotron is temporarily at capacity, so it could not read the plan. "
               "Wait a minute and try the upload again; your API key was not rejected.")
TOO_SLOW = ("NVIDIA Nemotron is responding very slowly right now, so WayOut stopped waiting for it. "
            "This is NVIDIA's free service being busy, not a problem with your plan. "
            "Wait a few minutes and try the upload again.")


class NemotronBusy(Exception):
    """NVIDIA's hosted model is overloaded (or sent nothing back); worth retrying shortly."""


class NemotronTooSlow(Exception):
    """The answer is still trickling in after TOTAL_LIMIT_S; stop waiting."""


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


def _read_streamed_completion(response, deadline: float = float("inf")) -> Dict[str, Any]:
    """Collect OpenAI-compatible SSE content while the model is generating it.

    When NVIDIA is congested it keeps the stream alive but generates extremely slowly, so
    a per-read socket timeout never fires; `deadline` (time.monotonic()) caps the total."""
    parts: List[str] = []
    for line in response:
        if time.monotonic() > deadline:
            raise NemotronTooSlow()
        if not line.startswith(b"data:"):
            continue
        event = line[5:].strip()
        if not event or event == b"[DONE]":
            continue
        try:
            payload = json.loads(event)
        except json.JSONDecodeError:
            continue
        # NVIDIA reports overload *inside* an HTTP 200 stream, e.g.
        # {"error": {"message": "ResourceExhausted: Worker local total request limit reached ..."}}
        error = payload.get("error") if isinstance(payload, dict) else None
        if error:
            message = str(error.get("message", error) if isinstance(error, dict) else error)
            if "ResourceExhausted" in message or "limit reached" in message:
                raise NemotronBusy(message)
            raise RuntimeError(f"Nemotron reported an error: {message[:300]}")
        for choice in payload.get("choices", []):
            delta = choice.get("delta", {})
            content = delta.get("content")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                parts.extend(part.get("text", "") for part in content if isinstance(part, dict))
    if not parts:
        raise NemotronBusy("Nemotron returned an empty response.")
    return {"choices": [{"message": {"content": "".join(parts)}}]}


def _call_nemotron(filename: str, content_type: str, raw: bytes) -> Dict[str, Any]:
    api_key = os.environ.get("NEMOTRON_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Nemotron is not configured. Add NEMOTRON_API_KEY to the local .env file and restart WayOut.")
    mime, image_bytes = _decode_upload(filename, content_type, raw)
    data_url = f"data:{mime};base64," + base64.b64encode(image_bytes).decode("ascii")
    prompt = """Read this architectural floor plan and return one JSON object only. Reconstruct a 2D, axis-aligned floor plan in metres, using the top-left as (0,0), x right and y down. If printed dimensions are present, use them. If scale is not recoverable, estimate a plausible scale and add a clear uncertainty. Identify every exit that is visibly marked on the drawing (for example EXIT text, exit signage, or a clearly marked exterior exit door); preserve its location, side, label, and usable width so WayOut can display it clearly in the 2D and 3D building. Never invent an exit or infer one from an ordinary window or unmarked opening; mention any ambiguous exit symbol in uncertainties. Include the fields width,height,wall_thickness,walls,rooms,corridors,doors,exits,obstacles,uncertainties. walls is a list of {x1,y1,x2,y2,thickness,kind}; represent every door and exit opening as an actual gap in the matching wall, with no wall or obstacle in the opening or its direct approach. rooms is [{id,name,x,y,width,height}]. corridors is [{id,name,x,y,width,height,kind}] with kind corridor or lobby. doors is [{id,x,y,width,orientation,room_id}] where orientation is h or v. exits is [{id,label,x,y,width,orientation}] where orientation is N,E,S,W and x/y lie on the matching building edge. obstacles is [{id,x,y,width,height,label}]. All dimensions are metres. Return only geometry you can see; at least one walkable room, four exterior wall segments, and one clearly marked exit are required. Ensure the interior walkable areas connect through the shown doors/corridors to at least one visible exit; list missing or unclear connections in uncertainties."""
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
            "max_tokens": 4096,
            "chat_template_kwargs": {"enable_thinking": False},
            "stream": True,
        }).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )
    try:
        # Some macOS Python installs ship without a populated OpenSSL trust
        # store. Use the maintained Mozilla CA bundle without disabling TLS
        # verification, so NVIDIA's certificate validates on a fresh laptop.
        tls_context = ssl.create_default_context(cafile=certifi.where())
        # NVIDIA's free hosted endpoint is often briefly overloaded; it then streams back
        # an error event or nothing at all. Wait a little and retry before giving up -
        # but never past TOTAL_LIMIT_S, so the upload screen can't hang indefinitely.
        deadline = time.monotonic() + TOTAL_LIMIT_S
        for attempt in range(len(RETRY_WAITS_S) + 1):
            try:
                with urllib.request.urlopen(req, timeout=SILENCE_LIMIT_S, context=tls_context) as response:
                    result = _read_streamed_completion(response, deadline)
                break
            except NemotronTooSlow:
                raise RuntimeError(TOO_SLOW)
            except NemotronBusy:
                if attempt == len(RETRY_WAITS_S) or time.monotonic() + RETRY_WAITS_S[attempt] + 20 > deadline:
                    raise RuntimeError(AT_CAPACITY)
                time.sleep(RETRY_WAITS_S[attempt])
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        if exc.code in (401, 403):
            raise RuntimeError("Nemotron rejected the API key. Check the local key and endpoint settings.") from exc
        try:
            provider_error = json.loads(detail).get("error", {})
            provider_message = str(provider_error.get("message", ""))
            provider_code = str(provider_error.get("code", ""))
        except (AttributeError, json.JSONDecodeError, TypeError):
            provider_message = detail
            provider_code = ""
        if exc.code == 503 and ("ResourceExhausted" in provider_message or "ResourceExhausted" in provider_code):
            raise RuntimeError(AT_CAPACITY) from exc
        if exc.code == 429:
            raise RuntimeError("NVIDIA is rate-limiting requests for this API key. Wait for the limit to reset, then try again.") from exc
        raise RuntimeError(f"Nemotron request failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, ssl.SSLCertVerificationError):
            raise RuntimeError("This computer could not verify NVIDIA's secure connection. Update WayOut's CA certificates and restart the app.") from exc
        if isinstance(reason, TimeoutError):
            raise RuntimeError(TOO_SLOW) from exc
        raise RuntimeError("Could not reach NVIDIA Nemotron. Check the network and try again.") from exc
    except TimeoutError as exc:
        raise RuntimeError(TOO_SLOW) from exc
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
            side_length = plan.width if exit_def.orientation in ("N", "S") else plan.height
            if side_length <= 1.0:
                raise ValueError(f"{exit_def.label} is on an edge too short for a usable opening.")
            exit_def.width = min(max(exit_def.width, 0.8), min(4.0, side_length - 0.2))
            if exit_def.orientation in ("N", "S"):
                exit_def.x = min(max(exit_def.x, exit_def.width / 2), plan.width - exit_def.width / 2)
                exit_def.y = 0.0 if exit_def.orientation == "N" else plan.height
            else:
                exit_def.y = min(max(exit_def.y, exit_def.width / 2), plan.height - exit_def.width / 2)
                exit_def.x = 0.0 if exit_def.orientation == "W" else plan.width
        if not exits:
            raise ValueError("At least one exit must touch the outside edge of the floor plan.")
        walls = _open_wall_segments(walls, doors, exits, plan)
        obstacles = _clear_exit_approaches(obstacles, exits, plan, plan.wall_thickness)
        building = Building(plan.width, plan.height, plan.wall_thickness, rooms, walls, corridors, doors, exits,
                            obstacles, [Zone(r.id, r.name, r.x, r.y, r.width, r.height) for r in rooms],
                            {"source": "nemotron_upload", "geometry_review_required": True})
        # Catch disconnected rooms during upload so the user can correct the
        # extracted geometry before they start a simulation.
        from simulation.navigation import Environment
        Environment(building)
        return ImportedPlan(building, plan.uncertainties, "Nemotron vision extraction")
    except (ValidationError, KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Nemotron returned a floor plan WayOut cannot simulate: {exc}") from exc


def _open_wall_segments(walls: List[Wall], doors: List[Door], exits: List[ExitDef], plan: PlanJSON) -> List[Wall]:
    """Cut model-returned doors and exits out of walls, even if the vision model drew a solid line through them."""
    opened: List[Wall] = []
    for wall in walls:
        horizontal = abs(wall.y1 - wall.y2) < 1e-8
        lo, hi = sorted((wall.x1, wall.x2)) if horizontal else sorted((wall.y1, wall.y2))
        center = wall.y1 if horizontal else wall.x1
        gaps: List[tuple[float, float]] = []
        for door in doors:
            if (door.orientation.lower() == "h") == horizontal and abs(center - (door.y if horizontal else door.x)) <= max(0.3, wall.thickness):
                gaps.append(((door.x if horizontal else door.y) - door.width / 2,
                             (door.x if horizontal else door.y) + door.width / 2))
        for ex in exits:
            if horizontal and ex.orientation in ("N", "S"):
                edge = 0.0 if ex.orientation == "N" else plan.height
                aligned = abs(center - edge) <= max(0.65, wall.thickness)
                mid = ex.x
            elif not horizontal and ex.orientation in ("E", "W"):
                edge = 0.0 if ex.orientation == "W" else plan.width
                aligned = abs(center - edge) <= max(0.65, wall.thickness)
                mid = ex.y
            else:
                aligned = False
                mid = 0.0
            if aligned:
                gaps.append((mid - ex.width / 2, mid + ex.width / 2))
        spans = [(lo, hi)]
        for gap_lo, gap_hi in gaps:
            next_spans = []
            for a, b in spans:
                if gap_hi <= a or gap_lo >= b:
                    next_spans.append((a, b))
                    continue
                if gap_lo > a:
                    next_spans.append((a, min(gap_lo, b)))
                if gap_hi < b:
                    next_spans.append((max(gap_hi, a), b))
            spans = next_spans
        for a, b in spans:
            if b - a <= 1e-4:
                continue
            if horizontal:
                direction = 1 if wall.x2 >= wall.x1 else -1
                x1, x2 = (a, b) if direction > 0 else (b, a)
                opened.append(Wall(x1, center, x2, center, wall.thickness, wall.kind))
            else:
                direction = 1 if wall.y2 >= wall.y1 else -1
                y1, y2 = (a, b) if direction > 0 else (b, a)
                opened.append(Wall(center, y1, center, y2, wall.thickness, wall.kind))
    return opened


def _clear_exit_approaches(obstacles: List[Obstacle], exits: List[ExitDef], plan: PlanJSON,
                           wall_thickness: float) -> List[Obstacle]:
    """Remove only the portions of obstacles occupying an exit opening or its short approach."""
    remaining = obstacles
    depth = max(wall_thickness, 0.2) + 0.35
    for ex in exits:
        half = ex.width / 2
        if ex.orientation == "N":
            cut = (ex.x-half, 0.0, ex.x+half, min(plan.height, depth))
        elif ex.orientation == "S":
            cut = (ex.x-half, max(0.0, plan.height-depth), ex.x+half, plan.height)
        elif ex.orientation == "E":
            cut = (max(0.0, plan.width-depth), ex.y-half, plan.width, ex.y+half)
        else:
            cut = (0.0, ex.y-half, min(plan.width, depth), ex.y+half)
        cut_x0, cut_y0, cut_x1, cut_y1 = cut
        next_obstacles: List[Obstacle] = []
        for obstacle in remaining:
            x0, y0 = obstacle.x, obstacle.y
            x1, y1 = x0 + obstacle.width, y0 + obstacle.height
            ix0, iy0 = max(x0, cut_x0), max(y0, cut_y0)
            ix1, iy1 = min(x1, cut_x1), min(y1, cut_y1)
            if ix0 >= ix1 or iy0 >= iy1:
                next_obstacles.append(obstacle)
                continue
            fragments = [(x0, y0, x1, iy0), (x0, iy1, x1, y1),
                         (x0, iy0, ix0, iy1), (ix1, iy0, x1, iy1)]
            part = 0
            for fx0, fy0, fx1, fy1 in fragments:
                if fx1 - fx0 > 1e-3 and fy1 - fy0 > 1e-3:
                    part += 1
                    next_obstacles.append(Obstacle(f"{obstacle.id}-part{part}", fx0, fy0,
                                                   fx1-fx0, fy1-fy0, obstacle.label))
        remaining = next_obstacles
    return remaining


def parse_uploaded_plan(filename: str, content_type: str, raw: bytes) -> ImportedPlan:
    """Nemotron reads the plan's meaning (exit labels and sides, room names); for clean line
    drawings WayOut then measures the actual walls, openings and rooms from the image
    (`plan_tracing`). If the image can't be measured, Nemotron's own approximate geometry
    is used instead, and the user is told so."""
    data = _call_nemotron(filename, content_type, raw)
    _, image_bytes = _decode_upload(filename, content_type, raw)
    try:
        traced = trace_floor_plan(image_bytes, data)
        from simulation.navigation import Environment
        Environment(traced.building)  # same "every area reaches an exit" check as below
        return ImportedPlan(traced.building, traced.notes[:30], "Nemotron labels + walls measured from the drawing")
    except (TracingFailed, ValueError) as exc:
        plan = _building_from_json(data)
        plan.uncertainties.insert(0, f"WayOut could not measure the walls from this image ({exc}), "
                                     "so Nemotron's approximate geometry is used. Check walls, sizes and exits carefully.")
        return plan


def building_to_payload(building: Building, floor: int = 0, occupancy: int = 140):
    data = building.to_dict()
    for room in data["rooms"]:
        room["occupancy"] = 0
    data.update({"floor": floor, "role": "ground", "initial_agents": [], "paths": [],
                 "params": {"occupancy": occupancy, "corridor_width": 2.0, "exit_width": 1.2,
                            "num_exits": len(building.exits), "agent_speed": 1.3, "blocked_exits": [], "seed": 42}})
    return data
