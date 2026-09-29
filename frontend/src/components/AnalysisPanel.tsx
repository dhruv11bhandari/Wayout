import type { BaselineInfo, ModelInfo, Prediction, SimResult, Status } from '../types';
import { fmtClock, fmtSigned } from '../utils/format';
import MetricsCard from './MetricsCard';

interface Props {
  sim: SimResult | null;
  simFresh: boolean;
  simStatus: Status;
  prediction: { data: Prediction; fresh: boolean } | null;
  predStatus: Status;
  baseline: BaselineInfo | null;
  model: ModelInfo | null;
  selectedExit: string | null;
  onSelectExit: (id: string | null) => void;
  onValidate: () => void;
  error: string | null;
}

function Curve({ sim, baseline }: { sim: SimResult; baseline: BaselineInfo | null }) {
  const tl = sim.timeline;
  const total = sim.total_agents;
  const tmax = Math.max(tl.t[tl.t.length - 1], baseline ? baseline.timeline.t[baseline.timeline.t.length - 1] : 0, 1);
  const pts = (t: number[], e: number[], n: number) => t.map((x, i) => `${(x / tmax) * 300},${100 - (e[i] / n) * 100}`).join(' ');
  return (
    <div className="curve">
      <svg viewBox="0 0 300 100" preserveAspectRatio="none">
        {[25, 50, 75].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} className="curve-grid" />)}
        {baseline && baseline.timeline !== tl && <polyline points={pts(baseline.timeline.t, baseline.timeline.evacuated, baseline.total)} className="curve-base" />}
        <polyline points={pts(tl.t, tl.evacuated, total)} className="curve-now" />
      </svg>
      <div className="curve-axis"><span>0</span><span>{fmtClock(tmax / 2)}</span><span>{fmtClock(tmax)}</span></div>
      <div className="curve-legend"><i className="k-now" />This design{baseline && baseline.timeline !== tl && <><i className="k-base" />Baseline</>}</div>
    </div>
  );
}

