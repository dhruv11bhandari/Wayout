"""In-memory scenario store (cleared by POST /api/reset)."""
from __future__ import annotations

import itertools
import threading
import time
from typing import Any, Dict, List, Optional


class ScenarioStore:
    def __init__(self) -> None:
        self._items: List[Dict[str, Any]] = []
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

    def add(self, name: str, params: Dict[str, Any], prediction: Optional[Dict[str, Any]],
            simulation: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            item = {
                "id": next(self._ids),
                "name": name.strip() or f"Scenario {len(self._items) + 1}",
                "created_at": time.strftime("%H:%M:%S"),
                "params": params,
                "prediction": prediction,
                "simulation": simulation,
            }
            self._items.append(item)
            return item

    def list(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._items)

    def delete(self, sid: int) -> bool:
        with self._lock:
            n = len(self._items)
            self._items = [s for s in self._items if s["id"] != sid]
            return len(self._items) != n

    def clear(self) -> None:
        with self._lock:
            self._items = []
            self._ids = itertools.count(1)
