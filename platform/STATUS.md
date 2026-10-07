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

Last updated: 2026-10-07, after the OpenAPI contract and the first web app (map, property, forecast, system pages). Evidence: `pnpm -C platform/api typecheck && lint && test && build` all clean, 179 tests (unit, and integration against real PostgreSQL 16 + PostGIS 3.4); `pnpm -C platform/web typecheck && lint && test && build` all clean, 57 tests; `pnpm -C platform/api test:live` runs 7 tests against the real Nominatim, Open-Meteo, NASA POWER, Overpass and Earth Search services (on demand, not CI). The web app was also driven in a real browser against the running API (search, click, register, analyze, forecast, system, theme, phone width): see WORKLOG entry 7.

## Summary

| Phase (SPEC §84) | State |
|---|---|
| 1 Foundation: architecture, database, auth, map, property selection, geocoding | **DONE for the pieces that exist** (database, migrations, auth, properties, geocoding, provenance, providers, health, OpenAPI contract, map-first web app with search / click / coordinates / location / roof drawing). Open: production map-tile provider, account pages beyond sign-in/up, no browser end-to-end suite. |
| 2 Real data: weather, solar resource, satellite metadata, Energy Twin | **Backend DONE** (live-verified end to end) and shown in the web app (property page, forecast charts). Climate zone and Energy DNA are not built. |
| 3 Energy data, solar forecast, load forecast | NOT STARTED (only the provider's 24 h irradiation forecast is used; REUSE: Python EMS quantile forecasts for 3 sites) |
| 4 Battery, EV, appliances, energy flow | NOT STARTED (REUSE: Python EMS battery model) |
| 5 Optimisation, opportunities, value | NOT STARTED (REUSE: EMHASS LP planner) |
| 6 What-if, counterfactual, economics, resilience | NOT STARTED (REUSE: payback, advisor, reserve) |
| 7 Copilot, explainability | NOT STARTED (REUSE: `explain.py`, `summary.py` text for the demo sites) |
| 8 Community, VPP | NOT STARTED (REUSE: `fleet.py` pooling maths) |
| 9 Testing, security, observability, deployment | PARTIAL (CI runs three jobs: Python EMS, platform API against real PostGIS, web; no deployment files, no security review, no browser end-to-end suite) |

## Requirement groups

| § | Requirement | Status | Where / evidence | Gap or note |
|---|---|---|---|---|
| 0-3 | Real data only; provenance on every value | PARTIAL | `api/src/provenance` (envelope, freshness rules, 8 statuses), table `data_provenance` with a CHECK that refuses LIVE without an observation time (`test/api.test.ts` constraints) | Envelope used by geocoding only; weather/forecast values come in Phase 2/3 |
| 4 | `PositioningProvider`, no fake NavIC | PARTIAL | `api/src/providers/positioning.ts`; API refuses `navic` unless `NAVIC_RECEIVER_ENABLED=true`; position source and accuracy stored and described (tests) | Browser geolocation client is built (`web/.../SearchBox.tsx`): it labels the result "Browser geolocation" with the accuracy the browser reports and never NavIC (unit-tested with a stubbed geolocation; not yet exercised against a real GPS fix). No NavIC hardware exists to test the enabled path against real data |
| 5-7 | Map-first UX, geocoding, property selection (search, click, GPS, coordinates, polygon) | PARTIAL | API: `GET /api/geocode/search`, `/reverse` (live Nominatim), `POST/GET/PATCH/DELETE /api/properties`, `POST /api/properties/:id/geometry` (PostGIS-validated polygon). Web `/map`: search with debounce and keyboard support, pasted coordinates (no geocoder call), click, "Locate me", live preview panel, save and analyze; real saved-property pins. Browser-verified against the live API: searching "Indiranagar Bengaluru" returns real places, a click or pasted point shows labelled real values, "Analyze this property" builds a twin in about 6 s with a real OSM roof outline (104 m²). `web/src/components/map/SearchBox.test.tsx` (9 tests) | Manual roof drawing (click vertices, double-click to finish) is implemented but has not been exercised in a browser and has no test; no multi-property comparison; the search results are Nominatim's only (one geocoder, no failover) |
| 6 | Provider abstractions (map, satellite, geocoding, footprint, weather, solar resource) | PARTIAL | Geocoding (Nominatim), weather (Open-Meteo), solar resource (NASA POWER), building footprint (Overpass with mirror failover), satellite metadata (Earth Search STAC): each with retries, rate spacing, schema validation, DB cache, stale-if-error and call telemetry (`api/src/providers`); live-verified | Map tiles: raster layers (OpenStreetMap, Esri World Imagery, OpenTopoMap) behind `web/src/lib/basemaps.ts`, attributed on the map. These public tile servers have usage policies that do not allow production traffic: **the owner must supply a tile provider and key before launch** (the abstraction is ready; not done). PVGIS is not reachable from the dev machine |
| 8-9 | Energy Twin (versioned) and Energy DNA | PARTIAL | Table `energy_twins` (versioned snapshots), `POST /api/properties/:id/analyze`, `GET .../twin`, `.../twin/versions`; every number is a labelled `Measured` value with sources, assumptions and gaps (`test/twin.test.ts`); live twin built for a real Bengaluru building | Energy DNA not built (needs load data); no climate zone (no source integrated); building metadata limited to OSM tags; household/appliance/battery/EV/tariff/resilience profiles come with their phases |
| 10 | Weather ingestion and storage | DONE | Open-Meteo forecast with quality checks, coarsened coordinates, DB cache, issued values stored in `weather_observations` for later evaluation (`test/weather.test.ts`, live test) | Historical observations (archive API) and weather alerts not ingested; hourly resolution only |
| 11-12 | Satellite metadata; cloud-movement nowcast | PARTIAL | Sentinel-2 scenes via STAC (satellite, sensor, acquisition and processing time, footprint, cloud %, status) stored in `satellite_observations`; `GET /api/cloud-nowcast` returns an explained UNAVAILABLE (a revisit of about 5 days cannot support a minutes-ahead nowcast) | No imagery, cloud masks, vegetation or flood layers; a real nowcast needs a sub-hourly geostationary source |
| 13 | Solar forecast engine, all horizons, benchmarked | PARTIAL (REUSE) | Provider 24 h irradiation forecast converted to kWh/kWp (`forecastNext24h*`, labelled FORECAST); Python EMS `bands.py` P10/50/90 day-ahead for 3 sites | No own model, no 5 min to 7 day ladder, no benchmark vs persistence/clear-sky, no stored actuals or MAE yet |
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
| 40-43 | Provenance, data quality, no-data and degraded modes | PARTIAL | `provenance/`, `quality.ts` (impossible values, spikes, duplicates, gaps, staleness, coordinates, 7 reality checks), stale cache served with a note, 503 `PROVIDER_UNAVAILABLE` with provider name (tests) | Quality engine is applied to weather (rejected points are listed on the forecast page); the UI shows plain-language alerts when the address service is down and explains every UNAVAILABLE value, but there is no global degraded-mode banner |
| 44-45, 90-91 | Copilot, explanations, tool layer | NOT STARTED | D14 | `explain.py` gives text for the demo sites |
| 46 | Human control modes, audit, rollback | NOT STARTED | | |
| 47-49 | Community, VPP simulation, city map | PARTIAL (REUSE) | `fleet.py` | Two real sites in different cities; no 10 to 10,000 home simulator |
| 50-51 | Privacy and security | PARTIAL | argon2id passwords, hashed opaque session tokens, HttpOnly SameSite cookies, CSRF header, rate limits, helmet, input validation (zod), ownership isolation, append-only audit log, account export and real deletion, no secrets in repo (`test/api.test.ts`) | No role-based admin routes yet; rate limiter is per instance (in memory); no encryption-at-rest configuration; no security review or dependency audit yet |
| 52 | PostgreSQL + PostGIS schema and migrations | PARTIAL | Migrations `foundation`, `reference_status`: users, sessions, properties (+ trigger-maintained PostGIS point), property_geometry, data_provenance, audit_logs, provider_calls, cache_entries; drift check empty; applied to PostGIS 3.4 | Remaining ~20 tables arrive with their phases (energy_twins, observations, forecasts, batteries, appliances, tariffs, policy_rules, ...) |
| 53-54, 56 | TypeScript backend, Next.js frontend, pages | PARTIAL | Fastify + Prisma 7 + zod API builds and runs. `platform/web`: Next 16 App Router, React 19, Tailwind 4, MapLibre, recharts, same-origin `/api` proxy, API types generated from the committed OpenAPI document. Pages: `/` landing, `/map`, `/login`, `/register`, `/properties`, `/property/[id]` (Energy Twin), `/property/[id]/forecast`, `/system` (real provider health). Web typecheck, lint, 57 tests and `next build` clean; CI job `web` | Other §56 pages (energy flow, solar, battery, EV, appliances, tariffs, savings, forecast accuracy, community, copilot, admin, settings) are not built because their backends are not; Python engine service (D1) not started |
| 55, 78 | UI design system, accessibility | PARTIAL | CSS tokens with light and dark themes (persisted, applied before paint), one status-badge component for the eight data labels, reduced-motion support, skip link, labelled landmarks, ARIA combobox for search, keyboard-operable search, phone layout (no horizontal overflow at 344 px, checked in a browser) | No automated accessibility audit (axe) and no screen-reader pass; colour contrast not measured |
| 57-61 | Property dashboard, energy flow, map interaction, comparison, installation planner | PARTIAL | `GET /api/preview` (public, nothing saved) feeds the map panel; the property page shows the twin: roof outline on imagery, solar potential with the working shown, next-24 h, what is not known and why, completeness by input with weights, the latest satellite scene, sources and assumptions; forecast page charts five real hourly series with provenance on hover and under each chart | No energy flow diagram, no comparison, no installation planner; risk, demand and energy score are not available yet; no analytic weather-grid map layers |
| 62-63 | Economics (NPV, IRR) and carbon | PARTIAL | `lifetime.py` (discounted payback, NPV with assumptions) | No IRR, no carbon factor table |
| 64, 67 | Deterministic simulation; conservation check | PARTIAL | executor conserves energy per step (tested) | No stored simulation config; no `SIMULATION INVALID` gate |
| 65-66 | Testing; safety tests | PARTIAL | Python EMS: 68 tests. Platform API: 106 tests incl. failure tests (provider down, invalid coordinates, bad input, duplicates, unauthenticated, cross-user access) | Platform API now 179 tests, web 57 (format, API client incl. CSRF and error mapping, provenance display rules, search box, chart axis). No automated end-to-end browser test (the browser run was manual, in the WORKLOG); no optimiser safety tests yet (no optimiser) |
| 68 | OpenAPI contracts | PARTIAL | `GET /api/openapi.json` generated from the zod route schemas (OpenAPI 3.1), stable error codes (`api/src/errors.ts`) | The document is committed as `api/openapi.json` (133 KB, shared schemas as components) with a drift test (`test/openapi.test.ts`: generated equals committed; every route has a summary, tags and an error response) and the web types are generated from it (`pnpm -C platform/web gen:api`, checked in CI). No rendered docs page; `platform/API.md` not written |
| 69-72 | Observability, caching, scheduling, provider failover | PARTIAL | Request ids, structured logs with cookie redaction, `provider_calls` telemetry, `GET /api/system/health` (database + PostGIS + per-provider state from real calls, `unknown` when no traffic), DB cache with TTL and stale-if-error, `withFailover` helper | No job queue or scheduler (pg-boss) yet; failover has only one geocoder; no metrics dashboard UI |
| 73 | Configuration via environment | DONE | `api/src/config.ts` (zod-validated, refuses weak secrets), `api/.env.example`, tests in `test/config.test.ts` | New providers add variables as they are built |
| 74, 93 | Demo data and seed data, Bengaluru/Pune/Jaipur + one more | PARTIAL | Pune, Jaipur, Mathura sites with bundled real weather/tariffs; Bengaluru simulated site | Not in a database; not labelled `DEMO` in an API |
| 75 | Cloud-front demo scenario | NOT STARTED | | Needs the simulation engine |
| 76 | Honest LIVE/UPDATED/FORECAST/... labels | PARTIAL | D7. `web/src/lib/format.ts` `STATUS` defines all eight labels once; every value in the web app is rendered through `Measure`/`StatusBadge` with a provenance panel; an UNAVAILABLE value shows a dash and its reason, never a number (`web/src/components/Provenance.test.tsx`) | Only the values that exist today (weather, solar resource, estimates, satellite metadata); DEMO and SIMULATED appear when those features do |
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
