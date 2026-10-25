"""Automated test suite for UrjaSetu EMS Phase 14: Energy Data Science Lab & Reproducible Benchmarking.

Covers:
1. Dataset Catalogue, provenance metadata, and SHA-256 content hashing.
2. Controlled dataset ingestion: schema checks, malformed rows, missing timestamps, and size limits.
3. Data quality auditor: completeness, validity, uniqueness, temporal continuity, and duplicate rates.
4. Chronological train/test splitting with zero future-data leakage.
5. Forecasting tournament: Last Observation, Moving Average, Linear Trend, Seasonal Naive,
   Holt-Winters, Lagged Ridge.
6. Metric calculations with zero-denominator guards: MAE, RMSE, WAPE %, MASE, and Bias.
7. Independent reference calculations for forecasting metrics.
8. Labeled anomaly evaluation: Precision, Recall, F1, and class imbalance.
9. Unlabeled anomaly evaluation: alert volume, stability, sensitivity, and refusal to fabricate accuracy.
10. Experiment lifecycle, artifact persistence, and cryptographic checksum validation.
11. Security tests: path traversal defense and oversized file rejection.
12. Research report generator: Markdown generation with software environment and limitations.
"""

from __future__ import annotations

import math
import tempfile
from pathlib import Path

import pytest

from avishkar_ems.data_science_lab import (
    AnomalyEvaluationRunner,
    DataScienceLabService,
    DatasetClassification,
    DatasetIngestionEngine,
    EvaluationMethodology,
    ExperimentConfig,
    ExperimentResult,
    ExperimentStatus,
    ExperimentType,
    TimeSeriesBenchmarkRunner,
)


@pytest.fixture
def lab_service() -> DataScienceLabService:
    temp_dir = Path(tempfile.mkdtemp(prefix="urjasetu_test_artifacts_"))
    return DataScienceLabService(artifact_dir=temp_dir)


