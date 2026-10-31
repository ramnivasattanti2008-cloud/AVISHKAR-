"""Comprehensive Automated Test Suite for Phase 8: Predictive Energy Intelligence, Forecasting & Anomaly Detection.

Verifies:
1. Data eligibility checks (cadence, minimum sample thresholds, gaps, negative values, unmapped metrics, anti-downscaling).
2. Temporal validation & data leakage prevention (chronological splitting, walk-forward validation, lag feature construction, leakage detection assertion).
3. Transparent baselines (last observation, seasonal naive, moving average, linear trend).
4. Candidate statistical & ML models (Holt-Winters exponential smoothing, Lagged Ridge regression).
5. Model tournament engine (out-of-sample holdout validation, baseline retention invariant, uncertainty intervals).
6. Anomaly detection engine (data quality anomalies, rolling MAD outliers, seasonal residual variance, deduplication, non-accusatory language invariant).
7. Solar generation forecasting (capacity vs generation separation, weather nowcasting absence caveat).
8. Unified PredictiveIntelligenceService orchestration and forecast-to-actuals comparison.
"""

from __future__ import annotations

import pytest

from avishkar_ems.anomaly_detector import (
    AnomalyCategory,
    AnomalyDetectionEngine,
    AnomalySeverity,
)
from avishkar_ems.energy_balance import EnergyBalanceAnalyzer
from avishkar_ems.forecast_eligibility import (
    ForecastEligibilityEngine,
    ForecastEligibilityReport,
)
from avishkar_ems.forecasting_engine import (
    HoltWintersForecaster,
    LaggedRidgeForecaster,
    LastObservationForecaster,
    LinearTrendForecaster,
    ModelTournamentEngine,
    MovingAverageForecaster,
    SeasonalNaiveForecaster,
)
from avishkar_ems.predictive_service import PredictiveIntelligenceService
from avishkar_ems.solar_forecast import SolarForecastingPipeline
from avishkar_ems.solar_intel import SolarIntelligenceEngine
from avishkar_ems.temporal_validation import (
    TemporalValidationEngine,
)
from avishkar_ems.time_series_trends import TimeSeriesPoint

# =====================================================================
# Fixtures
# =====================================================================


@pytest.fixture
def eligibility_engine() -> ForecastEligibilityEngine:
    return ForecastEligibilityEngine()


@pytest.fixture
def temporal_engine() -> TemporalValidationEngine:
    return TemporalValidationEngine()


@pytest.fixture
def tournament_engine() -> ModelTournamentEngine:
    return ModelTournamentEngine(season_length=12)


@pytest.fixture
def anomaly_engine() -> AnomalyDetectionEngine:
    return AnomalyDetectionEngine()


@pytest.fixture
def solar_pipeline() -> SolarForecastingPipeline:
    return SolarForecastingPipeline()


@pytest.fixture
def predictive_service() -> PredictiveIntelligenceService:
    return PredictiveIntelligenceService()


@pytest.fixture
def balance_analyzer() -> EnergyBalanceAnalyzer:
    return EnergyBalanceAnalyzer()


@pytest.fixture
def solar_engine() -> SolarIntelligenceEngine:
    return SolarIntelligenceEngine()


@pytest.fixture
def sample_24m_series() -> list[TimeSeriesPoint]:
    """Generates 24 months of synthetic monthly demand observations (2023-01 to 2024-12)."""
    points = []
    # Base 5000 MU with monthly seasonal fluctuation + mild trend
    seasonal_factors = [0.95, 0.98, 1.05, 1.10, 1.15, 1.02, 0.96, 0.94, 0.97, 1.01, 0.93, 0.94]
    for year in [2023, 2024]:
        for month in range(1, 13):
            period = f"{year}-{month:02d}"
            base = 5000.0 + ((year - 2023) * 12 + month) * 20.0
            val = base * seasonal_factors[month - 1]
            points.append(
                TimeSeriesPoint(
                    period=period,
                    value=round(val, 2),
                    unit="MU",
                    source_ref="CEA_SYNTHETIC_TEST_FIXTURE",
                )
            )
    return points


# =====================================================================
# 1. Data Eligibility Tests
# =====================================================================


