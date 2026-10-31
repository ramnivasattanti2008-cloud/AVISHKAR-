# UrjaSetu EMS — Phase 8: Predictive Energy Intelligence, Forecasting & Anomaly Detection

## 1. Overview & Core Mission

Phase 8 introduces production-grade, software-only **Predictive Energy Intelligence** to UrjaSetu EMS. It transforms verified historical electricity and solar observations from Central Electricity Authority (CEA) bulletins and MNRE releases into leak-free time-series forecasts and explainable anomaly alerts.

The system adheres strictly to the **UrjaSetu Data Honesty Invariants**:
- **Zero Hallucination / No Synthetic Distortion**: Missing observations are never filled with synthetic hourly or diurnal curves without telemetry.
- **Anti-Downscaling Guarantee**: Macro state and national forecasts are never artificially attributed or downscaled to districts or utilities without direct feeder/meter data.
- **Physical Decoupling**: Installed solar capacity (MW) is never conflated with actual generated electricity (MU).
- **Baseline Tournament Invariant**: Statistical or machine-learning models are never deployed merely because they are complex; they must provably beat transparent baselines on chronological holdout data by $\ge 1.0\%$ lower MAE.
- **Non-Accusatory Anomaly Framing**: Statistical outliers and operational variances are never labeled as theft, fraud, equipment failure, or corruption without independent corroborating evidence.

---

## 2. Architecture & Service Hierarchy

```mermaid
graph TD
    A[Historical Observations\nCEA & MNRE Reports] --> B[ForecastEligibilityEngine\nPre-Flight Gate]
    B -->|Eligible Series| C[TemporalValidationEngine\nChronological Split / Walk-Forward]
    B -->|Ineligible Series| D[Eligibility Diagnostic Report\nCaveats & Data Requirements]
    
    C --> E[ModelTournamentEngine]
    E --> F1[Baselines:\nLast Obs, Seasonal Naive,\nMoving Avg, Linear Trend]
    E --> F2[Candidates:\nHolt-Winters (Additive/Mult),\nLagged Ridge Regression]
    
    F1 --> G[Out-of-Sample Holdout Evaluation\nMAE, RMSE, WAPE%, MASE, Bias]
    F2 --> G
    
    G --> H{Candidate beats\nbest baseline by >= 1%?}
    H -->|Yes| I[Deploy Candidate Champion]
    H -->|No| J[Retain Transparent Baseline Champion]
    
    I --> K[Forecast Point Generation\n+ Empirical Uncertainty Bands P10/P50/P90]
    J --> K
    
    A --> L[AnomalyDetectionEngine\nIndependent Service]
    L --> M1[Data Quality Anomalies\nPhysical bound / Zero-drop]
    L --> M2[Statistical Outliers\nRobust Rolling Median & MAD]
    L --> M3[Operational Variances\nSeasonal Residual Divergence]
    
    M1 --> N[Cryptographic Deduplication\nSHA-256 Alert Hashing]
    M2 --> N
    M3 --> N
    N --> O[Explainable, Non-Accusatory Alerts\n+ Operational Verification Steps]
```

The modular service architecture is distributed across clean, domain-specific modules in `src/avishkar_ems/`:
1. [`forecast_eligibility.py`](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/forecast_eligibility.py): Pre-flight verification checking cadence, sample size, gap rate, and geographic attribution.
2. [`temporal_validation.py`](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/temporal_validation.py): Chronological train/test splitting, walk-forward cross-validation, strictly backward lag feature construction, and temporal leakage assertion.
3. [`forecasting_engine.py`](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/forecasting_engine.py): Transparent baselines, candidate models, holdout tournament backtesting, and empirical residual uncertainty bands.
4. [`anomaly_detector.py`](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/anomaly_detector.py): Independent anomaly detection engine covering physical bounds, robust rolling MAD, and seasonal residual variance with cryptographic deduplication.
5. [`solar_forecast.py`](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/solar_forecast.py): Solar generation forecasting ensuring strict separation of energy (MU) from installed capacity (MW) and labeling weather nowcasting absence.
6. [`predictive_service.py`](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/predictive_service.py): Master application facade integrating eligibility, tournament execution, solar analysis, anomaly detection, and comparison of forecasts with subsequent actuals.

---

## 3. Data Eligibility Rules

Before any model training or prediction occurs, `ForecastEligibilityEngine` evaluates the series against 6 mandatory criteria:
1. **Metric Semantics & Unit Verification**: Validates metric ID and physical units against `MetricSemanticsRegistry`. Rejects unmapped or unverified metrics.
2. **Geographic Attribution & Anti-Downscaling**: Validates entity code against `GeoExplorer`. Prohibits synthesizing district or utility demand from state-level totals without local telemetry.
3. **Observation Cadence & Gap Tolerance**: Verifies monthly chronological sequence. Series with missing observation gaps exceeding **25%** are marked `HIGH_MISSING_DATA` and rejected.
4. **Physical Possibility & Bound Validation**: Flags negative or zero values on strictly positive physical quantities (e.g. macro state energy requirement).
5. **Sample Size Thresholds**:
   - **$< 6$ points**: Ineligible for all models (`min_additional_data_required = 6 - usable_count`).
   - **$6 - 11$ points**: Eligible only for simple baselines (`LastObservation`, `MovingAverage`, `LinearTrend`).
   - **$12 - 23$ points**: Eligible for seasonal baseline (`SeasonalNaive`, $s=12$).
   - **$\ge 24$ points**: Eligible for multi-cycle candidates (`HoltWinters`, `LaggedRidge`).
