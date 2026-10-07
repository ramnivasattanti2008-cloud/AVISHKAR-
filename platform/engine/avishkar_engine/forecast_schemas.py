"""Wire format of the forecast endpoints (solar and load)."""

from __future__ import annotations

import math
from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from avishkar_engine.schemas import Wire


def _aware(value: str, name: str) -> str:
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as e:
        raise ValueError(f"{name} is not an ISO 8601 time") from e
    if t.tzinfo is None:
        raise ValueError(f"{name} must carry a time zone offset, such as +05:30 or Z")
    return value


def _finite(values: list[float], name: str) -> list[float]:
    if any(v is None or not math.isfinite(v) for v in values):
        raise ValueError(f"{name} contains a missing or non-finite value: send only hours you have")
    return values


# ----------------------------------------------------------------------------- solar


class LocationIn(Wire):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude_m: float = Field(default=0, ge=-500, le=9000)


class PvSystemIn(Wire):
    capacity_kwp: float = Field(gt=0, le=100_000)
    tilt_deg: float = Field(ge=0, le=90)
    azimuth_deg: float = Field(ge=0, lt=360, description="Degrees clockwise from north: 180 faces south.")
    loss_fraction: float = Field(default=0.14, ge=0, le=0.5)
    temp_coeff_per_c: float = Field(default=-0.004, ge=-0.01, le=0, description="Fractional power change per degree C of cell temperature above 25 C.")
    inverter_kw: float | None = Field(default=None, gt=0)


class HourlyWeatherIn(Wire):
    start_time: str
    convention: Literal["end", "start"] = Field(default="end", description="Open-Meteo labels an hourly irradiance value with the END of the hour it averages ('end').")
    ghi_wm2: list[float] = Field(description="Global horizontal irradiance, W/m2, averaged over each hour.")
    temperature_c: list[float]

    @field_validator("start_time")
    @classmethod
    def _t(cls, v: str) -> str:
        return _aware(v, "startTime")

    @model_validator(mode="after")
    def _ok(self) -> HourlyWeatherIn:
        if not 1 <= len(self.ghi_wm2) <= 24 * 400:
            raise ValueError("the weather series must have between 1 hour and 400 days")
        if len(self.temperature_c) != len(self.ghi_wm2):
            raise ValueError("temperatureC and ghiWm2 must have the same number of hours")
        _finite(self.ghi_wm2, "ghiWm2")
        _finite(self.temperature_c, "temperatureC")
        if min(self.ghi_wm2) < 0 or max(self.ghi_wm2) > 1500:
            raise ValueError("ghiWm2 must lie between 0 and 1500 W/m2")
        if min(self.temperature_c) < -90 or max(self.temperature_c) > 70:
            raise ValueError("temperatureC must lie between -90 and 70")
        return self


class ForecastErrorHistory(Wire):
    """Past hours where we know both what was forecast a day ahead and what the best analysis says happened."""

    weather: HourlyWeatherIn = Field(description="The ACTUAL (analysed) irradiance and temperature for each past hour.")
    forecast_ghi_wm2: list[float] = Field(description="The day-ahead forecast of GHI that had been made for the same hours.")

    @model_validator(mode="after")
    def _same(self) -> ForecastErrorHistory:
        if len(self.forecast_ghi_wm2) != len(self.weather.ghi_wm2):
            raise ValueError("forecastGhiWm2 and the actual series must cover the same hours")
        _finite(self.forecast_ghi_wm2, "forecastGhiWm2")
        if min(self.forecast_ghi_wm2) < 0 or max(self.forecast_ghi_wm2) > 1500:
            raise ValueError("forecastGhiWm2 must lie between 0 and 1500 W/m2")
        return self


class SolarForecastRequest(Wire):
    location: LocationIn
    system: PvSystemIn
    weather: HourlyWeatherIn
    error_history: ForecastErrorHistory | None = Field(default=None, description="Without it no uncertainty band is claimed.")


class BinStat(Wire):
    name: str
    samples: int
    p10: float
    p50: float
    p90: float


class BandCalibration(Wire):
    method: str
    hours_used: int
    bins: list[BinStat]
    median_residual_kt: float
    holdout_hours: int
    holdout_coverage: float | None = Field(description="Share of held-out hours that fell inside the 80% band (None when too few).")
    target_coverage: float


