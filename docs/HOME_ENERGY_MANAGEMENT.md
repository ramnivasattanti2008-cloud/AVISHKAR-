# AVISHKAR Home Energy Management Platform
## Architecture, Optimization, Safety Guardrails & Phase 7 Benchmark

### 1. Executive Overview

AVISHKAR now provides a complete residential solar and surplus energy management platform designed to support two complementary operating paradigms:
1. **Individual Residential Energy Management**: Comprehensive local onboarding, solar generation forecasting, battery lifecycle protection, flexible appliance shifting, intelligent EV charging, and multi-objective optimization (Bill Minimization, Self-Consumption Maximization, Grid-Import Reduction, and Backup Reserve Preservation).
2. **Multi-Home & Community-Level Surplus Energy Management**: Opt-in peer-to-peer (P2P) surplus routing across local low-voltage feeder circuits with physical $I^2R$ copper line loss accounting, virtual net metering, and zero double-counting.

**Core Invariant**: The individual-home experience is 100% autonomous and fully useful on its own. It **does not require the homeowner to participate in a community**, enroll in external markets, or possess active network connectivity. When a home is in standalone mode or the community network is unavailable, the local energy balance engine falls back to deterministic local optimization.

---

### 2. Physical & Mathematical Energy Balance Engine

At each discrete time interval $\Delta t$, the engine enforces the **First Law of Thermodynamics (Conservation of Energy)**:

$$P_{\text{sources}} \equiv P_{\text{sinks}}$$

$$\underbrace{P_{\text{pv}} + P_{\text{dis}} + P_{\text{imp}}}_{\text{Total Available Power (kW)}} = \underbrace{P_{\text{load}} + P_{\text{chg}} + P_{\text{flex}} + P_{\text{ev}} + P_{\text{exp}} + P_{\text{loss}}}_{\text{Total Consumed/Stored/Exported Power (kW)}}$$

Where:
- $P_{\text{pv}}$: Inverter-clipped solar active power ($\le P_{\text{inverter\_rated}}$).
- $P_{\text{dis}}$: Battery discharge power ($\le P_{\text{dis\_max}}$).
- $P_{\text{imp}}$: Power imported from the DISCOM grid.
- $P_{\text{load}}$: Uncontrollable household baseline power demand.
- $P_{\text{chg}}$: Battery charge power ($\le P_{\text{chg\_max}}$).
- $P_{\text{flex}}$: Aggregate power consumed by scheduled flexible appliances.
- $P_{\text{ev}}$: Dynamic EV charger active power.
- $P_{\text{exp}}$: Net power exported to the grid (clamped to 0.0 kW if zero-export is enforced).
- $P_{\text{loss}}$: Conversion losses ($P_{\text{inv\_loss}} + P_{\text{batt\_loss}}$).

The engine enforces $\Delta E < 10^{-4}\text{ kW}$ error invariant across every dispatch step.

---

### 3. Battery Safety Envelope & Protective Guardrails

To prevent battery degradation, thermal runaway, and inverter bridge damage, the balance engine enforces the following constraints:

1. **State-of-Charge (SoC) Bounds**:
   $$\text{SoC}_{\min} \le \text{SoC}_t \le \text{SoC}_{\max}$$
   Default bounds: $\text{SoC}_{\min} = 15.0\%$, $\text{SoC}_{\max} = 95.0\%$. Charging is locked when $\text{SoC} \ge \text{SoC}_{\max}$; discharging is prohibited when $\text{SoC} \le \text{SoC}_{\min}$.
2. **Backup Reserve Preservation**:
   When the user selects the `PRESERVE_BACKUP_RESERVE` goal, the effective discharge floor is elevated to $\text{SoC}_{\text{reserve}}$ (e.g., 25% or 40%). Discharging below this threshold is prohibited even during severe grid outages or high tariffs.
3. **Non-Contradictory Battery Command Guarantee**:
   $$P_{\text{chg}} \cdot P_{\text{dis}} \equiv 0$$
   Simultaneous charging and discharging commands are mathematically impossible.
4. **Power Clamping**:
   $$0 \le P_{\text{chg}} \le \min\left(P_{\text{chg\_max}},\, \frac{(\text{SoC}_{\max} - \text{SoC}_t) \cdot C_{\text{batt}}}{\Delta t}\right)$$
   $$0 \le P_{\text{dis}} \le \min\left(P_{\text{dis\_max}},\, \frac{(\text{SoC}_t - \text{SoC}_{\text{floor}}) \cdot C_{\text{batt}}}{\Delta t}\right)$$

---

### 4. Phase 7 Reproducible Benchmark Verification

The system provides a built-in reproducible benchmark model matching all specifications of the Phase 7 benchmark:

