import type { Recommendation, Status } from '../types';

interface RecommendationListProps {
  recommendations: Recommendation[];
  status: Status;
  onFetch: () => void;
  onApply: (rec: Recommendation) => void;
  applying: boolean;
}

const LABELS: Record<string, string> = {
  corridor_width: 'Corridor width', exit_width: 'Exit width', stair_width: 'Stair width', num_exits: 'Exits',
};
function fmt(key: string, v: number): string {
  return key.includes('width') ? `${v.toFixed(1)} m` : String(v);
}

export default function RecommendationList({ recommendations, status, onFetch, onApply, applying }: RecommendationListProps) {
  if (status === 'idle' || status === 'running') {
    const busy = status === 'running';
    return (
      <div className="wy-empty-card">
        <div className="wy-empty-icon" aria-hidden="true">{busy ? <span className="wy-spinner" /> : '✦'}</div>
        <div className="wy-empty-body">
          <div className="wy-empty-title">{busy ? 'Testing design changes…' : 'Find changes that get people out faster'}</div>
          <p>
            {busy
              ? 'Each candidate change is checked against the bottleneck above. Multi-floor buildings re-run the full simulation per candidate, so this can take a little while.'
              : 'WayOut tries targeted fixes for the bottleneck it found (wider stairs, exits or corridors) and ranks them by how much they cut clearance time.'}
          </p>
        </div>
        <button className="btn primary" onClick={onFetch} disabled={busy}>
          {busy ? 'Working…' : 'Generate recommendations'}
        </button>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="wy-empty-card bad">
        <div className="wy-empty-body">
          <div className="wy-empty-title">Couldn't generate recommendations</div>
          <p>Something went wrong while testing design changes. Your results above are unaffected.</p>
        </div>
        <button className="btn outline" onClick={onFetch}>Try again</button>
      </div>
    );
  }
  if (!recommendations.length) {
    return (
      <div className="wy-empty-card good">
        <div className="wy-empty-icon" aria-hidden="true">✓</div>
        <div className="wy-empty-body">
          <div className="wy-empty-title">No change beat the current design</div>
          <p>None of the candidate fixes evacuated the building faster than it already does.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rec-list">
      {recommendations.map((rec, i) => {
        const changeKey = Object.keys(rec.suggested)[0];
        return (
          <div className="rec-card" key={rec.id}>
            <div className="rec-head">
              <div>
                <div className="rec-num">WAYOUT RECOMMENDATION {String(i + 1).padStart(2, '0')}</div>
                <div className="rec-title">{rec.title}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="rec-delta">-{rec.predicted_improvement_pct.toFixed(1)}%</div>
                <div className="rec-basis">{rec.basis === 'ai_prediction' ? 'AI predicted' : 'Simulated'}</div>
              </div>
            </div>
            {changeKey && (
              <div className="rec-change">
                <span className="dim">{LABELS[changeKey] ?? changeKey}</span>
                <span>{fmt(changeKey, rec.current[changeKey])}</span>
                <span className="dim">&rarr;</span>
                <b>{fmt(changeKey, rec.suggested[changeKey])}</b>
              </div>
            )}
            <div className="rec-reason">{rec.reason}</div>
            <div className="rec-actions">
              <button className="btn primary small" disabled={applying} onClick={() => onApply(rec)}>Apply scenario</button>
              {rec.expected_error_s != null && (
                <span className="dim" style={{ fontSize: 11, alignSelf: 'center' }}>&plusmn;{rec.expected_error_s.toFixed(0)}s expected error</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
