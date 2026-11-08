"""Read imported drill observations and third-party scenario exports.

These inputs are intentionally isolated from ml/dataset.csv: their designs, units,
and simulation engines are not interchangeable with WayOut training rows.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
SUMMARY_PATH = HERE / "summary.json"
SCENARIOS = {
    "scenario_1_reduced_occupancy": "Reduced occupancy",
    "scenario_2_full_occupancy_existing_stair": "Full occupancy, existing stair",
    "scenario_3a_one_added_stair_core": "Full occupancy, one added stair core",
    "scenario_3b_two_added_stair_cores": "Full occupancy, two added stair cores",
}


def _read_csv(path: Path) -> list[list[str]]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return list(csv.reader(fh))


def read_drill() -> dict[str, Any]:
    evac = _read_csv(RAW / "experimental_drill_evacuation.csv")
    if evac[0] != ["time_s", "exited_interval", "cumulative_exited"]:
        raise ValueError("Unexpected drill evacuation schema")
    timeline = [
        {"time_s": int(r[0]), "exited_interval": int(r[1]), "cumulative_exited": int(r[2])}
        for r in evac[1:] if r and any(v.strip() for v in r)
    ]
    floors = _read_csv(RAW / "experimental_drill_initial_occupants_by_floor.csv")
    expected = ["floor_elevation_m", "initial_occupants", "pathfinder_components_aggregated"]
    if floors[0] != expected:
        raise ValueError("Unexpected initial occupant schema")
    floor_rows = [
        {"floor_elevation_m": float(r[0]), "initial_occupants": int(r[1]),
         "pathfinder_components_aggregated": int(r[2])}
        for r in floors[1:] if r and any(v.strip() for v in r)
    ]
    if any(b["time_s"] <= a["time_s"] for a, b in zip(timeline, timeline[1:])):
        raise ValueError("Drill timestamps must increase")
    if any(b["cumulative_exited"] < a["cumulative_exited"] for a, b in zip(timeline, timeline[1:])):
        raise ValueError("Drill cumulative exits must not decrease")
    floor_total = sum(x["initial_occupants"] for x in floor_rows)
    if timeline and floor_total != timeline[-1]["cumulative_exited"]:
        raise ValueError(f"Drill floor count ({floor_total}) does not match final exits ({timeline[-1]['cumulative_exited']})")
    return {"kind": "observed_drill", "provenance": "field drill observations supplied by user",
            "timeline": timeline, "initial_occupants_by_floor": floor_rows,
            "initial_occupant_total": floor_total,
            "observed_duration_s": timeline[-1]["time_s"] if timeline else None,
            "final_cumulative_exited": timeline[-1]["cumulative_exited"] if timeline else None}


def _teci_series(path: Path) -> dict[str, Any]:
    rows = _read_csv(path)
    if len(rows) < 4 or len(rows[0]) < 4 or rows[0][0].strip('"') != "TeciVersion=1":
        raise ValueError(f"Unexpected TecI export structure: {path.name}")
    # TecI CSV has metric labels in row 1, entity names in row 2, ids in row 3,
    # followed by time-series observations. The first four columns are global totals.
    points = []
    for row in rows[5:]:
        if len(row) < 4 or not row[1].strip():
            continue
        points.append({"time_s": float(row[1]), "remaining": int(float(row[2] or 0)),
                       "exited": int(float(row[3] or 0))})
    if not points:
        raise ValueError(f"No time series found in {path.name}")
    if any(b["time_s"] <= a["time_s"] for a, b in zip(points, points[1:])):
        raise ValueError(f"Non-increasing time in {path.name}")
    return {"rows": len(points), "start": points[0], "end": points[-1],
            "entity_columns": max(0, len(rows[0]) - 4)}


def load_external_data() -> dict[str, Any]:
    drill = read_drill()
    scenarios = []
    for key, label in SCENARIOS.items():
        rooms = _teci_series(RAW / f"{key}_rooms.csv")
        doors = _teci_series(RAW / f"{key}_doors.csv")
        if (rooms["rows"] != doors["rows"]
                or rooms["end"]["remaining"] != doors["end"]["remaining"]
                or rooms["end"]["exited"] != doors["end"]["exited"]
                or abs(rooms["end"]["time_s"] - doors["end"]["time_s"]) > 0.01):
            raise ValueError(f"Room and door exports disagree for {key}")
        scenarios.append({"id": key, "label": label,
                          "kind": "third_party_simulation", "provenance": "TecI scenario export; simulated, not observed",
                          "room_series": rooms, "door_series": doors})
    return {"schema_version": 1, "drill": drill, "scenarios": scenarios,
            "usage_note": "Do not pool these data with WayOut simulator training data or treat simulated scenarios as field observations."}


def write_summary(path: Path = SUMMARY_PATH) -> dict[str, Any]:
    data = load_external_data()
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


if __name__ == "__main__":
    data = write_summary()
    print(f"Loaded 1 drill ({data['drill']['initial_occupant_total']} occupants) and "
          f"{len(data['scenarios'])} simulated scenarios -> {SUMMARY_PATH}")
