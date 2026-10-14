"""Copilot provider abstraction.

    CopilotProvider            == interfaces.ScenarioInterpreter (same contract)
    FallbackCopilotProvider     -> copilot.RuleBasedScenarioInterpreter (real, working today)
    NemotronCopilotProvider     -> NVIDIA Nemotron (stub; NOT implemented in this prototype)

This module only renames/wires things to match the NVIDIA-integration shape described in
the product brief - `copilot.py` already has the real, tested rule-based interpreter and
the Nemotron stub; this is where a real Nemotron client would eventually get plugged in
and selected, the same way `CUDA_ENABLED` gates `simulation/cuda_engine.py`.
"""
from __future__ import annotations

import os
from typing import Any, Dict

from copilot import RuleBasedScenarioInterpreter
from interfaces import ScenarioInterpreter

CopilotProvider = ScenarioInterpreter


class FallbackCopilotProvider(RuleBasedScenarioInterpreter):
    """The rule-based interpreter under the name the NVIDIA-integration docs use.

    This is genuinely what answers every copilot request today - not a placeholder.
    """
    name = "FallbackCopilotProvider"


class NemotronCopilotProvider(ScenarioInterpreter):
    """LLM-backed copilot via NVIDIA Nemotron. NOT implemented in this prototype."""
    name = "NemotronCopilotProvider"

    def __init__(self) -> None:
        self.endpoint = os.environ.get("NEMOTRON_ENDPOINT", "")
        self.model = os.environ.get("NEMOTRON_MODEL", "")
        self.has_key = bool(os.environ.get("NEMOTRON_API_KEY"))

    def interpret(self, text: str, params: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError(
            "NVIDIA Nemotron is not wired up in this prototype. Implement "
            "ScenarioInterpreter.interpret() against NEMOTRON_ENDPOINT / NEMOTRON_MODEL "
            "(auth via NEMOTRON_API_KEY) and register it in services.py. It must return the "
            "same {reply, actions[]} structure as FallbackCopilotProvider, and it must not "
            "invent simulation numbers - only narrate results the simulator/ML model produced."
        )


def nemotron_enabled() -> bool:
    return os.environ.get("NEMOTRON_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")


def select_copilot_provider() -> ScenarioInterpreter:
    """Mirrors `simulation.select_simulation_engine`: only switches away from the working
    fallback once a real Nemotron endpoint and key are actually configured, and even then
    only once `NemotronCopilotProvider.interpret` is implemented (it currently raises)."""
    if nemotron_enabled():
        provider = NemotronCopilotProvider()
        if provider.endpoint and provider.has_key:
            return provider
    return FallbackCopilotProvider()
