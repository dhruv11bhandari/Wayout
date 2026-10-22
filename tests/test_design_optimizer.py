from simulation import MultiFloorParams
from optimization.design_optimizer import OptimizationConfig, optimize_multi_floor


def _helpful_predictor(params: MultiFloorParams):
    return {
        "predicted_clearance_time": (
            200.0
            - 8.0 * params.corridor_width
            - 7.0 * params.exit_width
            - 5.0 * params.stair_width
        )
    }


def test_optimizer_improves_within_widening_budget_and_can_validate():
    base = MultiFloorParams(n_floors=3, occupancy=(100, 100, 100))
    settings = OptimizationConfig(widening_budget_m=0.5, max_iterations=4, learning_rate=0.1)
    seen = []

    def validate(params: MultiFloorParams):
        seen.append(params)
        return {"clearance_time": 71.2}

    result = optimize_multi_floor(base, _helpful_predictor, settings, validate)

    assert result["optimized_predicted_clearance_time"] < result["baseline_predicted_clearance_time"]
    assert result["budget"]["used_m"] <= settings.widening_budget_m
    assert result["validated_result"] == {"clearance_time": 71.2}
    assert len(seen) == 1
    for field in ("corridor_width", "exit_width", "stair_width"):
        assert result["optimized_params"][field] >= getattr(base, field)


def test_optimizer_keeps_baseline_when_widening_is_not_helpful():
    base = MultiFloorParams(n_floors=2, occupancy=(100, 100))

    def worsening_predictor(params: MultiFloorParams):
        return {"predicted_clearance_time": params.corridor_width + params.exit_width + params.stair_width}

    result = optimize_multi_floor(base, worsening_predictor, OptimizationConfig(max_iterations=3))

    assert result["optimized_params"]["corridor_width"] == base.corridor_width
    assert result["optimized_params"]["exit_width"] == base.exit_width
    assert result["optimized_params"]["stair_width"] == base.stair_width
    assert result["stop_reason"] == "no improving feasible step"
