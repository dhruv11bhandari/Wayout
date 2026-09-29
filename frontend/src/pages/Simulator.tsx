import { useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Vignette } from '@react-three/postprocessing';
import { useMultiFloorSim } from '../state/useMultiFloorSim';
import ParameterPanel from '../components/ParameterPanel';
import RecommendationList from '../components/RecommendationList';
import BottleneckPanel from '../components/BottleneckPanel';
import MetricsCard from '../components/MetricsCard';
import FloorPlan from '../components/FloorPlan';
import { LayerControls } from '../components/Heatmap';
import AgentSimulation from '../components/AgentSimulation';
import Copilot from '../components/Copilot';
import SceneLighting from '../three/SceneLighting';
import CameraRig from '../three/CameraRig';
import Building3D from '../three/Building3D';
import Agents3D from '../three/Agents3D';
import Heatmap3D from '../three/Heatmap3D';
import { api } from '../api/client';
import { fmtClock, fmtSigned } from '../utils/format';
import type { CameraPresetT } from '../three/scene-utils';
import type { CopilotMessage, HeatMode } from '../types';

type Route = 'home' | 'simulator';
type ViewMode = '3d' | '2d';

export default function Simulator({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const sim = useMultiFloorSim();
  const {
    health, config, params, updateParams, setFloorCount, setTotalOccupancy, toggleBlockedExit, toggleBlockedStair,
    building, prediction, predictionLoading, result, trajectories, status, error, run, baseline, pinBaseline,
    recommendations, recStatus, fetchRecommendations, applyAndRun, selectedFloor, setSelectedFloor, playback,
  } = sim;

  const [view, setView] = useState<ViewMode>('3d');
  const [camPreset, setCamPreset] = useState<CameraPresetT>('iso');
  const [heatMode, setHeatMode] = useState<HeatMode>('peak');
  const [floorVisibility, setFloorVisibility] = useState<'all' | 'isolate'>('all');
  const [showLabels, setShowLabels] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [selectedExit, setSelectedExit] = useState<string | null>(null);

  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([]);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const msgId = useRef(0);

  const running = status === 'running';
  const bw = building?.floors?.[0]?.width ?? 64;
  const bh = building?.floors?.[0]?.height ?? 40;
  const radius = Math.max(bw, bh) * 0.85;
  const floorHeight = params.floor_height;

  const handleSendCopilot = async (text: string) => {
    msgId.current += 1;
    setCopilotMessages((m) => [...m, { id: msgId.current, role: 'user', text }]);
    setCopilotBusy(true);
    try {
      const groundParams = building?.floors?.[0]?.params ?? {
        occupancy: params.occupancy[0] ?? 140, corridor_width: params.corridor_width, exit_width: params.exit_width,
        num_exits: params.num_exits, agent_speed: params.agent_speed, blocked_exits: params.blocked_exits, seed: params.seed,
      };
      const reply = await api.copilot(text, groundParams);
      msgId.current += 1;
      setCopilotMessages((m) => [...m, { id: msgId.current, role: 'copilot', text: reply.reply }]);
    } catch {
      msgId.current += 1;
      setCopilotMessages((m) => [...m, { id: msgId.current, role: 'copilot', text: "Sorry - I couldn't reach the simulator just now." }]);
    } finally {
      setCopilotBusy(false);
    }
  };

  const selFloorBuilding = building?.floors?.[selectedFloor] ?? null;
  const selFloorResult = result?.floors?.[selectedFloor] ?? null;
  const selFloorTraj = trajectories[selectedFloor] ?? null;

  return (
    <div className="simulator">
      <header className="header">
        <button className="brand" onClick={() => onNavigate('home')}>
          <span className="brand-mark" />
          <span className="brand-name">WAYOUT</span>
        </button>
        <div className="header-center">
          <span className="mode-badge">
            <span className="dot" style={{ color: health === 'ok' ? '#4ade80' : health === 'checking' ? '#eab308' : '#ef4444' }} />
            {health === 'ok' ? 'Connected' : health === 'checking' ? 'Connecting…' : 'Backend offline'}
          </span>
          {config && <span className="chip"><span className="chip-k">{config.simulation_engine}</span></span>}
        </div>
        <div className="header-right">
          <button className="btn ghost small" onClick={() => onNavigate('home')}>Home</button>
        </div>
      </header>

      <div className="main">
        <ParameterPanel
          params={params}
          onChange={updateParams}
          onFloorCount={setFloorCount}
          onTotalOccupancy={setTotalOccupancy}
          onToggleExit={toggleBlockedExit}
          onToggleStair={toggleBlockedStair}
          onRun={run}
          running={running}
          prediction={prediction}
          predictionLoading={predictionLoading}
        />

        <div className="canvas-wrap">
          <div className="viewport">
            {view === '3d' ? (
              <Canvas shadows className="viewport-canvas" camera={{ fov: 42, position: [radius, radius, radius] }} gl={{ antialias: true }}>
                <color attach="background" args={['#000000']} />
                <fog attach="fog" args={['#000000', radius * 2.4, radius * 6]} />
                <SceneLighting />
                <CameraRig preset={camPreset} focusFloor={selectedFloor} floorHeight={floorHeight} radius={radius} />
                {building?.floors.map((f, i) => {
                  const isVisible = floorVisibility === 'all' || i === selectedFloor;
                  const opacity = floorVisibility === 'all' ? (i === selectedFloor ? 1 : 0.32) : 1;
                  const floorResult = result?.floors?.[i] ?? null;
                  return (
                    <group key={f.floor} visible={isVisible}>
                      <Building3D
                        building={f}
                        floorY={i * floorHeight}
                        opacity={opacity}
                        showLabels={showLabels}
                        selectedExit={selectedExit}
                        onSelectExit={setSelectedExit}
                      />
                      {floorResult && (
                        <>
                          <Heatmap3D
                            densityGrid={floorResult.density_grid}
                            trajectory={trajectories[i] ?? null}
                            floorY={i * floorHeight}
                            width={f.width}
                            height={f.height}
                            mode={heatMode}
                            timeRef={playback.timeRef}
                          />
                          <Agents3D
                            trajectory={trajectories[i] ?? null}
                            floorY={i * floorHeight}
                            ox={-f.width / 2}
                            oz={-f.height / 2}
                            timeRef={playback.timeRef}
                            visible={isVisible}
                          />
                        </>
                      )}
                    </group>
                  );
                })}
                <EffectComposer>
                  <Vignette eskil={false} offset={0.28} darkness={0.55} />
                </EffectComposer>
              </Canvas>
            ) : (
              <FloorPlan
                building={selFloorBuilding}
                sim={selFloorResult}
                traj={selFloorTraj}
                timeRef={playback.timeRef}
                heatMode={heatMode}
                showPaths={showPaths}
                showLabels={showLabels}
                selectedExit={selectedExit}
                onSelectExit={setSelectedExit}
              />
            )}

            <div className="viewport-hud-top">
              <div className="segmented">
                <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>3D Simulation</button>
                <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>2D Analysis</button>
              </div>
              {view === '3d' && (
                <div className="cam-presets">
                  {(['orbit', 'top', 'iso', 'floor'] as CameraPresetT[]).map((p) => (
                    <button key={p} className={camPreset === p ? 'on' : ''} onClick={() => setCamPreset(p)}>{p.toUpperCase()}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="viewport-hud-bottom">
              <div className="floor-switch">
                {(building?.floors ?? []).map((f) => (
                  <button key={f.floor} className={selectedFloor === f.floor ? 'on' : ''} onClick={() => setSelectedFloor(f.floor)}>
                    {f.floor === 0 ? 'GROUND' : `FLOOR ${f.floor}`}
                  </button>
                ))}
                {building && building.n_floors > 1 && (
                  <button className={floorVisibility === 'isolate' ? 'on' : ''} onClick={() => setFloorVisibility((v) => (v === 'all' ? 'isolate' : 'all'))}>
                    ISOLATE
                  </button>
                )}
              </div>
              {view === '3d' ? (
                <div className="heat-modes">
                  {(['off', 'peak', 'live'] as HeatMode[]).map((m) => (
                    <button key={m} className={heatMode === m ? 'on' : ''} onClick={() => setHeatMode(m)}>{m.toUpperCase()}</button>
                  ))}
                  <button className={showLabels ? 'on' : ''} onClick={() => setShowLabels((v) => !v)}>LABELS</button>
                </div>
              ) : (
                <LayerControls
                  mode={heatMode} onMode={setHeatMode}
                  showPaths={showPaths} onPaths={setShowPaths}
                  showLabels={showLabels} onLabels={setShowLabels}
                  hasResult={!!selFloorResult}
                />
              )}
            </div>

            {!result && !running && (
              <div className="busy" style={{ background: 'rgba(0,0,0,.55)' }}>
                <div className="busy-box">
                  <div className="busy-title">Ready to simulate</div>
                  <div className="busy-sub">Adjust the parameters, then press Run Simulation.</div>
                </div>
              </div>
            )}
            {running && (
              <div className="busy">
                <div className="busy-box">
                  <div className="busy-title">Running the evacuation…</div>
                  <div className="busy-sub">
                    Simulating {params.n_floors} floor{params.n_floors > 1 ? 's' : ''}, chained through the stairwells.
                  </div>
                  <div className="indeterminate" />
                </div>
              </div>
            )}
            {error && !running && (
              <div className="busy" style={{ background: 'rgba(0,0,0,.7)' }}>
                <div className="busy-box"><div className="error-box">{error}</div></div>
              </div>
            )}
          </div>

          {result && selFloorTraj && (
            <div className="bottom">
              <AgentSimulation playback={playback} traj={selFloorTraj} total={selFloorResult?.total_agents ?? 0} running={running} />
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="scroll-sections">
          <section className="scroll-section">
            <div className="section-num">01 — LIVE METRICS</div>
            <h2>Whole-building metrics</h2>
            <div className="metrics-grid">
              <MetricsCard label="Clearance time" value={fmtClock(result.clearance_time)} tone={result.completed ? 'good' : 'bad'} />
              <MetricsCard
                label="AI predicted clearance"
                value={prediction ? fmtClock(prediction.predicted_clearance_time) : '—'}
                tone="accent"
                sub={prediction
                  ? `${fmtSigned(prediction.predicted_clearance_time - result.clearance_time)}s vs. actual · typ. ±${prediction.expected_error_s.toFixed(0)}s`
                  : undefined}
              />
              <MetricsCard label="Total occupants" value={result.total_agents} />
              <MetricsCard label="Peak density" value={result.max_density.toFixed(1)} unit="/m²" tone={result.max_density > 4 ? 'bad' : result.max_density > 2.5 ? 'warn' : 'good'} />
              <MetricsCard label="Floors" value={result.n_floors} />
              <MetricsCard label="Status" value={result.completed ? 'Completed' : 'Incomplete'} tone={result.completed ? 'good' : 'bad'} />
            </div>
          </section>

          <section className="scroll-section">
            <div className="section-num">02 — BOTTLENECKS</div>
            <h2>Where the building constrains egress</h2>
            <BottleneckPanel global={result.bottleneck} byFloor={result.bottlenecks_by_floor} />
          </section>

          <section className="scroll-section">
            <div className="section-num">03 — WAYOUT AI</div>
            <h2>Recommendations</h2>
            <p className="dim" style={{ marginBottom: 20, maxWidth: 640 }}>
              Ranked by {result.n_floors > 1 ? 'real re-simulation of each candidate change' : "Wayout's trained ML surrogate"},
              against the bottleneck actually detected above - never a canned suggestion.
            </p>
            <RecommendationList recommendations={recommendations} status={recStatus} onFetch={fetchRecommendations} onApply={applyAndRun} applying={running} />
          </section>

          <section className="scroll-section">
            <div className="section-num">04 — SCENARIO COMPARISON</div>
            <h2>Baseline vs. current design</h2>
            {baseline ? (
              <ScenarioCompare baseline={baseline.result} current={result} />
            ) : (
              <div className="empty">Run a simulation to set a baseline.</div>
            )}
            <div style={{ marginTop: 14 }}>
              <button className="btn outline small" onClick={pinBaseline}>Pin current design as baseline</button>
            </div>
          </section>

          <section className="scroll-section">
            <div className="section-num">05 — COPILOT</div>
            <h2>Ask Wayout</h2>
            <p className="dim" style={{ marginBottom: 16, maxWidth: 640 }}>
              Reasons about the ground floor, where the building&rsquo;s real exits are. Every number it cites came
              from the simulation above - it can&rsquo;t invent one.
            </p>
            <div className="scroll-copilot">
              <Copilot messages={copilotMessages} busy={copilotBusy} onSend={handleSendCopilot} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ScenarioCompare({ baseline, current }: { baseline: import('../types').MultiFloorResult; current: import('../types').MultiFloorResult }) {
  const ctDelta = ((baseline.clearance_time - current.clearance_time) / baseline.clearance_time) * 100;
  const densDelta = ((baseline.max_density - current.max_density) / baseline.max_density) * 100;
  return (
    <div className="compare-panel">
      <div className="compare-row head"><div>Metric</div><div>Baseline</div><div>Current</div><div>Change</div></div>
      <div className="compare-row">
        <div className="compare-metric">Clearance time</div>
        <div className="compare-val">{fmtClock(baseline.clearance_time)}</div>
        <div className="compare-val">{fmtClock(current.clearance_time)}</div>
        <div className={`compare-val compare-delta ${ctDelta >= 0 ? 'good' : 'bad'}`}>{ctDelta >= 0 ? '-' : '+'}{Math.abs(ctDelta).toFixed(1)}%</div>
      </div>
      <div className="compare-row">
        <div className="compare-metric">Peak density</div>
        <div className="compare-val">{baseline.max_density.toFixed(1)}/m²</div>
        <div className="compare-val">{current.max_density.toFixed(1)}/m²</div>
        <div className={`compare-val compare-delta ${densDelta >= 0 ? 'good' : 'bad'}`}>{densDelta >= 0 ? '-' : '+'}{Math.abs(densDelta).toFixed(1)}%</div>
      </div>
      <div className="compare-row">
        <div className="compare-metric">Bottleneck</div>
        <div className="compare-val" style={{ fontSize: 12 }}>{baseline.bottleneck.label}</div>
        <div className="compare-val" style={{ fontSize: 12 }}>{current.bottleneck.label}</div>
        <div />
      </div>
    </div>
  );
}
