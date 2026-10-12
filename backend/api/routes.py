"""REST API. All numbers returned come from the local simulator / trained model."""
from __future__ import annotations

import json
import time
from dataclasses import replace
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

import services
from ai.recommend import recommend_multi_floor, recommend_single_floor
from building import BuildingParams
from simulation import MultiFloorParams, SimConfig, default_multi_floor, simulate_building
from simulation.agents import spawn_agents
from simulation.multi_floor import stair_landing_points
from simulation.navigation import get_environment

router = APIRouter()
VERSION = "0.2.0"
_uploaded_designs: Dict[str, Any] = {}


class ImportedSimulationIn(BaseModel):
    design_id: str
    occupancy: int = Field(140, ge=10, le=400)
    agent_speed: float = Field(1.3, ge=0.5, le=2.0)
    seed: int = 42
    record: bool = True


class ParamsIn(BaseModel):
    occupancy: int = Field(140, ge=10, le=400)
    corridor_width: float = Field(2.0, ge=0.8, le=6.0)
    exit_width: float = Field(1.2, ge=0.6, le=4.0)
    num_exits: int = Field(2, ge=1, le=4)
    agent_speed: float = Field(1.3, ge=0.5, le=2.0)
    blocked_exits: List[str] = Field(default_factory=list)
    seed: int = 42

    def to_params(self) -> BuildingParams:
        return BuildingParams(
            occupancy=self.occupancy, corridor_width=self.corridor_width, exit_width=self.exit_width,
            num_exits=self.num_exits, agent_speed=self.agent_speed,
            blocked_exits=tuple(self.blocked_exits), seed=self.seed).normalized()


class SimulateIn(ParamsIn):
    record: bool = True


class ScenarioIn(BaseModel):
    name: str = "Scenario"
    params: ParamsIn = Field(default_factory=ParamsIn)


class CopilotIn(BaseModel):
    text: str
    params: ParamsIn = Field(default_factory=ParamsIn)
    multi_params: Optional["MultiFloorParamsIn"] = None


class MultiFloorParamsIn(BaseModel):
    n_floors: int = Field(3, ge=1, le=6)
    occupancy: List[int] = Field(default_factory=lambda: [167, 167, 166])
    corridor_width: float = Field(2.0, ge=0.8, le=6.0)
    exit_width: float = Field(1.2, ge=0.6, le=4.0)
    stair_width: float = Field(1.5, ge=0.6, le=4.0)
    num_exits: int = Field(2, ge=1, le=4)
    agent_speed: float = Field(1.3, ge=0.5, le=2.0)
    blocked_exits: List[str] = Field(default_factory=list)
    blocked_stairs: List[Tuple[int, str]] = Field(default_factory=list)
    floor_height: float = Field(3.5, ge=2.4, le=6.0)
    seed: int = 42

    def to_params(self) -> MultiFloorParams:
        return MultiFloorParams.from_dict(self.model_dump())


class SimulateMultiIn(MultiFloorParamsIn):
    record: bool = True


class RecommendIn(BaseModel):
    params: ParamsIn = Field(default_factory=ParamsIn)


class RecommendMultiIn(BaseModel):
    params: MultiFloorParamsIn = Field(default_factory=MultiFloorParamsIn)


class PredictMultiIn(BaseModel):
    params: MultiFloorParamsIn = Field(default_factory=MultiFloorParamsIn)


CopilotIn.model_rebuild()


def _key(p: BuildingParams) -> str:
    return json.dumps(p.to_dict(), sort_keys=True)


def _mkey(mfp: MultiFloorParams) -> str:
    return json.dumps(mfp.to_dict(), sort_keys=True)


def _json(payload: Any) -> Response:
    return Response(content=json.dumps(payload, separators=(",", ":")), media_type="application/json")


