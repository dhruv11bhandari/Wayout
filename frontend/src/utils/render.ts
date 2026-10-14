/**
 * Canvas rendering for the floor plan, heatmap, agents and annotations.
 * Pure functions (no React) so the same code can be exercised headlessly.
 */
import type { Bottleneck, Building, ExitDef } from '../types';
import { ST_FREE, ST_IDLE, ST_SLOW, ST_STALLED, ST_WAITING, type AgentFrame } from './playback';

export const C = {
  bg: '#050912',
  grid: 'rgba(110,150,210,0.07)',
  room: '#0c1626',
  corridor: '#112036',
  lobby: '#0e1c30',
  wall: '#8ea8cc',
  wallOuter: '#b8cae6',
  wallBlocked: '#f87171',
  obstacle: '#1d2e47',
  obstacleEdge: '#5f7aa0',
  door: 'rgba(56,189,248,0.75)',
  exit: '#34d399',
  exitBlocked: '#f87171',
  label: 'rgba(148,163,184,0.72)',
  labelStrong: '#dbe7f7',
  path: 'rgba(56,189,248,0.42)',
  bottleneck: '#fbbf24',
  agents: {
    [ST_WAITING]: '#8b9bb4',
    [ST_FREE]: '#38bdf8',
    [ST_SLOW]: '#fbbf24',
    [ST_STALLED]: '#f87171',
    [ST_IDLE]: '#7cc4e8',
  } as Record<number, string>,
};

export interface View { scale: number; ox: number; oy: number }
export interface HeatData { grid: Float32Array; nx: number; ny: number; cell: number }

export interface Scene {
  building: Building;
  view: View;
  w: number;
  h: number;
  dpr: number;
  clock: number; // seconds (wall clock) for gentle animations
  agents: AgentFrame | null;
  heatCanvas: HTMLCanvasElement | null;
  heat: HeatData | null;
  showPaths: boolean;
  showLabels: boolean;
  bottleneck: Bottleneck | null;
  selectedExit: string | null;
  hoverExit: string | null;
  roomCounts: Record<string, number> | null;
  exitPercent: Record<string, number> | null;
}

// ------------------------------------------------------------------ helpers
let canvasFactory = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
export function setCanvasFactory(f: (w: number, h: number) => HTMLCanvasElement): void {
  canvasFactory = f;
}

export function fitView(b: Building, w: number, h: number, padX = 104, padY = 56): View {
  const scale = Math.max(2, Math.min((w - 2 * padX) / b.width, (h - 2 * padY) / b.height));
  return { scale, ox: (w - b.width * scale) / 2, oy: (h - b.height * scale) / 2 };
}

export const toWorld = (v: View, sx: number, sy: number) => ({ x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale });

export function hitExit(b: Building, wx: number, wy: number): ExitDef | null {
  for (const e of b.exits) {
    const r = Math.max(e.width / 2, 1.0) + 0.9;
    if (Math.hypot(wx - e.x, wy - e.y) <= r) return e;
  }
  return null;
}

export function hitRoom(b: Building, wx: number, wy: number) {
  return b.rooms.find((r) => wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.height) ?? null;
}

export function countRooms(b: Building, f: AgentFrame): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of b.rooms) out[r.id] = 0;
  for (let i = 0; i < f.n; i++) {
    if (!f.visible[i]) continue;
    for (const r of b.rooms) {
      if (f.x[i] >= r.x && f.x[i] <= r.x + r.width && f.y[i] >= r.y && f.y[i] <= r.y + r.height) {
        out[r.id]++;
        break;
      }
    }
  }
  return out;
}

