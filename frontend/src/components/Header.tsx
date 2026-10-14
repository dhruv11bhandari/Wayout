import type { Health } from '../types';
import { DemoButton } from './DemoMode';
import type { DemoState } from '../types';

interface Props {
  health: 'checking' | 'ok' | 'down';
  info: Health | null;
  demo: DemoState | null;
  onDemo: () => void;
}

export default function Header({ health, info, demo, onDemo }: Props) {
  return (
    <header className="header">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="5" fill="#0f1b2e" stroke="rgba(120,165,230,0.35)" />
          <path d="M8 9l3.4 14L16 13l4.6 10L24 9" fill="none" stroke="#22d3ee" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <div className="brand-name">WAYOUT</div>
          <div className="brand-tag">AI-powered evacuation intelligence for building design</div>
        </div>
      </div>

      <div className="header-center">
        <span className="chip"><span className="chip-k">Project</span> Demo Building</span>
        <span className="chip"><span className="chip-k">Floor</span> Ground</span>
        <span className={`chip status-${health}`}>
          <span className="dot" />
          {health === 'ok' ? 'Simulation engine ready' : health === 'checking' ? 'Connecting to backend…' : 'Backend offline'}
        </span>
      </div>

      <div className="header-right">
        <span className="mode-badge" title={info ? `${info.engine} · scikit-learn surrogate · rule-based copilot` : ''}>
          LOCAL SIMULATION MODE
        </span>
        <DemoButton active={!!demo} onClick={onDemo} disabled={health !== 'ok'} />
      </div>
    </header>
  );
}
