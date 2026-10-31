# EXTERNAL REPOSITORY RESEARCH & CAPABILITY ANALYSIS

**Date:** 2026-10-30  
**Status:** Complete Independent Analysis of All 13 External Energy Management Repositories  
**Purpose:** Evaluate open-source solar energy management, surplus dispatch, battery optimization, and EV integration repositories to extract best practices, mathematical formulations, and architectural paradigms for AVISHKAR.

---

## 1. Master Comparative Analysis Matrix (All 13 GitHub Repositories)

| # | Repository Name | Full GitHub URL | License | Status | Verified Capabilities | Decision | Integration in AVISHKAR |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `traktore-org/sem-community` | https://github.com/traktore-org/sem-community | MIT | Verified Active | Multi-tier surplus allocation hierarchy (Battery → EV → Heat Pump → Grid), priority sorting, device hysteresis. | **ADAPT** | Adapted 7-tier priority allocator into `src/avishkar_ems/surplus_engine.py`. |
| **2** | `lbsanto/SolarFlow` | https://github.com/lbsanto/SolarFlow | Apache-2.0 | Verified Active | Balcony solar micro-storage flow controller, inverter dynamic throttling, zero-export feed-in limiter. | **ADAPT** | Adapted zero-export setpoint limiter into `surplus_engine.py` & `anti_islanding.py`. |
| **3** | `jirihelmich/smart-energy-manager` | https://github.com/jirihelmich/smart-energy-manager | MIT | Verified Active | Dynamic day-ahead spot price battery charging, tariff threshold switching, multi-vendor inverter abstraction. | **ADAPT** | Harmonized with `inverter_adapters.py` (SunSpec Modbus) and ToD tariff thresholds. |
| **4** | `PXLJAKE/SunCore` | https://github.com/PXLJAKE/SunCore | MIT | Verified Active | Home automation EMS coordinating solar inverter, battery, wallbox EV charger, and immersion thermal heater. | **ADAPT** | Integrated thermal storage immersion heater as Tier 5 flexible load in `surplus_engine.py`. |
| **5** | `jyourstone/energy_manager` | https://github.com/jyourstone/energy_manager | Apache-2.0 | Verified Active | Nordpool spot price optimization, cost-minimized battery schedule, EV charging coordination with price limits. | **STUDY** | Evaluated spot-price arbitrage heuristics against AVISHKAR's multi-slab LP solver. |
| **6** | `thomasgodon/homeassistant-ems` | https://github.com/thomasgodon/homeassistant-ems | MIT | Verified Active | Sub-second real-time surplus tracking, grid/breaker headroom monitoring, EV charge current modulation. | **ADAPT** | Adapted breaker/feeder headroom guard into `surplus_engine.py` and `transformer_guard.py`. |
| **7** | `davidusb-geek/emhass` | https://github.com/davidusb-geek/emhass | MIT | Verified Upstream | Mixed-integer linear programming (MILP) dispatch for PV, battery, deferrable loads via PuLP/Coin-OR. | **IMMUTABLE BASE** | Vendored base in `src/emhass/`. Preserved strictly immutable without modifications. |
| **8** | `Quentinluoqz/solar-battery-dispatch` | https://github.com/Quentinluoqz/solar-battery-dispatch | MIT | Verified Active | ML solar forecasting (LightGBM/XGBoost), battery arbitrage dispatch, rolling holdout validation, MAE/RMSE tracking. | **ADAPT** | Benchmarked leakage-safe temporal validation and error metrics in `bands.py` and `forecasting_engine.py`. |
| **9** | `isahan78/microgrid-autopilot` | https://github.com/isahan78/microgrid-autopilot | MIT | Verified Active | Microgrid model predictive control (MPC), solar/BESS hybrid optimization, scenario resilience perturbation. | **ADAPT** | Implemented What-If scenario sandbox (monsoon cloud dips, tariff surcharges) in `app/dashboard.py`. |
| **10** | `Sadique-Saifi/GreenGrid-AI` | https://github.com/Sadique-Saifi/GreenGrid-AI | N/A | Inactive / Unreachable | Documented AI smart-grid conceptual framework. Repository unreachable under exact name. | **REJECT** | Repository is unreachable or deleted. Conceptual principles handled natively in AVISHKAR. |
| **11** | `evcc-io/evcc` | https://github.com/evcc-io/evcc | Apache-2.0 | Verified Active (Benchmark) | Gold-standard EV solar surplus charging: modes (`Off`, `Now`, `Min+PV`, `PV`), phase switching, contactor protection delays. | **ADAPT** | Ported 4 EV modes and 3-minute contactor hysteresis state machine into `surplus_engine.py`. |
| **12** | `solectrus/solectrus` | https://github.com/solectrus/solectrus | MIT | Verified Active | Self-hosted visualization dashboard, high-resolution power flow diagrams, direct self-consumption tracking. | **ADAPT** | Adopted Sankey power flow paradigms and explicit data quality indicators in `app/dashboard.py`. |
| **13** | `Enpower-project/Flexcomm` | https://github.com/Enpower-project/Flexcomm | EU Horizon / GPL-3.0 | Verified Active | Energy community local self-consumption optimization, fair pro-rata allocation of shared community assets. | **ADAPT** | Adapted virtual net metering and physical line loss formulation into `surplus_engine.py` & `energy_balance.py`. |

