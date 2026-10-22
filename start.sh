#!/usr/bin/env bash
# Wayout - one-command launcher for macOS / Linux.
# Everything runs locally: no GPU, no CUDA, no API keys, no cloud services.

set -e
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
WAYOUT_HOST="${WAYOUT_HOST:-127.0.0.1}"
# Keep the shell and Python configuration aligned. If the default port is busy,
# try the next few local ports so an unrelated service (for example another
# development server) does not make WayOut wait on the wrong health endpoint.
WAYOUT_PORT_EXPLICIT=0
if [ -n "${WAYOUT_PORT:-}" ]; then
  WAYOUT_PORT_EXPLICIT=1
else
  WAYOUT_PORT="$(sed -n 's/^WAYOUT_PORT=//p' .env 2>/dev/null | tail -n 1)"
fi
WAYOUT_PORT="${WAYOUT_PORT:-8000}"


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

if [ "$WAYOUT_PORT_EXPLICIT" = "0" ]; then
  WAYOUT_PORT="$("$PY" - "$WAYOUT_HOST" "$WAYOUT_PORT" <<'PYEOF'
import socket
import sys

host, start = sys.argv[1], int(sys.argv[2])
for port in range(start, min(start + 20, 65536)):
    with socket.socket() as sock:
        try:
            sock.bind((host, port))
        except OSError:
            continue
        print(port)
        break
else:
    raise SystemExit("No available local port found in the configured port range.")
PYEOF
)"
fi
export WAYOUT_HOST WAYOUT_PORT

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
echo "-> starting backend on http://${WAYOUT_HOST}:${WAYOUT_PORT}"

(
  cd backend
  exec "$PY" main.py
) &

BACK=$!

trap 'kill $BACK 2>/dev/null || true' EXIT INT TERM

# Wait for this backend process and a successful WayOut health response.
"$PY" - "$WAYOUT_HOST" "$WAYOUT_PORT" "$BACK" <<'PYEOF'
import json
import os
import sys
import time
import urllib.request

host, port, pid = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
url = f"http://{host}:{port}/api/health"
for _ in range(30):
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            health = json.load(response)
        if health.get("status") == "ok" and health.get("service") == "wayout":
            break
    except Exception:
        try:
            os.kill(int(pid), 0)
        except OSError:
            print(f"Backend stopped before becoming ready on {host}:{port}.", file=sys.stderr)
            print("Check that the configured port is free, or set WAYOUT_PORT to another port.", file=sys.stderr)
            raise SystemExit(1)
        time.sleep(1)
else:
    print(f"WayOut backend did not become healthy at {url}.", file=sys.stderr)
    raise SystemExit(1)
PYEOF

# 5. Launch frontend
echo "-> starting frontend on http://localhost:5173 (API port ${WAYOUT_PORT})"
echo "-> Ctrl+C stops everything"

cd frontend
npm run dev -- --open
