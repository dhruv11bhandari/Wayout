import { WIDTH_FIELDS } from '../types';
import type { OptimizationResult, Status, WidthField } from '../types';
import { fmtClock } from '../utils/format';

interface OptimizerCardProps {
  optimization: OptimizationResult | null;
  status: Status;
  error: string | null;
  budget: number;
  onBudget: (m: number) => void;
  onOptimize: () => void;
  onApply: (andRun: boolean) => void;
  applied: boolean;
  simulating: boolean;
}

const LABELS: Record<WidthField, string> = {
  corridor_width: 'Corridor', exit_width: 'Ground exits', stair_width: 'Stairs',
};

const STOP_REASONS: Record<string, string> = {
  'no improving feasible step': 'Stopped because no further widening was predicted to help.',
  'widening budget exhausted': 'Stopped after spending the whole widening budget.',
  'maximum iterations reached': 'Stopped after the maximum number of search steps.',
};

const fmtGain = (s: number, pct: number): string =>
  `${s >= 0 ? '−' : '+'}${Math.abs(s).toFixed(1)} s (${Math.abs(pct).toFixed(1)}% ${s >= 0 ? 'faster' : 'slower'})`;

export default function OptimizerCard({
  optimization, status, error, budget, onBudget, onOptimize, onApply, applied, simulating,
}: OptimizerCardProps) {
  const optimizing = status === 'running';
  const start = optimization?.iterations[0]?.params;
  const changed = !!optimization && optimization.budget.used_m > 0;
  const v = optimization?.validated_result;

  return (
    <div className="param optimizer">
      <div className="param-row"><label htmlFor="opt-budget">Smart layout optimizer</label></div>
      <div className="optimizer-controls">
        <div className="optimizer-budget">
          <input
            id="opt-budget" type="number" min={0} max={10} step={0.5} value={budget}
            onChange={(e) => onBudget(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
          />
          <span className="dim">m budget</span>
        </div>
        <button className="btn small" disabled={optimizing || simulating} onClick={onOptimize}>
          {optimizing ? 'Optimizing…' : 'Optimize layout'}
        </button>
      </div>
      <div className="param-hint">
        {optimizing
          ? 'Searching widths with the AI model, then checking the winner with one real simulation…'
          : 'How many extra metres of width you can afford to add across corridors, exits and stairs.'}
      </div>

      {status === 'error' && error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}

      {optimization && start && v && (
        <div className="optimizer-card">
          <div className="optimizer-metrics">
            <div>
              <div className="optimizer-k">Baseline estimate</div>
              <div className="cmp-value ai">{fmtClock(optimization.baseline_predicted_clearance_time)}</div>
            </div>
            <div>
              <div className="optimizer-k">Optimized estimate</div>
              <div className="cmp-value ai">{fmtClock(optimization.optimized_predicted_clearance_time)}</div>
            </div>
            <div>
              <div className="optimizer-k">Real validation</div>
              <div className="cmp-value">{fmtClock(v.clearance_time)}</div>
            </div>
          </div>

          <div className="optimizer-line">
            <span className="dim">AI predicted</span>
            <span>{fmtGain(optimization.predicted_improvement_s, optimization.predicted_improvement_pct)}</span>
          </div>
          <div className="optimizer-line">
            <span className="dim">Real simulation</span>
            <span>
              {optimization.validated_improvement_s != null && optimization.validated_improvement_pct != null
                ? fmtGain(optimization.validated_improvement_s, optimization.validated_improvement_pct)
                : '—'}
            </span>
          </div>
          {optimization.validated_improvement_s == null && (
            <div className="param-hint">Run the current design once to see a real before/after comparison.</div>
          )}
          {!v.completed && (
            <div className="param-hint" style={{ color: 'var(--sem-crit)' }}>
              In the validation run, {v.total_agents - v.evacuated} people did not reach an exit.
            </div>
          )}

          <div className="optimizer-widths">
            {WIDTH_FIELDS.map((f) => (
              <div className="optimizer-line" key={f}>
                <span className="dim">{LABELS[f]}</span>
                <span>
                  {start[f].toFixed(2)} m <span className="dim">&rarr;</span>{' '}
                  <b>{optimization.optimized_params[f].toFixed(2)} m</b>
                </span>
              </div>
            ))}
          </div>

          <div className="optimizer-line">
            <span className="dim">Budget used</span>
            <span>{optimization.budget.used_m.toFixed(2)} / {optimization.budget.limit_m.toFixed(1)} m</span>
          </div>

          <p className="param-hint">
            {changed
              ? `WayOut tested tiny width changes, calculated which direction reduced evacuation time fastest, and
                 spread your ${optimization.budget.limit_m.toFixed(1)} m widening budget across the passageways with the
                 best predicted benefit. It then ran one real evacuation simulation of the final layout to check it.`
              : 'Within this budget, the AI model found no widening that would shorten the evacuation, so your current layout is kept.'}
            {' '}{STOP_REASONS[optimization.stop_reason] ?? optimization.stop_reason}
          </p>

          {changed && (
            <div className="optimizer-actions">
              <button className="btn small" disabled={applied || simulating} onClick={() => onApply(false)}>
                {applied ? 'Applied' : 'Apply optimized layout'}
              </button>
              <button className="btn primary small" disabled={simulating} onClick={() => onApply(true)}>
                Apply and run simulation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
