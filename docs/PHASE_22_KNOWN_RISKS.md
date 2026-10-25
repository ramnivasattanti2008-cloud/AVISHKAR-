# UrjaSetu EMS — Phase 22: Known Risks & Operational Mitigation Controls

**Document Version:** 1.0.0  
**Phase:** 22 — Independent Validation, Real-World Pilot & Reliability Assessment  
**Status:** ACTIVE RISK REGISTER  

---

## 1. Purpose of the Risk Register

This document provides a transparent, evidence-grounded assessment of residual operational risks, environmental uncertainties, and edge-case limitations identified during the Phase 22 Independent Validation of UrjaSetu EMS.

In accordance with Core Invariant 6, uncertain or unverifiable conditions are explicitly cataloged rather than masked.

---

## 2. Residual Risk Assessment & Operational Mitigations

| Risk ID | Category | Description & Operational Impact | Likelihood | Impact | Mitigation Strategy & Operational Control |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **RSK-01** | Regulatory / Tariff | **Retrospective FPPCA Fuel Surcharge Adjustments**: State ERCs periodically issue retrospective fuel surcharges (e.g., BESCOM quarterly FAC true-ups) that alter bills issued months prior. | High | Medium | Flag all bill audits where utility FPPCA diverges from current gazette with an explanatory notice: *"Fuel Adjustment Surcharge reflects historical true-up order"*. Never infer billing fraud. |
| **RSK-02** | Telemetry / Hardware | **Cellular Packet Drop on AMR Smart Meters**: Low-cost 2G/4G NB-IoT AMR modems in residential basements experience intermittent packet loss, causing missing 15-minute intervals. | Medium | Medium | Implement zero-filling detection (`Zero Drop Telemetry Check`) and linear gap-interpolation with clear data-origin labeling (`DERIVED` vs `MEASURED`). |
| **RSK-03** | Physical Invariant | **Unmetered Solar Self-Consumption**: In legacy rooftop solar systems with gross export meters only, in-house instantaneous solar self-consumption is not directly recorded by the utility meter. | High | Low | Clearly disclose in Digital Twin reports: *"Solar self-consumption is estimated based on rated array capacity and standard insolation profiles; gross grid export is verified."* |
| **RSK-04** | Data Ingestion | **DISCOM Billing Statement OCR Formatting Variances**: Scanned utility bills from different sub-divisions or billing cycle versions may have slight variations in tabular layouts. | Medium | Medium | Require user verification of parsed bill figures during the upload step. Support fallback manual entry if automatic parsing confidence falls below 95%. |
| **RSK-05** | Forecasting | **Unprecedented Extreme Weather Events**: Sudden unseasonal monsoon cloud cover or unprecedented heatwaves deviate from 30-year climatological insolation baselines. | Low | Medium | Expose explicit probabilistic confidence bands ($P_{10}$ to $P_{90}$) on all solar generation forecasts. Never present single-point forecasts as deterministic guarantees. |
| **RSK-06** | Battery Physics | **Cell Aging Beyond Rated Cycle Life**: Degradation non-linearity increases sharply when cell health falls below 70% State of Health (SoH). | Low | Low | Model applies an aggressive power-law penalty ($\alpha = 1.8$) beyond 80% DoD and displays an alert recommending physical electrochemical impedance spectroscopy (EIS). |

---

## 3. Pilot Scope Controls

To safeguard participant trust during the 50-household residential pilot (`PILOT-URJA-2026-R1`), the following operational controls are active:
1. **Mandatory Human-in-the-Loop**: UrjaSetu will never automatically alter electrical switchgear or trip smart circuit breakers without explicit user consent.
2. **Weekly Discrepancy Audits**: The Quantitative Verification Lead reviews all flagged billing variances exceeding $\pm 1.0\%$ on a weekly basis.
3. **No Financial Guarantees**: All recommendation savings include the statutory disclaimer: *"Estimated savings are derived from historical tariff models and do not constitute a guaranteed utility rebate."*
