# AVISHKAR platform: architecture assessment and decisions

Written 2026-10-07 in response to [SPEC.md](SPEC.md) §100 ("audit first, then build"). Progress lives in
[STATUS.md](STATUS.md); the chronological record of what was done and not done lives in
[../docs/WORKLOG.md](../docs/WORKLOG.md). Decisions are numbered (D1, D2...) so later changes can reference them.

## 1. Audit of the repository at the start of platform work

**Implemented and real (reused, not rewritten):** the Python energy-management system in `src/avishkar_ems/` (P10/P50/P90
quantile forecasts with conformal calibration, outage-risk reserve floor, a two-pass EMHASS LP planner, a battery
executor, P2P offer sizing and settlement, payback and battery-size advice, Beckn-shaped offer messages), a Streamlit
dashboard, real weather and measured Indian household load for three sites, regulator-order tariffs for three sites.
Details: `CLAUDE.md`, `docs/KNOWN_ISSUES.md`.

**Mock, simulated or assumed (must stay labelled):** `sim.py` synthetic sites; shop and clinic load (a German factory
profile) and their outages; export rates; P2P prices (`p2p_share`); fleet pooling across cities; generation is modelled,
not metered.

**Absent for the platform spec:** web API, database and schema, authentication, map UI, provider abstractions for
weather/geocoding/satellite, tariff/DISCOM catalogue, policy table, job queue, Copilot, community/VPP service, OpenAPI,
observability, deployment descriptors. There was no Node code, no `package.json`, no Docker Compose.

**Environment (probed 2026-10-07):** Windows 11; Python 3.12 venv; Node 24.19, npm 11, pnpm 11; no local PostgreSQL;
Docker Desktop installed (engine had to be started). Reachable from this machine: Open-Meteo forecast and archive APIs,
Nominatim, Overpass, NASA POWER, the Earth Search STAC catalogue (Sentinel-2). **Not** reachable: PVGIS (EU JRC), which
times out here.

## 2. Decisions

**D1. Two runtimes, one platform: TypeScript API + Python engine.** Spec §53 asks for a TypeScript backend. The numerics
the product needs (pvlib solar geometry, gradient-boosted quantile models, LP/MILP via HiGHS, the existing validated
`avishkar_ems` code) exist in Python and not in comparable quality in Node. Rewriting them would throw away working,
tested code (against §85). So: the TypeScript API owns HTTP, auth, validation, persistence, providers, jobs and
provenance; a Python **engine service** (`platform/engine`, FastAPI) exposes pure computation (forecast, optimize,
simulate, economics). The API calls the engine over HTTP and stores every result with provenance. This is a deliberate,
documented deviation from "backend = TypeScript only".

**D2. Monorepo under `platform/` with pnpm workspaces:** `platform/api` (Fastify), `platform/web` (Next.js),
`platform/engine` (FastAPI), `platform/packages/*` (shared types and the provenance schema). The existing Python
package and Streamlit app are untouched and keep working.

**D3. Fastify, not Express:** built-in schema validation, first-class TypeScript, OpenAPI generation (§68).

**D4. PostgreSQL + PostGIS with Prisma and hand-written SQL migrations.** Prisma has no native geometry type, so spatial
columns are declared `Unsupported("geometry(...)")` and queried with `$queryRaw`; the migration enables the `postgis`
extension. Local and CI databases run the `postgis/postgis` image. No giant JSON column holds a whole object (§52); JSON
is used only for provenance detail and model parameters.

**D5. Job queue on Postgres (`pg-boss`), not Redis:** one fewer service, transactional with the data, adequate for the
volumes here (§71). Revisit if throughput demands it.

**D6. Provenance is a first-class table and a response envelope, not an afterthought (§3, §40).** Every value an API
returns is wrapped as `{ value, unit, status, provider, observedAt|generatedAt, location, quality, processingVersion,
modelVersion?, confidence? }` where `status` is one of `LIVE | UPDATED | FORECAST | ESTIMATED | SIMULATED | DEMO |
UNAVAILABLE`. `LIVE` is only allowed when a provider timestamp is within a configured freshness window (D7).

**D7. Freshness rules are code, not copy.** A value is `LIVE` only if its observation time is within the provider's
declared cadence times 1.5; otherwise `UPDATED` with an explicit age. The UI renders the age. (§42, §72, §76.)

**D8. Provider abstraction with failover (§6, §10, §72):** one interface per capability (`GeocodingProvider`,
`WeatherProvider`, `SolarResourceProvider`, `SatelliteProvider`, `BuildingFootprintProvider`, `PositioningProvider`).
Initial real implementations: Nominatim (geocoding), Open-Meteo (weather and irradiance forecast and archive), NASA POWER
(solar resource climatology; secondary and PVGIS substitute), Overpass (OSM building footprints), Earth Search STAC
(Sentinel-2 scene metadata and cloud percentage). Each call records latency and outcome. Providers read their base URLs
and keys from environment variables (§73); defaults are public endpoints and respect their usage policies (identifying
User-Agent, cache, rate limit).

