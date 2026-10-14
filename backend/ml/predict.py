"""Fast surrogate prediction (implements PredictionModel).

`ensure_model()` is called on server start:
  1. load model.joblib if present and compatible with the installed scikit-learn;
  2. otherwise re-train from dataset.csv (seconds);
  3. otherwise generate a fresh dataset with the real simulator, then train.
"""
from __future__ import annotations

import os
import sys
import threading
import time
from typing import Any, Dict, Optional

import joblib
import numpy as np
import sklearn

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from building import BuildingParams  # noqa: E402
from interfaces import PredictionModel  # noqa: E402
from ml.features import FEATURE_NAMES, extract_features  # noqa: E402
from ml.generate_dataset import DATASET_PATH, generate  # noqa: E402
from ml.train import MODEL_PATH, train  # noqa: E402
from simulation.multi_floor import MultiFloorParams  # noqa: E402

FALLBACK_SAMPLES = 240


class LocalMLPredictionModel(PredictionModel):
    name = "LocalMLPredictionModel"

    def __init__(self) -> None:
        self._bundle: Optional[Dict[str, Any]] = None
        self._lock = threading.Lock()

    # ---------------------------------------------------------------- lifecycle
    def _load(self) -> bool:
        if not os.path.exists(MODEL_PATH):
            return False
        try:
            bundle = joblib.load(MODEL_PATH)
            if bundle["metrics"].get("sklearn_version") != sklearn.__version__:
                print("  [ml] scikit-learn version changed since the model was saved -> re-training", flush=True)
                return False
            if bundle["feature_names"] != FEATURE_NAMES:
                return False
            self._bundle = bundle
            return True
        except Exception as exc:  # corrupt / incompatible pickle
            print(f"  [ml] could not load model.joblib ({exc}) -> re-training", flush=True)
            return False

    def ensure_model(self, samples: int = FALLBACK_SAMPLES) -> None:
        with self._lock:
            if self._bundle is not None or self._load():
                return
            if not os.path.exists(DATASET_PATH):
                print(f"  [ml] no model and no dataset: running {samples} real simulations to build one "
                      "(one-off, a few minutes)...", flush=True)
                generate(samples)
            else:
                print("  [ml] training surrogate from dataset.csv ...", flush=True)
            train()
            self._load()

    def ready(self) -> bool:
        return self._bundle is not None

    # ---------------------------------------------------------------- interface
    def predict(self, params: BuildingParams) -> Dict[str, Any]:
        self.ensure_model()
        t0 = time.perf_counter()
        x, feats = extract_features(params)
        y = float(self._bundle["model"].predict(x.reshape(1, -1))[0])
        m = self._bundle["metrics"]
        return {
            "predicted_clearance_time": round(max(y, 1.0), 2),
            "expected_error_s": m["cross_val_5fold"]["mae_s"],
            "features": {k: round(v, 3) for k, v in feats.items()},
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "model": m["model_name"],
        }

    def predict_multi(self, mfp: MultiFloorParams) -> Dict[str, Any]:
        """Predict WHOLE-BUILDING clearance time for a multi-floor design, in milliseconds -
        the multi-floor counterpart of `predict()`. The feature vector is built from the
        ground floor's own geometry (its real exits are where the building actually
        empties out) plus `n_floors` / `floor_height`, with the building-wide occupant
        total standing in for `occupancy` - see `ml.features.extract_features`. The model
        was trained on real `simulate_building()` runs across 2-6 floor designs
        (`ml/generate_dataset.py::generate_multi`), not extrapolated from single-floor
        data, so this is in-domain the same way the single-floor prediction is.
        """
        self.ensure_model()
        t0 = time.perf_counter()
        ground = mfp.floor_params(0)
        total_occupancy = float(sum(mfp.occupancy))
        x, feats = extract_features(ground, n_floors=mfp.n_floors, floor_height=mfp.floor_height,
                                     occupancy_override=total_occupancy)
        y = float(self._bundle["model"].predict(x.reshape(1, -1))[0])
        m = self._bundle["metrics"]
        return {
            "predicted_clearance_time": round(max(y, 1.0), 2),
            "expected_error_s": m["cross_val_5fold"]["mae_s"],
            "features": {k: round(v, 3) for k, v in feats.items()},
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "model": m["model_name"],
        }

    def info(self) -> Dict[str, Any]:
        self.ensure_model()
        return dict(self._bundle["metrics"])


if __name__ == "__main__":
    LocalMLPredictionModel().ensure_model()
