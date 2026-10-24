import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { RuntimeConfig } from '../types';
import HomeExperience from '../components/HomeExperience';

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

type HeroPoint = readonly [number, number];

type HeroRoute = {
  length: number;
  segments: { from: HeroPoint; to: HeroPoint; start: number; length: number }[];
};

const HERO_ROUTE_POINTS: HeroPoint[][] = [
  [
    [478, 255], [518, 237], [562, 218], [605, 207], [650, 211], [692, 198],
    [740, 177], [785, 155], [814, 143], [849, 155], [892, 146], [931, 151],
    [961, 171], [959, 199], [1000, 218], [1053, 234], [1112, 253], [1170, 270], [1211, 284],
  ],
  [
    [1095, 646], [1075, 667], [1044, 690], [1013, 712], [982, 732], [951, 751],
    [918, 772], [890, 788], [860, 805], [835, 802], [800, 781], [767, 762],
    [735, 744], [697, 723], [662, 705], [629, 686], [603, 673], [579, 667],
    [553, 671], [528, 683], [501, 699], [475, 714], [447, 731], [411, 750],
  ],
  [[458, 633], [476, 609], [493, 582], [510, 555], [528, 528], [547, 501]],
  [[1080, 650], [1096, 624], [1112, 597], [1127, 570], [1143, 542], [1159, 514]],
];

const HERO_ROUTES: HeroRoute[] = HERO_ROUTE_POINTS.map((points) => {
  let length = 0;
  const segments = points.slice(1).map((to, index) => {
    const from = points[index];
    const segmentLength = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const segment = { from, to, start: length, length: segmentLength };
    length += segmentLength;
    return segment;
  });
  return { length, segments };
});

const HERO_WALKERS = [
  { route: 0, start: 0.08, speed: 34, stairs: false },
  { route: 0, start: 0.52, speed: 31, stairs: false },
  { route: 1, start: 0.18, speed: 40, stairs: false },
  { route: 1, start: 0.62, speed: 36, stairs: false },
  { route: 2, start: 0.24, speed: 23, stairs: true },
  { route: 2, start: 0.77, speed: 20, stairs: true },
  { route: 3, start: 0.34, speed: 24, stairs: true },
  { route: 3, start: 0.81, speed: 21, stairs: true },
];

const HERO_FLAMES = [
  { x: 625, y: 415, w: 42, h: 59, phase: 0.2 },
  { x: 670, y: 437, w: 48, h: 65, phase: 1.4 },
  { x: 715, y: 451, w: 54, h: 74, phase: 2.3 },
  { x: 763, y: 465, w: 58, h: 85, phase: 0.8 },
  { x: 814, y: 477, w: 62, h: 96, phase: 1.9 },
  { x: 868, y: 482, w: 64, h: 105, phase: 2.8 },
  { x: 922, y: 467, w: 59, h: 91, phase: 0.5 },
  { x: 975, y: 451, w: 55, h: 79, phase: 1.7 },
  { x: 1022, y: 435, w: 49, h: 70, phase: 2.5 },
  { x: 1057, y: 416, w: 42, h: 58, phase: 1.1 },
];

function sampleHeroRoute(route: HeroRoute, distance: number) {
  const target = Math.max(0, Math.min(distance, route.length));
  const segment = route.segments.find((item) => target <= item.start + item.length) ?? route.segments[route.segments.length - 1];
  const progress = segment.length ? (target - segment.start) / segment.length : 0;
  return {
    x: segment.from[0] + (segment.to[0] - segment.from[0]) * progress,
    y: segment.from[1] + (segment.to[1] - segment.from[1]) * progress,
  };
}

function positionFactor(value: string, freeSpace: number, axis: 'x' | 'y') {
  if (value.endsWith('%')) return Number.parseFloat(value) / 100;
  if ((axis === 'x' && value === 'left') || (axis === 'y' && value === 'top')) return 0;
  if ((axis === 'x' && value === 'right') || (axis === 'y' && value === 'bottom')) return 1;
  if (value === 'center') return 0.5;
  if (value.endsWith('px') && freeSpace) return Number.parseFloat(value) / freeSpace;
  return 0.5;
}

