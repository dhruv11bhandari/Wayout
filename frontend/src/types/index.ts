export interface Params {
  occupancy: number;
  corridor_width: number;
  exit_width: number;
  num_exits: number;
  agent_speed: number;
  blocked_exits: string[];
  seed: number;
}

export const DEFAULT_PARAMS: Params = {
  occupancy: 140,
  corridor_width: 2.0,
  exit_width: 1.2,
  num_exits: 2,
  agent_speed: 1.3,
  blocked_exits: [],
  seed: 42,
};

export interface Wall { x1: number; y1: number; x2: number; y2: number; thickness: number; kind: string }
export interface Room { id: string; name: string; x: number; y: number; width: number; height: number; occupancy: number; door_id: string | null; kind: string }
export interface Corridor { id: string; name: string; x: number; y: number; width: number; height: number; kind: 'corridor' | 'lobby' }
export interface Door { id: string; x: number; y: number; width: number; orientation: 'h' | 'v'; room_id: string }
export interface ExitDef { id: string; label: string; x: number; y: number; width: number; orientation: 'N' | 'E' | 'S' | 'W'; blocked: boolean }
export interface Obstacle { id: string; x: number; y: number; width: number; height: number; label: string }
export interface EvacPath { room_id: string; exit_id: string; points: number[][] }
export interface InitialAgent { id: number; x: number; y: number; zone: string }

export interface Building {
  width: number;
  height: number;
  wall_thickness: number;
  rooms: Room[];
  walls: Wall[];
  corridors: Corridor[];
  doors: Door[];
  exits: ExitDef[];
  obstacles: Obstacle[];
  zones: { id: string; name: string; x: number; y: number; width: number; height: number }[];
  meta: Record<string, any>;
  initial_agents: InitialAgent[];
  paths: EvacPath[];
  params: Params;
}

export interface Region { x0: number; y0: number; x1: number; y1: number }
export interface Hotspot { x: number; y: number; score: number; label: string; region: Region }
export interface Bottleneck {
  x: number | null;
  y: number | null;
  label: string;
  score: number;
  peak_density: number;
  duration_s: number;
  region: Region | null;
  hotspots: Hotspot[];
  floor?: number;
}
export interface ExitUtil { label: string; count: number; percent: number; width: number }
export interface Timeline { t: number[]; evacuated: number[]; max_density?: number[]; exits?: Record<string, number[]> }

export interface SimResult {
  params: Params;
  seed: number;
  completed: boolean;
  total_agents: number;
  evacuated: number;
  clearance_time: number;
  average_time: number | null;
  median_time: number | null;
  max_time: number | null;
  max_density: number;
  avg_speed: number;
  congestion_duration: number;
  bottleneck: Bottleneck;
  exit_utilization: Record<string, ExitUtil>;
  timeline: Timeline;
  density_grid: { cell: number; nx: number; ny: number; peak: number[][] };
  engine: { name: string; model: string; dt: number; device: string; compute_time_s: number };
  trajectories?: { frame_dt: number; n_frames: number; n_agents: number; positions: number[][] };
  agents?: {
    v0: number[]; radius: number[]; delay: number[]; spawn_time: number[];
    evac_time: (number | null)[]; exit: (string | null)[];
  };
  extra_agents_injected?: number;
}

// ---------------------------------------------------------------- multi-floor
export interface MultiFloorParams {
  n_floors: number;
  occupancy: number[];
  corridor_width: number;
  exit_width: number;
  stair_width: number;
  num_exits: number;
  agent_speed: number;
  blocked_exits: string[];
  blocked_stairs: [number, string][];
  floor_height: number;
  seed: number;
}

export const DEFAULT_MULTI_PARAMS: MultiFloorParams = {
  n_floors: 3,
  occupancy: [167, 167, 166],
  corridor_width: 2.0,
  exit_width: 1.2,
  stair_width: 1.5,
  num_exits: 2,
  agent_speed: 1.3,
  blocked_exits: [],
  blocked_stairs: [],
  floor_height: 3.5,
  seed: 42,
};

export interface FloorBuilding extends Building { floor: number; role: 'ground' | 'upper' }

export interface MultiFloorBuilding {
  n_floors: number;
  floor_height: number;
  stair_landing_points: Record<string, [number, number]>;
  floors: FloorBuilding[];
  params: MultiFloorParams;
}

export interface MultiFloorResult {
  params: MultiFloorParams;
  n_floors: number;
  completed: boolean;
  total_agents: number;
  evacuated: number;
  clearance_time: number;
  average_time: number | null;
  median_time: number | null;
  max_density: number;
  bottleneck: Bottleneck;
  bottlenecks_by_floor: Bottleneck[];
  exit_utilization: Record<string, ExitUtil>;
  timeline: Timeline;
  floors: SimResult[];
  floor_height: number;
  stair_descent_speed: number;
  stair_landing_points: Record<string, [number, number]>;
  engine: { name: string; per_floor_engine: string; device: string; compute_time_s: number };
}

