# UrjaSetu (AVISHKAR) — Location-Aware Energy Intelligence & Autonomous EMS Platform

> **Status**: Production-Ready Architectural Release (`release/urjasetu-v1-readiness`, HEAD commit `87569a3`)  
> **Verification**: 1,773 automated tests passing (0 failures), 0 Ruff linter errors, 0 TypeScript errors.

---

## 1. Executive Summary & Vision

**UrjaSetu** (derived from the Sanskrit for *"Bridge of Clean Energy"*, internally codenamed **AVISHKAR**) is an enterprise-grade, location-aware energy intelligence platform and autonomous Energy Management System (EMS). 

Designed specifically for the decentralized Indian energy landscape, UrjaSetu bridges the gap between rooftop solar generation, battery energy storage systems (BESS), electric vehicles (EV), flexible appliance scheduling, and utility grid constraints.

### Core Philosophy: Truth-in-Data
Unlike conventional energy dashboards that fabricate synthetic curves or present speculative savings as historical facts, UrjaSetu operates under a strict **Truth-in-Data** invariant:
* Every number presented to a homeowner, business operator, or DISCOM utility bears an explicit **Provenance Envelope** (`LIVE`, `UPDATED`, `FORECAST`, `ESTIMATED`, `SIMULATED`, `DEMO`, `REFERENCE`, or `UNAVAILABLE`).
* If external telemetry, satellite nowcasts, or DISCOM grid outage feeds do not exist, the platform explicitly explains why the metric is `UNAVAILABLE` rather than hallucinating simulated values.

---

## 2. System Architecture

UrjaSetu utilizes a high-throughput, modular 3-tier microservice architecture backed by an isolated mathematical solver engine:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        NEXT.JS 16 WEB FRONTEND                         │
│   MapLibre GL Map • Energy Twin • Futures • Copilot • Strict CSP SHA   │
│   Port 3000 (Same-Origin /api Proxy Rewrites — Zero CORS Attack Surface)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP First-Party Cookies & CSRF
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          FASTIFY 5 BACKEND API                         │
│   Auth • Properties • Geocoding • Providers • Tariffs • Plans • Audit  │
│   Port 8080 (Zod Validation • OpenAPI 3.1 Contract • Hop-Count Proxy)   │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │ Prisma 7 + PostGIS SQL                   │ Internal HMAC Key
               ▼                                          ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│     POSTGRESQL 16 + POSTGIS   │        │     FASTAPI PYTHON ENGINE     │
