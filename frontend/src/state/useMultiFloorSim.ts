import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Trajectory, usePlayback } from '../utils/playback';
import { DEFAULT_MULTI_PARAMS, WIDTH_FIELDS } from '../types';
import type {
  MultiFloorBuilding, MultiFloorParams, MultiFloorResult, OptimizationResult, PredictionMulti, Recommendation,
  RuntimeConfig, Status,
} from '../types';

export interface Baseline { params: MultiFloorParams; result: MultiFloorResult }

/** Copy ONLY the optimizer's three widths onto `p`; every other building parameter
 * (floors, occupancy, exits, hazards, speed, seed, ...) stays exactly as it was. */
export function applyOptimizedWidths(p: MultiFloorParams, r: OptimizationResult): MultiFloorParams {
  const next = { ...p };
  for (const f of WIDTH_FIELDS) next[f] = r.optimized_params[f];
  return next;
}

const designKey = (p: MultiFloorParams): string => JSON.stringify([
  p.n_floors, p.occupancy, p.corridor_width, p.exit_width, p.stair_width, p.num_exits, p.agent_speed,
  p.blocked_exits, p.blocked_stairs, p.floor_height, p.seed,
]);

/** All state for the multi-floor product: health/config, the live building preview
 * (refetched as params change), the last real simulation, per-floor Trajectory objects
 * for the 3D/2D playback, a pinned baseline for scenario comparison, and recommendations.
 * Mirrors the patterns the original single-floor App.tsx used (debounced preview, ref
 * mirror of params for callbacks, playback clock) - just re-targeted at /api/*\/multi. */
