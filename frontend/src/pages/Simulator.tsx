import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Vignette } from '@react-three/postprocessing';
import { useMultiFloorSim } from '../state/useMultiFloorSim';
import ParameterPanel from '../components/ParameterPanel';
import RecommendationList from '../components/RecommendationList';
import BottleneckPanel from '../components/BottleneckPanel';
import MetricsCard from '../components/MetricsCard';
import FloorPlan from '../components/FloorPlan';
import { LayerControls } from '../components/Heatmap';
import AgentSimulation from '../components/AgentSimulation';
import Copilot from '../components/Copilot';
import SceneLighting from '../three/SceneLighting';
import CameraRig from '../three/CameraRig';
import Building3D from '../three/Building3D';
import Agents3D from '../three/Agents3D';
import Heatmap3D from '../three/Heatmap3D';
import { api } from '../api/client';
import { fmtClock, fmtSigned } from '../utils/format';
import type { CameraPresetT } from '../three/scene-utils';
import type { CopilotMessage, HeatMode, MultiFloorResult } from '../types';
import './Simulator.enhancements.css';

type Route = 'home' | 'simulator';
type ViewMode = '3d' | '2d';

/* ────────────────────────────────────────────────────────────────────────────
   Constants
   ──────────────────────────────────────────────────────────────────────────── */

const CAMERA_PRESETS: CameraPresetT[] = ['orbit', 'top', 'iso', 'floor'];
const HEAT_MODES: HeatMode[] = ['off', 'peak', 'live'];

const CAMERA_HINT: Record<string, string> = {
  orbit: 'Orbit freely around the building',
  top: 'Top-down plan view',
  iso: 'Isometric overview',
  floor: 'Focus on the selected floor',
};
const HEAT_HINT: Record<string, string> = {
  off: 'Hide the density heatmap',
  peak: 'Peak density reached during the run',
  live: 'Density at the current playback time',
};

const SECTIONS = [
  { id: 'metrics', label: 'Metrics' },
  { id: 'bottlenecks', label: 'Bottlenecks' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'compare', label: 'Compare' },
  { id: 'copilot', label: 'Copilot' },
] as const;

const COPILOT_SUGGESTIONS = [
  "What's the biggest bottleneck?",
  'Which exit is most congested?',
  'How can I reduce clearance time?',
];

const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'Enter'], label: 'Run simulation' },
  { keys: ['1'], label: '3D simulation view' },
  { keys: ['2'], label: '2D analysis view' },
  { keys: ['C'], label: 'Cycle camera preset' },
  { keys: ['H'], label: 'Cycle heatmap mode' },
  { keys: ['L'], label: 'Toggle labels' },
  { keys: ['['], label: 'Floor down' },
  { keys: [']'], label: 'Floor up' },
  { keys: ['I'], label: 'Isolate selected floor' },
  { keys: ['F'], label: 'Fullscreen viewport' },
  { keys: ['Esc'], label: 'Clear exit selection' },
  { keys: ['?'], label: 'Show this panel' },
];

const ICON_PATHS = {
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10',
  play: 'M7 5l12 7-12 7z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert:
    'M12 8v5M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  pin: 'M12 17v5M8 3h8l-1 6 3 4H6l3-4z',
  down: 'M12 5v14M6 13l6 6 6-6',
  up: 'M12 19V5M6 11l6-6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
} as const;
type IconName = keyof typeof ICON_PATHS;

/* ────────────────────────────────────────────────────────────────────────────
   Small helpers & presentational components
   ──────────────────────────────────────────────────────────────────────────── */

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

const sumOf = (a: unknown): number =>
  Array.isArray(a) ? a.reduce((s: number, n: unknown) => s + (Number(n) || 0), 0) : 0;

function cycle<T>(list: T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length];
}

