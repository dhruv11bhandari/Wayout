import type { Params } from '../types';

export const fmtClock = (s: number): string => {
  const t = Math.max(0, Math.round(s));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export const fmtSec = (s: number, digits = 0): string => `${s.toFixed(digits)} sec`;

export const fmtSigned = (s: number, digits = 0): string => `${s > 0 ? '+' : s < 0 ? '−' : ''}${Math.abs(s).toFixed(digits)}`;

export const paramsKey = (p: Params): string =>
  JSON.stringify([p.occupancy, p.corridor_width, p.exit_width, p.num_exits, p.agent_speed, [...p.blocked_exits].sort(), p.seed]);

export const paramsEqual = (a: Params, b: Params): boolean => paramsKey(a) === paramsKey(b);

export function describeParams(p: Params): string {
  const blocked = p.blocked_exits.length ? ` · ${p.blocked_exits.map((b) => `Exit ${b}`).join(', ')} blocked` : '';
  return `${p.occupancy} people · corridor ${p.corridor_width.toFixed(2)} m · exits ${p.num_exits} × ${p.exit_width.toFixed(1)} m${blocked}`;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
