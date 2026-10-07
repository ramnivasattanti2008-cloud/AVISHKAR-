# AVISHKAR platform: status against the specification

The honest ledger. One row per requirement group in [SPEC.md](SPEC.md) (section numbers are IDs). Read with
[ARCHITECTURE.md](ARCHITECTURE.md) (decisions D1..D14) and [../docs/WORKLOG.md](../docs/WORKLOG.md) (chronological notes).

**How to use and update this file**

- Status words: `DONE` (built, tested, evidence given), `PARTIAL` (some of it works; the gap is stated),
  `REUSE` (exists in the Python EMS and is to be wrapped by the platform, not yet exposed), `NOT STARTED`,
  `BLOCKED` (cannot proceed; reason stated), `DEVIATION` (deliberately different from the spec; see decision id).
- A row may only say `DONE` with evidence: the command that proves it and its result. No evidence, no `DONE`.
- Update the row in the same commit that changes the code. Append what you did to the WORKLOG as well.
- "Python EMS" below means the pre-existing `src/avishkar_ems` package (see `CLAUDE.md`).

Last updated: 2026-10-07 (platform work not yet begun beyond the specification, architecture and this ledger).

## Summary

| Phase (SPEC §84) | State |
|---|---|
| 1 Foundation: architecture, database, auth, map, property selection, geocoding | NOT STARTED (architecture written) |
| 2 Real data: weather, solar resource, satellite metadata, Energy Twin | NOT STARTED |
| 3 Energy data, solar forecast, load forecast | NOT STARTED (REUSE: Python EMS quantile forecasts for 3 sites) |
| 4 Battery, EV, appliances, energy flow | NOT STARTED (REUSE: Python EMS battery model) |
| 5 Optimisation, opportunities, value | NOT STARTED (REUSE: EMHASS LP planner) |
| 6 What-if, counterfactual, economics, resilience | NOT STARTED (REUSE: payback, advisor, reserve) |
| 7 Copilot, explainability | NOT STARTED (REUSE: `explain.py`, `summary.py` text for the demo sites) |
| 8 Community, VPP | NOT STARTED (REUSE: `fleet.py` pooling maths) |
| 9 Testing, security, observability, deployment | NOT STARTED (CI exists for the Python EMS only) |

## Requirement groups

