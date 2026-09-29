"""Abstraction layer so the prototype's components can be swapped for NVIDIA ones.

    SimulationEngine     LocalSimulationEngine (CPU, NumPy)   ->  CudaSimulationEngine (future)
    PredictionModel      LocalMLPredictionModel (scikit-learn) ->  GPU-trained surrogate (future)
    ScenarioInterpreter  RuleBasedScenarioInterpreter          ->  NemotronScenarioInterpreter (future)
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from building import BuildingParams


class SimulationEngine(ABC):
    name: str = "abstract"

    @abstractmethod
    def simulate(self, params: BuildingParams, config: Optional[Any] = None) -> Dict[str, Any]:
        """Run an evacuation and return metrics, trajectories and density grids."""


class PredictionModel(ABC):
    name: str = "abstract"

    @abstractmethod
    def predict(self, params: BuildingParams) -> Dict[str, Any]:
        """Return {'predicted_clearance_time': seconds, ...} without running a simulation."""

    def predict_multi(self, mfp: Any) -> Dict[str, Any]:
        """Multi-floor counterpart of `predict()`: whole-building clearance time for a
        `simulation.MultiFloorParams` design, again without running a simulation.
        Optional (not `@abstractmethod`) so a prediction model need not support
        multi-floor designs to be usable; `LocalMLPredictionModel` does."""
        raise NotImplementedError

    @abstractmethod
    def info(self) -> Dict[str, Any]:
        """Model metadata and real (held-out) training metrics."""


class ScenarioInterpreter(ABC):
    name: str = "abstract"

    @abstractmethod
    def interpret(self, text: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Turn a natural-language request into structured UI actions."""