def building_payload(p: BuildingParams, label_prefix: str = "Exit") -> Dict[str, Any]:
    env = get_environment(p, label_prefix)
    spawn = spawn_agents(env.building, p)
    d = env.building.to_dict()  # deep copy; cached geometry stays untouched
    for r in d["rooms"]:
        r["occupancy"] = spawn.room_counts.get(r["id"], 0)
    d["initial_agents"] = [{"id": i, "x": round(float(x), 2), "y": round(float(y), 2), "zone": z}
                           for i, ((x, y), z) in enumerate(zip(spawn.xy, spawn.zone))]
    if not hasattr(env, "_paths"):
        env._paths = env.evac_paths()
    d["paths"] = env._paths
    d["params"] = p.to_dict()
    d["meta"]["circulation_counts"] = {"corridor": spawn.room_counts.get("corridor", 0),
                                       "lobby": spawn.room_counts.get("lobby", 0)}
    return d


def multi_building_payload(mfp: MultiFloorParams) -> Dict[str, Any]:
    floors = []
    for i in range(mfp.n_floors):
        fp = mfp.floor_params(i)
        payload = building_payload(fp, "Exit" if i == 0 else "Stair")
        payload["floor"] = i
        payload["role"] = "ground" if i == 0 else "upper"
        floors.append(payload)
    landing = stair_landing_points(mfp)
    return {
        "n_floors": mfp.n_floors, "floor_height": mfp.floor_height,
        "stair_landing_points": {k: list(v) for k, v in landing.items()},
        "floors": floors, "params": mfp.to_dict(),
    }


@router.get("/health")
def health() -> Dict[str, Any]:
    info = services.runtime_info()
    return {
        "status": "ok", "service": "wayout", "version": VERSION, "mode": "local-cpu",
        "model_ready": services.predictor.ready(),
        "engine": services.engine.name, "predictor": services.predictor.name,
        "copilot": services.interpreter.name,
        "nvidia_components": {"cuda_engine": info["cuda_active"], "nemotron": info["nemotron_active"], "nebius": False},
    }


@router.get("/config")
def config() -> Dict[str, Any]:
    """What's actually running right now - never claims GPU/Nemotron are active unless they are."""
    return services.runtime_info()


