import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { RuntimeConfig } from '../types';

type OverlayFocus = 'routes' | 'fire' | 'blocked';
type PlanStage = 'scan' | 'reconstruct' | 'optimize';

const CAPABILITIES = [
  ['01', '3D building simulation', 'Procedural multi-floor geometry for walls, corridors, stairs, exits and room layouts.'],
  ['02', 'Crowd evacuation', 'Social-force pedestrian dynamics that model queueing, rerouting and congestion.'],
  ['03', 'Bottleneck detection', 'Density, flow and queue length identify the spaces that constrain egress.'],
  ['04', 'Risk visualization', 'Spatial density, flow and risk maps expose conditions across the building.'],
  ['05', 'AI-assisted prediction', 'A trained surrogate estimates clearance time from building parameters in milliseconds.'],
  ['06', 'Design optimization', 'Candidate design changes are ranked by predicted or simulated improvement.'],
  ['07', 'Scenario comparison', 'Baseline and alternative conditions can be reviewed side by side.'],
  ['08', 'Floor-plan reconstruction', 'A reviewable geometry draft can be created from a floor-plan image or PDF.'],
] as const;

const OVERLAY_FOCUSES: Array<{ id: OverlayFocus; label: string }> = [
  { id: 'routes', label: 'Egress network' },
  { id: 'fire', label: 'Fire zone' },
  { id: 'blocked', label: 'Blocked exit' },
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function useStoryReveals(reducedMotion: boolean) {
  useEffect(() => {
    if (reducedMotion || !('IntersectionObserver' in window)) return;

    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-story-reveal]'));
    if (!elements.length) return;

    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('story-revealed');
        currentObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' });

    elements.forEach((element, index) => {
      element.classList.add('story-reveal-pending');
      element.style.setProperty('--story-reveal-delay', `${(index % 3) * 80}ms`);
      observer.observe(element);
    });

    return () => {
      observer.disconnect();
      elements.forEach((element) => {
        element.classList.remove('story-reveal-pending', 'story-revealed');
        element.style.removeProperty('--story-reveal-delay');
      });
    };
  }, [reducedMotion]);
}

function useStoryProgress() {
  const ref = useRef<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const raw = (viewport * 0.78 - rect.top) / Math.max(rect.height - viewport * 0.35, 1);
      setProgress(Math.max(0, Math.min(1, raw)));
    };
    const requestUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
    };
  }, []);
  return { ref, progress };
}

