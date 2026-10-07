# `data/`: what is in here

This folder mixes three kinds of content. Know which is which before touching anything.

| Content | Where | Owner | Notes |
|---|---|---|---|
| **Project inputs** | `real/`, `tariffs/` | this project | Weather, meter and load CSVs; one tariff JSON per site. Read by `src/avishkar_ems`. Changing any of these changes the results and makes the dashboard cache stale (see `src/avishkar_ems/cache.py`). |
| **Upstream EMHASS test fixtures** | `data_*.csv`, `heating_prediction.csv`, `opt_res_*.csv`, `*.pkl`, `*.pbz2`, `test_response_*` | vendored EMHASS | Used only by the upstream test suite and the upstream Docker image. Do not edit. |
| **Runtime output** (git-ignored) | `cache/`, `last_run.json`, `adjust_pv_regressor.pkl`, `debug-*.csv`, `real/uploaded_*.csv`, `real/pvgis_my-site_*.csv` | generated | Safe to delete; rebuilt on demand. `cache/` is rebuilt with `python scripts/precompute_cache.py --rebuild`. |

Why they share a folder: the vendored EMHASS code resolves its `data_path` to the repository's `data/`, and the upstream
tests and Docker image expect the fixtures there. Moving the project inputs would touch `realdata.py`, `ceew.py`,
`planner.py`, the packaging and the cache fingerprint, for no functional gain, so the layout is documented rather than
changed (see `docs/KNOWN_ISSUES.md` #13).

## Weather files

`real/pvgis_<site>_<lat>_<lon>_<tilt>_<azimuth>_<first>_<last>.csv`: hourly plane-of-array irradiance and air temperature
from PVGIS (ERA5) for exactly that place and panel angles. The location is part of the name on purpose: two sites that
only share a name must never share weather. A file covering a requested year range is reused without a download.
Weather for a new place is downloaded once from PVGIS (needs internet; PVGIS may be unreachable on some networks).

## Tariffs

`tariffs/<site>.json`: see `tariffs/README.md`. Optional `p2p_share` (default 0.55) sets where the assumed P2P clearing
price sits between the export rate and the retail rate. It is an assumption, not market data.
