@echo off
REM Wayout - one-command launcher for Windows. Everything runs locally (no GPU / cloud / API keys).
setlocal
cd /d "%~dp0"

where python >nul 2>nul || (echo Python 3.10+ is required. & exit /b 1)
where npm >nul 2>nul || (echo Node.js 18+ with npm is required. & exit /b 1)

echo == Wayout: local evacuation intelligence prototype ==

if not exist backend\.venv (
  echo -^> creating Python virtual environment
  python -m venv backend\.venv
)
call backend\.venv\Scripts\activate.bat
echo -^> installing backend dependencies
pip install -q --disable-pip-version-check -r backend\requirements.txt

echo -^> checking the ML surrogate model
pushd backend
python -c "from ml.predict import LocalMLPredictionModel as M; M().ensure_model()"
popd

if not exist frontend\node_modules (
  echo -^> installing frontend dependencies (first run only)
  pushd frontend
  call npm install --no-audit --no-fund
  popd
)

echo -^> starting backend on http://127.0.0.1:8000
start "Wayout backend" cmd /k "cd /d %~dp0backend && call ..\backend\.venv\Scripts\activate.bat && python main.py"
timeout /t 5 >nul

echo -^> starting frontend on http://localhost:5173
cd frontend
call npm run dev -- --open
