import type { DemoState } from '../types';

export function DemoButton({ active, onClick, disabled }: { active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button className={`btn demo-btn ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled && !active}>
      {active ? 'STOP DEMO' : 'DEMO MODE'}
    </button>
  );
}

export function DemoBanner({ demo }: { demo: DemoState | null }) {
  if (!demo) return null;
  return (
    <div className="demo-banner" role="status">
      <div className="demo-step">STEP {demo.step} OF {demo.total}</div>
      <div className="demo-title">{demo.title}</div>
      {demo.detail && <div className="demo-detail">{demo.detail}</div>}
      <div className="demo-progress"><div style={{ width: `${(demo.step / demo.total) * 100}%` }} /></div>
    </div>
  );
}