function BuildingIntelligenceVisual() {
  return (
    <div className="intelligence-visual" role="img" aria-label="Three-dimensional architectural model with animated evacuation routes">
      <img src="/images/01-building-intelligence.png" alt="" />
      <div className="intelligence-image-wash" />
      <svg className="intelligence-routes" viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <filter id="intelligence-route-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="softGlow" />
            <feMerge>
              <feMergeNode in="softGlow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="intelligence-route-group">
          <path id="intelligence-route-upper" className="intelligence-route-base" d="M 448 223 L 510 190 L 576 211 L 654 187 L 758 221 L 853 257 L 920 234 L 956 194 L 1007 211 L 1122 251 L 1261 296" />
          <path className="intelligence-route-flow route-upper" d="M 448 223 L 510 190 L 576 211 L 654 187 L 758 221 L 853 257 L 920 234 L 956 194 L 1007 211 L 1122 251 L 1261 296" />
          <circle className="intelligence-route-pulse" r="4">
            <animateMotion dur="8.4s" repeatCount="indefinite"><mpath href="#intelligence-route-upper" /></animateMotion>
          </circle>
          <circle className="intelligence-route-pulse route-pulse-secondary" r="3.4">
            <animateMotion dur="8.4s" begin="-4.2s" repeatCount="indefinite"><mpath href="#intelligence-route-upper" /></animateMotion>
          </circle>
        </g>
        <g className="intelligence-route-group">
          <path id="intelligence-route-middle" className="intelligence-route-base" d="M 329 408 L 405 438 L 488 462 L 560 420 L 656 443 L 765 480 L 870 516 L 936 493 L 1017 458 L 1084 478" />
          <path className="intelligence-route-flow route-middle" d="M 329 408 L 405 438 L 488 462 L 560 420 L 656 443 L 765 480 L 870 516 L 936 493 L 1017 458 L 1084 478" />
          <circle className="intelligence-route-pulse" r="4">
            <animateMotion dur="9.7s" begin="-1.7s" repeatCount="indefinite"><mpath href="#intelligence-route-middle" /></animateMotion>
          </circle>
          <circle className="intelligence-route-pulse route-pulse-secondary" r="3.4">
            <animateMotion dur="9.7s" begin="-6.5s" repeatCount="indefinite"><mpath href="#intelligence-route-middle" /></animateMotion>
          </circle>
        </g>
        <g className="intelligence-route-group">
          <path id="intelligence-route-lower" className="intelligence-route-base" d="M 330 553 L 421 591 L 515 630 L 611 666 L 724 707 L 797 674 L 859 650 L 918 679 L 1013 713 L 1114 667 L 1250 619" />
          <path className="intelligence-route-flow route-lower" d="M 330 553 L 421 591 L 515 630 L 611 666 L 724 707 L 797 674 L 859 650 L 918 679 L 1013 713 L 1114 667 L 1250 619" />
          <circle className="intelligence-route-pulse" r="4">
            <animateMotion dur="10.2s" begin="-3.1s" repeatCount="indefinite"><mpath href="#intelligence-route-lower" /></animateMotion>
          </circle>
          <circle className="intelligence-route-pulse route-pulse-secondary" r="3.4">
            <animateMotion dur="10.2s" begin="-8.1s" repeatCount="indefinite"><mpath href="#intelligence-route-lower" /></animateMotion>
          </circle>
        </g>
        <g className="intelligence-route-group">
          <path id="intelligence-route-stair-left" className="intelligence-route-base" d="M 488 462 L 507 478 L 523 492 L 509 508 L 531 524 L 548 508 L 564 485" />
          <path className="intelligence-route-flow route-stair" d="M 488 462 L 507 478 L 523 492 L 509 508 L 531 524 L 548 508 L 564 485" />
          <circle className="intelligence-route-pulse" r="3.6">
            <animateMotion dur="5.6s" begin="-1.1s" repeatCount="indefinite"><mpath href="#intelligence-route-stair-left" /></animateMotion>
          </circle>
        </g>
        <g className="intelligence-route-group">
          <path id="intelligence-route-stair-right" className="intelligence-route-base" d="M 870 516 L 897 501 L 923 480 L 946 459 L 969 441 L 991 452 L 1017 458" />
          <path className="intelligence-route-flow route-stair" d="M 870 516 L 897 501 L 923 480 L 946 459 L 969 441 L 991 452 L 1017 458" />
          <circle className="intelligence-route-pulse" r="3.6">
            <animateMotion dur="6.1s" begin="-3.4s" repeatCount="indefinite"><mpath href="#intelligence-route-stair-right" /></animateMotion>
          </circle>
        </g>
      </svg>
      <div className="intelligence-caption"><span />Spatial model <i /> Egress paths</div>
    </div>
  );
}