- **Solar Array Capacity**: 5.0 kWp
- **Battery Storage**: 10.0 kWh LiFePO4
- **Initial Battery SoC**: 60.0%
- **Current Solar Generation**: 4.0 kW
- **Current Household Load**: 1.5 kW
- **Gross Solar Surplus**: $4.0 - 1.5 = 2.5\text{ kW}$
- **DISCOM Buy Tariff**: ₹8.00 / kWh
- **DISCOM Export Tariff**: ₹3.00 / kWh

#### Dispatch Actions:
1. **Direct Solar Self-Consumption**: 1.50 kW powers household base load directly.
2. **Surplus Evaluation**: Remaining 2.50 kW is available.
3. **Battery Charging**: At 60% SoC, the battery has $(0.95 - 0.60) \times 10\text{ kWh} = 3.5\text{ kWh}$ headroom. Max charge power is 3.5 kW. The entire 2.50 kW surplus is safely absorbed into the battery.
4. **End-of-Interval SoC**: Battery SoC rises from 60.0% to 83.8% (with 95% charge efficiency).
5. **Grid Import / Export**: Grid import = 0.0 kW, Grid export = 0.0 kW.
6. **Net Cost**: ₹0.00 (100% self-sufficient).
7. **First Law Invariant Error**: $\Delta E = 0.00000\text{ kW}$ (`BALANCED [PASSED]`).

#### Scenario What-If Responses:
- **Battery Reaches Full Capacity (95% SoC)**: Battery charging is locked (`P_chg = 0`). Surplus flows to Tier 2 (Flexible Appliances: washing machine 1.0 kW + water heater 1.5 kW = 2.5 kW). Any remaining surplus is exported to the grid at ₹3/kWh.
- **Solar Generation Drops Below Load (Cloudy / Night)**: Inverter generates 1.0 kW, household consumes 3.5 kW ($2.5\text{ kW}$ deficit). The battery discharges up to $2.5\text{ kW}$ (assuming $\text{SoC} > \text{SoC}_{\text{floor}}$), averting expensive grid imports at ₹8/kWh.
- **Tariff Changes**: If import prices surge to ₹12/kWh (peak hours), the engine prioritizes self-consumption and battery peak-shaving, saving ₹12/kWh displaced.
- **Goal Switching**: Under `PRESERVE_BACKUP_RESERVE`, battery discharge is clamped at the configured reserve floor (e.g., 25% or 40%), reserving emergency power for grid outages.

---

### 5. Phase 8 Community Integration & $I^2R$ Line Loss

For homes that choose to participate in community energy sharing:
- Surplus power is matched with local neighboring deficits (e.g., ₹5.50/kWh mid-market clearing price, benefiting both the seller who would only get ₹3.00/kWh from DISCOM and the buyer who would pay ₹8.00/kWh to DISCOM).
- Feeder physical line resistance $R$ is modeled:
  $$I = \frac{P_{\text{transfer}}}{V_{\text{feeder}}}$$
  $$P_{\text{loss}} = I^2 \cdot R = \left(\frac{P_{\text{transfer}}}{V}\right)^2 \cdot R$$
- **Virtual Net Metering**: Delivered energy to the buyer accounts for copper line losses; billed units reflect exact delivered energy, completely eliminating double-counting.
- **Opt-Out Independence**: Homes that disable community sharing operate with total isolation.

---

### 6. Automated Test Suite Evidence

All 14 comprehensive platform test suites in `tests/avishkar_ems/test_home_platform.py` pass cleanly in 0.18s:
1. `test_home_energy_balance_conservation` - PASSED (First law energy balance $\Delta E < 10^{-4}$ kW).
2. `test_solar_surplus_and_deficit_detection` - PASSED (Surplus/deficit classification).
3. `test_battery_soc_protective_bounds` - PASSED (Min/max SoC locks).
4. `test_battery_power_limits_and_no_contradictory_commands` - PASSED ($P_{\text{chg}} \cdot P_{\text{dis}} \equiv 0$).
5. `test_grid_import_and_export_calculations` - PASSED (Tariff calculations & net exchange).
6. `test_efficiency_losses_accounting` - PASSED (Sandia inverter & battery roundtrip loss modeling).
7. `test_missing_and_stale_telemetry_handling` - PASSED (Incomplete data identification).
8. `test_tariff_and_config_validation` - PASSED (Strict boundary and unit validation).
9. `test_user_optimization_goals` - PASSED (4 optimization goals verified).
10. `test_flexible_load_scheduling` - PASSED (Priority appliance dispatch).
11. `test_ev_charging_constraints` - PASSED (EV SoC targets & solar-only preferences).
12. `test_standalone_home_without_community_enrollment` - PASSED (100% standalone isolation).
13. `test_community_sharing_opt_in_with_line_loss` - PASSED ($I^2R$ copper feeder losses).
14. `test_phase_7_reproducible_benchmark` - PASSED (Exact Phase 7 benchmark verification).

**Full Regression Suite**:
- Total tests executed: 555
- Passed: 554
- Skipped: 1 (optional hardware dependency)
- Failed: 0
- Ruff linting checks: Passed (0 errors with `--no-fix`).
