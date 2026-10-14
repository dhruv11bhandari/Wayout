"""Automatic bottleneck detection from measured density / speed fields.

Per grid cell and per density sample:
    congestion_score = 0.6 * normalised_density + 0.4 * normalised_low_speed
The scores are integrated over the evacuation (so both severity *and* duration
count) and normalised by the total time. The highest-scoring region is the primary
bottleneck.
"""
from __future__ import annotations

from typing import Dict, List

import numpy as np
from scipy import ndimage

from building import Building, zone_label
from .density import CELL, DensityField

MIN_SCORE = 0.04


def _region(score: np.ndarray, peak_idx, frac: float):
    lab, _ = ndimage.label(score >= frac * score[peak_idx])
    mask = lab == lab[peak_idx]
    ys, xs = np.where(mask)
    return mask, (xs.min() * CELL, ys.min() * CELL, (xs.max() + 1) * CELL, (ys.max() + 1) * CELL)


def detect_bottleneck(field: DensityField, building: Building, total_time: float) -> Dict:
    score = ndimage.gaussian_filter(field.score_int / max(total_time, 1e-6), 1.0)
    iy, ix = np.unravel_index(int(np.argmax(score)), score.shape)
    best = float(score[iy, ix])
    if best < MIN_SCORE:
        return {"x": None, "y": None, "label": "No significant bottleneck", "score": round(best, 4),
                "peak_density": round(float(field.max_density), 3), "duration_s": 0.0,
                "region": None, "hotspots": []}
    mask, (x0, y0, x1, y1) = _region(score, (iy, ix), 0.5)
    x, y = (ix + 0.5) * CELL, (iy + 0.5) * CELL
    small = max(x1 - x0, y1 - y0) <= 4.0
    lx, ly = (x, y) if small else ((x0 + x1) / 2, (y0 + y1) / 2)
    hot: List[Dict] = []
    work = score.copy()
    work[mask] = 0.0
    for _ in range(2):
        jy, jx = np.unravel_index(int(np.argmax(work)), work.shape)
        if work[jy, jx] < 0.5 * best:
            break
        m2, (a0, b0, a1, b1) = _region(work, (jy, jx), 0.5)
        hot.append({"x": round((jx + 0.5) * CELL, 2), "y": round((jy + 0.5) * CELL, 2),
                    "score": round(float(work[jy, jx]), 4),
                    "label": zone_label(building, (a0 + a1) / 2, (b0 + b1) / 2, allow_door=max(a1 - a0, b1 - b0) <= 4.0),
                    "region": {"x0": a0, "y0": b0, "x1": a1, "y1": b1}})
        work[m2] = 0.0
    return {
        "x": round(x, 2), "y": round(y, 2),
        "label": zone_label(building, lx, ly, allow_door=small),
        "score": round(best, 4),
        "peak_density": round(float(field.peak[mask].max()), 3),
        "duration_s": round(float(field.crowded_time[mask].max()), 1),
        "region": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
        "hotspots": hot,
    }
