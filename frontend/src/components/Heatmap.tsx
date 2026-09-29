import type { HeatMode } from '../types';

interface Props {
  mode: HeatMode;
  onMode: (m: HeatMode) => void;
  showPaths: boolean;
  onPaths: (v: boolean) => void;
  showLabels: boolean;
  onLabels: (v: boolean) => void;
  hasResult: boolean;
}

export function LayerControls({ mode, onMode, showPaths, onPaths, showLabels, onLabels, hasResult }: Props) {
  return (
    <div className="layers">
      <div className="layer-group">
        <span className="layer-title">Heatmap</span>
        <div className="segmented small">
          {(['off', 'live', 'peak'] as HeatMode[]).map((m) => (
            <button
              key={m}
              className={mode === m ? 'on' : ''}
              onClick={() => onMode(m)}
              disabled={!hasResult && m !== 'off'}
              title={!hasResult ? 'Run an analysis first' : m === 'live' ? 'Live density during playback' : m === 'peak' ? 'Maximum density reached' : 'Hide heatmap'}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <button className={`toggle ${showPaths ? 'on' : ''}`} onClick={() => onPaths(!showPaths)}>Paths</button>
      <button className={`toggle ${showLabels ? 'on' : ''}`} onClick={() => onLabels(!showLabels)}>Labels</button>
    </div>
  );
}

export function Legend({ hasResult }: { hasResult: boolean }) {
  return (
    <div className="legend">
      <div className="legend-row"><i className="sw agent" />{hasResult ? 'Moving freely' : 'Agents'}</div>
      {hasResult && <div className="legend-row"><i className="sw slow" />Slowed</div>}
      {hasResult && <div className="legend-row"><i className="sw stalled" />Stalled</div>}
      <div className="legend-row"><i className="sw exit" />Exit</div>
      <div className="legend-row"><i className="sw path" />Evacuation path</div>
      <div className="legend-row"><i className="sw bottleneck" />Bottleneck</div>
      <div className="legend-ramp">
        <div className="ramp" />
        <div className="ramp-labels"><span>0</span><span>1.5</span><span>3+ /m²</span></div>
      </div>
    </div>
  );
}
