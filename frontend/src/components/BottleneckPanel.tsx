import type { Bottleneck } from '../types';

interface BottleneckPanelProps {
  global: Bottleneck;
  byFloor: Bottleneck[];
}

export default function BottleneckPanel({ global, byFloor }: BottleneckPanelProps) {
  return (
    <div>
      <div className="bottleneck" style={{ marginBottom: 20 }}>
        <div className="hud-title">Primary bottleneck</div>
        <div className="bn-label">{global.label}{global.floor != null ? ` · Floor ${global.floor}` : ''}</div>
        <div className="bn-stats">
          <div><div className="bn-stat-v">{global.peak_density.toFixed(1)}</div><div className="bn-stat-k">people/m²</div></div>
          <div><div className="bn-stat-v">{global.duration_s.toFixed(0)}s</div><div className="bn-stat-k">above crowded</div></div>
          <div><div className="bn-stat-v">{global.score.toFixed(2)}</div><div className="bn-stat-k">severity score</div></div>
        </div>
      </div>
      <div className="bottleneck-grid">
        {byFloor.map((b) => (
          <div key={b.floor ?? b.label} className={`bn-card ${b.score > 0.3 ? 'critical' : ''}`}>
            <div className="bn-floor">Floor {b.floor}</div>
            <div className="bn-name">{b.label}</div>
            <div className="bn-stats">
              <div><div className="bn-stat-v">{b.peak_density.toFixed(1)}</div><div className="bn-stat-k">peak /m²</div></div>
              <div><div className="bn-stat-v">{b.duration_s.toFixed(0)}s</div><div className="bn-stat-k">congested</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
