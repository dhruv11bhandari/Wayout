import type {
  Building, CopilotReply, Health, ModelInfo, MultiFloorBuilding, MultiFloorParams,
  MultiFloorResult, OptimizationResult, Params, Prediction, PredictionMulti, Recommendation, RuntimeConfig, ScenarioRecord, SimResult,
} from '../types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

const q = (p: Params): string =>
  new URLSearchParams({
    occupancy: String(p.occupancy),
    corridor_width: String(p.corridor_width),
    exit_width: String(p.exit_width),
    num_exits: String(p.num_exits),
    agent_speed: String(p.agent_speed),
    blocked_exits: p.blocked_exits.join(','),
    seed: String(p.seed),
  }).toString();

const qMulti = (p: MultiFloorParams): string =>
  new URLSearchParams({
    n_floors: String(p.n_floors),
    occupancy_total: String(p.occupancy.reduce((a, b) => a + b, 0)),
    corridor_width: String(p.corridor_width),
    exit_width: String(p.exit_width),
    stair_width: String(p.stair_width),
    num_exits: String(p.num_exits),
    agent_speed: String(p.agent_speed),
    floor_height: String(p.floor_height),
    blocked_exits: p.blocked_exits.join(','),
    seed: String(p.seed),
  }).toString();

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  health: () => req<Health>('/api/health'),
  config: () => req<RuntimeConfig>('/api/config'),
  building: (p: Params) => req<Building>(`/api/building?${q(p)}`),
  predict: (p: Params) => req<Prediction>('/api/predict', post(p)),
  simulate: (p: Params, record = true) => req<SimResult>('/api/simulate', post({ ...p, record })),
  saveScenario: (name: string, p: Params) => req<ScenarioRecord>('/api/scenario', post({ name, params: p })),
  scenarios: () => req<{ scenarios: ScenarioRecord[] }>('/api/scenarios'),
  deleteScenario: (id: number) => req<{ ok: boolean }>(`/api/scenarios/${id}`, { method: 'DELETE' }),
  metrics: () => req<{ model: ModelInfo }>('/api/metrics'),
  reset: () => req<{ ok: boolean }>('/api/reset', post({})),
  copilot: (text: string, p: Params) => req<CopilotReply>('/api/copilot', post({ text, params: p })),

  parseDesign: async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    let res: Response;
    try {
      res = await fetch('/api/design/parse', { method: 'POST', body });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('WayOut could not reach its local API. Restart the app with start.sh, wait for both services to start, and try again.');
      }
      throw error;
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`.trim();
      try {
        const j = await res.json();
        const detail = j.detail ?? j.message;
        if (typeof detail === 'string') message = detail;
        else if (detail != null) message = JSON.stringify(detail);
      } catch { /* the server may return a non-JSON proxy error */ }
      if (res.status >= 500 && !message) message = 'The local API could not complete the upload. Restart WayOut and try again.';
      throw new Error(message);
    }
    return res.json() as Promise<ImportedDesign>;
  },
  simulateDesign: (design_id: string, occupancy: number, agent_speed: number, seed: number) =>
    req<MultiFloorResult>('/api/design/simulate', post({ design_id, occupancy, agent_speed, seed, record: true })),

  // ---------------------------------------------------------------- multi-floor
  buildingMulti: (p: MultiFloorParams) => req<MultiFloorBuilding>(`/api/building/multi?${qMulti(p)}`),
  predictMulti: (p: MultiFloorParams) => req<PredictionMulti>('/api/predict/multi', post({ params: p })),
  simulateMulti: (p: MultiFloorParams, record = true) =>
    req<MultiFloorResult>('/api/simulate/multi', post({ ...p, record })),
  recommendMulti: (p: MultiFloorParams) =>
    req<{ recommendations: Recommendation[]; baseline: { clearance_time: number; bottleneck: string } }>(
      '/api/recommend/multi', post({ params: p }),
    ),
  optimizeMulti: (p: MultiFloorParams, widening_budget_m: number) =>
    req<OptimizationResult>('/api/optimize/multi', post({ params: p, widening_budget_m })),
  recommend: (p: Params) =>
    req<{ recommendations: Recommendation[]; baseline: { clearance_time: number; bottleneck: string } }>(
      '/api/recommend', post({ params: p }),
    ),
};

export interface ImportedDesign {
  design_id: string;
  source_name: string;
  uncertainties: string[];
  building: MultiFloorBuilding;
}
