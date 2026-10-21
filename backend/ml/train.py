"""Train the gradient-based neural surrogate and save model + metrics.

The deployed MLP uses standardized features and target values and Adam optimization.
Metrics are evaluated on held-out simulator-generated examples; this is not validation
against real evacuation observations.

    python -m ml.train
"""
from __future__ import annotations

import csv
import json
import os
import platform
import sys
import time
from typing import Dict, Optional

import joblib
import numpy as np
import sklearn
from sklearn.compose import TransformedTargetRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold, cross_val_predict, train_test_split
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ml.features import FEATURE_NAMES  # noqa: E402
from ml.generate_dataset import DATASET_PATH  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "model.joblib")
METRICS_PATH = os.path.join(HERE, "model_metrics.json")
MODEL_VERSION = "wayout-mlp-adam-v2"


def load_dataset(path: str = DATASET_PATH):
    with open(path, newline="") as fh:
        rows = list(csv.DictReader(fh))
    X = np.array([[float(r[k]) for k in FEATURE_NAMES] for r in rows])
    y = np.array([float(r["clearance_time"]) for r in rows])
    return X, y


def _metrics(y, pred) -> Dict[str, float]:
    return {
        "mae_s": round(float(mean_absolute_error(y, pred)), 3),
        "rmse_s": round(float(np.sqrt(mean_squared_error(y, pred))), 3),
        "r2": round(float(r2_score(y, pred)), 4),
        "mape_pct": round(float(np.mean(np.abs(y - pred) / np.maximum(y, 1e-6)) * 100), 2),
    }


def _make_mlp():
    """Build the gradient-trained neural network used for clearance-time prediction.

    Scaling both the input features and target keeps Adam's updates well-conditioned
    despite features being measured in different units and clearance times spanning
    a wide range. The hidden layers are deliberately small for this tabular dataset.
    """
    network = make_pipeline(
        StandardScaler(),
        MLPRegressor(
            hidden_layer_sizes=(128, 64), activation="relu", solver="adam",
            alpha=1.0, learning_rate_init=0.003, max_iter=2000,
            early_stopping=True, validation_fraction=0.15,
            n_iter_no_change=50, random_state=0,
        ),
    )
    return TransformedTargetRegressor(regressor=network, transformer=StandardScaler())


def train(dataset_path: str = DATASET_PATH, model_path: str = MODEL_PATH, verbose: bool = True) -> Dict:
    X, y = load_dataset(dataset_path)
    if len(y) < 40:
        raise RuntimeError(f"dataset too small to train ({len(y)} rows)")
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=0)

    folds = KFold(5, shuffle=True, random_state=0)
    mlp = _make_mlp().fit(Xtr, ytr)
    m_mlp = _metrics(yte, mlp.predict(Xte))
    mlp_cv = _metrics(ytr, cross_val_predict(_make_mlp(), Xtr, ytr, cv=folds, n_jobs=1))
    # Keep the holdout separate from training and CV; use it only for final evaluation.
    final = _make_mlp().fit(X, y)
    metrics = {
        "model_name": "MLPRegressor (Adam gradient descent)",
        "model_version": MODEL_VERSION,
        "training_algorithm": "Two-hidden-layer MLP trained with Adam; standardized inputs and target",
        "n_samples": int(len(y)), "n_train": int(len(ytr)), "n_test": int(len(yte)),
        "target": "clearance_time (s)",
        "target_mean_s": round(float(y.mean()), 2), "target_std_s": round(float(y.std()), 2),
        "holdout": m_mlp,
        "cross_val_5fold": mlp_cv,
        "features": FEATURE_NAMES,
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "sklearn_version": sklearn.__version__,
        "python": platform.python_version(),
        "training_data": "Local simulator runs on procedurally varied building configurations; not real-world evacuation observations",
    }
    joblib.dump({"model": final, "model_version": MODEL_VERSION,
                 "feature_names": FEATURE_NAMES, "metrics": metrics}, model_path)
    with open(METRICS_PATH, "w") as fh:
        json.dump(metrics, fh, indent=2)
    if verbose:
        print(f"  [train] Adam-MLP n={len(y)}  holdout MAE={m_mlp['mae_s']}s "
              f"RMSE={m_mlp['rmse_s']}s; 5-fold CV MAE={mlp_cv['mae_s']}s", flush=True)
    return metrics


if __name__ == "__main__":
    train()
