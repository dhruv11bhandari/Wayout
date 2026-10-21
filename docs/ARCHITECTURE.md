# Wayout - architecture

```
 Browser (React + TypeScript + Vite)                              Python backend (FastAPI)
 ┌────────────────────────────────────────────┐    /api/*    ┌──────────────────────────────────────────┐
 │ App.tsx  (hash router: Home <-> Simulator)  │ ───────────> │ api/routes.py   (pydantic validation)     │
 │                                              │ <─────────── │   ├─ building/      parametric floor plan │
 │ pages/Home.tsx                               │    JSON      │   ├─ simulation/    LocalSimulationEngine │
 │   HeroScene (ambient, decorative 3D)         │              │   │    multi_floor.py  (chains N floors)  │
 │                                              │              │   ├─ ml/            surrogate model       │
 │ pages/Simulator.tsx                          │              │   ├─ ai/            recommend.py,         │
 │   ParameterPanel  ·  3D viewport:            │              │   │                 copilot_provider.py   │
 │     three/Building3D · Agents3D · Heatmap3D  │              │   ├─ scenarios/     in-memory store       │
 │     CameraRig · SceneLighting                │              │   └─ copilot.py     rule-based interpreter│
 │   2D Analysis: FloorPlan (canvas, unchanged) │              └──────────────────────────────────────────┘
 │   BottleneckPanel · RecommendationList ·     │
 │   scenario compare · Copilot                 │
 └────────────────────────────────────────────┘
   animates frames / paints textures from data the backend already computed - never simulates client-side
```

The browser never simulates anything, in 2D or 3D. `/api/simulate` and `/api/simulate/multi` compute the
whole evacuation (every floor, every recorded frame) and return it; the canvas / R3F scene only interpolate
between frames or paint a texture from a returned grid.

## Swappable components (`backend/interfaces.py`)

| Interface | Local implementation (this repo) | Where a future one plugs in |
|---|---|---|
| `SimulationEngine` | `simulation/simulator.py::LocalSimulationEngine` (CPU, NumPy) | `simulation/cuda_engine.py::CudaSimulationEngine` (stub, raises `NotImplementedError`), gated by `CUDA_ENABLED` |
| `PredictionModel` | `ml/predict.py::LocalMLPredictionModel` (scikit-learn) | any class returning the same dict |
| `ScenarioInterpreter` / `CopilotProvider` | `ai/copilot_provider.py::FallbackCopilotProvider` (wraps the real `copilot.py::RuleBasedScenarioInterpreter`, **not** an LLM) | `ai/copilot_provider.py::NemotronCopilotProvider` (stub), gated by `NEMOTRON_ENABLED` + a real endpoint/key |

Selection happens in `backend/services.py` (`select_simulation_engine()`, `ai.copilot_provider.select_copilot_provider()`)
- both gates only ever pick a stub if it is actually usable, so flipping an env var on in a half-configured
environment can never break a running server; today neither stub is implemented, so both always resolve to
the real local implementations. The API and frontend never change based on which implementation is active;
`GET /api/config` reports the live selection.

## Building model (`backend/building/`)

`BuildingParams` -> `build_geometry(params, label_prefix)` produces walls, rooms, corridors, doors, exits,
obstacles and named zones for **one floor**. `label_prefix` ("Exit" or "Stair") only changes how the two
egress points are *labelled* - the geometry, navigation and simulation are identical either way; this is
how a floor above the ground gets "Stair A"/"Stair B" instead of "Exit A"/"Exit B" everywhere the label
surfaces (bottleneck text, exit-utilization rows, the 3D scene's `<Html>` labels), using the exact same
generator and simulator code path as the ground floor.

The default footprint is a 64 x 40 m wing: 4 rooms on each side of a main corridor that funnels into a
lobby with exits A (north), B (east) and optionally C (west end of corridor) / D (south).

## Multi-floor orchestration (`backend/simulation/multi_floor.py`)

`MultiFloorParams` holds one footprint plus per-floor occupancy, shared corridor/exit/stair widths, a
floor height, and hazard lists (`blocked_exits` for the ground floor, `blocked_stairs` as
`(floor_index, stair_id)` pairs for floors above it). `simulate_building()`:

1. Builds each floor's own `BuildingParams` via `MultiFloorParams.floor_params(i)` (ground floor: real
   exits per `num_exits`/`blocked_exits`; floors above: always exactly 2 stairs, individually blockable).
