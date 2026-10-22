"""Smart Layout Optimizer: POST /api/optimize/multi plus extra optimizer guarantees.

The predictor is injected (monkeypatched) where a deterministic gradient makes the test
faster and exact; the single validation run is always the REAL multi-floor simulator on
a small, fixed-seed building.
"""
import json

import pytest
from fastapi.testclient import TestClient

import main
import services
from api import routes
from optimization.design_optimizer import LOWER_BOUNDS, UPPER_BOUNDS, OptimizationConfig, optimize_multi_floor
from simulation import MultiFloorParams

WIDTHS = ("corridor_width", "exit_width", "stair_width")
SMALL = {"n_floors": 2, "occupancy": [20, 20], "corridor_width": 1.6, "exit_width": 1.0, "stair_width": 1.2,
         "num_exits": 2, "agent_speed": 1.4, "blocked_exits": ["B"], "blocked_stairs": [[1, "A"]],
         "floor_height": 3.2, "seed": 7}
VALIDATION_KEYS = {"completed", "total_agents", "evacuated", "clearance_time", "average_time", "median_time",
                   "max_density", "bottleneck", "exit_utilization", "compute_time_s"}


def _helpful(params: MultiFloorParams):
    return {"predicted_clearance_time": 200.0 - 8.0 * params.corridor_width
            - 7.0 * params.exit_width - 5.0 * params.stair_width}


def _worsening(params: MultiFloorParams):
    return {"predicted_clearance_time": 50.0 + params.corridor_width + params.exit_width + params.stair_width}


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def real_sim_calls(monkeypatch):
    """Counts real simulate_building() calls made by the optimize route."""
    calls = []
    real = routes.simulate_building

    def counting(mfp, config=None):
        calls.append(mfp)
        return real(mfp, config)

    monkeypatch.setattr(routes, "simulate_building", counting)
    return calls


def _optimize(client, **body):
    r = client.post("/api/optimize/multi", json={"params": SMALL, **body})
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- endpoint
def test_optimize_endpoint_returns_compact_validated_result(client, monkeypatch, real_sim_calls):
    client.post("/api/reset")
    monkeypatch.setattr(services.predictor, "predict_multi", _helpful)
    before = client.get("/api/metrics").json()["counters"]

    d = _optimize(client, widening_budget_m=1.5, max_iterations=6)

    assert len(real_sim_calls) == 1  # exactly one real simulation, of the final layout only
    assert d["optimized_predicted_clearance_time"] < d["baseline_predicted_clearance_time"]
    assert d["predicted_improvement_s"] > 0
    assert set(d["validated_result"]) == VALIDATION_KEYS
    v = d["validated_result"]
    assert v["completed"] and v["evacuated"] == v["total_agents"] == 40 and v["clearance_time"] > 0
    assert isinstance(v["bottleneck"], str)
    raw = json.dumps(d)
    for heavy in ("trajectories", "density_grid", "positions", "timeline", "floors"):
        assert f'"{heavy}":' not in raw
    # No real baseline was simulated for this design, so no real improvement is claimed.
    assert d["baseline_simulated_clearance_time"] is None and d["validated_improvement_s"] is None

    after = client.get("/api/metrics").json()["counters"]
    assert after["optimizations"] == before["optimizations"] + 1
    assert after["multi_floor_simulations"] == before["multi_floor_simulations"] + 1
    assert client.get("/api/scenarios").json()["scenarios"] == []  # saved scenarios untouched


def test_optimize_endpoint_stays_within_budget_and_bounds(client, monkeypatch):
    monkeypatch.setattr(services.predictor, "predict_multi", _helpful)
    d = _optimize(client, widening_budget_m=0.8, max_iterations=10, learning_rate=0.5)

    assert d["budget"]["limit_m"] == 0.8
    assert 0 < d["budget"]["used_m"] <= 0.8 + 1e-6
    added = 0.0
    for i, f in enumerate(WIDTHS):
        new = d["optimized_params"][f]
        assert LOWER_BOUNDS[i] <= new <= UPPER_BOUNDS[i]
        assert new >= SMALL[f] - 1e-9  # never shrinks the original design
        added += new - SMALL[f]
    assert added <= 0.8 + 1e-6
    for step in d["iterations"]:
        assert step["budget_used_m"] <= 0.8 + 1e-6


