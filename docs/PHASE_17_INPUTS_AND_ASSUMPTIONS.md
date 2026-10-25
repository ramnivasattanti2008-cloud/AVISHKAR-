# Phase 17: Inputs, Assumptions & Data Origin Mapping

## 1. Data Origin Taxonomy

To prevent simulation outputs from being confused with real-world observations, UrjaSetu EMS enforces the `DataOrigin` taxonomy across all inputs and outputs:

| Origin Tier | Definition | Examples in Engine |
|---|---|---|
| `MEASURED` | Sourced directly from physical utility meters or certified smart-meter intervals. | `baseline_consumption_kwh`, `peak_demand_kw` |
| `IMPORTED` | Parsed from official statutory billing statements issued by DISCOMs. | `sanctioned_load_kw`, `baseline_bill_inr`, `tariff_schedule_id` |
| `USER_SUPPLIED` | Explicit parameters provided by the authenticated tenant. | `solar_capacity_kwp`, `reduction_pct`, `appliance_power_w` |
| `ASSUMED` | Standard engineering heuristics grounded in regional technical literature. | Solar $PR = 0.75$, AC Duty Cycle $= 0.70$, Month Length $= 30\text{ days}$ |
| `DERIVED` | Deterministically calculated by domain physics or tariff schedules. | `simulated_bill_inr`, `net_cost_savings_inr`, `co2_avoided_kg` |

---

## 2. Input Parameter Validation Ranges

All parameters submitted via API, UI, or AI Copilot are strictly validated against physical bounds:

| Parameter | Unit | Min Valid | Max Valid | Default | Error on Violation |
|---|---|---|---|---|---|
| `reduction_pct` | `%` | 0.0 | 100.0 | 15.0 | `ValueError: must be between 0.0% and 100.0%` |
| `reduction_kwh` | `kWh` | 0.0 | $E_{\text{baseline}}$ | N/A | `ValueError: must be non-negative` |
| `solar_capacity_kwp` | `kWp` | 0.0 | 100.0 | 3.0 | `ValueError: must be between 0.0 and 100.0 kWp` |
| `performance_ratio` | `ratio` | 0.40 | 0.95 | 0.75 | `ValueError: performance ratio must be in range` |
| `daily_insolation_kwh_m2`| `kWh/m²/day` | 1.0 | 10.0 | 4.8 (KA) / 5.0 (AP) | `ValueError: Daily insolation must be in range` |
| `self_consumption_pct` | `%` | 0.0 | 100.0 | 65.0 | `ValueError: must be between 0.0% and 100.0%` |
| `appliance_power_w` | `W` | 10.0 | 25,000.0 | 1500.0 | `ValueError: must be between 10 W and 25,000 W` |
| `daily_operating_hours` | `hours` | 0.0 | 24.0 | 8.0 | `ValueError: must be between 0 and 24 hours` |

---

## 3. Disclosed Model Assumptions

Every simulation result includes an explicit `assumptions` list returned in its metadata:
1. **Weather Invariance**: Monthly solar generation assumes average daily insolation without stochastic cloud transients.
2. **Coincident Peak Diversification**: Energy reductions yield a diversified peak load drop of $40\%$ of the energy reduction percentage.
3. **Net Metering Settlement**: Solar exports are credited at the approved SERC net-metering feed-in tariff (BESCOM ₹3.10/kWh, APEPDCL ₹2.50/kWh).
4. **Billing Slabs**: Slab boundaries are evaluated on gross imported energy, matching official DISCOM calculation rules.