class TestForecastEligibility:
    def test_valid_series_eligible(
        self, eligibility_engine: ForecastEligibilityEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        report: ForecastEligibilityReport = eligibility_engine.check_eligibility(
            sample_24m_series,
            metric_id="ENERGY_REQUIREMENT",
            geo_code="KA",
            target_horizon=6,
        )
        assert report.is_eligible is True
        assert report.usable_observation_count == 24
        assert report.missing_percentage == 0.0
        assert report.min_additional_data_required == 0
        assert "SeasonalNaiveBaseline" in report.eligible_model_classes
        assert "HoltWintersForecaster" in report.eligible_model_classes

    def test_insufficient_history_rejected(
        self, eligibility_engine: ForecastEligibilityEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        short_series = sample_24m_series[:4]  # Only 4 observations (< 6)
        report = eligibility_engine.check_eligibility(
            short_series,
            metric_id="ENERGY_REQUIREMENT",
            geo_code="KA",
            target_horizon=6,
        )
        assert report.is_eligible is False
        assert report.min_additional_data_required == 2
        assert any("Insufficient historical samples" in r for r in report.rejection_reasons)

    def test_large_gaps_rejected(
        self, eligibility_engine: ForecastEligibilityEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        # Create a series with a large gap in the middle
        gapped_series = sample_24m_series[:6] + sample_24m_series[14:]  # 8 months dropped
        report = eligibility_engine.check_eligibility(
            gapped_series,
            metric_id="ENERGY_REQUIREMENT",
            geo_code="KA",
            target_horizon=6,
        )
        assert report.is_eligible is False
        assert report.missing_percentage > 25.0
        assert any("High missing-data rate" in r for r in report.rejection_reasons)

    def test_negative_values_rejected(
        self, eligibility_engine: ForecastEligibilityEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        corrupted = list(sample_24m_series)
        corrupted[10] = TimeSeriesPoint(
            period="2023-11",
            value=-120.0,
            unit="MU",
        )
        report = eligibility_engine.check_eligibility(
            corrupted,
            metric_id="ENERGY_REQUIREMENT",
            geo_code="KA",
            target_horizon=6,
        )
        assert report.is_eligible is False
        assert any("negative observation" in r for r in report.rejection_reasons)

    def test_unmapped_metric_rejected(
        self, eligibility_engine: ForecastEligibilityEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        report = eligibility_engine.check_eligibility(
            sample_24m_series,
            metric_id="UNKNOWN_METRIC_XYZ",
            geo_code="KA",
            target_horizon=6,
        )
        assert report.is_eligible is False
        assert any("is not registered" in r for r in report.rejection_reasons)

    def test_district_downscaling_prohibited(
        self, eligibility_engine: ForecastEligibilityEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        report = eligibility_engine.check_eligibility(
            sample_24m_series,
            metric_id="ENERGY_REQUIREMENT",
            geo_code="KA_BLR_URBAN",  # District scope
            target_horizon=6,
        )
        assert report.is_eligible is False
        assert any("DATA HONESTY INVARIANT" in r for r in report.rejection_reasons)


# =====================================================================
# 2. Temporal Validation & Data Leakage Prevention Tests
# =====================================================================


class TestTemporalValidationAndLeakage:
    def test_chronological_split(
        self, temporal_engine: TemporalValidationEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series]
        values = [p.value for p in sample_24m_series]
        split = temporal_engine.chronological_split(periods, values, test_size=6)
        assert len(split.train_periods) == 18
        assert len(split.test_periods) == 6
        assert split.train_periods[-1] == "2024-06"
        assert split.test_periods[0] == "2024-07"

    def test_walk_forward_splits(
        self, temporal_engine: TemporalValidationEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series]
        values = [p.value for p in sample_24m_series]
        splits = temporal_engine.walk_forward_splits(
            periods, values, min_train_size=12, horizon=3, step=3
        )
        assert len(splits) == 4
        # Verify expanding train windows and non-overlapping test windows
        for i, s in enumerate(splits):
            assert len(s.test_values) == 3
            if i > 0:
                assert len(s.train_values) > len(splits[i - 1].train_values)

    def test_construct_lag_features_strict_backward(
        self, temporal_engine: TemporalValidationEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        values = [p.value for p in sample_24m_series]
        X, y = temporal_engine.construct_lag_features(
            values, lags=[1, 2, 3], include_rolling_mean=True, rolling_window=3
        )
        # Because max lag is 3 and rolling_window is 3, first 3 points are dropped
        assert len(X) == 21
        assert len(y) == 21
        # Check first row values correspond to lags 1, 2, 3 of index 3 (value at index 3 is y[0])
        assert X[0][0] == values[2]  # lag 1
        assert X[0][1] == values[1]  # lag 2
        assert X[0][2] == values[0]  # lag 3
        # Rolling mean over [values[0], values[1], values[2]]
        assert round(X[0][3], 2) == round(sum(values[:3]) / 3.0, 2)

    def test_assert_no_temporal_leakage_clean(
        self, temporal_engine: TemporalValidationEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series]
        values = [p.value for p in sample_24m_series]
        split = temporal_engine.chronological_split(periods, values, test_size=6)
        # Must pass without error
        temporal_engine.assert_no_temporal_leakage(split.train_periods, split.test_periods)

    def test_assert_no_temporal_leakage_detects_leak(
        self, temporal_engine: TemporalValidationEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series]
        # Invert order to contaminate training with future dates
        train_leaked = periods[:12] + [periods[20]]  # 2024-09 inside train
        test_periods = periods[12:18]  # 2024-01 to 2024-06

        with pytest.raises(ValueError) as exc_info:
            temporal_engine.assert_no_temporal_leakage(train_leaked, test_periods)
        assert "TEMPORAL LEAKAGE DETECTED" in str(exc_info.value)

    def test_compute_metrics(
        self, temporal_engine: TemporalValidationEngine
    ) -> None:
        actual = [100.0, 110.0, 120.0, 130.0]
        predicted = [102.0, 108.0, 125.0, 128.0]
        metrics = temporal_engine.compute_evaluation_metrics(actual, predicted)
        assert round(metrics.mae, 2) == 2.75
        assert round(metrics.rmse, 2) == 3.04
        assert round(metrics.bias, 2) == 0.75
        assert metrics.wape_pct > 0.0


# =====================================================================
# 3. Transparent Baselines Tests
# =====================================================================


class TestForecastingBaselines:
    def test_last_observation_forecaster(
        self, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series[:18]]
        values = [p.value for p in sample_24m_series[:18]]
        model = LastObservationForecaster()
        model.fit(periods, values)
        forecast = model.predict(horizon_steps=6)
        assert len(forecast) == 6
        assert all(f == values[-1] for f in forecast)

    def test_seasonal_naive_forecaster(
        self, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series[:18]]
        values = [p.value for p in sample_24m_series[:18]]
        model = SeasonalNaiveForecaster(season_length=12)
        model.fit(periods, values)
        forecast = model.predict(horizon_steps=6)
        assert len(forecast) == 6
        for step, f_val in enumerate(forecast):
            target_idx = 18 + step - 12
            assert f_val == values[target_idx]

    def test_moving_average_forecaster(
        self, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series[:18]]
        values = [p.value for p in sample_24m_series[:18]]
        model = MovingAverageForecaster(window_size=3)
        model.fit(periods, values)
        forecast = model.predict(horizon_steps=4)
        assert len(forecast) == 4
        expected_mean = sum(values[-3:]) / 3.0
        assert round(forecast[0], 2) == round(expected_mean, 2)

    def test_linear_trend_forecaster(
        self, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series[:18]]
        values = [p.value for p in sample_24m_series[:18]]
        model = LinearTrendForecaster()
        model.fit(periods, values)
        forecast = model.predict(horizon_steps=6)
        assert len(forecast) == 6
        # Data has positive trend, forecast must be increasing
        for i in range(1, len(forecast)):
            assert forecast[i] > forecast[i - 1]


# =====================================================================
# 4. Candidate Statistical & ML Models Tests
# =====================================================================


class TestCandidateModels:
    def test_holt_winters_forecaster(
        self, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series]
        values = [p.value for p in sample_24m_series]
        model = HoltWintersForecaster(season_length=12)
        model.fit(periods, values)
        forecast = model.predict(horizon_steps=6)
        assert len(forecast) == 6
        assert all(f > 0.0 for f in forecast)

    def test_lagged_ridge_forecaster(
        self, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series[:18]]
        values = [p.value for p in sample_24m_series[:18]]
        model = LaggedRidgeForecaster(lags=[1, 2, 12])
        model.fit(periods, values)
        forecast = model.predict(horizon_steps=6)
        assert len(forecast) == 6
        assert all(f > 0.0 for f in forecast)


# =====================================================================
# 5. Model Tournament & Uncertainty Intervals Tests
# =====================================================================


class TestModelTournamentEngine:
    def test_tournament_execution_and_champion_selection(
        self, tournament_engine: ModelTournamentEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series]
        values = [p.value for p in sample_24m_series]
        res = tournament_engine.run_tournament(
            periods=periods,
            values=values,
            target_metric="ENERGY_REQUIREMENT",
            geo_code="KA",
            horizon_steps=6,
            holdout_steps=3,
        )
        assert len(res.forecast_periods) == 6
        assert len(res.forecast_p50) == 6
        assert len(res.all_model_evaluations) >= 4
        assert res.champion_model_name != ""
        assert res.selection_reason != ""

    def test_uncertainty_intervals_structure_and_expansion(
        self, tournament_engine: ModelTournamentEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        periods = [p.period for p in sample_24m_series]
        values = [p.value for p in sample_24m_series]
        res = tournament_engine.run_tournament(
            periods=periods,
            values=values,
            target_metric="ENERGY_REQUIREMENT",
            geo_code="KA",
            horizon_steps=6,
            holdout_steps=3,
        )
        for p10, p50, p90 in zip(res.forecast_p10, res.forecast_p50, res.forecast_p90, strict=True):
            assert p10 <= p50 <= p90

        # Horizon step 6 band must be wider than step 1 band due to sqrt(h) scaling
        spread_1 = res.forecast_p90[0] - res.forecast_p10[0]
        spread_6 = res.forecast_p90[5] - res.forecast_p10[5]
        assert spread_6 > spread_1


# =====================================================================
# 6. Anomaly Detection Engine Tests
# =====================================================================


class TestAnomalyDetectionEngine:
    def test_detect_data_quality_anomalies(
        self, anomaly_engine: AnomalyDetectionEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        corrupted = list(sample_24m_series)
        corrupted[5] = TimeSeriesPoint(
            period="2023-06",
            value=-50.0,
            unit="MU",
        )
        corrupted[15] = TimeSeriesPoint(
            period="2024-04",
            value=0.0,
            unit="MU",
        )

        anomalies = anomaly_engine.detect_data_quality_anomalies(corrupted, "ENERGY_REQUIREMENT", "KA")
        assert len(anomalies) == 2
        assert anomalies[0].category == AnomalyCategory.DATA_QUALITY_ANOMALY
        assert anomalies[0].severity == AnomalySeverity.CRITICAL

    def test_detect_rolling_mad_outliers(
        self, anomaly_engine: AnomalyDetectionEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        # Inject extreme 4-sigma spike
        spiked = list(sample_24m_series)
        spiked[18] = TimeSeriesPoint(
            period="2024-07",
            value=12000.0,
            unit="MU",
        )
        anomalies = anomaly_engine.detect_rolling_mad_anomalies(spiked, "ENERGY_REQUIREMENT", "KA")
        outliers = [a for a in anomalies if a.category == AnomalyCategory.STATISTICAL_OUTLIER]
        assert len(outliers) >= 1
        assert any(a.period == "2024-07" for a in outliers)

    def test_run_all_detectors_deduplication(
        self, anomaly_engine: AnomalyDetectionEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        spiked = list(sample_24m_series)
        spiked[18] = TimeSeriesPoint(
            period="2024-07",
            value=12000.0,
            unit="MU",
        )
        anomalies = anomaly_engine.run_all_detectors(spiked, "ENERGY_REQUIREMENT", "KA")
        hashes = [a.anomaly_id for a in anomalies]
        assert len(hashes) == len(set(hashes)), "Anomalies must be deduplicated by alert hash"

    def test_non_accusatory_explanation_invariant(
        self, anomaly_engine: AnomalyDetectionEngine, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        """STRICT INVARIANT: Anomaly alerts must NEVER label a variance as theft, fraud, corruption, or failure."""
        spiked = list(sample_24m_series)
        spiked[18] = TimeSeriesPoint(
            period="2024-07",
            value=12000.0,
            unit="MU",
        )
        anomalies = anomaly_engine.run_all_detectors(spiked, "ENERGY_REQUIREMENT", "KA")

        prohibited_words = ["theft", "fraud", "corruption", "malicious", "equipment failure", "power shortage"]
        for a in anomalies:
            explanation_lower = a.explanation.lower()
            for word in prohibited_words:
                assert word not in explanation_lower, f"Prohibited accusatory word '{word}' found in explanation: {a.explanation}"
            assert len(a.recommended_verification_steps) > 0


# =====================================================================
# 7. Solar Generation Forecasting Tests
# =====================================================================


class TestSolarForecastingPipeline:
    def test_solar_forecast_generation_only(
        self, solar_pipeline: SolarForecastingPipeline, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        # Real repo solar data has 60% gaps -> must raise ValueError with data honesty reason
        with pytest.raises(ValueError) as exc_info:
            solar_pipeline.forecast_solar_generation(
                region_code="KA",
                horizon_steps=6,
            )
        assert "High missing-data rate" in str(exc_info.value)

        # On an eligible continuous series, forecasts solar generation successfully
        res = solar_pipeline.forecast_solar_generation(
            region_code="KA",
            horizon_steps=6,
            series=sample_24m_series,
            installed_capacity_mw=7500.0,
        )
        assert res.target_metric == "SOLAR_GENERATION"
        assert res.target_unit == "MU"
        assert res.is_weather_informed is False
        assert res.installed_capacity_mw == 7500.0
        assert len(res.tournament_result.forecast_periods) == 6
        assert any("DECOUPLED" in c.upper() or "MU" in c for c in res.caveats)


# =====================================================================
# 8. Unified Predictive Intelligence Service Tests
# =====================================================================


class TestPredictiveIntelligenceService:
    def test_end_to_end_demand_forecasting_karnataka(
        self, predictive_service: PredictiveIntelligenceService
    ) -> None:
        # Pre-flight eligibility
        eligibility = predictive_service.check_demand_eligibility("KA", horizon_steps=6)
        assert eligibility.is_eligible is True

        # Tournament & forecast
        tournament = predictive_service.forecast_demand("KA", horizon_steps=6)
        assert len(tournament.forecast_periods) == 6
        assert tournament.champion_model_name != ""

        # Anomaly detection
        anomalies = predictive_service.detect_demand_anomalies("KA")
        assert isinstance(anomalies, list)

    def test_end_to_end_solar_forecasting_andhra(
        self, predictive_service: PredictiveIntelligenceService, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        # Real AP solar observations have gaps -> must diagnose ineligible
        with pytest.raises(ValueError) as exc_info:
            predictive_service.forecast_solar("AP", horizon_steps=6)
        assert "High missing-data rate" in str(exc_info.value)

        # On continuous series -> executes successfully
        solar_res = predictive_service.forecast_solar(
            "AP", horizon_steps=6, series=sample_24m_series, installed_capacity_mw=4500.0
        )
        assert solar_res.region_code == "AP"
        assert solar_res.target_unit == "MU"
        assert len(solar_res.tournament_result.forecast_periods) == 6

        anomalies = predictive_service.detect_solar_anomalies("AP")
        assert isinstance(anomalies, list)

    def test_compare_forecast_to_actuals(
        self, predictive_service: PredictiveIntelligenceService, sample_24m_series: list[TimeSeriesPoint]
    ) -> None:
        predicted_periods = ["2024-07", "2024-08", "2024-09"]
        predicted_p50 = [5400.0, 5300.0, 5500.0]

        comparison = predictive_service.compare_forecast_to_actuals(
            predicted_periods=predicted_periods,
            predicted_p50=predicted_p50,
            actual_series=sample_24m_series,
        )
        assert comparison["status"] == "EVALUATED"
        assert comparison["evaluatedSamples"] == 3
        assert comparison["meanAbsoluteError"] > 0.0
        assert len(comparison["comparisons"]) == 3
