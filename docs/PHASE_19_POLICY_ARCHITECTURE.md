# UrjaSetu EMS Phase 19: Energy Policy Intelligence & Impact Assessment Architecture

## 1. Executive Summary & Mission

Phase 19 introduces the **Energy Policy Intelligence & Impact Assessment Subsystem** into the UrjaSetu Energy Management System (EMS). Designed to bridge macro-level public policy declarations with micro-level household decisions, the module provides a verifiable, evidence-backed framework for:
1. Discovering verified statutory energy policies and schemes across Central, State, and Regulatory bodies.
2. Inspecting authoritative gazette notifications, order numbers, and cryptographic provenance fingerprints.
3. Quantitatively tracking policy targets using transparent linear run-rate benchmarks against real-world progress indicators.
4. Comparing policy amendments and historical iterations side-by-side to detect changes in financial assistance, administrative mechanisms, and capacity caps.
5. Evaluating household-level eligibility and direct economic impact (e.g., PM Surya Ghar Central Financial Assistance subsidy, rooftop physical sizing constraints, and Discom net-metering limits).
6. Enriching the AI Energy Copilot with ground-truth policy inquiry tools protected by strict prompt injection defense and numerical grounding guards.

---

## 2. Core Architectural Principles & Invariants

1. **Truth-in-Data & Provenance Honesty**:
   - Official policy statements, statutory notifications, and gazette orders are strictly distinguished from derived analytical estimates, run-rate projections, or third-party commentaries.
   - Unverified policy claims or draft notifications are never presented as enacted law.
2. **Deterministic Mathematical Formulas**:
   - Run-rate tracking relies strictly on closed-form linear timeline interpolation between baseline and target dates.
   - Avoided $\text{CO}_2$ emissions calculations use the statutory Central Electricity Authority (CEA) Baseline Database grid factor ($0.716\text{ kg CO}_2/\text{kWh}$).
3. **Multi-Jurisdictional Scope**:
   - Supported jurisdictions span Central (`NATIONAL`), State governments (`STATE_KARNATAKA`, `STATE_ANDHRA_PRADESH`), and Independent Regulatory Commissions (`REGULATORY_CERC`, `REGULATORY_SERC`).
4. **Server-Side Tenant Isolation**:
   - Household eligibility evaluation strictly enforces tenant boundaries (`owner_user_id == auth_user_id` or explicit authorization list). Unauthorized attempts raise `PermissionError` and emit security audit events.
5. **Grounded AI Copilot Integration**:
   - Copilot tool executions produce structured `EvidenceItem` bundles (`EVID-011`, `EVID-012`). All numeric answers are audited by `NumericalGroundingGuard` before display.

---

## 3. Subsystem Architecture & Component Topology

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 UrjaSetu EMS Platform                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  Tab 17: Streamlit UI View (urjasetu_view.py)                                           │
│  ├─ KPI Metric Strip (National Progress, Active Policies, Tracked GW, Household CFA)    │
│  ├─ Statutory Policy Catalogue (Filter by Sector, Jurisdiction, Status)                │
│  ├─ Quantitative Target Tracking & Run-Rate Leaderboard                                │
│  ├─ Policy Versioning & Amendment Comparator Matrix                                    │
│  ├─ Household Policy Eligibility & Economic Impact Calculator                           │
│  └─ Provenance Invariants & Gazette Citation Audit Deck                                 │
│                                                                                         │
│                                           │                                             │
│                                           ▼                                             │
│  PolicyIntelligenceService (src/avishkar_ems/policy_intelligence.py)                    │
│  ├─ PolicyRegistry: Authoritative pre-seeded catalogue & filter engines                 │
│  ├─ PolicyProgressEngine: Closed-form run-rate mathematical tracking & trajectory       │
│  ├─ PolicyAmendmentComparator: Side-by-side scheme diffing & change analysis             │
│  └─ HouseholdPolicyAssessor: Statutory CFA calculation, sizing & Discom caps            │
│                                                                                         │
│                     │                                             │                     │
│                     ▼                                             ▼                     │
│  AICopilotService (ai_copilot.py)                     HouseholdManager                  │
│  ├─ Intent: POLICY_INQUIRY                            ├─ Profile Retrieval              │
│  ├─ Tools: get_verified_policies                      ├─ Tenant Ownership Check         │
│  ├─ Tools: evaluate_policy_progress                   └─ Solar Feasibility Inputs       │
│  └─ Evidence Bundles: EVID-011, EVID-012                                                │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Domain Data Contracts

The module exposes strongly-typed dataclasses and enums implemented with standard Python `dataclasses` and `Enum`:

### Enums
- **`PolicyJurisdiction`**: `NATIONAL`, `STATE_KARNATAKA`, `STATE_ANDHRA_PRADESH`, `STATE_MAHARASHTRA`, `STATE_DELHI`, `REGULATORY_CERC`, `REGULATORY_SERC`.
- **`PolicySector`**: `SOLAR_ROOFTOP`, `SOLAR_UTILITY`, `ENERGY_EFFICIENCY`, `GRID_TARIFF`, `DECARBONIZATION_GOALS`, `EV_CHARGING`, `DEMAND_RESPONSE`.
- **`PolicyClassification`**: `STATUTORY_ACT`, `CENTRAL_SCHEME`, `STATE_REGULATION`, `REGULATORY_ORDER`, `EXECUTIVE_GUIDELINE`, `INTERNATIONAL_TREATY`.
- **`PolicyStatus`**: `ACTIVE_ENACTED`, `AMENDED_SUPERSEDED`, `DRAFT_CONSULTATION`, `EXPIRED_REPEALED`.
- **`TargetProgressStatus`**: `ON_TRACK`, `AT_RISK`, `CRITICALLY_LAGGING`, `TARGET_EXCEEDED`, `BASELINE_UNAVAILABLE`.

### Data Contracts
- **`PolicyTarget`**: Encapsulates a quantitative target, baseline value/date, target value/date, indicator name, units, and verification authority.
- **`PolicyAmendment`**: Captures historical amendments, previous policy references, effective dates, and specific clause modifications.
- **`PolicyRecord`**: Represents an authoritative policy with gazette citations, SHA-256 document fingerprints, issuing ministry/discom, sectors, targets, and amendment logs.
- **`PolicyProgressAssessment`**: Calculated progress snapshot containing run-rate percentage, achievement percentage, trajectory classification, and analysis timestamp.
- **`HouseholdPolicyEligibility`**: Comprehensive assessment of household eligibility, calculated CFA subsidy, sizing constraints, Discom net-metering caps, and CO2 mitigation potential.

---

## 5. Directory Layout & Key Modules

| Path | Purpose |
| :--- | :--- |
| `src/avishkar_ems/policy_intelligence.py` | Core domain engine: Registry, Progress Engine, Comparator, Household Assessor, Service facade. |
| `src/avishkar_ems/__init__.py` | Public symbol exports (16 new contracts and service classes). |
| `src/avishkar_ems/ai_copilot.py` | AI Copilot integration: `POLICY_INQUIRY` intent, policy tools, evidence bundles, grounding guard. |
| `app/urjasetu_view.py` | Interactive Streamlit user interface (Tab 17: Energy Policy Intelligence & Impact Assessment). |
| `tests/avishkar_ems/test_phase19_policy_intelligence.py` | Automated test suite (12 unit, integration, security, and lifecycle test cases). |
| `docs/PHASE_19_*.md` | 8 dedicated architectural and operational specification documents. |
