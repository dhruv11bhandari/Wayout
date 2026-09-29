"""Train the surrogate on dataset.csv and save model.joblib + model_metrics.json.

Deployed model: HistGradientBoostingRegressor with monotonic constraints (more exit width
never predicts a longer evacuation, more occupants never a shorter one, ...). A
RandomForest is trained on the same split purely as a reported benchmark.
All metrics are computed on real held-out simulator runs - nothing is hard-coded.

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
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold, cross_val_predict, train_test_split

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ml.features import FEATURE_NAMES, MONOTONIC  # noqa: E402
from ml.generate_dataset import DATASET_PATH  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "model.joblib")
METRICS_PATH = os.path.join(HERE, "model_metrics.json")


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


def _make_hgb():
    return HistGradientBoostingRegressor(
        monotonic_cst=[MONOTONIC.get(k, 0) for k in FEATURE_NAMES],
        max_iter=400, learning_rate=0.06, max_leaf_nodes=15, min_samples_leaf=8,
        l2_regularization=1.0, early_stopping=False, random_state=0)


def train(dataset_path: str = DATASET_PATH, model_path: str = MODEL_PATH, verbose: bool = True) -> Dict:
    X, y = load_dataset(dataset_path)
    if len(y) < 40:
        raise RuntimeError(f"dataset too small to train ({len(y)} rows)")
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=0)

    hgb = _make_hgb().fit(Xtr, ytr)
    rf = RandomForestRegressor(n_estimators=300, min_samples_leaf=2, random_state=0, n_jobs=-1).fit(Xtr, ytr)
    m_hgb, m_rf = _metrics(yte, hgb.predict(Xte)), _metrics(yte, rf.predict(Xte))

    cv_pred = cross_val_predict(_make_hgb(), X, y, cv=KFold(5, shuffle=True, random_state=0))
    m_cv = _metrics(y, cv_pred)

    final = _make_hgb().fit(X, y)  # refit on all data for deployment
    metrics = {
        "model_name": "HistGradientBoostingRegressor (monotonic constraints)",
        "n_samples": int(len(y)), "n_train": int(len(ytr)), "n_test": int(len(yte)),
        "target": "clearance_time (s)",
        "target_mean_s": round(float(y.mean()), 2), "target_std_s": round(float(y.std()), 2),
        "holdout": m_hgb,
        "cross_val_5fold": m_cv,
        "benchmark_random_forest_holdout": m_rf,
        "features": FEATURE_NAMES,
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "sklearn_version": sklearn.__version__,
        "python": platform.python_version(),
        "training_data": "Local simulator runs on procedurally varied building configurations",
    }
    joblib.dump({"model": final, "feature_names": FEATURE_NAMES, "metrics": metrics}, model_path)
    with open(METRICS_PATH, "w") as fh:
        json.dump(metrics, fh, indent=2)
    if verbose:
        print(f"  [train] n={len(y)}  holdout MAE={m_hgb['mae_s']}s  R2={m_hgb['r2']}  "
              f"(RF benchmark MAE={m_rf['mae_s']}s)  5-fold CV MAE={m_cv['mae_s']}s", flush=True)
    return metrics


if __name__ == "__main__":
    train()
