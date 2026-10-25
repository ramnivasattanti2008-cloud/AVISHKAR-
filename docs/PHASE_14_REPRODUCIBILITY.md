# UrjaSetu EMS — Phase 14: Reproducibility & Artifact Management

## 1. Reproducibility Guarantee
In UrjaSetu EMS, an energy analytics experiment is reproducible if and only if an independent researcher or auditor can recreate the identical numerical evaluation metrics given:
1. The exact raw dataset identified by its SHA-256 content hash.
2. The normalized experiment configuration JSON payload.
3. The recorded random seed and chronological split boundaries.
4. The declared host software environment and package dependencies.

---

## 2. Immutable Experiment Artifact Schema

Every experiment executed by [DataScienceLabService](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/data_science_lab.py) persists an immutable artifact bundle under `results/experiments/exp_{experiment_id}.json`.

### JSON Artifact Specification
```json
{
  "experiment_id": "exp_ds_national_demand_cea_1730000000",
  "status": "COMPLETED",
  "config": {
    "experiment_id": "exp_ds_national_demand_cea_1730000000",
    "name": "CEA National Electricity Demand Forecasting Tournament",
    "objective": "Evaluate out-of-sample forecasting accuracy across baselines and Holt-Winters",
    "experiment_type": "TIME_SERIES_FORECAST_BENCHMARK",
    "dataset_id": "ds_national_demand_cea",
    "dataset_sha256": "4b61183cfbb96bbefd1945a55755139a038c353f49557bfa3ffceb8ab3c9a2c3",
    "target_variable": "energy_supplied_mu",
    "input_features": ["energy_supplied_mu"],
    "time_range": ["2021-01", "2024-12"],
    "methodology": "CHRONOLOGICAL_SPLIT",
    "test_size_steps": 4,
    "models_to_evaluate": [],
    "random_seed": 42,
    "parameters": {"season_length": 12},
    "created_timestamp": "2026-10-24T10:48:00.000000Z"
  },
  "start_time": "2026-10-24T10:48:00.100000Z",
  "end_time": "2026-10-24T10:48:00.180000Z",
  "execution_duration_sec": 0.08,
  "metrics": {
    "Last Observation Baseline": {
      "mae": 3200.5,
      "rmse": 3840.2,
      "wape_pct": 2.45,
      "mase": 1.12,
      "bias": -850.2,
      "samples_evaluated": 4,
      "relative_improvement_pct": null
    },
    "Holt-Winters Exponential Smoothing (s=12)": {
      "mae": 1420.2,
      "rmse": 1680.4,
      "wape_pct": 1.09,
      "mase": 0.497,
      "bias": 110.5,
      "samples_evaluated": 4,
      "relative_improvement_pct": 55.6
    }
  },
  "champion_model": "Holt-Winters Exponential Smoothing (s=12)",
  "baseline_comparisons": {
    "Last Observation Baseline": 1780.3,
    "Moving Average (k=3) Baseline": 2100.4
  },
  "split_boundaries": {
    "train_start": "2021-01",
    "train_end": "2024-08",
    "train_count": 44,
    "test_start": "2024-09",
    "test_end": "2024-12",
    "test_count": 4,
    "holdout_steps": 4
  },
  "artifact_references": ["results/experiments/exp_ds_national_demand_cea_1730000000.json"],
  "artifact_sha256": {
    "results/experiments/exp_ds_national_demand_cea_1730000000.json": "d9e8f...a1b2"
  },
  "software_environment": {
    "python_version": "3.12.10",
    "platform_system": "Windows",
    "platform_release": "11",
    "architecture": "AMD64",
    "app_version": "14.0.0"
  },
  "limitations": [
    "Excludes captive industrial power plants without grid injection.",
    "Subject to post-audit reconciliation in CEA annual power review."
  ]
}
```

---

## 3. Security & Anti-Tampering Safeguards
1. **Path Traversal Protection**: Experiment identifiers are rigorously sanitized with regex `re.sub(r"[^\w\-]", "_", exp_id)`, prohibiting directory escape sequences (`../` or `..\`). Destination paths must verify `target_path.startswith(artifact_dir)`.
2. **Execution Sandboxing**: Experiment runners **strictly execute built-in, vetted Python model classes**. User-submitted raw scripts, shell commands, or arbitrary dynamic `eval()`/`exec()` calls are strictly blocked.
3. **Artifact Integrity Verification**: When an experiment artifact is exported or re-read, its content is re-hashed with SHA-256 to ensure zero bit-level tampering.
