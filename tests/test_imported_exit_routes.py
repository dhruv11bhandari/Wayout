import numpy as np
import pytest

from building.imported_design import _building_from_json
from building import BuildingParams
from simulation import LocalSimulationEngine, SimConfig
from simulation.navigation import Environment


def solid_walled_plan():
    return {
        "width": 12,
        "height": 10,
        "wall_thickness": 0.2,
        "walls": [
            {"x1": 0, "y1": 0, "x2": 12, "y2": 0, "kind": "outer"},
            {"x1": 0, "y1": 10, "x2": 12, "y2": 10, "kind": "outer"},
            {"x1": 0, "y1": 0, "x2": 0, "y2": 10, "kind": "outer"},
            {"x1": 12, "y1": 0, "x2": 12, "y2": 10, "kind": "outer"},
        ],
        "rooms": [{"id": "hall", "name": "Hall", "x": 0.5, "y": 0.5, "width": 11, "height": 9}],
        "exits": [{"id": "A", "label": "North Exit", "x": 6, "y": 0, "width": 1.2, "orientation": "N"}],
        "obstacles": [{"id": "cabinet", "x": 5.8, "y": 0.1, "width": 0.4, "height": 0.2, "label": "Cabinet"}],
    }


def test_imported_exit_cuts_solid_perimeter_and_clears_outside_apron():
    building = _building_from_json(solid_walled_plan()).building
    env = Environment(building)

    # The model's continuous north wall is split around the extracted doorway.
    assert all(not (w.y1 == 0 and min(w.x1, w.x2) < 6.6 and max(w.x1, w.x2) > 5.4) for w in building.walls)
    assert not building.obstacles
    assert not env.is_blocked(np.array([[6.0, 0.05], [6.0, -0.6]])).any()
    assert np.isfinite(env.D).any(axis=0)[env.nav_free].all()


def test_agents_can_evacuate_through_imported_exit():
    building = _building_from_json(solid_walled_plan()).building
    result = LocalSimulationEngine().simulate(
        BuildingParams(occupancy=12, seed=17),
        SimConfig(record=False, max_time=120, max_reaction_delay=0),
        building_override=building,
    )

    assert result["completed"]
    assert result["evacuated"] == result["total_agents"] == 12
    assert result["exit_utilization"]["A"]["count"] == 12


def test_imported_disconnected_walkable_area_is_rejected():
    data = solid_walled_plan()
    data["walls"].append({"x1": 6, "y1": 0, "x2": 6, "y2": 10, "kind": "wall"})
    data["exits"][0]["x"] = 3
    # A full internal wall with no door creates a second area with no exit route.
    data["rooms"] = [
        {"id": "left", "name": "Left", "x": 0.5, "y": 0.5, "width": 5.2, "height": 9},
        {"id": "right", "name": "Right", "x": 6.3, "y": 0.5, "width": 5.2, "height": 9},
    ]
    with pytest.raises(ValueError, match="no path to any exit"):
        _building_from_json(data)