│   Spatial Polygons • DNA Fingerprints  │ pvlib Solar • Conformal GBDT  │
│   Audit Logs • Encrypted Backups       │ HiGHS 1.15.1 Solver • Maximin │
│   Port 5432 (WSL Ubuntu / Docker)      │ Port 8090 (LRU Model Cache)   │
└───────────────────────────────┘        └───────────────────────────────┘
```

### 2.1. Web Frontend (`platform/web`)
* **Framework**: Next.js 16.3 (React 19, standalone output mode).
* **Mapping**: MapLibre GL 6.12 with zero commercial dependencies (built-in OpenStreetMap, Esri World Imagery, and OpenTopoMap basemaps).
* **Security**: Hardened Content Security Policy (CSP) with inline theme script hashing (`'sha256-4YtY90i3qJ...'`), strict framing protections, and CSRF double-submit token enforcement.
* **Component Testing**: 346 unit and component tests passing via Vitest, React Testing Library, and automated `axe-core` accessibility validation.

### 2.2. Backend API (`platform/api`)
* **Framework**: Fastify v5 with fastify-type-provider-zod and Zod v4 schemas.
* **Database & ORM**: PostgreSQL 16 with PostGIS 3.4 spatial extensions, managed via Prisma 7.10 with `@prisma/adapter-pg`.
* **API Documentation**: Auto-generated, stable OpenAPI 3.1 specification (`openapi.json`) with TypeScript definitions regenerated via `openapi-typescript`.
* **Reliability**: 903 automated integration tests running sequentially against live throwaway test databases with transactional rollback isolation.

### 2.3. Numerical Engine (`platform/engine`)
* **Framework**: FastAPI microservice protected by a 43-character shared secret (`ENGINE_API_KEY`). Strictly forbids insecure dev overrides in production.
* **Physical Modeling**: `pvlib` 0.16 plane-of-array irradiance transposition (Simplified Solis clear-sky model, Erbs diffuse decomposition, temperature derating).
* **Optimization**: HiGHS 1.15.1 Mixed-Integer Linear Programming (MILP) solver executing balanced, resilient, revenue-maximizing, and green dispatch plans in <500 ms.
* **Model Caching**: In-memory cryptographic LRU caching keyed on SHA-256 parameter hashes, eliminating redundant gradient-boosted decision tree (GBDT) refits.

### 2.4. Python EMS Library & Prototype Dashboard (`src/avishkar_ems`, `app/`)
* **Standalone Library**: High-performance domain package housing Indian DISCOM tariff schedules, CEEW dataset loaders, lifetime discounted cash-flow / NPV calculators, and fault monitoring algorithms.
* **Interactive Dashboard**: Streamlit-based diagnostic explorer (`app/dashboard.py`).

---

## 3. Core Platform Capabilities

### 3.1. Map-First Energy Twin
* Pinpoint any rooftop in India via address search (Nominatim), coordinate pasting, or GPS location.
* Automated OpenStreetMap building footprint query with failover mirrors (`overpass-api.de`, `overpass.kumi.systems`).
* Browser-based polygon drawing tool enabling manual roof outline tracing with geodesic surface area calculations ($m^2$).
* Real Sentinel-2 satellite scene metadata ingestion (cloud cover, acquisition timestamps) via AWS Earth Search STAC.

### 3.2. Calibrated Solar & Load Forecasting
* **Solar Forecasting**: Generates 24–168 hour forward solar forecasts with empirical $P10$ to $P90$ confidence bands learned from Open-Meteo's historical day-ahead forecast error distribution.
* **Load Forecasting**: Four competitive algorithms compete on chronological holdouts (Same Hour of Week, Same Hour of Recent Days, Weekly Persistence, and Conformalized Quantile LightGBM). Automatically selects the winning model only if it beats baseline persistence by $\ge 2\%$.

### 3.3. Multi-Mode MILP Dispatch Optimizer
The optimization engine schedules battery charge/discharge, EV charging sessions, and deferrable appliance runs across 6 modes:
1. `BALANCED`: Co-optimizes bill savings, battery degradation, and comfort.
2. `SAVE_MONEY`: Aggressive arbitrage charging during solar surplus / low-tariff hours and discharging during peak time-of-day (ToD) tariffs.
3. `INDEPENDENCE`: Minimizes grid imports and maximizes self-consumption.
4. `GREEN`: Minimizes carbon emissions based on grid emission factors.
5. `RESILIENCE`: Prioritizes emergency backup reserve retention ahead of storms or historical outage windows.
6. `REVENUE`: Maximizes feed-in and peer-to-peer (P2P) energy sales.

### 3.4. Multi-State DISCOM Tariff Catalogue
Curated, gazetted tariff orders with slab limits, time-of-day blocks, fixed demand charges, and net-metering solar buyback rules:
* **Karnataka (BESCOM)**: LT-2(a) Bengaluru Urban domestic schedule (₹7.00/kWh marginal rate, ₹3.10/kWh generic solar PPA buyback).
* **Delhi (BSES Rajdhani - BRPL)**: Domestic schedule (₹6.50/kWh representative slab, ₹3.80/kWh APPC net-metering settlement).
* **Maharashtra (MSEDCL)**: Domestic & Commercial ToD schedules (Pune).
* **Rajasthan (JVVNL)**: Commercial NDS / LT-2 schedules (Jaipur).
* **Uttar Pradesh (UPPCL)**: LMV-1 urban domestic schedule (Mathura).
* **Custom Tariff Builder**: Form-based UI supporting telescopic slabs and ToD blocks for any unlisted DISCOM.

### 3.5. Risk-Aware Maximin Optimization
* Evaluates plans against 4 explicit stress scenarios: *Baseline ($P50/P50$)*, *Solar Shortfall ($P10/P50$)*, *Demand Surge ($P50/P90$)*, and *Combined Adverse ($P10/P90$)*.
* Adjustable risk-aversion weight $\alpha \in [0, 1]$ interpolating between risk-neutral cost minimization and worst-case regret hedging.
* Quantifies unserved energy shortfalls and applies financial shortfall penalties.

### 3.6. Every-kWh Energy Attribution Ledger
* Traces every generated and imported kilowatt-hour through a transparent 5-stage priority accounting convention:
  1. Sun $\rightarrow$ Real-time Demand
  2. Sun $\rightarrow$ Battery Storage
  3. Sun $\rightarrow$ Grid Export / P2P Trading
  4. Battery Discharge $\rightarrow$ Evening Demand
  5. Grid Import $\rightarrow$ Residual Demand
* Includes battery charge-queue accounting to explain where delivered battery energy originated (*"The 2.4 kWh you used at 8 PM was solar energy captured at noon"*).

### 3.7. Device Hardware Control Seams
* **`NoDeviceExecutor`**: Safe default for software-only simulations; logs approvals without dispatching power.
* **`HomeAssistantExecutor`**: Direct REST service integration with Home Assistant entities (`switch.turn_on/off` for deferrable appliances/EVs, `number.set_value` for inverter/BESS charging limits).
* **`MqttDeviceExecutor`**: Publishes structured JSON dispatch commands (`APPLY` / `REVERT`) to standard MQTT broker topics (`urjasetu/{propertyId}/{kind}/apply`) for SunSpec Modbus-to-MQTT bridges, ESPHome, and Zigbee relays.

### 3.8. Onboarding Diversity: Interval CSVs & Monthly Bills
* **Interval Meter Upload**: Ingests smart meter CSV files (kWh, Wh, kW, W) at 15-, 30-, or 60-minute resolution, auto-detecting delimiters, verifying timestamps, and rejecting corrupted rows.
* **Bills-Only Onboarding**: Takes 6–12 monthly DISCOM utility bills and synthesizes continuous hourly load profiles using empirical CEEW diurnal shapes with exact monthly energy conservation.

### 3.9. Intraday Plan Drift Detection
* Route `GET /api/properties/:id/plan/drift` checks incoming smart meter readings against the active plan schedule.
* Calculates percentage drift and flags `replanRecommended: true` when real-time consumption deviates by $>15\%$.

### 3.10. Grounded AI Copilot
* 20 specialized tools covering allocation, solar potential, tariff comparisons, waste analysis, resilience, and robustness.
* Operates out-of-the-box via a deterministic grounded template engine with zero hallucinations. Optional Anthropic Claude path enabled by supplying `ANTHROPIC_API_KEY`.

---

## 4. Repository Layout

```
AVISHKAR-/
├── .github/workflows/          # CI/CD: lint, pytest, vitest, README consistency, Docker build
├── app/                        # Streamlit legacy EMS dashboard
├── data/
│   ├── tariffs/                # Sourced DISCOM tariff schedules (JSON)
│   ├── real/                   # Empirical meter data & weather fixtures
│   └── policy/                 # PM Surya Ghar & national subsidy rules
├── docs/                       # Project documentation, WORKLOG.md, KNOWN_ISSUES.md, TEAM_PLAN.md
├── platform/
│   ├── api/                    # Fastify 5 TypeScript API service
│   │   ├── prisma/             # PostgreSQL + PostGIS schema and migrations
│   │   ├── src/                # Auth, Properties, Providers, Tariffs, Plan, Control, Jobs
│   │   └── test/               # 61 test suites (903 integration & contract tests)
│   ├── engine/                 # FastAPI Python numerical engine
│   │   ├── avishkar_engine/    # pvlib solar, GBDT load, HiGHS optimizer
│   │   └── tests/              # 413 pytest tests
│   ├── web/                    # Next.js 16 frontend app
│   │   ├── src/app/            # App Router pages
│   │   ├── src/components/     # Map, Property, Plan, Assets, Copilot, Admin UI
│   │   └── src/lib/            # CSP, basemaps, API clients, theme utilities
│   ├── docker/                 # Production Dockerfiles (API, Web, Engine)
│   ├── scripts/                # Encrypted backup & restore utilities (AES-256 GPG)
│   ├── docker-compose.yml      # Multi-container orchestration stack
│   └── STATUS.md               # 100-section specification compliance ledger
├── src/
│   ├── avishkar_ems/           # Core domain library (tariffs, cache, monitor, bills, risk_optim)
│   └── emhass/                 # Vendored upstream solver engine (strictly read-only)
├── tests/avishkar_ems/         # 111 Python EMS pytest tests
├── run-platform.cmd            # One-click Windows CMD launcher (Engine, API, Web)
├── run-platform.ps1            # One-click Windows PowerShell launcher
├── run-dashboard.cmd           # One-click Streamlit dashboard launcher
├── PROJECT.md                  # This master project overview
└── BRAIN.md                    # Deep algorithmic memory, mathematical formulations & invariants
```

---

## 5. Quickstart & Local Execution

### Prerequisites
* **Node.js**: v20+ with `pnpm` installed.
* **Python**: v3.12 with `.venv` created.
* **PostgreSQL 16 + PostGIS 3.4**: Running locally or inside WSL Ubuntu (`sudo service postgresql start`).

### One-Click Launch
In PowerShell:
```powershell
.\run-platform.ps1
```
Or double-click `run-platform.cmd`.

This automatically starts:
1. **Optimization Engine**: `http://127.0.0.1:8090` (HiGHS solver).
2. **Fastify Backend API**: `http://127.0.0.1:8080` (OpenAPI docs at `/api/docs`).
3. **Next.js Web Frontend**: `http://127.0.0.1:3000`.

---

## 6. Verification & Quality Gates

Every change in UrjaSetu must satisfy strict automated verification gates:

```bash
# 1. Python Linting (Strict PEP 8 / isort, zero errors)
python -m ruff check src/avishkar_ems tests/avishkar_ems platform/engine/avishkar_engine platform/engine/tests --no-fix

# 2. Python EMS Tests (111 passed)
python -m pytest tests/avishkar_ems -q

# 3. Engine Tests (413 passed)
python -m pytest platform/engine/tests -q

# 4. Platform Web Tests (346 passed)
pnpm -C platform/web test
pnpm -C platform/web typecheck
pnpm -C platform/web lint

# 5. Platform API Integration Tests (903 passed)
pnpm -C platform/api test
pnpm -C platform/api typecheck
pnpm -C platform/api lint

# 6. OpenAPI & Results Consistency
pnpm -C platform/api test test/openapi.test.ts
python scripts/update_readme.py --check
```

**Total Automated Test Count**: **1,773 passing tests** across 4 suites with 0 failures.