function PlanDiagram({ stage, reducedMotion }: { stage: PlanStage; reducedMotion: boolean }) {
  const stages = [
    { id: 'scan', number: '01', title: 'Floor plan', detail: 'Rooms, walls and openings' },
    { id: 'reconstruct', number: '02', title: '3D reconstruction', detail: 'A model you can inspect' },
    { id: 'optimize', number: '03', title: 'Egress routes', detail: 'Paths to available exits' },
  ] as const;
  return (
    <div className={`plan-diagram plan-${stage}${reducedMotion ? ' reduce-motion' : ''}`} role="group" aria-label="Floor plan transformation from architectural drawing to evacuation routes">
      {stages.map((item, index) => (
        <article className={`plan-stage plan-stage-${item.id}${stage === item.id ? ' is-active' : ''}`} key={item.id}>
          <div className="plan-stage-art">
            {index === 0 && <img className="plan-input-image" src="/images/02-floor-plan.png" alt="Architectural floor plan with rooms, corridors, exit points, and evacuation paths" />}
            {index === 1 && (
              <svg viewBox="0 0 360 240" role="img" aria-label="Isometric reconstruction of the same four-room floor plan">
                <defs><linearGradient id="model-floor" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#293833" /><stop offset="1" stopColor="#111b18" /></linearGradient></defs>
                <g className="plan-model-3d">
                  <path className="model-shadow" d="M48 142 177 73 316 132 186 204Z" />
                  <path className="model-base" d="M48 128 177 59 316 118 186 190Z" />
                  <path className="model-wall-face" d="m48 128 129-69V27L48 96Z M177 59l139 59V86L177 27Z" />
                  <path className="model-wall" d="m48 128 129-69 139 59 M48 96l129-69 139 59 M48 128V96 M177 59V27 M316 118V86" />
                  <path className="model-wall-face inner" d="m242 87-47 25V86l47-25Z M175 122l-63 35v-25l63-34Z M289 107l-47 25v-25l47-26Z M223 142l-64 35v-25l64-35Z" />
                  <path className="model-wall model-wall-highlight" d="m242 61-47 25m47 1-47 26m-20 9-63 35m177-50-47 25m-19 9-64 35" />
                  <path className="model-floor-detail" d="m63 124 44-24m-43 39 36-20m153-46 35 15m-45 52 39-21m-126 50 26 11" />
                  <path className="model-furniture" d="m73 115 25-13 20 9-25 14Zm113 28 25-13 19 8-25 14Zm84-23 22-12 17 7-22 13Z" />
                  <path className="model-window" d="m71 116 18 8m131-60 20 9m-96 83 20 9" />
                </g>
              </svg>
            )}
            {index === 2 && (
              <svg viewBox="0 0 360 240" role="img" aria-label="Evacuation routes through the reconstructed floor plan to two exits">
                <path className="route-plan-base" d="M48 128 177 59 316 118 186 190Z M111 95v33 M177 59v39 M247 88v36 M111 128v34 M247 124v35" />
                <path className="route-plan-room" d="m48 128 63-33 66 28 70-35 69 30-130 72Z" />
                <path className="route-plan-wall-face" d="m48 128 129-69V27L48 96Z M177 59l139 59V86L177 27Z" />
                <path className="route-plan-wall" d="m48 128 129-69 139 59 M48 96l129-69 139 59 M48 128V96 M177 59V27 M316 118V86 M242 61l-47 25m47 1-47 26m-20 9-63 35m177-50-47 25m-19 9-64 35" />
                <path className="route-line" d="m69 137 48-26 59 25 69-37 61 26" />
                <path className="route-line route-line-secondary" d="m79 153 39-21 58 25 68-35 48 20" />
                <path className="route-exit" d="m307 117 14 6-14 8z M46 128l-14-6v13z" />
                {!reducedMotion && <circle className="plan-route-traveler" r="3.5"><animateMotion dur="5.2s" repeatCount="indefinite" path="m69 137 48-26 59 25 69-37 61 26" /></circle>}
              </svg>
            )}
          </div>
          <div className="plan-stage-caption"><span>{item.number}</span><div><h3>{item.title}</h3><p>{item.detail}</p></div></div>
        </article>
      ))}
    </div>
  );
}

