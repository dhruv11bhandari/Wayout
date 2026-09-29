import type {
  Building, CopilotReply, Health, ModelInfo, MultiFloorBuilding, MultiFloorParams,
  MultiFloorResult, Params, Prediction, PredictionMulti, Recommendation, RuntimeConfig, ScenarioRecord, SimResult,
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

  // ---------------------------------------------------------------- multi-floor
  buildingMulti: (p: MultiFloorParams) => req<MultiFloorBuilding>(`/api/building/multi?${qMulti(p)}`),
  predictMulti: (p: MultiFloorParams) => req<PredictionMulti>('/api/predict/multi', post({ params: p })),
  simulateMulti: (p: MultiFloorParams, record = true) =>
    req<MultiFloorResult>('/api/simulate/multi', post({ ...p, record })),
  recommendMulti: (p: MultiFloorParams) =>
    req<{ recommendations: Recommendation[]; baseline: { clearance_time: number; bottleneck: string } }>(
      '/api/recommend/multi', post({ params: p }),
    ),
  recommend: (p: Params) =>
    req<{ recommendations: Recommendation[]; baseline: { clearance_time: number; bottleneck: string } }>(
      '/api/recommend', post({ params: p }),
    ),
};
