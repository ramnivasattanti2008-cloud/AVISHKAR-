# Phase 21: Critical End-to-End Workflow Map
**UrjaSetu Energy Management & Intelligence System**
*Evaluation Date: October 24, 2026 | Technical Acceptance Owner & Integration Lead*

---

## 1. Overview of Mapped Workflows

This document traces the complete execution paths across the seven critical workflows in UrjaSetu EMS, identifying domain components, contracts, security barriers, and verification evidence for each stage.

```
       [ Public Energy Sources (CEA, NPP, MNRE) ]
                          │ (Workflow A)
                          ▼
            [ Canonical Source Registry ]
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
  [ Macro Balances (A) ]          [ Public Portal (G) ]
          │                               ▲
          │                               │ (Workflow D: Grounded Tools)
          │                               ▼
          ├─────────────────────► [ AI Energy Copilot ] ◄───────────────────┐
          │                               ▲                                 │
          ▼                               │ (Workflow D)                    │
  [ Household Module ] ─────────► [ Digital Twin (E) ]                      │
    (Workflow B)                          │                                 │
          │                               ▼                                 │
          ├─────────────────────► [ Event Monitoring (F) ]                  │
          │                                                                 │
          ▼                                                                 │
  [ Tariff Engine (C) ] ────────────────────────────────────────────────────┘
```

---

## 2. Workflow A — Public Energy Data Ingestion, Provenance & Anti-Disaggregation

| Step | Action | Implementation Component | Contract / Invariant |
|:---:|:---|:---|:---|
| **1** | Identify Authorized Source | `SourceRegistry` | Must have registered statutory URL, open data license, provider authority. |
| **2** | Retrieve / Ingest Observation | `CeaConnector`, `NppGenerationConnector` | Extract monthly energy balance (MU) and peak met (MW). |
| **3** | Validate Source & Schema | `DataQualityValidator`, `UnitValidator` | Values must be non-negative; units must match canonical dimension (`MU` for energy, `MW` for power). |
| **4** | Record Provenance & Status | `CanonicalObservation` | Assigns observation ID, SHA-256 fingerprint, source order reference, and verification timestamp. |
| **5** | Normalize Units & Timestamps | `CanonicalObservation` | Normalized to UTC ISO-8601; metrics stored in canonical base units. |
| **6** | Persist Idempotently | `IdempotentIngestionEngine` | Identical records generate `IGNORED_DUPLICATE`; new records generate `INSERTED_NEW`. |
| **7** | Feed Analytic Engines | `EnergyBalanceAnalyzer`, `GenerationMixEngine` | Supplies verified national and state balances to analytical modules. |
| **8** | Enforce Boundary Invariant | `GeoExplorer` | State totals cannot be downscaled to revenue districts (`verify_no_disaggregation()`). |
| **9** | Expose Provenance in UI | `CommandCenterService`, UI Tab 1-3 | Displays official CEA report citations and licensing terms. |
| **10** | Report Data Freshness | `DataSourceHealthCenter` | Flags reporting delays (45-60 days) as `HISTORICAL_SERIES`, never fabricated live. |

*Automated Verification*: `tests/avishkar_ems/test_phase21_integration_acceptance.py::test_tc2101_workflow_a_public_energy_data_pipeline` (PASSED).

---

## 3. Workflow B — Household Energy Analysis & Multi-Tenant Isolation

| Step | Action | Implementation Component | Contract / Invariant |
|:---:|:---|:---|:---|
| **1** | Access Household Profile | `HouseholdManager.get_home(user_id, property_id)` | Enforces server-side authentication; cross-tenant access raises `PermissionError`. |
| **2** | Validate Connection Data | `HouseholdProfile` | Connection account identifier is securely masked (`BES...1029`). |
| **3** | Parse / Import Statement | `HouseholdBillParser.extract_bill_from_text()` | Extracts units consumed, fixed charge, energy charge, net meter credit, and taxes. |
| **4** | Validate Input Filename | `sanitize_and_validate_filename()` | Restricts extensions to `.txt, .csv, .xlsx, .json`; eliminates directory traversal paths. |
| **5** | Persist Isolated Bill | `HouseholdManager.record_bill()` | Appends bill statement strictly to owner's profile; isolates data from other households. |
| **6** | Compute Consumption Summary | `HouseholdManager.get_profile()` | Calculates monthly averages, peak intervals, and seasonal variations. |
| **7** | Generate Optimization Recs | `RecommendationEngine.generate_recommendations()` | Evaluates slab clipping, sanctioned load realignment, and solar PV feasibility. |
| **8** | Anti-Double Counting | `compute_unduplicated_savings()` | Evaluates marginal savings sequentially to prevent inflated cumulative benefits. |
| **9** | Display Transparent UI | `urjasetu_view.py` (Tab 11, Tab 18) | Displays disclaimers, mathematical formulas, and underlying SERC tariff citations. |
| **10** | Prevent Unauthorized Query | `HouseholdManager`, `AICopilotService` | Rejects unauthorized bill inspection attempts with access denial logs. |