export function useMultiFloorSim() {
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [config, setConfig] = useState<RuntimeConfig | null>(null);

  const [params, setParams] = useState<MultiFloorParams>(DEFAULT_MULTI_PARAMS);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const [building, setBuilding] = useState<MultiFloorBuilding | null>(null);
  const [buildingOverride, setBuildingOverride] = useState<MultiFloorBuilding | null>(null);
  const [buildingLoading, setBuildingLoading] = useState(false);

  // Instant AI estimate of whole-building clearance time, re-fetched (debounced) as
  // params change - independent of `run()`, which is the real, slower simulation.
  const [prediction, setPrediction] = useState<PredictionMulti | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);

  const [result, setResult] = useState<MultiFloorResult | null>(null);
  const [trajectories, setTrajectories] = useState<(Trajectory | null)[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recStatus, setRecStatus] = useState<Status>('idle');

  // Smart Layout Optimizer. `optKeys` holds the designs the current result still
  // describes (the one it was computed for, and that design with the widths applied);
  // any other parameter change makes the result stale and clears it.
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);
  const [optStatus, setOptStatus] = useState<Status>('idle');
  const [optError, setOptError] = useState<string | null>(null);
  const [wideningBudget, setWideningBudget] = useState(2.0);
  const optKeys = useRef<string[]>([]);

  const [selectedFloor, setSelectedFloor] = useState(0);
  const playback = usePlayback();

  useEffect(() => {
    if (buildingOverride) return;
    let alive = true;
    const check = async () => {
      try {
        const h = await api.health();
        if (!alive) return;
        setHealth(h.status === 'ok' ? 'ok' : 'down');
        const c = await api.config();
        if (alive) setConfig(c);
      } catch {
        if (alive) setHealth('down');
      }
    };
    check();
    const iv = setInterval(check, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    let alive = true;
    setBuildingLoading(true);
    const t = setTimeout(() => {
      api.buildingMulti(params)
        .then((b) => { if (alive) setBuilding(b); })
        .catch(() => {})
        .finally(() => { if (alive) setBuildingLoading(false); });
    }, 260);
    return () => { alive = false; clearTimeout(t); };
  }, [params, buildingOverride]);

  useEffect(() => {
    let alive = true;
    setPredictionLoading(true);
    const t = setTimeout(() => {
      api.predictMulti(params)
        .then((p) => { if (alive) setPrediction(p); })
        .catch(() => { if (alive) setPrediction(null); })
        .finally(() => { if (alive) setPredictionLoading(false); });
    }, 260);
    return () => { alive = false; clearTimeout(t); };
  }, [params]);

  const clearOptimization = useCallback(() => {
    optKeys.current = [];
    setOptimization(null);
    setOptStatus('idle');
    setOptError(null);
  }, []);

  useEffect(() => {
    if (optKeys.current.length && !optKeys.current.includes(designKey(params))) clearOptimization();
  }, [params, clearOptimization]);

  const updateParams = useCallback((patch: Partial<MultiFloorParams>) => {
    setParams((p) => ({ ...p, ...patch }));
  }, []);

  const setFloorCount = useCallback((n: number) => {
    setParams((p) => {
      const total = p.occupancy.reduce((a, b) => a + b, 0) || 500;
      const base = Math.floor(total / n);
      const rem = total - base * n;
      const occupancy = Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
      const blocked_stairs = p.blocked_stairs.filter(([f]) => f < n);
      return { ...p, n_floors: n, occupancy, blocked_stairs };
    });
    setSelectedFloor((f) => Math.min(f, n - 1));
  }, []);

  const setTotalOccupancy = useCallback((total: number) => {
    setParams((p) => {
      const n = p.n_floors;
      const base = Math.floor(total / n);
      const rem = total - base * n;
      return { ...p, occupancy: Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0)) };
    });
  }, []);

  const toggleBlockedExit = useCallback((id: string) => {
    setParams((p) => ({
      ...p,
      blocked_exits: p.blocked_exits.includes(id) ? p.blocked_exits.filter((x) => x !== id) : [...p.blocked_exits, id],
    }));
  }, []);

  const toggleBlockedStair = useCallback((floor: number, id: string) => {
    setParams((p) => {
      const has = p.blocked_stairs.some(([f, s]) => f === floor && s === id);
      return {
        ...p,
        blocked_stairs: has
          ? p.blocked_stairs.filter(([f, s]) => !(f === floor && s === id))
          : [...p.blocked_stairs, [floor, id] as [number, string]],
      };
    });
  }, []);

  const applyResult = useCallback((r: MultiFloorResult) => {
    setResult(r);
    setTrajectories(r.floors.map((f) => (f.trajectories && f.agents ? new Trajectory(f) : null)));
    playback.load(r.clearance_time, true);
    setStatus('done');
  }, [playback]);

  const run = useCallback(async () => {
    setStatus('running');
    setError(null);
    setRecommendations([]);
    // A run of the optimized layout itself keeps the card (it is not stale); anything else clears it.
    if (optimization && designKey(paramsRef.current) !== designKey(applyOptimizedWidths(paramsRef.current, optimization))) {
      clearOptimization();
    }
    try {
      const r = await api.simulateMulti(paramsRef.current, true);
      applyResult(r);
      setBaseline((b) => b ?? { params: paramsRef.current, result: r });
    } catch (e: any) {
      setError(e?.message ?? 'Simulation failed.');
      setStatus('error');
    }
  }, [applyResult, optimization, clearOptimization]);

  const runImported = useCallback(async (designId: string, occupancy: number, agentSpeed: number, seed: number) => {
    setStatus('running');
    setError(null);
    setRecommendations([]);
    try {
      const r = await api.simulateDesign(designId, Math.max(10, Math.min(400, Math.round(occupancy))), agentSpeed, seed);
      applyResult(r);
      setBaseline(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not simulate this uploaded design.');
      setStatus('error');
    }
  }, [applyResult]);

  const pinBaseline = useCallback(() => {
    if (result) setBaseline({ params: paramsRef.current, result });
  }, [result]);

  const clearRun = useCallback(() => {
    setResult(null);
    setTrajectories([]);
    setStatus('idle');
    setError(null);
    setBaseline(null);
    setRecommendations([]);
    setRecStatus('idle');
    clearOptimization();
    playback.clear();
  }, [playback, clearOptimization]);

  const fetchRecommendations = useCallback(async () => {
    setRecStatus('running');
    try {
      const r = await api.recommendMulti(paramsRef.current);
      setRecommendations(r.recommendations);
      setRecStatus('done');
    } catch {
      setRecStatus('error');
    }
  }, []);

  const applyAndRun = useCallback(async (rec: Recommendation) => {
    const next = { ...paramsRef.current, ...(rec.suggested as Partial<MultiFloorParams>) } as MultiFloorParams;
    setParams(next);
    paramsRef.current = next;
    setStatus('running');
    setError(null);
    try {
      const r = await api.simulateMulti(next, true);
      applyResult(r);
      setRecommendations([]);
    } catch (e: any) {
      setError(e?.message ?? 'Simulation failed.');
      setStatus('error');
    }
  }, [applyResult]);

  const optimize = useCallback(async () => {
    const requested = paramsRef.current;
    optKeys.current = [];
    setOptStatus('running');
    setOptError(null);
    setOptimization(null);
    try {
      const r = await api.optimizeMulti(requested, wideningBudget);
      // Parameters moved while the search ran: this answer is for an old design.
      if (designKey(paramsRef.current) !== designKey(requested)) { setOptStatus('idle'); return; }
      optKeys.current = [designKey(requested), designKey(applyOptimizedWidths(requested, r))];
      setOptimization(r);
      setOptStatus('done');
    } catch (e: any) {
      setOptError(e?.message ?? 'Layout optimization failed.');
      setOptStatus('error');
    }
  }, [wideningBudget]);

  /** Move the sliders to the optimized widths; optionally run the full simulation on them. */
  const applyOptimized = useCallback(async (andRun = false) => {
    if (!optimization) return;
    const next = applyOptimizedWidths(paramsRef.current, optimization);
    setParams(next);
    paramsRef.current = next;
    if (andRun) await run();
  }, [optimization, run]);

  const optimizationApplied = !!optimization
    && designKey(params) === designKey(applyOptimizedWidths(params, optimization));

  return {
    health, config, params, updateParams, setFloorCount, setTotalOccupancy, toggleBlockedExit, toggleBlockedStair,
    setBuildingOverride,
    building: buildingOverride ?? building, buildingLoading, prediction, predictionLoading, result, trajectories, status, error, run,
    baseline, pinBaseline, clearRun, recommendations, recStatus, fetchRecommendations, applyAndRun, runImported,
    selectedFloor, setSelectedFloor, playback,
    optimization, optStatus, optError, wideningBudget, setWideningBudget, optimize, applyOptimized, optimizationApplied,
  };
}

export type MultiFloorSim = ReturnType<typeof useMultiFloorSim>;
