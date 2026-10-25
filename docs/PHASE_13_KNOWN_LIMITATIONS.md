# UrjaSetu EMS — Phase 13 Known Limitations & Operational Constraints

> **Standard**: Data Transparency & Integrity Disclosure  
> **Status**: Active Operational Constraints  
> **Author**: UrjaSetu Systems Architecture & Engineering  
> **Audit Date**: 2026-10-24  

---

## 1. Truth-in-Data Recommendation Disclosures

In energy optimization, claiming guaranteed bill reductions without verifiable telemetry or ignoring local site physical constraints misleads consumers. UrjaSetu EMS enforces explicit boundaries between verified facts, mathematical models, and engineering estimates:

1. **Estimates Are Never Guaranteed Savings**: All cost savings are projected using published tariff orders and historical usage baselines. Changes in household occupancy, seasonal weather extremes, or appliance maintenance will alter actual realization.
2. **Post-Implementation Verification Requires New Bills**: Marking an action `COMPLETED` records the user's operational action; it does not claim verified physical savings until subsequent DISCOM billing cycles confirm the reduction.

---

## 2. Exhaustive Inventory of Current Limitations

### 2.1. Physical Sub-Meter Telemetry Absence
- **Constraint**: Most Indian residential properties possess only a single utility whole-home revenue meter at the point of common coupling (PCC). Sub-metering CT clamps on individual appliance circuits (AC, geyser, EV charger) are absent.
- **Impact**:
  - Appliance-level savings (e.g. `RULE-AC-01`) rely on user-reported wattage and daily operating hours.
  - If a user has not entered appliance specifications, the engine delivers `RULE-APP-GAP` (non-numeric guidance) and refuses to fabricate appliance energy breakdowns.

### 2.2. Fuel Adjustment Charges & Municipal Surcharges
- **Constraint**: State electricity bills include dynamic monthly adjustments that vary per billing cycle:
  - **FPPCA / FAC**: Fuel Price and Power Purchase Cost Adjustment charges (levied per unit based on monthly generation fuel costs).
  - **Municipal Tax / Urban Cess**: Varying by municipal corporation jurisdiction.
  - **Prompt Payment Discounts / Delayed Surcharges**: Dependent on exact bill payment dates.
- **Impact**: Reconstructed bills and savings estimates reflect statutory base energy charges and electricity duty. They may differ slightly ($\approx 1\%\text{ to }3\%$) from the final net payable amount printed on physical DISCOM paper statements.

### 2.3. Rooftop Structural & Shading Assessment
- **Constraint**: The solar sizing engine evaluates specific annual solar yield ($1,450\text{ kWh/kWp/year}$) from verified NASA POWER satellite insolation.
- **Impact**:
  - Parapet shading, adjacent high-rise shadows, roof orientation (azimuth/tilt), and roof structural load-bearing capacity are not physically surveyed.
  - All solar recommendations advise formal DISCOM technical feasibility inspection and registered vendor site survey before procurement.

### 2.4. Smart Meter Interval Cadence Latency
- **Constraint**: While advanced metering infrastructure (AMI) is expanding under RDSS (Revamped Distribution Sector Scheme), the majority of residential meters are read monthly by optical probe or manual meter readers.
- **Impact**: Intraday time-of-day (ToD) optimization is only active for profiles with recorded interval telemetry. Properties with monthly bills receive monthly slab optimization and fixed charge realignment.

---

## 3. Unsupported Scenarios & Future Roadmap Prerequisites

| Capability | Current Status | Required Prerequisite for Future Support |
| :--- | :--- | :--- |
| **Real-Time Automated Discom Bill Scraping** | `RESTRICTED` | Official DISCOM developer API gateway (Mithra / APEPDCL OAuth2) with consumer consent. Password scraping is strictly prohibited. |
| **Disaggregated Non-Intrusive Load Monitoring (NILM)** | `UNAVAILABLE` | High-frequency ($1\text{ Hz}$ or sub-second) whole-home smart meter active power signatures. |
| **Automated Inverter Dispatch Control** | `ADVISORY` | Local Modbus RTU / TCP or SunSpec protocol bridge to hybrid residential inverters. |
| **Dynamic Time-of-Use (ToU) Tariff Switching** | `UNAVAILABLE` | Formal regulatory orders by KERC / APERC mandating mandatory residential ToU metering. |

---

## 4. Manual Operations Runbook

1. **Adding a New User Appliance**:
   - Navigate to Tab 11 ("💡 Energy Optimization & Recommendations").
   - Expand `🔌 Configure Major Household Appliances`.
   - Select appliance type, wattage, and average daily runtime to trigger customized appliance recommendations.
2. **Simulating Capital Investments**:
   - Expand `🎛️ Interactive 'What-If' Scenario Simulator`.
   - Adjust solar capacity slider to evaluate net CapEx after PM Surya Ghar Central Financial Assistance.
3. **Rebuilding Ingestion Cache**:
   ```bash
   .\.venv\Scripts\python scripts/precompute_cache.py --rebuild
   .\.venv\Scripts\python examples/run_demo.py
   .\.venv\Scripts\python scripts/update_readme.py
   ```
