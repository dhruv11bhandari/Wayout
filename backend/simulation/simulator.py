"""Local CPU evacuation simulator (NumPy).

`LocalSimulationEngine` implements the `SimulationEngine` interface. A future
`CudaSimulationEngine` (see cuda_engine.py) can be dropped in without touching the API.

Scheduled arrivals (`SimConfig.extra_agents`)
----------------------------------------------
A normal call only evacuates the agents `spawn_agents()` places at t=0. Passing
`extra_agents` (a list of `ScheduledAgent(x, y, t)`) additionally injects agents mid-run,
at simulation time `t`, at position `(x, y)`, moving under the exact same social-force
dynamics as everyone else from that point on. This is what `simulation/multi_floor.py`
uses to chain floors together: floor *k+1*'s simulation tells us when each of its
occupants reaches a stairwell, and that becomes a scheduled arrival on floor *k* at the
matching stair landing. Nothing about the single-floor API changes: `extra_agents`
defaults to empty, so `/api/simulate` behaves exactly as before.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np

from building import BuildingParams
from interfaces import SimulationEngine
from .agents import agent_attributes, spawn_agents
from .bottleneck import detect_bottleneck
from .density import CROWDED, DensityField
from .navigation import Environment, get_environment
from .social_force import ForceParams, agent_repulsion, resolve_overlaps, wall_repulsion

FLOW_CAPACITY = 1.3  # persons / (m * s), used only for the exit-choice queue estimate


@dataclass
class ScheduledAgent:
    """An agent that enters the simulation mid-run instead of being present at t=0."""
    x: float
    y: float
    t: float  # simulation time (s) at which the agent appears at (x, y), stationary, vel=0


@dataclass
class SimConfig:
    dt: float = 0.1
    max_time: float = 600.0
    record: bool = True             # keep trajectories for the animation
    record_dt: float = 0.25
    density_dt: float = 0.5
    max_reaction_delay: float = 5.0  # agents start walking after U(0, this) seconds
    dynamic_exit_choice: bool = True
    reassess_dt: float = 2.0
    switch_margin_s: float = 5.0
    seed: Optional[int] = None       # None -> params.seed
    extra_agents: List[ScheduledAgent] = field(default_factory=list)
    label_prefix: str = "Exit"       # "Stair" for upper floors in a multi-floor building


def _slide(env: Environment, pos: np.ndarray, new: np.ndarray, vel: np.ndarray):
    """Keep agents out of walls: try full move, then x-only, then y-only, else stay."""
    blk = env.is_blocked(new)
    if not blk.any():
        return new, vel
    idx = np.flatnonzero(blk)
    tx = np.stack([new[idx, 0], pos[idx, 1]], axis=1)
    ty = np.stack([pos[idx, 0], new[idx, 1]], axis=1)
    bx, by = env.is_blocked(tx), env.is_blocked(ty)
    res, v = pos[idx].copy(), vel[idx].copy()
    ux = ~bx
    uy = bx & ~by
    res[ux] = tx[ux]; v[ux, 1] = 0.0
    res[uy] = ty[uy]; v[uy, 0] = 0.0
    v[bx & by] = 0.0
    new = new.copy(); vel = vel.copy()
    new[idx] = res; vel[idx] = v
    return new, vel


def _reassign(env: Environment, pos, v0, target, moving, cfg: SimConfig):
    """Queue-aware exit choice with hysteresis (agents only switch if it clearly pays off)."""
    D = env.distance_to_exits(pos)
    E, n = D.shape
    cost = np.empty((E, n))
    for k in range(E):
        mine = np.sort(D[k, target == k])
        ahead = np.searchsorted(mine, D[k], side="left")
        cost[k] = D[k] / v0 + ahead / (env.exit_widths[k] * FLOW_CAPACITY)
    ar = np.arange(n)
    best = np.argmin(cost, axis=0)
    switch = moving & (cost[best, ar] < cost[target, ar] - cfg.switch_margin_s) & (D[target, ar] > 6.0)
    return np.where(switch, best, target)


class LocalSimulationEngine(SimulationEngine):
    name = "LocalSimulationEngine"
    description = "CPU / NumPy social-force-inspired pedestrian model"

    def simulate(self, params: BuildingParams, config: Optional[SimConfig] = None) -> Dict[str, Any]:
        cfg = config or SimConfig()
        p = params.normalized()
        seed = p.seed if cfg.seed is None else cfg.seed
        t_wall = time.perf_counter()

        env = get_environment(p, cfg.label_prefix)
        b = env.building
        E = len(env.exits)
        spawn = spawn_agents(b, p)
        N_initial = len(spawn.xy)
        v0_all, rad_all, delay_all = agent_attributes(N_initial, p, seed, cfg.max_reaction_delay)
        v_ref = float(v0_all.mean())
        fp = ForceParams()
        noise_rng = np.random.default_rng(seed + 104729)

        extras = sorted(cfg.extra_agents, key=lambda a: a.t)
        N_extra = len(extras)
        # Extras start walking the instant they're injected (no additional reaction delay -
        # they were already moving, on the stair, right up until they land here).
        v0_extra, rad_extra, _ = agent_attributes(N_extra, p, seed + 1_000_003, 0.0)
        N = N_initial + N_extra  # total agents this run will ever contain
        next_extra = 0

        ids = np.arange(N_initial)
        pos = spawn.xy.copy()
        vel = np.zeros((N_initial, 2))
        v0, rad, delay = v0_all.copy(), rad_all.copy(), delay_all.copy()
        target = np.argmin(env.distance_to_exits(pos), axis=0) if N_initial else np.zeros(0, dtype=int)

        pos_full = np.zeros((N, 2))
        pos_full[:N_initial] = spawn.xy
        spawn_time = np.zeros(N)
        for i, sa in enumerate(extras):
            pos_full[N_initial + i] = (sa.x, sa.y)
            spawn_time[N_initial + i] = sa.t
        evac_time = np.full(N, np.nan)
        exit_of = np.full(N, -1, dtype=int)

        field_ = DensityField(b.width, b.height)
        dt = cfg.dt
        rec_every = max(1, int(round(cfg.record_dt / dt)))
        den_every = max(1, int(round(cfg.density_dt / dt)))
        tl_every = max(1, int(round(1.0 / dt)))
        reassess_every = max(1, int(round(cfg.reassess_dt / dt)))
        frames = [pos_full.copy()] if cfg.record else []
        tl = {"t": [0.0], "evacuated": [0], "max_density": [0.0], "exits": {e.id: [0] for e in env.exits}}
        exit_counts = np.zeros(E, dtype=int)
        speed_sum, speed_n = 0.0, 0
        dmax_window = 0.0

        step = 0
        max_steps = int(cfg.max_time / dt)
        t = 0.0
        while (len(ids) or next_extra < N_extra) and step < max_steps:
            moving = t >= delay
            if cfg.dynamic_exit_choice and E > 1 and step > 0 and step % reassess_every == 0 and len(ids):
                target = _reassign(env, pos, v0, target, moving, cfg)

            direction = env.desired_direction(pos, target)
            desired = direction * (v0 * moving)[:, None]
            acc = (desired - vel) / fp.tau
            acc += agent_repulsion(pos, rad, fp)
            acc += wall_repulsion(env.wall_sample(pos), rad, fp)
            acc += noise_rng.normal(0.0, fp.noise, acc.shape)  # fluctuation term of the social-force model
            vel = vel + acc * dt
            sp = np.hypot(vel[:, 0], vel[:, 1])
            lim = fp.max_speed_factor * v0
            over = sp > lim
            if over.any():
                vel[over] *= (lim[over] / sp[over])[:, None]

            new = pos + vel * dt
            new, vel = _slide(env, pos, new, vel)
            pushed = resolve_overlaps(new, rad)
            bad = env.is_blocked(pushed)
            pushed[bad] = new[bad]
            new = pushed

            done = np.zeros(len(ids), dtype=bool)
            hit_exit = np.full(len(ids), -1, dtype=int)
            for k, ex in enumerate(env.exits):
                rel = new - np.array([ex.x, ex.y])
                s = rel @ ex.normal
                lat = np.abs(rel @ ex.tangent)
                hit = (s > 0.0) & (lat <= ex.width / 2 + 0.3) & ~done
                hit_exit[hit] = k
                done |= hit

            step += 1
            t = step * dt
            if len(ids):
                pos_full[ids] = new
            if done.any():
                gid = ids[done]
                evac_time[gid] = t
                exit_of[gid] = hit_exit[done]
                for k in range(E):
                    exit_counts[k] += int((hit_exit[done] == k).sum())
                keep = ~done
                ids, pos, vel = ids[keep], new[keep], vel[keep]
                v0, rad, delay, target = v0[keep], rad[keep], delay[keep], target[keep]
            else:
                pos = new

            # ---- inject any scheduled arrivals whose time has come -------------------
            if next_extra < N_extra:
                batch = []
                while next_extra < N_extra and extras[next_extra].t <= t:
                    batch.append(extras[next_extra])
                    next_extra += 1
                if batch:
                    k0 = N_initial + (next_extra - len(batch))
                    new_gid = np.arange(k0, N_initial + next_extra)
                    new_pos = np.array([[a.x, a.y] for a in batch])
                    new_vel = np.zeros((len(batch), 2))
                    new_v0 = v0_extra[k0 - N_initial:next_extra]
                    new_rad = rad_extra[k0 - N_initial:next_extra]
                    new_delay = np.zeros(len(batch))
                    new_target = np.argmin(env.distance_to_exits(new_pos), axis=0)
                    ids = np.concatenate([ids, new_gid])
                    pos = np.vstack([pos, new_pos]) if pos.size else new_pos
                    vel = np.vstack([vel, new_vel]) if vel.size else new_vel
                    v0 = np.concatenate([v0, new_v0])
                    rad = np.concatenate([rad, new_rad])
                    delay = np.concatenate([delay, new_delay])
                    target = np.concatenate([target, new_target])
                    pos_full[new_gid] = new_pos

            if len(ids) and step % den_every == 0:
                spd = np.hypot(vel[:, 0], vel[:, 1])
                dm = field_.update(pos, spd, v_ref, cfg.density_dt, t)
                dmax_window = max(dmax_window, dm)
                mv = t >= delay
                if mv.any():
                    speed_sum += float(spd[mv].mean()); speed_n += 1
            if cfg.record and step % rec_every == 0:
                frames.append(pos_full.copy())
            if step % tl_every == 0:
                tl["t"].append(round(t, 1))
                tl["evacuated"].append(int(np.sum(~np.isnan(evac_time))))
                tl["max_density"].append(round(dmax_window, 3))
                for k, e in enumerate(env.exits):
                    tl["exits"][e.id].append(int(exit_counts[k]))
                dmax_window = 0.0

        completed = (len(ids) == 0) and (next_extra == N_extra)
        t_end = t
        if tl["t"][-1] < round(t_end, 1):  # closing sample so the curves end at the true final state
            tl["t"].append(round(t_end, 1))
            tl["evacuated"].append(int(np.sum(~np.isnan(evac_time))))
            tl["max_density"].append(round(dmax_window, 3))
            for k, e in enumerate(env.exits):
                tl["exits"][e.id].append(int(exit_counts[k]))
        ok = ~np.isnan(evac_time)
        times = evac_time[ok]
        clearance = float(times.max()) if completed and len(times) else float(cfg.max_time)
        n_done = int(ok.sum())
        util = {}
        for k, e in enumerate(env.exits):
            c = int(exit_counts[k])
            util[e.id] = {"label": e.label, "count": c,
                          "percent": round(100.0 * c / n_done, 1) if n_done else 0.0,
                          "width": e.width}

        bott = detect_bottleneck(field_, b, max(t_end, 1.0))
        result: Dict[str, Any] = {
            "params": p.to_dict(),
            "seed": seed,
            "completed": bool(completed),
            "total_agents": int(N),
            "evacuated": n_done,
            "clearance_time": round(clearance, 2),
            "average_time": round(float(times.mean()), 2) if n_done else None,
            "median_time": round(float(np.median(times)), 2) if n_done else None,
            "max_time": round(float(times.max()), 2) if n_done else None,
            "max_density": round(float(field_.max_density), 3),
            "avg_speed": round(speed_sum / speed_n, 3) if speed_n else 0.0,
            "congestion_duration": bott["duration_s"],
            "bottleneck": bott,
            "exit_utilization": util,
            "timeline": tl,
            "density_grid": {
                "cell": 0.5, "nx": field_.nx, "ny": field_.ny,
                "peak": np.round(field_.peak, 2).tolist(),
            },
            "engine": {"name": self.name, "model": "Social-force-inspired pedestrian model",
                       "dt": dt, "device": "CPU (NumPy)",
                       "compute_time_s": round(time.perf_counter() - t_wall, 2)},
            "extra_agents_injected": int(N_extra),
        }
        # Per-agent outcomes (evac_time / exit / spawn_time) are cheap (O(N), not O(N *
        # frames)) and `multi_floor.py` depends on them to chain floors together even on
        # a `record=False` fast call - so, unlike the heavy frame-by-frame trajectories
        # below, they are always computed, not gated behind cfg.record.
        eid = [e.id for e in env.exits]
        result["agents"] = {
            "v0": np.round(np.concatenate([v0_all, v0_extra]) if N_extra else v0_all, 3).tolist(),
            "radius": np.round(np.concatenate([rad_all, rad_extra]) if N_extra else rad_all, 3).tolist(),
            "delay": np.round(np.concatenate([delay_all, np.zeros(N_extra)]) if N_extra else delay_all, 2).tolist(),
            "spawn_time": np.round(spawn_time, 2).tolist(),
            "evac_time": [None if np.isnan(v) else round(float(v), 2) for v in evac_time],
            "exit": [eid[k] if k >= 0 else None for k in exit_of],
        }
        if cfg.record:
            n_frames = int(math.ceil(t_end / cfg.record_dt)) + 1
            while len(frames) < n_frames:
                frames.append(pos_full.copy())
            arr = np.round(np.stack(frames[:n_frames]).reshape(n_frames, -1), 2)
            result["trajectories"] = {"frame_dt": cfg.record_dt, "n_frames": n_frames, "n_agents": int(N),
                                      "positions": arr.tolist()}
        return result
