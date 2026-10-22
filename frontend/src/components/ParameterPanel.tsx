import type { ReactNode } from 'react';
import type { MultiFloorParams, PredictionMulti } from '../types';
import { fmtClock } from '../utils/format';

interface ParameterPanelProps {
  params: MultiFloorParams;
  onChange: (patch: Partial<MultiFloorParams>) => void;
  onFloorCount: (n: number) => void;
  onTotalOccupancy: (n: number) => void;
  onToggleExit: (id: string) => void;
  onToggleStair: (floor: number, id: string) => void;
  onRun: () => void;
  running: boolean;
  prediction: PredictionMulti | null;
  predictionLoading: boolean;
  /** Smart layout optimizer controls, shown under the AI prediction (parametric designs only). */
  optimizer?: ReactNode;
}

const GROUND_EXIT_IDS = ['A', 'B', 'C', 'D'];

export default function ParameterPanel({
  params, onChange, onFloorCount, onTotalOccupancy, onToggleExit, onToggleStair, onRun, running,
  prediction, predictionLoading, optimizer,
}: ParameterPanelProps) {
  const total = params.occupancy.reduce((a, b) => a + b, 0);
  const upperFloors = Array.from({ length: Math.max(0, params.n_floors - 1) }, (_, i) => i + 1);
  return (
    <div className="param-panel">
      <div className="panel-head"><h3>Building</h3></div>

      <div className="param">
        <div className="param-row"><label>Floors</label><span className="param-value">{params.n_floors}</span></div>
        <input type="range" min={1} max={6} step={1} value={params.n_floors} onChange={(e) => onFloorCount(Number(e.target.value))} />
      </div>

      <div className="param">
        <div className="param-row"><label>Occupants</label><span className="param-value">{total}</span></div>
        <input type="range" min={30} max={1800} step={10} value={total} onChange={(e) => onTotalOccupancy(Number(e.target.value))} />
        <div className="param-hint">Split across floors: {params.occupancy.join(' / ')}</div>
      </div>

      <div className="param">
        <div className="param-row"><label>Corridor width</label><span className="param-value">{params.corridor_width.toFixed(1)} m</span></div>
        <input type="range" min={0.8} max={6.0} step={0.1} value={params.corridor_width} onChange={(e) => onChange({ corridor_width: Number(e.target.value) })} />
      </div>

      <div className="param">
        <div className="param-row"><label>Ground exit width</label><span className="param-value">{params.exit_width.toFixed(1)} m</span></div>
        <input type="range" min={0.6} max={4.0} step={0.1} value={params.exit_width} onChange={(e) => onChange({ exit_width: Number(e.target.value) })} />
      </div>

      <div className="param">
        <div className="param-row"><label>Stair width</label><span className="param-value">{params.stair_width.toFixed(1)} m</span></div>
        <input type="range" min={0.6} max={4.0} step={0.1} value={params.stair_width} onChange={(e) => onChange({ stair_width: Number(e.target.value) })} />
        <div className="param-hint">Every floor above ground uses two stairs, this width.</div>
      </div>

      <div className="param">
        <div className="param-row"><label>Walking speed</label><span className="param-value">{params.agent_speed.toFixed(1)} m/s</span></div>
        <input type="range" min={0.5} max={2.0} step={0.1} value={params.agent_speed} onChange={(e) => onChange({ agent_speed: Number(e.target.value) })} />
      </div>

      <div className="param">
        <div className="param-row"><label>Ground exits</label><span className="param-value">{params.num_exits}</span></div>
        <input type="range" min={1} max={4} step={1} value={params.num_exits} onChange={(e) => onChange({ num_exits: Number(e.target.value) })} />
      </div>

      <div className="param">
        <div className="param-row"><label>Hazard</label></div>
        <div className="param-hint" style={{ marginBottom: 6 }}>
          Blocks a real exit or stairwell - the simulator reroutes around it, it doesn't just relabel the map.
        </div>
        <div className="exit-chips">
          {GROUND_EXIT_IDS.slice(0, params.num_exits).map((id) => (
            <span key={`g${id}`} className={`chip ${params.blocked_exits.includes(id) ? 'blocked' : ''}`} onClick={() => onToggleExit(id)}>
              Exit {id}
            </span>
          ))}
          {upperFloors.flatMap((floor) =>
            ['A', 'B'].map((id) => (
              <span
                key={`s${floor}${id}`}
                className={`chip ${params.blocked_stairs.some(([f, s]) => f === floor && s === id) ? 'blocked' : ''}`}
                onClick={() => onToggleStair(floor, id)}
              >
                Floor {floor} Stair {id}
              </span>
            )),
          )}
        </div>
      </div>

      <div className="param ai-predict">
        <div className="param-row"><label>AI predicted clearance</label></div>
        <div className="cmp-value ai" style={{ fontSize: 20 }}>
          {prediction ? fmtClock(prediction.predicted_clearance_time) : '—:—'}
        </div>
        <div className="param-hint">
          {prediction
            ? `typ. ±${prediction.expected_error_s.toFixed(0)}s · in ${prediction.latency_ms.toFixed(0)}ms, no simulation run`
            : predictionLoading ? 'estimating…' : 'change a parameter to estimate'}
        </div>
      </div>

      {optimizer}

      <div className="go-row">
        <button className={`go-btn ${running ? 'running' : ''}`} disabled={running} onClick={onRun}>
          {running ? 'Simulating…' : 'Run Simulation'}
        </button>
      </div>
    </div>
  );
}
