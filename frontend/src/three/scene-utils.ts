import * as THREE from 'three';

/** Same semantic ramp as styles/app.css and utils/render.ts's 2D heatmap - thresholds
 * line up with the CROWDED family of constants in simulation/density.py. Color always
 * means data here; never decoration (see the product brief's "Multi-color map" rule). */
const STOPS: [number, string][] = [
  [0.0, '#16241b'],
  [1.0, '#4ade80'],
  [2.5, '#eab308'],
  [4.0, '#f97316'],
  [6.0, '#ef4444'],
];
const _a = new THREE.Color();
const _b = new THREE.Color();
export function densityColor(value: number): THREE.Color {
  const v = Math.max(0, value);
  for (let i = 1; i < STOPS.length; i++) {
    const [t0, c0] = STOPS[i - 1];
    const [t1, c1] = STOPS[i];
    if (v <= t1 || i === STOPS.length - 1) {
      const a = t1 > t0 ? Math.min(1, Math.max(0, (v - t0) / (t1 - t0))) : 1;
      _a.set(c0);
      _b.set(c1);
      return _a.clone().lerp(_b, a);
    }
  }
  return _a.set(STOPS[STOPS.length - 1][1]).clone();
}

export const AGENT_STATE_COLOR: Record<number, string> = {
  0: '#8b9bb4', // ST_WAITING
  1: '#3fc1d6', // ST_FREE
  2: '#eab308', // ST_SLOW
  3: '#ef4444', // ST_STALLED
};

export const COLORS = {
  wall: '#cfcfca',
  floor: '#131313',
  floorGround: '#161616',
  exit: '#4ade80',
  exitBlocked: '#ef4444',
  stair: '#3fc1d6',
  obstacle: '#242424',
  grid: '#1c1c1c',
};

export const WALL_HEIGHT = 2.6;

/** Length / rotation-around-Y / midpoint for a wall segment, in plan (x, y) units.
 * See the comment in Building3D.tsx for the sign convention this pairs with. */
export function wallGeom(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return { length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx), cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

export type CameraPresetT = 'orbit' | 'top' | 'iso' | 'floor';
