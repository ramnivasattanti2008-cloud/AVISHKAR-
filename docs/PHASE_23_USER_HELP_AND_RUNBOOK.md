# UrjaSetu EMS — Phase 23: User Help Guide & Operational Runbook

**Document Version:** 1.0.0  
**Phase:** 23 — Accessibility, Usability & Operational Support  
**Scope:** Step-by-Step User Instructions, Navigation Guidance & Self-Service Support  

---

## 1. Getting Started & Property Registration

1. **Sign In**: Navigate to `/login` and authenticate with your registered email and password.
2. **Select or Register a Property**:
   - Go to `/map` or `/properties` to view your registered locations.
   - Click **Add Property** to enter your address, state (Karnataka, Andhra Pradesh, Tamil Nadu, Gujarat, Maharashtra, Rajasthan, Uttar Pradesh), utility provider (e.g., BESCOM), and sanctioned load (kW).
3. **Inspect the Energy Twin**: Once registered, UrjaSetu automatically seeds an Energy Twin combining your location's solar insolation (NASA/Open-Meteo) and baseline consumption.

---

## 2. Importing Electricity Bills & Meter Readings

1. Navigate to **🏡 10. Household Monitoring** (or `/properties/{id}`).
2. Click **Upload Utility Statement**.
3. Select an official PDF, scanned invoice, or CSV meter log.
4. Verify the parsed fields:
   - Billing Month & Year (e.g., `2026-03`).
   - Units Consumed (kWh).
   - Sanctioned Connected Load (kW).
   - Total Billed Amount (₹ INR).
5. Click **Confirm Ingestion**. The system cryptographically hashes the file to prevent duplicate imports and flags records as `IMPORTED`.

---

## 3. Auditing & Reconciling Your Electricity Bill

1. Navigate to **⚡ 18. Electricity Market Intelligence & Tariff Engine**.
2. Select your state, utility provider, and consumer tariff schedule (e.g., `KA_BESCOM_LT2A_2024`).
3. Enter your monthly consumption (kWh) and sanctioned load (kW).
4. Inspect the **Reconstructed Estimate**:
   - Fixed Demand Charge.
   - Telescopic Slab Energy Charges.
   - Fuel Adjustment Charges (FPPCA).
   - State Electricity Tax & Duty.
   - Solar Export Credit (if net-metered).
5. Compare against your physical invoice:
   - If values match within $\pm 0.5\%$, status reads `✅ Validated (Reconciled)`.
   - If a discrepancy exists, status reads `⚠️ Variance Detected` with clear breakdown explaining potential causes (meter rent, retrospective FPPCA true-ups).

---

## 4. Interpreting Energy Recommendations

1. Navigate to **💡 11. Energy Optimization & Recommendations**.
2. Review prioritized actionable recommendations:
   - **Rooftop Solar PV Addition**: Recommended sizing (kWp), estimated annual generation, and statutory PM Surya Ghar CFA subsidy grant (up to ₹78,000).
   - **Appliance Schedule Shift**: Shifting heavy appliances (water heaters, EV chargers) from peak hours (18:00–22:00) to off-peak hours.
   - **Tariff Plan Switch**: Comparing alternative eligible schedules.
3. **Anti-Double-Counting**: Notice that the total savings displayed are sequential marginal estimates, guaranteeing that projected savings never exceed your total annual bill.

---

## 5. Running What-If Digital Twin Simulations

1. Navigate to **🔮 15. Energy Digital Twin & What-If Simulator**.
2. Select your calibrated prosumer twin (e.g. `twin_blr_bescom_01`).
3. Choose an intervention model:
   - `SOLAR_PV_ADDITION`: Enter solar array capacity ($0.1–50.0\text{ kWp}$).
   - `BATTERY_STORAGE_ARBITRAGE`: Enter battery capacity ($0.5–100.0\text{ kWh}$).
   - `CONSUMPTION_REDUCTION`: Enter curtailment percentage ($1–50\%$).
4. Click **Run Deterministic Simulation**.
5. Inspect the simulated outcomes:
   - Simulated monthly bill vs baseline bill.
   - Net monthly financial savings.
   - Avoided carbon emissions (grounded in CEA factor $0.716\text{ kg CO}_2/\text{kWh}$).
   - Full mathematical calculation lineage.

---

## 6. Asking the AI Energy Copilot

1. Navigate to **🤖 14. AI Energy Copilot & Evidence Assistant** (or the persistent Copilot panel).
2. Enter your question in natural language (e.g., *"How much solar subsidy am I eligible for with a 3 kW system?"* or *"Compare BESCOM LT-2a vs LT-3a"*).
3. Review the Copilot's response:
   - Includes atomic citations (`EVID-014`).
   - Directly links to the official gazetted tariff order or policy source.
   - Note: The Copilot will refuse to perform ungrounded mental math or access private properties you do not own.

---

## 7. Troubleshooting & Submitting Support Requests

If an operation fails:
1. Note the **Error Code** (e.g., `ERR_SIMULATION_BOUNDARY_EXCEEDED`).
2. Copy the **Support Reference ID** (e.g., `corr_9f8a12e4b7`).
3. Follow the suggested remediation action shown in the error box.
4. If the issue persists, submit a support inquiry citing your correlation ID. Support engineers will look up the scrubbed telemetry logs to assist you without asking for passwords.
