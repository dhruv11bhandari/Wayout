# WAYOUT

**AI-powered evacuation intelligence for building design.**

Wayout builds a digital model of a multi-floor building, simulates a crowd evacuating it, shows *where* and *why* people get stuck, and lets you change the design (corridor width, exits, stairs, occupancy, hazards) to see the effect. Every answer is backed by a real pedestrian simulation, either through a fast AI prediction (single floor) or a full re-simulation (multi-floor).

> **Prototype status.** Runs fully locally on the CPU. No GPU, cloud service or API key needed. CUDA and NVIDIA Nemotron are optional integration points that are off by default (see [`.env.example`](.env.example)).



## How it looks 

https://github.com/user-attachments/assets/a219efed-9947-49f4-8e53-36768bd04875



## Quick start

Requirements: **Python 3.10+** and **Node.js 18+**.

```bash
./start.sh      # macOS / Linux
start.bat       # Windows
```

This sets up everything, starts the backend (`http://127.0.0.1:8000`, API docs at `/docs`) and the frontend (`http://localhost:5173`), and opens your browser.

<details>
<summary>Manual start (two terminals)</summary>

```bash
# Terminal 1: backend
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py

# Terminal 2: frontend
cd frontend
npm install
npm run dev
```

No Node? Start only the backend and open `http://127.0.0.1:8000` (a pre-built UI is included).

</details>

---

## Features

- **3D building view** with real walls, doors, exits and stairs, plus live agents and a density heatmap
- **Multi-floor evacuation**, with floors chained through the stairwells
- **Bottleneck detection**, global and per floor
- **AI recommendations**, each applied as a real re-simulation
- **Smart Layout Optimizer**: given a widening budget, finds where to add width, then validates with a real simulation
- **Baseline vs. current** comparison
- **Rule-based copilot** (not a language model)

---

## How it works

- **Simulation:** 2D social-force pedestrians on a navigation grid. Agents follow a Dijkstra potential field toward exits and never cross walls.
- **Multi-floor:** the top floor is simulated first. Its stair arrivals become scheduled arrivals on the floor below, repeating down to the ground floor. Building clearance time is the ground floor's clearance time.
- **ML surrogate:** a two-layer `MLPRegressor` (128 and 64 units, Adam) trained on simulator-generated buildings. It gives fast single-floor predictions and guides the optimizer.
- **Optimizer:** projected gradient descent on corridor, exit and stair widths within a budget, with the final layout checked by the real simulator.

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Retrain the surrogate:

```bash
cd backend
python -m ml.generate_dataset --samples 800
python -m ml.train
```

---

## Tests

```bash
cd backend && pip install -r requirements-dev.txt && cd ..
pytest tests -q
```

Tests run the real simulator, multi-floor orchestrator and API, with nothing mocked.

---

## Limitations

- No smoke, fire, heat or visibility modelling. Hazards block a real exit or stairwell.
- Hand-chosen parameters, **not calibrated against real evacuation data**. Use for relative what-if comparison, not compliance or safety certification.
- Fixed random seed (42) for like-for-like comparisons.
- All floors share one footprint. Stair-to-stair merge queuing is not modelled.
- The ML surrogate is single-floor only, and its scores measure agreement with the simulator, not real-world accuracy.

## Roadmap

- GPU solver (`CudaSimulationEngine`)
- LLM copilot (`NemotronCopilotProvider`)
- Per-floor layouts, room-level fire modelling, real floor-plan import

---

## Troubleshooting

- **Backend not reachable:** run `python main.py` in `backend/`.
- **Port in use:** `WAYOUT_PORT=8001 python main.py` (update the proxy in `frontend/vite.config.ts`).
- **3D view empty or fonts off:** the first run needs internet for 3D assets and Google Fonts.
- **2D plan out of view:** double-click the canvas to re-fit.
---------
git add . "file name"                                                          
git commit -m "update"
git push               

----

