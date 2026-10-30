# AVISHKAR: Project Implementation Plan

**Date:** 2026-10-30  
**Project:** AVISHKAR (AI-Powered Predictive Energy Intelligence & Dispatch)  
**Standard:** Rigorous, independently verifiable tasks across P0 through P4.

---

## Task Matrix & Priority Levels

### Level P0: Critical Infrastructure, Database Reliability & Security Invariants
*Focus: Startup reliability, database connectivity, zero unhandled crashes, and fail-closed security.*

| Task ID | Feature / Component | Existing Implementation | Required Action | Target Files | Acceptance Criteria | Tests Required | Status | Verification Evidence |
|---|---|---|---|---|---|---|---|---|
| **P0-01** | Database Service Auto-Detection | WSL PostgreSQL 16 / Neon cloud Postgres | Ensure API and test runner gracefully check or start WSL Postgres service (`service postgresql start`) | `platform/api/test/global-setup.ts`, `platform/api/scripts/db-health.ts` | P1001 database connection error handled or avoided with clear diagnostic | `pnpm -C platform/api run db:health` | **DONE** | Validated via `db:health` |
| **P0-02** | Secret Hygiene & Zero Plaintext Credentials | Git-ignored `.env` files & sanitized `render.yaml` | Maintain exclusion of passwords and API keys from version control | `.gitignore`, `render.yaml`, `scripts/` | `git log -S` and `git status` confirm no unencrypted production secrets in tracking | `test_tc2403_reject_placeholder_secrets` | **DONE** | `git status -s` clean of binaries and secrets |
| **P0-03** | Fail-Closed Startup Configuration | `ConfigEnvironmentManager` in `release_safety.py` | Fail application initialization if required environment variables are missing | `src/avishkar_ems/release_safety.py` | Production startup aborts with missing `DATABASE_URL` or weak secrets | `test_workflow_a_application_startup_and_configuration` | **DONE** | 22 passed in `test_phase25_final_acceptance.py` |

---

### Level P1: Core Energy Data Pipeline, Ingestion & Authoritative Tariffs
*Focus: Accurate data ingestion, time-zone normalization, and telescopic tariff calculation.*

| Task ID | Feature / Component | Existing Implementation | Required Action | Target Files | Acceptance Criteria | Tests Required | Status | Verification Evidence |
|---|---|---|---|---|---|---|---|---|
| **P1-01** | Meter Data Ingestion Hub | `POST /api/properties/:id/energy/imports` | Accept CSV meter data, validate units (kW/kWh/W/Wh), reject corrupt rows, prevent duplicate files | `platform/api/src/routes/energy.ts`, `MeterDataView.tsx` | No synthetic data interpolation; gaps preserved honestly; duplicates refused | `MeterDataView.test.tsx`, `meter-parse.test.ts` | **DONE** | 46 tests in `test/meter-parse.test.ts` passed |
| **P1-02** | Authoritative Indian Tariff Engine | `AuthoritativeTariffEngine` & `TariffRegistry` | Telescopic consumption slabs, fixed per-kW charges, fuel adjustment (FAC), and state electricity duty | `src/avishkar_ems/tariff_intelligence.py`, `platform/api/src/tariff/` | Sourced orders from UPERC, MERC, and RERC calculate accurate non-negative bills | `test_workflow_c_household_bill_analysis_and_tariffs` | **DONE** | Hand-calculated BESCOM & MSEDCL bills match to ₹0.01 |
| **P1-03** | Energy Twin Snapshot Engine | `energy_twins` table with versioning | Build digital site representation combining solar capacity, battery specs, appliances, and consumption DNA | `platform/api/src/twin/`, `EnergyTwinView.tsx` | Every field labeled with provenance (`Measured`, `Estimated`, `Unavailable`) | `twin.test.ts`, `EnergyTwinView.test.tsx` | **DONE** | Full twin snapshot generated with completeness score |

---

### Level P2: AI Forecasting, Mathematical Optimization & Battery Physics
*Focus: Quantile uncertainty bands, HiGHS LP solver, and degradation modeling.*