function HazardIntelligenceVisual({ focus, reducedMotion }: { focus: OverlayFocus; reducedMotion: boolean }) {
  const focusLabel = focus === 'routes' ? 'Egress network' : focus === 'fire' ? 'Fire zone' : 'Blocked exit';
  return (
    <div className={`hazard-intelligence hazard-focus-${focus}`} role="img" aria-label={`${focusLabel} in the architectural evacuation visualization`}>
      <img src="/images/03-scenario-explorer.png" alt="" />
      <svg viewBox="0 0 1890 832" aria-hidden="true">
        <path className="hazard-route route-one" d="M255 240 L435 318 L705 293 L935 378 L1194 485 L1605 420" />
        <path className="hazard-route route-two" d="M325 300 L510 396 L751 424 L954 494 L1191 566 L1497 478" />
        <path className="hazard-route route-stair-left" d="M350 208 L434 320 L520 396" />
        <path className="hazard-route route-stair-right" d="M1488 382 L1606 419 L1693 470" />
        <g className="hazard-fire-marker"><circle cx="1210" cy="254" r="140" /><path d="M1210 112V87" /></g>
        <g className="hazard-blocked-marker"><circle cx="1198" cy="559" r="52" /><path d="M1182 543l32 32m0-32-32 32" /></g>
        <g className="hazard-route-marker"><circle cx="255" cy="240" r="12" /><path d="M244 230 205 196" /></g>
        {!reducedMotion && <><circle className="hazard-traveler" r="7"><animateMotion dur="7.4s" repeatCount="indefinite" path="M255 240 L435 318 L705 293 L935 378 L1194 485 L1605 420" /></circle><circle className="hazard-traveler" r="7"><animateMotion dur="8.1s" begin="-3.4s" repeatCount="indefinite" path="M325 300 L510 396 L751 424 L954 494 L1191 566 L1497 478" /></circle></>}
      </svg>
      <div className="hazard-focus-caption"><span className={`scenario-dot ${focus}`} />{focusLabel}</div>
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="story-eyebrow"><span />{children}</div>;
}

export default function HomeExperience({ config, onLaunch }: { config: RuntimeConfig | null; onLaunch: () => void }) {
  const reducedMotion = useReducedMotion();
  useStoryReveals(reducedMotion);
  const { ref: explorationRef, progress } = useStoryProgress();
  const [planStage, setPlanStage] = useState<PlanStage>('scan');
  const [focus, setFocus] = useState<OverlayFocus>('routes');
  const storyStyle = { '--story-progress': progress.toFixed(3) } as CSSProperties;

  return (
    <>
      <section className="story-exploration" id="product" ref={explorationRef} style={storyStyle}>
        <div className="story-exploration-sticky">
          <div className="story-shell story-exploration-layout">
            <div className="story-copy story-copy-exploration" data-story-reveal>
              <Eyebrow>Live building intelligence</Eyebrow>
              <p className="story-index">0{Math.min(3, Math.max(1, Math.ceil(progress * 3) || 1))}</p>
              <h2>Understand every floor.</h2>
              <p>A clear spatial view connects floors, routes, and exits across the building.</p>
              <div className="story-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
              <div className="story-steps" aria-label="Exploration stages">
                <span className={progress > 0.08 ? 'is-active' : ''}>Observe</span>
                <span className={progress > 0.42 ? 'is-active' : ''}>Separate</span>
                <span className={progress > 0.74 ? 'is-active' : ''}>Route</span>
              </div>
            </div>
            <div className="story-building-frame" data-story-reveal>
              <BuildingIntelligenceVisual />
            </div>
          </div>
        </div>
      </section>

      <section className="story-section story-plan-section" id="how">
        <div className="story-shell story-plan-shell">
          <div className="story-section-heading story-section-heading-split">
            <div data-story-reveal>
              <Eyebrow>01 — floor-plan intelligence</Eyebrow>
              <h2>From floor plan to escape plan.</h2>
            </div>
            <p>Every modeled decision begins with spatial geometry a team can inspect, correct, and trust.</p>
          </div>
          <div className="plan-story" data-story-reveal>
            <div className="plan-controls" role="group" aria-label="Floor plan transformation">
              {(['scan', 'reconstruct', 'optimize'] as PlanStage[]).map((stage, index) => (
                <button key={stage} type="button" aria-pressed={planStage === stage} className={planStage === stage ? 'is-active' : ''} onClick={() => {
                  setPlanStage(stage);
                  if (window.matchMedia('(max-width: 560px)').matches) {
                    document.querySelector<HTMLElement>(`.plan-stage-${stage}`)?.scrollIntoView({
                      behavior: reducedMotion ? 'auto' : 'smooth',
                      block: 'nearest',
                      inline: 'center',
                    });
                  }
                }}>
                  <span>0{index + 1}</span>
                  {stage === 'scan' ? 'Floor plan' : stage === 'reconstruct' ? '3D model' : 'Egress'}
                </button>
              ))}
            </div>
            <div className="plan-visual">
              <PlanDiagram stage={planStage} reducedMotion={reducedMotion} />
            </div>
          </div>
        </div>
      </section>

      <section className="story-section story-hazard-section">
        <div className="story-shell story-hazard-layout">
          <div className="story-copy" data-story-reveal>
            <Eyebrow>02 — scenario explorer</Eyebrow>
            <h2>See how conditions change the route.</h2>
            <p>Visualize how the building behaves when a hazard grows, a route closes, or a safer path becomes available.</p>
            <div className="scenario-controls" role="group" aria-label="Architectural model focus">
              {OVERLAY_FOCUSES.map((item) => <button key={item.id} type="button" aria-pressed={focus === item.id} className={focus === item.id ? 'is-active' : ''} onClick={() => setFocus(item.id)}><span className={`scenario-dot ${item.id}`} />{item.label}</button>)}
            </div>
          </div>
          <div className="scenario-visual" data-story-reveal>
            <HazardIntelligenceVisual focus={focus} reducedMotion={reducedMotion} />
            <div className="scenario-legend">
              <span><i className="legend-route" />Evacuation route</span>
              <span><i className="legend-fire" />Hazard</span>
              <span><i className="legend-blocked" />Unavailable exit</span>
            </div>
          </div>
        </div>
      </section>

      <section className="story-section story-capabilities" id="features">
        <div className="story-shell">
          <div className="story-section-heading story-section-heading-split" data-story-reveal>
            <div>
              <Eyebrow>Capabilities</Eyebrow>
              <h2>Designed for the decisions between a plan and a safer exit.</h2>
            </div>
            <p>Simulation inputs, reviewable geometry, and focused visual communication in one workflow.</p>
          </div>
          <div className="story-capability-grid" data-story-reveal>
            {CAPABILITIES.map(([number, title, description]) => (
              <article className="story-capability" key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
                <i aria-hidden="true">↗</i>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="story-section story-platform" id="platform">
        <div className="story-shell story-platform-layout" data-story-reveal>
          <div>
            <Eyebrow>Local infrastructure</Eyebrow>
            <h2>Simulation stays inspectable. Plan import stays reviewable.</h2>
            <p className="story-lede">Wayout is built around local simulation, with explicit status for accelerated execution and floor-plan reconstruction.</p>
          </div>
          <div className="platform-status-grid">
            <article>
              <span className="platform-label">Simulation runtime</span>
              <strong>{config?.cuda_active ? 'CUDA acceleration active' : 'CPU local runtime'}</strong>
              <p>Evacuation logic runs locally through the same simulation interface.</p>
              <i className={config?.cuda_active ? 'status-good' : ''} />
            </article>
            <article>
              <span className="platform-label">Plan reconstruction</span>
              <strong>{config?.nemotron_design_available ? 'Plan import ready' : 'Plan import not configured'}</strong>
              <p>Image-derived walls, rooms and exits remain available for human review.</p>
              <i className={config?.nemotron_design_available ? 'status-good' : ''} />
            </article>
          </div>
        </div>
      </section>

      <section className="story-final-cta" data-story-reveal>
        <Eyebrow>Build safer spaces</Eyebrow>
        <h2>See the route before it matters.</h2>
        <p>Model the building, test the scenario and validate the design change.</p>
        <button className="btn primary" onClick={onLaunch}>Launch Simulator <span>↗</span></button>
      </section>

      <footer className="home-footer"><span>Wayout</span><span>Local simulation, real physics, honest AI.</span></footer>
    </>
  );
}
