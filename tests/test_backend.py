"""Backend tests: run with  `pytest tests -q`  from the project root.

They exercise the real simulator and the real trained model - nothing is mocked.
"""
import numpy as np
import pytest
from fastapi.testclient import TestClient

import main
from building import BuildingParams, build_geometry
from copilot import RuleBasedScenarioInterpreter
from simulation import LocalSimulationEngine, SimConfig
from simulation.navigation import get_environment


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:  # runs the lifespan (loads / trains the model)
        yield c


def sim(client, **kw):
    r = client.post("/api/simulate", json=kw)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- API
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok" and d["model_ready"] is True
    assert d["nvidia_components"] == {"cuda_engine": False, "nemotron": False, "nebius": False}


def test_building_default_and_parameter_changes(client):
    d = client.get("/api/building").json()
    assert len(d["exits"]) == 2 and len(d["rooms"]) == 8 and d["walls"]
    assert len(d["initial_agents"]) == 140
    assert sum(r["occupancy"] for r in d["rooms"]) + d["meta"]["circulation_counts"]["corridor"] \
        + d["meta"]["circulation_counts"]["lobby"] == 140
    corridor = next(c for c in d["corridors"] if c["kind"] == "corridor")
    assert corridor["height"] == pytest.approx(2.0)
    d2 = client.get("/api/building", params={"corridor_width": 3.0, "num_exits": 3, "blocked_exits": "B"}).json()
    assert next(c for c in d2["corridors"] if c["kind"] == "corridor")["height"] == pytest.approx(3.0)
    assert [e["id"] for e in d2["exits"]] == ["A", "B", "C"]
    assert next(e for e in d2["exits"] if e["id"] == "B")["blocked"] is True


def test_predict_is_fast_and_monotonic(client):
    a = client.post("/api/predict", json={"corridor_width": 1.5}).json()
    b = client.post("/api/predict", json={"corridor_width": 3.0}).json()
    assert a["predicted_clearance_time"] > 0 and a["latency_ms"] < 2000
    assert b["predicted_clearance_time"] <= a["predicted_clearance_time"]  # wider corridor never slower
    lo = client.post("/api/predict", json={"occupancy": 60}).json()["predicted_clearance_time"]
    hi = client.post("/api/predict", json={"occupancy": 220}).json()["predicted_clearance_time"]
    assert hi >= lo  # more people never faster
    wide = client.post("/api/predict", json={"exit_width": 2.4}).json()["predicted_clearance_time"]
    narrow = client.post("/api/predict", json={"exit_width": 0.9}).json()["predicted_clearance_time"]
    assert wide <= narrow


def test_simulate_basic_invariants(client):
    r = sim(client, occupancy=80)
    assert r["completed"] and r["evacuated"] == r["total_agents"] == 80
    assert 0 < r["average_time"] <= r["clearance_time"] and r["median_time"] <= r["clearance_time"]
    assert r["max_density"] > 0 and r["engine"]["compute_time_s"] > 0
    assert sum(u["count"] for u in r["exit_utilization"].values()) == 80
    assert sum(u["percent"] for u in r["exit_utilization"].values()) == pytest.approx(100, abs=0.5)
    tr = r["trajectories"]
    assert tr["n_agents"] == 80 and len(tr["positions"]) == tr["n_frames"]
    assert len(tr["positions"][0]) == 160
    assert r["timeline"]["evacuated"][-1] == 80
    assert r["density_grid"]["nx"] > 0 and len(r["density_grid"]["peak"]) == r["density_grid"]["ny"]


def test_agents_never_walk_through_walls(client):
    r = sim(client, occupancy=100)
    p = BuildingParams(occupancy=100).normalized()
    env = get_environment(p)
    pos = np.array(r["trajectories"]["positions"]).reshape(r["trajectories"]["n_frames"], -1, 2)
    evac = np.array([np.inf if v is None else v for v in r["agents"]["evac_time"]])
    dt = r["trajectories"]["frame_dt"]
    inside_walls = 0
    for f in range(pos.shape[0]):
        alive = evac > f * dt
        inside_walls += int(env.is_blocked(pos[f][alive]).sum())
    assert inside_walls == 0


def test_agents_actually_move_not_teleport(client):
    r = sim(client, occupancy=100)
    pos = np.array(r["trajectories"]["positions"]).reshape(r["trajectories"]["n_frames"], -1, 2)
    step = np.linalg.norm(np.diff(pos, axis=0), axis=2)
    assert step.max() < 1.0  # at most ~4 m/s equivalent per 0.25 s frame; agents cannot jump


