# External drill and scenario data

`raw/` contains the ten user-supplied source CSVs unchanged. `summary.json` is a
regenerable, compact index produced by `python -m data.external.loader` from the
`backend/` directory. The loader checks the drill schemas, monotonic times and
cumulative exits, reconciles the floor occupancy total with final drill exits,
and checks that paired room/door TecI exports have matching time series.

The drill timeline and floor counts are observed data. The four paired room/door
exports are third-party simulations: scenario 1 reduces occupancy, scenario 2
uses full occupancy and the existing stair, scenario 3a adds one stair core, and
scenario 3b adds two stair cores. They remain separate from WayOut's
`ml/dataset.csv`, which contains WayOut simulator-generated examples. No input
contains enough verified geometry, occupant routing, unit mapping, and matching
WayOut configuration to create equivalent ML training rows or calibrate the
WayOut simulator; therefore no model, metrics, or predictions were replaced.

TecI exports are very wide tables. Row 1 stores metric names, row 2 entity
labels, row 3 entity IDs, and following rows are samples. The summary uses only
their global time, remaining, and exited columns while preserving all original
columns in `raw/`.