@router.post("/design/parse")
async def parse_design(file: UploadFile = File(...)):
    """Extract a one-floor raster/PDF plan with the configured vision model."""
    from uuid import uuid4
    from building.imported_design import building_to_payload, parse_uploaded_plan

    raw = await file.read(20 * 1024 * 1024 + 1)
    try:
        plan = parse_uploaded_plan(file.filename or "floor-plan", file.content_type or "", raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    design_id = uuid4().hex
    _uploaded_designs[design_id] = plan.building
    return {"design_id": design_id, "source_name": file.filename or "floor plan",
            "uncertainties": plan.uncertainties,
            "building": {"n_floors": 1, "floor_height": 3.5, "stair_landing_points": {},
                         "floors": [building_to_payload(plan.building)],
                         "params": {"n_floors": 1, "occupancy": [140], "floor_height": 3.5}}}


@router.post("/design/simulate")
def simulate_design(req: ImportedSimulationIn):
    building = _uploaded_designs.get(req.design_id)
    if building is None:
        raise HTTPException(404, "This uploaded design has expired. Upload it again.")
    p = BuildingParams(occupancy=req.occupancy, agent_speed=req.agent_speed, seed=req.seed,
                       num_exits=min(4, max(1, len(building.exits)))).normalized()
    try:
        result = services.engine.simulate(p, SimConfig(record=req.record), building_override=building)
    except (ValueError, IndexError) as exc:
        raise HTTPException(422, f"This extracted floor plan cannot be simulated: {exc}") from exc
    return _json({
        "params": {"n_floors": 1, "occupancy": [req.occupancy], "floor_height": 3.5,
                   "corridor_width": p.corridor_width, "exit_width": p.exit_width, "stair_width": 1.5,
                   "num_exits": len(building.exits), "agent_speed": p.agent_speed,
                   "blocked_exits": [], "blocked_stairs": [], "seed": p.seed},
        "n_floors": 1, "completed": result["completed"], "total_agents": result["total_agents"],
        "evacuated": result["evacuated"], "clearance_time": result["clearance_time"],
        "average_time": result["average_time"], "median_time": result["median_time"],
        "max_density": result["max_density"], "bottleneck": result["bottleneck"],
        "bottlenecks_by_floor": [{**result["bottleneck"], "floor": 0}],
        "exit_utilization": result["exit_utilization"], "timeline": result["timeline"],
        "floors": [result], "floor_height": 3.5, "stair_descent_speed": 0.6,
        "stair_landing_points": {},
        "engine": {"name": result["engine"]["name"], "per_floor_engine": result["engine"]["name"],
                   "device": "CPU (NumPy)", "compute_time_s": result["engine"]["compute_time_s"]},
    })


@router.get("/building")
def get_building(occupancy: int = Query(140, ge=10, le=400), corridor_width: float = Query(2.0, ge=0.8, le=6.0),
                 exit_width: float = Query(1.2, ge=0.6, le=4.0), num_exits: int = Query(2, ge=1, le=4),
                 agent_speed: float = Query(1.3, ge=0.5, le=2.0), blocked_exits: str = "", seed: int = 42):
    blocked = [b for b in blocked_exits.replace(" ", "").split(",") if b]
    p = ParamsIn(occupancy=occupancy, corridor_width=corridor_width, exit_width=exit_width, num_exits=num_exits,
                 agent_speed=agent_speed, blocked_exits=blocked, seed=seed).to_params()
    return _json(building_payload(p))


@router.get("/building/multi")
def get_building_multi(n_floors: int = Query(3, ge=1, le=6), occupancy_total: int = Query(500, ge=30, le=2400),
                       corridor_width: float = Query(2.0, ge=0.8, le=6.0), exit_width: float = Query(1.2, ge=0.6, le=4.0),
                       stair_width: float = Query(1.5, ge=0.6, le=4.0), num_exits: int = Query(2, ge=1, le=4),
                       agent_speed: float = Query(1.3, ge=0.5, le=2.0), floor_height: float = Query(3.5, ge=2.4, le=6.0),
                       blocked_exits: str = "", seed: int = 42):
    base = default_multi_floor(occupancy_total, n_floors)
    blocked = tuple(b for b in blocked_exits.replace(" ", "").split(",") if b)
    mfp = replace(base, corridor_width=corridor_width, exit_width=exit_width, stair_width=stair_width,
                 num_exits=num_exits, agent_speed=agent_speed, floor_height=floor_height,
                 blocked_exits=blocked, seed=seed).normalized()
    return _json(multi_building_payload(mfp))


@router.post("/predict")
def predict(req: ParamsIn) -> Dict[str, Any]:
    p = req.to_params()
    out = services.predictor.predict(p)
    out["params"] = p.to_dict()
    with services.state.lock:
        services.state.counters["predictions"] += 1
    return out


@router.post("/predict/multi")
def predict_multi(req: PredictMultiIn) -> Dict[str, Any]:
    """Fast surrogate prediction of WHOLE-BUILDING clearance time for a multi-floor
    design (n_floors, floor_height and every floor's occupancy all feed the model) -
    no simulation is run. The multi-floor counterpart of POST /predict."""
    mfp = req.params.to_params()
    out = services.predictor.predict_multi(mfp)
    out["params"] = mfp.to_dict()
    with services.state.lock:
        services.state.counters["predictions"] += 1
    return out


@router.post("/simulate")
def simulate(req: SimulateIn):
    p = req.to_params()
    result = services.engine.simulate(p, SimConfig(record=req.record))
    summary = services.summarize(result)
    with services.state.lock:
        services.state.sim_cache[_key(p)] = summary
        services.state.last_simulation = summary
        services.state.counters["simulations"] += 1
    return _json(result)


@router.post("/simulate/multi")
def simulate_multi(req: SimulateMultiIn):
    mfp = req.to_params()
    result = simulate_building(mfp, SimConfig(record=req.record))
    summary = services.summarize_multi(result)
    with services.state.lock:
        services.state.multi_floor_cache[_mkey(mfp)] = summary
        services.state.last_multi_floor = summary
        services.state.counters["multi_floor_simulations"] += 1
    return _json(result)


@router.post("/recommend")
def recommend(req: RecommendIn) -> Dict[str, Any]:
    p = req.params.to_params()
    with services.state.lock:
        summary = services.state.sim_cache.get(_key(p))
    if summary is None:
        result = services.engine.simulate(p, SimConfig(record=False))
        summary = services.summarize(result)
        with services.state.lock:
            services.state.sim_cache[_key(p)] = summary
            services.state.counters["simulations"] += 1
    return {"recommendations": recommend_single_floor(p, summary), "baseline": {
        "clearance_time": summary["clearance_time"], "bottleneck": summary["bottleneck"]["label"]}}


@router.post("/recommend/multi")
def recommend_multi(req: RecommendMultiIn) -> Dict[str, Any]:
    mfp = req.params.to_params()
    with services.state.lock:
        summary = services.state.multi_floor_cache.get(_mkey(mfp))
    if summary is None:
        result = simulate_building(mfp, SimConfig(record=False))
        summary = services.summarize_multi(result)
        with services.state.lock:
            services.state.multi_floor_cache[_mkey(mfp)] = summary
            services.state.counters["multi_floor_simulations"] += 1
    return {"recommendations": recommend_multi_floor(mfp, summary), "baseline": {
        "clearance_time": summary["clearance_time"], "bottleneck": summary["bottleneck"]["label"]}}


@router.post("/scenario")
def save_scenario(req: ScenarioIn) -> Dict[str, Any]:
    p = req.params.to_params()
    with services.state.lock:
        summary = services.state.sim_cache.get(_key(p))
    if summary is None:  # never store numbers we did not compute
        result = services.engine.simulate(p, SimConfig(record=False))
        summary = services.summarize(result)
        with services.state.lock:
            services.state.sim_cache[_key(p)] = summary
            services.state.counters["simulations"] += 1
    prediction = services.predictor.predict(p)
    slim = {k: summary[k] for k in ("clearance_time", "average_time", "median_time", "max_density", "avg_speed",
                                    "congestion_duration", "completed", "exit_utilization")}
    slim["bottleneck"] = summary["bottleneck"]["label"]
    pred = {"predicted_clearance_time": prediction["predicted_clearance_time"],
            "expected_error_s": prediction["expected_error_s"]}
    return services.state.scenarios.add(req.name, p.to_dict(), pred, slim)


@router.get("/scenarios")
def list_scenarios() -> Dict[str, Any]:
    return {"scenarios": services.state.scenarios.list()}


@router.delete("/scenarios/{sid}")
def delete_scenario(sid: int) -> Dict[str, Any]:
    if not services.state.scenarios.delete(sid):
        raise HTTPException(404, "scenario not found")
    return {"ok": True}


@router.get("/metrics")
def metrics() -> Dict[str, Any]:
    st = services.state
    return {
        "last_simulation": st.last_simulation,
        "last_multi_floor": st.last_multi_floor,
        "model": services.predictor.info(),
        "engine": {"name": services.engine.name, "device": "CPU (NumPy)"},
        "counters": dict(st.counters),
        "scenarios_saved": len(st.scenarios.list()),
    }


@router.post("/reset")
def reset() -> Dict[str, Any]:
    services.state.reset()
    return {"ok": True, "message": "Scenarios and cached results cleared."}


@router.post("/copilot")
def copilot(req: CopilotIn) -> Dict[str, Any]:
    return services.interpreter.interpret(req.text, req.params.model_dump())
