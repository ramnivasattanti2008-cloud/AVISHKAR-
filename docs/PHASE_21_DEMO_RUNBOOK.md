# Phase 21: Demonstration Runbook & Verification Guide
**UrjaSetu Energy Management & Intelligence System**
*Evaluation Date: October 24, 2026 | Technical Acceptance Owner & Demo Lead*

---

## 1. Demo Overview & Prerequisites

This runbook guides evaluators and stakeholders through an end-to-end interactive demonstration of UrjaSetu EMS. Every demonstrated capability runs on genuine local data or verified deterministic simulation models.

### Prerequisites
- Active virtual environment with dependencies installed.
- Terminal session in workspace root `c:\Users\Ram Nivas\projects\AVISHKAR-`.
- Web browser (Chrome, Edge, Firefox, or Safari).

### Launch Command
```bash
streamlit run app/dashboard.py
```
Open `http://localhost:8501`. Ensure the header displays:
`UrjaSetu EMS — National & Prosumer Energy Intelligence Platform`.

---

## 2. Step-by-Step Tab Exploration Walkthrough

### Part 1: National & State Energy Intelligence (Tabs 1–10)

#### Tab 1: Verified Public Connectors
- **Action**: Inspect registered data sources in the data provider table.
- **Verification**: CEA Monthly Power Supply Position, CEA Renewable Generation, and National Power Portal daily dashboards are displayed with provider URLs and GODL-India open data licenses.
- **Key Observation**: Connection statuses explicitly state `DATA_INGESTED` with last verification dates.

#### Tab 2: Dataset Provenance & Data Quality
- **Action**: Review ingestion audit logs and unit checks.
- **Verification**: Observations show SHA-256 fingerprints and run IDs. Note the strict validation ensuring `MU` (energy) and `MW` (power) are never combined.

#### Tab 3: Energy Command Center
- **Action**: Select `All India` or `Karnataka` and choose period `2024-04`.
- **Verification**: KPI cards display Energy Requirement (MU), Energy Supplied (MU), and Peak Demand Met (MW).
- **Key Observation**: The national balance shows an energy gap of less than 0.5%, reflecting real CEA dispatch accounting.

#### Tab 4: Energy Balance & Deficit Accounting
- **Action**: Review the regional balance flow and deficit explanation.
- **Verification**: The system clearly distinguishes physical generation capacity from actual generated units.

#### Tab 5: Generation Mix & Decarbonization
- **Action**: Inspect the fuel breakdown chart (Thermal, Hydro, Nuclear, Renewable).
- **Verification**: CEA statutory classification is respected (Large Hydro is categorized per CEA guidelines with explanatory notes).

#### Tab 6: Solar & Meteorological Intel
- **Action**: Explore monthly solar insolation benchmarks and rooftop yield estimates.
- **Verification**: Yield models reflect NASA POWER insolation indices (4.8 kWh/m²/day) with temperature degradation coefficients.

#### Tab 7: Geographic Explorer & Boundary Integrity
- **Action**: Attempt to look up district-level peak demand for `Bengaluru Urban`.
- **Verification**: The UI displays `UNAVAILABLE` with an Anti-Disaggregation warning explaining that CEA reports state totals and cannot be downscaled without physical meters.

#### Tab 8: Time-Series Trends & Seasonality
- **Action**: Review historical 24-month consumption and generation curves.
- **Verification**: Clear summer demand peaks (March-May) and monsoon hydroelectric surges are visible.

#### Tab 9: Predictive Forecasting & Anomaly Audit
- **Action**: Inspect the 3-month forward demand projection and anomaly scatter plot.
- **Verification**: Forecast curves include 95% confidence bounds; anomalies are flagged with rolling MAD deviation scores.

#### Tab 10: Data-Source Health Center
- **Action**: Check system liveness and connector freshness.
- **Verification**: System status shows `UP` (Process ID active); report files verified `READY`. Reporting lags (45-60 days) are honestly labeled `HISTORICAL_SERIES`.