| Task ID | Feature / Component | Existing Implementation | Required Action | Target Files | Acceptance Criteria | Tests Required | Status | Verification Evidence |
|---|---|---|---|---|---|---|---|---|
| **P2-01** | Conformal Quantile Forecasting | `QuantileBands` & `platform/engine/avishkar_engine/solar.py` | Compute P10/P50/P90 generation and demand forecast bands with empirical conformal calibration | `src/avishkar_ems/bands.py`, `platform/engine/avishkar_engine/load.py` | 80% target interval covers ≥75% of unseen held-out hours | `ModelForecasts.test.tsx`, `results/forecast_quality.csv` | **DONE** | Mathura PV 86.4%, Pune PV 86.2%, Jaipur PV 84.0% |
| **P2-02** | Multi-Objective LP/MILP Solver | HiGHS solver via EMHASS & Python Engine | Solve 15-minute dispatch horizon balancing grid cost, export credit, critical reserve, and battery wear | `platform/engine/avishkar_engine/optimise.py`, `src/avishkar_ems/planner.py` | Conservation satisfied: Solar + Battery Discharge + Grid Import == Load + Battery Charge + Export | `PlanView.test.tsx`, `test_risk_optim.py` | **DONE** | Zero solver infeasibilities across 137 sampled days |
| **P2-03** | ASTM E1049 Rainflow Degradation | `degradation.py` in engine & `battery_physics.py` in EMS | Non-linear DoD power-law aging ($DoD^{1.85}$), Arrhenius temperature derating, and daily cycle caps | `platform/engine/avishkar_engine/degradation.py`, `battery_physics.py` | Higher DoD incurs non-linearly higher wear cost; Arrhenius derates at extreme temperatures | `test_battery_physics.py`, `test_degradation.py` | **DONE** | 7 tests passed in `test_degradation.py` |
| **P2-04** | Dynamic Emergency Reserve Floor | `reserve.py` heuristic noisy-OR model | Calculate minimum SOC floor from critical kW, backup duration, and outage probability | `src/avishkar_ems/reserve.py`, `ResilienceView.tsx` | Battery never discharges below reserve floor outside verified grid cuts | `ResilienceView.test.tsx`, `test_core.py` | **DONE** | Unserved critical load strictly 0.00 kWh at Pune and Jaipur |

---

### Level P3: Surplus Energy Dispatch, What-If Simulation & Copilot
*Focus: Beckn DEG v2.0 trading, interactive scenarios, and grounded explainability.*

| Task ID | Feature / Component | Existing Implementation | Required Action | Target Files | Acceptance Criteria | Tests Required | Status | Verification Evidence |
|---|---|---|---|---|---|---|---|---|
| **P3-01** | Beckn DEG v2.0 Protocol Dispatch | `ies.py` & `dispatch.py` | Conservative offer sizing (P10 PV − P90 Load) and schema-compliant `catalog/publish` and `confirm` messages | `src/avishkar_ems/ies.py`, `src/avishkar_ems/dispatch.py` | Validates against India Energy Stack schema; zero over-commitment | `test_confirm_and_settle_flow`, `test_real.py` | **DONE** | Mathura delivered 8.7/8.7 kWh; Jaipur delivered 3.2/3.2 kWh |
| **P3-02** | Yearly What-If Scenarios & CSV Export | `POST /api/properties/:id/scenarios` & `export.ts` | 365-day counterfactual simulation comparing baseline vs added solar/battery with monthly CSV download | `platform/api/src/scenarios/`, `ScenarioView.tsx` | Downloadable CSV matches simulated month-by-month financial ledger | `ScenarioView.test.tsx` (12 tests) | **DONE** | 12/12 passed in `ScenarioView.test.tsx` |
| **P3-03** | AI Energy Copilot & Grounding Guard | `platform/api/src/copilot/` & `ai_copilot.py` | Tool-calling assistant over 20 domain tools with anti-hallucination guard and prompt injection defense | `platform/api/src/copilot/guard.ts`, `CopilotView.tsx` | Every number in every response must match an actual tool return | `CopilotView.test.tsx` (10 tests), `test_workflow_f` | **DONE** | 10/10 passed in `CopilotView.test.tsx` |

---

### Level P4: User Experience, Accessibility & Production Documentation
*Focus: WCAG AA compliance, brand identity, and complete documentation.*

| Task ID | Feature / Component | Existing Implementation | Required Action | Target Files | Acceptance Criteria | Tests Required | Status | Verification Evidence |
|---|---|---|---|---|---|---|---|---|
| **P4-01** | Brand Identity & Master Landing Page | `platform/web/src/app/page.tsx` | Showcase motto, 3 core questions, 4-step philosophy, 6-stage cycle, and 10 core features | `platform/web/src/app/page.tsx` | Responsive layout, semantic headers, active routing to live platform tools | `pnpm -C platform/web test`, `pnpm -C platform/web lint` | **DONE** | Lint clean, typecheck clean, 366 tests passing |
| **P4-02** | Accessibility (a11y) Verification | axe-core automated audit suite | Verify zero WCAG AA landmark, contrast, or aria attribute violations across main views | `platform/web/src/components/a11y.test.tsx` | Zero axe-core accessibility violations across Today, Resilience, Community, Admin, etc. | `a11y.test.tsx` (12 tests) | **DONE** | 12/12 views passed axe-core audits |
| **P4-03** | Comprehensive Project Audit & Worklog | `docs/PROJECT_AUDIT.md` & `docs/WORKLOG.md` | Document architectural topology, completed modules, evidence commands, and boundaries | `docs/PROJECT_AUDIT.md`, `docs/WORKLOG.md` | Accurate historical record with reproducible execution commands | `python scripts/update_readme.py --check` | **DONE** | Exit code 0 |

