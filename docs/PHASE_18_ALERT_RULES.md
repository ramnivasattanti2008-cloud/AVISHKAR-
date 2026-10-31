# UrjaSetu EMS Phase 18: Deterministic Alert Rules & Severity Methodology

## 1. Overview & Policy Invariants

In UrjaSetu EMS, alerts are generated exclusively through transparent, deterministic mathematical evaluators. We strictly prohibit generative AI from fabricating alert triggers, inventing baseline figures, or hallucinating severity tiers.

Every material alert includes:
1. Audited Triggering Rule ID.
2. Observed vs. Threshold Quantitative Values with physical units.
3. Relevant Temporal Measurement Window.
4. Source Service and Provenance Reference.
5. Known Technical Limitations and Caveats.
6. Actionable Next Steps for Household Owners or Grid Operators.

---

## 2. Supported Alert Rules Catalog

### 2.1 Unusual Consumption Spike (`RULE-EVT-SPIKE-01`)
- **Triggering Condition**: Recent interval consumption ($C_t$) exceeds the rolling median baseline ($M_t$) by at least $30\%$ and by an absolute difference $\ge 0.30\text{ kWh}$.
$$\Delta\% = \frac{C_t - M_t}{M_t} \times 100\% \ge 30.0\% \quad \text{and} \quad (C_t - M_t) \ge 0.30\text{ kWh}$$
- **Severity Policy**:
  - `CRITICAL`: $\Delta\% \ge 75.0\%$
  - `HIGH`: $50.0\% \le \Delta\% < 75.0\%$
  - `MEDIUM`: $30.0\% \le \Delta\% < 50.0\%$
- **Traceable Evidence**: Interval consumption, baseline median, percentage deviation, reporting period, limitation note stating appliance sub-metering absence.
- **Recommended Action**: Inspect continuous thermal loads (geysers, AC compressors, borewell pumps).

### 2.2 Sanctioned Load Overdraw (`RULE-EVT-LOAD-01`)
- **Triggering Condition**: Instantaneous peak draw ($P_{\text{peak}}$) exceeds $130\%$ of statutory contracted sanctioned load ($P_{\text{sanctioned}}$).
$$\text{Overdraw}\% = \frac{P_{\text{peak}}}{P_{\text{sanctioned}}} \times 100\% \ge 130.0\%$$
- **Severity Policy**:
  - `CRITICAL`: $\text{Overdraw}\% \ge 150.0\%$
  - `HIGH`: $130.0\% \le \text{Overdraw}\% < 150.0\%$
- **Traceable Evidence**: Recorded peak kW, contracted load kW, overdraw percentage, DISCOM tariff citation regarding penal demand fixed charges.
- **Recommended Action**: Stagger concurrent appliance runtimes or request load enhancement via DISCOM portal.

### 2.3 Data Staleness Lag (`RULE-EVT-STALE-01`)
- **Triggering Condition**: Elapsed age of latest telemetry measurement exceeds configured publication cadence threshold ($T_{\text{cadence}}$).
$$T_{\text{age}} > T_{\text{cadence}}$$
- **Severity Policy**:
  - `HIGH`: $T_{\text{age}} \ge 2.0 \times T_{\text{cadence}}$
  - `MEDIUM`: $T_{\text{cadence}} < T_{\text{age}} < 2.0 \times T_{\text{cadence}}$
- **Truth-in-Data Invariant**: Missing data strictly triggers a `DATA_STALENESS` alert, NEVER an energy anomaly alert or assumed zero consumption.
- **Traceable Evidence**: Observed age in days, configured threshold days, source connector identifier.

### 2.4 Connector Transport Failure (`RULE-EVT-CONN-01`)
- **Triggering Condition**: External HTTP transport failure, remote 5xx gateway error, network timeout, or schema parsing mismatch during scheduled ingestion sync.
- **Severity Policy**: `HIGH`.
- **Traceable Evidence**: Redacted error string (passwords/tokens stripped), connector name, endpoint status code.

### 2.5 Security Boundary Violation (`RULE-EVT-SEC-01`)
- **Triggering Condition**: Adversarial prompt injection, privilege escalation attempt, unauthorized cross-tenant inspection, or malicious payload upload.
- **Severity Policy**: `CRITICAL`.
- **Traceable Evidence**: Violation type, sanitized prompt pattern, actor user reference.