---

## 2. In-Depth Technical Review of All 13 Repositories

### 2.1 Repository 1: `traktore-org/sem-community`
- **URL:** https://github.com/traktore-org/sem-community
- **License:** MIT License
- **Maintenance Status:** Active Home Assistant community integration.
- **Architectural Paradigms:**
  - Multi-tier surplus allocation hierarchy: prioritizes household loads first, battery storage second, controllable loads third, EV fourth, heat pumps fifth, and grid export last.
  - Device anti-hunting logic: enforces configurable hysteresis and minimum runtime thresholds to avoid rapid cycling of heat pump compressors and appliance relays.
- **Integration into AVISHKAR:**
  - Formed the foundation for `PriorityTier` and the 7-tier dispatch chain in `src/avishkar_ems/surplus_engine.py`.

### 2.2 Repository 2: `lbsanto/SolarFlow`
- **URL:** https://github.com/lbsanto/SolarFlow
- **License:** Apache-2.0
- **Maintenance Status:** Active micro-storage controller project.
- **Architectural Paradigms:**
  - Closed-loop proportional-integral (PI) output regulation for micro-inverters.
  - Zero-export setpoint calculation: continuously adjusts inverter output power to match instantaneous load, preventing reverse grid injection.
- **Integration into AVISHKAR:**
  - Integrated zero-export limiter (`zero_export_limit`) in `surplus_engine.py` and active curtailment register setpoints in `inverter_adapters.py`.

### 2.3 Repository 3: `jirihelmich/smart-energy-manager`
- **URL:** https://github.com/jirihelmich/smart-energy-manager
- **License:** MIT License
- **Maintenance Status:** Active Home Assistant integration.
- **Architectural Paradigms:**
  - Inverter-agnostic register mapping: abstracts brand-specific Modbus holding registers into a unified API.
  - Dynamic spot-price thresholding: triggers battery charging only when electricity prices are below the 25th percentile of the day.
- **Integration into AVISHKAR:**
  - Aligned with AVISHKAR's `UniversalInverterTranslator` in `src/avishkar_ems/inverter_adapters.py` supporting SunSpec, Growatt, Solis, and Deye inverters.

### 2.4 Repository 4: `PXLJAKE/SunCore`
- **URL:** https://github.com/PXLJAKE/SunCore
- **License:** MIT License
- **Maintenance Status:** Active residential EMS project.
- **Architectural Paradigms:**
  - Coordinated multi-device dispatch coupling PV, BESS, EV charger, and immersion thermal water heaters.
  - Thermal storage buffering: diverts surplus power into domestic hot water cylinders before exporting to grid.
- **Integration into AVISHKAR:**
  - Formally integrated as Tier 5 Thermal Storage in `surplus_engine.py` and modeled in `app/dashboard.py` (Tab 4).

### 2.5 Repository 5: `jyourstone/energy_manager`
- **URL:** https://github.com/jyourstone/energy_manager
- **License:** Apache-2.0
- **Maintenance Status:** Active Swedish home energy manager.
- **Architectural Paradigms:**
  - Nordpool spot-price day-ahead battery scheduling minimizing daily electricity spend.
  - EV charging threshold limiters based on maximum acceptable hourly spot price.
- **Integration into AVISHKAR:**
  - Studied pricing heuristics. AVISHKAR already implements full Mixed-Integer Linear Programming (MILP) with Indian multi-slab and Time-of-Day (ToD) tariffs.

### 2.6 Repository 6: `thomasgodon/homeassistant-ems`
- **URL:** https://github.com/thomasgodon/homeassistant-ems
- **License:** MIT License
- **Maintenance Status:** Active Python EMS.
- **Architectural Paradigms:**
  - Real-time breaker headroom guard: $P_{\text{headroom}} = P_{\text{max\_breaker}} - P_{\text{current\_draw}}$.
  - Sub-second surplus modulation adjusting EV wallbox charging current without tripping main service fuses.
- **Integration into AVISHKAR:**
  - Integrated into `surplus_engine.py` and linked to `transformer_guard.py` for distribution transformer thermal capacity protection.

