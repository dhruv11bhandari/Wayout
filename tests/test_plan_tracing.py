"""Uploaded floor plans: walls measured from the drawing, Nemotron used for labels.

`fixtures/office_plan.webp` is a real uploaded plan; `office_plan_nemotron.json` is what
Nemotron actually returned for it (only outer walls, a 12 x 8 m building, 0.2 m doors -
the extraction that made the simulation jam). No test here calls NVIDIA.
"""
import json
import os
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

import main
from building import BuildingParams
import building.imported_design as imported
from building.imported_design import _decode_upload, parse_uploaded_plan
from building.plan_tracing import TracingFailed, trace_floor_plan
from simulation import LocalSimulationEngine, SimConfig

FIX = os.path.join(os.path.dirname(__file__), "fixtures")
PLAN = open(os.path.join(FIX, "office_plan.webp"), "rb").read()
HINTS = json.load(open(os.path.join(FIX, "office_plan_nemotron.json")))


def _png(draw_fn, size=(900, 600)) -> bytes:
    im = Image.new("L", size, 255)
    draw_fn(ImageDraw.Draw(im))
    out = BytesIO()
    im.save(out, format="PNG")
    return out.getvalue()


def _simulate(building, occupancy, seed=42):
    p = BuildingParams(occupancy=occupancy, seed=seed, num_exits=min(4, len(building.exits))).normalized()
    return LocalSimulationEngine().simulate(p, SimConfig(record=False), building_override=building)


# --------------------------------------------------------------------------- real plan
def test_real_plan_is_measured_from_the_drawing():
    _, image = _decode_upload("office_plan.webp", "image/webp", PLAN)
    traced = trace_floor_plan(image, HINTS)
    b = traced.building

    # Proportions of the drawing (1186 x 766 px), not Nemotron's 12 x 8 m guess.
    assert b.width / b.height == pytest.approx(1186 / 766, rel=0.03)
    assert sorted(r.name for r in b.rooms) == ["LAB", "MEETING ROOM", "OFFICE 1", "OFFICE 2", "RECEPTION", "STORAGE"]
    assert sorted(e.orientation for e in b.exits) == ["E", "N", "S", "W"]
    assert len(b.corridors) == 3                       # the cross: one band + two half-spines
    assert len(b.walls) > 20                           # interior walls survive, not just the outline
    for e in b.exits:                                  # exits sit mid-side, as drawn
        along = e.x / b.width if e.orientation in ("N", "S") else e.y / b.height
        assert 0.4 < along < 0.6
    assert "assumed" in traced.notes[0]


@pytest.mark.parametrize("occupancy,seed", [(140, 42), (250, 1), (400, 2)])
def test_real_plan_evacuates_everyone(occupancy, seed):
    _, image = _decode_upload("office_plan.webp", "image/webp", PLAN)
    r = _simulate(trace_floor_plan(image, HINTS).building, occupancy, seed)
    assert r["completed"] and r["evacuated"] == occupancy
    assert r["clearance_time"] < 120


# --------------------------------------------------------------------------- rules
def _simple_plan(d: ImageDraw.ImageDraw):
    d.rectangle([100, 100, 800, 500], outline=0, width=14)      # outer wall
    d.rectangle([220, 101, 280, 113], fill=255)                 # N gap: unlabelled (a window)
    d.rectangle([620, 487, 680, 499], fill=255)                 # S gap: the marked exit
    d.line([450, 107, 450, 310], fill=0, width=8)               # interior wall ...
    d.line([450, 355, 450, 493], fill=0, width=8)               # ... with a 0.9 m door gap
    d.text((200, 250), "ROOM A", fill=0)


SIMPLE_HINTS = {
    "width": 20, "height": 12,
    "rooms": [{"name": "ROOM A", "x": 0, "y": 0, "width": 10, "height": 12},
              {"name": "ROOM B", "x": 10, "y": 0, "width": 10, "height": 12}],
    "exits": [{"id": "S1", "label": "MAIN EXIT", "x": 15, "y": 12, "orientation": "S"},
              {"id": "E1", "label": "SIDE EXIT", "x": 20, "y": 6, "orientation": "E"}],
}


def test_only_exits_nemotron_marked_become_exits():
    traced = trace_floor_plan(_png(_simple_plan), SIMPLE_HINTS)
    b = traced.building
    assert [(e.label, e.orientation) for e in b.exits] == [("MAIN EXIT", "S")]
    assert any("unlabelled opening on the N side" in n for n in traced.notes)       # window sealed
    assert any("SIDE EXIT" in n and "no opening" in n for n in traced.notes)        # not invented
    assert sorted(r.name for r in b.rooms) == ["ROOM A", "ROOM B"]
    r = _simulate(b, 60)
    assert r["completed"] and r["evacuated"] == 60