class SolarForecastResponse(Wire):
    times: list[str] = Field(description="The label of each hour, in UTC, as sent.")
    clear_sky_kw: list[float] = Field(description="What the system would produce under a cloudless sky, from a clear-sky model: a reference curve, not a ceiling. The forecast can sit above it where the weather model's irradiance exceeds the clear-sky model, up to 1.25 times, beyond which it is clipped.")
    p50_kw: list[float]
    p10_kw: list[float] | None
    p90_kw: list[float] | None
    kwh_p50: float
    kwh_p10: float | None
    kwh_p90: float | None
    kwh_clear_sky: float
    yield_kwh_per_kwp_p50: float
    calibration: BandCalibration | None
    assumptions: list[str]
    notes: list[str]


class SolarEvaluateRequest(Wire):
    forecast_kw: list[float]
    actual_kw: list[float]
    clear_sky_kw: list[float] | None = None
    min_actual_kw: float = Field(default=0.05, ge=0, description="Hours with less than this actual output are left out of MAPE.")

    @model_validator(mode="after")
    def _same(self) -> SolarEvaluateRequest:
        n = len(self.actual_kw)
        if n < 24:
            raise ValueError("at least 24 hours are needed to evaluate a forecast")
        if len(self.forecast_kw) != n or (self.clear_sky_kw is not None and len(self.clear_sky_kw) != n):
            raise ValueError("forecastKw, actualKw and clearSkyKw must cover the same hours")
        for name, s in (("forecastKw", self.forecast_kw), ("actualKw", self.actual_kw), ("clearSkyKw", self.clear_sky_kw or [])):
            _finite(s, name)
        return self


class Metrics(Wire):
    hours: int
    mae_kw: float
    rmse_kw: float
    mape_pct: float | None = Field(description="Mean absolute percentage error over hours with real output; None if there are none.")
    wape_pct: float | None = Field(description="Total absolute error over total actual energy.")
    bias_kw: float = Field(description="Mean of forecast minus actual: positive means over-forecasting.")


class SolarEvaluateResponse(Wire):
    forecast: Metrics
    persistence_baseline: Metrics | None = Field(description="The naive baseline: the output of the same hour a day earlier.")
    clear_sky: Metrics | None
    skill_vs_persistence: float | None = Field(description="1 - MAE(forecast)/MAE(persistence): above 0 means the forecast beats the naive baseline.")
    skill_vs_clear_sky: float | None
    notes: list[str]


# ------------------------------------------------------------------------------ load


class LoadSeriesIn(Wire):
    start_time: str = Field(description="Start of the first reading's interval, with a UTC offset.")
    interval_minutes: Literal[15, 30, 60]
    kwh: list[float | None] = Field(description="Energy in each interval, kWh; null where there is no reading (gaps are never filled).")

    @field_validator("start_time")
    @classmethod
    def _t(cls, v: str) -> str:
        return _aware(v, "startTime")

    @model_validator(mode="after")
    def _ok(self) -> LoadSeriesIn:
        n = len(self.kwh)
        if not 24 <= n <= 24 * 4 * 800:
            raise ValueError("the load series must have between a day and 800 days of readings")
        vals = [v for v in self.kwh if v is not None]
        if any(not math.isfinite(v) or v < 0 for v in vals):
            raise ValueError("kwh must be finite and not negative (use null for a missing reading)")
        if len(vals) < 24:
            raise ValueError("fewer than 24 readings are present")
        return self


class LoadForecastRequest(Wire):
    history: LoadSeriesIn
    horizon_hours: int = Field(default=24, ge=1, le=168)
    forecast_start: str | None = Field(default=None, description="First hour to forecast (UTC offset required). Default: the hour after the last reading.")
    timezone_offset_minutes: int = Field(default=330, ge=-720, le=840)

    @field_validator("forecast_start")
    @classmethod
    def _t(cls, v: str | None) -> str | None:
        return None if v is None else _aware(v, "forecastStart")


class MethodScore(Wire):
    method: str
    description: str
    mae_kw: float
    rmse_kw: float
    wape_pct: float | None
    bias_kw: float
    coverage_80: float | None = Field(description="Share of held-out hours inside this method's 80% band.")


class LoadForecastResponse(Wire):
    status: Literal["ok", "unavailable"]
    unavailable_reason: str | None
    times: list[str]
    p10_kw: list[float]
    p50_kw: list[float]
    p90_kw: list[float]
    kwh_p50: float | None
    peak_threshold_kw: float | None = Field(description="The property's own 95th percentile of hourly power over its history.")
    peak_probability: list[float]
    selected_method: str | None
    methods: list[MethodScore]
    holdout_days: int
    history_days: float
    gaps_share: float = Field(description="Share of hours in the history with no reading.")
    assumptions: list[str]
    notes: list[str]