def test_applying_result_preserves_non_width_parameters(client, monkeypatch):
    monkeypatch.setattr(services.predictor, "predict_multi", _helpful)
    d = _optimize(client, widening_budget_m=1.0)

    # The frontend's applyOptimizedWidths copies only the three widths onto the request.
    applied = {**SMALL, **{f: d["optimized_params"][f] for f in WIDTHS}}
    for key, value in SMALL.items():
        if key not in WIDTHS:
            assert d["optimized_params"][key] == value, key
            assert applied[key] == value, key
    # ...and the applied design is exactly the design that was validated.
    assert MultiFloorParams.from_dict(applied) == MultiFloorParams.from_dict(d["optimized_params"])


def test_no_improvement_returns_original_layout(client, monkeypatch, real_sim_calls):
    monkeypatch.setattr(services.predictor, "predict_multi", _worsening)
    d = _optimize(client, widening_budget_m=3.0)

    for f in WIDTHS:
        assert d["optimized_params"][f] == SMALL[f]
    assert d["budget"]["used_m"] == 0
    assert d["predicted_improvement_s"] == 0
    assert d["stop_reason"] == "no improving feasible step"
    assert len(real_sim_calls) == 1 and d["validated_result"]["completed"]


def test_validated_improvement_uses_an_existing_real_baseline(client, monkeypatch):
    client.post("/api/reset")
    monkeypatch.setattr(services.predictor, "predict_multi", _helpful)
    base = client.post("/api/simulate/multi", json={**SMALL, "record": False}).json()

    d = _optimize(client, widening_budget_m=1.0)

    assert d["baseline_simulated_clearance_time"] == base["clearance_time"]
    expected = round(base["clearance_time"] - d["validated_result"]["clearance_time"], 2)
    assert d["validated_improvement_s"] == pytest.approx(expected)


@pytest.mark.parametrize("body", [
    {"widening_budget_m": -0.5},
    {"widening_budget_m": 10.5},
    {"max_iterations": 0},
    {"max_iterations": 31},
    {"learning_rate": 0},
    {"learning_rate": 2.0},
    {"params": {**SMALL, "corridor_width": 9.0}},
    {"params": {**SMALL, "n_floors": 0}},
])
def test_invalid_optimizer_settings_are_rejected(client, real_sim_calls, body):
    r = client.post("/api/optimize/multi", json={"params": SMALL, **body})
    assert r.status_code == 422
    assert real_sim_calls == []


def test_optimize_endpoint_with_real_predictor(client):
    """Smoke test of the real ML predictor path: legal, bounded, deterministic output."""
    body = {"params": SMALL, "widening_budget_m": 1.0, "max_iterations": 3}
    first = client.post("/api/optimize/multi", json=body).json()
    second = client.post("/api/optimize/multi", json=body).json()

    assert first["budget"]["used_m"] <= 1.0 + 1e-6
    assert first["optimized_predicted_clearance_time"] <= first["baseline_predicted_clearance_time"]
    assert set(first["validated_result"]) == VALIDATION_KEYS
    assert first["optimized_params"] == second["optimized_params"]  # fixed seed -> same answer
    assert first["validated_result"]["clearance_time"] == second["validated_result"]["clearance_time"]


# --------------------------------------------------------------------------- unit
def test_optimizer_clips_at_upper_bounds_and_respects_weighted_costs():
    base = MultiFloorParams(n_floors=2, occupancy=(50, 50), corridor_width=5.9, exit_width=3.9, stair_width=1.0)
    settings = OptimizationConfig(widening_budget_m=4.0, max_iterations=30, learning_rate=0.5, stair_cost_per_m=2.0)

    result = optimize_multi_floor(base, _helpful, settings)

    widths = [result["optimized_params"][f] for f in WIDTHS]
    for i, w in enumerate(widths):
        assert LOWER_BOUNDS[i] <= w <= UPPER_BOUNDS[i] + 1e-9
    added = [w - getattr(base, f) for w, f in zip(widths, WIDTHS)]
    assert all(a >= -1e-9 for a in added)
    weighted = added[0] * 1.0 + added[1] * 1.0 + added[2] * 2.0
    assert weighted <= settings.widening_budget_m + 1e-6
    assert result["budget"]["used_m"] == pytest.approx(weighted, abs=1e-3)