*Automated Verification*: `tests/avishkar_ems/test_phase21_integration_acceptance.py::test_tc2102_workflow_b_household_energy_analysis_and_isolation` (PASSED).

---

## 4. Workflow C — Statutory Tariff & Bill Validation Reconciliation

| Step | Action | Implementation Component | Contract / Invariant |
|:---:|:---|:---|:---|
| **1** | Select Gazetted Tariff | `TariffRegistry.get_schedule()` | Sourced from official SERC retail supply orders (e.g. BESCOM LT-2a Order S/01/24). |
| **2** | Confirm Consumer Category | `ConsumerCategory` | Restricts comparisons to statutory consumer classes (DOMESTIC, COMMERCIAL, INDUSTRIAL). |
| **3** | Check Effective Date Range | `VerifiedTariffSchedule.is_effective_on()` | Verifies tariff schedule was in effect on the statement billing date. |
| **4** | Calculate Deterministic Bill | `AuthoritativeTariffEngine.calculate_bill()` | Multi-slab telescopic charges + fixed demand + ToU + FAC + 9% state duty. |
| **5** | Enforce Non-Official Invariant| `CalculatedBillBreakdown.is_official_bill` | Strictly `False`; calculations are always labeled as mathematical estimates. |
| **6** | Reconcile with Utility Bill | `BillValidationEngine.validate_bill()` | Compares imported utility bill against calculated breakdown. |
| **7** | Diagnose Variance | `BillValidationStatus` | Reconciles exact matches (≤₹1.00) or explains fuel adjustment differences. |
| **8** | Anti-False Accusation Policy | `BillValidationResult.disclaimer` | Notes that differences reflect dynamic FAC or arrears, explicitly refusing fraud claims. |
| **9** | Multi-Tenant Bill Validation | `TariffIntelligenceService.validate_property_bill()` | Validates bill only when authorized user matches household owner. |
| **10** | ToU Load Shifting Optimization| `TimeOfUseOptimizer.evaluate_load_shift()` | Shifting load between peak and off-peak preserves strict energy conservation. |

*Automated Verification*: `tests/avishkar_ems/test_phase21_integration_acceptance.py::test_tc2103_workflow_c_tariff_and_bill_validation_reconciliation` (PASSED).

---

## 5. Workflow D — AI Energy Copilot Grounding, Evidence Bundles & Scope Refusal

| Step | Action | Implementation Component | Contract / Invariant |
|:---:|:---|:---|:---|
| **1** | Receive Authenticated Query | `AICopilotService.ask(user_id, authorized_property_ids, query)` | Context includes caller identity and list of authorized property IDs. |
| **2** | Defend Against Injection | `PromptInjectionDefense.inspect_query()` | Rejects prompt escape instructions, system reveal attempts, and override tags. |
| **3** | Deterministic Intent Routing | `AICopilotService.classify_intent()` | Maps user query to allowlisted intent enum (`POLICY_INQUIRY`, `TARIFF_COMPARISON`, etc.). |
| **4** | Check Tenant Permissions | `CopilotToolRegistry.execute()` | Rejects `OWNER_ONLY` tool execution if requested property is outside authorized scope. |
| **5** | Execute Domain Service | `PolicyIntelligenceService`, `TariffIntelligenceService`, etc. | Executes trusted internal Python services; does not delegate arithmetic to LLM. |
| **6** | Assemble Evidence Bundle | `EvidenceBundle.add_evidence()` | Bundles official citations, source organizations, and reporting periods. |
| **7** | Numerical Grounding Audit | `NumericalGroundingGuard.verify_grounding()` | Extracts numbers from text and confirms presence in evidence bundle. |
| **8** | Fallback on Ungrounded Value | `_generate_deterministic_answer()` | If ungrounded numbers appear, reverts to deterministic summary to prevent hallucination. |
| **9** | Enforce Cross-Tenant Denial | `_create_denial_response()` | Queries targeting unowned properties return explicit access denial responses. |
| **10** | Return Structured Contract | `CopilotResponse` | Exposes answer text, key findings, evidence items, limitations, and next actions. |

*Automated Verification*: `tests/avishkar_ems/test_phase21_integration_acceptance.py::test_tc2104_workflow_d_ai_copilot_grounding_and_refusal` (PASSED).

---

## 6. Workflow E — Digital Twin Scenario Simulation & Energy Conservation Invariant

