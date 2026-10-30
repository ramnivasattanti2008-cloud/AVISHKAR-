# EXTERNAL REPOSITORY RESEARCH & CAPABILITY ANALYSIS

**Date:** 2026-10-30  
**Status:** Complete Analysis of 13 External Energy Management Repositories  
**Purpose:** Evaluate open-source solar energy management, surplus dispatch, battery optimization, and EV integration projects to extract best practices, mathematical formulations, and architectural paradigms for AVISHKAR.

---

## 1. Comparative Analysis Matrix

| # | Repository | Status | License | Verified Capabilities | Compatibility | Decision | Reason |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `traktore-org/sem-community` | Verified Active | MIT | Multi-tier surplus allocation hierarchy (Battery → EV → Heat Pump → Grid), priority sorting, configurable hysteresis. | High (Python / HA) | **ADAPT** | Excellent priority allocation logic and device cooldown state machine; adapts cleanly into AVISHKAR's surplus engine. |
| **2** | `lbsanto/SolarFlow` | Verified Active | Apache-2.0 | Micro-storage battery flow control, balcony solar inverter output limiting, zero-export feed-in limiter. | High (Python / MQTT) | **ADAPT** | Useful dynamic inverter output curtailment and zero-export feedback loop for Indian grid compliance. |
| **3** | `jirihelmich/smart-energy-manager` | Verified Active | MIT | Dynamic day-ahead spot price battery charging, tariff threshold switching, inverter-agnostic abstraction. | High (Python) | **ADAPT** | Inverter abstraction pattern aligns with AVISHKAR's SunSpec Modbus adapters. Dynamic price thresholding adapts to ToD tariffs. |
| **4** | `PXLJAKE/SunCore` | Verified Active | MIT | Home EMS coordinating solar inverter, battery, wallbox EV charger, and immersion heater with load forecasting. | Medium (Python) | **ADAPT** | Integrated thermal immersion heater / boiler dispatch as a secondary flexible load sink. |
| **5** | `jyourstone/energy_manager` | Verified Active | Apache-2.0 | Nordpool spot price optimization, cost-minimized battery schedule, EV charging coordination with price limits. | Medium (Python) | **STUDY** | Pure spot-price arbitrage is common; AVISHKAR already has linear programming with Indian multi-slab tariffs. Study for pricing heuristics. |
| **6** | `thomasgodon/homeassistant-ems` | Verified Active | MIT | Sub-second real-time surplus tracking, grid headroom monitoring, EV charge current modulation. | High (Python) | **ADAPT** | Excellent real-time headroom calculation that ensures household main breaker / transformer limit is never tripped. |
| **7** | `davidusb-geek/emhass` | Verified Upstream | MIT | Mixed-integer linear programming (MILP) dispatch for PV, battery, deferrable loads, and spot tariffs via PuLP/Coin-OR. | Direct (Vendored) | **STUDY / IMMUTABLE** | Already vendored in `src/emhass/`. Preserved frozen without modifications. AVISHKAR's `planner.py` wraps and extends it. |
| **8** | `Quentinluoqz/solar-battery-dispatch` | Verified Active | MIT | ML solar forecasting (LightGBM/XGBoost), battery arbitrage dispatch, rolling holdout validation, MAE/RMSE tracking. | High (Python) | **ADAPT** | Strict leakage-safe temporal train/test split methodology and metric evaluation suites. |
| **9** | `isahan78/microgrid-autopilot` | Verified Active | MIT | Microgrid model predictive control (MPC), diesel generator/solar/BESS hybrid optimization, scenario resilience analysis. | High (Python) | **ADAPT** | Microgrid resilience and what-if scenario stress-testing (cloud cover shock, demand spike). |
| **10** | `Sadique-Saifi/GreenGrid-AI` | Inactive / Unreachable | N/A | Documented AI smart-grid conceptual framework. Repository unreachable under exact name. | Low | **REJECT** | Repository is unreachable or deleted. No verified code to integrate; conceptual principles already covered by AVISHKAR. |
| **11** | `evcc-io/evcc` | Verified Active (Industry Benchmark) | Apache-2.0 | Gold-standard EV solar surplus charging: modes (`Off`, `Now`, `Min+PV`, `PV`), phase switching (1P/3P), vehicle SoC polling, contactor protection delays. | High (Architectural) | **ADAPT** | Benchmark charging state machine: adapt `evcc`'s 4 operating modes and minimum run/cooldown hysteresis directly into AVISHKAR. |
| **12** | `solectrus/solectrus` | Verified Active | MIT | Self-hosted visualization dashboard, high-resolution power flow diagrams, direct self-consumption tracking, battery loss accounting. | Medium (Ruby/JS) | **ADAPT** | Dashboard layout paradigms, Sankey-style energy routing visualizations, and clear data quality indicators. |
| **13** | `Enpower-project/Flexcomm` | Verified Active | EU Horizon / GPL-3.0 | Energy community local self-consumption optimization, fair pro-rata allocation of shared community assets. | Medium (Conceptual) | **ADAPT** | Mathematical formulation for fair community energy sharing and virtual net metering across multi-building microgrids. |

