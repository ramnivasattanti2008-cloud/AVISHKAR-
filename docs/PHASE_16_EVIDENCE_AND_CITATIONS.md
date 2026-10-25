# Phase 16 — Evidence Model, Lineage & Citation System

## 1. Evidence-Driven Philosophy

In UrjaSetu EMS, language model outputs are never treated as authoritative sources of truth. All factual assertions must originate from an `EvidenceBundle` created during tool execution. 

The Copilot explicitly distinguishes:
1. **Observed Telemetry**: Measured meter intervals from smart meters.
2. **Authoritative Billed Items**: Official DISCOM statements with fixed and energy charges.
3. **Statutory Schedules**: Official state electricity regulatory commission tariff filings.
4. **Calculated Statistics**: Rolling statistics, z-scores, and MAD outlier metrics.
5. **Modeled Scenarios**: Estimated engineering savings from solar and appliance upgrades.
6. **Statutory Grid Reports**: Central Electricity Authority (CEA) monthly power supply positions.

---

## 2. Typed Evidence Data Contract

```python
@dataclass
class EvidenceItem:
    evidence_id: str                          # e.g., "EVID-001"
    source_category: str | SourceCategory     # "HOUSEHOLD_METER", "UTILITY_BILL", "TARIFF_ORDER", etc.
    source_title: str                         # Display title
    source_organization: str                  # "BESCOM", "CEA", "SERC"
    source_reference: str                     # Internal or external document reference
    reporting_period: str                     # "2026-03", "Recent 30 Days"
    retrieval_timestamp: str                  # ISO 8601 UTC timestamp
    geographic_scope: str                     # "State Utility Territory", "National"
    units: str                                # "kWh", "INR", "MU", "MW"
    verification_status: str | bool           # True / VERIFIED
    data_classification: str                  # "HOUSEHOLD_METER", "OFFICIAL_OBSERVATION"
    calculation_method: str | CalculationMethod # Calculation lineage identifier
    limitations: list[str]                    # Explicit limitations / freshness warnings
    values: dict[str, Any]                    # Atomic data values for numerical grounding
    extracted_values: dict[str, Any]          # Grounded key-value dictionary
    source_url: str                           # Official citation URL
    source_id: str                            # Traceable source identifier
```

---

## 3. Numerical Grounding Guard (Anti-Hallucination)

The `NumericalGroundingGuard` performs post-generation parsing on all text returned by the model or generator:

1. **Number Extraction**: Extracts all candidate numbers from the generated response while stripping citation tags (e.g. `[EVID-001]`).
2. **Exemption Filtering**: Exempts calendar integers ($0 \le x \le 31$, such as days of month or small count indices) and active decade years ($2020 \le x \le 2030$).
3. **Evidence Matching**:
   - Compares remaining candidate values against the numbers present in `EvidenceBundle.extract_grounded_numbers()`.
   - Supports unit variations: percentage scaling ($0.15 \leftrightarrow 15.0\%$), kW $\leftrightarrow$ W ($1.5 \leftrightarrow 1500$), and kWh $\leftrightarrow$ MWh.
   - Enforces strict tolerance ($\le 0.05$ absolute or $1\%$ relative).
4. **Deterministic Fallback**: If an ungrounded value is detected, the answer is flagged as `GROUNDING_FALLBACK` and substituted with a deterministic template using only verified values from the domain engine.

---

## 4. Citation Rendering in the UI

Every evidence item is rendered with an in-text anchor (e.g., `[EVID-001]`) and an interactive **Verifiable Evidence Citations** table in Tab 14:
- **Source ID**: Unique evidence token (`EVID-001` through `EVID-006`).
- **Title**: Human-readable source title.
- **Authority**: Verifying body (`BESCOM`, `CEA`, `SERC`).
- **Period**: Applicable observation date or billing cycle.
- **Method**: Exact mathematical or telemetry method (`METER_TELEMETRY`, `STATUTORY_SLAB`, `PARAMETRIC_ENERGY_MODEL`).
- **Verification**: ✅ Verified status badge.
- **URL**: Link to official statutory portal or internal secure record.
