# Data Trust Architecture — UrjaSetu EMS

## 1. Executive Mission & Principles

UrjaSetu EMS provides an evidence-based, traceable, and physically accurate energy platform for India's power and renewable systems. Data honesty is the central product guarantee:
1. **Zero Synthetic Disaggregation**: State-level data is never divided by arbitrary multipliers to fabricate district observations.
2. **Strict Dimensional & Physical Invariants**: Power (kW/MW) and Energy (kWh/MU) are mathematically distinct; power is never converted to energy without an explicit duration interval; installed capacity cannot be used as a solar generation denominator.
3. **Seven-Tier Provenance Classification**: Every metric displayed in the UI and served by APIs is explicitly labeled with its data provenance tier.
4. **Idempotent Ingestion & Auditable Revisions**: Ingestion runs are deterministic and deduplicated via SHA-256 composite keys; official corrections are versioned rather than overwritten.
5. **Freshness Distinguishes Cadence from Transport**: An HTTP 200 response does not imply current data; observation timestamps are compared against official publication cadences.

---

## 2. Seven-Tier Data Provenance Model

Every number in UrjaSetu EMS carries an explicit `DataClassification`:

| Classification Tier | Code | Description | UI Badge |
|---|---|---|---|
| **Tier 1: Official Observation** | `OFFICIAL_OBSERVATION` | Published directly by an authorized government body (e.g. CEA, NPP, MNRE). | Verified Official |
| **Tier 2: Imported Historical** | `IMPORTED_HISTORICAL` | Official archival series with closed recording periods (e.g. FY 2023–24 finalized balance). | Historical Record |
| **Tier 3: Household Meter** | `HOUSEHOLD_METER` | Interval telemetry (15m, 1h) from consumer smart meters or utility billing registers. | Smart Meter |
| **Tier 4: Calculated Statistic** | `CALCULATED_STATISTIC` | Derived value computed via deterministic formula (e.g. Energy Gap, Solar Share %). Must store inputs and formula. | Calculated Derived |
| **Tier 5: Forecast** | `FORECAST` | Machine learning or statistical projection with explicit model version, input window, and horizon. | Forecast Projection |
| **Tier 6: Scenario Simulation** | `SCENARIO_SIMULATION` | What-if modeling (e.g., battery sizing, EV charging surge) conditioned on user hypotheses. | Simulation Scenario |
| **Tier 7: Unverified / Unavailable** | `UNVERIFIED_OR_UNAVAILABLE` | Explicit marker for missing metrics or unverified third-party feeds. | Unavailable |

---

## 3. Trust Engine Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Streamlit UI & REST APIs                    │
│   (Displays Data Provenance, Badges, Caveats, Disclaimers)  │
└──────────────────────────────▲──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│             UrjaSetu Trust Validation Core                  │
│                                                             │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │ Unit Validation Layer │       │ Geographic Integrity  │  │
│  │ (Power vs Energy, MU) │       │ (Anti-Disaggregation) │  │
│  └───────────────────────┘       └───────────────────────┘  │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │ 13-Point Quality Gate │       │ Freshness Calculator  │  │
│  │ (Valid/Reject/Warn)   │       │ (7 Status States)     │  │
│  └───────────────────────┘       └───────────────────────┘  │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │ Idempotency Engine    │       │ Provenance Auditor    │  │
│  │ (SHA-256 Composite)   │       │ (Anti-Silent Promo)   │  │
│  └───────────────────────┘       └───────────────────────┘  │
└──────────────────────────────▲──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│                 Source Connector Interface                  │
│   (CeaConnector, DiscomConnector, OpenDataConnectors)       │
└──────────────────────────────▲──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│           Authoritative Sources & Datasets                  │
│  CEA PSP Reports, CEA Renewable Reports, Discom Telemetry   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Verification Mechanisms

1. **Unit & Dimension Checks**:
   - Explicit registry of 12 supported energy, power, and capacity units.
   - Cross-category conversion requests raise `TypeError`.
   - Power-to-energy conversion enforces strictly positive duration in hours.
   - Solar share denominator must belong to `UnitCategory.ENERGY`.

2. **Boundary & Geographic Integrity**:
   - Entities mapped to ISO 3166-2 and Census codes (e.g., `IN`, `KA`, `AP`, `KA_BLR_URBAN`, `AP_VSKP`).
   - Service areas (BESCOM covering 8 districts; APEPDCL covering 5 districts) are decoupled from revenue districts.
   - Any attempt to disaggregate state-level metrics without direct telemetry raises `ValueError`.

3. **Multi-Point Ingestion Quality Gate**:
   - Every candidate observation is evaluated against 13 quality rules.
   - Non-compliant records are either flagged with warnings or rejected into audit logs.

4. **Auditability & Traceability**:
   - Original values and original units are permanently retained alongside normalized values.
   - Revisions generate new versions (v1, v2, ...) while archiving prior versions with revision timestamps.
