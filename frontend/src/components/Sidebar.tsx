import type { Building, Params, ScenarioRecord, Status } from '../types';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
}

function ParamSlider({ label, value, min, max, step, unit = '', digits = 0, onChange }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="param">
      <div className="param-row">
        <label>{label}</label>
        <span className="param-value">{value.toFixed(digits)}{unit && <em>{unit}</em>}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ ['--fill' as string]: `${pct}%` }}
      />
    </div>
  );
}

interface Props {
  params: Params;
  building: Building | null;
  scenarios: ScenarioRecord[];
  simStatus: Status;
  predStatus: Status;
  busy: boolean;
  onChange: (p: Partial<Params>) => void;
  onRun: () => void;
  onPredict: () => void;
  onReset: () => void;
  onLoadScenario: (id: number) => void;
}

export default function Sidebar(p: Props) {
  const { params, building } = p;
  const exits = ['A', 'B', 'C', 'D'].slice(0, params.num_exits);
  const toggleBlocked = (id: string) => {
    const has = params.blocked_exits.includes(id);
    const next = has ? params.blocked_exits.filter((b) => b !== id) : [...params.blocked_exits, id];
    if (next.length >= exits.length) return; // keep at least one exit open
    p.onChange({ blocked_exits: next });
  };
  const meta = building?.meta ?? {};
  return (
    <aside className="sidebar">
      <section>
        <h3>Building</h3>
        <dl className="kv">
          <dt>Project</dt><dd>Demo Building</dd>
          <dt>Floor</dt><dd>Ground floor</dd>
          <dt>Layout</dt><dd>{meta.room_count ?? '–'} rooms · corridor · lobby</dd>
          <dt>Floor area</dt><dd>{meta.floor_area ? `${Math.round(meta.floor_area)} m²` : '–'}</dd>
          <dt>Footprint</dt><dd>{building ? `${building.width.toFixed(0)} × ${building.height.toFixed(0)} m` : '–'}</dd>
        </dl>
        <div className="select-row">
          <label htmlFor="scn">Scenario</label>
          <select id="scn" value="" onChange={(e) => e.target.value && p.onLoadScenario(Number(e.target.value))}>
            <option value="">{p.scenarios.length ? 'Load saved scenario…' : 'Baseline (unsaved)'}</option>
            {p.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </section>

      <section>
        <h3>Parameters</h3>
        <ParamSlider label="Occupancy" value={params.occupancy} min={20} max={300} step={5} unit=" people" onChange={(v) => p.onChange({ occupancy: v })} />
        <ParamSlider label="Corridor width" value={params.corridor_width} min={1} max={4} step={0.25} digits={2} unit=" m" onChange={(v) => p.onChange({ corridor_width: v })} />
        <ParamSlider label="Exit width" value={params.exit_width} min={0.8} max={3} step={0.1} digits={1} unit=" m" onChange={(v) => p.onChange({ exit_width: v })} />
        <ParamSlider label="Walking speed" value={params.agent_speed} min={0.8} max={1.8} step={0.05} digits={2} unit=" m/s" onChange={(v) => p.onChange({ agent_speed: v })} />
        <div className="param">
          <div className="param-row"><label>Number of exits</label><span className="param-value">{params.num_exits}</span></div>
          <div className="segmented">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} className={params.num_exits === n ? 'on' : ''} onClick={() => p.onChange({ num_exits: n })}>{n}</button>
            ))}
          </div>
        </div>
        <div className="param">
          <div className="param-row"><label>Exit status</label><span className="param-hint">click to block</span></div>
          <div className="exit-chips">
            {exits.map((id) => {
              const blocked = params.blocked_exits.includes(id);
              return (
                <button key={id} className={`exit-chip ${blocked ? 'blocked' : ''}`} onClick={() => toggleBlocked(id)} title={blocked ? 'Blocked - click to reopen' : 'Open - click to block'}>
                  <b>{id}</b><span>{blocked ? 'Blocked' : 'Open'}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="actions">
        <button className="btn primary" onClick={p.onRun} disabled={p.busy}>
          {p.simStatus === 'running' ? 'Simulating…' : 'Run analysis'}
        </button>
        <button className="btn outline" onClick={p.onPredict} disabled={p.busy}>
          {p.predStatus === 'running' ? 'Predicting…' : 'Fast AI prediction'}
        </button>
        <button className="btn ghost" onClick={p.onReset} disabled={p.simStatus === 'running'}>Reset</button>
      </div>
    </aside>
  );
}
