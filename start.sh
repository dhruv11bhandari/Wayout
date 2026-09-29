#!/usr/bin/env bash
# Wayout - one-command launcher for macOS / Linux.
# Everything runs locally: no GPU, no CUDA, no API keys, no cloud services.
set -e
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || { echo "Python 3.10+ is required (set PYTHON=/path/to/python)."; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "Node.js 18+ (with npm) is required."; exit 1; }

echo "== Wayout: local evacuation intelligence prototype =="

# 1. Python environment
if [ ! -d backend/.venv ]; then
  echo "-> creating Python virtual environment"
  "$PY" -m venv backend/.venv
fi
# shellcheck disable=SC1091
source backend/.venv/bin/activate
echo "-> installing backend dependencies"
pip install -q --disable-pip-version-check -r backend/requirements.txt

# 2. ML surrogate: uses the shipped model.joblib; re-trains itself if it is missing or incompatible
echo "-> checking the ML surrogate model"
(cd backend && python -c "from ml.predict import LocalMLPredictionModel as M; M().ensure_model()")

# 3. Frontend dependencies
if [ ! -d frontend/node_modules ]; then
  echo "-> installing frontend dependencies (first run only)"
  (cd frontend && npm install --no-audit --no-fund)
fi

# 4. Launch backend (:8000) and frontend (:5173)
echo "-> starting backend on http://127.0.0.1:8000"
(cd backend && python main.py) &
BACK=$!
trap 'kill $BACK 2>/dev/null || true' EXIT INT TERM

python - <<'PYEOF'
import time, urllib.request
for _ in range(90):
    try:
        urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=1)
        break
    except Exception:
        time.sleep(1)
PYEOF

echo "-> starting frontend on http://localhost:5173  (Ctrl+C stops everything)"
cd frontend && npm run dev -- --open