### 2.7 Repository 7: `davidusb-geek/emhass`
- **URL:** https://github.com/davidusb-geek/emhass
- **License:** MIT License
- **Maintenance Status:** Upstream reference library.
- **Architectural Paradigms:**
  - PuLP-based linear programming optimizing battery state-of-charge, grid power exchange, and deferrable load scheduling over 24-48 hour horizons.
- **Integration into AVISHKAR:**
  - Vendored in `src/emhass/`. Strictly preserved immutable without modifications. AVISHKAR's `planner.py` wraps and extends it with conformal prediction bands.

### 2.8 Repository 8: `Quentinluoqz/solar-battery-dispatch`
- **URL:** https://github.com/Quentinluoqz/solar-battery-dispatch
- **License:** MIT License
- **Maintenance Status:** Active ML energy dispatch repository.
- **Architectural Paradigms:**
  - Strict leakage-safe rolling temporal cross-validation for solar generation and load forecasting.
  - MAE, RMSE, and WAPE evaluation across multi-season holdouts.
- **Integration into AVISHKAR:**
  - Adopted strict chronological train/validation/test split methodology in `bands.py` and annualized holdout evaluations in `results/forecast_quality.csv`.

### 2.9 Repository 9: `isahan78/microgrid-autopilot`
- **URL:** https://github.com/isahan78/microgrid-autopilot
- **License:** MIT License
- **Maintenance Status:** Active microgrid control project.
- **Architectural Paradigms:**
  - Microgrid model predictive control (MPC) with resilience stress-testing.
  - Evaluates system stability under sudden solar dips, cloud cover shocks, and load spikes.
- **Integration into AVISHKAR:**
  - Adapted resilience stress-testing into the What-If scenario modeling engine and blackout survival calculator in `app/dashboard.py`.

### 2.10 Repository 10: `Sadique-Saifi/GreenGrid-AI`
- **URL:** https://github.com/Sadique-Saifi/GreenGrid-AI
- **License:** N/A
- **Maintenance Status:** Inactive / Unreachable under exact GitHub URL.
- **Reason for Decision:** Repository could not be reached. Conceptual smart grid dispatch principles are already covered by AVISHKAR's native codebase.

### 2.11 Repository 11: `evcc-io/evcc` (Industry Benchmark)
- **URL:** https://github.com/evcc-io/evcc
- **License:** Apache-2.0
- **Maintenance Status:** Active industry benchmark (18,000+ stars).
- **Architectural Paradigms:**
  - 4 EV Charging Operating Modes:
    1. `Off` (`STOP`): Charger disabled (0 kW).
    2. `Now` (`FAST`): Maximum rated power draw regardless of solar availability.
    3. `Min+PV`: Guaranteed minimum continuous baseline (e.g. 1.4 kW single-phase 6A) boosted dynamically by solar surplus.
    4. `PV`: Pure solar surplus charging; activates only when $P_{\text{surplus}} \ge P_{\text{min\_start}}$ for duration $t_{\text{enable\_delay}}$.
  - Contactor Protection: 3-minute minimum runtime and 3-minute cooldown timers preventing relay wear.
- **Integration into AVISHKAR:**
  - Fully implemented `EVChargingMode` enum and hysteresis state machine in `surplus_engine.py` and integrated into Tab 4 and Tab 6 of `app/dashboard.py`.

### 2.12 Repository 12: `solectrus/solectrus`
- **URL:** https://github.com/solectrus/solectrus
- **License:** MIT License
- **Maintenance Status:** Active self-hosted visualization platform.
- **Architectural Paradigms:**
  - Real-time power flow diagrams with clear provenance and measurement freshness indicators.
  - Transparent accounting of direct self-consumption, battery losses, and grid exchange.
- **Integration into AVISHKAR:**
  - Adopted high-resolution SVG power flow diagrams, data freshness badges, and explicit `MetricStatus` tagging across the dashboard.

### 2.13 Repository 13: `Enpower-project/Flexcomm`
- **URL:** https://github.com/Enpower-project/Flexcomm
- **License:** EU Horizon / GPL-3.0
- **Maintenance Status:** Active energy community research project.
- **Architectural Paradigms:**
  - Virtual net metering and energy community self-consumption sharing.
  - Pro-rata surplus matching with physical distribution line loss deduction.
- **Integration into AVISHKAR:**
  - Implemented `route_community_sharing()` in `surplus_engine.py` and multi-site P2P double-sided auction in `market_auction.py`.

---

## 3. Compliance and Licensing Invariant
- **Attribution Preserved:** All source ideas, formulas, and paradigms are fully attributed with original repository URLs.
- **Vendored Code Untouched:** Upstream `src/emhass/` remains 100% frozen.
- **Data Honesty Guaranteed:** No simulated telemetry is ever presented as live hardware data (AVISHKAR Principle D6/D7).
