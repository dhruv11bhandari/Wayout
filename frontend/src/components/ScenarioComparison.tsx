import { useState } from 'react';
import type { BaselineInfo, ScenarioRecord, Status } from '../types';
import { describeParams, fmtClock, fmtSigned } from '../utils/format';

interface Current {
  seconds: number;
  kind: 'sim' | 'ai';
}

interface Props {
  baseline: BaselineInfo | null;
  current: Current | null;
  scenarios: ScenarioRecord[];
  canSave: boolean;
  canPin: boolean;
  saving: Status;
  onSave: (name: string) => void;
  onPin: () => void;
  onLoad: (id: number) => void;
  onDelete: (id: number) => void;
}

export default function ScenarioComparison(p: Props) {
  const [name, setName] = useState('');
  const base = p.baseline?.clearance ?? null;
  const cur = p.current?.seconds ?? null;
  const diff = base != null && cur != null ? cur - base : null;
  const pct = diff != null && base ? (diff / base) * 100 : null;

  return (
    <section className="scenarios">
      <div className="panel-head">
        <h3>Scenario comparison</h3>
        <div className="save-row">
          <input value={name} placeholder={`Scenario ${p.scenarios.length + 1}`} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && p.canSave) { p.onSave(name.trim() || `Scenario ${p.scenarios.length + 1}`); setName(''); } }} />
          <button className="btn outline small" disabled={!p.canSave || p.saving === 'running'} onClick={() => { p.onSave(name.trim() || `Scenario ${p.scenarios.length + 1}`); setName(''); }}>
            {p.saving === 'running' ? 'Saving…' : 'Save scenario'}
          </button>
        </div>
      </div>

      <div className="scn-body">
        <div className="triplet">
          <div className="trip">
            <div className="metric-label">Baseline</div>
            <div className="trip-value">{base != null ? fmtClock(base) : '––:––'}</div>
            <div className="trip-sub">{base != null ? `${base.toFixed(0)} sec · simulated` : 'first simulation becomes the baseline'}</div>
          </div>
          <div className="trip-arrow" aria-hidden="true">→</div>
          <div className="trip">
            <div className="metric-label">Current design</div>
            <div className="trip-value">{cur != null ? fmtClock(cur) : '––:––'}</div>
            <div className="trip-sub">{cur != null ? `${cur.toFixed(0)} sec · ${p.current!.kind === 'sim' ? 'simulated' : 'AI estimate'}` : 'run analysis or AI prediction'}</div>
          </div>
          <div className={`trip result ${diff == null ? '' : diff <= -0.05 ? 'good' : diff >= 0.05 ? 'bad' : ''}`}>
            <div className="metric-label">Design impact</div>
            <div className="trip-value">{diff != null ? `${fmtSigned(diff, 0)} s` : '—'}</div>
            <div className="trip-sub">{pct != null ? `${fmtSigned(pct, 1)}% ${diff! <= 0 ? 'faster' : 'slower'}` : ' '}</div>
          </div>
          <button className="btn ghost small pin" disabled={!p.canPin} onClick={p.onPin} title="Use the current simulation as the new baseline">Set as baseline</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Scenario</th><th>Design</th><th>AI</th><th>Sim</th><th>Δ base</th><th>Bottleneck</th><th>Peak</th><th /></tr>
            </thead>
            <tbody>
              {p.scenarios.length === 0 && (
                <tr><td colSpan={8} className="empty-cell">No saved scenarios yet. Run an analysis, then save it.</td></tr>
              )}
              {p.scenarios.map((s) => {
                const d = base != null ? s.simulation.clearance_time - base : null;
                return (
                  <tr key={s.id}>
                    <td><button className="link" onClick={() => p.onLoad(s.id)} title="Load these parameters">{s.name}</button></td>
                    <td className="dim">{describeParams(s.params)}</td>
                    <td>{s.prediction ? `${s.prediction.predicted_clearance_time.toFixed(0)}s` : '—'}</td>
                    <td>{s.simulation.clearance_time.toFixed(0)}s</td>
                    <td className={d == null ? '' : d < -0.05 ? 'good-text' : d > 0.05 ? 'bad-text' : ''}>{d == null ? '—' : `${fmtSigned(d, 0)}s`}</td>
                    <td>{s.simulation.bottleneck}</td>
                    <td>{s.simulation.max_density.toFixed(2)}</td>
                    <td><button className="link dim" onClick={() => p.onDelete(s.id)} aria-label="Delete scenario">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