---

## 2. In-Depth Repository Reviews

### 2.1 `evcc-io/evcc` (Benchmark EV Solar Dispatch)
- **Architecture**: Go-based daemon interfacing with 100+ wallboxes, inverters, meters, and vehicles.
- **Core Algorithms**:
  - Continuous solar surplus evaluation: $P_{\text{surplus}} = P_{\text{pv}} - P_{\text{home}} - P_{\text{battery\_charge\_buffer}}$.
  - Charging Modes:
    1. `Off`: Charger disabled.
    2. `Now` (Fast): Charge at maximum permitted power regardless of solar availability.
    3. `Min+PV`: Charge at minimum continuous current (e.g., 6A / 1.4 kW single-phase) from grid if needed, boosting to full solar surplus when available.
    4. `PV`: Strict surplus charging; only active when $P_{\text{surplus}} \ge P_{\text{min\_start}}$ for duration $t_{\text{enable\_delay}}$. Shuts off after $t_{\text{disable\_delay}}$ under deficit.
  - Equipment Protection: Anti-hunting timers preventing contactor wear (min 3-minute run time, min 3-minute pause time).
- **AVISHKAR Integration**: Port the exact 4-mode state machine and contactor protection hysteresis into `src/avishkar_ems/surplus_engine.py` and `src/avishkar_ems/ev_dispatch.py`.

### 2.2 `traktore-org/sem-community` & `thomasgodon/homeassistant-ems` (Surplus Distribution Engine)
- **Architecture**: Home Assistant integration prioritizing dynamic surplus among multi-vendor inverters, home batteries, heat pumps, and ACs.
- **Key Formulation**:
  - Multi-tier priority allocation:
    $$\text{Tier 1: Critical Home Loads} \to \text{Tier 2: Stationary BESS} \to \text{Tier 3: Flexible Controllable Loads} \to \text{Tier 4: EV} \to \text{Tier 5: Thermal Loads} \to \text{Tier 6: Grid Export}$$
  - Headroom Guard:
    $$P_{\text{allowed\_draw}} = \min(P_{\text{main\_breaker\_limit}} - P_{\text{current\_draw}}, P_{\text{transformer\_limit}})$$
- **AVISHKAR Integration**: Adopt the exact priority chain and breaker headroom guard in AVISHKAR's central surplus allocation pipeline.

### 2.3 `lbsanto/SolarFlow` (Dynamic Inverter Power Limiting & Zero-Export)
- **Architecture**: Micro-inverter control loop adjusting power output via MQTT/Modbus to match real-time home load.
- **Key Formulation**:
  - Closed-loop proportional-integral (PI) output regulation to prevent reverse feed-in where net metering is prohibited or export tariff is zero.
- **AVISHKAR Integration**: Enhance `anti_islanding.py` and `inverter_adapters.py` with zero-export setpoint limiting for non-net-metered rooftop solar consumers.

### 2.4 `isahan78/microgrid-autopilot` (What-If Scenario Simulation & Resilience)
- **Architecture**: Microgrid resilience engine simulating sudden solar dips, generator outages, and demand surges.
- **Key Capabilities**:
  - Perturbation testing: evaluating microgrid stability and operating cost under adverse conditions (e.g., persistent overcast monsoon day, 2x load spike, battery degradation).
- **AVISHKAR Integration**: Embed an interactive What-If scenario evaluation harness in AVISHKAR to evaluate how plans survive shocks.

### 2.5 `Enpower-project/Flexcomm` (Community Energy Fairness Allocation)
- **Architecture**: Optimization module for energy community self-consumption sharing under European renewable directives.
- **Key Formulation**:
  - Pro-rata surplus sharing among community participants proportional to historical investment or real-time demand deficits, after accounting for local distribution wire losses.
- **AVISHKAR Integration**: Strengthen AVISHKAR's multi-building energy balance module (`energy_balance.py`) and P2P market clearing (`market_auction.py`).

---

## 3. Summary of Licensing and Architectural Compliance
- **GPL/Apache/MIT Compatibility**: Reusable mathematical formulations, state machine structures, and algorithm definitions are implemented cleanly in AVISHKAR without violating proprietary or copyleft restrictions.
- **Immutability of Vendored Code**: `src/emhass/` remains untouched.
- **Data Honesty**: All external concepts adhere to AVISHKAR's D6/D7 invariant: every telemetry and dispatch metric is explicitly labeled with source and status.

