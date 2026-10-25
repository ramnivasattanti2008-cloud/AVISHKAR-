# UrjaSetu EMS — Phase 22: Independent Validation Plan

**Document Version:** 1.0.0  
**Phase:** 22 — Independent Validation, Real-World Pilot & Reliability Assessment  
**Author:** Independent Validation Lead & Quantitative Verification Team  
**Status:** APPROVED FOR CONTROLLED PILOT  

---

## 1. Executive Summary & Purpose

This Independent Validation Plan defines the scope, methodologies, boundary conditions, and acceptance criteria required to assess whether **UrjaSetu Energy Management System (EMS)** is mathematically rigorous, physically consistent, architecturally secure, and resilient enough for a strictly controlled, opt-in residential pilot.

Rather than relying on developer-authored assertions or self-referential test claims, this phase establishes **independent reference implementations** derived from first-principles engineering mathematics, statutory electricity tariff orders, and physical conservation laws.

---

## 2. Mandatory Rules of Independence & Engagement

1. **First-Principles Reference Implementation**: Under no circumstances shall application calculation functions be used as their own validation reference. All validation cases are independently computed using standalone Python functions and external analytical formulas.
2. **Data Honesty & Grounded Provenance**: Never present simulated, synthetic, or estimated telemetry as real or live. Every data point must carry explicit provenance labels (`MEASURED`, `IMPORTED`, `DERIVED`, `USER_SUPPLIED`, `ASSUMED`).
3. **No Fabricated Pilot Data or Accreditations**: UrjaSetu does not claim formal third-party regulatory certification, ISO accreditation, or official utility endorsement. All capabilities are evaluated solely on observed software behavior.
4. **Defensive Multi-Tenant Isolation**: Rigorously test multi-tenant boundaries (IDOR, profile updates, utility bill inspections, digital twin scenario execution) to guarantee tenant isolation across jurisdictions.
5. **Non-Destructive Testing**: All failure-injection tests are executed in isolated in-memory sandboxes and test fixtures. No network stress tests or destructive operations are conducted on production systems.

---

## 3. Multi-Agent Validation Strategy & Matrix

| Role | Scope & Assessment Vector | Independent Methodology | Success Criteria |
| :--- | :--- | :--- | :--- |
| **Agent A — Numerical Verification** | Telescopic slab tariffs, ToU load shifting, battery degradation, solar CFA subsidies, carbon factors. | Standalone re-implementations of KERC, APERC, TNERC tariff orders; ASTM E1049 Rainflow cycle counting; CEA v19 CO2 factor. | 0.00% numerical variance on financial charges; 100.0% physical energy conservation. |
| **Agent B — Data & Model Validation** | External data connectors, time-series forecasting, anomaly detection, digital twin simulations. | Chronological train/test split verification (zero lookahead); rolling MAD on stationary baselines with injected spikes; source licensing audit. | RMSE $\ge$ MAE holdout consistency; P10 $\le$ P50 $\le$ P90 ordering; zero false alarms on stationary series. |
| **Agent C — Security & Privacy** | Multi-tenant authorization, IDOR defense, file upload traversal, PII masking, bill statement privacy. | Cross-tenant API replay with mismatched IDs; malicious filename fuzzing (`../`, null bytes, script extensions). | 100% rejection of cross-tenant reads/writes with `PermissionError`; 100% traversal neutralization. |
| **Agent D — Reliability & Pilot Readiness** | Failure injection, graceful degradation, health observability, controlled pilot operational protocol. | Injected `KeyError`, corrupted records, non-existent entity lookups; `DataSourceHealthCenter` liveness/readiness audit. | Safe structured exception handling without crash; 0 failed connectors in production registry. |

---

## 4. Validation Scope & Explicit Exclusions

### In-Scope Capabilities
- Residential LT domestic tariff calculation for BESCOM (Karnataka) and APEPDCL (Andhra Pradesh).
- Diurnal load shifting and physical energy conservation across 24-hour dispatch schedules.
- Lithium-ion battery cycle counting (ASTM E1049) and non-linear depth-of-discharge (DoD) degradation modeling.
- Time-series macro forecasting with chronological holdout validation.
- Rolling window Median Absolute Deviation (MAD) anomaly detection.
- Marginal sequential recommendation savings avoiding double-counting.
- CEA CO2 emission reductions grounded in Baseline Database v19 (0.716 kg CO2/kWh).
- Multi-tenant IDOR protection and secure document upload sanitization.

### Explicit Out-of-Scope Exclusions
- High-voltage industrial/commercial ToU HT tariffs (>66 kV).
- Real-time frequency regulation and sub-second grid balancing.
- Automated utility billing dispute filing or legal representation before electricity regulatory commissions.
- Direct hardware battery management system (BMS) flashing or inverter firmware mutation.

---

## 5. Verification Schedule & Deliverables

1. `PHASE_22_CALCULATION_VERIFICATION.md` — Independent numerical tariff and physics verification.
2. `PHASE_22_SOURCE_VERIFICATION.md` — External data source provenance and licensing audit.
3. `PHASE_22_MODEL_VALIDATION.md` — Forecasting holdout, anomaly detection, and simulation validation.
4. `PHASE_22_SECURITY_AND_PRIVACY.md` — Multi-tenant boundary and file upload traversal defense.
5. `PHASE_22_RELIABILITY_TESTS.md` — Failure injection and graceful degradation results.
6. `PHASE_22_CONTROLLED_PILOT_PLAN.md` — Scoped 50-household residential pilot design.
7. `PHASE_22_ACCEPTANCE_EVIDENCE.md` — Concrete test execution logs and commands.
8. `PHASE_22_KNOWN_RISKS.md` — Unresolved risks, mitigation strategies, and operator controls.
