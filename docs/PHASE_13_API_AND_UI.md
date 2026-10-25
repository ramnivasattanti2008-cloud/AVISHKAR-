# UrjaSetu EMS — Phase 13 API & UI Integration Specification

> **Standard**: Service Interface, UI Architecture & State Machine  
> **Status**: Verified & Enforced  
> **Author**: UrjaSetu Systems Architecture & Engineering  
> **Audit Date**: 2026-10-24  

---

## 1. Backend Service API Contract (`RecommendationEngine`)

The recommendation engine is exposed via `src/avishkar_ems/recommendations.py` and exported through `avishkar_ems`.

### 1.1. Core Service Methods

#### `generate_recommendations(user_id: str, property_id: str, user_appliances: list[ApplianceSpec] | None = None) -> list[Recommendation]`
- **Purpose**: Evaluates all eligibility rules against property profile data and verified bills.
- **Security Check**: Enforces that `user_id` matches property owner (`PermissionError` if unauthorized).
- **Return Value**: List of `Recommendation` objects sorted descending by `priority_score`.

#### `compute_unduplicated_savings(profile: HouseholdProfile, active_recs: list[Recommendation]) -> dict[str, Any]`
- **Purpose**: Evaluates sequential marginal bill reductions on the shared consumption baseline to prevent double-counting overlapping savings.
- **Return Value**: Summary dictionary containing `total_annual_kwh_savings`, `total_annual_cost_savings_inr`, and `action_breakdown`.

#### `simulate_scenario(user_id: str, property_id: str, ac_setpoint_adjustment_deg_c: float, appliance_hours_reduction: float, proposed_solar_kwp: float, proposed_sanctioned_load_kw: float | None) -> ScenarioSimulationResult`
- **Purpose**: Recomputes simulated annual bill, capital costs, PM Surya Ghar subsidies, and simple payback period in real time under official tariff schedules.

#### `transition_status(user_id: str, recommendation_id: str, target_status: RecommendationStatus, notes: str | None = None, dismissed_reason: str | None = None) -> Recommendation`
- **Purpose**: Validates and executes state transitions (`PENDING` $\rightarrow$ `VIEWED` $\rightarrow$ `PLANNED` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `COMPLETED` / `DISMISSED`) and appends immutable audit log entries.

---

## 2. User Interface Architecture (`app/urjasetu_view.py`)

Recommendations are presented in a dedicated top-level tab:
**`💡 11. Energy Optimization & Recommendations`**

```
+----------------------------------------------------------------------------------------------------+
| 💡 ENERGY OPTIMIZATION, COST SAVINGS & RECOMMENDATIONS                                             |
+----------------------------------------------------------------------------------------------------+
| Property: [ Bengaluru Residence (Indiranagar) v ]  [ 🔌 Configure Major Household Appliances ]     |
+----------------------------------------------------------------------------------------------------+
| [ Unduplicated Savings ]    [ Active Opportunities ]    [ Completed Actions ]    [ Clean Energy ]  |
| ₹19,354 / yr [SEQUENTIAL]   3 Actions                   0 Tracked                1,840 kWh / yr    |
+----------------------------------------------------------------------------------------------------+
| 🎛️ INTERACTIVE 'WHAT-IF' SCENARIO SIMULATOR                                                        |
| Sliders: AC Setpoint (+2°C) | Reduce Hours (1 hr/day) | Add Solar (3 kWp) | Sanctioned Load (4 kW) |
| Simulated New Bill: ₹22,140/yr (-45%) | Net CapEx: ₹87,000 (Subsidy ₹78,000) | Payback: 4.8 years  |
+----------------------------------------------------------------------------------------------------+
| Filters: [ Category: All v ]   [ Status: All Statuses v ]                                          |
+----------------------------------------------------------------------------------------------------+
| CARD 1: Optimize Solar Battery Dispatch (Shift 184 kWh to Evening Peak)       [Priority: 82.5]     |
| Savings: ₹9,981 / yr | Energy: 2,203 kWh/yr | Confidence: 92% | Low Effort | Status: PENDING    |
| [ 🔍 Supporting Evidence & Lineage ]                                                               |
| Action Buttons: [ 📋 Plan Action ]   [ 🚀 Start Action ]   [ ✅ Mark Completed ]   [ ❌ Dismiss ]  |
+----------------------------------------------------------------------------------------------------+
| CARD 2: 10% Household Conservation Plan (Target: Save 42 kWh/month)           [Priority: 71.0]     |
| Savings: ₹3,836 / yr | Energy: 503 kWh/yr | Confidence: 90% | Low Effort | Status: PENDING      |
| [ 🔍 Supporting Evidence & Lineage ]                                                               |
| Action Buttons: [ 📋 Plan Action ]   [ 🚀 Start Action ]   [ ✅ Mark Completed ]   [ ❌ Dismiss ]  |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. UI State Handling & Honest Fallbacks

1. **No Recommendations Matching Filters**:
   - Displays a clean informational message: `No recommendations match the selected filters for this property.`
2. **Missing Billing Telemetry**:
   - Triggers `RULE-DATA-01`: explicitly instructs the user to upload billing statements rather than fabricating savings.
3. **Missing Appliance Data**:
   - Triggers `RULE-APP-GAP`: delivers non-numeric advice and prompts user to input appliance wattage and runtime.
4. **Interactive Lifecycle Feedback**:
   - Success toasts and status updates immediately re-render with `st.rerun()`.