2. Runs floors **top to bottom**. For floor *i > 0*, first runs it alone (`extra_agents=[]`), reads every
   agent's real `evac_time` / `exit` id from the result, and converts each stair departure into a
   `simulation.simulator.ScheduledAgent(x, y, t)` arriving on floor *i-1* at `stair_landing_points()` (a
   fixed, obstacle-clear interior lobby point - independent of the floor's own exit count, since a real
   stairwell discharges into the building regardless of how many exterior doors that floor happens to have)
   at `t = evac_time + floor_height / STAIR_DESCENT_SPEED`.
3. Runs floor *i-1* with its own occupants **plus** those scheduled arrivals - see "Scheduled mid-run
   arrivals" below for how the simulator itself handles a population that grows during the run.
4. Aggregates: whole-building `clearance_time` / `evacuated` / `exit_utilization` /
   `timeline` are the **ground floor's** (real exits, real final egress); `bottleneck` is the
   highest-`score` bottleneck across all floors, tagged with `floor`; `total_agents` sums each floor's own
   original occupants (arrivals from above are the same people, not counted twice - `total_agents -
   extra_agents_injected` per floor recovers that floor's own count).

`docs/../README.md#how-multi-floor-works` has the shorter version and the stated simplification (no
stair-to-stair merge queuing between floors).

### Scheduled mid-run arrivals (`simulation/simulator.py::ScheduledAgent` / `SimConfig.extra_agents`)

The single-floor simulator's population used to be fixed at t=0. `SimConfig.extra_agents: List[ScheduledAgent]`
(default empty - the single-floor `/api/simulate` path never sets it, so its behaviour is provably
unchanged) lets a caller inject additional agents mid-run:

* Total array sizes (`pos_full`, `evac_time`, `exit_of`, `spawn_time`) are pre-allocated to
  `N_initial + N_extra` up front; only the `N_initial` present-at-t=0 agents start "active".
* Each step, any scheduled agents whose arrival time has passed are appended (batched per step) into the
  active `pos`/`vel`/`v0`/`rad`/`target` arrays via `np.concatenate`/`np.vstack`, with a target exit computed
  from their landing position at that moment - after that they are physically indistinguishable from any
  other agent (same social-force dynamics, same exit-choice logic).
* The loop's stopping condition (`while (len(ids) or next_extra < N_extra) and step < max_steps`) accounts
  for agents that haven't arrived yet, so a floor whose own occupants finish early doesn't cut off arrivals
  still en route from upstairs.
* `agents.spawn_time` (0 for original occupants, arrival time for scheduled ones) is always returned
  alongside `agents.evac_time`, so a renderer can hide an agent both before it spawns and after it evacuates
  (`Trajectory.sample()` on the frontend does exactly this).

**Regression caught while building this:** `agents.{v0,radius,delay,spawn_time,evac_time,exit}` used to be
computed only `if cfg.record:` (alongside the heavy frame-by-frame trajectories). Multi-floor chaining and
`/api/recommend/multi` both call the simulator with `record=False` for speed, which meant chaining silently
saw no `agents` data and dropped every floor above the one being scored. Fixed by making the (O(N), cheap)
`agents` block unconditional and gating only the (O(N x frames), heavy) `trajectories` block behind
`cfg.record` - pinned by `test_record_flag_does_not_change_agent_outcomes` and
`test_multi_floor_record_flag_does_not_change_clearance` in `tests/test_multi_floor.py`.

## Simulation core (unchanged from the single-floor prototype)

1. **Rasterise** walls and obstacles onto a 0.10 m grid; Euclidean distance transform gives the
   distance-to-wall field and its gradient.
2. **Navigation**: on a 0.20 m grid, Dijkstra (SciPy sparse graph) from each open exit gives a
   distance-to-exit potential. Agents sample its steepest-descent direction bilinearly.
3. **Dynamics** (dt = 0.1 s, social-force-inspired): driving force toward desired velocity, exponential
   agent-agent repulsion (KD-tree neighbours), exponential wall repulsion, a small random fluctuation term,
   speed cap, wall sliding (no tunnelling), light position-based overlap projection.
4. **Exit choice**: nearest exit initially; every 2 s agents may switch if a queue-aware time estimate is
   better by a margin (hysteresis).
5. **Measurement**: density (agents/m², Gaussian-smoothed 0.5 m grid) and mean speed sampled every 0.5 s.
   Congestion score per cell = 0.6 x normalised density + 0.4 x normalised low speed, integrated over time;
   the highest-scoring connected region is the bottleneck, labelled from the zone (or "Stair"/"Exit" +
   letter) it falls in.

## ML surrogate (`backend/ml/`) and recommendations (`backend/ai/recommend.py`)

The deployed surrogate is a standardized two-hidden-layer `MLPRegressor` trained with Adam. On the
current simulator-generated dataset, it scores 5.938 s five-fold CV MAE and 6.730 s hold-out MAE.
These figures measure agreement with WayOut's simulator, not accuracy validated against real
evacuations. It is used for:

* the "Fast AI prediction" button (single floor only, `/api/predict`);
* single-floor recommendations (`recommend_single_floor()`): each candidate design change (widen exits,
  widen corridor, add an exit) is scored with `services.predictor.predict()` - the same model, the same
  code path.

It is **not** used for multi-floor recommendations, because it was never trained on stacked floors and
using it there would be exactly the kind of out-of-domain, invented number this project avoids elsewhere.
`recommend_multi_floor()` instead re-runs `simulate_building()` on each candidate (widen the bottleneck
floor's stairs, widen the ground exits, widen every corridor - whichever apply to where the real bottleneck
was found) and reports the real resulting `clearance_time`. Both paths return the same shape
(`{id, title, current, suggested, predicted_clearance_time, predicted_improvement_pct, basis, reason}`);
`basis` tells the frontend which kind of number it is.

## 3D rendering (`frontend/src/three/`)

* **Coordinate convention**: a floor's plan `(x, y)` (meters, from the backend) maps to world
  `(x - width/2, y - height/2)` on the X/Z plane; floor index maps to world Y via `floor_height`. Every
  component (`Building3D`, `Agents3D`, `Heatmap3D`) is given the same `ox`/`oz`/`floorY` so a wall, an
  agent and a heatmap cell agree on where "here" is.
* **`Building3D`** extrudes the real per-floor JSON: wall segments become rotated boxes (`wallGeom()`
  computes length/angle/midpoint from each segment's endpoints), exits/stairs become clickable colored
  strips plus an `<Html>` label, obstacles become boxes. No Blender/GLB assets (see README) - procedural
  geometry only, kept cheap (a few dozen boxes per floor).
* **`Agents3D`** is one `InstancedMesh` (capsule geometry) per floor, driven every frame by that floor's own
  `utils/playback.ts::Trajectory` - the *same* class the 2D canvas view uses, extended with a `spawn`
  array so an agent is invisible both before its `spawn_time` and after its `evac_time`. Matrices/colors are
  written imperatively in `useFrame` (`setMatrixAt`/`setColorAt`), not through React state, so hundreds of
  agents animate at 60fps without per-agent re-renders.
* **`Heatmap3D`** paints a `CanvasTexture` from the same `density_grid.peak` (peak mode) or the same
  `computeLiveDensity()` function (live mode) the 2D `Heatmap.tsx` already used, using the identical color
  ramp (`densityColor()` in `scene-utils.ts` mirrors `styles/app.css`'s `--sem-*` tokens and `render.ts`'s
  2D ramp) - the 2D and 3D views can never disagree about what a color means.
* **`CameraRig`** wraps Drei's `OrbitControls` (free rotate/zoom/pan) and lerps toward a preset's
  position/target for ~0.9 s on a preset or floor change, then gets out of the way entirely so it never
  fights the user's manual camera work.
* Because floors chain through real absolute simulation time (see multi-floor orchestration above), a
  single shared `timeRef` (from `utils/playback.ts::usePlayback`) drives every floor's `Trajectory` in
  sync - no per-floor time offset bookkeeping needed on the frontend.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | status, engine / model / copilot readiness, which NVIDIA components are active (both false unless really wired up) |
| GET | `/api/config` | the same active-component info, for the frontend's NVIDIA-architecture section |
| GET | `/api/building` | single-floor plan JSON + initial agents + evacuation paths |
| GET | `/api/building/multi` | per-floor plan JSON for every floor + stair landing points + floor height |
| POST | `/api/predict` | fast single-floor surrogate prediction (ms) |
| POST | `/api/simulate` | full single-floor simulation |
| POST | `/api/simulate/multi` | full multi-floor simulation: per-floor results + whole-building aggregate |
| POST | `/api/recommend` | single-floor recommendations (ML surrogate) |
| POST | `/api/recommend/multi` | multi-floor recommendations (real re-simulation per candidate) |
| POST | `/api/scenario` | save a single-floor scenario (values are computed / cached simulator + model outputs) |
| GET | `/api/scenarios` | list saved scenarios |
| DELETE | `/api/scenarios/{id}` | delete one scenario |
| GET | `/api/metrics` | last single-floor and multi-floor summaries + real model training metrics + counters |
| POST | `/api/reset` | clear scenarios and cached results |
| POST | `/api/copilot` | rule-based interpretation of a request into UI actions (single-floor `BuildingParams`) |

Interactive docs: `http://127.0.0.1:8000/docs` while the backend runs.