@pytest.mark.parametrize("image", [
    _png(lambda d: None),                                                  # blank page
    _png(lambda d: d.rectangle([0, 0, 900, 600], fill=0)),                 # solid black
    _png(lambda d: d.line([10, 10, 300, 20], fill=0, width=3)),            # a stray line
])
def test_images_that_are_not_clean_plans_are_refused(image):
    with pytest.raises(TracingFailed):
        trace_floor_plan(image, SIMPLE_HINTS)


def test_no_matching_exit_is_refused():
    with pytest.raises(TracingFailed):
        trace_floor_plan(_png(_simple_plan), {**SIMPLE_HINTS, "exits": [SIMPLE_HINTS["exits"][1]]})


# --------------------------------------------------------------------------- upload flow
def test_upload_falls_back_to_nemotron_geometry_with_a_warning(monkeypatch):
    monkeypatch.setattr(imported, "_call_nemotron", lambda *a: HINTS)
    plan = parse_uploaded_plan("blank.png", "image/png", _png(lambda d: None))
    assert plan.building.meta.get("geometry_source") != "traced"
    assert "could not measure the walls" in plan.uncertainties[0]


def test_parse_and_simulate_endpoints_use_the_traced_plan(monkeypatch):
    monkeypatch.setattr(imported, "_call_nemotron", lambda *a: HINTS)
    with TestClient(main.app) as client:
        r = client.post("/api/design/parse", files={"file": ("office_plan.webp", PLAN, "image/webp")})
        assert r.status_code == 200, r.text
        d = r.json()
        floor = d["building"]["floors"][0]
        assert len(floor["rooms"]) == 6 and len(floor["exits"]) == 4
        assert floor["meta"]["geometry_source"] == "traced"
        sim = client.post("/api/design/simulate", json={"design_id": d["design_id"], "occupancy": 200, "record": False})
        assert sim.status_code == 200, sim.text
        assert sim.json()["completed"] and sim.json()["evacuated"] == 200


BUSY = [b'data: {"error":{"message":"ResourceExhausted: Worker local total request limit reached (4441/16)","code":500}}\n']
OK = [b'data: {"choices":[{"delta":{"content":"{\\"ok\\": true}"}}]}\n', b"data: [DONE]\n"]


class FakeResponse:
    def __init__(self, lines): self.lines = lines
    def __enter__(self): return iter(self.lines)
    def __exit__(self, *exc): return False


def _fake_nvidia(monkeypatch, replies):
    monkeypatch.setenv("NEMOTRON_API_KEY", "test-key")
    monkeypatch.setattr(imported.time, "sleep", lambda s: None)
    calls = []
    monkeypatch.setattr(imported.urllib.request, "urlopen",
                        lambda *a, **k: calls.append(1) or FakeResponse(replies[len(calls) - 1]))
    return calls


def test_busy_or_empty_nemotron_replies_are_retried(monkeypatch):
    calls = _fake_nvidia(monkeypatch, [BUSY, [b"data: [DONE]\n"], OK])
    assert imported._call_nemotron("plan.png", "image/png", _png(lambda d: None)) == {"ok": True}
    assert len(calls) == 3


def test_persistent_capacity_error_gives_a_clear_message(monkeypatch):
    calls = _fake_nvidia(monkeypatch, [BUSY, BUSY, BUSY])
    with pytest.raises(RuntimeError, match="temporarily at capacity"):
        imported._call_nemotron("plan.png", "image/png", _png(lambda d: None))
    assert len(calls) == 3


def test_slow_trickling_nemotron_reply_stops_at_the_time_limit(monkeypatch):
    """Congested NVIDIA keeps the stream alive with empty events; WayOut must not wait forever."""
    trickle = [b'data: {"choices":[{"delta":{"role":"assistant"}}]}\n'] * 1000
    calls = _fake_nvidia(monkeypatch, [trickle])
    clock = iter(range(0, 10_000, 5))                       # every check: 5 s later
    monkeypatch.setattr(imported.time, "monotonic", lambda: next(clock))
    with pytest.raises(RuntimeError, match="responding very slowly"):
        imported._call_nemotron("plan.png", "image/png", _png(lambda d: None))
    assert len(calls) == 1


def test_backend_stays_responsive_while_a_plan_is_being_read(monkeypatch):
    """The NVIDIA call can take minutes; it must not freeze the rest of the API meanwhile."""
    import threading
    import time as _time

    def slow_parse(*a):
        _time.sleep(3)
        raise RuntimeError("NVIDIA busy")

    monkeypatch.setattr(imported, "parse_uploaded_plan", slow_parse)
    with TestClient(main.app) as client:
        upload = threading.Thread(target=lambda: client.post(
            "/api/design/parse", files={"file": ("plan.webp", PLAN, "image/webp")}))
        upload.start()
        _time.sleep(0.5)
        t0 = _time.perf_counter()
        assert client.get("/api/health").status_code == 200
        assert _time.perf_counter() - t0 < 1.5
        upload.join()
