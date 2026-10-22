"""Live simulation progress: the observer hook, and GET /api/simulate/progress/{run_id}."""
import threading
import time

import pytest
from fastapi.testclient import TestClient

import main
from simulation import MultiFloorParams, SimConfig, simulate_building

SMALL = MultiFloorParams(n_floors=2, occupancy=(30, 30), seed=11)


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def test_progress_snapshots_follow_the_real_run_and_never_change_results():
    seen = []
    with_progress = simulate_building(SMALL, SimConfig(record=False), progress=seen.append)
    without = simulate_building(SMALL, SimConfig(record=False))

    assert with_progress["clearance_time"] == without["clearance_time"]
    assert with_progress["exit_utilization"] == without["exit_utilization"]

    floors = [s["floor"] for s in seen]
    assert floors[0] == 1 and floors[-1] == 0          # top floor first, ground floor last
    assert floors == sorted(floors, reverse=True)
    for floor in (0, 1):
        snaps = [s for s in seen if s["floor"] == floor]
        assert snaps[0]["evacuated"] == 0 and snaps[0]["sim_time"] == 0
        assert [s["evacuated"] for s in snaps] == sorted(s["evacuated"] for s in snaps)
        assert all(s["floors_done"] == 1 - floor and s["n_floors"] == 2 for s in snaps)
    ground = [s for s in seen if s["floor"] == 0]
    assert ground[-1]["evacuated"] <= ground[-1]["floor_total"] == with_progress["total_agents"]


def test_progress_endpoint_reports_a_live_run_then_clears(client):
    assert client.get("/api/simulate/progress/never-started").json() == {"stage": "none"}

    body = {"n_floors": 2, "occupancy": [150, 150], "seed": 3, "record": False, "run_id": "test-run-1"}
    done = {}
    worker = threading.Thread(target=lambda: done.setdefault("r", client.post("/api/simulate/multi", json=body)))
    worker.start()
    snapshots = []
    while worker.is_alive():
        snap = client.get("/api/simulate/progress/test-run-1").json()
        if snap["stage"] != "none":
            snapshots.append(snap)
        time.sleep(0.02)
    worker.join()

    assert done["r"].status_code == 200
    assert snapshots, "no live snapshot was observed during the run"
    s = snapshots[-1]
    assert s["stage"] in ("simulating", "packaging") and s["n_floors"] == 2
    assert 0 <= s["evacuated"] <= s["floor_total"]
    assert client.get("/api/simulate/progress/test-run-1").json() == {"stage": "none"}  # cleaned up after sending


@pytest.mark.parametrize("run_id", ["has spaces", "x" * 65, "../etc"])
def test_invalid_run_ids_are_rejected(client, run_id):
    r = client.post("/api/simulate/multi", json={"n_floors": 1, "occupancy": [20], "record": False, "run_id": run_id})
    assert r.status_code == 422
