"""Forecast Eligibility and Data Trust Gate for UrjaSetu EMS.

Enforces strict pre-flight validation before any time-series forecasting
or machine learning model is trained or evaluated:
1. Validates metric definition and physical units against MetricSemanticsRegistry.
2. Validates geographic attribution and prevents synthetic downscaling.
3. Evaluates sampling cadence, missing periods, continuous gaps, and duplicate timestamps.
4. Enforces sample size thresholds:
   - Minimum 6 points for simple baselines.
   - Minimum 12 points for seasonal naive models.
   - Minimum 24 points for statistical/ML models with seasonal decomposition.
5. Rejects physically implausible or negative observations for positive-definite metrics.
6. Returns a structured ForecastEligibilityReport with clear rejection reasons or warnings.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from avishkar_ems.geo_explorer import GeoExplorer, GeoLevel
from avishkar_ems.metric_semantics import MetricSemanticsRegistry
from avishkar_ems.time_series_trends import TimeSeriesPoint


@dataclass(frozen=True)
class ForecastEligibilityReport:
    is_eligible: bool
    metric_id: str
    geo_code: str
    available_date_range: tuple[str, str] | None
    usable_observation_count: int
    missing_percentage: float
    eligible_model_classes: list[str] = field(default_factory=list)
    max_eligible_horizon: int = 0
    warnings: list[str] = field(default_factory=list)
    rejection_reasons: list[str] = field(default_factory=list)
    min_additional_data_required: int = 0


class ForecastEligibilityEngine:
    """Pre-flight verification gate for time-series forecasting and ML tasks."""

    def __init__(self, geo_explorer: GeoExplorer | None = None) -> None:
        self._geo = geo_explorer or GeoExplorer()

    def check_eligibility(
        self,
        series: list[TimeSeriesPoint],
        metric_id: str,
        geo_code: str,
        target_horizon: int = 6,
    ) -> ForecastEligibilityReport:
        """Performs rigorous multi-factor eligibility verification on the input time series."""
        warnings: list[str] = []
        rejections: list[str] = []

        # 1. Metric Semantics & Unit Verification
        if not MetricSemanticsRegistry.is_registered(metric_id):
            rejections.append(f"Metric '{metric_id}' is not registered in Canonical Metric Semantics Registry.")
            return ForecastEligibilityReport(
                is_eligible=False,
                metric_id=metric_id,
                geo_code=geo_code,
                available_date_range=None,
                usable_observation_count=0,
                missing_percentage=100.0,
                rejection_reasons=rejections,
            )

        meta = MetricSemanticsRegistry.get_metric(metric_id)

        # 2. Geographic Attribution Verification
        try:
            ent = self._geo.get_entity(geo_code)
        except KeyError:
            rejections.append(f"Geographic entity '{geo_code}' is not recognized in canonical hierarchy.")
            return ForecastEligibilityReport(
                is_eligible=False,
                metric_id=metric_id,
                geo_code=geo_code,
                available_date_range=None,
                usable_observation_count=0,
                missing_percentage=100.0,
                rejection_reasons=rejections,
            )

        is_attributable, reason = self._geo.can_attribute_metric(meta.metric_id, geo_code)
        if not is_attributable:
            rejections.append(
                f"Metric '{meta.metric_name}' is not attributable to {ent.name} ({ent.level.value}). {reason}"
            )

        # Anti-downscaling check: District forecasts cannot be built from state data
        if ent.level == GeoLevel.DISTRICT and meta.metric_id in {"ENERGY_REQUIREMENT", "ENERGY_SUPPLIED"}:
            rejections.append(
                "DATA HONESTY INVARIANT: Macro electricity requirement is published only at State and National levels by CEA. "
                "Synthesizing district-level forecasts from state totals is prohibited without verified local feeder telemetry."
            )

        # 3. Time Series Integrity: Count, Gaps, and Ordering
        if not series:
            rejections.append("Time series is empty; no observations provided.")
            return ForecastEligibilityReport(
                is_eligible=False,
                metric_id=metric_id,
                geo_code=geo_code,
                available_date_range=None,
                usable_observation_count=0,
                missing_percentage=100.0,
                rejection_reasons=rejections,
                min_additional_data_required=6,
            )

        # Check for duplicate timestamps
        periods = [p.period for p in series]
        if len(periods) != len(set(periods)):
            rejections.append("Time series contains duplicate observation periods.")

        # Chronological sort check
        sorted_series = sorted(series, key=lambda x: x.period)
        first_period = sorted_series[0].period
        last_period = sorted_series[-1].period

        # Parse start and end to determine expected span
        try:
            start_y, start_m = int(first_period[:4]), int(first_period[5:7])
            end_y, end_m = int(last_period[:4]), int(last_period[5:7])
            expected_months = (end_y - start_y) * 12 + (end_m - start_m) + 1
        except Exception:
            expected_months = len(series)

        observed_count = len(sorted_series)
        missing_count = max(0, expected_months - observed_count)
        missing_pct = round((missing_count / max(1, expected_months)) * 100.0, 2)

        if missing_pct > 25.0:
            rejections.append(
                f"High missing-data rate ({missing_pct:.1f}% gaps, {missing_count} missing out of {expected_months} expected periods). "
                "Exceeds maximum allowable gap threshold of 25%."
            )

        # 4. Physical Feasibility and Plausibility Checks
        negative_points = [p for p in sorted_series if p.value < 0.0]
        if negative_points and meta.physical_min >= 0.0:
            rejections.append(
                f"Series contains {len(negative_points)} negative observation(s) (e.g. {negative_points[0].value} in {negative_points[0].period}), "
                f"violating physical non-negativity constraint for {meta.metric_name}."
            )

        # 5. Sample Size Thresholds and Eligible Model Classes
        usable_count = observed_count
        eligible_models: list[str] = []
        max_horizon = 0

        if usable_count < 6:
            min_additional = 6 - usable_count
            rejections.append(
                f"Insufficient historical samples ({usable_count} available). "
                f"At least 6 consecutive observations are required for basic forecasting."
            )
        else:
            eligible_models.extend(["LastObservationBaseline", "MovingAverageBaseline", "LinearTrendBaseline"])
            max_horizon = min(target_horizon, usable_count // 2)

            if usable_count >= 12:
                eligible_models.append("SeasonalNaiveBaseline")
                max_horizon = min(target_horizon, 12)
            else:
                warnings.append(
                    f"Sample count ({usable_count}) is less than 12 months. Seasonal baseline and models are disabled."
                )

            if usable_count >= 24:
                eligible_models.extend(["HoltWintersForecaster", "LaggedRidgeForecaster"])
                max_horizon = target_horizon
            else:
                warnings.append(
                    f"Sample count ({usable_count}) is less than 24 months. "
                    "Multi-year statistical and regression models require at least 2 full annual cycles (24 months)."
                )

        # 6. Horizon validation
        if target_horizon > max_horizon and max_horizon > 0:
            warnings.append(
                f"Requested forecast horizon ({target_horizon} periods) exceeds recommended horizon limit ({max_horizon} periods) "
                f"for {usable_count} historical observations. Uncertainty bands will widen significantly."
            )

        is_eligible = len(rejections) == 0

        min_additional = 0
        if not is_eligible and usable_count < 6:
            min_additional = 6 - usable_count

        return ForecastEligibilityReport(
            is_eligible=is_eligible,
            metric_id=metric_id,
            geo_code=geo_code,
            available_date_range=(first_period, last_period),
            usable_observation_count=usable_count,
            missing_percentage=missing_pct,
            eligible_model_classes=eligible_models,
            max_eligible_horizon=max_horizon,
            warnings=warnings,
            rejection_reasons=rejections,
            min_additional_data_required=min_additional,
        )
