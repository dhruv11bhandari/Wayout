"""Placeholder for the future GPU implementation. NOT implemented in this prototype."""
from __future__ import annotations

from interfaces import SimulationEngine


class CudaSimulationEngine(SimulationEngine):
    name = "CudaSimulationEngine"

    def simulate(self, params, config=None):
        raise NotImplementedError(
            "CUDA simulation is not part of this prototype. "
            "Implement SimulationEngine.simulate() on the GPU and register it in services.py."
        )
