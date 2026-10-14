"""Generate the synthetic training set by running the REAL local simulator.

Two kinds of rows, both real simulator output, sharing one feature schema
(`ml.features.FEATURE_NAMES`) and one target column (`clearance_time`):

  * single-floor rows - one procedurally varied building/occupancy configuration
    (layout size, room count, lobby size, corridor width, exit widths, number of exits,
    blocked exits, occupancy, walking speed), `n_floors=1`, and the clearance time
    measured by `LocalSimulationEngine`.
  * multi-floor rows - a procedurally varied MULTI-FLOOR building (2-6 floors, its own
    stair widths, floor-to-floor height, per-floor occupancy) and the WHOLE-BUILDING
    clearance time measured by `simulation.simulate_building` (every floor simulated and
    chained through the stairwells - see `simulation/multi_floor.py`). The feature vector
    is built from the ground floor's own geometry (that is where the building's real
    exits are) plus `n_floors` / `floor_height`, with `occupancy_override` set to the
    building-wide occupant total - see `ml.features.extract_features`.

    python -m ml.generate_dataset --samples 450
    python -m ml.generate_dataset --multi-samples 240 --append
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from typing import Dict, List, Optional, Tuple

import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from building import EXIT_ORDER, BuildingParams  # noqa: E402
from ml.features import FEATURE_NAMES, extract_features  # noqa: E402
from simulation import LocalSimulationEngine, MultiFloorParams, SimConfig, simulate_building  # noqa: E402
from simulation.multi_floor import STAIR_IDS  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(HERE, "dataset.csv")
EXTRA_COLS = ["clearance_time", "average_time", "max_density", "rooms_per_side", "room_width",
              "lobby_width", "height", "blocked", "seed"]


# --------------------------------------------------------------------------- #
# single-floor rows (n_floors = 1)
# --------------------------------------------------------------------------- #
def sample_params(rng: np.random.Generator) -> BuildingParams:
    n_exits = int(rng.choice([1, 2, 3, 4], p=[0.12, 0.38, 0.28, 0.22]))
    blocked = ()
    if n_exits >= 2 and rng.random() < 0.12:
        blocked = (str(rng.choice(EXIT_ORDER[:n_exits])),)
    return BuildingParams(
        occupancy=int(rng.integers(40, 261)),
        corridor_width=round(float(rng.uniform(1.2, 4.0)), 2),
        exit_width=round(float(rng.uniform(0.8, 3.0)), 2),
        num_exits=n_exits,
        agent_speed=round(float(rng.uniform(1.0, 1.6)), 2),
        blocked_exits=blocked,
        seed=int(rng.integers(0, 1_000_000)),
        rooms_per_side=int(rng.choice([3, 4, 5, 6])),
        room_width=round(float(rng.uniform(8.5, 13.0)), 1),
        lobby_width=round(float(rng.uniform(16.0, 30.0)), 1),
        height=round(float(rng.uniform(32.0, 46.0)), 1),
    ).normalized()


def _run_one(p: BuildingParams) -> Optional[Dict]:
    # n_floors=1: a single-storey building has no floor above it and nothing to descend.
    _, feats = extract_features(p, n_floors=1, floor_height=3.5)
    r = LocalSimulationEngine().simulate(p, SimConfig(record=False))
    if not r["completed"]:
        return None
    row = dict(feats)
    row.update(clearance_time=r["clearance_time"], average_time=r["average_time"], max_density=r["max_density"],
               rooms_per_side=p.rooms_per_side, room_width=p.room_width, lobby_width=p.lobby_width,
               height=p.height, blocked="".join(p.blocked_exits), seed=p.seed)
    return row


# --------------------------------------------------------------------------- #
# multi-floor rows (n_floors = 2..6)
# --------------------------------------------------------------------------- #
def sample_multi_params(rng: np.random.Generator) -> MultiFloorParams:
    n_floors = int(rng.choice([2, 3, 4, 5, 6], p=[0.30, 0.28, 0.20, 0.12, 0.10]))
    n_exits = int(rng.choice([1, 2, 3, 4], p=[0.12, 0.38, 0.28, 0.22]))
    blocked_exits: Tuple[str, ...] = ()
    if n_exits >= 2 and rng.random() < 0.10:
        blocked_exits = (str(rng.choice(EXIT_ORDER[:n_exits])),)
    blocked_stairs: Tuple[Tuple[int, str], ...] = ()
    if n_floors >= 3 and rng.random() < 0.15:
        fi = int(rng.integers(1, n_floors))
        blocked_stairs = ((fi, str(rng.choice(STAIR_IDS))),)
    per_floor = int(rng.integers(40, 401))            # a "typical" floor's occupancy
    jitter = rng.uniform(0.75, 1.25, size=n_floors)   # floors are rarely identically full
    occupancy = tuple(int(max(10, round(per_floor * j))) for j in jitter)
    return MultiFloorParams(
        n_floors=n_floors,
        occupancy=occupancy,
        corridor_width=round(float(rng.uniform(1.2, 4.0)), 2),
        exit_width=round(float(rng.uniform(0.8, 3.0)), 2),
        stair_width=round(float(rng.uniform(0.8, 2.4)), 2),
        num_exits=n_exits,
        agent_speed=round(float(rng.uniform(1.0, 1.6)), 2),
        blocked_exits=blocked_exits,
        blocked_stairs=blocked_stairs,
        floor_height=round(float(rng.uniform(2.6, 4.6)), 2),
        seed=int(rng.integers(0, 1_000_000)),
        rooms_per_side=int(rng.choice([3, 4, 5, 6])),
        room_width=round(float(rng.uniform(8.5, 13.0)), 1),
        lobby_width=round(float(rng.uniform(16.0, 30.0)), 1),
        height=round(float(rng.uniform(32.0, 46.0)), 1),
    ).normalized()


def _run_one_multi(mfp: MultiFloorParams) -> Optional[Dict]:
    r = simulate_building(mfp, SimConfig(record=False))
    if not r["completed"]:
        return None
    ground = mfp.floor_params(0)
    total_occupancy = float(sum(mfp.occupancy))
    _, feats = extract_features(ground, n_floors=mfp.n_floors, floor_height=mfp.floor_height,
                                 occupancy_override=total_occupancy)
    row = dict(feats)
    row.update(clearance_time=r["clearance_time"], average_time=r["average_time"], max_density=r["max_density"],
               rooms_per_side=mfp.rooms_per_side, room_width=mfp.room_width, lobby_width=mfp.lobby_width,
               height=mfp.height, blocked="".join(mfp.blocked_exits), seed=mfp.seed)
    return row


# --------------------------------------------------------------------------- #
# shared driver
# --------------------------------------------------------------------------- #
def _drive(configs: List, run_one, out_path: str, workers: Optional[int], progress: bool, append: bool) -> int:
    n_samples = len(configs)
    workers = workers or min(os.cpu_count() or 1, 8)
    t0 = time.time()
    rows: List[Dict] = []
    if workers <= 1 or n_samples <= 1:
        it = map(run_one, configs)
        pool = None
    else:
        pool = ProcessPoolExecutor(max_workers=workers)
        it = pool.map(run_one, configs, chunksize=4)
    for i, row in enumerate(it, 1):
        if row is not None:
            rows.append(row)
        if progress and (i % 25 == 0 or i == n_samples):
            print(f"  [dataset] {i}/{n_samples} simulations ({time.time() - t0:.0f}s)", flush=True)
    if pool:
        pool.shutdown()
    new_file = not (append and os.path.exists(out_path))
    with open(out_path, "w" if new_file else "a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FEATURE_NAMES + EXTRA_COLS)
        if new_file:
            w.writeheader()
        for r in rows:
            w.writerow(r)
    print(f"  [dataset] wrote {len(rows)} rows -> {out_path}", flush=True)
    return len(rows)


def generate(n_samples: int, out_path: str = DATASET_PATH, seed: int = 2026, workers: Optional[int] = None,
             progress: bool = True, start: int = 0, append: bool = False) -> int:
    """Run single-floor configurations [start, n_samples) of the (seeded, deterministic)
    config sequence. `append=True` adds to an existing CSV, so a long generation can be
    done in several chunks."""
    rng = np.random.default_rng(seed)
    configs = [sample_params(rng) for _ in range(n_samples)][start:]
    return _drive(configs, _run_one, out_path, workers, progress, append)


def generate_multi(n_samples: int, out_path: str = DATASET_PATH, seed: int = 4052, workers: Optional[int] = None,
                    progress: bool = True, start: int = 0, append: bool = True) -> int:
    """Run multi-floor configurations [start, n_samples) of the (seeded, deterministic)
    config sequence. Each one is a full `simulate_building()` run (every floor simulated
    and chained through the stairwells), so it costs noticeably more than a single-floor
    row. `append=True` (the default here) adds to the existing single-floor dataset.csv."""
    rng = np.random.default_rng(seed)
    configs = [sample_multi_params(rng) for _ in range(n_samples)][start:]
    return _drive(configs, _run_one_multi, out_path, workers, progress, append)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=450, help="single-floor rows to generate")
    ap.add_argument("--multi-samples", type=int, default=0, help="multi-floor rows to generate")
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--multi-seed", type=int, default=4052)
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--start", type=int, default=0, help="first config index to run (for chunked generation)")
    ap.add_argument("--append", action="store_true", help="append to an existing dataset.csv")
    a = ap.parse_args()
    if a.samples:
        generate(a.samples, seed=a.seed, workers=a.workers, start=a.start, append=a.append)
    if a.multi_samples:
        generate_multi(a.multi_samples, seed=a.multi_seed, workers=a.workers, start=a.start, append=True)
