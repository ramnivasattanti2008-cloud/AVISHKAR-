"""Solar engine: physics sanity, agreement with the EMS's own PV model, and calibrated bands tested on errors of known size."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from avishkar_engine import solar
from avishkar_engine.forecast_schemas import (
    ForecastErrorHistory,
    HourlyWeatherIn,
    LocationIn,
    PvSystemIn,
    SolarEvaluateRequest,
    SolarForecastRequest,
)

BENGALURU = LocationIn(latitude=12.97, longitude=77.59, altitude_m=900)
SYSTEM = PvSystemIn(capacity_kwp=1.0, tilt_deg=13, azimuth_deg=180)


def weather(start="2026-03-20T00:00:00Z", hours=24, ghi=None, temp=30.0, convention="end") -> HourlyWeatherIn:
    return HourlyWeatherIn(start_time=start, convention=convention, ghi_wm2=list(ghi) if ghi is not None else [0.0] * hours, temperature_c=[temp] * (len(ghi) if ghi is not None else hours))


def clear_sky_ghi(w: HourlyWeatherIn, loc: LocationIn = BENGALURU) -> np.ndarray:
    _, mids = solar.midpoints(w)
    return solar._chain(loc, mids).cs_ghi


def run(system=SYSTEM, w=None, loc=BENGALURU, history=None):
    return solar.forecast(SolarForecastRequest(location=loc, system=system, weather=w or weather(), error_history=history))


class TestPhysics:
    def test_the_power_formula_is_the_ems_formula(self):
        from avishkar_ems.pvmodel import pv_power_kw
        from avishkar_ems.site import SiteSpec

        rng = np.random.default_rng(0)
        poa, temp = rng.uniform(0, 1100, 500), rng.uniform(5, 45, 500)
        site = SiteSpec(site_id="x", lat=12.97, lon=77.59, dc_kwp=4.2, ac_kw=3.6, tilt=13, azimuth=180, battery_kwh=0, battery_kw=0, critical_kw=0, backup_hours=0, system_cost_inr=0, loss_frac=0.12, temp_coeff=-0.0035)
        mine = PvSystemIn(capacity_kwp=4.2, tilt_deg=13, azimuth_deg=180, loss_fraction=0.12, temp_coeff_per_c=-0.0035, inverter_kw=3.6)
        assert solar.power_kw(mine, poa, temp) == pytest.approx(pv_power_kw(site, poa, temp), abs=1e-12)

    def test_the_clear_sky_chain_matches_the_ems_clear_sky_plane_of_array(self):
        from avishkar_ems.pvmodel import clearsky_poa
        from avishkar_ems.site import SiteSpec

        w = weather(hours=24)
        _, mids = solar.midpoints(w)
        site = SiteSpec(site_id="x", lat=12.97, lon=77.59, dc_kwp=1, ac_kw=1, tilt=13, azimuth=180, battery_kwh=0, battery_kw=0, critical_kw=0, backup_hours=0, system_cost_inr=0, tz="UTC", altitude=900)
        theirs = clearsky_poa(site, mids)["poa_clear"].to_numpy()
        ch = solar._chain(BENGALURU, mids)
        ours = solar._poa_clear(ch, SYSTEM)
        assert ours == pytest.approx(theirs, abs=1e-6)

    def test_there_is_no_power_at_night_or_with_no_sun(self):
        r = run(w=weather(ghi=[0.0] * 24))
        assert max(r.p50_kw) == 0.0
        cs = run(w=weather(ghi=[0.0] * 24))
        night = [i for i, v in enumerate(cs.clear_sky_kw) if v == 0.0]
        assert 8 <= len(night) <= 16  # about twelve dark hours near the equator

    def test_a_clear_day_gives_a_credible_yield_for_the_place(self):
        w = weather(ghi=clear_sky_ghi(weather(hours=24)))
        r = run(w=w)
        # a clear March day near Bengaluru: roughly 5 to 6 kWh per kWp after a 14% loss
        assert 4.3 <= r.yield_kwh_per_kwp_p50 <= 6.5, r.yield_kwh_per_kwp_p50
        assert 0.6 <= max(r.p50_kw) <= 0.95
        assert r.kwh_clear_sky == pytest.approx(r.kwh_p50, rel=0.02)  # the sun was as clear as the bound

    def test_clouds_only_ever_reduce_output_below_the_clear_sky_bound(self):
        cs = clear_sky_ghi(weather(hours=24))
        r = run(w=weather(ghi=cs * 0.5))
        assert all(p <= c + 1e-9 for p, c in zip(r.p50_kw, r.clear_sky_kw, strict=True))
        assert r.kwh_p50 < 0.6 * r.kwh_clear_sky

    def test_an_irradiance_above_the_clear_sky_by_a_lot_is_clipped_and_reported(self):
        cs = clear_sky_ghi(weather(hours=24))
        r = run(w=weather(ghi=np.where(cs > 100, 1400.0, 0.0)))
        assert any("clipped" in n for n in r.notes)
        assert r.kwh_p50 <= 1.3 * r.kwh_clear_sky

    def test_a_south_facing_array_beats_a_north_facing_one_in_the_northern_hemisphere(self):
        w = weather(ghi=clear_sky_ghi(weather(hours=24)))
        south = run(PvSystemIn(capacity_kwp=1, tilt_deg=30, azimuth_deg=180), w).kwh_p50
        north = run(PvSystemIn(capacity_kwp=1, tilt_deg=30, azimuth_deg=0), w).kwh_p50
        east = run(PvSystemIn(capacity_kwp=1, tilt_deg=30, azimuth_deg=90), w)
        assert south > north * 1.05
        peak_hour = int(np.argmax(east.p50_kw))
        south_peak = int(np.argmax(run(PvSystemIn(capacity_kwp=1, tilt_deg=30, azimuth_deg=180), w).p50_kw))
        assert peak_hour < south_peak  # an east-facing array peaks in the morning

    def test_heat_costs_output(self):
        ghi = clear_sky_ghi(weather(hours=24))
        cool = run(w=weather(ghi=ghi, temp=15)).kwh_p50
        hot = run(w=weather(ghi=ghi, temp=40)).kwh_p50
        assert hot < cool
        # 25 degrees hotter at -0.4%/degree is about 10% less
        assert hot / cool == pytest.approx(1 - 0.004 * 25 * (1 + 0.03 * 700 / 25 / 25), abs=0.06)

    def test_the_inverter_limit_clips(self):
        ghi = clear_sky_ghi(weather(hours=24))
        r = run(PvSystemIn(capacity_kwp=1.0, tilt_deg=13, azimuth_deg=180, inverter_kw=0.5), weather(ghi=ghi))
        assert max(r.p50_kw) == pytest.approx(0.5, abs=1e-6)

    def test_losses_scale_output_linearly_and_capacity_scales_it_in_proportion(self):
        ghi = clear_sky_ghi(weather(hours=24))
        a = run(PvSystemIn(capacity_kwp=1, tilt_deg=13, azimuth_deg=180, loss_fraction=0.10), weather(ghi=ghi)).kwh_p50
        b = run(PvSystemIn(capacity_kwp=1, tilt_deg=13, azimuth_deg=180, loss_fraction=0.20), weather(ghi=ghi)).kwh_p50
        assert b / a == pytest.approx(0.8 / 0.9, rel=1e-4)  # outputs are rounded to 5 decimals
        big = run(PvSystemIn(capacity_kwp=5, tilt_deg=13, azimuth_deg=180, loss_fraction=0.10), weather(ghi=ghi)).kwh_p50
        assert big == pytest.approx(5 * a, rel=1e-4)

    def test_hour_labelling_matters_and_end_is_the_open_meteo_convention(self):
        ghi = clear_sky_ghi(weather(hours=24))
        end = run(w=weather(ghi=ghi, convention="end"))
        start = run(w=weather(ghi=ghi, convention="start"))
        assert end.p50_kw != start.p50_kw  # the sun is evaluated half an hour apart
        assert end.times == start.times  # the labels stay as sent
        assert any("middle of the hour" in a for a in end.assumptions)

    def test_the_assumptions_are_stated_not_hidden(self):
        r = run(w=weather(ghi=clear_sky_ghi(weather(hours=24))))
        text = " ".join(r.assumptions)
        for fragment in ("Simplified Solis", "isotropic", "Cell temperature", "Fixed system losses", "No shading"):
            assert fragment in text


def make_history(n_days=40, noise=0.10, seed=1, loc=BENGALURU, start="2026-02-01T00:00:00Z", bias=0.0):
    """Past hours where the forecast clearness index is uniform and the 'actual' is it plus Gaussian noise of known size."""
    rng = np.random.default_rng(seed)
    w0 = weather(start=start, hours=n_days * 24)
    cs = clear_sky_ghi(w0, loc)
    kt_f = rng.uniform(0.05, 1.0, len(cs))
    kt_a = np.clip(kt_f + bias + rng.normal(0, noise, len(cs)), 0, 1.2)
    fc, ac = np.clip(cs * kt_f, 0, 1500), np.clip(cs * kt_a, 0, 1500)
    hist = ForecastErrorHistory(weather=HourlyWeatherIn(start_time=start, convention="end", ghi_wm2=ac.tolist(), temperature_c=[30.0] * len(cs)), forecast_ghi_wm2=fc.tolist())
    return hist, kt_f, kt_a


class TestBands:
    def forecast_day(self, kt: float):
        w0 = weather(start="2026-03-20T00:00:00Z", hours=24)
        return weather(start="2026-03-20T00:00:00Z", ghi=clear_sky_ghi(w0) * kt)

    def test_no_history_means_no_band_and_it_says_so(self):
        r = run(w=self.forecast_day(0.7))
        assert r.p10_kw is None and r.p90_kw is None and r.calibration is None
        assert r.kwh_p10 is None and r.kwh_p90 is None
        assert any("no uncertainty band is claimed" in n for n in r.notes)

    def test_too_little_history_claims_no_band(self):
        hist, *_ = make_history(n_days=4)
        r = run(w=self.forecast_day(0.7), history=hist)
        assert r.p10_kw is None
        assert any("daylight hours" in n and "none is claimed" in n for n in r.notes)

    def test_the_band_widens_with_the_size_of_the_errors_it_was_learned_from(self):
        narrow, *_ = make_history(noise=0.03, seed=2)
        wide, *_ = make_history(noise=0.15, seed=2)
        day = self.forecast_day(0.7)
        a, b = run(w=day, history=narrow), run(w=day, history=wide)
        width = lambda r: sum(h - lo for h, lo in zip(r.p90_kw, r.p10_kw, strict=True))  # noqa: E731
        assert width(b) > 2.5 * width(a)

    def test_the_band_contains_the_central_forecast_and_is_never_inverted(self):
        hist, *_ = make_history()
        for kt in (0.1, 0.4, 0.7, 1.0):
            r = run(w=self.forecast_day(kt), history=hist)
            assert all(lo <= m + 1e-9 <= hi + 2e-9 for lo, m, hi in zip(r.p10_kw, r.p50_kw, r.p90_kw, strict=True))
            assert r.kwh_p10 <= r.kwh_p50 <= r.kwh_p90

    def test_held_out_coverage_of_the_80_percent_band_is_near_80(self):
        hist, *_ = make_history(n_days=60, noise=0.10, seed=3)
        r = run(w=self.forecast_day(0.7), history=hist)
        c = r.calibration
        assert c.target_coverage == 0.8
        assert c.holdout_hours >= 100
        assert 0.7 <= c.holdout_coverage <= 0.9, c.holdout_coverage  # measured on hours the band was not fitted to

    def test_the_calibration_recovers_the_known_error_size(self):
        hist, *_ = make_history(n_days=60, noise=0.10, seed=4)
        c = run(w=self.forecast_day(0.7), history=hist).calibration
        clear = next(b for b in c.bins if b.name == "clear")
        # a Gaussian of sigma 0.10 has its 10th and 90th percentiles at +/-1.28 sigma = +/-0.128 (a little less where clipping bites)
        assert -0.15 <= clear.p10 <= -0.10 and 0.10 <= clear.p90 <= 0.15
        assert abs(c.median_residual_kt) < 0.02

    def test_a_systematic_bias_shifts_the_band_not_just_widens_it(self):
        hist, *_ = make_history(n_days=60, noise=0.05, seed=5, bias=-0.15)  # the forecast is too sunny by 0.15 kt
        r = run(w=self.forecast_day(0.7), history=hist)
        assert r.calibration.median_residual_kt == pytest.approx(-0.15, abs=0.03)
        assert r.kwh_p90 < r.kwh_p50 * 1.1  # even the optimistic edge is not much above a forecast that runs high

    def test_a_rare_condition_falls_back_to_the_pooled_error_and_says_so(self):
        rng = np.random.default_rng(6)
        w0 = weather(start="2026-02-01T00:00:00Z", hours=30 * 24)
        cs = clear_sky_ghi(w0)
        kt_f = rng.uniform(0.7, 1.0, len(cs))  # never overcast, never partly cloudy
        ac = np.clip(cs * np.clip(kt_f + rng.normal(0, 0.05, len(cs)), 0, 1.2), 0, 1500)
        hist = ForecastErrorHistory(weather=HourlyWeatherIn(start_time="2026-02-01T00:00:00Z", ghi_wm2=ac.tolist(), temperature_c=[30.0] * len(cs)), forecast_ghi_wm2=np.clip(cs * kt_f, 0, 1500).tolist())
        r = run(w=self.forecast_day(0.5), history=hist)
        assert any("pooled error is used" in n for n in r.notes)
        assert r.p10_kw is not None

    def test_nothing_is_produced_outside_daylight(self):
        hist, *_ = make_history()
        r = run(w=self.forecast_day(0.8), history=hist)
        assert [i for i, v in enumerate(r.clear_sky_kw) if v == 0.0] == [i for i, v in enumerate(r.p10_kw) if v == 0.0 and r.clear_sky_kw[i] == 0.0]
        assert all(r.p90_kw[i] == 0.0 for i, v in enumerate(r.clear_sky_kw) if v == 0.0)


class TestEvaluate:
    def test_known_errors_give_known_metrics(self):
        actual = np.array([0.0] * 6 + [1.0, 2.0, 3.0, 2.0, 1.0] + [0.0] * 13, dtype=float)  # 24 hours
        r = solar.evaluate(SolarEvaluateRequest(forecast_kw=(actual + 0.5).tolist(), actual_kw=actual.tolist()))
        f = r.forecast
        assert f.hours == 24
        assert f.mae_kw == pytest.approx(0.5) and f.rmse_kw == pytest.approx(0.5) and f.bias_kw == pytest.approx(0.5)
        assert f.wape_pct == pytest.approx(24 * 0.5 / 9.0 * 100, rel=1e-6)
        # MAPE only over hours with real output (the five hours above 0.05 kW): mean of 0.5/1, 0.5/2, 0.5/3, 0.5/2, 0.5/1
        assert f.mape_pct == pytest.approx(np.mean([50, 25, 16.6667, 25, 50]), rel=1e-4)

    def test_a_perfect_forecast_beats_persistence_and_a_naive_one_does_not(self):
        day = np.array([0] * 6 + [1, 2, 3, 4, 5, 4, 3, 2, 1] + [0] * 9, dtype=float)
        actual = np.concatenate([day * 0.5, day * 1.5, day * 1.0])  # three days of different weather
        perfect = solar.evaluate(SolarEvaluateRequest(forecast_kw=actual.tolist(), actual_kw=actual.tolist()))
        assert perfect.forecast.mae_kw == 0 and perfect.skill_vs_persistence == pytest.approx(1.0)
        lazy = np.concatenate([actual[:24], actual[:-24]])  # yesterday's weather repeated: exactly persistence
        same = solar.evaluate(SolarEvaluateRequest(forecast_kw=lazy.tolist(), actual_kw=actual.tolist()))
        assert same.skill_vs_persistence == pytest.approx(0.0, abs=1e-9)
        worse = solar.evaluate(SolarEvaluateRequest(forecast_kw=(actual * 2).tolist(), actual_kw=actual.tolist()))
        assert worse.skill_vs_persistence < 0

    def test_skill_against_the_clear_sky_bound(self):
        day = np.array([0] * 6 + [1, 2, 3, 4, 5, 4, 3, 2, 1] + [0] * 9, dtype=float)
        actual = day * 0.6
        r = solar.evaluate(SolarEvaluateRequest(forecast_kw=(actual * 1.05).tolist(), actual_kw=actual.tolist(), clear_sky_kw=day.tolist()))
        assert r.clear_sky.mae_kw > r.forecast.mae_kw
        assert 0 < r.skill_vs_clear_sky < 1

    def test_fewer_than_48_hours_cannot_score_persistence_and_says_so(self):
        r = solar.evaluate(SolarEvaluateRequest(forecast_kw=[1.0] * 30, actual_kw=[1.0] * 30))
        assert r.persistence_24h is None and r.skill_vs_persistence is None
        assert any("Fewer than 48 hours" in n for n in r.notes)

    @pytest.mark.parametrize(("patch", "fragment"), [({"actual_kw": [1.0] * 10, "forecast_kw": [1.0] * 10}, "at least 24 hours"), ({"forecast_kw": [1.0] * 25}, "same hours")])
    def test_refusals(self, patch, fragment):
        from pydantic import ValidationError

        base = {"forecast_kw": [1.0] * 24, "actual_kw": [1.0] * 24}
        with pytest.raises(ValidationError, match=fragment):
            SolarEvaluateRequest(**{**base, **patch})


class TestInputRefusals:
    @pytest.mark.parametrize(
        ("weather_patch", "fragment"),
        [
            ({"ghi_wm2": [100.0, float("nan")], "temperature_c": [20.0, 20.0]}, "non-finite"),
            ({"ghi_wm2": [-5.0, 100.0], "temperature_c": [20.0, 20.0]}, "between 0 and 1500"),
            ({"ghi_wm2": [100.0, 100.0], "temperature_c": [20.0]}, "same number of hours"),
            ({"ghi_wm2": [100.0], "temperature_c": [120.0]}, "between -90 and 70"),
            ({"start_time": "2026-03-20T00:00:00", "ghi_wm2": [1.0], "temperature_c": [20.0]}, "time zone offset"),
        ],
    )
    def test_weather(self, weather_patch, fragment):
        from pydantic import ValidationError

        base = {"start_time": "2026-03-20T00:00:00Z", "ghi_wm2": [1.0], "temperature_c": [20.0]}
        with pytest.raises(ValidationError, match=fragment):
            HourlyWeatherIn(**{**base, **weather_patch})

    def test_a_system_must_be_physical(self):
        from pydantic import ValidationError

        for bad in ({"tilt_deg": 120}, {"azimuth_deg": 360}, {"capacity_kwp": 0}, {"loss_fraction": 0.9}, {"temp_coeff_per_c": 0.01}):
            with pytest.raises(ValidationError):
                PvSystemIn(**{"capacity_kwp": 1, "tilt_deg": 13, "azimuth_deg": 180, **bad})


def test_the_forecast_is_deterministic():
    hist, *_ = make_history(seed=9)
    day = weather(ghi=clear_sky_ghi(weather(hours=24)) * 0.7)
    assert run(w=day, history=hist).model_dump() == run(w=day, history=hist).model_dump()


def test_a_week_forecast_handles_a_long_series_quickly():
    import time

    n = 7 * 24
    w = weather(start="2026-03-20T00:00:00Z", hours=n)
    t0 = time.perf_counter()
    r = run(w=weather(start="2026-03-20T00:00:00Z", ghi=clear_sky_ghi(w) * 0.6), history=make_history(n_days=90)[0])
    assert len(r.p50_kw) == n and time.perf_counter() - t0 < 10
    pd.Timestamp(r.times[0])  # labels parse
