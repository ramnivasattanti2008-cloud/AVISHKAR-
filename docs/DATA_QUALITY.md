# Data Quality Validation Pipeline — UrjaSetu EMS

## 1. Quality Validation Philosophy

Data quality is enforced through an explicit 13-point gate rather than silent coercions.
- **Explainable Outcomes**: Every candidate observation is assigned an explicit outcome: `VALID`, `VALID_WITH_WARNINGS`, `INCOMPLETE`, `REJECTED`, or `REQUIRES_REVIEW`.
- **Physical Feasibility**: Tests verify finite values, positive power/energy, and valid reporting periods.
- **Audit Trails**: Rejections never vanish; failed records and rule findings are preserved in structured ingestion batch summaries.

---

## 2. The 13 Quality Validation Rules

| Rule ID | Rule Name | Description | Severity | Failure Action |
|---|---|---|---|---|
| `VAL_REQ_FIELDS` | Required Field Completeness | Verifies presence of observation ID, source ID, metric ID, and geographic ID. | CRITICAL | Record Rejected (`REJECTED`) |
| `VAL_FINITE_VALUE` | Numerical Finite Value | Asserts value is a finite float (rejects `NaN`, `+Inf`, `-Inf`). | CRITICAL | Record Rejected (`REJECTED`) |
| `VAL_UNIT_REGISTERED` | Unit Registry Membership | Validates unit against the 12 canonical energy, power, and capacity units. | CRITICAL | Record Rejected (`REJECTED`) |
| `VAL_VALUE_NON_NEGATIVE` | Non-Negative Energy/Power | Ensures demand, consumption, and generation are $\ge 0.0$. | HIGH | Record Rejected (`REJECTED`) |
| `VAL_PERIOD_INTERVAL` | Chronological Period Bounds | Asserts `reporting_period_end > reporting_period_start`. | CRITICAL | Record Rejected (`REJECTED`) |
| `VAL_VALID_GEO_ENTITY` | Geographic Entity Legitimacy | Validates entity ID against `CanonicalEntityCatalog`. | HIGH | Requires Review (`REQUIRES_REVIEW`) |
| `VAL_PROVENANCE_REF` | Source Reference Integrity | Verifies non-empty provenance reference or document citation. | MEDIUM | Warning (`VALID_WITH_WARNINGS`) |
| `VAL_TIMEZONE_AWARE` | Timezone Explicit Definition | Flags timestamps that lack UTC or explicit timezone offsets. | MEDIUM | Warning (`VALID_WITH_WARNINGS`) |
| `VAL_RATIO_BOUNDS` | Percentage Ratio Bounds | Enforces $0.0 \le \text{ratio} \le 100.0$ for percentages. | HIGH | Record Rejected (`REJECTED`) |
| `VAL_POWER_ENERGY_ALIGN` | Dimensional Alignment | Checks that instantaneous power is not tagged with energy units. | CRITICAL | Record Rejected (`REJECTED`) |
| `VAL_PERIOD_COMPLETENESS`| Period Completeness | Verifies monthly reporting covers at least 28 days. | MEDIUM | Warning (`VALID_WITH_WARNINGS`) |
| `VAL_OUTLIER_PLAUSIBILITY`| Grid Capacity Upper Bound | Flags single-month national energy $> 500,000$ MU as anomalous. | MEDIUM | Flagged for Review (`REQUIRES_REVIEW`) |
| `VAL_SCHEMA_INTEGRITY` | Ingestion Schema Drift | Validates mandatory column presence against source schema. | CRITICAL | Batch Halted / Incomplete (`INCOMPLETE`) |

---

## 3. Quality Status Outcomes

1. `VALID`: Passed all 13 rules with zero warnings or errors. Fully approved for analytical calculation and forecasting.
2. `VALID_WITH_WARNINGS`: Non-critical observations passed (e.g. missing timezone offset, default UTC assumed). Allowed in UI with warning badge.
3. `INCOMPLETE`: Lacks necessary reporting interval bounds or metadata.
4. `REQUIRES_REVIEW`: Unusual value within possible but unprecedented bounds (e.g. sudden 80% jump in monthly solar additions).
5. `REJECTED`: Severe physical or logical violation (negative energy demand, inverted start/end dates, invalid unit category). Blocked from storage.

---

## 4. Ingestion Batch Summaries

For every batch run, `DataQualityValidator.summarize_batch(results)` produces an `IngestionBatchSummary`:
- `total_records`: Number of records evaluated.
- `accepted_valid`: Count of approved clean observations.
- `accepted_with_warnings`: Count of observations approved with caveats.
- `rejected`: Count of blocked records.
- `rejection_breakdown`: Categorized failure counts by rule ID.
- `warnings`: Detailed list of non-blocking caveats for system administrators.