def test_simulation_is_deterministic(client):
    a = sim(client, occupancy=90, seed=5)
    b = sim(client, occupancy=90, seed=5)
    assert a["clearance_time"] == b["clearance_time"] and a["max_density"] == b["max_density"]
    c = sim(client, occupancy=90, seed=6)
    assert c["clearance_time"] != a["clearance_time"] or c["average_time"] != a["average_time"]


def test_corridor_width_changes_result(client):
    narrow = sim(client, corridor_width=1.5)["clearance_time"]
    wide = sim(client, corridor_width=3.0)["clearance_time"]
    assert wide < narrow


def test_occupancy_changes_result(client):
    assert sim(client, occupancy=200)["clearance_time"] > sim(client, occupancy=60)["clearance_time"]


def test_blocked_exit_reroutes_everyone(client):
    base = sim(client)
    blocked = sim(client, blocked_exits=["B"])
    assert blocked["exit_utilization"].keys() == {"A"} and blocked["exit_utilization"]["A"]["count"] == 140
    assert blocked["clearance_time"] > base["clearance_time"]


def test_bottleneck_is_reported_from_measured_fields(client):
    r = sim(client)
    b = r["bottleneck"]
    assert b["label"] and b["region"] is not None and b["score"] > 0
    assert 0 <= b["x"] <= 64 and 0 <= b["y"] <= 40


def test_scenarios_and_reset(client):
    client.post("/api/reset")
    assert client.get("/api/scenarios").json()["scenarios"] == []
    direct = sim(client)
    s1 = client.post("/api/scenario", json={"name": "Baseline", "params": {}}).json()
    s2 = client.post("/api/scenario", json={"name": "Wide", "params": {"corridor_width": 3.0}}).json()
    assert s1["simulation"]["clearance_time"] == direct["clearance_time"]  # stored value == computed value
    assert s2["simulation"]["clearance_time"] < s1["simulation"]["clearance_time"]
    assert s1["prediction"]["predicted_clearance_time"] > 0
    lst = client.get("/api/scenarios").json()["scenarios"]
    assert [s["name"] for s in lst] == ["Baseline", "Wide"]
    m = client.get("/api/metrics").json()
    assert m["scenarios_saved"] == 2 and m["counters"]["simulations"] >= 2
    assert client.post("/api/reset").json()["ok"] is True
    assert client.get("/api/scenarios").json()["scenarios"] == []
    assert client.get("/api/metrics").json()["last_simulation"] is None


def test_model_metrics_come_from_the_real_dataset(client):
    import csv, os
    from ml.generate_dataset import DATASET_PATH
    m = client.get("/api/metrics").json()["model"]
    with open(DATASET_PATH) as fh:
        n = sum(1 for _ in csv.DictReader(fh))
    assert m["n_samples"] == n >= 100
    assert m["n_train"] + m["n_test"] == n
    assert 0 < m["holdout"]["mae_s"] < 60 and m["holdout"]["r2"] > 0.3


def test_invalid_input_rejected(client):
    assert client.post("/api/simulate", json={"occupancy": 5000}).status_code == 422
    assert client.get("/api/building", params={"corridor_width": 99}).status_code == 422


# --------------------------------------------------------------------------- copilot
def test_copilot_rules():
    ci = RuleBasedScenarioInterpreter()
    p = {"occupancy": 140, "corridor_width": 2.0, "exit_width": 1.2, "num_exits": 2, "blocked_exits": []}
    r = ci.interpret("Increase occupancy by 20%", p)
    assert r["actions"][0] == {"type": "set_params", "changes": {"occupancy": 168}}
    r = ci.interpret("Make the corridor wider", p)
    assert r["actions"][0]["changes"] == {"corridor_width": 2.5}
    r = ci.interpret("What happens if the east exit is blocked?", p)
    assert r["actions"][0]["changes"] == {"blocked_exits": ["B"]}
    assert any(a["type"] == "run_simulation" for a in r["actions"])
    assert [a["type"] for a in ci.interpret("run the evacuation", p)["actions"]] == ["run_simulation"]
    assert ci.interpret("tell me a joke about penguins", p)["matched"] is False
    # cannot block a non-existent exit or the last open exit
    assert "does not exist" in ci.interpret("block the west exit", p)["reply"]


# --------------------------------------------------------------------------- engine
def test_engine_interface_and_geometry():
    b = build_geometry(BuildingParams())
    assert b.width == 64 and b.height == 40
    r = LocalSimulationEngine().simulate(BuildingParams(occupancy=30), SimConfig(record=False))
    assert r["completed"] and "trajectories" not in r