function delta(base: number, cur: number): { pct: number; dir: 'better' | 'worse' | 'flat' } {
  if (!Number.isFinite(base) || base === 0) return { pct: 0, dir: 'flat' };
  const pct = ((cur - base) / base) * 100;
  if (Math.abs(pct) < 0.05) return { pct: 0, dir: 'flat' };
  return { pct, dir: pct < 0 ? 'better' : 'worse' };
}

type Toast = {
  id: number;
  tone: 'good' | 'info' | 'bad';
  text: string;
  action?: { label: string; onClick: () => void };
};

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>, ttl = 4500) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

function Section({ id, num, kicker, title, children }: {
  id: string; num: string; kicker: string; title: string; children: ReactNode;
}) {
  return (
    <section id={`sec-${id}`} className="scroll-section">
      <div className="section-num">{num} — {kicker}</div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function HeatLegend({ mode }: { mode: HeatMode }) {
  return (
    <div className="wy-legend" role="img" aria-label="Density legend, from empty to critical crowding">
      <div className="wy-legend-head">
        <span>Density</span>
        <b>{mode === 'live' ? 'Live' : 'Peak'}</b>
      </div>
      <div className="wy-legend-bar" />
      <div className="wy-legend-scale">
        <span style={{ left: '0%' }}>0</span>
        <span style={{ left: '62.5%' }}>2.5</span>
        <span style={{ left: '100%' }}>4+ /m²</span>
      </div>
    </div>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="wy-modal-backdrop" onMouseDown={onClose}>
      <div
        className="wy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wy-shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="wy-modal-head">
          <h3 id="wy-shortcuts-title">Keyboard shortcuts</h3>
          <button ref={closeRef} className="wy-icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <ul className="wy-shortcuts">
          {SHORTCUTS.map((s) => (
            <li key={s.label}>
              <span>{s.label}</span>
              <span className="wy-keys">{s.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CompareRow({ label, base, cur, format }: {
  label: string; base: number; cur: number; format: (v: number) => string;
}) {
  const d = delta(base, cur);
  const max = Math.max(base, cur, 1e-9);
  return (
    <div className="wy-cmp-row">
      <div className="wy-cmp-label">{label}</div>
      <div className="wy-cmp-bars">
        <div className="wy-cmp-line">
          <span className="wy-cmp-tag">Baseline</span>
          <div className="wy-cmp-track"><div className="wy-cmp-fill base" style={{ width: `${(base / max) * 100}%` }} /></div>
          <span className="wy-cmp-val">{format(base)}</span>
        </div>
        <div className="wy-cmp-line">
          <span className="wy-cmp-tag">Current</span>
          <div className="wy-cmp-track"><div className={`wy-cmp-fill cur ${d.dir}`} style={{ width: `${(cur / max) * 100}%` }} /></div>
          <span className="wy-cmp-val">{format(cur)}</span>
        </div>
      </div>
      <div className={`wy-cmp-delta ${d.dir}`}>
        {d.dir === 'flat' ? (
          'No change'
        ) : (
          <>
            <Icon name={d.dir === 'better' ? 'down' : 'up'} size={13} />
            {Math.abs(d.pct).toFixed(1)}%
            <span className="wy-sr">{d.dir === 'better' ? ' improvement' : ' regression'}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ScenarioCompare({ baseline, current }: { baseline: MultiFloorResult; current: MultiFloorResult }) {
  const same =
    delta(baseline.clearance_time, current.clearance_time).dir === 'flat' &&
    delta(baseline.max_density, current.max_density).dir === 'flat';
  const shifted = baseline.bottleneck.label !== current.bottleneck.label;
  return (
    <div className="wy-compare">
      {same && (
        <div className="wy-note">
          Baseline and current design match. Change a parameter and run again to see the difference.
        </div>
      )}
      <CompareRow label="Clearance time" base={baseline.clearance_time} cur={current.clearance_time} format={fmtClock} />
      <CompareRow label="Peak density" base={baseline.max_density} cur={current.max_density} format={(v) => `${v.toFixed(1)}/m²`} />
      <div className="wy-cmp-row">
        <div className="wy-cmp-label">Bottleneck</div>
        <div className="wy-cmp-text">
          <div><span className="wy-cmp-tag">Baseline</span><span>{baseline.bottleneck.label}</span></div>
          <div><span className="wy-cmp-tag">Current</span><span>{current.bottleneck.label}</span></div>
        </div>
        <div className={`wy-cmp-delta ${shifted ? 'info' : 'flat'}`}>{shifted ? 'Shifted' : 'Unchanged'}</div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────────────── */

export default function Simulator({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const sim = useMultiFloorSim();
  const {
    health, config, params, updateParams, setFloorCount, setTotalOccupancy, toggleBlockedExit, toggleBlockedStair,
    building, prediction, predictionLoading, result, trajectories, status, error, run, baseline, pinBaseline,
    recommendations, recStatus, fetchRecommendations, applyAndRun, selectedFloor, setSelectedFloor, playback,
  } = sim;

  const [view, setView] = useState<ViewMode>('3d');
  const [camPreset, setCamPreset] = useState<CameraPresetT>('iso');
  const [heatMode, setHeatMode] = useState<HeatMode>('peak');
  const [floorVisibility, setFloorVisibility] = useState<'all' | 'isolate'>('all');
  const [showLabels, setShowLabels] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [selectedExit, setSelectedExit] = useState<string | null>(null);

  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([]);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const msgId = useRef(0);

  const [helpOpen, setHelpOpen] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const viewportRef = useRef<HTMLDivElement>(null);
  const { toasts, push, dismiss } = useToasts();

  const running = status === 'running';
  const hasResult = !!result;
  const bw = building?.floors?.[0]?.width ?? 64;
  const bh = building?.floors?.[0]?.height ?? 40;
  const radius = Math.max(bw, bh) * 0.85;
  const floorHeight = params.floor_height;
  const floorCount = building?.floors?.length ?? 0;

  const runSim = useCallback(() => { void run(); }, [run]);

  /* ── Copilot ─────────────────────────────────────────────────────────── */
  const handleSendCopilot = async (text: string) => {
    msgId.current += 1;
    setCopilotMessages((m) => [...m, { id: msgId.current, role: 'user', text }]);
    setCopilotBusy(true);
    try {
      const groundParams = building?.floors?.[0]?.params ?? {
        occupancy: params.occupancy[0] ?? 140, corridor_width: params.corridor_width, exit_width: params.exit_width,
        num_exits: params.num_exits, agent_speed: params.agent_speed, blocked_exits: params.blocked_exits, seed: params.seed,
      };
      const reply = await api.copilot(text, groundParams);
      msgId.current += 1;
      setCopilotMessages((m) => [...m, { id: msgId.current, role: 'copilot', text: reply.reply }]);
    } catch {
      msgId.current += 1;
      setCopilotMessages((m) => [...m, { id: msgId.current, role: 'copilot', text: "Sorry - I couldn't reach the simulator just now." }]);
    } finally {
      setCopilotBusy(false);
    }
  };

  const selFloorBuilding = building?.floors?.[selectedFloor] ?? null;
  const selFloorResult = result?.floors?.[selectedFloor] ?? null;
  const selFloorTraj = trajectories[selectedFloor] ?? null;

  /* ── Navigation, fullscreen, export ──────────────────────────────────── */
  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = viewportRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      push({ tone: 'info', text: "Fullscreen isn't available in this browser." });
    }
  }, [push]);

  const exportResults = () => {
    if (!result) return;
    const blob = new Blob(
      [JSON.stringify({ exported_at: new Date().toISOString(), params, result }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wayout-simulation-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    push({ tone: 'info', text: 'Results exported as JSON.' });
  };

  const handlePinBaseline = () => {
    pinBaseline();
    push({ tone: 'info', text: 'Current design pinned as baseline.' });
  };

  /* ── Effects ─────────────────────────────────────────────────────────── */

  // Elapsed timer while a run is in flight.
  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const t0 = performance.now();
    const id = window.setInterval(() => setElapsed(Math.floor((performance.now() - t0) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [running]);

  // Tell the person when a run finishes, and offer a jump to the results.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running && !error && result) {
      push(
        {
          tone: result.completed ? 'good' : 'bad',
          text: result.completed
            ? `Simulation complete. Everyone cleared in ${fmtClock(result.clearance_time)}.`
            : 'Simulation finished, but not everyone reached an exit.',
          action: { label: 'View results', onClick: () => scrollToSection('metrics') },
        },
        7000,
      );
    }
    wasRunning.current = running;
  }, [running, error, result, push, scrollToSection]);

  // Keep fullscreen state in sync with the browser.
  useEffect(() => {
    const onChange = () => setIsFs(document.fullscreenElement === viewportRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Highlight the section currently in view.
  useEffect(() => {
    if (!hasResult) return;
    const els = SECTIONS.map((s) => document.getElementById(`sec-${s.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActiveSection(e.target.id.replace('sec-', ''))),
      { rootMargin: '-35% 0px -55% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [hasResult]);

  // Keyboard shortcuts (registered once, reads the latest values from a ref).
  const latest = useRef({ running, runSim, selectedFloor, floorCount, setSelectedFloor, toggleFullscreen });
  latest.current = { running, runSim, selectedFloor, floorCount, setSelectedFloor, toggleFullscreen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = latest.current;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (el?.closest('.scroll-copilot')) return;
        e.preventDefault();
        if (!s.running) s.runSim();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;

      switch (e.key) {
        case '?': setHelpOpen(true); break;
        case 'Escape': setSelectedExit(null); break;
        case '1': setView('3d'); break;
        case '2': setView('2d'); break;
        case 'c': case 'C': setCamPreset((c) => cycle(CAMERA_PRESETS, c)); break;
        case 'h': case 'H': setHeatMode((h) => cycle(HEAT_MODES, h)); break;
        case 'l': case 'L': setShowLabels((v) => !v); break;
        case 'i': case 'I': if (s.floorCount > 1) setFloorVisibility((v) => (v === 'all' ? 'isolate' : 'all')); break;
        case 'f': case 'F': void s.toggleFullscreen(); break;
        case '[': s.setSelectedFloor(Math.max(0, s.selectedFloor - 1)); break;
        case ']': s.setSelectedFloor(Math.min(Math.max(0, s.floorCount - 1), s.selectedFloor + 1)); break;
        default: return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── Derived ─────────────────────────────────────────────────────────── */
  const verdict = useMemo(() => {
    if (!result) return null;
    const d = result.max_density;
    if (!result.completed)
      return { tone: 'bad', title: 'Evacuation incomplete', sub: 'The run ended before every occupant reached an exit.' };
    if (d > 4)
      return { tone: 'bad', title: 'Cleared, but crowding was critical', sub: `Peak density hit ${d.toFixed(1)}/m², above the 4/m² critical level.` };
    if (d > 2.5)
      return { tone: 'warn', title: 'Cleared with congestion', sub: `Peak density reached ${d.toFixed(1)}/m², above the 2.5/m² warning level.` };
    return { tone: 'good', title: 'Clean evacuation', sub: `Peak density stayed at ${d.toFixed(1)}/m², below the 2.5/m² warning level.` };
  }, [result]);

  const totalOcc = sumOf(params.occupancy);
  const blockedCount = Array.isArray(params.blocked_exits) ? params.blocked_exits.length : 0;
  const showReady = !result && !running && !error;

  return (
    <div className="simulator">
      <a className="wy-skip" href="#sec-metrics" onClick={(e) => { if (!hasResult) e.preventDefault(); }}>
        Skip to results
      </a>

      <header className="header">
        <button className="brand" onClick={() => onNavigate('home')} aria-label="Wayout home">
          <span className="brand-mark" />
          <span className="brand-name">WAYOUT</span>
        </button>
        <h1 className="wy-sr">Evacuation simulator</h1>
        <div className="header-center">
          <span className="mode-badge" role="status">
            <span
              className={`dot ${health === 'ok' ? 'wy-pulse' : ''}`}
              style={{ color: health === 'ok' ? '#4ade80' : health === 'checking' ? '#eab308' : '#ef4444' }}
            />
            {health === 'ok' ? 'Connected' : health === 'checking' ? 'Connecting…' : 'Backend offline'}
          </span>
          {config && <span className="chip"><span className="chip-k">{config.simulation_engine}</span></span>}
        </div>
        <div className="header-right">
          <button className="btn ghost small wy-btn-ic" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">
            <Icon name="keyboard" />
            <span className="wy-hide-sm">Shortcuts</span>
          </button>
          <button className="btn ghost small" onClick={() => onNavigate('home')}>Home</button>
        </div>
      </header>

      <div className="main">
        <ParameterPanel
          params={params}
          onChange={updateParams}
          onFloorCount={setFloorCount}
          onTotalOccupancy={setTotalOccupancy}
          onToggleExit={toggleBlockedExit}
          onToggleStair={toggleBlockedStair}
          onRun={run}
          running={running}
          prediction={prediction}
          predictionLoading={predictionLoading}
        />

        <div className="canvas-wrap">
          <div className="viewport" ref={viewportRef} role="region" aria-label="Evacuation viewport">
            {view === '3d' ? (
              <Canvas
                shadows
                dpr={[1, 1.75]}
                className="viewport-canvas"
                camera={{ fov: 42, position: [radius, radius, radius] }}
                gl={{ antialias: true, powerPreference: 'high-performance' }}
              >
                <color attach="background" args={['#000000']} />
                <fog attach="fog" args={['#000000', radius * 2.4, radius * 6]} />
                <SceneLighting />
                <CameraRig preset={camPreset} focusFloor={selectedFloor} floorHeight={floorHeight} radius={radius} />
                {building?.floors.map((f, i) => {
                  const isVisible = floorVisibility === 'all' || i === selectedFloor;
                  const opacity = floorVisibility === 'all' ? (i === selectedFloor ? 1 : 0.32) : 1;
                  const floorResult = result?.floors?.[i] ?? null;
                  return (
                    <group key={f.floor} visible={isVisible}>
                      <Building3D
                        building={f}
                        floorY={i * floorHeight}
                        opacity={opacity}
                        showLabels={showLabels}
                        selectedExit={selectedExit}
                        onSelectExit={setSelectedExit}
                      />
                      {floorResult && (
                        <>
                          <Heatmap3D
                            densityGrid={floorResult.density_grid}
                            trajectory={trajectories[i] ?? null}
                            floorY={i * floorHeight}
                            width={f.width}
                            height={f.height}
                            mode={heatMode}
                            timeRef={playback.timeRef}
                          />
                          <Agents3D
                            trajectory={trajectories[i] ?? null}
                            floorY={i * floorHeight}
                            ox={-f.width / 2}
                            oz={-f.height / 2}
                            timeRef={playback.timeRef}
                            visible={isVisible}
                          />
                        </>
                      )}
                    </group>
                  );
                })}
                <EffectComposer>
                  <Vignette eskil={false} offset={0.28} darkness={0.55} />
                </EffectComposer>
              </Canvas>
            ) : (
              <FloorPlan
                building={selFloorBuilding}
                sim={selFloorResult}
                traj={selFloorTraj}
                timeRef={playback.timeRef}
                heatMode={heatMode}
                showPaths={showPaths}
                showLabels={showLabels}
                selectedExit={selectedExit}
                onSelectExit={setSelectedExit}
              />
            )}

            {/* Top HUD */}
            <div className="viewport-hud-top">
              <div className="segmented" role="group" aria-label="View mode">
                <button className={view === '3d' ? 'on' : ''} aria-pressed={view === '3d'} title="3D simulation (1)" onClick={() => setView('3d')}>3D Simulation</button>
                <button className={view === '2d' ? 'on' : ''} aria-pressed={view === '2d'} title="2D analysis (2)" onClick={() => setView('2d')}>2D Analysis</button>
              </div>
              <div className="wy-hud-right">
                {view === '3d' && (
                  <div className="cam-presets" role="group" aria-label="Camera preset">
                    {CAMERA_PRESETS.map((p) => (
                      <button key={p} className={camPreset === p ? 'on' : ''} aria-pressed={camPreset === p} title={`${CAMERA_HINT[p] ?? p} (C to cycle)`} onClick={() => setCamPreset(p)}>
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
                <button className="wy-icon-btn" onClick={() => void toggleFullscreen()} aria-label={isFs ? 'Exit fullscreen' : 'Fullscreen viewport'} title="Fullscreen (F)">
                  <Icon name={isFs ? 'shrink' : 'expand'} />
                </button>
              </div>
            </div>

            {selectedExit && (
              <div className="wy-selected-exit">
                <span>Exit {selectedExit} selected</span>
                <button className="wy-chip-x" onClick={() => setSelectedExit(null)} aria-label="Clear exit selection" title="Clear (Esc)">
                  <Icon name="close" size={13} />
                </button>
              </div>
            )}

            {/* Floor rail */}
            {building && building.n_floors > 1 && (
              <nav className="wy-rail" aria-label="Floors">
                {[...building.floors].reverse().map((f) => {
                  const agents = result?.floors?.[f.floor]?.total_agents;
                  const name = f.floor === 0 ? 'Ground floor' : `Floor ${f.floor}`;
                  return (
                    <button
                      key={f.floor}
                      className={selectedFloor === f.floor ? 'on' : ''}
                      aria-pressed={selectedFloor === f.floor}
                      aria-label={name}
                      title={`${name}${agents != null ? `, ${agents} occupants` : ''}  ([ and ] to change)`}
                      onClick={() => setSelectedFloor(f.floor)}
                    >
                      <span className="wy-rail-num">{f.floor === 0 ? 'G' : f.floor}</span>
                      {agents != null && <span className="wy-rail-sub">{agents}</span>}
                    </button>
                  );
                })}
                <span className="wy-rail-sep" />
                <button
                  className={`wy-rail-iso ${floorVisibility === 'isolate' ? 'on' : ''}`}
                  aria-pressed={floorVisibility === 'isolate'}
                  title="Show only the selected floor (I)"
                  onClick={() => setFloorVisibility((v) => (v === 'all' ? 'isolate' : 'all'))}
                >
                  ISO
                </button>
              </nav>
            )}

            {/* Bottom HUD */}
            <div className="viewport-hud-bottom">
              {view === '3d' ? (
                <div className="heat-modes" role="group" aria-label="Heatmap mode">
                  {HEAT_MODES.map((m) => (
                    <button key={m} className={heatMode === m ? 'on' : ''} aria-pressed={heatMode === m} title={`${HEAT_HINT[m] ?? m} (H to cycle)`} onClick={() => setHeatMode(m)}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                  <button className={showLabels ? 'on' : ''} aria-pressed={showLabels} title="Toggle labels (L)" onClick={() => setShowLabels((v) => !v)}>LABELS</button>
                </div>
              ) : (
                <LayerControls
                  mode={heatMode} onMode={setHeatMode}
                  showPaths={showPaths} onPaths={setShowPaths}
                  showLabels={showLabels} onLabels={setShowLabels}
                  hasResult={!!selFloorResult}
                />
              )}
              {view === '3d' && hasResult && heatMode !== 'off' && <HeatLegend mode={heatMode} />}
            </div>

            {/* States */}
            {showReady && (
              <div className="busy wy-ready">
                <div className="busy-box wy-ready-box">
                  <div className="busy-title">Ready to simulate</div>
                  <div className="busy-sub">Tune the parameters on the left, then run the evacuation.</div>
                  <div className="wy-chip-row">
                    <span className="wy-pill"><b>{params.n_floors}</b>{params.n_floors > 1 ? 'floors' : 'floor'}</span>
                    <span className="wy-pill"><b>{totalOcc}</b>occupants</span>
                    <span className="wy-pill"><b>{params.num_exits}</b>{params.num_exits === 1 ? 'exit' : 'exits'}</span>
                    {blockedCount > 0 && <span className="wy-pill warn"><b>{blockedCount}</b>blocked</span>}
                  </div>
                  <div className="wy-estimate" aria-live="polite">
                    {predictionLoading ? (
                      'Estimating clearance time…'
                    ) : prediction ? (
                      <>AI estimate: <b>{fmtClock(prediction.predicted_clearance_time)}</b> (typically ±{prediction.expected_error_s.toFixed(0)}s)</>
                    ) : null}
                  </div>
                  <button className="wy-run-cta" onClick={runSim}>
                    <Icon name="play" size={15} />
                    Run simulation
                    <span className="wy-keys"><kbd>{MOD}</kbd><kbd>↵</kbd></span>
                  </button>
                </div>
              </div>
            )}
            {running && (
              <div className="busy" role="status" aria-live="polite">
                <div className="busy-box">
                  <div className="busy-title">Running the evacuation…</div>
                  <div className="busy-sub">
                    Simulating {params.n_floors} floor{params.n_floors > 1 ? 's' : ''}
                    {params.n_floors > 1 ? ', chained through the stairwells.' : '.'}
                  </div>
                  <div className="indeterminate" />
                  <div className="wy-elapsed">Elapsed {fmtClock(elapsed)}</div>
                </div>
              </div>
            )}
            {error && !running && (
              <div className="busy wy-error" role="alert">
                <div className="busy-box wy-error-box">
                  <div className="error-box">{error}</div>
                  <button className="btn outline small wy-btn-ic" onClick={runSim}>
                    <Icon name="refresh" size={14} /> Try again
                  </button>
                </div>
              </div>
            )}
          </div>

          {result && selFloorTraj && (
            <div className="bottom">
              <AgentSimulation playback={playback} traj={selFloorTraj} total={selFloorResult?.total_agents ?? 0} running={running} />
            </div>
          )}
        </div>
      </div>

      {result && verdict && (
        <div className="scroll-sections">
          <nav className="wy-section-nav" aria-label="Result sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={activeSection === s.id ? 'on' : ''}
                aria-current={activeSection === s.id ? 'true' : undefined}
                onClick={() => scrollToSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className={`wy-verdict ${verdict.tone}`}>
            <div className="wy-verdict-icon"><Icon name={verdict.tone === 'good' ? 'check' : 'alert'} size={22} /></div>
            <div className="wy-verdict-body">
              <div className="wy-verdict-title">{verdict.title}</div>
              <div className="wy-verdict-sub">{verdict.sub}</div>
              <div className="wy-chip-row left">
                <span className="wy-pill"><b>{fmtClock(result.clearance_time)}</b>to clear</span>
                <span className="wy-pill"><b>{result.total_agents}</b>occupants</span>
                <span className="wy-pill"><b>{result.n_floors}</b>{result.n_floors > 1 ? 'floors' : 'floor'}</span>
              </div>
            </div>
            <div className="wy-verdict-actions">
              <button className="btn outline small wy-btn-ic" onClick={runSim} disabled={running}>
                <Icon name="refresh" size={14} /> Run again
              </button>
              <button className="btn ghost small wy-btn-ic" onClick={exportResults}>
                <Icon name="download" size={14} /> Export JSON
              </button>
            </div>
          </div>

          <Section id="metrics" num="01" kicker="LIVE METRICS" title="Whole-building metrics">
            <div className="metrics-grid">
              <MetricsCard label="Clearance time" value={fmtClock(result.clearance_time)} tone={result.completed ? 'good' : 'bad'} />
              <MetricsCard
                label="AI predicted clearance"
                value={prediction ? fmtClock(prediction.predicted_clearance_time) : '—'}
                tone="accent"
                sub={prediction
                  ? `${fmtSigned(prediction.predicted_clearance_time - result.clearance_time)}s vs. actual · typ. ±${prediction.expected_error_s.toFixed(0)}s`
                  : undefined}
              />
              <MetricsCard label="Total occupants" value={result.total_agents} />
              <MetricsCard label="Peak density" value={result.max_density.toFixed(1)} unit="/m²" tone={result.max_density > 4 ? 'bad' : result.max_density > 2.5 ? 'warn' : 'good'} />
              <MetricsCard label="Floors" value={result.n_floors} />
              <MetricsCard label="Status" value={result.completed ? 'Completed' : 'Incomplete'} tone={result.completed ? 'good' : 'bad'} />
            </div>
          </Section>

          <Section id="bottlenecks" num="02" kicker="BOTTLENECKS" title="Where the building constrains egress">
            <BottleneckPanel global={result.bottleneck} byFloor={result.bottlenecks_by_floor} />
          </Section>

          <Section id="recommendations" num="03" kicker="WAYOUT AI" title="Recommendations">
            <p className="dim" style={{ marginBottom: 20, maxWidth: 640 }}>
              Ranked by {result.n_floors > 1 ? 'real re-simulation of each candidate change' : "Wayout's trained ML surrogate"},
              against the bottleneck actually detected above - never a canned suggestion.
            </p>
            <RecommendationList recommendations={recommendations} status={recStatus} onFetch={fetchRecommendations} onApply={applyAndRun} applying={running} />
          </Section>

          <Section id="compare" num="04" kicker="SCENARIO COMPARISON" title="Baseline vs. current design">
            {baseline ? (
              <ScenarioCompare baseline={baseline.result} current={result} />
            ) : (
              <div className="empty">
                No baseline yet. Pin this design, change a parameter, then run again to compare.
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <button className="btn outline small wy-btn-ic" onClick={handlePinBaseline}>
                <Icon name="pin" size={14} /> {baseline ? 'Replace baseline with current design' : 'Pin current design as baseline'}
              </button>
            </div>
          </Section>

          <Section id="copilot" num="05" kicker="COPILOT" title="Ask Wayout">
            <p className="dim" style={{ marginBottom: 16, maxWidth: 640 }}>
              Reasons about the ground floor, where the building&rsquo;s real exits are. Every number it cites came
              from the simulation above - it can&rsquo;t invent one.
            </p>
            {copilotMessages.length === 0 && (
              <div className="wy-suggest" role="group" aria-label="Suggested questions">
                {COPILOT_SUGGESTIONS.map((q) => (
                  <button key={q} className="wy-suggest-chip" disabled={copilotBusy} onClick={() => void handleSendCopilot(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div className="scroll-copilot">
              <Copilot messages={copilotMessages} busy={copilotBusy} onSend={handleSendCopilot} />
            </div>
          </Section>
        </div>
      )}

      {helpOpen && <ShortcutsModal onClose={() => setHelpOpen(false)} />}

      <div className="wy-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`wy-toast ${t.tone}`}>
            <Icon name={t.tone === 'bad' ? 'alert' : 'check'} size={16} />
            <span>{t.text}</span>
            {t.action && (
              <button className="wy-toast-action" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
            <button className="wy-toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
