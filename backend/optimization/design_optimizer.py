"""Surrogate-assisted projected gradient descent for parametric multi-floor designs.

The full pedestrian simulation includes grid routing, discrete exit changes, and crowd
contacts, so it is not smooth enough for reliable direct differentiation. This module
uses the fast predictor to estimate numerical gradients, constrains each candidate to
legal building widths and a widening budget, then optionally validates the winner with
the real simulation.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Callable, Dict, Mapping, Optional

import numpy as np

from simulation.multi_floor import MultiFloorParams


WIDTH_FIELDS = ("corridor_width", "exit_width", "stair_width")
LOWER_BOUNDS = np.array([0.8, 0.6, 0.6], dtype=float)
UPPER_BOUNDS = np.array([6.0, 4.0, 4.0], dtype=float)

Predictor = Callable[[MultiFloorParams], Mapping[str, Any]]
Validator = Callable[[MultiFloorParams], Mapping[str, Any]]


@dataclass(frozen=True)
class OptimizationConfig:
    """Controls a width-only optimization run.

    ``widening_budget_m`` is measured in weighted metre-equivalents. By default, one
    metre added to a corridor, exit, or stair consumes one metre of the budget. The
    cost weights let a caller later model that widening stairs, for example, is more
    expensive than widening an exit.
    """

    widening_budget_m: float = 2.0
    max_iterations: int = 12
    learning_rate: float = 0.10
    finite_difference_m: float = 0.05
    min_improvement_s: float = 0.01
    corridor_cost_per_m: float = 1.0
    exit_cost_per_m: float = 1.0
    stair_cost_per_m: float = 1.0

    def __post_init__(self) -> None:
        if self.widening_budget_m < 0:
            raise ValueError("widening_budget_m cannot be negative.")
        if self.max_iterations < 1:
            raise ValueError("max_iterations must be at least 1.")
        if self.learning_rate <= 0 or self.finite_difference_m <= 0:
            raise ValueError("learning_rate and finite_difference_m must be positive.")
        if self.min_improvement_s < 0:
            raise ValueError("min_improvement_s cannot be negative.")
        if min(self.costs) <= 0:
            raise ValueError("All width costs must be positive.")

    @property
    def costs(self) -> np.ndarray:
        return np.array(
            [self.corridor_cost_per_m, self.exit_cost_per_m, self.stair_cost_per_m],
            dtype=float,
        )


def _width_vector(params: MultiFloorParams) -> np.ndarray:
    return np.array([getattr(params, field) for field in WIDTH_FIELDS], dtype=float)


def _with_widths(params: MultiFloorParams, widths: np.ndarray) -> MultiFloorParams:
    changes = {field: float(value) for field, value in zip(WIDTH_FIELDS, widths)}
    return replace(params, **changes).normalized()


def _predict_clearance(predict: Predictor, params: MultiFloorParams) -> float:
    response = predict(params)
    try:
        predicted_time = float(response["predicted_clearance_time"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("The predictor must return a numeric predicted_clearance_time.") from exc
    if not np.isfinite(predicted_time) or predicted_time <= 0:
        raise ValueError("The predictor returned an invalid predicted_clearance_time.")
    return predicted_time


def _project_widths(
    proposed: np.ndarray,
    starting: np.ndarray,
    config: OptimizationConfig,
) -> np.ndarray:
    """Keep widths legal, never shrink the base design, and enforce the budget."""
    bounded = np.clip(proposed, LOWER_BOUNDS, UPPER_BOUNDS)
    widening = np.maximum(bounded - starting, 0.0)
    weighted_widening = float(np.dot(widening, config.costs))
    if weighted_widening > config.widening_budget_m and weighted_widening > 0:
        widening *= config.widening_budget_m / weighted_widening
    return starting + widening


def _gradient(
    params: MultiFloorParams,
    widths: np.ndarray,
    predict: Predictor,
    config: OptimizationConfig,
) -> np.ndarray:
    """Estimate d(predicted clearance time)/d(width) using central differences."""
    gradient = np.zeros(len(WIDTH_FIELDS), dtype=float)
    for index in range(len(WIDTH_FIELDS)):
        lower = max(LOWER_BOUNDS[index], widths[index] - config.finite_difference_m)
        upper = min(UPPER_BOUNDS[index], widths[index] + config.finite_difference_m)
        if upper - lower < 1e-9:
            continue
        lower_widths = widths.copy()
        upper_widths = widths.copy()
        lower_widths[index] = lower
        upper_widths[index] = upper
        lower_time = _predict_clearance(predict, _with_widths(params, lower_widths))
        upper_time = _predict_clearance(predict, _with_widths(params, upper_widths))
        gradient[index] = (upper_time - lower_time) / (upper - lower)
    return gradient


def _trace_entry(
    iteration: int,
    widths: np.ndarray,
    predicted_time: float,
    gradient: Optional[np.ndarray],
    starting: np.ndarray,
    config: OptimizationConfig,
) -> Dict[str, Any]:
    widening = np.maximum(widths - starting, 0.0)
    return {
        "iteration": iteration,
        "params": {field: round(float(value), 3) for field, value in zip(WIDTH_FIELDS, widths)},
        "predicted_clearance_time": round(predicted_time, 3),
        "gradient_s_per_m": (
            {field: round(float(value), 4) for field, value in zip(WIDTH_FIELDS, gradient)}
            if gradient is not None else None
        ),
        "budget_used_m": round(float(np.dot(widening, config.costs)), 3),
    }


def optimize_multi_floor(
    params: MultiFloorParams,
    predict: Predictor,
    config: Optional[OptimizationConfig] = None,
    validate: Optional[Validator] = None,
) -> Dict[str, Any]:
    """Minimize predicted clearance time by widening feasible egress dimensions.

    The predictor is injected rather than imported from ``services``. That keeps this
    module independent of FastAPI state and makes its calculus behavior easy to test.
    When supplied, ``validate`` runs only once for the final candidate, avoiding costly
    repeated full simulations during the gradient search.
    """
    settings = config or OptimizationConfig()
    base = params.normalized()
    starting = _width_vector(base)
    current = starting.copy()
    current_time = _predict_clearance(predict, base)
    baseline_time = current_time
    trace = [_trace_entry(0, current, current_time, None, starting, settings)]
    stop_reason = "maximum iterations reached"

    for iteration in range(1, settings.max_iterations + 1):
        gradient = _gradient(base, current, predict, settings)
        step_size = settings.learning_rate
        accepted = False

        for _ in range(8):
            proposed = _project_widths(current - step_size * gradient, starting, settings)
            if np.allclose(proposed, current, atol=1e-9):
                break
            proposed_params = _with_widths(base, proposed)
            proposed_time = _predict_clearance(predict, proposed_params)
            if proposed_time <= current_time - settings.min_improvement_s:
                current, current_time = proposed, proposed_time
                trace.append(_trace_entry(iteration, current, current_time, gradient, starting, settings))
                accepted = True
                break
            step_size *= 0.5

        if not accepted:
            stop_reason = "no improving feasible step"
            break
        if np.isclose(float(np.dot(np.maximum(current - starting, 0.0), settings.costs)), settings.widening_budget_m):
            stop_reason = "widening budget exhausted"
            break

    optimized = _with_widths(base, current)
    result: Dict[str, Any] = {
        "baseline_predicted_clearance_time": round(baseline_time, 3),
        "optimized_predicted_clearance_time": round(current_time, 3),
        "predicted_improvement_s": round(baseline_time - current_time, 3),
        "predicted_improvement_pct": round(
            100.0 * (baseline_time - current_time) / baseline_time,
            2,
        ),
        "optimized_params": optimized.to_dict(),
        "iterations": trace,
        "stop_reason": stop_reason,
        "budget": {
            "limit_m": settings.widening_budget_m,
            "used_m": trace[-1]["budget_used_m"],
            "costs_per_m": {field: float(cost) for field, cost in zip(WIDTH_FIELDS, settings.costs)},
        },
    }
    if validate is not None:
        result["validated_result"] = dict(validate(optimized))
    return result
