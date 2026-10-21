#!/usr/bin/env bash
# Wayout - one-command launcher for macOS / Linux.
# Everything runs locally: no GPU, no CUDA, no API keys, no cloud services.

set -e
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"


#Check requirements
command -v "$PY" >/dev/null 2>&1 || {
  echo "Python 3.10+ is required."
  echo "Install Python with: brew install python"
  exit 1
}

command -v npm >/dev/null 2>&1 || {
  echo "Node.js 18+ (with npm) is required."
  echo "Install Node.js from https://nodejs.org/"
  exit 1
}

echo "== Wayout: local evacuation intelligence prototype =="

# 1. Python environment
if [ ! -d backend/.venv ]; then
  echo "-> creating Python virtual environment"
  "$PY" -m venv backend/.venv
fi

# Activate virtual environment
# shellcheck disable=SC1091
source backend/.venv/bin/activate

# Make sure the virtual environment's Python is used
PY="$PWD/backend/.venv/bin/python"

echo "-> using Python: $PY"
echo "-> Python version:"
"$PY" --version

echo "-> installing backend dependencies"
"$PY" -m pip install -q --disable-pip-version-check -r backend/requirements.txt

# 2. ML surrogate
echo "-> checking the ML surrogate model"
(
  cd backend
  "$PY" -c "from ml.predict import LocalMLPredictionModel as M; M().ensure_model()"
)

# 3. Frontend dependencies
if [ ! -d frontend/node_modules ]; then
  echo "-> installing frontend dependencies (first run only)"
  (
    cd frontend
    npm install --no-audit --no-fund
  )
fi

# 4. Launch backend
echo "-> starting backend on http://127.0.0.1:8000"

(
  cd backend
  "$PY" main.py
) &

BACK=$!

trap 'kill $BACK 2>/dev/null || true' EXIT INT TERM

# Wait for backend to become available
"$PY" - <<'PYEOF'
import time
import urllib.request

for _ in range(90):
    try:
        urllib.request.urlopen(
            "http://127.0.0.1:8000/api/health",
            timeout=1
        )
        break
    except Exception:
        time.sleep(1)
else:
    print("Backend failed to start.")
    raise SystemExit(1)
PYEOF

# 5. Launch frontend
echo "-> starting frontend on http://localhost:5173"
echo "-> Ctrl+C stops everything"

cd frontend
npm run dev -- --open