/** Paint a density grid into an offscreen canvas (one pixel per cell, smoothed on draw). */
export function paintHeat(heat: HeatData, canvas: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = canvas && canvas.width === heat.nx && canvas.height === heat.ny ? canvas : canvasFactory(heat.nx, heat.ny);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(heat.nx, heat.ny);
  const d = img.data;
  for (let i = 0; i < heat.grid.length; i++) {
    const v = heat.grid[i];
    const o = i * 4;
    if (v < 0.25) {
      d[o + 3] = 0;
      continue;
    }
    const t = Math.min(1, v / 3.0);
    let r: number, g: number, b: number;
    if (t < 0.4) {
      const u = t / 0.4;
      r = 30 + u * 220; g = 140 + u * 64; b = 255 - u * 234;
    } else {
      const u = (t - 0.4) / 0.6;
      r = 250 - u * 11; g = 204 - u * 136; b = 21 + u * 47;
    }
    const s = Math.min(1, Math.max(0, (v - 0.25) / 0.95));
    d[o] = r; d[o + 1] = g; d[o + 2] = b;
    d[o + 3] = 255 * s * (0.4 + 0.42 * t);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------ drawing
function wallRect(w: { x1: number; y1: number; x2: number; y2: number; thickness: number }) {
  const t = w.thickness / 2;
  if (Math.abs(w.x1 - w.x2) < 1e-6) return { x: w.x1 - t, y: Math.min(w.y1, w.y2), w: w.thickness, h: Math.abs(w.y2 - w.y1) };
  return { x: Math.min(w.x1, w.x2), y: w.y1 - t, w: Math.abs(w.x2 - w.x1), h: w.thickness };
}

function exitGap(e: ExitDef) {
  const t = 0.4;
  return e.orientation === 'N' || e.orientation === 'S'
    ? { x: e.x - e.width / 2, y: e.y - t, w: e.width, h: 2 * t }
    : { x: e.x - t, y: e.y - e.width / 2, w: 2 * t, h: e.width };
}

const OUT: Record<string, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export function drawScene(ctx: CanvasRenderingContext2D, s: Scene): void {
  const { building: b, view: v } = s;
  const px = 1 / v.scale;
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, s.w, s.h);

  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.scale, v.scale);

  // engineering grid (every 5 m)
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = px;
  ctx.beginPath();
  for (let x = -5; x <= b.width + 5; x += 5) { ctx.moveTo(x, -5); ctx.lineTo(x, b.height + 5); }
  for (let y = -5; y <= b.height + 5; y += 5) { ctx.moveTo(-5, y); ctx.lineTo(b.width + 5, y); }
  ctx.stroke();

  // floors
  for (const c of b.corridors) {
    ctx.fillStyle = c.kind === 'lobby' ? C.lobby : C.corridor;
    ctx.fillRect(c.x, c.y, c.width, c.height);
  }
  for (const r of b.rooms) {
    ctx.fillStyle = C.room;
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }

  // heatmap (under walls)
  if (s.heat && s.heatCanvas) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, b.width, b.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s.heatCanvas, 0, 0, s.heat.nx * s.heat.cell, s.heat.ny * s.heat.cell);
    ctx.restore();
  }

  // evacuation paths (animated dashes)
  if (s.showPaths) {
    ctx.save();
    ctx.strokeStyle = C.path;
    ctx.lineWidth = 1.4 * px;
    ctx.setLineDash([7 * px, 6 * px]);
    ctx.lineDashOffset = -(s.clock * 14) * px;
    ctx.lineJoin = 'round';
    for (const p of b.paths) {
      if (p.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(p.points[0][0], p.points[0][1]);
      for (let i = 1; i < p.points.length; i++) ctx.lineTo(p.points[i][0], p.points[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // obstacles
  for (const o of b.obstacles) {
    ctx.fillStyle = C.obstacle;
    ctx.fillRect(o.x, o.y, o.width, o.height);
    ctx.strokeStyle = C.obstacleEdge;
    ctx.lineWidth = 1.2 * px;
    ctx.strokeRect(o.x, o.y, o.width, o.height);
  }

  // walls
  for (const w of b.walls) {
    const r = wallRect(w);
    ctx.fillStyle = w.kind === 'blocked' ? C.wallBlocked : w.kind === 'outer' ? C.wallOuter : C.wall;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // doors (thin marker across each opening)
  ctx.strokeStyle = C.door;
  ctx.lineWidth = 1.5 * px;
  for (const d of b.doors) {
    ctx.beginPath();
    if (d.orientation === 'h') { ctx.moveTo(d.x - d.width / 2, d.y); ctx.lineTo(d.x + d.width / 2, d.y); }
    else { ctx.moveTo(d.x, d.y - d.width / 2); ctx.lineTo(d.x, d.y + d.width / 2); }
    ctx.stroke();
  }

  // exits
  for (const e of b.exits) {
    const g = exitGap(e);
    const col = e.blocked ? C.exitBlocked : C.exit;
    const sel = s.selectedExit === e.id, hov = s.hoverExit === e.id;
    if (sel || hov) {
      ctx.strokeStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.6 * px;
      ctx.strokeRect(g.x - 0.5, g.y - 0.5, g.w + 1, g.h + 1);
    }
    ctx.fillStyle = col;
    ctx.fillRect(g.x, g.y, g.w, g.h);
    if (!e.blocked) {
      const [ox, oy] = OUT[e.orientation];
      const ax = e.x + ox * 1.6, ay = e.y + oy * 1.6;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(ax + ox * 0.9, ay + oy * 0.9);
      ctx.lineTo(ax - oy * 0.75, ay + ox * 0.75);
      ctx.lineTo(ax + oy * 0.75, ay - ox * 0.75);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.strokeStyle = C.exitBlocked;
      ctx.lineWidth = 2 * px;
      const [ox, oy] = OUT[e.orientation];
      const cx = e.x + ox * 1.6, cy = e.y + oy * 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - 0.6, cy - 0.6); ctx.lineTo(cx + 0.6, cy + 0.6);
      ctx.moveTo(cx + 0.6, cy - 0.6); ctx.lineTo(cx - 0.6, cy + 0.6);
      ctx.stroke();
    }
  }

  // bottleneck highlight
  const bn = s.bottleneck;
  if (bn && bn.region) {
    const r = bn.region;
    const pad = 0.6;
    ctx.save();
    ctx.fillStyle = 'rgba(251,191,36,0.07)';
    ctx.fillRect(r.x0 - pad, r.y0 - pad, r.x1 - r.x0 + 2 * pad, r.y1 - r.y0 + 2 * pad);
    ctx.strokeStyle = C.bottleneck;
    ctx.lineWidth = 1.6 * px;
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.lineDashOffset = -(s.clock * 12) * px;
    ctx.strokeRect(r.x0 - pad, r.y0 - pad, r.x1 - r.x0 + 2 * pad, r.y1 - r.y0 + 2 * pad);
    ctx.setLineDash([]);
    if (bn.x != null && bn.y != null) {
      const pulse = 0.5 + 0.5 * Math.sin(s.clock * 3);
      ctx.strokeStyle = `rgba(251,191,36,${0.35 + 0.35 * pulse})`;
      ctx.lineWidth = 1.4 * px;
      ctx.beginPath();
      ctx.arc(bn.x, bn.y, 1.1 + 0.9 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // agents (batched by colour)
  if (s.agents) {
    const a = s.agents;
    const minR = 2.3 * px;
    for (const st of [ST_WAITING, ST_IDLE, ST_FREE, ST_SLOW, ST_STALLED]) {
      ctx.fillStyle = C.agents[st];
      ctx.beginPath();
      for (let i = 0; i < a.n; i++) {
        if (!a.visible[i] || a.state[i] !== st) continue;
        const r = Math.max(a.r[i] * 0.95, minR);
        ctx.moveTo(a.x[i] + r, a.y[i]);
        ctx.arc(a.x[i], a.y[i], r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  ctx.restore();

  // ---- screen-space annotations
  const X = (x: number) => x * v.scale + v.ox;
  const Y = (y: number) => y * v.scale + v.oy;
  ctx.font = '600 10px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  if (s.showLabels) {
    for (const r of b.rooms) {
      ctx.fillStyle = C.label;
      ctx.textAlign = 'left';
      ctx.fillText(r.name.toUpperCase(), X(r.x) + 6, Y(r.y) + 11);
      if (s.roomCounts) {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(203,213,225,0.9)';
        ctx.fillText(String(s.roomCounts[r.id] ?? 0), X(r.x + r.width) - 6, Y(r.y + r.height) - 10);
      }
    }
    ctx.fillStyle = C.label;
    for (const c of b.corridors) {
      if (c.kind === 'lobby') {
        ctx.textAlign = 'left';
        ctx.fillText('LOBBY', X(c.x) + 6, Y(c.y) + 11);
      } else if (c.height * v.scale >= 16) {
        ctx.textAlign = 'center';
        ctx.fillText('MAIN CORRIDOR', X(c.x + c.width * 0.25), Y(c.y + c.height / 2));
      }
    }
    ctx.textAlign = 'center';
    for (const o of b.obstacles) {
      if (o.label) ctx.fillText(o.label.toUpperCase(), X(o.x + o.width / 2), Y(o.y) - 8);
    }
  }

  for (const e of b.exits) {
    const [ox, oy] = OUT[e.orientation];
    const tx = X(e.x + ox * 3.1), ty = Y(e.y + oy * 3.1);
    ctx.font = '700 11px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = e.blocked ? C.exitBlocked : C.exit;
    ctx.textAlign = e.orientation === 'E' ? 'left' : e.orientation === 'W' ? 'right' : 'center';
    const pct = s.exitPercent?.[e.id];
    const tag = e.blocked ? `${e.label.toUpperCase()} · BLOCKED` : pct != null ? `${e.label.toUpperCase()} · ${pct.toFixed(0)}%` : e.label.toUpperCase();
    ctx.fillText(tag, tx + (e.orientation === 'E' ? 6 : e.orientation === 'W' ? -6 : 0), ty + (e.orientation === 'N' ? -6 : e.orientation === 'S' ? 6 : 0));
  }

  if (bn && bn.region && bn.label) {
    const cx = X((bn.region.x0 + bn.region.x1) / 2);
    const top = Y(bn.region.y0 - 0.6) - 16;
    const text = `BOTTLENECK · ${bn.label.toUpperCase()}`;
    ctx.font = '700 10px Inter, "Segoe UI", system-ui, sans-serif';
    const wtxt = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(5,9,18,0.88)';
    ctx.fillRect(cx - wtxt / 2, top - 10, wtxt, 20);
    ctx.strokeStyle = C.bottleneck;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - wtxt / 2 + 0.5, top - 9.5, wtxt - 1, 19);
    ctx.fillStyle = C.bottleneck;
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, top);
  }

  // scale bar
  let len = 10;
  if (len * v.scale > 220) len = 5;
  if (len * v.scale < 40) len = 20;
  const bx = 16, by = s.h - 16;
  ctx.strokeStyle = 'rgba(148,163,184,0.8)';
  ctx.fillStyle = 'rgba(148,163,184,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + len * v.scale, by); ctx.lineTo(bx + len * v.scale, by - 4);
  ctx.stroke();
  ctx.font = '600 10px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${len} m`, bx + len * v.scale + 8, by - 2);
}
