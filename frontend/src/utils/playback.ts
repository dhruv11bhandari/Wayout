import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimResult } from '../types';

/** Agent state codes used by the renderer. */
export const ST_WAITING = 0;
export const ST_FREE = 1;
export const ST_SLOW = 2;
export const ST_STALLED = 3;
export const ST_IDLE = 4;

export interface AgentFrame {
  n: number;
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  state: Uint8Array;
  visible: Uint8Array;
}

export function emptyFrame(n: number): AgentFrame {
  return {
    n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    r: new Float32Array(n).fill(0.25),
    state: new Uint8Array(n),
    visible: new Uint8Array(n),
  };
}

/** Recorded trajectories from the simulator, interpolated in time for smooth playback. */
export class Trajectory {
  readonly n: number;
  readonly frames: number;
  readonly dt: number;
  readonly duration: number;
  readonly pos: Float32Array;
  readonly evac: Float32Array;
  readonly v0: Float32Array;
  readonly radius: Float32Array;
  readonly delay: Float32Array;
  readonly spawn: Float32Array;

  constructor(sim: SimResult) {
    const tr = sim.trajectories!;
    const ag = sim.agents!;
    this.n = tr.n_agents;
    this.frames = tr.n_frames;
    this.dt = tr.frame_dt;
    this.duration = sim.completed ? sim.clearance_time : (tr.n_frames - 1) * tr.frame_dt;
    this.pos = new Float32Array(this.frames * this.n * 2);
    for (let f = 0; f < this.frames; f++) this.pos.set(tr.positions[f], f * this.n * 2);
    this.evac = Float32Array.from(ag.evac_time.map((v) => (v == null ? Infinity : v)));
    this.v0 = Float32Array.from(ag.v0);
    this.radius = Float32Array.from(ag.radius);
    this.delay = Float32Array.from(ag.delay);
    // spawn_time is always present now (see backend simulator.py); default to all-zero for
    // any older cached SimResult that predates the field, so nobody is hidden by mistake.
    this.spawn = ag.spawn_time ? Float32Array.from(ag.spawn_time) : new Float32Array(this.n);
  }

  evacuatedAt(t: number): number {
    let c = 0;
    for (let i = 0; i < this.n; i++) if (this.evac[i] <= t) c++;
    return c;
  }

  sample(t: number, out: AgentFrame): void {
    const n = this.n;
    const f = Math.min(Math.max(t / this.dt, 0), this.frames - 1);
    const f0 = Math.floor(f);
    const f1 = Math.min(f0 + 1, this.frames - 1);
    const a = f - f0;
    const fp = f0 > 0 ? f0 - 1 : f1;
    const p = this.pos;
    const stride = n * 2;
    for (let i = 0; i < n; i++) {
      const k = i * 2;
      const x0 = p[f0 * stride + k], y0 = p[f0 * stride + k + 1];
      const x1 = p[f1 * stride + k], y1 = p[f1 * stride + k + 1];
      out.x[i] = x0 + (x1 - x0) * a;
      out.y[i] = y0 + (y1 - y0) * a;
      out.r[i] = this.radius[i];
      out.visible[i] = t >= this.spawn[i] && t < this.evac[i] ? 1 : 0;
      const dx = x0 - p[fp * stride + k], dy = y0 - p[fp * stride + k + 1];
      const span = f0 > 0 ? this.dt : Math.max(this.dt, 1e-3);
      const ratio = Math.hypot(dx, dy) / span / Math.max(this.v0[i], 0.3);
      out.state[i] = t < this.delay[i] ? ST_WAITING : ratio > 0.55 ? ST_FREE : ratio > 0.22 ? ST_SLOW : ST_STALLED;
    }
  }
}

/** Live crowd density (agents / m^2) from the visible agents: binned + binomial blur. */
export function computeLiveDensity(frame: AgentFrame, nx: number, ny: number, cell: number, out: Float32Array, tmp: Float32Array): void {
  out.fill(0);
  for (let i = 0; i < frame.n; i++) {
    if (!frame.visible[i]) continue;
    const ix = Math.min(nx - 1, Math.max(0, Math.floor(frame.x[i] / cell)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor(frame.y[i] / cell)));
    out[iy * nx + ix] += 1;
  }
  const k = [1, 4, 6, 4, 1];
  tmp.fill(0);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let s = 0;
      for (let d = -2; d <= 2; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < nx) s += out[y * nx + xx] * k[d + 2];
      }
      tmp[y * nx + x] = s / 16;
    }
  }
  const inv = 1 / (cell * cell);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let s = 0;
      for (let d = -2; d <= 2; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < ny) s += tmp[yy * nx + x] * k[d + 2];
      }
      out[y * nx + x] = (s / 16) * inv;
    }
  }
}

export function flattenGrid(rows: number[][]): Float32Array {
  const ny = rows.length, nx = rows[0]?.length ?? 0;
  const out = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) out.set(rows[y], y * nx);
  return out;
}

/** Playback clock. Lives in refs so the canvas can read it every frame without re-rendering React. */
export function usePlayback() {
  const timeRef = useRef(0);
  const durRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(4);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(4);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        const nt = timeRef.current + dt * speedRef.current;
        if (nt >= durRef.current) {
          timeRef.current = durRef.current;
          playingRef.current = false;
          setPlaying(false);
        } else {
          timeRef.current = nt;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const load = useCallback((d: number, autoplay = true) => {
    durRef.current = d;
    setDuration(d);
    timeRef.current = 0;
    playingRef.current = autoplay;
    setPlaying(autoplay);
  }, []);
  const clear = useCallback(() => {
    durRef.current = 0;
    setDuration(0);
    timeRef.current = 0;
    playingRef.current = false;
    setPlaying(false);
  }, []);
  const play = useCallback(() => {
    if (durRef.current <= 0) return;
    if (timeRef.current >= durRef.current - 0.01) timeRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);
  const seek = useCallback((t: number) => {
    timeRef.current = Math.min(Math.max(t, 0), durRef.current);
  }, []);
  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);
  const waitUntilEnd = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const iv = setInterval(() => {
          if (!playingRef.current) {
            clearInterval(iv);
            resolve();
          }
        }, 120);
      }),
    [],
  );

  return { timeRef, playing, speed, duration, load, clear, play, pause, seek, setSpeed, waitUntilEnd };
}

export type Playback = ReturnType<typeof usePlayback>;
