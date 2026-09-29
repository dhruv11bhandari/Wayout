# WAYOUT

**AI-powered evacuation intelligence for building design.**

Wayout builds a digital evacuation model of a building - now multi-floor, with a 3D architectural
visualization as the primary experience - watches a crowd evacuate it, shows *where* and *why* people
get stuck, and lets you change the design (corridor width, exits, stairs, occupancy, hazards) and get an
answer two ways: a **fast AI prediction** (single floor) or a **real re-simulation** (multi-floor), always
validated by the actual pedestrian simulation underneath.

> **Prototype status.** Everything in this repository runs **locally on the CPU**. There is no GPU, CUDA,
> NVIDIA Nemotron, Nebius or any cloud service and no API key. Both are real, clean integration points in
> the code (`CudaSimulationEngine`, `NemotronCopilotProvider`) gated by environment variables that default
> to off - see [`.env.example`](.env.example) and [Roadmap](#roadmap-not-implemented-yet).

---

## Quick start

Requirements: **Python 3.10+** and **Node.js 18+** (with npm). Internet is only needed the first time to
install packages (and for the two Google Fonts the UI loads).

```bash
./start.sh          # macOS / Linux
start.bat           # Windows
```

The script creates a Python virtual environment, installs the dependencies, checks the ML model, installs
the frontend's dependencies (now including `three`, `@react-three/fiber`, `@react-three/drei`,
`@react-three/postprocessing`), starts the backend (`http://127.0.0.1:8000`, API docs at `/docs`) and the
frontend (`http://localhost:5173`) and opens the browser.

Manual start (two terminals):

```bash
# terminal 1 - backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py

# terminal 2 - frontend
cd frontend
npm install
npm run dev
```

No Node? A pre-built UI is included: start only the backend and open `http://127.0.0.1:8000`.
(Rebuild it after editing the frontend with `cd frontend && npm run build`.)

---

## The experience

**`/` - Home.** A landing page: hero with an ambient (decorative, non-simulated) 3D building, the
problem/solution, how it works, the eight core capabilities, and the two NVIDIA integration points -
their status badges are read live from `/api/config`, never hardcoded.

**`/simulator` - the product.** Opens on a ready 3-floor, 500-occupant demo building. Adjust parameters
in the left panel (floors, occupants, corridor/exit/stair width, walking speed, a hazard that blocks a
real exit or stairwell) and press **Run Simulation**:

