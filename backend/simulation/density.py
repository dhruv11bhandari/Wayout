"""Crowd-density field: per-cell density, mean speed, congestion score and dwell time."""
from __future__ import annotations

import math

import numpy as np
from scipy.ndimage import gaussian_filter

CELL = 0.5
SIGMA_CELLS = 1.2          # Gaussian kernel ~0.6 m
RHO_REF = 4.0              # agents/m^2 treated as "fully congested" for scoring
RHO_MIN = 0.4              # ignore sparse cells when scoring low speed
CROWDED = 1.5              # agents/m^2 threshold for "crowded time" (level-of-service D/E boundary)


class DensityField:
    def __init__(self, width: float, height: float):
        self.nx = int(math.ceil(width / CELL))
        self.ny = int(math.ceil(height / CELL))
        shape = (self.ny, self.nx)
        self.peak = np.zeros(shape)
        self.score_int = np.zeros(shape)        # time-integral of congestion score (s)
        self.crowded_time = np.zeros(shape)     # seconds with density >= CROWDED
        self.current = np.zeros(shape)
        self.max_density = 0.0
        self.max_density_time = 0.0
        self.samples = 0

    def _bin(self, pos: np.ndarray):
        ix = np.clip((pos[:, 0] / CELL).astype(np.int64), 0, self.nx - 1)
        iy = np.clip((pos[:, 1] / CELL).astype(np.int64), 0, self.ny - 1)
        return iy * self.nx + ix

    def update(self, pos: np.ndarray, speed: np.ndarray, v_ref: float, dt: float, t: float) -> float:
        """Accumulate one density sample; returns the current maximum density."""
        n = self.nx * self.ny
        if len(pos) == 0:
            self.current = np.zeros((self.ny, self.nx))
            return 0.0
        b = self._bin(pos)
        counts = np.bincount(b, minlength=n).reshape(self.ny, self.nx).astype(float)
        sspeed = np.bincount(b, speed, minlength=n).reshape(self.ny, self.nx)
        c_s = gaussian_filter(counts, SIGMA_CELLS, mode="constant")
        s_s = gaussian_filter(sspeed, SIGMA_CELLS, mode="constant")
        dens = c_s / (CELL * CELL)
        vavg = np.where(c_s > 1e-6, s_s / np.maximum(c_s, 1e-6), v_ref)
        nd = np.clip(dens / RHO_REF, 0, 1)
        nl = np.where(dens >= RHO_MIN, np.clip(1.0 - vavg / (0.9 * v_ref), 0, 1), 0.0)
        score = 0.6 * nd + 0.4 * nl * (dens >= RHO_MIN)
        self.current = dens
        self.peak = np.maximum(self.peak, dens)
        self.score_int += score * dt
        self.crowded_time += (dens >= CROWDED) * dt
        m = float(dens.max())
        if m > self.max_density:
            self.max_density, self.max_density_time = m, t
        self.samples += 1
        return m
