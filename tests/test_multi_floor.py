"""Tests for the multi-floor orchestration layer added on top of the original single-floor
engine (simulation/multi_floor.py) and its API surface (/api/building/multi,
/api/simulate/multi, /api/recommend/multi, /api/config).
"""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from building import BuildingParams
from main import app
from simulation import (LocalSimulationEngine, MultiFloorParams, SimConfig,
                        default_multi_floor, simulate_building)
from simulation.simulator import ScheduledAgent

client = TestClient(app)


# --------------------------------------------------------------------- scheduled agents
def test_scheduled_agents_spawn_and_evacuate_after_arrival():
    """The mechanism multi-floor chaining depends on: an agent injected mid-run must not
    exist before its arrival time, and must evacuate after it."""
    p = BuildingParams(occupancy=60, num_exits=2)
    extras = [ScheduledAgent(x=2.0, y=20.0, t=20.0 + 0.4 * i) for i in range(40)]
    r = LocalSimulationEngine().simulate(p, SimConfig(record=True, extra_agents=extras))
    assert r["total_agents"] == 100 and r["extra_agents_injected"] == 40
    assert r["evacuated"] == 100
    spawn, evac = r["agents"]["spawn_time"], r["agents"]["evac_time"]
    assert sum(1 for s in spawn if s == 0) == 60
    assert sum(1 for s in spawn if s > 0) == 40
    for s, e in zip(spawn, evac):
        if s > 0:
            assert e is not None and e >= s


def test_record_flag_does_not_change_agent_outcomes():
    """Regression test: agents.evac_time / .exit must be identical whether or not
    trajectories are recorded - multi-floor chaining and /api/recommend/multi both call
    the simulator with record=False for speed, and must see the real outcome."""
    p = BuildingParams(occupancy=50, num_exits=2)
    r_rec = LocalSimulationEngine().simulate(p, SimConfig(record=True, seed=7))
    r_fast = LocalSimulationEngine().simulate(p, SimConfig(record=False, seed=7))
    assert r_rec["clearance_time"] == r_fast["clearance_time"]
    assert r_rec["agents"]["evac_time"] == r_fast["agents"]["evac_time"]
    assert "trajectories" in r_rec and "trajectories" not in r_fast


# --------------------------------------------------------------------- multi-floor engine
def test_multi_floor_conserves_every_occupant():
    mfp = default_multi_floor(occupancy_total=300, n_floors=3)
    assert sum(mfp.occupancy) == 300
    r = simulate_building(mfp, SimConfig(record=False))
    assert r["total_agents"] == 300
    assert r["completed"] and r["evacuated"] == 300
    # every floor's own occupants + what it received from above == what it started with
    for i, f in enumerate(r["floors"]):
        assert f["total_agents"] - f["extra_agents_injected"] == mfp.occupancy[i]


def test_multi_floor_clearance_grows_toward_the_ground():
    """Physical sanity check: the ground floor clears last, because it carries the
    cascade from every floor above it."""
    mfp = default_multi_floor(occupancy_total=450, n_floors=3)
    r = simulate_building(mfp, SimConfig(record=False))
    ct = [f["clearance_time"] for f in r["floors"]]
    assert ct[2] <= ct[1] <= ct[0]  # top floor first, ground floor last
    assert r["clearance_time"] == ct[0]


def test_multi_floor_labels_stairs_not_exits_above_ground():
    mfp = default_multi_floor(300, 3)
    r = simulate_building(mfp, SimConfig(record=False))
    assert all(v["label"].startswith("Exit") for v in r["floors"][0]["exit_utilization"].values())
    assert all(v["label"].startswith("Stair") for v in r["floors"][1]["exit_utilization"].values())
    assert all(v["label"].startswith("Stair") for v in r["floors"][2]["exit_utilization"].values())


def test_multi_floor_record_flag_does_not_change_clearance():
    mfp = MultiFloorParams(n_floors=2, occupancy=(80, 80), seed=11)
    r1 = simulate_building(mfp, SimConfig(record=True))
    r2 = simulate_building(mfp, SimConfig(record=False))
    assert r1["clearance_time"] == r2["clearance_time"]
    assert r1["total_agents"] == r2["total_agents"] == 160


def test_multi_floor_params_normalize_and_round_trip():
    mfp = MultiFloorParams.from_dict({"n_floors": 4, "occupancy": [50, 50, 50]})  # short list
    assert mfp.n_floors == 4 and len(mfp.occupancy) == 4  # padded, not dropped
    d = mfp.to_dict()
    assert MultiFloorParams.from_dict(d).occupancy == mfp.occupancy


def test_stair_hazard_blocks_only_that_floors_stair():
    mfp = MultiFloorParams(n_floors=2, occupancy=(60, 60), blocked_stairs=((1, "A"),)).normalized()
    fp1 = mfp.floor_params(1)
    assert "A" in fp1.blocked_exits and "B" not in fp1.blocked_exits
    fp0 = mfp.floor_params(0)
    assert fp0.blocked_exits == ()  # hazard on floor 1's stair must not touch the ground floor


# --------------------------------------------------------------------------------- API
def test_api_building_multi():
    r = client.get("/api/building/multi", params={"n_floors": 3, "occupancy_total": 300})
    assert r.status_code == 200
    d = r.json()
    assert d["n_floors"] == 3 and len(d["floors"]) == 3
    assert d["floors"][0]["role"] == "ground" and d["floors"][1]["role"] == "upper"
    assert {e["label"] for e in d["floors"][0]["exits"]} <= {"Exit A", "Exit B", "Exit C", "Exit D"}
    assert {e["label"] for e in d["floors"][1]["exits"]} == {"Stair A", "Stair B"}


def test_api_simulate_multi_and_recommend_multi():
    body = {"n_floors": 3, "occupancy": [120, 120, 120], "record": False}
    r = client.post("/api/simulate/multi", json=body)
    assert r.status_code == 200
    sm = r.json()
    assert sm["completed"] and sm["total_agents"] == 360
    assert "floors" in sm and len(sm["floors"]) == 3
    assert "trajectories" not in sm["floors"][0]  # record: false respected per floor

    r2 = client.post("/api/recommend/multi", json={"params": {"n_floors": 3, "occupancy": [120, 120, 120]}})
    assert r2.status_code == 200
    recs = r2.json()["recommendations"]
    assert isinstance(recs, list)
    for item in recs:
        assert item["basis"] == "simulation"
        assert "predicted_clearance_time" in item and "reason" in item


def test_api_config_never_claims_gpu_or_nemotron_are_active_by_default():
    r = client.get("/api/config")
    assert r.status_code == 200
    d = r.json()
    assert d["cuda_active"] is False
    assert d["nemotron_active"] is False
    assert d["simulation_engine"] == "LocalSimulationEngine"
    assert d["copilot_provider"] == "FallbackCopilotProvider"
