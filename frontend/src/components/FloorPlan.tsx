import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Building, HeatMode, SimResult } from '../types';
import {
  computeLiveDensity,
  emptyFrame,
  flattenGrid,
  ST_IDLE,
  type AgentFrame,
  type Trajectory,
} from '../utils/playback';
import {
  countRooms,
  drawScene,
  fitView,
  hitExit,
  hitRoom,
  paintHeat,
  toWorld,
  type HeatData,
  type View,
} from '../utils/render';

interface Props {
  building: Building | null;
  sim: SimResult | null;
  traj: Trajectory | null;
  timeRef: MutableRefObject<number>;
  heatMode: HeatMode;
  showPaths: boolean;
  showLabels: boolean;
  selectedExit: string | null;
  onSelectExit: (id: string | null) => void;
}

interface Tip { x: number; y: number; title: string; lines: string[] }

export default function FloorPlan(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const viewRef = useRef<View | null>(null);
  const userView = useRef(false); // true once the user has panned / zoomed
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const hoverExit = useRef<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  // static agents (before a simulation exists)
  const idleFrame = useMemo<AgentFrame | null>(() => {
    if (!props.building) return null;
    const a = props.building.initial_agents;
    const f = emptyFrame(a.length);
    a.forEach((ag, i) => { f.x[i] = ag.x; f.y[i] = ag.y; f.visible[i] = 1; f.state[i] = ST_IDLE; });
    return f;
  }, [props.building]);
  const idleRef = useRef(idleFrame);
  idleRef.current = idleFrame;

  const heatState = useRef<{ canvas: HTMLCanvasElement | null; peakFor: SimResult | null; peak: HeatData | null; live: HeatData | null; tmp: Float32Array | null; lastLive: number }>(
    { canvas: null, peakFor: null, peak: null, live: null, tmp: null, lastLive: 0 },
  );
  const frameRef = useRef<AgentFrame | null>(null);
  const roomCountsRef = useRef<{ t: number; v: Record<string, number> | null }>({ t: 0, v: null });

  // ---- keep the canvas sized to its container
  useEffect(() => {
    const wrap = wrapRef.current!;
    const apply = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const c = canvasRef.current!;
      c.width = Math.max(1, Math.floor(r.width * dpr));
      c.height = Math.max(1, Math.floor(r.height * dpr));
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
      sizeRef.current = { w: r.width, h: r.height, dpr };
      if (!userView.current) viewRef.current = null;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // re-fit when the building's outer size changes
  const bw = props.building?.width, bh = props.building?.height;
  useEffect(() => { userView.current = false; viewRef.current = null; }, [bw, bh]);

  // ---- render loop
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const p = propsRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const { w, h, dpr } = sizeRef.current;
      if (!ctx || !p.building || w < 10) return;
      if (!viewRef.current) viewRef.current = fitView(p.building, w, h);

      const t = p.timeRef.current;
      let frame: AgentFrame | null = null;
      if (p.traj) {
        if (!frameRef.current || frameRef.current.n !== p.traj.n) frameRef.current = emptyFrame(p.traj.n);
        p.traj.sample(t, frameRef.current);
        frame = frameRef.current;
      } else {
        frame = idleRef.current;
      }

      // heatmap
      let heat: HeatData | null = null;
      const hs = heatState.current;
      if (p.sim && p.heatMode !== 'off') {
        const g = p.sim.density_grid;
        const atEnd = p.traj ? t >= p.traj.duration - 0.01 : true;
        if (p.heatMode === 'peak' || atEnd) {
          if (hs.peakFor !== p.sim) {
            hs.peak = { grid: flattenGrid(g.peak), nx: g.nx, ny: g.ny, cell: g.cell };
            hs.peakFor = p.sim;
            hs.canvas = paintHeat(hs.peak, hs.canvas);
            hs.lastLive = -1;
          } else if (hs.lastLive !== -1 || !hs.canvas) {
            hs.canvas = paintHeat(hs.peak!, hs.canvas);
            hs.lastLive = -1;
          }
          heat = hs.peak;
        } else if (frame) {
          if (!hs.live || hs.live.nx !== g.nx || hs.live.ny !== g.ny) {
            hs.live = { grid: new Float32Array(g.nx * g.ny), nx: g.nx, ny: g.ny, cell: g.cell };
            hs.tmp = new Float32Array(g.nx * g.ny);
          }
          if (now - hs.lastLive > 100 || hs.lastLive === -1) {
            computeLiveDensity(frame, g.nx, g.ny, g.cell, hs.live.grid, hs.tmp!);
            hs.canvas = paintHeat(hs.live, hs.canvas);
            hs.lastLive = now;
          }
          heat = hs.live;
        }
      }

      // per-room agent counts (10 Hz)
      if (frame && now - roomCountsRef.current.t > 100) {
        roomCountsRef.current = { t: now, v: countRooms(p.building, frame) };
      }
      const exitPercent = p.sim
        ? Object.fromEntries(Object.entries(p.sim.exit_utilization).map(([k, v]) => [k, v.percent]))
        : null;

      drawScene(ctx, {
        building: p.building,
        view: viewRef.current,
        w, h, dpr,
        clock: (now - t0) / 1000,
        agents: frame,
        heatCanvas: heat ? hs.canvas : null,
        heat,
        showPaths: p.showPaths,
        showLabels: p.showLabels,
        bottleneck: p.sim ? p.sim.bottleneck : null,
        selectedExit: p.selectedExit,
        hoverExit: hoverExit.current,
        roomCounts: roomCountsRef.current.v,
        exitPercent,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- interaction: wheel zoom, drag pan, hover, click
  useEffect(() => {
    const canvas = canvasRef.current!;
    let drag: { x: number; y: number; moved: boolean } | null = null;

    const pos = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (!v) return;
      const { x, y } = pos(e);
      const k = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.min(80, Math.max(3, v.scale * k));
      const wx = (x - v.ox) / v.scale, wy = (y - v.oy) / v.scale;
      viewRef.current = { scale: ns, ox: x - wx * ns, oy: y - wy * ns };
      userView.current = true;
    };
    const describe = (e: MouseEvent) => {
      const p = propsRef.current;
      const v = viewRef.current;
      if (!p.building || !v) return null;
      const { x, y } = pos(e);
      const wpt = toWorld(v, x, y);
      const ex = hitExit(p.building, wpt.x, wpt.y);
      if (ex) {
        const u = p.sim?.exit_utilization[ex.id];
        const lines = [`Width ${ex.width.toFixed(2)} m`, ex.blocked ? 'BLOCKED' : `Flow capacity ≈ ${(ex.width * 1.3).toFixed(1)} persons/s`];
        if (u) lines.push(`${u.count} agents used it (${u.percent.toFixed(1)}%)`);
        return { id: ex.id, tip: { x, y, title: ex.label, lines } };
      }
      const room = hitRoom(p.building, wpt.x, wpt.y);
      if (room) {
        const cnt = roomCountsRef.current.v?.[room.id];
        return { id: null, tip: { x, y, title: room.name, lines: [`${room.width.toFixed(1)} × ${room.height.toFixed(1)} m`, `${cnt ?? room.occupancy} agents inside now`, `${room.occupancy} at start`] } };
      }
      const cor = p.building.corridors.find((c) => wpt.x >= c.x && wpt.x <= c.x + c.width && wpt.y >= c.y && wpt.y <= c.y + c.height);
      if (cor) return { id: null, tip: { x, y, title: cor.name, lines: cor.kind === 'corridor' ? [`Clear width ${cor.height.toFixed(2)} m`] : [`${cor.width.toFixed(0)} × ${cor.height.toFixed(0)} m`] } };
      return { id: null, tip: null };
    };
    const onDown = (e: MouseEvent) => { const { x, y } = pos(e); drag = { x, y, moved: false }; };
    const onMove = (e: MouseEvent) => {
      const v = viewRef.current;
      if (!v) return;
      if (drag) {
        const { x, y } = pos(e);
        const dx = x - drag.x, dy = y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          viewRef.current = { ...v, ox: v.ox + dx, oy: v.oy + dy };
          userView.current = true;
          drag.x = x; drag.y = y;
          setTip(null);
          return;
        }
      }
      const d = describe(e);
      hoverExit.current = d?.id ?? null;
      canvas.style.cursor = d?.id ? 'pointer' : drag ? 'grabbing' : 'grab';
      setTip((prev) => {
        if (!d?.tip) return prev ? null : prev;
        return d.tip;
      });
    };
    const onUp = (e: MouseEvent) => {
      if (drag && !drag.moved) {
        const d = describe(e);
        propsRef.current.onSelectExit(d?.id && d.id !== propsRef.current.selectedExit ? d.id : null);
      }
      drag = null;
    };
    const onLeave = () => { drag = null; hoverExit.current = null; setTip(null); };
    const onDbl = () => { userView.current = false; viewRef.current = null; };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('dblclick', onDbl);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }, []);

  const zoom = (k: number) => {
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    if (!v) return;
    const ns = Math.min(80, Math.max(3, v.scale * k));
    const wx = (w / 2 - v.ox) / v.scale, wy = (h / 2 - v.oy) / v.scale;
    viewRef.current = { scale: ns, ox: w / 2 - wx * ns, oy: h / 2 - wy * ns };
    userView.current = true;
  };
  const fit = () => { userView.current = false; viewRef.current = null; };

  return (
    <div className="floorplan" ref={wrapRef}>
      <canvas ref={canvasRef} />
      {tip && (
        <div className="tooltip" style={{ left: Math.min(tip.x + 14, sizeRef.current.w - 190), top: Math.max(tip.y - 8, 8) }}>
          <div className="tooltip-title">{tip.title}</div>
          {tip.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <div className="zoom-controls">
        <button onClick={() => zoom(1.25)} title="Zoom in" aria-label="Zoom in">+</button>
        <button onClick={() => zoom(0.8)} title="Zoom out" aria-label="Zoom out">−</button>
        <button onClick={fit} title="Fit to view (or double-click)" aria-label="Fit to view">⌂</button>
      </div>
    </div>
  );
}
