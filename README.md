# WayOut

**AI-powered evacuation intelligence for building design.**

WayOut models a multi-floor building, simulates an evacuation, highlights where congestion forms, and helps you compare design changes such as wider corridors, additional exits, or blocked routes. It is a local research prototype for exploring relative what-if scenarios, not a life-safety or code-compliance tool.



hidehikejnkie
## Product videos

The videos below show WayOut in action:

https://github.com/user-attachments/assets/a219efed-9947-49f4-8e53-36768bd04875

https://github.com/user-attachments/assets/8ff9c2d4-713a-40da-8bd4-db191f280c46

## Highlights

- Interactive 3D building view with live agents and crowd-density heatmaps, plus a 2D floor-plan view.
- Multi-floor evacuation simulation linked through stairwells.
- Bottleneck analysis, clearance-time metrics, and baseline comparisons.
- AI-assisted recommendations and a layout optimizer that validates proposed changes with a simulation.
- Floor-plan image and PDF import to create a geometry draft for review.
- Rule-based copilot for questions about simulation results.

## Requirements

- Python 3.10 or newer
- Node.js 18 or newer (includes npm)

The simulator and demo run locally on the CPU. No GPU, cloud service, or API key is needed for normal use. Floor-plan extraction can optionally use NVIDIA Nemotron; see [Optional floor-plan extraction](#optional-floor-plan-extraction).

## Run WayOut

From the repository root, run the launcher for your platform:

```bash
# macOS / Linux
./start.sh

# Windows
start.bat
```

The launcher prepares the Python environment, installs backend dependencies, starts the local API and frontend, and opens the app. The backend normally runs at `http://127.0.0.1:8000` (API documentation at `http://127.0.0.1:8000/docs`); Vite prints the frontend address, usually `http://localhost:5173`.

### Manual setup

Use two terminals from the repository root.

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

If Node.js is unavailable, you can run the backend alone and open `http://127.0.0.1:8000`; a pre-built interface is included.

## Optional floor-plan extraction

Uploaded floor plans can use NVIDIA Nemotron to produce an initial geometry draft. This integration is optional and off by default. Copy `.env.example` to `.env` in the repository root and configure the `NEMOTRON_*` settings with credentials and values from your NVIDIA account. Keep your key private. Always review imported geometry before running a simulation.

CUDA acceleration and a language-model copilot are not implemented; simulations use the local CPU engine and the copilot is rule-based.

## How it works

- **Pedestrian simulation:** agents move on a navigation grid using a social-force model and a Dijkstra potential field to reach exits while respecting walls.
- **Multi-floor runs:** floors are simulated from top to bottom. Stair arrivals feed into the floor below, and the ground-floor clearance time is reported for the building.
- **Prediction model:** a two-layer `MLPRegressor` (128 and 64 units, Adam) provides fast single-floor estimates and guides the optimizer. Its accuracy measures agreement with the simulator, not real-world outcomes.
- **Layout optimizer:** projected gradient descent proposes corridor, exit, and stair-width changes within a widening budget; a full simulation checks the resulting layout.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation details.

To regenerate training data and train the prediction model:

```bash
cd backend
python -m ml.generate_dataset --samples 800
python -m ml.train
```

## Tests

Install development dependencies and run the test suite from the repository root:

```bash
pip install -r backend/requirements-dev.txt
pytest tests -q
```

The tests cover the simulator, multi-floor orchestration, design optimization, and API behavior.

## Limitations

- Smoke, fire, heat, and visibility are not modelled. Hazards can block an exit or stairwell.
- Parameters are not calibrated against real evacuation data. Use results for relative comparisons, not safety certification or regulatory compliance.
- A fixed random seed (42) supports like-for-like comparisons.
- Floors share one footprint, and stair-to-stair merge queuing is not modelled.
- The prediction model is single-floor only and is evaluated against the simulator rather than real-world data.

## Troubleshooting

- **Backend unavailable:** check that the backend started successfully and open `http://127.0.0.1:8000/docs`.
- **Port already in use:** set `WAYOUT_PORT` to a free port, for example `WAYOUT_PORT=8001 ./start.sh` on macOS/Linux. Update the frontend proxy in `frontend/vite.config.ts` if you start the services manually.
- **3D view or fonts missing:** the first run may need internet access to load 3D assets and Google Fonts.
- **2D plan is out of view:** double-click the canvas to fit the plan.
