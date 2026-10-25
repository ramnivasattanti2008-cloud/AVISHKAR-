"""Unified Predictive Energy Intelligence Application Service for UrjaSetu EMS.

Orchestrates time-series eligibility gates, multi-model tournaments,
anomaly detection engines, and solar forecasting pipelines.

Strict Invariants:
1. Always checks data eligibility before model training or prediction.
2. Selects candidate models ONLY if they outperform the baseline on chronological holdout.
3. Anomaly alerts are non-accusatory and cryptographically deduplicated.
4. Installed solar capacity (MW) is never forecast as generated energy (MU).
5. Returns explicit ineligible responses rather than returning synthetic or hardcoded success.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from typing import Any

from avishkar_ems.anomaly_detector import AnomalyDetectionEngine, AnomalyRecord
from avishkar_ems.energy_balance import EnergyBalanceAnalyzer
from avishkar_ems.forecast_eligibility import ForecastEligibilityEngine, ForecastEligibilityReport
from avishkar_ems.forecasting_engine import ModelTournamentEngine, ModelTournamentResult
from avishkar_ems.geo_analytics_service import GeographicAnalyticsService
from avishkar_ems.solar_forecast import SolarForecastingPipeline, SolarForecastResult
from avishkar_ems.solar_intel import SolarIntelligenceEngine
from avishkar_ems.time_series_trends import TimeSeriesPoint


@dataclass(frozen=True)
class PredictiveServiceResponse:
    success: bool
    status_code: int
    data: dict[str, Any]
    error_message: str | None = None
    diagnostics: list[str] = field(default_factory=list)


class PredictiveIntelligenceService:
    """Master application service for time-series forecasting and anomaly intelligence."""

    def __init__(
        self,
        balance_analyzer: EnergyBalanceAnalyzer | None = None,
        solar_engine: SolarIntelligenceEngine | None = None,
        geo_service: GeographicAnalyticsService | None = None,
        eligibility_engine: ForecastEligibilityEngine | None = None,
        tournament_engine: ModelTournamentEngine | None = None,
        anomaly_engine: AnomalyDetectionEngine | None = None,
        solar_forecaster: SolarForecastingPipeline | None = None,
    ) -> None:
        self.balance = balance_analyzer or EnergyBalanceAnalyzer()
        self.solar = solar_engine or SolarIntelligenceEngine()
        self.geo = geo_service or GeographicAnalyticsService()
        self.eligibility = eligibility_engine or ForecastEligibilityEngine()
        self.tournament = tournament_engine or ModelTournamentEngine(season_length=12)
        self.anomaly = anomaly_engine or AnomalyDetectionEngine()
        self.solar_forecaster = solar_forecaster or SolarForecastingPipeline(
            solar_engine=self.solar,
            eligibility_engine=self.eligibility,
            tournament_engine=self.tournament,
        )
        self._persisted_runs: dict[str, ModelTournamentResult] = {}

    def get_demand_series(self, geo_code: str) -> list[TimeSeriesPoint]:
        """Retrieves verified energy requirement time series in MU."""
        self.geo.assert_metric_supported("ENERGY_REQUIREMENT", geo_code)
        periods = self.balance.list_periods(geo_code)
        return [
            TimeSeriesPoint(
                period=p,
                value=self.balance.get_record(geo_code, p).energy_requirement_mu,
                unit="MU",
                source_ref=self.balance.get_record(geo_code, p).source,
            )
            for p in periods
        ]

    def check_demand_eligibility(
        self, geo_code: str, horizon_steps: int = 6
    ) -> ForecastEligibilityReport:
        """Evaluates whether the electricity demand series is eligible for forecasting."""
        try:
            series = self.get_demand_series(geo_code)
        except Exception as e:
            return ForecastEligibilityReport(
                is_eligible=False,
                metric_id="ENERGY_REQUIREMENT",
                geo_code=geo_code,
                available_date_range=None,
                usable_observation_count=0,
                missing_percentage=100.0,
                rejection_reasons=[str(e)],
            )

        return self.eligibility.check_eligibility(
            series=series,
            metric_id="ENERGY_REQUIREMENT",
            geo_code=geo_code,
            target_horizon=horizon_steps,
        )

    def forecast_demand(
        self, geo_code: str, horizon_steps: int = 6
    ) -> ModelTournamentResult:
        """Executes leak-free demand forecasting with model tournament and champion selection."""
        # Pre-flight eligibility gate
        elig = self.check_demand_eligibility(geo_code, horizon_steps)
        if not elig.is_eligible:
            raise ValueError(
                f"Demand forecasting is ineligible for '{geo_code}': {'; '.join(elig.rejection_reasons)}"
            )

        series = self.get_demand_series(geo_code)
        periods = [p.period for p in series]
        values = [p.value for p in series]

        result = self.tournament.run_tournament(
            periods=periods,
            values=values,
            target_metric="ENERGY_REQUIREMENT",
            geo_code=geo_code,
            horizon_steps=horizon_steps,
            holdout_steps=min(horizon_steps, 3),
        )

        run_id = f"{geo_code}:ENERGY_REQUIREMENT:{datetime.datetime.now(datetime.UTC).date().isoformat()}"
        self._persisted_runs[run_id] = result
        return result

    def forecast_solar(
        self,
        region_code: str,
        horizon_steps: int = 6,
        series: list[TimeSeriesPoint] | None = None,
        installed_capacity_mw: float | None = None,
    ) -> SolarForecastResult:
        """Executes solar generation forecasting with capacity separation."""
        return self.solar_forecaster.forecast_solar_generation(
            region_code, horizon_steps, series=series, installed_capacity_mw=installed_capacity_mw
        )

    def detect_demand_anomalies(self, geo_code: str) -> list[AnomalyRecord]:
        """Runs transparent anomaly detectors on electricity demand observations."""
        series = self.get_demand_series(geo_code)
        return self.anomaly.run_all_detectors(series, "ENERGY_REQUIREMENT", geo_code)

    def detect_solar_anomalies(self, region_code: str) -> list[AnomalyRecord]:
        """Runs transparent anomaly detectors on solar generation observations."""
        series = self.solar.get_generation_series(region_code)
        return self.anomaly.run_all_detectors(series, "SOLAR_GENERATION", region_code)

    def compare_forecast_to_actuals(
        self,
        predicted_periods: list[str],
        predicted_p50: list[float],
        actual_series: list[TimeSeriesPoint],
    ) -> dict[str, Any]:
        """Compares previously issued predictions with subsequently observed ground-truth values."""
        actual_by_period = {p.period: p.value for p in actual_series}
        common_periods = [p for p in predicted_periods if p in actual_by_period]

        if not common_periods:
            return {
                "status": "AWAITING_ACTUALS",
                "message": "None of the predicted forecast periods have completed actual observations yet.",
                "evaluatedSamples": 0,
            }

        pairs = [
            (p, predicted_p50[predicted_periods.index(p)], actual_by_period[p])
            for p in common_periods
        ]

        abs_diffs = [abs(act - pred) for _, pred, act in pairs]
        mean_abs_diff = sum(abs_diffs) / len(abs_diffs)

        return {
            "status": "EVALUATED",
            "evaluatedSamples": len(common_periods),
            "commonPeriods": common_periods,
            "meanAbsoluteError": round(mean_abs_diff, 2),
            "comparisons": [
                {
                    "period": p,
                    "predictedP50": pred,
                    "actualObserved": act,
                    "absoluteError": round(abs(act - pred), 2),
                    "percentageError": round((abs(act - pred) / act) * 100.0, 2) if act > 0 else 0.0,
                }
                for p, pred, act in pairs
            ],
        }
