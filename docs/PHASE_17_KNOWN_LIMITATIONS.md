# Phase 17: Known Limitations & Model Boundaries

## 1. Physical Simulation Boundaries

1. **No AC Power-Flow or Transient Dynamics**:
   - The regional energy-balance digital twin (`twin_ka_macro_grid`) models aggregate monthly kilowatt-hours and peak simultaneous demand.
   - It is **not** an alternating current (AC) power-flow, bus admittance, voltage stability, or frequency response simulator.
   - Transmission congestion, locational marginal pricing, and N-1 contingency analysis are outside the supported scope.

2. **Solar PV Irradiance Modeling**:
   - Monthly solar generation calculations use mean regional insolation ($4.8\text{ kWh/m}^2/\text{day}$ in Bengaluru, $5.0\text{ kWh/m}^2/\text{day}$ in Visakhapatnam) with a static Performance Ratio ($PR=0.75$).
   - Real-world cloud transients, localized micro-climates, and snow/heavy dust deposition are not dynamically simulated.

3. **Sub-Metered Appliance Dissociation**:
   - Appliance rescheduling models assume user-reported nameplate wattage and duty cycles.
   - Without physical CT clamps or sub-metered smart plugs on individual circuits, appliance breakdowns cannot be validated as empirical sensor observations.

---

## 2. Regulatory & Financial Boundaries

1. **Unmodeled Utility Surcharges**:
   - Calculations use official base retail supply tariff orders published by KERC and APERC.
   - Variable monthly adjustments—including Fuel Adjustment Charges (FAC / FPPCA), delayed payment surcharges, cross-subsidy surcharges, and municipal cess—are excluded unless explicitly reported on billing statements.

2. **Subsidies & Central Financial Assistance (CFA)**:
   - Solar installation capital costs and PM Surya Ghar subsidies are modeled parametrically in Tab 11, but are not guaranteed as automatic deductions on the monthly DISCOM billing statement until formal utility interconnection approval.

---

## 3. Computational Safeguards

1. **Bounded Parameter Sweeps**:
   - Sensitivity sweeps are strictly capped at $50$ steps (`MAX_SENSITIVITY_STEPS = 50`) to prevent computational resource exhaustion.

2. **Tenant Data Isolation**:
   - Digital twins representing private households cannot be simulated, viewed, or compared by foreign user principals. Client attempts to forge `property_id` or `twin_id` are halted at the server-side authorization perimeter.
