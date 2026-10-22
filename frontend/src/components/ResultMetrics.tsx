import type { MultiFloorResult, PredictionMulti } from '../types';
import { fmtClock, fmtSigned } from '../utils/format';

interface ResultMetricsProps {
  result: MultiFloorResult;
  /** AI estimate for the same design; omitted for uploaded plans. */
  prediction: PredictionMulti | null;
  showPrediction: boolean;
}

const WARN_DENSITY = 2.5;
const CRIT_DENSITY = 4;

/** Evacuation curve from the run's real timeline: share of people out over time. */
function EvacCurve({ result }: { result: MultiFloorResult }) {
  const { t, evacuated } = result.timeline;
  const total = Math.max(1, result.total_agents);
  const end = Math.max(1e-6, t[t.length - 1] ?? result.clearance_time);
  if (t.length < 2) return null;
  const W = 300, H = 72;
  const pts = t.map((ti, i) => `${((ti / end) * W).toFixed(1)},${(H - (evacuated[i] / total) * H).toFixed(1)}`);
  const half = t.findIndex((_, i) => evacuated[i] >= total / 2);
  return (
    <figure className="wy-curve">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`Evacuation curve: everyone out after ${fmtClock(result.clearance_time)}`}>
        <defs>
          <linearGradient id="wy-curve-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="wy-curve-grid" />
        <polygon points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill="url(#wy-curve-fill)" />
        <polyline points={pts.join(' ')} className="wy-curve-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption>
        <span>0:00</span>
        {half > 0 && <span>Half out by {fmtClock(t[half])}</span>}
        <span>{fmtClock(end)}</span>
      </figcaption>
    </figure>
  );
}

function DensityGauge({ value }: { value: number }) {
  const max = Math.max(5, Math.ceil(value));
  const pos = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const tone = value > CRIT_DENSITY ? 'bad' : value > WARN_DENSITY ? 'warn' : 'good';
  return (
    <div className="wy-gauge" aria-hidden="true">
      <div className={`wy-gauge-fill ${tone}`} style={{ width: pos(value) }} />
      <span className="wy-gauge-mark" style={{ left: pos(WARN_DENSITY) }} title="2.5/m² warning" />
      <span className="wy-gauge-mark crit" style={{ left: pos(CRIT_DENSITY) }} title="4/m² critical" />
    </div>
  );
}

export default function ResultMetrics({ result, prediction, showPrediction }: ResultMetricsProps) {
  const notOut = result.total_agents - result.evacuated;
  const density = Math.round(result.max_density * 10) / 10;
  const densityTone = density > CRIT_DENSITY ? 'bad' : density > WARN_DENSITY ? 'warn' : 'good';
  const diff = prediction ? prediction.predicted_clearance_time - result.clearance_time : 0;
  const withinError = prediction ? Math.abs(diff) <= prediction.expected_error_s : false;

  return (
    <div className="wy-metrics">
      <div className={`wy-metric-hero ${result.completed ? 'good' : 'bad'}`}>
        <div className="wy-metric-k">Clearance time</div>
        <div className="wy-metric-hero-v">{fmtClock(result.clearance_time)}</div>
        <div className="wy-metric-s">
          {result.completed
            ? `Everyone out · ${result.total_agents} people across ${result.n_floors} ${result.n_floors > 1 ? 'floors' : 'floor'}`
            : `${notOut} of ${result.total_agents} people did not reach an exit`}
        </div>
        <EvacCurve result={result} />
      </div>

      <div className={`wy-metric-grid ${showPrediction ? '' : 'three'}`}>
        {showPrediction && (
          <div className="wy-metric accent">
            <div className="wy-metric-k">AI predicted</div>
            <div className="wy-metric-v">{prediction ? fmtClock(prediction.predicted_clearance_time) : '—'}</div>
            {prediction && (
              <div className="wy-metric-s">
                <span className={`wy-tag ${withinError ? 'good' : 'warn'}`}>
                  {fmtSigned(diff)}s {withinError ? 'within' : 'outside'} ±{prediction.expected_error_s.toFixed(0)}s
                </span>
              </div>
            )}
          </div>
        )}
        <div className="wy-metric">
          <div className="wy-metric-k">Average time out</div>
          <div className="wy-metric-v">{result.average_time != null ? fmtClock(result.average_time) : '—'}</div>
          <div className="wy-metric-s">
            {result.median_time != null ? `Median ${fmtClock(result.median_time)}` : 'per person'}
          </div>
        </div>
        <div className={`wy-metric ${densityTone}`}>
          <div className="wy-metric-k">Peak density</div>
          <div className="wy-metric-v">{density.toFixed(1)}<span className="wy-metric-u">/m²</span></div>
          <DensityGauge value={density} />
          <div className="wy-metric-s">
            {densityTone === 'good' ? 'At or below the 2.5 warning level'
              : densityTone === 'warn' ? 'Above the 2.5 warning level' : 'Above the 4 critical level'}
          </div>
        </div>
        <div className="wy-metric">
          <div className="wy-metric-k">Occupants</div>
          <div className="wy-metric-v">{result.total_agents}</div>
          <div className="wy-metric-s">
            {result.n_floors > 1 ? `${result.n_floors} floors, chained by stairs` : 'Single floor'}
          </div>
        </div>
      </div>
    </div>
  );
}
