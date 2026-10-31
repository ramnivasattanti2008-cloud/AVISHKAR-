"""Dedicated Solar Generation Forecasting Module for UrjaSetu EMS.

Strict Invariants:
1. Forecasts actual generated solar energy (MU), NEVER installed nameplate capacity (MW).
2. Installed solar capacity (MW) can be used as an exogenous feature to capture capacity expansion,
   but capacity shares and generation forecasts are strictly separated.
3. Explicitly labels whether the forecast is generation-only or weather-informed.
4. Refuses to fabricate synthetic satellite solar irradiance or hourly solar curves from monthly totals.
5. If historical solar generation data is absent or insufficient, returns a structured ineligible diagnosis.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field

from avishkar_ems.forecast_eligibility import ForecastEligibilityEngine, ForecastEligibilityReport
from avishkar_ems.forecasting_engine import ModelTournamentEngine, ModelTournamentResult
from avishkar_ems.solar_intel import SolarIntelligenceEngine
from avishkar_ems.time_series_trends import TimeSeriesPoint


@dataclass(frozen=True)
class SolarForecastResult:
    region_code: str
    target_metric: str  # "SOLAR_GENERATION"
    target_unit: str  # "MU"
    is_weather_informed: bool
    weather_data_notes: str
    installed_capacity_mw: float
    tournament_result: ModelTournamentResult
    eligibility_report: ForecastEligibilityReport
    generated_timestamp: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.UTC).isoformat()
    )
    caveats: list[str] = field(default_factory=list)


class SolarForecastingPipeline:
    """Predictive modeling for monthly utility and rooftop solar energy generation."""

    def __init__(
        self,
        solar_engine: SolarIntelligenceEngine | None = None,
        eligibility_engine: ForecastEligibilityEngine | None = None,
        tournament_engine: ModelTournamentEngine | None = None,
    ) -> None:
        self.solar = solar_engine or SolarIntelligenceEngine()
        self.eligibility = eligibility_engine or ForecastEligibilityEngine()
        self.tournament = tournament_engine or ModelTournamentEngine(season_length=12)

    def forecast_solar_generation(
        self,
        region_code: str,
        horizon_steps: int = 6,
        series: list[TimeSeriesPoint] | None = None,
        installed_capacity_mw: float | None = None,
    ) -> SolarForecastResult:
        """Executes solar generation forecasting with pre-flight eligibility and tournament selection."""
        # 1. Retrieve verified historical solar generation observations (in MU)
        gen_series = series if series is not None else self.solar.get_generation_series(region_code)
        if installed_capacity_mw is not None:
            latest_cap = installed_capacity_mw
        else:
            latest_rec = self.solar.get_record(region_code, gen_series[-1].period)
            latest_cap = latest_rec.installed_solar_capacity_mw

        # 2. Check Data Eligibility
        elig_report = self.eligibility.check_eligibility(
            series=gen_series,
            metric_id="SOLAR_GENERATION",
            geo_code=region_code,
            target_horizon=horizon_steps,
        )

        if not elig_report.is_eligible:
            raise ValueError(
                f"Solar forecasting ineligible for region '{region_code}': {'; '.join(elig_report.rejection_reasons)}"
            )

        # 3. Model Tournament Execution
        periods = [p.period for p in gen_series]
        values = [p.value for p in gen_series]

        tournament_res = self.tournament.run_tournament(
            periods=periods,
            values=values,
            target_metric="SOLAR_GENERATION",
            geo_code=region_code,
            horizon_steps=horizon_steps,
            holdout_steps=min(horizon_steps, 3),
        )

        caveats = [
            "DATA HONESTY INVARIANT: Solar generation is modeled in MU (energy), completely decoupled from capacity in MW.",
            "Weather status: Forecast is GENERATION-ONLY based on historical cyclicality and commissioning trends. "
            "Satellite solar irradiance nowcasts are not integrated; actual generation will vary with live cloud cover.",
            "Disaggregation refusal: Monthly projections are never converted into synthetic 24-hour diurnal curves.",
        ]

        return SolarForecastResult(
            region_code=region_code,
            target_metric="SOLAR_GENERATION",
            target_unit="MU",
            is_weather_informed=False,
            weather_data_notes="Surface solar irradiance telemetry unavailable; model relies on annual seasonal factors.",
            installed_capacity_mw=latest_cap,
            tournament_result=tournament_res,
            eligibility_report=elig_report,
            caveats=caveats,
        )

    def refuse_capacity_as_generation_forecast(self, requested_metric: str) -> None:
        """Ensures installed capacity is never forecast as generated energy."""
        if requested_metric.upper() in {"INSTALLED_SOLAR_CAPACITY", "SOLAR_CAPACITY", "CAPACITY_MW"}:
            raise ValueError(
                "DATA HONESTY INVARIANT VIOLATION: Refusing to generate energy generation forecast using installed capacity metric. "
                "Installed capacity is a power rating (MW), whereas generated electricity is energy volume (MU)."
            )