export default function AnalysisPanel(p: Props) {
  const { sim, prediction } = p;
  const running = p.simStatus === 'running';
  const status = running ? 'RUNNING' : sim ? (p.simFresh ? 'COMPLETE' : 'STALE') : 'READY';
  const stale = !!sim && !p.simFresh;

  const delta = sim && p.baseline && sim.params && p.simFresh ? sim.clearance_time - p.baseline.clearance : null;
  const predErr = sim && prediction && prediction.fresh && p.simFresh ? Math.abs(prediction.data.predicted_clearance_time - sim.clearance_time) : null;

  return (
    <aside className="analysis">
      <div className="panel-head">
        <h3>Evacuation analysis</h3>
        <span className={`status-pill ${status.toLowerCase()}`}>{status}</span>
      </div>

      {p.error && <div className="error-box">{p.error}</div>}

      <div className={stale ? 'stale' : ''}>
        <MetricsCard
          size="lg"
          label="Clearance time"
          value={sim ? fmtClock(sim.clearance_time) : '––:––'}
          unit={sim ? ` ${sim.clearance_time.toFixed(0)} sec` : undefined}
          tone="accent"
          sub={
            sim
              ? !sim.completed
                ? <span className="bad-text">Not all agents evacuated within the time limit ({sim.evacuated}/{sim.total_agents})</span>
                : delta != null && Math.abs(delta) >= 0.05
                  ? <span className={delta <= 0 ? 'good-text' : 'bad-text'}>{fmtSigned(delta, 1)} s vs baseline ({fmtSigned((delta / p.baseline!.clearance) * 100, 1)}%)</span>
                  : `${sim.evacuated} of ${sim.total_agents} agents evacuated`
              : 'Run analysis to simulate the evacuation'
          }
        />
      </div>

      <div className="compare-3">
        <div className={`cmp ${prediction && !prediction.fresh ? 'stale' : ''}`}>
          <div className="metric-label">AI prediction</div>
          <div className="cmp-value ai">{prediction ? prediction.data.predicted_clearance_time.toFixed(0) : '—'}<em>{prediction ? ' sec' : ''}</em></div>
          <div className="cmp-sub">{prediction ? `${prediction.data.latency_ms.toFixed(0)} ms · typ. ±${prediction.data.expected_error_s.toFixed(0)} s` : p.predStatus === 'running' ? 'predicting…' : 'not run'}</div>
        </div>
        <div className={`cmp ${stale ? 'stale' : ''}`}>
          <div className="metric-label">Simulation</div>
          <div className="cmp-value">{sim ? sim.clearance_time.toFixed(0) : '—'}<em>{sim ? ' sec' : ''}</em></div>
          <div className="cmp-sub">{sim ? `${sim.engine.compute_time_s.toFixed(1)} s compute` : running ? 'computing…' : 'not run'}</div>
        </div>
        <div className="cmp">
          <div className="metric-label">Prediction error</div>
          <div className={`cmp-value ${predErr != null ? (predErr <= (prediction?.data.expected_error_s ?? 0) * 1.5 ? 'good-text' : 'warn-text') : ''}`}>{predErr != null ? predErr.toFixed(1) : '—'}<em>{predErr != null ? ' sec' : ''}</em></div>
          <div className="cmp-sub">{predErr != null && sim ? `${((predErr / sim.clearance_time) * 100).toFixed(1)}% of simulated` : 'needs both'}</div>
        </div>
      </div>
      {prediction && prediction.fresh && !p.simFresh && !running && (
        <button className="btn outline small" onClick={p.onValidate}>Validate with simulation</button>
      )}

      <div className={`grid-2 ${stale ? 'stale' : ''}`}>
        <MetricsCard label="Bottleneck" tone="warn" value={<span className="bn-label">{sim ? sim.bottleneck.label : '—'}</span>}
          sub={sim && sim.bottleneck.region ? `peak ${sim.bottleneck.peak_density.toFixed(2)} /m² · ${sim.bottleneck.duration_s.toFixed(0)} s crowded` : sim ? 'congestion stays low' : ''} />
        <MetricsCard label="Max density" value={sim ? sim.max_density.toFixed(2) : '—'} unit=" /m²" sub={sim ? (sim.max_density >= 1.5 ? 'crowded' : sim.max_density >= 1 ? 'moderate' : 'free-flowing') : ''} />
        <MetricsCard label="Average evac time" value={sim && sim.average_time != null ? sim.average_time.toFixed(0) : '—'} unit=" sec" sub={sim && sim.median_time != null ? `median ${sim.median_time.toFixed(0)} s` : ''} />
        <MetricsCard label="Average speed" value={sim ? sim.avg_speed.toFixed(2) : '—'} unit=" m/s" sub={sim ? `crowded ${sim.congestion_duration.toFixed(0)} s at hotspot` : ''} />
      </div>

      <h4>Exit utilization</h4>
      <div className={`exits ${stale ? 'stale' : ''}`}>
        {sim
          ? Object.entries(sim.exit_utilization).map(([id, u]) => (
              <button key={id} className={`exit-row ${p.selectedExit === id ? 'sel' : ''}`} onClick={() => p.onSelectExit(p.selectedExit === id ? null : id)}>
                <span className="exit-name">{u.label}</span>
                <span className="exit-bar"><i style={{ width: `${u.percent}%` }} /></span>
                <span className="exit-num">{u.count} · {u.percent.toFixed(0)}%</span>
              </button>
            ))
          : <div className="empty">Exit usage appears after a simulation.</div>}
      </div>

      <h4>Evacuation curve</h4>
      {sim ? <div className={stale ? 'stale' : ''}><Curve sim={sim} baseline={p.baseline} /></div> : <div className="empty">Agents evacuated over time.</div>}

      <div className="footnote">
        {sim ? <div>Engine: {sim.engine.name} · {sim.engine.device} · dt {sim.engine.dt} s · seed {sim.seed}</div> : <div>Engine: local CPU (NumPy)</div>}
        {p.model
          ? <div>Surrogate: {p.model.model_name.replace(' (monotonic constraints)', '')} · {p.model.n_samples} simulated buildings · holdout MAE {p.model.holdout.mae_s.toFixed(1)} s · R² {p.model.holdout.r2.toFixed(2)}</div>
          : <div>Surrogate: loading…</div>}
      </div>
    </aside>
  );
}
