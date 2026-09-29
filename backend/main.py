"""Wayout backend entry point.   python main.py   ->  http://127.0.0.1:8000  (docs at /docs)"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import services
from api.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Wayout backend starting (local CPU mode - no GPU / cloud services used)", flush=True)
    services.predictor.ensure_model()  # trains automatically if model.joblib is missing
    print("Surrogate model ready.", flush=True)
    yield


app = FastAPI(title="Wayout API", version="0.1.0", lifespan=lifespan,
              description="AI-assisted evacuation analysis. Local prototype: NumPy simulation + scikit-learn surrogate.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router, prefix="/api")

_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
if os.path.isdir(_dist):  # optional: serve the built frontend from the same port
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=os.environ.get("WAYOUT_HOST", "127.0.0.1"),
                port=int(os.environ.get("WAYOUT_PORT", "8000")), log_level="info")