---

### Part 2: Prosumer Household Intelligence (Tabs 11, 15, 17, 18)

#### Tab 11: Energy Efficiency Recommendations
- **Action**: Inspect the ranked recommendations for `Indiranagar Residence`.
- **Verification**: Recommendations display multi-factor priority scores, BEE thermodynamic setpoint rules (6% savings per °C), and anti-double-counting marginal breakdowns.

#### Tab 15: Energy Digital Twin & Scenarios
- **Action**: Simulate adding 3 kWp rooftop solar PV to the Indiranagar residence.
- **Verification**: A prominent `WHAT-IF SIMULATION` banner appears. The model displays simulated solar generation (~360 kWh/month) and estimated monthly bill savings (~₹2,100).
- **Key Observation**: Parameter lineages explicitly disclose that insolation is modeled at 4.8 kWh/m²/day.

#### Tab 17: Energy Policy Intelligence
- **Action**: Check PM Surya Ghar CFA subsidy eligibility for the Indiranagar property.
- **Verification**: The engine recommends 3 kWp capacity and calculates an exact statutory CFA subsidy of ₹78,000 with a CO2 mitigation estimate using CEA factor (0.716 kg CO2/kWh).

#### Tab 18: Electricity Market Intelligence & Tariff Comparison
- **Action**: Review the bill calculation for 250 kWh under BESCOM LT-2(a).
- **Verification**: Reconstructs fixed demand charges (₹280), tiered energy charges (₹1,525), FAC (₹55), and tax (₹137.25), reconciling to ₹1,842.25 net payable.
- **Key Observation**: The statement is explicitly watermarked as a mathematical estimate (`is_official_bill = False`).

---

### Part 3: AI Copilot & Transparency (Tabs 13, 14, 16, 19)

#### Tab 13: Citizen Energy Transparency Portal
- **Action**: Submit a citizen report (e.g. streetlights on during daytime) and review the public feed.
- **Verification**: The submission enters the intake queue in `SUBMITTED` state. Door numbers are blocked to protect privacy.
- **Moderator Flow**: Switch role to `ADMIN` and transition report from `SUBMITTED` to `UNDER_REVIEW`.

#### Tab 14: AI Energy Copilot
- **Action**: Submit the query: `"What is the Central Financial Assistance subsidy under PM Surya Ghar for a 3 kW solar system?"`
- **Verification**: The copilot responds citing PM Surya Ghar ₹78,000 CFA with attached evidence bundle `[EVID-012]`.
- **Security Check**: Ask for another user's bill records. The copilot responds with `Access Denied` and logs an authorization refusal.

#### Tab 16: Real-Time Event & Alert Monitoring
- **Action**: Inspect the active alerts table.
- **Verification**: Alerts show severity, occurrence counts, and suppression status. Acknowledge an open alert and observe the lifecycle transition to `ACKNOWLEDGED`.

#### Tab 19: Automated Export & Regulatory Audit
- **Action**: Click `Export Executive Report (CSV)`.
- **Verification**: The downloaded CSV includes provenance citations and all leading formula characters (`=, +, -, @`) are sanitized with single-quote escaping.

---

## 3. Recovery Procedures & Troubleshooting

| Symptom | Root Cause | Recovery Procedure |
|:---|:---|:---|
| Streamlit port 8501 already in use | Previous instance running | Run `streamlit run app/dashboard.py --server.port 8502`. |
| "Household Property Not Found" | Inactive profile ID | Select `Indiranagar Residence (BESCOM)` from household dropdown. |
| AI Copilot returns deterministic text | No LLM API key configured | Normal expected behavior; internal Python domain engine calculates answers safely. |
| District Peak Demand shows "UNAVAILABLE" | Strict boundary invariant | Normal expected behavior; state balances cannot be disaggregated to districts. |