| § | Requirement | Status | Where / evidence | Gap or note |
|---|---|---|---|---|
| 0-3 | Real data only; provenance on every value | NOT STARTED | D6, D7 define the envelope | Python EMS labels assumptions in `README` / `KNOWN_ISSUES` but has no per-value provenance |
| 4 | `PositioningProvider`, no fake NavIC | NOT STARTED | D10 | |
| 5-7 | Map-first UX, geocoding, property selection (search, click, GPS, coordinates, polygon) | NOT STARTED | | |
| 6 | Provider abstractions (map, satellite, geocoding, footprint, weather, solar resource) | NOT STARTED | D8 | Nominatim, Open-Meteo, NASA POWER, Overpass, Earth Search probed reachable; PVGIS is not |
| 8-9 | Energy Twin (versioned) and Energy DNA | NOT STARTED | | |
| 10 | Weather ingestion and storage | NOT STARTED | | Python EMS reads bundled PVGIS CSVs only |
| 11-12 | Satellite metadata; cloud-movement nowcast | NOT STARTED | D9 | Nowcast will be `UNAVAILABLE` until a sub-hourly source exists |
| 13 | Solar forecast engine, all horizons, benchmarked | REUSE | `bands.py` (P10/50/90 day-ahead for 3 sites) | No weather-provider-driven forecast; no 5-min to 7-day ladder; no persistence/clear-sky benchmark table |
| 14 | Load forecast engine | REUSE | `bands.py` `load_features` | Needs user meter history; baseline "same hour average" not separately benchmarked |
| 15 | Probabilistic forecasts | REUSE | `bands.QuantileBands`, conformal calibration | 80% coverage measured per site in `results/forecast_quality.csv` |
| 16 | Energy futures (scenarios) | NOT STARTED | | |
| 17-18 | Risk-aware multi-objective optimiser, modes | PARTIAL (REUSE) | `planner.py`, `engine.py` (battery + PV + grid LP, reserve floor) | No EV, appliances, modes, risk objectives |
| 19 | Every-kWh allocation engine | NOT STARTED | | Plan steps exist; formal allocation with reasons does not |
| 20-21 | Opportunity and value engines | NOT STARTED | | |
| 22 | Tariff engine (state, DISCOM, category, slabs, ToD, metering) | PARTIAL | `tariffs.py`, 3 regulator-order JSONs in `data/tariffs/` | No catalogue, no slabs, no fixed charges, no net-metering modes |
| 23-24 | Eligibility engine; PM Surya Ghar, config-driven | PARTIAL | `subsidy.py` | Slabs hard-coded in code (violates §24); needs `policy_rules` table with sources |
| 25 | Battery model and modes | PARTIAL (REUSE) | `execute.py` battery physics, `advisor.py` | No degradation/cycle model, no modes |
| 26-27 | Resilience and critical-load engines | PARTIAL (REUSE) | `reserve.py` (reserve floor from critical load, outage risk heuristic) | No four-class appliance priority; outage data unavailable except Mathura meter |
| 28-30 | Appliances, NILM, flexibility | PARTIAL | `loads.py` (cheapest start), `flex.py` (burst mining) | No appliance model, no NILM |
| 31 | EV engine | NOT STARTED | | |
| 32 | What-if simulator, 24 h to 1 year | PARTIAL | `payback.py`, `examples/run_sensitivity.py` | Not a general engine; no solar-size/EV/tariff/weather scenarios |
| 33 | Investment advisor (incl. "no investment") | PARTIAL | `advisor.py` battery sizing says plainly when a battery will not repay | Solar sizing and EV not covered |
| 34-36 | Autonomy, health, waste | NOT STARTED | | |
| 37 | Counterfactual engine | PARTIAL (REUSE) | `payback.evaluate` replays EMS vs idle vs fixed-rule baselines | Not per-decision; not stored |
| 38-39 | Model performance and learning | PARTIAL | `forecast_quality` coverage/MAE (static, held-out) | No prediction store, no online evaluation or recalibration |
| 40-43 | Provenance, data quality, no-data and degraded modes | NOT STARTED | D6, D7 | |
| 44-45, 90-91 | Copilot, explanations, tool layer | NOT STARTED | D14 | `explain.py` gives text for the demo sites |
| 46 | Human control modes, audit, rollback | NOT STARTED | | |
| 47-49 | Community, VPP simulation, city map | PARTIAL (REUSE) | `fleet.py` | Two real sites in different cities; no 10 to 10,000 home simulator |
| 50-51 | Privacy and security | NOT STARTED | | |
| 52 | PostgreSQL + PostGIS schema and migrations | NOT STARTED | D4 | Needs Docker engine (see BLOCKERS) |
| 53-54, 56 | TypeScript backend, Next.js frontend, pages | DEVIATION / NOT STARTED | D1, D2 | Python engine service is a documented deviation |
| 55, 78 | UI design system, accessibility | NOT STARTED | | |
| 57-61 | Property dashboard, energy flow, map interaction, comparison, installation planner | NOT STARTED | | Streamlit dashboard covers 3 demo sites only |
| 62-63 | Economics (NPV, IRR) and carbon | PARTIAL | `lifetime.py` (discounted payback, NPV with assumptions) | No IRR, no carbon factor table |
| 64, 67 | Deterministic simulation; conservation check | PARTIAL | executor conserves energy per step (tested) | No stored simulation config; no `SIMULATION INVALID` gate |
| 65-66 | Testing; safety tests | PARTIAL | `tests/avishkar_ems` (Python EMS): SOC bounds, energy balance, critical-load, reserve floor | Nothing for the platform yet |
| 68 | OpenAPI contracts | NOT STARTED | | |
| 69-72 | Observability, caching, scheduling, provider failover | NOT STARTED | D5, D8 | |
| 73 | Configuration via environment | NOT STARTED | | Python EMS uses `AVISHKAR_CACHE_DIR` only |
| 74, 93 | Demo data and seed data, Bengaluru/Pune/Jaipur + one more | PARTIAL | Pune, Jaipur, Mathura sites with bundled real weather/tariffs; Bengaluru simulated site | Not in a database; not labelled `DEMO` in an API |
| 75 | Cloud-front demo scenario | NOT STARTED | | Needs the simulation engine |
| 76 | Honest LIVE/UPDATED/FORECAST/... labels | NOT STARTED | D7 | |
| 77 | Performance targets | NOT STARTED | | Python EMS day plan ~0.5 s warm (measured) |
| 79-81 | Documentation set, model cards, patent-discovery | NOT STARTED | | |
| 92 | Admin panel | NOT STARTED | | |
| 94 | Deployment | NOT STARTED | | Existing `Dockerfile` is the upstream EMHASS image |
| 95-96 | Final quality bar and acceptance test | NOT STARTED | | |

## BLOCKERS and open questions (keep current)

- **Docker engine** was not running at the start of platform work; Docker Desktop was launched on 2026-10-07. Until
  `docker info` reports a server, PostGIS migrations and database integration tests are unverified.
- **No LLM credentials** are present in the repository. The Copilot tool layer will be built and tested without an LLM;
  the LLM adapter needs `ANTHROPIC_API_KEY` (never committed).
- **Satellite nowcast data source** (D9) and **grid outage data** are unavailable; both remain `UNAVAILABLE`.
- **Hosting** (Vercel, container registry, managed PostGIS) needs the owner's accounts; deployment is documented and
  scripted, not performed.
