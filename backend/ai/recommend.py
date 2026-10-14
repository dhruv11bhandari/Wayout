"""Design recommendations, generated from the actual detected bottleneck - never hard-coded.

Two paths, both honest, chosen for turnaround vs. precision:

  * Single floor -> each candidate design change is scored with the fast ML surrogate
    (`services.predictor.predict`), the same model and the same code path the "Fast AI
    prediction" button uses. Millisecond turnaround, `expected_error_s` carried through.
  * Multi-floor   -> each candidate is scored by actually re-running the multi-floor
    simulation (`simulation.simulate_building`) on the changed design. Slower, but exact,
    rather than the model's typ. several-second-per-candidate uncertainty
    (`services.predictor.predict_multi` - see `ml/generate_dataset.py::generate_multi` -
    exists for a fast whole-building estimate, e.g. for the simulator page's live "AI
    predicted clearance" readout; recommendation *ranking* still prefers a real
    resimulation of each candidate over stacking several surrogate guesses).

Either way, "Apply scenario" in the UI re-runs the real simulation on the suggested
parameters - the recommendation is a ranked hint, the applied result is always measured.
"""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Dict, List, Optional

import services
from building import BuildingParams
from simulation import MultiFloorParams, SimConfig, simulate_building


def _zone_kind(label: str) -> str:
    l = label.lower()
    if "exit" in l or "stair" in l or "approach" in l:
        return "egress"
    return "corridor"


def _single_candidate(id_: str, title: str, base: BuildingParams, new: BuildingParams,
                       baseline_clearance: Optional[float], reason: str) -> Dict[str, Any]:
    pred = services.predictor.predict(new.normalized())
    predicted_ct = pred["predicted_clearance_time"]
    improvement = round(100.0 * (baseline_clearance - predicted_ct) / baseline_clearance, 1) if baseline_clearance else 0.0
    return {
        "id": id_, "title": title,
        "current": _diff(base, new), "suggested": _diff(new, base, want_new=True),
        "predicted_clearance_time": predicted_ct, "baseline_clearance_time": baseline_clearance,
        "predicted_improvement_pct": improvement, "expected_error_s": pred["expected_error_s"],
        "basis": "ai_prediction", "reason": reason,
    }


def _diff(a: BuildingParams, b: BuildingParams, want_new: bool = False) -> Dict[str, Any]:
    fields = ("corridor_width", "exit_width", "num_exits")
    src = b if want_new else a
    out = {}
    for f in fields:
        va, vb = getattr(a, f), getattr(b, f)
        if va != vb:
            out[f] = getattr(src, f)
    return out


def recommend_single_floor(params: BuildingParams, sim_result: Dict[str, Any], max_items: int = 3) -> List[Dict[str, Any]]:
    p = params.normalized()
    baseline = sim_result.get("clearance_time")
    bottleneck = sim_result.get("bottleneck") or {}
    label = bottleneck.get("label", "the building")
    peak = bottleneck.get("peak_density")
    duration = bottleneck.get("duration_s", 0) or 0
    zone = _zone_kind(label)

    out: List[Dict[str, Any]] = []
    if zone == "egress" and p.exit_width < 3.7:
        new = replace(p, exit_width=round(min(4.0, p.exit_width + 0.3), 2))
        reason = (f"Peak density of {peak:.1f} people/m\u00b2 at {label} indicates the exit width is the "
                  f"binding constraint." if peak else f"{label} is the measured bottleneck.")
        out.append(_single_candidate("widen_exits", "Widen the exits", p, new, baseline, reason))
    if p.corridor_width < 5.7:
        new = replace(p, corridor_width=round(min(6.0, p.corridor_width + 0.5), 2))
        reason = (f"{label} stayed above crowded density for {duration:.0f}s of the run; a wider corridor "
                  f"increases throughput feeding it.")
        out.append(_single_candidate("widen_corridor", "Widen the main corridor", p, new, baseline, reason))
    if p.num_exits < 4 and zone == "egress":
        new = replace(p, num_exits=p.num_exits + 1)
        reason = f"A limited number of exits concentrates load near {label}; an additional route reduces queueing."
        out.append(_single_candidate("add_exit", "Add an exit", p, new, baseline, reason))

    out.sort(key=lambda c: c["predicted_improvement_pct"], reverse=True)
    return out[:max_items]


def recommend_multi_floor(mfp: MultiFloorParams, sim_result: Dict[str, Any], max_items: int = 2) -> List[Dict[str, Any]]:
    mfp = mfp.normalized()
    baseline = sim_result.get("clearance_time")
    bottleneck = sim_result.get("bottleneck") or {}
    label = bottleneck.get("label", "the building")
    floor = bottleneck.get("floor", 0)
    peak = bottleneck.get("peak_density")

    specs = []
    if floor and floor > 0 and mfp.stair_width < 3.7:
        new_sw = round(min(4.0, mfp.stair_width + 0.3), 2)
        specs.append(("widen_stairs", f"Widen the stairs on Floor {floor}", {"stair_width": mfp.stair_width},
                      {"stair_width": new_sw}, replace(mfp, stair_width=new_sw),
                      (f"Floor {floor} shows peak density {peak:.1f} people/m\u00b2 at {label}; that stairwell "
                       f"carries everyone above it.") if peak else f"{label} on Floor {floor} is the measured bottleneck."))
    if (not floor or floor == 0) and mfp.exit_width < 3.7:
        new_ew = round(min(4.0, mfp.exit_width + 0.3), 2)
        specs.append(("widen_exits", "Widen the ground-floor exits", {"exit_width": mfp.exit_width},
                      {"exit_width": new_ew}, replace(mfp, exit_width=new_ew),
                      f"{label} absorbs the combined load of every floor above it."))
    if mfp.corridor_width < 5.7:
        new_cw = round(min(6.0, mfp.corridor_width + 0.5), 2)
        specs.append(("widen_corridor", "Widen every corridor", {"corridor_width": mfp.corridor_width},
                      {"corridor_width": new_cw}, replace(mfp, corridor_width=new_cw),
                      f"Wider corridors on every floor increase throughput feeding {label}."))

    out: List[Dict[str, Any]] = []
    for id_, title, current, suggested, new_mfp, reason in specs[:max_items]:
        r = simulate_building(new_mfp.normalized(), SimConfig(record=False))
        new_ct = r["clearance_time"]
        improvement = round(100.0 * (baseline - new_ct) / baseline, 1) if baseline else 0.0
        out.append({
            "id": id_, "title": title, "current": current, "suggested": suggested,
            "predicted_clearance_time": new_ct, "baseline_clearance_time": baseline,
            "predicted_improvement_pct": improvement, "basis": "simulation", "reason": reason,
        })
    out.sort(key=lambda c: c["predicted_improvement_pct"], reverse=True)
    return out
