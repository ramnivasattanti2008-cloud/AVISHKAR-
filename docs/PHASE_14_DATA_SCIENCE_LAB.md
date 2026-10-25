# UrjaSetu EMS — Phase 14: Energy Data Science Lab Architecture

## 1. Executive Summary & Mission
Phase 14 delivers an evidence-based, scientifically defensible, and reproducible **Energy Data Science Lab** inside UrjaSetu EMS. It transforms energy analytics from subjective estimates into verifiable empirical science. Every experiment conducted within the lab binds explicitly to a cryptographic dataset fingerprint (SHA-256), enforces strict leak-free chronological validation, benchmarks candidate models against transparent naive baselines, refuses to fabricate precision/recall metrics on unlabeled anomalies, and exports reproducible research artifacts with host execution environment telemetry.

```
+----------------------------------------------------------------------------------------------------+
|                         URJASETU EMS: ENERGY DATA SCIENCE LAB ARCHITECTURE                         |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ Data Sources ]       [ Controlled Ingestion ]         [ Dataset Catalogue ]                     |
|  - CEEW Smart Meter       - Schema Validation              - Provenance & Metadata                 |
|  - CEA National Demand    - Timestamp Continuity           - Content Fingerprint (SHA-256)         |
|  - KPTCL Solar PV         - Physical Range Bounds          - Classification (Statutory/Real/Demo)  |
|  - Custom User CSV/JSON   - Safe Partial Rejection         - Data Quality Auditing                 |
|                                     |                                 |                            |
|                                     +----------------+----------------+                            |
|                                                      |                                             |
|                                                      v                                             |
|                                      [ Experiment Execution Service ]                              |
|                                      - Config Validation & Parameter Freeze                        |
|                                      - Host Environment Telemetry Capture                          |
|                                      - Path Traversal & Security Guards                            |
|                                                      |                                             |
|                     +--------------------------------+--------------------------------+            |
|                     |                                                                 |            |
|                     v                                                                 v            |
|      [ Time-Series Forecasting Tournament ]                        [ Anomaly-Detection Evaluation ]|
|      - Chronological Train/Test Split (No Leakage)                 - Labeled: Precision, Recall, F1|
|      - Baselines: Last Obs, Moving Avg, Linear, Seasonal           - Unlabeled: Stability, Alert   |
|      - Candidates: Holt-Winters, Lagged Ridge                        Volume, Sensitivity Gradient  |
|      - Champion Rule: Beat Best Baseline by >= 1% MAE                (No fabricated precision!)    |
|                     |                                                                 |            |
|                     +--------------------------------+--------------------------------+            |
|                                                      |                                             |
|                                                      v                                             |
|                                      [ Reproducibility & Reporting ]                               |
|                                      - JSON Artifact Bundles (results/experiments/exp_*.json)      |
|                                      - Cryptographic Checksums (SHA-256)                           |
|                                      - Publication-Grade Markdown Research Reports                 |
|                                      - UI Tab 12 Integration (Catalogue, Wizard, Runner, Reports)  |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Core Architectural Components

### A. Dataset Catalogue (`DatasetCatalogue`)
- **Metadata Envelope**: Stores dataset identifier, name, description, publishing organization, statutory reference URL, spatio-temporal coverage, sampling cadence, variable dictionary, units, and licensing terms.
- **Classification Taxonomy**:
  - `VERIFIED_REAL_WORLD`: Ground-truth physical telemetry (e.g. CEEW Indian smart meter data, CC0).
  - `IMPORTED_STATUTORY`: Official state/national power authority filings (e.g. CEA national demand, KPTCL solar).
  - `DEMONSTRATION`: Verified reference profiles used for interactive what-if demonstrations.
  - `SYNTHETIC`: Mathematically simulated or generated data; clearly flagged to prevent conflation with real-world observations.
- **Cryptographic Fingerprinting**: Every registered dataset computes and preserves a 256-bit SHA-256 hash of its raw payload. Any silent upstream mutation is instantly detected.

### B. Controlled Ingestion & Quality Auditing (`DatasetIngestionEngine`)
- **Schema & Type Enforcement**: Verifies required column headers, parses strict ISO/chronological timestamps, and asserts floating-point type validity.
- **Physical Range Bounds**: Enforces non-negative constraints on consumption and demand while providing explicit opt-in for legitimate signed quantities (e.g. solar export or net metering).
- **Data Quality Report (`DatasetQualityReport`)**:
  $$\text{Completeness} = \frac{N - N_{\text{missing}}}{N} \times 100\%$$
  $$\text{Validity} = \frac{N - N_{\text{invalid}}}{N} \times 100\%$$
  $$\text{Uniqueness} = \frac{N - N_{\text{duplicates}}}{N} \times 100\%$$
  $$\text{Temporal Continuity} = \frac{N - N_{\text{discontinuities}}}{N} \times 100\%$$

### C. Time-Series Forecasting Tournament (`TimeSeriesBenchmarkRunner`)
- **Strict Leakage Prevention**: Enforces chronological train/test splitting where the test horizon strictly succeeds the training partition ($T_{\text{train, max}} < T_{\text{test, min}}$). Preprocessing, lagging, rolling statistics, and feature normalization are fit exclusively on the training partition.
- **Transparent Baselines**:
  1. *Last Observation Persistence*: $\hat{y}_{T+h} = y_T$
  2. *Moving Average ($k=3$)*: $\hat{y}_{T+h} = \frac{1}{k} \sum_{i=0}^{k-1} y_{T-i}$
  3. *Linear Trend Drift*: Fits ordinary least-squares slope and intercept on time index.
  4. *Seasonal Naive ($s=12$)*: $\hat{y}_{T+h} = y_{T+h-s}$
- **Champion Selection Rule**: A statistical or machine-learning candidate model (e.g. Holt-Winters Triple Exponential Smoothing or Lagged Autoregressive Ridge) is promoted to Champion **only if its holdout MAE improves upon the best baseline by at least 1.0%**:
  $$\text{Improvement} = \frac{\text{MAE}_{\text{best\_baseline}} - \text{MAE}_{\text{candidate}}}{\text{MAE}_{\text{best\_baseline}}} \ge 0.01$$
  Otherwise, the transparent baseline is retained as champion.

### D. Honest Anomaly-Detection Evaluation (`AnomalyEvaluationRunner`)
- **Labeled Ground Truth**: When validated historical labels exist (e.g., recorded power outages or sub-station breaker trips), the engine computes true confusion matrix metrics: Precision, Recall, F1 score, False Positive Rate, and False Negative Rate, alongside class imbalance documentation.
- **Unlabeled Operational Telemetry**: In the absence of confirmed labels, the engine **strictly refuses to manufacture pseudo Precision or Recall**. Instead, it evaluates defensible operational properties:
  - *Alert Volume & Detection Rate*: Percentage of observations triggering statistical flags.
  - *Detection Stability Score*: Jaccard similarity of alerts generated across window sizes ($k=3$ vs. $k=6$).
  - *Sensitivity Gradient*: Rate of alert change per unit shift in the MAD threshold multiplier $\theta$:
    $$\text{Gradient} = \frac{\text{Alerts}(\theta - 0.5) - \text{Alerts}(\theta + 0.5)}{1.0}$$

### E. Reproducibility & Research Report Service (`DataScienceLabService`)
- Synchronously executes experiments with frozen configurations and parameters.
- Records host software environment telemetry: Python interpreter version, platform OS, release, architecture, and package versions.
- Saves immutable JSON artifact bundles under `results/experiments/exp_{id}.json` with cryptographic SHA-256 validation.
- Generates publication-ready Markdown research reports documenting problem objective, provenance, split boundaries, metrics, leaderboard, environment, and limitations.

---

## 3. UI Integration (Tab 12)
Integrated as tab `"🔬 12. Energy Data Science Lab & Benchmarking"` in `app/urjasetu_view.py`:
1. **Catalogue Explorer**: Filterable table of canonical datasets, detailed provenance inspector, and data quality metric cards.
2. **Ingestion Wizard**: Text area / upload input with real-time schema validation and quality auditing.
3. **Tournament Runner**: Select dataset, forecast horizon, and threshold; execute live backtest; view champion and leaderboard.
4. **Research Reports**: Markdown report viewer with direct download triggers for report Markdown and artifact JSON.