export default function Home({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const heroSceneRef = useRef<HTMLDivElement | null>(null);
  const heroImageRef = useRef<HTMLImageElement | null>(null);
  const heroCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    const scene = heroSceneRef.current;
    const image = heroImageRef.current;
    const canvas = heroCanvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!scene || !image || !canvas || !context) return;

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionPreference.matches;
    let frameId = 0;
    let lastFrame = 0;
    let elapsed = 0;
    let layout = { width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
    const embers = Array.from({ length: 20 }, (_, index) => ({
      x: 610 + Math.random() * 445,
      y: 390 + Math.random() * 88,
      lift: 62 + Math.random() * 62,
      drift: -10 + Math.random() * 20,
      speed: 0.32 + Math.random() * 0.16,
      size: 1.2 + Math.random() * 1.5,
      phase: index / 20 + Math.random() * 0.08,
    }));

    const resizeCanvas = () => {
      const box = scene.getBoundingClientRect();
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;
      if (!naturalWidth || !naturalHeight || !box.width || !box.height) return;

      const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
      const drawnWidth = naturalWidth * scale;
      const drawnHeight = naturalHeight * scale;
      const freeX = box.width - drawnWidth;
      const freeY = box.height - drawnHeight;
      const [horizontal = '50%', vertical = '50%'] = window.getComputedStyle(image).objectPosition.split(/\s+/);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      layout = {
        width: box.width,
        height: box.height,
        scale,
        offsetX: freeX * positionFactor(horizontal, freeX, 'x'),
        offsetY: freeY * positionFactor(vertical, freeY, 'y'),
        dpr,
      };
      const pixelWidth = Math.round(box.width * dpr);
      const pixelHeight = Math.round(box.height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    };

    const drawExitGlow = (x: number, y: number, radius: number, color: string, phase: number) => {
      const pulse = 0.5 + Math.sin(elapsed * 1.25 + phase) * 0.5;
      const glow = context.createRadialGradient(x, y, 1, x, y, radius * (0.85 + pulse * 0.15));
      glow.addColorStop(0, `rgba(${color},${0.11 + pulse * 0.06})`);
      glow.addColorStop(0.42, `rgba(${color},${0.045 + pulse * 0.025})`);
      glow.addColorStop(1, `rgba(${color},0)`);
      context.fillStyle = glow;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };

    const drawFlames = () => {
      context.save();
      context.beginPath();
      context.moveTo(595, 368);
      context.lineTo(651, 343);
      context.lineTo(700, 348);
      context.lineTo(750, 326);
      context.lineTo(810, 343);
      context.lineTo(856, 354);
      context.lineTo(900, 341);
      context.lineTo(948, 352);
      context.lineTo(995, 365);
      context.lineTo(1047, 389);
      context.lineTo(1080, 420);
      context.lineTo(1070, 446);
      context.lineTo(1025, 466);
      context.lineTo(972, 483);
      context.lineTo(916, 496);
      context.lineTo(860, 493);
      context.lineTo(807, 480);
      context.lineTo(755, 464);
      context.lineTo(705, 450);
      context.lineTo(656, 433);
      context.lineTo(612, 416);
      context.closePath();
      context.clip();
      context.globalCompositeOperation = 'screen';

      const glowPulse = 0.5 + Math.sin(elapsed * 2.2) * 0.5;
      context.save();
      context.translate(842, 424);
      context.scale(1.55, 0.72);
      const warmGlow = context.createRadialGradient(0, 0, 12, 0, 0, 185);
      warmGlow.addColorStop(0, `rgba(255,104,22,${0.075 + glowPulse * 0.025})`);
      warmGlow.addColorStop(0.55, `rgba(255,93,12,${0.035 + glowPulse * 0.015})`);
      warmGlow.addColorStop(1, 'rgba(255,82,12,0)');
      context.fillStyle = warmGlow;
      context.beginPath();
      context.arc(0, 0, 185, 0, Math.PI * 2);
      context.fill();
      context.restore();

      for (const flame of HERO_FLAMES) {
        const flicker = 0.5 + Math.sin(elapsed * 5.2 + flame.phase) * 0.28 + Math.sin(elapsed * 8.7 + flame.phase * 1.7) * 0.22;
        const height = flame.h * (0.74 + flicker * 0.32);
        const width = flame.w * (0.88 + Math.sin(elapsed * 4.1 + flame.phase) * 0.1);
        const lean = Math.sin(elapsed * 3.4 + flame.phase) * width * 0.18;
        const tipX = flame.x + lean;

        context.globalAlpha = 0.5 + flicker * 0.22;
        context.beginPath();
        context.moveTo(flame.x - width * 0.48, flame.y);
        context.bezierCurveTo(flame.x - width * 0.6, flame.y - height * 0.28, tipX - width * 0.34, flame.y - height * 0.63, tipX, flame.y - height);
        context.bezierCurveTo(tipX + width * 0.12, flame.y - height * 0.75, flame.x + width * 0.62, flame.y - height * 0.39, flame.x + width * 0.47, flame.y);
        context.closePath();
        const outer = context.createLinearGradient(flame.x, flame.y - height, flame.x, flame.y);
        outer.addColorStop(0, 'rgba(255,242,166,0.08)');
        outer.addColorStop(0.22, 'rgba(255,190,68,0.2)');
        outer.addColorStop(0.65, 'rgba(255,111,22,0.18)');
        outer.addColorStop(1, 'rgba(255,66,8,0.05)');
        context.fillStyle = outer;
        context.fill();

        context.globalAlpha = 0.38 + flicker * 0.14;
        context.beginPath();
        context.moveTo(flame.x - width * 0.2, flame.y);
        context.bezierCurveTo(flame.x - width * 0.28, flame.y - height * 0.2, tipX - width * 0.12, flame.y - height * 0.4, tipX + lean * 0.1, flame.y - height * 0.57);
        context.bezierCurveTo(tipX + width * 0.18, flame.y - height * 0.35, flame.x + width * 0.26, flame.y - height * 0.17, flame.x + width * 0.2, flame.y);
        context.closePath();
        const core = context.createLinearGradient(flame.x, flame.y - height * 0.58, flame.x, flame.y);
        core.addColorStop(0, 'rgba(255,249,196,0.1)');
        core.addColorStop(0.45, 'rgba(255,210,91,0.22)');
        core.addColorStop(1, 'rgba(255,143,27,0.04)');
        context.fillStyle = core;
        context.fill();
      }
      context.restore();

      context.save();
      context.globalCompositeOperation = 'lighter';
      for (const ember of embers) {
        const life = (elapsed * ember.speed + ember.phase) % 1;
        const x = ember.x + ember.drift * life + Math.sin(elapsed * 2.8 + ember.phase * 9) * 3;
        const y = ember.y - ember.lift * life;
        const alpha = Math.sin(Math.PI * life) * 0.62;
        context.globalAlpha = alpha;
        context.fillStyle = life > 0.45 ? 'rgba(255,217,123,0.9)' : 'rgba(255,113,30,0.9)';
        context.shadowColor = 'rgba(255,130,32,0.8)';
        context.shadowBlur = 8;
        context.beginPath();
        context.arc(x, y, ember.size * (1 - life * 0.25), 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    };

    const drawRouteFlow = () => {
      context.save();
      context.globalCompositeOperation = 'screen';
      HERO_ROUTES.forEach((route, routeIndex) => {
        const count = routeIndex < 2 ? 3 : 1;
        for (let index = 0; index < count; index += 1) {
          const progress = (elapsed * 0.075 + index / count + routeIndex * 0.09) % 1;
          const point = sampleHeroRoute(route, progress * route.length);
          const radius = routeIndex < 2 ? 5.2 : 4.3;
          const pulse = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
          pulse.addColorStop(0, 'rgba(228,255,241,0.72)');
          pulse.addColorStop(0.35, 'rgba(68,255,166,0.42)');
          pulse.addColorStop(1, 'rgba(51,255,141,0)');
          context.fillStyle = pulse;
          context.beginPath();
          context.arc(point.x, point.y, radius, 0, Math.PI * 2);
          context.fill();
        }
      });
      context.restore();
    };

    const drawWalkers = () => {
      HERO_WALKERS.forEach((walker) => {
        const route = HERO_ROUTES[walker.route];
        const cycle = walker.start + elapsed * walker.speed / route.length;
        const progress = walker.stairs
          ? ((cycle * 2) % 2 <= 1 ? (cycle * 2) % 2 : 2 - (cycle * 2) % 2)
          : cycle % 1;
        const point = sampleHeroRoute(route, progress * route.length);
        const edgeFade = walker.stairs ? 1 : Math.min(
          Math.min(1, progress / 0.055),
          Math.min(1, (1 - progress) / 0.075),
        );
        const gait = Math.sin(elapsed * 8.4 + walker.start * 12);
        context.save();
        context.globalAlpha = 0.78 + Math.sin(elapsed * 1.5 + walker.start * 8) * 0.1;

        const footGlow = context.createRadialGradient(point.x, point.y - 8, 0, point.x, point.y - 8, 17);
        footGlow.addColorStop(0, 'rgba(73,255,167,0.26)');
        footGlow.addColorStop(1, 'rgba(73,255,167,0)');
        context.fillStyle = footGlow;
        context.beginPath();
        context.arc(point.x, point.y - 8, 17, 0, Math.PI * 2);
        context.fill();

        context.translate(point.x, point.y);
        context.globalAlpha *= Math.max(0, edgeFade);
        context.shadowColor = 'rgba(83,255,179,0.9)';
        context.shadowBlur = 11;
        context.fillStyle = 'rgba(235,255,246,0.96)';
        context.beginPath();
        context.arc(0, -19, 3.4, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = 'rgba(226,255,241,0.95)';
        context.lineWidth = 2.8;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(0, -15);
        context.lineTo(0, -7);
        context.moveTo(0, -13);
        context.lineTo(-4.7 + gait * 1.8, -9);
        context.moveTo(0, -13);
        context.lineTo(4.7 - gait * 1.8, -9);
        context.moveTo(0, -7);
        context.lineTo(-3.8 + gait * 3.1, 0);
        context.moveTo(0, -7);
        context.lineTo(3.8 - gait * 3.1, 0);
        context.stroke();
        context.restore();
      });
    };

    const drawFrame = (now: number) => {
      frameId = 0;
      if (reducedMotion) return;
      if (lastFrame && now - lastFrame < 1000 / 30) {
        frameId = window.requestAnimationFrame(drawFrame);
        return;
      }
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
      elapsed += delta;
      lastFrame = now;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
      context.translate(layout.offsetX, layout.offsetY);
      context.scale(layout.scale, layout.scale);

      context.save();
      context.globalCompositeOperation = 'screen';
      drawExitGlow(472, 663, 46, '73,255,158', 0.2);
      drawExitGlow(1355, 254, 42, '73,255,158', 1.3);
      drawExitGlow(1341, 602, 39, '73,255,158', 2.4);
      drawExitGlow(1133, 773, 78, '255,45,44', 0.7);
      context.restore();

      drawFlames();
      drawRouteFlow();
      drawWalkers();
      frameId = window.requestAnimationFrame(drawFrame);
    };

    const startAnimation = () => {
      if (!reducedMotion && !frameId) {
        lastFrame = 0;
        frameId = window.requestAnimationFrame(drawFrame);
      }
    };

    const onImageLoad = () => {
      resizeCanvas();
      startAnimation();
    };

    const stopAnimation = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };

    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (reducedMotion) stopAnimation();
      else {
        resizeCanvas();
        startAnimation();
      }
    };

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resizeCanvas);
    resizeObserver?.observe(scene);
    window.addEventListener('resize', resizeCanvas);
    image.addEventListener('load', onImageLoad);
    motionPreference.addEventListener('change', onMotionPreferenceChange);
    resizeCanvas();
    if (image.complete && image.naturalWidth) startAnimation();

    return () => {
      stopAnimation();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      image.removeEventListener('load', onImageLoad);
      motionPreference.removeEventListener('change', onMotionPreferenceChange);
    };
  }, []);

  return (
    <div className="home">
      <nav className="home-nav">
        <button className="brand" onClick={() => onNavigate('home')}>
          <span className="brand-mark" />
          <span className="brand-name">WAYOUT</span>
        </button>
        <div className="home-nav-links" aria-label="Main navigation">
          <a href="#product">Product</a>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#platform">Platform</a>
        </div>
        <button className="btn primary home-nav-cta" onClick={() => onNavigate('simulator')}>Launch Simulator</button>
      </nav>

      <section className="hero">
        <div className="hero-scene" ref={heroSceneRef}>
          <img
            className="hero-image"
            src="/images/wayout-evacuation-hero.png"
            alt="Three-floor office cutaway showing a fire, evacuation routes, occupants, exits, and a blocked exit."
            ref={heroImageRef}
          />
          <canvas className="hero-overlay" ref={heroCanvasRef} aria-hidden="true" />
        </div>
        <div className="hero-scrim" />
        <div className="hero-inner">
          <div className="hero-eyebrow"><span className="dot good-text" />AI-powered evacuation intelligence</div>
          <h1 className="hero-title">
            <span className="stack">WAYOUT</span>
            <span className="stack hero-tagline">Simulate. Predict. Evacuate.</span>
          </h1>
          <p className="hero-sub">
            Leverage advanced AI and precise simulations to optimize building evacuations and save lives. Create,
            analyze, and deploy data-driven emergency plans instantly.
          </p>
          <div className="hero-actions">
            <button className="btn primary" onClick={() => onNavigate('simulator')}>Launch Simulator</button>
            <button className="btn outline" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>
              Explore
            </button>
          </div>
        </div>
      </section>

      <HomeExperience config={config} onLaunch={() => onNavigate('simulator')} />

      <div className="legacy-home-content" aria-hidden="true">
      <section className="section problem-solution" id="product">
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

      <section className="section" id="features">
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

      <section className="section arch-section" id="platform">
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
    </div>
  );
}
