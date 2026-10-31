# UrjaSetu EMS — Phase 12 Explainable Insights & Metric Provenance Specification

> **Standard**: Explainable AI, Mathematical Lineage & Provenance Standards  
> **Status**: Verified & Enforced  
> **Author**: UrjaSetu Systems Architecture & Engineering  
> **Audit Date**: 2026-10-24  

---

## 1. Principles of Explainable Energy Insights

A core principle of UrjaSetu EMS is that **no insight shall be presented without deterministic proof**. Energy executives, grid engineers, and regulatory analysts cannot rely on opaque "AI black-box" summaries. Every insight surfaced by the Unified Energy Command Center adheres to the following standards:

1. **Deterministic Lineage**: Every claim must link directly to verified baseline observations (e.g. numerator, denominator, previous period value).
2. **Exposed Mathematical Formulation**: The mathematical threshold or statistical formula used to trigger the insight is fully disclosed.
3. **Factual & Non-Accusatory Tone**: Statistical variances or delivery shortfalls are never described as "fraud", "corruption", "theft", or "regulatory violation" without independent legal verification. They are described strictly as measured discrepancies or physical variances.
4. **Transparent Confidence & Uncertainty**: Confidence scores are derived from underlying data quality statuses, observation completeness, and source statutory authority—never fabricated.
5. **Visible Limitations**: Assumptions regarding weather normalization, boundary alignments, or reporting delays are explicitly attached.

---

## 2. Explainable Insights Engine Catalog

The Phase 12 Command Center implements the following verified insight generators via `CommandCenterService.get_explainable_insights()`:

### INS-101: Clean Energy Generation Milestone
- **Insight Title**: Solar & Clean Energy Milestone Achieved
- **Trigger Condition**: Renewable generation share exceeds $30.0\%$ of total gross generation within the territory.
- **Mathematical Formula**:
  $$\text{RE Share} = \left(\frac{E_{\text{Renewable}}(\text{MU})}{E_{\text{Gross Generation}}(\text{MU})}\right) \times 100 \ge 30.0\%$$
- **Supporting Observations**:
  - Territory Gross Generation ($E_{\text{gross}}$ in $\text{MU}$)
  - Total Renewable Generation ($E_{\text{RE}}$ in $\text{MU}$)
  - Installed Solar Capacity ($P_{\text{solar}}$ in $\text{MW}$)
  - Solar Generation ($E_{\text{solar}}$ in $\text{MU}$)
- **Confidence Scoring Model**:
  $$\text{Confidence} = 95.0\% \times Q_{\text{source\_validity}}$$
  (Evaluates to $95.0\%$ when source records possess `VERIFIED_REPORT` provenance and cryptographic hash).
- **Assumptions & Caveats**:
  - Small Hydro ($\le 25\text{ MW}$) is included in renewable generation per CEA statutory standards.
  - Large Hydro ($> 25\text{ MW}$) is excluded from RES per CEA classification.
  - Numerator and denominator represent identical geographic and temporal boundaries.

---

### INS-102: Peak Demand Adequacy & Reliability Guard
- **Insight Title**: 100% Peak Demand Reliability (Zero Transmission Deficit)
- **Trigger Condition**: Peak demand deficit is strictly $0.0\%$, meaning peak demand met equals or exceeds the recorded peak requirement.
- **Mathematical Formula**:
  $$\text{Deficit}(\%) = \max\left(0.0, \frac{P_{\text{requirement}} - P_{\text{met}}}{P_{\text{requirement}}}\right) \times 100 = 0.0\%$$
- **Supporting Observations**:
  - Peak Demand Met ($P_{\text{met}}$ in $\text{MW}$)
  - Coincident Peak Requirement ($P_{\text{req}}$ in $\text{MW}$)
  - Net Energy Supplied ($E_{\text{supplied}}$ in $\text{MU}$)
- **Confidence Scoring Model**:
  $$\text{Confidence} = 98.0\%$$
  (Reflects synchronous SCADA recording by State Load Despatch Centers and Regional Load Despatch Centers).
- **Assumptions & Caveats**:
  - Measures transmission interconnection adequacy.
  - Local distribution transformer feeder outages or planned maintenance are recorded at Discom level and do not constitute transmission deficits.

---

### INS-103: Material Cross-Source Discrepancy Alert
- **Insight Title**: Cross-Source Reconciled Variance
- **Trigger Condition**: Two independent authorities report figures for the identical territory and period with variance exceeding $2.0\%$.
- **Mathematical Formula**:
  $$\Delta_{\text{rel}} = \frac{|V_{\text{authoritative}} - V_{\text{secondary}}|}{V_{\text{authoritative}}} \times 100 > 2.0\%$$
- **Supporting Observations**:
  - Statutory Authority Value ($V_{\text{auth}}$ from CEA)
  - Secondary Operational Value ($V_{\text{sec}}$ from State Open Data / SLDC)
  - Precedence Resolution Matrix
- **Non-Accusatory Guardrail**:
  - Categorized as a *Reporting Alignment Delay* or *Auxiliary Consumption Accounting Variance*, explicitly avoiding allegations of misconduct.
- **Confidence Scoring Model**:
  $$\text{Confidence} = 90.0\%$$

---

## 3. Metric Provenance Inspector Architecture

The Command Center provides end-to-end data tracing via `inspect_metric_provenance(metric_id, entity_code, period)`. This feature exposes the entire audit trail:

```
[ Statutory Authority / Sensor ] 
          │
          ▼
[ Connector Raw Ingestion ] ────── Cryptographic SHA-256 Hash
          │
          ▼
[ Conflict Precedence Engine ] ── Priority 100 vs 70 Reconciliation
          │
          ▼
[ Unit Normalization ] ────────── Physical Dimension Validation (MW vs MU)
          │
          ▼
[ CommandCenterService ] ──────── Authoritative Business Assembly
          │
          ▼
[ UI KPI Card & Provenance Modal ]
```

### Provenance Audit Schema (`MetricProvenanceDetail`):
```python
@dataclass(frozen=True)
class MetricProvenanceDetail:
    metric_id: str
    metric_name: str
    entity_code: str
    reporting_period: str
    original_value: float | None
    original_unit: str
    normalized_value: float | None
    normalized_unit: str
    source_name: str
    source_url_or_reference: str
    retrieval_timestamp: str
    geographic_scope: str
    validation_status: str
    transformation_applied: str
    calculation_method: str
    record_hash: str
    quality_warnings: list[str]
```

---

## 4. Lineage Verification Workflow

When an auditor or user inspects a metric (e.g. `M-105: Solar Generation` for Karnataka in `2024-05`):
1. **Raw Observation**: `1,420.0 MU` reported by Central Electricity Authority (Renewable Energy Sources division).
2. **Cryptographic Integrity**: SHA-256 hash `d4e5f6...` matches CEA published dataset.
3. **Unit Validation**: Verified as energy quantity ($\text{MU}$), distinct from nameplate capacity ($7,845.0\text{ MW}$).
4. **Semantic Compatibility**: Ratio against state gross generation ($3,712.5\text{ MU}$) validated by `MetricSemanticsRegistry.assert_compatible_for_ratio()`.
5. **Audit Summary**: Certified as statutory outturn with zero synthetic estimations.
