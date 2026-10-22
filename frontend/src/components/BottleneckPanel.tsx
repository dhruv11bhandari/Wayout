import type { Bottleneck } from '../types';

interface BottleneckPanelProps {
  global: Bottleneck;
  byFloor: Bottleneck[];
}

const CRITICAL = 0.3;   // same severity cut-off the panel has always used
const floorName = (f?: number) => (f == null ? '' : f === 0 ? 'Ground floor' : `Floor ${f}`);

function Severity({ score }: { score: number }) {
  const pct = Math.max(4, Math.min(100, score * 100));
  return (
    <div className="wy-sev" aria-label={`Severity ${score.toFixed(2)} of 1`}>
      <div className={`wy-sev-fill ${score > CRITICAL ? 'bad' : 'warn'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function BottleneckPanel({ global, byFloor }: BottleneckPanelProps) {
  const none = global.x == null;        // backend: "No significant bottleneck"
  const critical = !none && global.score > CRITICAL;
  const tone = none ? 'good' : critical ? 'bad' : 'warn';
  return (
    <div className="wy-bn">
      <div className={`wy-bn-hero ${tone}`}>
        <div className="wy-bn-hero-head">
          <div>
            <div className="wy-metric-k">Primary bottleneck</div>
            <div className="wy-bn-hero-name">{global.label}</div>
            {global.floor != null && <div className="wy-bn-hero-floor">{floorName(global.floor)}</div>}
          </div>
          <span className={`wy-tag ${tone}`}>{none ? 'Clear' : critical ? 'Critical' : 'Watch'}</span>
        </div>
        <div className="wy-bn-hero-stats">
          <div><b>{global.peak_density.toFixed(1)}</b><span>people/m² at peak</span></div>
          <div><b>{global.duration_s.toFixed(0)}s</b><span>above crowded</span></div>
          <div className="wy-bn-sev-cell">
            <b>{global.score.toFixed(2)}</b><span>severity (0–1)</span>
            <Severity score={global.score} />
          </div>
        </div>
      </div>

      {byFloor.length > 1 && (
        <div className="wy-bn-floors">
          {byFloor.map((b) => (
            <div key={b.floor ?? b.label} className={`wy-bn-card ${b.score > CRITICAL ? 'bad' : ''}`}>
              <div className="wy-bn-card-floor">{floorName(b.floor)}</div>
              <div className="wy-bn-card-name">{b.label}</div>
              <div className="wy-bn-card-stats">
                <span><b>{b.peak_density.toFixed(1)}</b> /m² peak</span>
                <span><b>{b.duration_s.toFixed(0)}s</b> congested</span>
              </div>
              <Severity score={b.score} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