| Step | Action | Implementation Component | Contract / Invariant |
|:---:|:---|:---|:---|
| **1** | Establish Calibrated Baseline | `DigitalTwinRegistry` | Baseline consumption and demand initialized from verified utility statements. |
| **2** | Validate Scenario Parameters | `SimulationEngine.validate_parameters()` | Parameters checked for valid physics ranges (solar capacity ≤ 100 kWp, reduction ≤ 100%). |
| **3** | Create Scenario Record | `DigitalTwinService.create_scenario()` | Validates user ownership of twin and records model type and version. |
| **4** | Execute Deterministic Engine | `SimulationEngine.simulate()` | Calculates simulated consumption, solar generation, grid import/export, and bill savings. |
| **5** | Enforce Energy Conservation | `TimeOfUseOptimizer.evaluate_load_shift()` | Total daily consumption remains constant before and after load shifting. |
| **6** | Carbon Mitigation Factor | `CEA_GRID_EMISSIONS_FACTOR_KG_CO2_PER_KWH` | Avoided carbon uses statutory CEA grid factor (0.716 kg CO2/kWh). |
| **7** | Disclose Simulation Banner | `urjasetu_view.py` (Tab 15) | Clearly banners results as `WHAT-IF SIMULATION` with parameter origin map. |
| **8** | Multi-Scenario Comparison | `ScenarioComparisonEngine.compare_scenarios()` | Compares multiple interventions against common baseline under identical tariffs. |
| **9** | Sensitivity Sweep | `SensitivitySweepEngine.run_sweep()` | Varies operational parameters across bounded range to inspect elasticity. |
| **10** | Multi-Tenant Sandbox | `DigitalTwinService.execute_scenario()` | Non-owners cannot run simulations against other users' private twins. |

*Automated Verification*: `tests/avishkar_ems/test_phase21_integration_acceptance.py::test_tc2105_workflow_e_scenario_simulation_and_energy_conservation` (PASSED).

---

## 7. Workflow F — Real-Time Event Monitoring, Alert Rules & Deduplication

| Step | Action | Implementation Component | Contract / Invariant |
|:---:|:---|:---|:---|
| **1** | Ingest Telemetry Event | `EventRecord` | Strongly-typed event with entity ID, category, severity, and payload. |
| **2** | Rule Evaluation | `EventRuleEvaluator` | Evaluates rule criteria (e.g. sanctioned load exceeded, sustained voltage spike). |
| **3** | Deduplication Window | `EventMonitoringService._is_duplicate()` | Suppresses duplicate events for the same entity and rule within suppression window (3600s). |
| **4** | Generate Open Alert | `EventMonitoringService.ingest_event()` | Creates `AlertRecord` in `OPEN` status; increments occurrence count on duplicate. |
| **5** | Evaluate Notification Prefs | `NotificationManager` | Checks user preferences and quiet hours before attempting notification. |
| **6** | Safe Channel Dispatch | `NotificationDispatcher` | Dispatches via mock channel or configured webhook; records real transmission outcome. |
| **7** | Acknowledge Alert | `AlertLifecycleManager.transition(OPEN → ACKNOWLEDGED)` | Records actor, timestamp, and investigation notes in audit trail. |
| **8** | Resolve Alert | `AlertLifecycleManager.transition(ACKNOWLEDGED → RESOLVED)` | Transitions alert to resolved; records mitigation action. |
| **9** | Prohibit Illegal Transitions | `VALID_ALERT_TRANSITIONS` | Reject illegal transitions (e.g. jumping from `RESOLVED` back to `OPEN`). |
| **10** | Multi-Tenant Event Scoping | `EventMonitoringService` | Authorized users can only view and manage alerts for properties they own. |

*Automated Verification*: `tests/avishkar_ems/test_phase21_integration_acceptance.py::test_tc2106_workflow_f_alert_lifecycle_and_deduplication` (PASSED).

---

## 8. Workflow G — Public Transparency, Citizen Reporting & Moderation

| Step | Action | Implementation Component | Contract / Invariant |
|:---:|:---|:---|:---|
| **1** | Query Public Indicators | `CitizenPortalService.get_public_indicators()` | Returns CEA national and state statutory balance indicators with source citations. |
| **2** | Privacy Scrubbing | `PIIScrubber` | Ensures no private household identifiers or door numbers appear in public metrics. |
| **3** | Citizen Report Intake | `CitizenPortalService.submit_citizen_report()` | Submits observations (service interruptions, infrastructure hazards, solar feedback). |
| **4** | Enforce Sliding Rate Limit | `_enforce_rate_limit()` | Caps submissions at 5 per hour per user to prevent denial-of-service spam. |
| **5** | Block Private Home Address | `submit_citizen_report()` | Regex detects and rejects door/flat numbers; mandates neighborhood/landmark level. |
| **6** | Assign Initial Intake State | `ReportStatus.SUBMITTED` | New reports enter queue in unverified `SUBMITTED` state with audit log. |
| **7** | Role-Gated Moderation | `CitizenPortalService.moderate_report()` | Only users with `MODERATOR` or `ADMIN` roles can transition report states. |
| **8** | Moderation State Transitions | `VALID_REPORT_TRANSITIONS` | Enforces valid transitions (`SUBMITTED → UNDER_REVIEW → ACCEPTED_FOR_PUBLICATION`). |
| **9** | Rejection Accountability | `moderate_report()` | Mandates documented rejection reason when dismissing citizen submissions. |
| **10** | Public Transparency Feed | `get_published_citizen_reports()` | Exposes only approved, non-sensitive community observations to the public feed. |

*Automated Verification*: `tests/avishkar_ems/test_phase21_integration_acceptance.py::test_tc2107_workflow_g_citizen_portal_transparency_and_moderation` (PASSED).