6. **Horizon Bounds**: Maximum allowable forecast horizon is bounded by historical series length (cannot exceed $50\%$ of history for simple series).

---

## 4. Temporal Validation & Data Leakage Prevention

Time-series forecasting evaluation must simulate real deployment conditions where future data is strictly inaccessible.

### Strict Anti-Leakage Invariants:
1. **No Random Shuffling**: Train and test splits are strictly partitioned chronologically.
2. **Temporal Leakage Assertion**: `assert_no_temporal_leakage(train_periods, test_periods)` explicitly checks that $\max(\text{train}) < \min(\text{test})$ and $\text{train} \cap \text{test} = \emptyset$. Any temporal contamination raises an immediate `ValueError`.
3. **Backward-Only Feature Construction**:
   At period $t$, autoregressive lag features are constructed strictly using indices:
   $$x_t = [y_{t-1}, y_{t-2}, y_{t-12}, \text{mean}(y_{t-3 \dots t-1})]$$
   The target is $y_t$. Under no circumstances does index $t$ or $t+1$ appear in the feature vector.
4. **Out-of-Sample Holdout Tournament**:
   Models are fit strictly on $y_{0 \dots T - H}$ and evaluated against held-out observations $y_{T - H \dots T}$.

---

## 5. Forecasting Models & Tournament Engine

### Transparent Baselines
1. **Last Observation Forecaster (Persistence Naive)**:
   $$\hat{y}_{T+h} = y_T$$
2. **Seasonal Naive Forecaster ($s=12$)**:
   $$\hat{y}_{T+h} = y_{T + h - 12}$$
3. **Moving Average Forecaster ($k=3$)**:
   $$\hat{y}_{T+h} = \frac{1}{k} \sum_{i=0}^{k-1} y_{T-i}$$
4. **Linear Trend Forecaster**:
   $$\hat{y}_{T+h} = \alpha + \beta \cdot (T + h)$$
   Fit via ordinary least squares over training periods.

### Candidate Statistical & ML Models
1. **Holt-Winters Forecaster (Multiplicative Seasonality, $s=12$)**:
   Implements triple exponential smoothing with level ($\alpha$), trend ($\beta$), and seasonal factors ($\gamma$). Requires at least 2 full annual cycles ($24$ months).
2. **Lagged Ridge Regression**:
   Supervised autoregressive linear model with L2 regularization ($\alpha=1.0$) trained on lags $[1, 2, 12]$ and a 3-month trailing rolling average. Multi-step forecasts use recursive autoregression.

### Model Tournament & Selection Rule
The tournament backtests all eligible baselines and candidate models on the holdout period.
- **Champion Selection Invariant**:
  A candidate model is chosen as champion **if and only if**:
  $$\text{MAE}_{\text{candidate}} \le 0.99 \times \text{MAE}_{\text{best\_baseline}}$$
  If no candidate achieves at least a **$1.0\%$ relative MAE improvement** over the best baseline, the transparent baseline is retained as champion with an explicit explanation:
  `"Retaining transparent baseline: No candidate model outperformed the best baseline by >= 1% lower MAE on holdout testing."`

---

## 6. Uncertainty Intervals

Uncertainty intervals (P10, P50, P90) provide an $80\%$ empirical confidence cone:
$$\text{Interval Spread} = \pm z_{0.80} \cdot \sigma_{\text{holdout\_residuals}} \cdot \sqrt{h}$$
where $z_{0.80} = 1.282$ and $h$ is the horizon step ($1 \dots H$).
- The interval spread expands monotonically with horizon steps $\sqrt{h}$ to reflect accumulating forecast variance.
- Guaranteed physical ordering: $P_{10} \le P_{50} \le P_{90}$.
- Floor at $0.0$ for non-negative energy metrics.

---

## 7. Dedicated Anomaly Detection Engine

The anomaly detection engine runs independently from forecasting, identifying unexpected variances in historical observations without conflating statistical outliers with operational blame.

### Anomaly Categories:
1. **`DATA_QUALITY_ANOMALY`**:
   - Negative values on positive-definite metrics.
   - Sudden drop to zero or flatlining across reporting intervals.
   - Severity: `CRITICAL`.