1. The backend runs a real evacuation on every floor, chained through the stairwells (see
   [How multi-floor works](#how-multi-floor-works)), and returns full per-floor trajectories.
2. The 3D viewport shows the actual building - real walls, doors, exits and stairs extruded from the same
   geometry the simulator used - with real agents (colour = their actual state: waiting / free / slow /
   stalled) walking their real recorded paths, and a real density heatmap. Camera presets (ORBIT / TOP /
   ISO / FLOOR), a floor switcher with isolate/fade, and a heatmap mode switch (off / peak / live) are all
   live controls, not decoration.
3. **2D Analysis** toggles to the original single-floor canvas renderer (kept exactly as it was - see
   [Nothing is faked](#nothing-is-faked)) showing whichever floor is selected, with the automatically
   detected bottleneck boxed on the plan.
4. Scrolling down: whole-building **metrics**, **bottlenecks** (global and per floor), **AI
   recommendations** (each with a real predicted-or-simulated improvement and an **Apply scenario** button
   that re-simulates for real), a **baseline vs. current** comparison, and the **copilot**.

---

## How multi-floor works

The core simulator (`LocalSimulationEngine`) still models one connected floor plate - that has not
changed. A multi-floor building is that *same* simulator, run once per floor and chained through the
stairwells:

1. Every floor shares one footprint. The ground floor keeps its real building exits; every floor above it
   swaps those for two stair portals ("Stair A" / "Stair B") - mechanically identical `ExitDef` gaps, so
   all the existing navigation, queuing and social-force code applies unchanged.
2. The **top floor is simulated first, alone.** Every agent's arrival time at a stair portal is a real,
   measured output of that run (the same flow-capacity-aware queuing that governs a building exit).
3. That arrival becomes a **scheduled mid-run arrival** on the floor below (`ScheduledAgent` in
   `simulation/simulator.py`), landing at a fixed point in that floor's lobby, delayed by
   `floor_height / STAIR_DESCENT_SPEED` (0.6 m/s - an approximate literature value for downward stair
   movement, labelled as such everywhere it appears, not a fitted or measured constant).
4. The floor below is simulated with its own occupants **plus** the arrivals from above, under the
   identical social-force engine. Repeat down to the ground floor, whose real exits are where people
   actually leave.

Whole-building clearance time is the ground floor's clearance time - the moment the last person, wherever
they started, is actually outside. **Stated simplification:** queuing *between* two floors sharing one
stairwell (e.g. floor 3 merging into floor 2's own flow on the same flight) is not modelled; each flight is
unconstrained once an agent is on it. Queuing *at* a stair entrance (on the floor being left) is real.

---

## Nothing is faked

| What the UI shows | Where it comes from |
|---|---|
| Agent positions, clearance / average / median time, max density, exit & stair utilisation | measured from a real `LocalSimulationEngine.simulate()` call, once per floor |
| Multi-floor chaining (who arrives on which floor, and when) | `simulation/multi_floor.py`, composing real per-floor runs - see above |
| Bottleneck (global and per floor) | detected from each floor's density + speed fields; the global one is the highest-scoring across all floors |
| 3D geometry (walls, doors, exits, stairs) | extruded directly from the same JSON `/api/building` and `/api/building/multi` return - no separate "presentation" model |
| 3D heatmap | a canvas texture painted from the same `density_grid` (peak) or the same `computeLiveDensity` function (live) the 2D view uses |
| Recommendations (single floor) | the trained ML surrogate, evaluated on the candidate design - the same model and code path as "Fast AI prediction" |
| Recommendations (multi-floor) | a **real re-simulation** of the candidate design, because the surrogate was never trained on stacked floors - see `ai/recommend.py` |
| "Apply scenario" result | always a fresh real simulation, never the recommendation's preview number |
| `/api/config` status badges (CUDA / Nemotron) | read live from the running server; both are `false` unless a real engine/endpoint is wired in and working |
| Scenario / baseline comparison | values captured from real runs, never recomputed client-side from a formula |

Packaged build, default single-floor building (seed 42): baseline clearance **85 s**; corridor 3.0 m:
**79 s** simulated. Default 3-floor, 500-occupant multi-floor demo (seed 42): **~127 s**, with the
ground-floor exit correctly identified as the binding constraint (it carries the cascade from both floors
above it) - widening it is consistently the top-ranked recommendation.

---

## What's simplified, and why

* **No Blender / GLB assets.** Section 13 of the original brief asks for a Blender-authored asset
  pipeline; this sandbox has no Blender and no GPU to author or export from. Geometry is procedural
  (extruded boxes/planes from the real floor-plan JSON), which is a legitimate, common technique for
  AEC-style web visualization and keeps everything driven by real data rather than a static import.
* **CUDA and Nemotron are stubs**, exactly like the original single-floor prototype - `CUDA_ENABLED` and
  `NEMOTRON_ENABLED` default to `false`, and even set to `true` without a real endpoint/key, the app safely
  falls back to the local engine and the rule-based copilot (see `services.py`).
* **Hazards block a real exit or stairwell**, not a specific room. Modelling a fire's effect on a named
  room (heat, smoke, visibility, spreading over time) is a materially larger simulation problem; blocking
  an egress route is the mechanism this model can back with a real, re-routed simulation rather than a
  cosmetic label.
* **The copilot reasons about the ground floor** - its rule-based interpreter (unchanged from the
  single-floor prototype) understands one `BuildingParams` at a time, and the ground floor is where the
  building's real exits are.
* **Stair-to-stair queuing across floors is not modelled** - see [How multi-floor works](#how-multi-floor-works).
* **Visual references, not copied code.** The 3D layer's interaction/visual language was informed by public
  AEC-visualization projects (an AEC scene editor, an architectural walkthrough, and a city-visualization
  project) named in the original brief, purely as inspiration for things like camera presets and
  floor-plan-to-3D presentation. No code was copied from them; `frontend/src/three/` is an original
  implementation against this project's own data shapes.

## How it works (single-floor core, unchanged)

* **Building model** - structured JSON (walls, rooms, corridors, doors, exits, obstacles, zones) generated
  from parameters; wall thickness and door / exit widths are exact.
* **Simulation** - 2D pedestrians on a 0.1 m wall-distance grid and a 0.2 m navigation grid. Dijkstra from
  every open exit gives a potential field; agents follow its gradient with social-force-inspired dynamics.
  They never teleport and cannot cross walls. Exit choice is nearest-first with queue-aware re-evaluation.
* **Bottleneck detection** - per grid cell, congestion = 0.6 x density + 0.4 x low-speed, integrated over
  time; the strongest connected region is reported and named from the floor-plan zone it falls in.
* **ML surrogate** - `HistGradientBoostingRegressor` with monotonic constraints, trained on 798 procedurally
  varied single-floor buildings. Hold-out MAE 4.7 s, R^2 0.93. Used for single-floor recommendations and
  the "Fast AI prediction" button; multi-floor recommendations use real re-simulation instead (see above).
* **Copilot** - a deterministic keyword / regex interpreter (`backend/copilot.py`, wrapped as
  `FallbackCopilotProvider` in `ai/copilot_provider.py`). It is **not a language model** and is labelled as
  such in the UI.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Regenerate / retrain the surrogate:

```bash
cd backend
python -m ml.generate_dataset --samples 800     # runs the real simulator ~0.5 s per building
python -m ml.train                              # writes ml/model.joblib + ml/model_metrics.json
```

## Tests

```bash
cd backend && pip install -r requirements-dev.txt && cd ..
pytest tests -q
```

27 tests run the real simulator, the real multi-floor orchestrator, and the real API (nothing mocked):
the original 16 (health, geometry, prediction, simulation invariants, scenarios, copilot) plus 11 new ones
covering scheduled mid-run arrivals, that the `record` flag never changes physics (a real regression test
for a bug caught during this build - see below), occupant conservation across floors, that clearance grows
toward the ground floor, Stair / Exit labelling, hazard scoping, and the new `/api/building/multi`,
`/api/simulate/multi`, `/api/recommend/multi` and `/api/config` endpoints.

**Bug found and fixed while building this:** the fast (`record: false`) simulate path - used by multi-floor
recommendations for speed - was silently omitting the per-agent `evac_time`/`exit` data multi-floor
chaining depends on, which meant every floor above the one being scored was invisibly dropped. Fixed by
making that data always computed (it's O(N), not O(N x frames) like the full trajectory), and pinned with
`test_record_flag_does_not_change_agent_outcomes` / `test_multi_floor_record_flag_does_not_change_clearance`.

## Limitations (please read before presenting)

* No smoke, fire, heat, or visibility modelling; all agents know where the open exits/stairs are; blocked
  exits and stairs are known in advance. See [What's simplified, and why](#whats-simplified-and-why).
* Simplified pedestrian model with hand-chosen parameters. **It has not been calibrated or validated
  against real evacuation data or building-code egress calculations.** Use it for relative what-if
  comparison of designs, not as a compliance or safety certification tool.
* Results depend on the random seed (initial positions, speeds, reaction delays). Wayout fixes the seed
  (42) so comparisons are like-for-like.
* Every floor shares one footprint (room count, room size, lobby size, overall dimensions). Real buildings
  usually do stack floors this way, but Wayout cannot yet give two floors different layouts.
* The ML surrogate is single-floor only; multi-floor recommendations cost a real re-simulation per
  candidate (still sub-5-second for the default building).
* Scenarios and the multi-floor cache are stored in memory and are cleared by Reset or a backend restart.

## Roadmap (not implemented yet)

* `CudaSimulationEngine` - GPU implementation of the pedestrian solver behind the existing
  `SimulationEngine` interface (`backend/simulation/cuda_engine.py` is a stub gated by `CUDA_ENABLED`).
* `NemotronCopilotProvider` - replace the rule-based copilot with an LLM that returns the same structured
  `{reply, actions[]}` and narrates real simulator output without inventing numbers (`backend/ai/copilot_provider.py`
  is a stub gated by `NEMOTRON_ENABLED`; see `.env.example`).
* Blender-authored GLB assets for furniture/signage/human figures, once a GPU-equipped environment is
  available to author and export them.
* Per-floor layouts, stair-to-stair merge queuing, room-level hazard/fire modelling, importing real floor
  plans.

## Project structure

```
wayout/
├── .env.example                  CUDA_ENABLED / NEMOTRON_* - both default off, safely
├── start.sh / start.bat          one-command launchers
├── backend/
│   ├── main.py                   FastAPI app (also serves frontend/dist if built)
│   ├── interfaces.py             SimulationEngine / PredictionModel / ScenarioInterpreter
│   ├── services.py               where implementations are wired together (env-gated selection)
│   ├── copilot.py                rule-based interpreter
│   ├── ai/                       recommend.py (ML- or simulation-based design recommendations),
│   │                             copilot_provider.py (CopilotProvider / Fallback / Nemotron naming)
│   ├── api/routes.py             REST endpoints (single-floor + multi-floor)
│   ├── building/                 schema.py, default_building.py (parametric generator, Exit/Stair labelling)
│   ├── simulation/                navigation, agents, social_force, density, bottleneck,
│   │                             simulator.py (+ScheduledAgent for mid-run arrivals), multi_floor.py, cuda_engine (stub)
│   ├── ml/                       features, generate_dataset, train, predict, dataset.csv, model.joblib
│   ├── scenarios/                in-memory scenario store
│   └── utils/debug_plot.py       matplotlib developer tool
├── frontend/src/
│   ├── App.tsx                   tiny hash router: Home <-> Simulator
│   ├── pages/                    Home.tsx (landing), Simulator.tsx (the product)
│   ├── three/                    Building3D, Agents3D, Heatmap3D, CameraRig, SceneLighting, HeroScene, scene-utils
│   ├── state/useMultiFloorSim.ts multi-floor data/hook layer
│   ├── components/               ParameterPanel, RecommendationList, BottleneckPanel (new);
│   │                             FloorPlan, AgentSimulation, Heatmap, Copilot, MetricsCard (reused, restyled);
│   │                             AnalysisPanel, ScenarioComparison, Sidebar, Header, DemoMode (kept, not
│   │                             currently wired into App.tsx - see note below)
│   ├── api/, types/, utils/, styles/app.css (black/white/gray design system)
├── tests/                        pytest suite (27 tests)
└── docs/ARCHITECTURE.md
```

**Note on the pre-existing single-floor components:** `AnalysisPanel`, `ScenarioComparison`, `Sidebar`,
`Header` and `DemoMode` are the original single-floor prototype's UI - fully working, untouched, just no
longer imported by the new multi-floor `App.tsx`/`Simulator.tsx` (which has its own parameter panel,
comparison view and header, built for the multi-floor data shape). They're left in place rather than
deleted, in case you want to reference or restore the original single-floor-only flow.

## Troubleshooting

* **"Backend not reachable"** - start it (`python main.py` in `backend/`); the UI retries automatically.
* **Port in use** - backend: `WAYOUT_PORT=8001 python main.py` (then set the proxy target in
  `frontend/vite.config.ts`); frontend: `npm run dev -- --port 5174`.
* **First start is slow** - only if the model has to be re-trained or regenerated.
* **3D view looks empty or fonts look off** - the 3D scene and the Space Grotesk/IBM Plex fonts load from
  the internet on first run (three.js/Drei examples and Google Fonts respectively); a fully offline
  environment will fall back to plain system fonts and the 3D view needs its one-time asset fetch.
* **Floor plan (2D) panned or zoomed out of view** - double-click the canvas (or the ⌂ button) to re-fit it.
---------

git add . "file name"                                                          
git commit -m "update"
git push               

----