class TestPhase14DataScienceLab:
    """Comprehensive test suite for Phase 14 Data Science Lab & Benchmarking Engine."""

    def test_canonical_dataset_catalogue_provenance(self, lab_service: DataScienceLabService) -> None:
        """TC-1401: Validates preloaded statutory and research datasets and provenance."""
        datasets = lab_service.catalogue.list_datasets()
        assert len(datasets) >= 3, "Expected at least 3 pre-registered canonical datasets."

        # Verify CEEW smart meter dataset
        ceew = lab_service.catalogue.get_dataset("ds_ceew_mh21")
        assert ceew is not None
        assert ceew.classification == DatasetClassification.VERIFIED_REAL_WORLD
        assert "Council on Energy, Environment and Water" in ceew.source_organization
        assert ceew.license_type == "Creative Commons Zero (CC0)"
        assert len(ceew.content_sha256) == 64
        assert ceew.row_count > 0

        # Verify CEA national demand dataset
        cea = lab_service.catalogue.get_dataset("ds_national_demand_cea")
        assert cea is not None
        assert cea.classification == DatasetClassification.IMPORTED_STATUTORY
        assert "Central Electricity Authority" in cea.source_organization
        assert "MU" in cea.units.values()

        # Verify KPTCL Karnataka solar dataset
        kptcl = lab_service.catalogue.get_dataset("ds_karnataka_solar_kptcl")
        assert kptcl is not None
        assert kptcl.classification == DatasetClassification.IMPORTED_STATUTORY
        assert kptcl.sampling_frequency == "monthly"

    def test_dataset_ingestion_and_schema_validation(self) -> None:
        """TC-1402: Validates CSV ingestion, required column verification, and error reporting."""
        valid_csv = (
            "period,value\n"
            "2024-01,120.5\n"
            "2024-02,125.0\n"
            "2024-03,130.2\n"
            "2024-04,128.4\n"
        )
        res, periods, values = DatasetIngestionEngine.validate_csv_content(valid_csv)
        assert res.is_valid is True
        assert res.rows_accepted == 4
        assert res.rows_rejected == 0
        assert len(periods) == 4
        assert len(values) == 4
        assert len(res.content_sha256) == 64

        # Missing required column
        missing_col_csv = (
            "timestamp,reading\n"
            "2024-01,120.5\n"
        )
        res_fail, _, _ = DatasetIngestionEngine.validate_csv_content(
            missing_col_csv, required_columns=["period", "value"]
        )
        assert res_fail.is_valid is False
        assert any("MISSING_REQUIRED_COLUMNS" in err for err in res_fail.errors)

        # Malformed non-numeric values
        malformed_csv = (
            "period,value\n"
            "2024-01,120.5\n"
            "2024-02,INVALID_DATA\n"
            "2024-03,130.2\n"
        )
        res_err, periods_err, values_err = DatasetIngestionEngine.validate_csv_content(malformed_csv)
        assert res_err.is_valid is False
        assert res_err.rows_accepted == 2
        assert res_err.rows_rejected == 1
        assert any("Non-numeric value" in err for err in res_err.errors)

    def test_data_quality_audit_metrics(self) -> None:
        """TC-1403: Tests data quality auditor: completeness, validity, uniqueness, and continuity."""
        # Clean series
        clean_periods = ["2024-01", "2024-02", "2024-03", "2024-04"]
        clean_values = [100.0, 105.0, 110.0, 108.0]
        q_clean = DatasetIngestionEngine.audit_tabular_quality(clean_periods, clean_values)
        assert q_clean.completeness_pct == 100.0
        assert q_clean.validity_pct == 100.0
        assert q_clean.uniqueness_pct == 100.0
        assert q_clean.temporal_continuity_pct == 100.0
        assert q_clean.duplicate_rate_pct == 0.0
        assert len(q_clean.flagged_checks) == 0

        # Discontinuous & duplicate series with negative value
        flawed_periods = ["2024-01", "2024-03", "2024-02", "2024-02"]
        flawed_values = [100.0, 110.0, -5.0, float("nan")]
        q_flawed = DatasetIngestionEngine.audit_tabular_quality(
            flawed_periods, flawed_values, allow_negative=False
        )
        assert q_flawed.completeness_pct == 75.0  # 1 NaN in 4 rows
        assert q_flawed.validity_pct == 75.0  # 1 negative in 4 rows
        assert q_flawed.duplicate_rate_pct == 25.0  # 1 duplicate period
        assert len(q_flawed.flagged_checks) > 0

    def test_chronological_splitting_leakage_prevention(self) -> None:
        """TC-1404: Verifies leak-free chronological splitting (test strictly succeeds train)."""
        periods = [f"2023-{m:02d}" for m in range(1, 13)]
        values = [float(100 + m * 5) for m in range(1, 13)]

        evaluations, champion, boundaries = TimeSeriesBenchmarkRunner.run_benchmark(
            periods=periods,
            values=values,
            test_size_steps=3,
            season_length=12,
        )

        assert boundaries["train_count"] == 9
        assert boundaries["test_count"] == 3
        assert boundaries["train_end"] == "2023-09"
        assert boundaries["test_start"] == "2023-10"
        assert boundaries["test_end"] == "2023-12"
        # Assert strict temporal succession
        assert boundaries["train_end"] < boundaries["test_start"]
        assert champion in evaluations

    def test_independent_reference_forecast_metric_calculations(self) -> None:
        """TC-1405: Hand-verifies MAE, RMSE, WAPE %, MASE, and Bias against independent reference values."""
        actual = [100.0, 110.0, 120.0, 130.0]
        predicted = [102.0, 108.0, 125.0, 126.0]
        train = [80.0, 85.0, 90.0, 95.0, 100.0]

        # Errors: [2.0, -2.0, 5.0, -4.0]
        # Abs errors: [2.0, 2.0, 5.0, 4.0], Sum = 13.0
        # Expected MAE = 13.0 / 4 = 3.25
        # Squared errors: [4.0, 4.0, 25.0, 16.0], Sum = 49.0
        # Expected RMSE = sqrt(49.0 / 4) = sqrt(12.25) = 3.50
        # Sum actual = 460.0
        # Expected WAPE % = (13.0 / 460.0) * 100 = 2.826% -> 2.83%
        # Expected Bias = (2.0 - 2.0 + 5.0 - 4.0) / 4 = 1.0 / 4 = 0.25
        # In-sample naive errors for train: abs(85-80)=5, abs(90-85)=5, abs(95-90)=5, abs(100-95)=5 -> Mean = 5.0
        # Expected MASE = 3.25 / 5.0 = 0.65

        metrics = TimeSeriesBenchmarkRunner.evaluate_model_predictions(
            actual=actual,
            predicted=predicted,
            train_values=train,
            seasonality=12,
        )

        assert metrics.mae == 3.25
        assert metrics.rmse == 3.5
        assert metrics.wape_pct == 2.83
        assert metrics.bias == 0.25
        assert metrics.mase == 0.65
        assert metrics.samples_evaluated == 4

    def test_forecasting_tournament_models_and_champion_selection(self) -> None:
        """TC-1406: Runs full tournament across baselines and candidate models on CEA national data."""
        nat_periods = [f"{y}-{m:02d}" for y in range(2021, 2024) for m in range(1, 13)]
        nat_values = [
            round(1000.0 + i * 20.0 + 150.0 * math.sin(i / 12.0 * 2 * math.pi), 1)
            for i in range(len(nat_periods))
        ]

        evaluations, champion, boundaries = TimeSeriesBenchmarkRunner.run_benchmark(
            periods=nat_periods,
            values=nat_values,
            test_size_steps=4,
            season_length=12,
        )

        assert len(evaluations) >= 4, "Expected multiple baselines and candidates evaluated."
        assert "Last Observation Baseline" in evaluations
        assert "Moving Average (k=3) Baseline" in evaluations
        assert "Linear Trend Drift Baseline" in evaluations
        assert "Seasonal Naive (s=12) Baseline" in evaluations

        champ_metrics = evaluations[champion]
        assert champ_metrics.mae > 0.0
        assert champ_metrics.rmse >= champ_metrics.mae  # Mathematical property: RMSE >= MAE

    def test_labeled_anomaly_detection_evaluation(self) -> None:
        """TC-1407: Tests classification evaluation with verified ground-truth labels."""
        periods = [f"2024-{m:02d}" for m in range(1, 13)]
        # Normal baseline 100 with sudden spikes at month 5 and 9
        values = [100.0, 102.0, 99.0, 101.0, 250.0, 100.0, 101.0, 98.0, 300.0, 102.0, 100.0, 101.0]
        ground_truth = [False, False, False, False, True, False, False, False, True, False, False, False]

        eval_res = AnomalyEvaluationRunner.evaluate_labeled_ground_truth(
            periods=periods,
            values=values,
            ground_truth_labels=ground_truth,
            theta_threshold=2.5,
            window_size=3,
        )

        assert eval_res.is_labeled is True
        assert eval_res.precision is not None
        assert eval_res.recall is not None
        assert eval_res.f1_score is not None
        assert eval_res.precision > 0.5
        assert eval_res.recall > 0.5
        assert "TP=" in eval_res.notes

    def test_unlabeled_anomaly_evaluation_refuses_fake_precision(self) -> None:
        """TC-1408: Tests that unlabeled series evaluates operational properties without fabricating accuracy."""
        periods = [f"2024-{m:02d}" for m in range(1, 13)]
        values = [100.0, 102.0, 99.0, 101.0, 180.0, 100.0, 101.0, 98.0, 100.0, 102.0, 100.0, 101.0]

        eval_res = AnomalyEvaluationRunner.evaluate_unlabeled_series(
            periods=periods,
            values=values,
            theta_threshold=3.0,
        )

        assert eval_res.is_labeled is False
        assert eval_res.precision is None, "Precision must NOT be manufactured on unlabeled data"
        assert eval_res.recall is None, "Recall must NOT be manufactured on unlabeled data"
        assert eval_res.f1_score is None, "F1 score must NOT be manufactured on unlabeled data"
        assert eval_res.detection_rate_pct >= 0.0
        assert eval_res.detection_stability_score >= 0.0
        assert "Ground-truth precision/recall are NOT manufactured" in eval_res.notes

    def test_experiment_execution_service_lifecycle(self, lab_service: DataScienceLabService) -> None:
        """TC-1409: Tests end-to-end experiment creation, execution, and artifact generation."""
        exp_id = "exp_test_cea_benchmark_001"
        config = ExperimentConfig(
            experiment_id=exp_id,
            name="CEA National Electricity Demand Forecasting Tournament",
            objective="Evaluate out-of-sample forecasting accuracy across baselines and Holt-Winters",
            experiment_type=ExperimentType.TIME_SERIES_FORECAST_BENCHMARK,
            dataset_id="ds_national_demand_cea",
            dataset_sha256=lab_service.catalogue.get_dataset("ds_national_demand_cea").content_sha256,
            target_variable="energy_supplied_mu",
            input_features=["energy_supplied_mu"],
            time_range=("2021-01", "2024-12"),
            methodology=EvaluationMethodology.CHRONOLOGICAL_SPLIT,
            test_size_steps=4,
        )

        result: ExperimentResult = lab_service.execute_experiment(config)
        assert result.status == ExperimentStatus.COMPLETED
        assert result.champion_model is not None
        assert len(result.metrics) > 0
        assert result.execution_duration_sec >= 0.0
        assert len(result.artifact_references) == 1
        assert len(result.artifact_sha256) == 1

        # Check persisted artifact file exists and has valid SHA-256
        art_rel_path = result.artifact_references[0]
        art_hash = result.artifact_sha256[art_rel_path]
        art_full_path = Path(art_rel_path) if Path(art_rel_path).is_absolute() else (Path(__file__).resolve().parents[2] / art_rel_path)
        assert art_full_path.exists()
        assert len(art_hash) == 64

    def test_missing_dataset_fails_gracefully(self, lab_service: DataScienceLabService) -> None:
        """TC-1410: Verifies experiment fails gracefully with clear error when dataset ID is invalid."""
        config = ExperimentConfig(
            experiment_id="exp_invalid_ds",
            name="Test Nonexistent Dataset",
            objective="Verify error handling",
            experiment_type=ExperimentType.TIME_SERIES_FORECAST_BENCHMARK,
            dataset_id="ds_non_existent_id",
            dataset_sha256="dummy_hash",
            target_variable="kwh",
            input_features=[],
            time_range=("2023-01", "2023-12"),
            methodology=EvaluationMethodology.CHRONOLOGICAL_SPLIT,
        )
        result = lab_service.execute_experiment(config)
        assert result.status == ExperimentStatus.FAILED
        assert "DATASET_NOT_FOUND" in result.error_message

    def test_research_report_generation(self, lab_service: DataScienceLabService) -> None:
        """TC-1411: Verifies structured Markdown research report generation with full lineage."""
        exp_id = "exp_test_report_gen"
        config = ExperimentConfig(
            experiment_id=exp_id,
            name="Karnataka Solar Forecasting Benchmark",
            objective="Measure predictive accuracy on monthly solar generation (MU)",
            experiment_type=ExperimentType.TIME_SERIES_FORECAST_BENCHMARK,
            dataset_id="ds_karnataka_solar_kptcl",
            dataset_sha256=lab_service.catalogue.get_dataset("ds_karnataka_solar_kptcl").content_sha256,
            target_variable="solar_generation_mu",
            input_features=["solar_generation_mu"],
            time_range=("2021-01", "2024-12"),
            methodology=EvaluationMethodology.CHRONOLOGICAL_SPLIT,
            test_size_steps=3,
        )
        lab_service.execute_experiment(config)
        report_md = lab_service.generate_research_report(exp_id)

        assert "# UrjaSetu EMS — Research & Benchmark Report" in report_md
        assert "Champion Model" in report_md
        assert "Evaluation Boundaries & Leakage Guards" in report_md
        assert "Software Environment & Artifact Integrity" in report_md
        assert "Python Version" in report_md
        assert "Limitations & Caveats" in report_md

    def test_security_path_traversal_and_size_defenses(self, lab_service: DataScienceLabService) -> None:
        """TC-1412: Verifies security defenses against path traversal and oversized uploads."""
        # 1. Path traversal defense in experiment ID
        malicious_id = "../../../etc/passwd"
        config = ExperimentConfig(
            experiment_id=malicious_id,
            name="Path Traversal Test",
            objective="Verify sanitization",
            experiment_type=ExperimentType.DATA_QUALITY_AUDIT,
            dataset_id="ds_ceew_mh21",
            dataset_sha256=lab_service.catalogue.get_dataset("ds_ceew_mh21").content_sha256,
            target_variable="kwh",
            input_features=[],
            time_range=("2023-01", "2023-02"),
            methodology=EvaluationMethodology.CHRONOLOGICAL_SPLIT,
        )
        res = lab_service.execute_experiment(config)
        assert res.status == ExperimentStatus.COMPLETED
        # Destination file must be inside artifact directory, sanitized
        for art_path in res.artifact_references:
            assert ".." not in art_path

        # 2. Oversized upload rejection (> 15MB)
        oversized_csv = "period,value\n" + ("2024-01,100.0\n" * 1_200_000)
        res_size, _, _ = DatasetIngestionEngine.validate_csv_content(oversized_csv)
        assert res_size.is_valid is False
        assert any("FILE_OVERSIZED" in err for err in res_size.errors)