2. **`STATISTICAL_OUTLIER`**:
   - Evaluated via robust rolling median and Median Absolute Deviation (MAD):
     $$\text{Modified } Z = \frac{|y_t - \text{median}(y_{t-k \dots t-1})|}{1.4826 \times \text{MAD}}$$
   - Flags observations where $\text{Modified } Z \ge 3.0$.
   - Severity: `MEDIUM` ($3.0 \le Z < 3.5$), `HIGH` ($3.5 \le Z < 4.5$), `CRITICAL` ($Z \ge 4.5$).
3. **`TREND_SHIFT` / `OPERATIONAL_VARIANCE`**:
   - Compares observed values against historical calendar month averages ($s=12$).
   - Flags deviations exceeding $\pm 20\%$.
   - Severity: `MEDIUM` to `HIGH`.

### Non-Accusatory Language & Operational Steps
**Strict Invariant**: Anomaly alerts never use accusatory terms such as *"theft"*, *"fraud"*, *"corruption"*, *"malicious"*, *"equipment failure"*, or *"power shortage"*.
Alerts are framed neutrally as numerical deviations and provide operational verification steps:
- Review unseasonal agricultural irrigation power rationing schedule changes.
- Check regional temperature and cooling/heating degree day anomalies.
- Verify bulk industrial consumer commissioning or tariff schedule transitions.
- Confirm transmission wheeling dispatch boundary modifications.

### Cryptographic Deduplication
Every alert is hashed via SHA-256 over `(metric_id, geo_code, period, method)`:
$$\text{Alert ID} = \text{SHA256}(\text{metric}:\text{geo}:\text{period}:\text{method})[:16]$$
Ensures duplicate alerts are never emitted for the same underlying observation.

---

## 8. Solar Generation Forecasting & Limitations

### Installed Capacity vs. Actual Generation
- **Solar Capacity (MW)** represents nameplate rated power connected to the grid.
- **Solar Generation (MU)** represents actual energy generated over time.
- The pipeline models generation exclusively in **MU**, displaying installed capacity strictly as an exogenous reference.

### Honest Limitations:
1. **Absence of Satellite Irradiance Nowcasting**: The module explicitly documents that real-time satellite irradiance data is not integrated, and generation forecasts reflect historical cyclicality and seasonal trends.
2. **Sparse Real Data Detection**: In the current repository data (`solar_intelligence.json`), solar generation records for Karnataka and Andhra Pradesh have an intentional 9-month reporting gap between 2024-06 and 2025-04 ($60\%$ missing data).
   - `ForecastEligibilityEngine` detects this gap and marks solar forecasting **ineligible** on real repository data.
   - The UI and API display the exact diagnostic report rather than fabricating false projections.
   - On continuous series (e.g. synthetic fixtures or future continuous reports), the pipeline automatically activates and executes full tournaments.

---

## 9. API Reference & Usage Guide

```python
from avishkar_ems.predictive_service import PredictiveIntelligenceService

predictive_svc = PredictiveIntelligenceService()

# 1. Pre-flight demand eligibility check
eligibility = predictive_svc.check_demand_eligibility("KA", horizon_steps=6)
print(eligibility.is_eligible, eligibility.usable_observation_count)

# 2. Execute demand forecast tournament
tournament = predictive_svc.forecast_demand("KA", horizon_steps=6)
print("Champion Model:", tournament.champion_model_name)
print("Selection Reason:", tournament.selection_reason)
for p, p50 in zip(tournament.forecast_periods, tournament.forecast_p50):
    print(f"Period {p}: {p50:,.1f} MU")

# 3. Detect demand anomalies
anomalies = predictive_svc.detect_demand_anomalies("KA")
for a in anomalies:
    print(f"[{a.severity.value}] {a.period}: {a.explanation}")

# 4. Compare previously issued forecasts to subsequent actuals
eval_result = predictive_svc.compare_forecast_to_actuals(
    predicted_periods=["2024-07", "2024-08"],
    predicted_p50=[5200.0, 5400.0],
    actual_series=predictive_svc.get_demand_series("KA"),
)
print("Out-of-sample MAE:", eval_result["meanAbsoluteError"])
```

---

## 10. Steps for Adding a New Forecasting Model

To integrate a new time-series model (e.g. ARIMA, Prophet, or Gradient Boosting):
1. **Inherit from `BaseForecaster`** in `src/avishkar_ems/forecasting_engine.py`:
   - Implement `model_name`, `model_version`, and `is_baseline`.
   - Implement `fit(train_periods, train_values)` strictly on provided training data.
   - Implement `predict(horizon_steps)` returning `list[float]`.
2. **Register in `ModelTournamentEngine.run_tournament`**:
   - Add model instantiation to the candidates list.
3. **Verify Tournament Invariant**:
   - Ensure the model competes against baselines on holdout data.
   - It will only be crowned champion if its holdout MAE improves over the best baseline by $\ge 1.0\%$.
4. **Author Automated Leakage & Accuracy Tests** in `tests/avishkar_ems/test_predictive_intelligence.py`.
5. **Verify Clean Linter**: Run `ruff check src/avishkar_ems/forecasting_engine.py --no-fix`.
