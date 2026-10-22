"""Service registry: swap implementations here (CUDA engine, GPU surrogate, Nemotron).

Both `SimulationEngine` and `ScenarioInterpreter` are selected through small gates
(`select_simulation_engine` / `ai.copilot_provider.select_copilot_provider`) driven by
environment variables (`CUDA_ENABLED`, `NEMOTRON_ENABLED`). Both gates only ever pick a
NotImplemented stub if that stub is actually usable; today neither is, so both always
resolve to the real local implementations. This means flipping the env vars on in a
half-configured environment can never break a running server - see the module docstrings
in `simulation/cuda_engine.py` and `ai/copilot_provider.py`.
"""
from __future__ import annotations

import os
import threading
from typing import Any, Dict, Optional

from ai.copilot_provider import select_copilot_provider
from interfaces import PredictionModel, ScenarioInterpreter, SimulationEngine
from ml.predict import LocalMLPredictionModel
from scenarios import ScenarioStore
from simulation import LocalSimulationEngine
from simulation.cuda_engine import CudaSimulationEngine


def cuda_enabled() -> bool:
    return os.environ.get("CUDA_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")


def select_simulation_engine() -> SimulationEngine:
    """CUDA_ENABLED=true would select CudaSimulationEngine once it is actually
    implemented (it currently raises NotImplementedError on first use). Until then this
    always returns the real, working LocalSimulationEngine - never a stub that would
    break the first request."""
    if cuda_enabled():
        try:
            candidate = CudaSimulationEngine()
            candidate.simulate  # noqa: B018 - would need a real availability probe here
            # No real GPU probe exists in this prototype: fall through to Local rather
            # than risk selecting an engine whose .simulate() is guaranteed to raise.
        except Exception:
            pass
    return LocalSimulationEngine()


engine: SimulationEngine = select_simulation_engine()
predictor: PredictionModel = LocalMLPredictionModel()
interpreter: ScenarioInterpreter = select_copilot_provider()


class AppState:
    """Process-wide state: saved scenarios, simulation summary cache, counters."""

    def __init__(self) -> None:
        self.scenarios = ScenarioStore()
        self.sim_cache: Dict[str, Dict[str, Any]] = {}
        self.last_simulation: Optional[Dict[str, Any]] = None
        self.last_multi_floor: Optional[Dict[str, Any]] = None
        self.multi_floor_cache: Dict[str, Dict[str, Any]] = {}
        self.progress: Dict[str, Dict[str, Any]] = {}  # run_id -> latest live snapshot of a running simulation
        self.counters = {"simulations": 0, "predictions": 0, "multi_floor_simulations": 0, "optimizations": 0}
        self.lock = threading.Lock()

    def reset(self) -> None:
        with self.lock:
            self.scenarios.clear()
            self.sim_cache.clear()
            self.multi_floor_cache.clear()
            self.last_simulation = None
            self.last_multi_floor = None
            self.counters = {"simulations": 0, "predictions": 0, "multi_floor_simulations": 0, "optimizations": 0}


state = AppState()

HEAVY_KEYS = ("trajectories", "agents", "density_grid")


def summarize(result: Dict[str, Any]) -> Dict[str, Any]:
    """Result without the heavy animation payloads (for caches / scenarios / metrics)."""
    s = {k: v for k, v in result.items() if k not in HEAVY_KEYS}
    tl = s.get("timeline")
    if tl:  # keep the curve but thin it out
        s["timeline"] = {"t": tl["t"], "evacuated": tl["evacuated"]}
    return s


def summarize_multi(result: Dict[str, Any]) -> Dict[str, Any]:
    """Multi-floor result without any floor's heavy animation payload."""
    s = {k: v for k, v in result.items() if k != "floors"}
    s["floors"] = [summarize(f) for f in result.get("floors", [])]
    return s


def runtime_info() -> Dict[str, Any]:
    """What's actually active right now - surfaced at GET /api/config for the frontend's
    NVIDIA-architecture section and mode badges. Never implies GPU/Nemotron are active
    unless they truly are."""
    return {
        "simulation_engine": engine.name,
        "prediction_model": predictor.name,
        "copilot_provider": interpreter.name,
        "cuda_enabled": cuda_enabled(),
        "cuda_active": engine.name == "CudaSimulationEngine",
        "nemotron_enabled": interpreter.name == "NemotronCopilotProvider",
        "nemotron_active": interpreter.name == "NemotronCopilotProvider",
        "nemotron_design_available": bool(os.environ.get("NEMOTRON_API_KEY", "").strip()),
    }