export interface Recommendation {
  id: string;
  title: string;
  current: Record<string, number>;
  suggested: Record<string, number>;
  predicted_clearance_time: number;
  baseline_clearance_time: number | null;
  predicted_improvement_pct: number;
  expected_error_s?: number;
  basis: 'ai_prediction' | 'simulation';
  reason: string;
}

export interface RuntimeConfig {
  simulation_engine: string;
  prediction_model: string;
  copilot_provider: string;
  cuda_enabled: boolean;
  cuda_active: boolean;
  nemotron_enabled: boolean;
  nemotron_active: boolean;
  nemotron_design_available?: boolean;
}

export interface Prediction {
  predicted_clearance_time: number;
  expected_error_s: number;
  features: Record<string, number>;
  latency_ms: number;
  model: string;
  params: Params;
}

/** Multi-floor counterpart of `Prediction`: WHOLE-BUILDING clearance time, predicted
 * from `n_floors` / `floor_height` / per-floor occupancy without running a simulation. */
export interface PredictionMulti {
  predicted_clearance_time: number;
  expected_error_s: number;
  features: Record<string, number>;
  latency_ms: number;
  model: string;
  params: MultiFloorParams;
}

/** Live snapshot of a running simulation (GET /api/simulate/progress/{run_id}).
 * Floors run top-down; `stage: 'packaging'` = physics done, the replay is being sent;
 * `stage: 'none'` = no snapshot yet, or the result has already been sent. */
export interface SimProgress {
  stage: 'none' | 'simulating' | 'packaging';
  floor?: number;
  floors_done?: number;
  n_floors?: number;
  sim_time?: number;
  evacuated?: number;
  floor_total?: number;
  wall_time_s?: number;
}

// ---------------------------------------------------------------- layout optimizer
export type WidthField = 'corridor_width' | 'exit_width' | 'stair_width';
export const WIDTH_FIELDS: WidthField[] = ['corridor_width', 'exit_width', 'stair_width'];

export interface OptimizationStep {
  iteration: number;
  params: Record<WidthField, number>;
  predicted_clearance_time: number;
  /** d(predicted clearance time)/d(width); null for the starting point. */
  gradient_s_per_m: Record<WidthField, number> | null;
  budget_used_m: number;
}

/** Compact real-simulation metrics for the optimized layout (no trajectories / grids). */
export interface OptimizationValidation {
  completed: boolean;
  total_agents: number;
  evacuated: number;
  clearance_time: number;
  average_time: number | null;
  median_time: number | null;
  max_density: number;
  bottleneck: string;
  exit_utilization: Record<string, ExitUtil>;
  compute_time_s: number;
}

export interface OptimizationResult {
  baseline_predicted_clearance_time: number;
  optimized_predicted_clearance_time: number;
  predicted_improvement_s: number;
  predicted_improvement_pct: number;
  optimized_params: MultiFloorParams;
  iterations: OptimizationStep[];
  stop_reason: string;
  budget: { limit_m: number; used_m: number; costs_per_m: Record<WidthField, number> };
  validated_result: OptimizationValidation;
  /** Real clearance of the starting design - only when it was already simulated. */
  baseline_simulated_clearance_time: number | null;
  validated_improvement_s: number | null;
  validated_improvement_pct: number | null;
}

export interface MetricSet { mae_s: number; rmse_s: number; r2: number; mape_pct: number }
export interface ModelInfo {
  model_name: string;
  n_samples: number;
  n_train: number;
  n_test: number;
  holdout: MetricSet;
  cross_val_5fold: MetricSet;
  benchmark_random_forest_holdout: MetricSet;
  trained_at: string;
}

export interface ScenarioRecord {
  id: number;
  name: string;
  created_at: string;
  params: Params;
  prediction: { predicted_clearance_time: number; expected_error_s: number } | null;
  simulation: {
    clearance_time: number;
    average_time: number | null;
    median_time: number | null;
    max_density: number;
    avg_speed: number;
    congestion_duration: number;
    completed: boolean;
    bottleneck: string;
    exit_utilization: Record<string, ExitUtil>;
  };
}

export interface CopilotAction { type: string; changes?: Partial<Params>; compare?: boolean }
export interface CopilotReply { interpreter: string; matched: boolean; reply: string; actions: CopilotAction[] }
export interface Health { status: string; model_ready: boolean; engine: string; mode: string; copilot: string }

export type HeatMode = 'off' | 'live' | 'peak';

export interface BaselineInfo {
  label: string;
  params: Params;
  clearance: number;
  average: number | null;
  maxDensity: number;
  bottleneck: string;
  timeline: Timeline;
  total: number;
}

export type Status = 'idle' | 'running' | 'done' | 'error';

export interface CopilotMessage { id: number; role: 'user' | 'copilot'; text: string }

export interface DemoState { step: number; total: number; title: string; detail: string }