**D9. Satellite scope is honest (§11, §12).** Phase 2 delivers Sentinel-2 *metadata* (acquisition time, cloud percentage,
footprint, thumbnail URL) from STAC. A genuine cloud-movement nowcast needs sub-hourly geostationary imagery (e.g.
INSAT-3D/3DR or Himawari-class products), which has no open, key-free, programmatic API from this environment. Until such
a source is integrated, the nowcast endpoint returns `UNAVAILABLE: no recent sub-hourly satellite observations` and the
short-horizon solar forecast uses Open-Meteo minutely-15 radiation. Nothing is faked.

**D10. NavIC (§4):** a `PositioningProvider` interface with `browser-geolocation`, `manual`, `imported` implementations.
A `navic` provider class exists as an interface stub that throws `NotAvailable` unless hardware is configured. The UI
shows the real provider name; browser GNSS is never labelled NavIC.

**D11. Optimiser:** LP/MILP in the engine using HiGHS (`scipy.optimize.milp`/`linprog`), written directly so every
constraint is explicit and testable (§18, §66, §67): battery SOC and rate limits, efficiencies, critical-load coverage,
appliance windows, EV deadline, export limits, reserve. Objective weights per mode (§17). The existing EMHASS-based day-ahead
planner remains the engine for the demo sites; the new optimiser is the general one. Every result passes an energy
conservation check (§67) and is rejected, not shown, if it fails.

**D12. Tariffs and policy are data (§22, §24).** `tariffs` and `policy_rules` tables with effective/expiry dates, region,
source URL and notes; admin-editable with audit log. Seeded only from sources already in this repo (the three
regulator-order tariff JSONs, with their `source` notes) and the PM Surya Ghar slabs currently in `subsidy.py`, marked
`needs-verification`. No tariff is ever shipped as "universal". Missing tariff means `Tariff data unavailable` plus manual
entry.

**D13. Demo data is a separate world (§74, §93).** Demo properties live under a `demo` tenant/flag and are never returned
by live queries; every value derived from them carries `status = DEMO`. The existing real-data sites (Mathura home with
CEEW meter, regulator-order tariffs) are *real inputs with modelled generation* and are labelled accordingly.

**D14. AI Copilot (§44, §90, §91):** a tool-calling layer in the API; the model may only call the fourteen tools in §91 and
every number in its answer must be traceable to a tool result id. The tool layer ships and is tested first and works
without any LLM (a deterministic "explain" renderer). An LLM adapter (Anthropic API, key from env) is optional and added
after the tool layer, with a post-check that rejects answers containing numbers absent from tool results.

## 3. Target architecture

```
 browser ── Next.js (web) ──HTTPS──► Fastify API ──► domain services ──► Prisma ──► PostgreSQL+PostGIS
                                         │                │
                                         │                ├──► provider adapters ──► Open-Meteo / Nominatim / NASA POWER /
                                         │                │        (cache, failover,   Overpass / Earth Search STAC
                                         │                │         latency, provenance)
                                         │                └──► Python engine (FastAPI) ──► avishkar_ems + pvlib + HiGHS
                                         └──► pg-boss worker (separate process): weather refresh, forecast generation,
                                              forecast evaluation, model metrics, opportunity recalculation
```

## 4. Build order and gates

Follows SPEC §84. A phase is DONE only when its tests pass and `STATUS.md` says so with evidence.

1. **Foundation:** monorepo, API skeleton, config/env validation, Postgres+PostGIS compose, Prisma schema and
   migrations, auth, audit log, provenance envelope, geocoding, property CRUD. Gate: typecheck, lint, tests, migration
   applied to a real PostGIS.
2. **Real data:** weather, solar resource, satellite metadata, building footprint, Energy Twin snapshots.
3. **Forecasts:** solar baselines + weather-adjusted model with measured MAE; load baseline; probabilistic bands.
4. **Assets:** battery, EV, appliances, energy flow.
5. **Optimisation:** optimiser, allocation, opportunities, value.
6. **Simulation:** what-if, counterfactual, economics, resilience, carbon.
7. **Copilot and explanations.**
8. **Community and VPP simulation.**
9. **Hardening:** security review, observability, OpenAPI, deployment, end-to-end tests, docs, patent-discovery notes.

The web UI is built per phase alongside the API it needs, map first, never ahead of backend capability (§86).

## 5. Risks and blockers recorded up front

- **PostGIS needs Docker:** the engine had to be started; if it cannot run, migrations and integration tests cannot be
  verified and that is recorded as BLOCKED rather than assumed.
- **PVGIS unreachable here:** NASA POWER and Open-Meteo archive replace it for solar resource; the Python EMS still uses
  bundled PVGIS files for its three sites.
- **Satellite nowcast (D9)** and **grid outage data (§26)** have no open source reachable; both stay `UNAVAILABLE`.
- **Indian tariffs and policy** are published as PDFs/orders per DISCOM; there is no reliable machine-readable national
  feed. The catalogue grows by adding sourced rows, never by guessing.
- **Scope:** the specification is very large. `STATUS.md` is the honest ledger; nothing is marked done without evidence.
