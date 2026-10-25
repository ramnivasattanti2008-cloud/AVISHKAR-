# UrjaSetu EMS — Phase 12 Known Data Limitations & System Constraints

> **Standard**: Data Transparency & Integrity Disclosure  
> **Status**: Active Operational Constraints  
> **Author**: UrjaSetu Systems Architecture & Engineering  
> **Audit Date**: 2026-10-24  

---

## 1. Core Principle: Truth-in-Data vs. Synthetic Extrapolation

In energy monitoring, presenting estimated or synthetic numbers as live measured facts creates severe operational and legal risks for grid operators, industrial planners, and policymakers. In accordance with the **UrjaSetu Data Honesty Invariants**:
- If a metric is not directly observed, reported by a statutory agency, or derived through a validated physical model, it is marked `UNAVAILABLE`.
- UrjaSetu EMS strictly refuses to fill empty dashboard cards with synthetic averages, random simulations, or unmetered proxies.

---

## 2. Exhaustive Inventory of Current Data Limitations

### 2.1. District-Level Generation & Demand Absence (Anti-Disaggregation)
- **Constraint**: Central Electricity Authority (CEA) and State Load Despatch Centers (SLDCs) compile generation outturn, renewable splits, and transmission demand at National, Regional, and State levels only.
- **Impact on District Scope (`IN_KA_BLR_URBAN`)**:
  - `Peak Demand Met`: Marked `UNAVAILABLE`.
  - `Electricity Energy Supplied`: Marked `UNAVAILABLE`.
  - `Solar Energy Generation`: Marked `UNAVAILABLE`.
  - `Renewable Generation Share`: Marked `UNAVAILABLE`.
- **Supported District Metrics**:
  - Solar Irradiance ($\text{W/m}^2$) via Open-Meteo Satellite Reanalysis.
  - Solar Insolation ($\text{kWh/m}^2/\text{day}$) via NASA POWER Climatology.
  - Retail consumer tariffs via KERC / APERC tariff schedules.
- **Architectural Guard**: `AntiDisaggregationGuard` throws `ValueError` if any service attempts to divide state generation by district population or area proxies.

---

### 2.2. Discom vs. Revenue District Boundary Non-Congruence
- **Constraint**: Electricity distribution company (Discom) administrative boundaries do not map 1:1 to single revenue districts.
- **Example**: `KA_BESCOM` (Bangalore Electricity Supply Company Limited) serves 8 distinct revenue districts:
  1. Bengaluru Urban
  2. Bengaluru Rural
  3. Chikkaballapura
  4. Kolar
  5. Davanagere
  6. Tumakuru
  7. Chitradurga
  8. Ramanagara
- **Impact**: Operational energy met figures reported by BESCOM ($2,850\text{ MU}$) represent the combined multi-district utility supply and must never be labeled as the demand of Bengaluru Urban alone.

---

### 2.3. CEA Standard Classification for Hydroelectric Power
- **Constraint**: Under statutory guidelines issued by the Central Electricity Authority (CEA) and Ministry of Power:
  - **Small Hydro Installations ($\le 25\text{ MW}$)**: Formally classified as Renewable Energy Sources (RES).
  - **Large Hydro Installations ($> 25\text{ MW}$)**: Classified as conventional utilities alongside thermal and nuclear baseload stations.
- **Impact**: The `Renewable Generation Share` displayed on the Command Center includes Small Hydro but excludes Large Hydro generation from the renewable numerator, strictly reflecting CEA official statistics.

---

### 2.4. Public Data Ingestion Latency & Temporal Alignment
- **Constraint**: Official public datasets from statutory bodies are published on specific staggered schedules:
  - **CEA Executive Summary**: Published on a monthly cadence at T+25 to T+30 days following month close.
  - **POSOCO / Grid-India Daily Outturn**: Published daily at T+1 day, but lacks fuel-category reconciliation until monthly audit.
  - **State Open Data Portals**: Published quarterly or bi-annually, often with unannounced schema changes.
- **Impact**: Live, real-time seconds-interval SCADA telemetry is not publicly accessible via open government APIs. All monthly figures reflect verified published historical periods (e.g. `2024-05`, `2024-04`, `2024-03`).

---

### 2.5. Household Privacy & Data Isolation
- **Constraint**: Individual household electricity consumption, smart meter readings, load curves, and billing records contain sensitive personally identifiable information (PII) and consumer activity signatures.
- **Impact**:
  - The Unified Energy Command Center is strictly limited to macro-territorial aggregates (`NATIONAL`, `STATE`, `DISCOM`, `DISTRICT`).
  - Household telemetry is completely isolated within authenticated account views (`HouseholdModule`) and is never queryable through public Command Center APIs or audit report exports.

---

## 3. Unsupported Metrics & Future Roadmap Prerequisites

| Metric Name | Desired Level | Current Status | Required Prerequisite for Future Support |
| :--- | :--- | :--- | :--- |
| **District Hourly Demand Curve** | District | `UNAVAILABLE` | Direct API integration with Discom Substation SCADA / AMI database. |
| **Rooftop Solar Unmetered Generation** | State / District | `UNAVAILABLE` | Mandated smart net-metering telemetry roll-out under PM Surya Ghar Yojana. |
| **Real-Time Transmission Line Congestion** | Regional | `UNAVAILABLE` | Statutory API access to National Load Despatch Centre (NLDC) real-time State Estimator. |
| **Feeder-Level Technical & Commercial Losses** | Feeder | `UNAVAILABLE` | Discom Feeder-Level Automated Meter Reading (AMR) open-access publication. |

---

## 4. Manual Operations & Operator Runbook

1. **New Monthly Ingestion**:
   - When a new CEA monthly report is published, operators trigger the ingestion pipeline via the Health Center or the CLI connector runners.
   - Do not edit raw cache files by hand.
2. **Re-computing Cache After Upstream Changes**:
   - If updates occur under `src/avishkar_ems` or `data/real`:
     ```bash
     .\.venv\Scripts\python scripts/precompute_cache.py --rebuild
     .\.venv\Scripts\python examples/run_demo.py
     .\.venv\Scripts\python scripts/update_readme.py
     ```
   - Never hand-edit the README block between the results markers.
