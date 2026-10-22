#!/usr/bin/env bash
# Wayout - one-command launcher for macOS / Linux (also works in Git Bash on Windows).
# The demo and every simulation run locally. Only uploaded floor plans call NVIDIA
# Nemotron, which needs NEMOTRON_API_KEY in the project-root .env file.

set -e
cd "$(dirname "$0")"

WAYOUT_HOST="${WAYOUT_HOST:-127.0.0.1}"
# Keep the shell and Python configuration aligned. If the default port is busy,
# try the next few local ports so an unrelated service (for example another
# development server) does not make WayOut wait on the wrong health endpoint.
WAYOUT_PORT_EXPLICIT=0
if [ -n "${WAYOUT_PORT:-}" ]; then
  WAYOUT_PORT_EXPLICIT=1
else
  # Tolerate spaces, quotes and Windows line endings in .env (WAYOUT_PORT="8000"\r).
  WAYOUT_PORT="$(sed -n 's/^[[:space:]]*WAYOUT_PORT[[:space:]]*=//p' .env 2>/dev/null | tail -n 1 | tr -d "\r\"' ")"
fi
case "$WAYOUT_PORT" in
  ''|*[!0-9]*) WAYOUT_PORT=8000 ;;
esac


# Check requirements
# On macOS `python3` is often Apple's Python 3.9, which is too old; look for a newer one.
if [ -n "${PYTHON:-}" ]; then
  PY="$PYTHON"
else
  PY=""
  for candidate in python3 python3.13 python3.12 python3.11 python3.10 python; do
    if command -v "$candidate" >/dev/null 2>&1 &&
       "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
      PY="$candidate"
      break
    fi
  done
fi
if [ -z "$PY" ] || ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
  echo "Python 3.10+ is required (found: $(${PY:-python3} --version 2>&1 || echo none))."
  echo "Install it with: brew install python   (or from https://www.python.org/downloads/)"
  exit 1
fi

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

# Activate virtual environment (bin/ on macOS / Linux, Scripts/ for a venv made on Windows)
if [ -f backend/.venv/bin/activate ]; then
  VENV_BIN="backend/.venv/bin"
else
  VENV_BIN="backend/.venv/Scripts"
fi
# shellcheck disable=SC1091
source "$VENV_BIN/activate"

# Make sure the virtual environment's Python is used
PY="$PWD/$VENV_BIN/python"

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

# Wait (up to 60 s) for a successful WayOut health response, and stop early if the
# backend process exits. The liveness check uses the shell's own `kill -0`, which
# understands $BACK on every platform (Python's os.kill does not under Git Bash).
health_ok() {
  "$PY" - "http://${WAYOUT_HOST}:${WAYOUT_PORT}/api/health" <<'PYEOF'
import json
import sys
import urllib.request

try:
    with urllib.request.urlopen(sys.argv[1], timeout=1) as response:
        health = json.load(response)
    ok = health.get("status") == "ok" and health.get("service") == "wayout"
except Exception:
    ok = False
sys.exit(0 if ok else 1)
PYEOF
}

ready=0
for _ in $(seq 1 60); do
  if health_ok; then
    ready=1
    break
  fi
  if ! kill -0 "$BACK" 2>/dev/null; then
    echo "Backend stopped before becoming ready on ${WAYOUT_HOST}:${WAYOUT_PORT}." >&2
    echo "Check the messages above, or set WAYOUT_PORT to another free port." >&2
    exit 1
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "WayOut backend did not become healthy at http://${WAYOUT_HOST}:${WAYOUT_PORT}/api/health." >&2
  exit 1
fi

# 5. Launch frontend
echo "-> starting frontend (API port ${WAYOUT_PORT}); open the Local address Vite prints below"
echo "   (normally http://localhost:5173 - Vite picks the next free port if that one is busy)"
echo "-> Ctrl+C stops everything"

cd frontend
npm run dev -- --open
