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
  if (status === 'idle') {
    return (
      <div style={{ textAlign: 'center', padding: '34px 0' }}>
        <button className="btn primary" onClick={onFetch}>Generate recommendations</button>
      </div>
    );
  }
  if (status === 'running') return <div className="empty">Analyzing the bottleneck and scoring design changes…</div>;
  if (status === 'error') return <div className="error-box">Couldn't generate recommendations - try again.</div>;
  if (!recommendations.length) return <div className="empty">No change scored better than the current design.</div>;

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
