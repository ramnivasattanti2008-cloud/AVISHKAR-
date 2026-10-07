"""Solar forecast engine (spec sections 13 and 15): a physical PV model driven by a weather forecast, with an uncertainty band
learned from the forecast's own past errors at that place.

The physics is the AVISHKAR EMS's (`avishkar_ems.pvmodel`, which its tests and results rely on): Simplified Solis clear-sky,
isotropic transposition to the array's plane, cell temperature from irradiance, a fixed loss and a temperature coefficient,
clipped at the inverter. A test pins the power formula to the EMS's own.

Nothing is invented. Without error history there is no band, only the central forecast and the clear-sky bound; with it, the band
is the 10th and 90th percentile of what the day-ahead forecast actually got wrong in the past, in terms of the clearness index
(irradiance relative to a clear sky), separately for clear, partly cloudy and overcast conditions.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from pvlib import irradiance
from pvlib.location import Location

from avishkar_engine.forecast_schemas import (
    BandCalibration,
    BinStat,
    HourlyWeatherIn,
    LocationIn,
    Metrics,
    PvSystemIn,
    SolarEvaluateRequest,
    SolarEvaluateResponse,
    SolarForecastRequest,
    SolarForecastResponse,
)

TARGET_COVERAGE = 0.8
KT_MAX = 1.25  # irradiance above this multiple of a clear sky is a provider artefact: clipped, and counted in the notes
MIN_BIN_SAMPLES = 30
MIN_HOLDOUT_HOURS = 30
MIN_CALIBRATION_HOURS = 120
SUN_UP_CS_GHI = 50.0  # W/m2 of clear-sky GHI below which an hour is too dark to say anything about clouds
KT_BINS = (("overcast", 0.0, 0.35), ("partly cloudy", 0.35, 0.7), ("clear", 0.7, np.inf))
NOCT_RISE_PER_WM2 = 0.03  # cell temperature above ambient per W/m2 of plane-of-array irradiance (as in the EMS)


@dataclass(frozen=True)
class _Chain:
    mids: pd.DatetimeIndex
    cs_ghi: np.ndarray
    zenith: np.ndarray
    # everything the transposition needs for any GHI
    azimuth: np.ndarray
    dni_extra: np.ndarray
    cs_dni: np.ndarray
    cs_dhi: np.ndarray


def midpoints(w: HourlyWeatherIn) -> tuple[pd.DatetimeIndex, pd.DatetimeIndex]:
    """Labels of each hour and the instant in the middle of the hour each value averages (where the sun is evaluated)."""
    labels = pd.date_range(pd.Timestamp(w.start_time).tz_convert("UTC"), periods=len(w.ghi_wm2), freq="1h")
    shift = pd.Timedelta(minutes=-30 if w.convention == "end" else 30)
    return labels, labels + shift


def _chain(loc: LocationIn, mids: pd.DatetimeIndex) -> _Chain:
    place = Location(loc.latitude, loc.longitude, tz="UTC", altitude=loc.altitude_m)
    cs = place.get_clearsky(mids, model="simplified_solis")
    sp = place.get_solarposition(mids)
    return _Chain(
        mids=mids,
        cs_ghi=cs["ghi"].to_numpy(dtype=float),
        zenith=sp["apparent_zenith"].to_numpy(dtype=float),
        azimuth=sp["azimuth"].to_numpy(dtype=float),
        dni_extra=irradiance.get_extra_radiation(mids).to_numpy(dtype=float),
        cs_dni=cs["dni"].to_numpy(dtype=float),
        cs_dhi=cs["dhi"].to_numpy(dtype=float),
    )


def _poa_from_ghi(ch: _Chain, system: PvSystemIn, ghi: np.ndarray) -> np.ndarray:
    """Plane-of-array irradiance for a given GHI: split into direct and diffuse (Erbs), then transpose (isotropic)."""
    ghi = np.clip(ghi, 0.0, None)
    split = irradiance.erbs(ghi, ch.zenith, pd.DatetimeIndex(ch.mids).dayofyear.to_numpy())
    poa = irradiance.get_total_irradiance(
        system.tilt_deg, system.azimuth_deg, ch.zenith, ch.azimuth,
        np.nan_to_num(np.asarray(split["dni"], dtype=float)), ghi, np.nan_to_num(np.asarray(split["dhi"], dtype=float)),
        dni_extra=ch.dni_extra, model="isotropic",
    )["poa_global"]
    out = np.nan_to_num(np.asarray(poa, dtype=float))
    out[ch.zenith >= 90] = 0.0
    return np.clip(out, 0.0, None)


def _poa_clear(ch: _Chain, system: PvSystemIn) -> np.ndarray:
    poa = irradiance.get_total_irradiance(
        system.tilt_deg, system.azimuth_deg, ch.zenith, ch.azimuth, ch.cs_dni, ch.cs_ghi, ch.cs_dhi, model="isotropic",
    )["poa_global"]
    out = np.nan_to_num(np.asarray(poa, dtype=float))
    out[ch.zenith >= 90] = 0.0
    return np.clip(out, 0.0, None)


def power_kw(system: PvSystemIn, poa_wm2: np.ndarray, temp_c: np.ndarray) -> np.ndarray:
    """AC power in kW for plane-of-array irradiance and ambient temperature; the formula of avishkar_ems.pvmodel.pv_power_kw."""
    poa = np.clip(np.asarray(poa_wm2, dtype=float), 0.0, None)
    cell = np.asarray(temp_c, dtype=float) + NOCT_RISE_PER_WM2 * poa
    derate = 1.0 + system.temp_coeff_per_c * (cell - 25.0)
    dc = system.capacity_kwp * poa / 1000.0 * (1.0 - system.loss_fraction) * derate
    cap = system.inverter_kw if system.inverter_kw is not None else np.inf
    return np.clip(dc, 0.0, cap)


def _kt(ghi: np.ndarray, cs_ghi: np.ndarray) -> np.ndarray:
    return np.where(cs_ghi > 1e-6, np.clip(ghi / np.maximum(cs_ghi, 1e-6), 0.0, KT_MAX), 0.0)


def _bin_of(kt: np.ndarray) -> np.ndarray:
    out = np.zeros(len(kt), dtype=int)
    for i, (_, lo, hi) in enumerate(KT_BINS):
        out[(kt >= lo) & (kt < hi)] = i
    return out


def _fit_bands(req: SolarForecastRequest) -> tuple[list[tuple[float, float, float]] | None, BandCalibration | None, list[str]]:
    """Per-condition 10th, 50th and 90th percentile of (actual - forecast) clearness index from the supplied history."""
    notes: list[str] = []
    h = req.error_history
    if h is None:
        return None, None, ["No forecast-error history was supplied, so no uncertainty band is claimed: only the central forecast and the clear-sky bound."]
    _, mids = midpoints(h.weather)
    ch = _chain(req.location, mids)
    up = ch.cs_ghi > SUN_UP_CS_GHI
    n_up = int(up.sum())
    if n_up < MIN_CALIBRATION_HOURS:
        return None, None, [f"The error history has only {n_up} daylight hours; {MIN_CALIBRATION_HOURS} are needed for a band, so none is claimed."]
    kt_a = _kt(np.array(h.weather.ghi_wm2), ch.cs_ghi)[up]
    kt_f = _kt(np.array(h.forecast_ghi_wm2), ch.cs_ghi)[up]
    err = kt_a - kt_f
    # chronological holdout: fit on the first 80% of daylight hours, check coverage on the last 20%
    cut = int(len(err) * 0.8)
    fit_sl, test_sl = slice(0, cut), slice(cut, None)

    def stats(sl: slice) -> list[tuple[float, float, float] | None]:
        b = _bin_of(kt_f[sl])
        out: list[tuple[float, float, float] | None] = []
        for i in range(len(KT_BINS)):
            e = err[sl][b == i]
            out.append((float(np.quantile(e, 0.1)), float(np.quantile(e, 0.5)), float(np.quantile(e, 0.9))) if len(e) >= MIN_BIN_SAMPLES else None)
        return out

    fit = stats(fit_sl)
    # a sky condition the first 80% saw too rarely falls back to that part's pooled error: the same rule the issued band uses,
    # so the check scores the band as it will actually be issued
    fit_pooled = (float(np.quantile(err[fit_sl], 0.1)), float(np.quantile(err[fit_sl], 0.5)), float(np.quantile(err[fit_sl], 0.9)))
    fit_resolved = [f if f is not None else fit_pooled for f in fit]
    holdout_cov: float | None = None
    test_n = len(err[test_sl])
    if test_n >= MIN_HOLDOUT_HOURS:
        b = _bin_of(kt_f[test_sl])
        lo = np.array([fit_resolved[i][0] for i in b])
        hi = np.array([fit_resolved[i][2] for i in b])
        holdout_cov = float(np.mean((err[test_sl] >= lo) & (err[test_sl] <= hi)))
    else:
        notes.append(f"The band could not be checked on hours it had not seen: only {test_n} were held back and at least {MIN_HOLDOUT_HOURS} are needed.")
    final = stats(slice(0, None))
    bin_counts = np.bincount(_bin_of(kt_f), minlength=len(KT_BINS))
    # a condition seen too rarely to calibrate falls back to the pooled error, and the notes say so
    pooled = (float(np.quantile(err, 0.1)), float(np.quantile(err, 0.5)), float(np.quantile(err, 0.9)))
    resolved: list[tuple[float, float, float]] = []
    for i, f in enumerate(final):
        if f is None:
            resolved.append(pooled)
            notes.append(f"Only {int(bin_counts[i])} '{KT_BINS[i][0]}' hours in the history: the pooled error is used for that condition.")
        else:
            resolved.append(f)
    cal = BandCalibration(
        method="Empirical 10th and 90th percentile of (actual - day-ahead forecast) clearness index, by sky condition",
        hours_used=n_up,
        bins=[BinStat(name=KT_BINS[i][0], samples=int(bin_counts[i]), p10=round(resolved[i][0], 4), p50=round(resolved[i][1], 4), p90=round(resolved[i][2], 4)) for i in range(len(KT_BINS))],
        median_residual_kt=round(float(np.median(err)), 4),
        holdout_hours=test_n,
        holdout_coverage=None if holdout_cov is None else round(holdout_cov, 4),
        target_coverage=TARGET_COVERAGE,
    )
    return resolved, cal, notes


def forecast(req: SolarForecastRequest) -> SolarForecastResponse:
    w = req.weather
    labels, mids = midpoints(w)
    ch = _chain(req.location, mids)
    ghi = np.array(w.ghi_wm2, dtype=float)
    temp = np.array(w.temperature_c, dtype=float)
    notes: list[str] = []

    cap = KT_MAX * ch.cs_ghi
    over = ghi > cap + 1e-9
    if over.any():
        notes.append(f"{int(over.sum())} hours of forecast irradiance were above {KT_MAX:.2f} times a clear sky and were clipped to it.")
    ghi = np.minimum(ghi, np.where(ch.cs_ghi > 0, cap, ghi))
    ghi = np.where(ch.zenith >= 90, 0.0, ghi)

    clear_kw = power_kw(req.system, _poa_clear(ch, req.system), temp)
    p50 = power_kw(req.system, _poa_from_ghi(ch, req.system, ghi), temp)
    bins, cal, band_notes = _fit_bands(req)
    notes += band_notes

    p10: np.ndarray | None = None
    p90: np.ndarray | None = None
    if bins is not None:
        kt_f = _kt(ghi, ch.cs_ghi)
        b = _bin_of(kt_f)
        lo = np.array([bins[i][0] for i in b])
        hi = np.array([bins[i][2] for i in b])
        day = ch.cs_ghi > 1e-6
        ghi10 = np.where(day, np.clip(kt_f + lo, 0.0, KT_MAX) * ch.cs_ghi, 0.0)
        ghi90 = np.where(day, np.clip(kt_f + hi, 0.0, KT_MAX) * ch.cs_ghi, 0.0)
        p10 = power_kw(req.system, _poa_from_ghi(ch, req.system, ghi10), temp)
        p90 = power_kw(req.system, _poa_from_ghi(ch, req.system, ghi90), temp)
        # the band must contain the central forecast: a quirk of binning must not produce an inverted band
        p10 = np.minimum(p10, p50)
        p90 = np.maximum(p90, p50)

    def r(a: np.ndarray) -> list[float]:
        return [float(v) for v in np.round(a, 5)]

    kwh = lambda a: round(float(a.sum()), 4)  # noqa: E731  (hourly kW x 1 h)
    return SolarForecastResponse(
        times=[t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in labels],
        clear_sky_kw=r(clear_kw),
        p50_kw=r(p50),
        p10_kw=None if p10 is None else r(p10),
        p90_kw=None if p90 is None else r(p90),
        kwh_p50=kwh(p50),
        kwh_p10=None if p10 is None else kwh(p10),
        kwh_p90=None if p90 is None else kwh(p90),
        kwh_clear_sky=kwh(clear_kw),
        yield_kwh_per_kwp_p50=round(float(p50.sum() / req.system.capacity_kwp), 4),
        calibration=cal,
        assumptions=[
            "Physical model: Simplified Solis clear-sky, Erbs split of the forecast irradiance, isotropic transposition to the array's plane (as in the AVISHKAR EMS).",
            f"Cell temperature is ambient plus {NOCT_RISE_PER_WM2} degrees C per W/m2 of plane-of-array irradiance; power changes {req.system.temp_coeff_per_c * 100:.2f}% per degree C above 25 C.",
            f"Fixed system losses of {req.system.loss_fraction * 100:.0f}%" + (f"; output is clipped at the inverter's {req.system.inverter_kw:g} kW." if req.system.inverter_kw else "; no inverter limit was given."),
            "Each hourly value is the average over the hour; the sun is evaluated at the middle of the hour the weather value averages.",
            "No shading, soiling beyond the stated loss, or degradation with age is modelled.",
        ],
        notes=notes,
    )


def _metrics(forecast_kw: np.ndarray, actual_kw: np.ndarray, floor: float) -> Metrics:
    e = forecast_kw - actual_kw
    mask = actual_kw >= floor
    total = float(actual_kw.sum())
    return Metrics(
        hours=len(e),
        mae_kw=round(float(np.mean(np.abs(e))), 6),
        rmse_kw=round(float(np.sqrt(np.mean(e**2))), 6),
        mape_pct=round(float(np.mean(np.abs(e[mask]) / actual_kw[mask]) * 100), 4) if mask.any() else None,
        wape_pct=round(float(np.abs(e).sum() / total * 100), 4) if total > 0 else None,
        bias_kw=round(float(np.mean(e)), 6),
    )


def evaluate(req: SolarEvaluateRequest) -> SolarEvaluateResponse:
    """Score a forecast against what happened, next to the two baselines it has to beat: yesterday, and a cloudless sky."""
    f = np.array(req.forecast_kw, dtype=float)
    a = np.array(req.actual_kw, dtype=float)
    notes: list[str] = []
    fm = _metrics(f, a, req.min_actual_kw)
    pers: Metrics | None = None
    skill_p: float | None = None
    if len(a) >= 48:
        pers = _metrics(a[:-24], a[24:], req.min_actual_kw)  # the "forecast" for hour t is the actual at t-24; scored against hour t
        pm = _metrics(f[24:], a[24:], req.min_actual_kw)  # the model, on exactly the same hours, for a fair comparison
        skill_p = round(1.0 - pm.mae_kw / pers.mae_kw, 4) if pers.mae_kw > 0 else None
        notes.append("Skill against persistence is computed on the hours after the first day, where both have a forecast.")
    else:
        notes.append("Fewer than 48 hours: the persistence baseline (the same hour yesterday) cannot be scored.")
    cs: Metrics | None = None
    skill_c: float | None = None
    if req.clear_sky_kw is not None:
        c = np.array(req.clear_sky_kw, dtype=float)
        cs = _metrics(c, a, req.min_actual_kw)
        skill_c = round(1.0 - fm.mae_kw / cs.mae_kw, 4) if cs.mae_kw > 0 else None
    if fm.mape_pct is not None and fm.wape_pct is not None and fm.mape_pct > 3 * max(fm.wape_pct, 1e-9):
        notes.append("MAPE is much larger than WAPE because it is dominated by hours with very little output; WAPE is the steadier figure.")
    return SolarEvaluateResponse(forecast=fm, persistence_baseline=pers, clear_sky=cs, skill_vs_persistence=skill_p, skill_vs_clear_sky=skill_c, notes=notes)
