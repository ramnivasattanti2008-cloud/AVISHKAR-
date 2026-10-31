# UrjaSetu EMS — Phase 14: Known Limitations & Scientific Caveats

## 1. Truth-in-Data & Scientific Principles
In accordance with UrjaSetu EMS core operating invariants, the Energy Data Science Lab explicitly documents its mathematical boundaries, dataset limitations, and operational caveats.

---

## 2. Documented Limitations

### A. Short Macroeconomic Time Series
- **Limitation**: Official state and national statutory series (such as CEA executive filings or KPTCL solar totals) are typically published on a monthly cadence, yielding 36 to 48 historical observations (3 to 4 years).
- **Impact**: While sufficient for baseline persistence, seasonal naive, and exponential smoothing, this sample size restricts deep neural network architectures (e.g. LSTM, Transformer). Deploying deep models on $< 50$ samples results in severe overfitting.
- **Mitigation**: The tournament prioritizes parsimonious models (Holt-Winters, Lagged Ridge) and automatically defaults to transparent baselines if sample history is $< 24$ months.

### B. Ground-Truth Anomaly Label Scarcity
- **Limitation**: In public utility telemetry, confirmed operational anomaly labels (e.g. verified feeder breaker trips, theft audit results, or technical line faults) are rarely published for consumer access.
- **Impact**: Classification metrics (Precision, Recall, F1) cannot be mathematically computed without ground-truth binary labels.
- **Mitigation**: UrjaSetu EMS strictly refuses to manufacture synthetic precision/recall scores on unlabeled telemetry. It evaluates defensible operational properties (alert frequency, stability across window sizes, and sensitivity gradient $\Delta\text{Alerts}/\Delta\theta$).

### C. Solar Insolation Microclimate Variance
- **Limitation**: PVGIS ERA5 reanalysis and NASA POWER satellite feeds provide $0.5^\circ \times 0.5^\circ$ spatial grid averages (~50 km resolution).
- **Impact**: Hyper-local rooftop shading, urban dust accumulation, building wind tunnels, and micro-cloud formations are not reflected in satellite reanalysis.
- **Mitigation**: Model results are explicitly classified as regional modeled yield ($1,450\text{ kWh/kWp/year}$) rather than guaranteed physical site generation.

### D. Single-Threaded Synchronous Execution
- **Limitation**: Experiments are executed synchronously within the active application runtime.
- **Impact**: Backtesting massive high-frequency datasets (e.g. multi-year 1-second phasor measurement unit data) would block the Streamlit event loop.
- **Mitigation**: The ingestion wizard enforces a 15 MB file size limit and limits holdout horizons to $\le 6$ steps, keeping execution duration below 2.0 seconds.

---

## 3. Production Operations Runbook

1. **Dataset Integrity Verification**:
   Before running a formal benchmark, check that the dataset's SHA-256 fingerprint matches statutory filings:
   ```python
   from avishkar_ems.data_science_lab import DatasetCatalogue
   cat = DatasetCatalogue()
   meta = cat.get_dataset("ds_national_demand_cea")
   print(f"Content SHA-256: {meta.content_sha256}")
   ```

2. **Conducting a Verified Forecasting Tournament**:
   ```python
   from avishkar_ems.data_science_lab import (
       DataScienceLabService,
       ExperimentConfig,
       ExperimentType,
       EvaluationMethodology,
   )

   service = DataScienceLabService()
   config = ExperimentConfig(
       experiment_id="exp_statutory_benchmark_001",
       name="CEA National Demand Tournament",
       objective="Evaluate out-of-sample holdout accuracy",
       experiment_type=ExperimentType.TIME_SERIES_FORECAST_BENCHMARK,
       dataset_id="ds_national_demand_cea",
       dataset_sha256=service.catalogue.get_dataset("ds_national_demand_cea").content_sha256,
       target_variable="energy_supplied_mu",
       input_features=["energy_supplied_mu"],
       time_range=("2021-01", "2024-12"),
       methodology=EvaluationMethodology.CHRONOLOGICAL_SPLIT,
       test_size_steps=4,
   )
   result = service.execute_experiment(config)
   print(f"Champion Model: {result.champion_model}")
   print(f"Artifact Saved: {result.artifact_references[0]}")
   ```

3. **Exporting Reproducible Research Report**:
   ```python
   report_md = service.generate_research_report("exp_statutory_benchmark_001")
   with open("benchmark_report.md", "w", encoding="utf-8") as f:
       f.write(report_md)
   ```
