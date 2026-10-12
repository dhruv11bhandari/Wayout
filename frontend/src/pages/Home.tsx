import { useEffect, useState } from 'react';
import HeroScene from '../three/HeroScene';
import { api } from '../api/client';
import type { RuntimeConfig } from '../types';

type Route = 'home' | 'simulator';

const CAPABILITIES = [
  { name: '3D Building Simulation', desc: 'Procedural multi-floor geometry generated from real parameters: walls, corridors, stairs, exits.' },
  { name: 'Crowd Evacuation', desc: 'Social-force pedestrian dynamics - agents queue, reroute and respond to congestion in real time.' },
  { name: 'Bottleneck Detection', desc: 'A severity score computed from measured density, flow and queue length, not a guess.' },
  { name: 'Risk Mapping', desc: 'Density, flow and risk heatmaps rendered straight from the simulation grid.' },
  { name: 'AI Prediction', desc: 'A trained surrogate model estimates clearance time from building parameters in milliseconds.' },
  { name: 'Design Optimization', desc: 'Candidate design changes ranked by real predicted or simulated improvement.' },
  { name: 'Scenario Comparison', desc: 'Baseline design versus an optimized one, evaluated side by side.' },
  { name: 'AI Copilot', desc: 'Ask about the building - every number it cites came from the simulator, never invented.' },
];

const HOW_STEPS = [
  { num: '01', name: 'Build', desc: 'Configure floors, occupancy, corridor and exit widths - or start from the demo building.' },
  { num: '02', name: 'Simulate', desc: 'A social-force pedestrian model moves every occupant toward an exit, floor by floor.' },
  { num: '03', name: 'Analyze', desc: 'Density, flow and bottlenecks are measured directly from the simulation.' },
  { num: '04', name: 'Optimize', desc: 'Wayout scores design changes and lets you validate them with a real re-simulation.' },
];

export default function Home({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
  }, []);

  return (
    <div className="home">
      <nav className="home-nav">
        <button className="brand" onClick={() => onNavigate('home')}>
          <span className="brand-mark" />
          <span className="brand-name">WAYOUT</span>
        </button>
        <button className="btn outline" onClick={() => onNavigate('simulator')}>Launch Simulator</button>
      </nav>

      <section className="hero">
        <div className="hero-scene"><HeroScene /></div>
        <div className="hero-scrim" />
        <div className="hero-inner">
          <div className="hero-eyebrow"><span className="dot good-text" />AI-powered evacuation intelligence</div>
          <h1 className="hero-title">
            <span className="stack">WAYOUT</span>
            <span className="stack" style={{ color: 'var(--ink-dim)', fontSize: '0.4em', marginTop: 10 }}>
              Simulate. Predict. Evacuate.
            </span>
          </h1>
          <p className="hero-sub">
            Wayout builds a digital evacuation model of your building and simulates how people actually move
            through it - then uses that data to find the bottlenecks and recommend safer designs.
          </p>
          <div className="hero-actions">
            <button className="btn primary" onClick={() => onNavigate('simulator')}>Launch Simulator</button>
            <button className="btn outline" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>
              Explore Wayout
            </button>
          </div>
        </div>
      </section>

      <section className="section problem-solution">
        <div className="section-inner split-2">
          <div>
            <div className="section-kicker">The problem</div>
            <h3>Buildings are designed for occupancy, not for the minutes that matter most.</h3>
            <p>Evacuation performance is difficult to reason about before an emergency - it depends on geometry,
              crowd behavior and timing all at once, in ways a static floor plan can&rsquo;t show.</p>
          </div>
          <div>
            <div className="section-kicker">The solution</div>
            <h3>A digital evacuation model, run before the building has to prove itself.</h3>
            <p>Wayout simulates how occupants actually move through a space - queuing, rerouting, reacting to
              congestion - and turns that into measured bottlenecks and specific design recommendations.</p>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section-inner">
          <div className="section-kicker">How it works</div>
          <h2 className="section-title">From a set of parameters to a validated design change.</h2>
          <div className="how-steps">
            {HOW_STEPS.map((s) => (
              <div className="how-step" key={s.num}>
                <div className="how-num">{s.num}</div>
                <div className="how-name">{s.name}</div>
                <div className="how-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-inner">
          <div className="section-kicker">Core capabilities</div>
          <h2 className="section-title">Everything between a floor plan and a validated design change.</h2>
          <div className="cap-grid">
            {CAPABILITIES.map((c, i) => (
              <div className="cap-card" key={c.name}>
                <div className="cap-num">{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <div className="cap-name">{c.name}</div>
                  <div className="cap-desc">{c.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section arch-section">
        <div className="section-inner">
          <div className="section-kicker">Built for NVIDIA acceleration</div>
          <h2 className="section-title">Local evacuation simulation, with AI-assisted plan import.</h2>
          <p className="section-body">
            The demo and evacuation model run locally. Uploaded floor plans use Nemotron to draft geometry;
            the running server reports whether plan extraction is configured.
          </p>
          <div className="arch-cols">
            <div className="arch-col">
              <div className="arch-col-title">
                Wayout Simulation
                <span className="arch-status">
                  <span className="dot" style={{ color: config?.cuda_active ? '#4ade80' : 'var(--ink-faint)' }} />
                  {config ? (config.cuda_active ? 'CUDA active' : 'CPU (local)') : '…'}
                </span>
              </div>
              <div className="arch-flow">
                <div className="arch-node">Wayout Simulation</div>
                <div className="arch-arrow">&darr;</div>
                <div className="arch-node dim">NVIDIA CUDA</div>
                <div className="arch-arrow">&darr;</div>
                <div className="arch-node">GPU-accelerated simulation</div>
              </div>
              <div className="arch-note">
                CudaSimulationEngine is a clean stub behind the same interface as the CPU engine - agent-agent
                and agent-wall force calculation are the target for acceleration.
              </div>
            </div>
            <div className="arch-col">
              <div className="arch-col-title">
                Wayout Intelligence
                <span className="arch-status">
                  <span className="dot" style={{ color: config?.nemotron_design_available ? '#4ade80' : 'var(--ink-faint)' }} />
                  {config ? (config.nemotron_design_available ? 'Plan import ready' : 'Plan import not configured') : '…'}
                </span>
              </div>
              <div className="arch-flow">
                <div className="arch-node">Uploaded floor plan</div>
                <div className="arch-arrow">&darr;</div>
                <div className="arch-node dim">NVIDIA Nemotron Omni</div>
                <div className="arch-arrow">&darr;</div>
                <div className="arch-node">Reviewable floor-plan geometry</div>
              </div>
              <div className="arch-note">
                Nemotron proposes rooms, walls, and exits from a one-floor image or PDF. WayOut converts that
                draft into simulator geometry; image-derived measurements should be reviewed.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="section-kicker">Build safer spaces</div>
        <h2 className="section-title">Launch Wayout</h2>
        <button className="btn primary" onClick={() => onNavigate('simulator')}>Launch Simulator</button>
      </section>

      <footer className="home-footer">
        <span>Wayout</span>
        <span>Local simulation, real physics, honest AI.</span>
      </footer>
    </div>
  );
}
