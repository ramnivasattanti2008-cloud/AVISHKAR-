"""Load engine: series with a known weekly structure and noise of known size, so the right answers are known in advance."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from avishkar_engine import load
from avishkar_engine.forecast_schemas import LoadForecastRequest, LoadSeriesIn
from pydantic import ValidationError

IST = 330


def pattern_kw(local_hour: int, weekday: int) -> float:
    """The true underlying load: a base, a morning bump, an evening peak, higher at weekends."""
    kw = 0.5 + (0.6 if 7 <= local_hour < 9 else 0.0) + (2.0 if 18 <= local_hour < 22 else 0.0)
    return kw + (0.4 if weekday >= 5 else 0.0)


def history(days=70, noise=0.1, seed=0, interval=60, gap_share=0.0, start="2026-01-05T00:00:00+05:30", level_shift=None):
    """`days` of readings from a Monday 00:00 IST, kWh per interval, with the true pattern plus Gaussian noise."""
    rng = np.random.default_rng(seed)
    t0 = pd.Timestamp(start)
    n = days * 24 * 60 // interval
    idx = pd.date_range(t0, periods=n, freq=f"{interval}min")
    kw = np.array([pattern_kw(t.tz_convert("Asia/Kolkata").hour, t.tz_convert("Asia/Kolkata").dayofweek) for t in idx])
    if level_shift:
        kw = kw * np.where(np.arange(n) >= level_shift, 1.5, 1.0)
    kw = np.clip(kw + rng.normal(0, noise, n), 0, None)
    kwh = (kw * interval / 60).tolist()
    for i in rng.choice(n, int(n * gap_share), replace=False) if gap_share else []:
        kwh[i] = None
    return LoadSeriesIn(start_time=start, interval_minutes=interval, kwh=kwh)


def run(h, **kw):
    return load.forecast(LoadForecastRequest(history=h, **kw))


class TestForecast:
    def test_recovers_a_known_weekly_pattern_with_bands_around_it(self):
        r = run(history(days=70, noise=0.1))
        assert r.status == "ok" and r.unavailable_reason is None
        assert len(r.p50_kw) == 24 == len(r.times)
        # forecast starts Monday 2026-03-16 00:00 IST = Sunday 18:30Z; each label is a local hour start
        assert r.times[0] == "2026-03-15T18:30:00Z"
        for i, t in enumerate(pd.to_datetime(r.times)):
            local = t.tz_convert("Asia/Kolkata")
            assert r.p50_kw[i] == pytest.approx(pattern_kw(local.hour, local.dayofweek), abs=0.25), (local, r.p50_kw[i])
        assert all(lo <= m <= hi for lo, m, hi in zip(r.p10_kw, r.p50_kw, r.p90_kw, strict=True))
        assert r.kwh_p50 == pytest.approx(sum(r.p50_kw), abs=1e-3)

    def test_the_band_is_wide_where_the_noise_is_and_covers_about_80_percent(self):
        r = run(history(days=70, noise=0.2, seed=1))
        best = next(m for m in r.methods if m.method == r.selected_method)
        assert 0.65 <= best.coverage_80 <= 0.95, best.coverage_80
        widths = np.array(r.p90_kw) - np.array(r.p10_kw)
        # noise sigma 0.2 gives an 80% band about 2 x 1.28 x 0.2 = 0.51 wide before the uncertainty of the method itself
        assert 0.3 <= widths.mean() <= 1.2, widths.mean()
        narrow = run(history(days=70, noise=0.02, seed=1))
        assert (np.array(narrow.p90_kw) - np.array(narrow.p10_kw)).mean() < widths.mean() / 3

    def test_all_methods_are_scored_on_the_same_holdout_and_listed_best_first(self):
        r = run(history(days=70))
        assert {m.method for m in r.methods} == {"last_week", "same_hour_of_week", "same_hour_recent", "gbm_quantile"}
        assert [m.mae_kw for m in r.methods] == sorted(m.mae_kw for m in r.methods)
        assert r.holdout_days == 14
        # with noise sigma 0.1 the best any method can do is about 0.08 kW MAE; the worst baseline carries twice the noise
        assert r.methods[0].mae_kw < 0.2
        assert next(m for m in r.methods if m.method == "last_week").mae_kw > next(m for m in r.methods if m.method == "same_hour_of_week").mae_kw

    def test_the_model_only_displaces_a_baseline_when_it_beats_it_by_2_percent(self):
        r = run(history(days=70, noise=0.1))
        by = {m.method: m.mae_kw for m in r.methods}
        base = min(v for k, v in by.items() if k != "gbm_quantile")
        if r.selected_method == "gbm_quantile":
            assert by["gbm_quantile"] <= 0.98 * base
        else:
            assert by["gbm_quantile"] > 0.98 * base
            assert any("did not beat the best baseline" in n for n in r.notes)

    def test_peak_probability_is_higher_in_the_evening_than_at_night(self):
        r = run(history(days=70, noise=0.2, seed=2))
        assert r.peak_threshold_kw is not None
        hours = [pd.Timestamp(t).tz_convert("Asia/Kolkata").hour for t in r.times]
        evening = np.mean([p for p, h in zip(r.peak_probability, hours, strict=True) if 18 <= h < 22])
        night = np.mean([p for p, h in zip(r.peak_probability, hours, strict=True) if h < 5])
        assert all(0 <= p <= 1 for p in r.peak_probability)
        assert evening > night + 0.1
        assert night < 0.05

    def test_a_week_ahead_is_as_valid_as_a_day_ahead(self):
        r = run(history(days=70), horizon_hours=168)
        assert len(r.p50_kw) == 168
        sat = [(i, pd.Timestamp(t).tz_convert("Asia/Kolkata")) for i, t in enumerate(r.times)]
        weekend_evening = np.mean([r.p50_kw[i] for i, t in sat if t.dayofweek >= 5 and 18 <= t.hour < 22])
        weekday_evening = np.mean([r.p50_kw[i] for i, t in sat if t.dayofweek < 5 and 18 <= t.hour < 22])
        assert weekend_evening > weekday_evening + 0.2  # the weekend uplift of 0.4 is learned

    def test_a_forecast_can_be_issued_from_an_earlier_point_using_only_what_came_before(self):
        h = history(days=70)
        early = run(h, forecast_start="2026-03-01T00:00:00+05:30")
        assert early.times[0] == "2026-02-28T18:30:00Z"
        assert early.history_days == pytest.approx(55, abs=0.1)  # 2026-01-05 to 2026-03-01: only the days before that instant

    def test_fifteen_minute_readings_give_the_same_forecast_as_hourly(self):
        hourly = run(history(days=60, noise=0.05, seed=3, interval=60))
        quarter = run(history(days=60, noise=0.05, seed=3, interval=15))
        assert quarter.times == hourly.times
        assert np.array(quarter.p50_kw) == pytest.approx(np.array(hourly.p50_kw), abs=0.1)

    def test_gaps_are_left_alone_and_the_forecast_still_works(self):
        r = run(history(days=70, noise=0.1, gap_share=0.25, seed=4))
        assert r.status == "ok"
        assert r.gaps_share == pytest.approx(0.25, abs=0.03)
        assert not any(np.isnan(r.p50_kw)) and not any(np.isnan(r.p10_kw)) and not any(np.isnan(r.p90_kw))
        for i, t in enumerate(pd.to_datetime(r.times)):
            local = t.tz_convert("Asia/Kolkata")
            assert r.p50_kw[i] == pytest.approx(pattern_kw(local.hour, local.dayofweek), abs=0.35)
        assert any("left as gaps" in a for a in r.assumptions)

    def test_a_level_shift_late_in_the_history_is_not_learned_from_a_week_ago_alone(self):
        # the load rises 50% for the last 3 weeks: weekly-lagged features see it after a week; the forecast sits between the two levels
        r = run(history(days=70, noise=0.05, level_shift=47 * 24, seed=5))
        evening = [r.p50_kw[i] for i, t in enumerate(pd.to_datetime(r.times)) if 18 <= t.tz_convert("Asia/Kolkata").hour < 22]
        assert np.mean(evening) > 2.5 * 1.1  # above the old level of 2.5 kW: it noticed
        assert any("a week" in a for a in r.assumptions)

    def test_the_forecast_is_deterministic(self):
        h = history(days=60, seed=6)
        assert run(h).model_dump() == run(h).model_dump()

    def test_seasonality_is_only_claimed_when_there_is_a_year_to_learn_it_from(self):
        short = run(history(days=70))
        long = run(history(days=330, noise=0.1, seed=7))
        assert any("Seasonality is not modelled" in a for a in short.assumptions)
        assert any("Seasonality is learned" in a for a in long.assumptions)


class TestUnavailable:
    def test_less_than_two_weeks_is_declined_with_the_reason(self):
        r = run(history(days=10))
        assert r.status == "unavailable"
        assert "at least 14 days" in r.unavailable_reason and "10.0 days" in r.unavailable_reason
        assert r.p50_kw == [] and r.selected_method is None

    def test_mostly_missing_readings_are_declined(self):
        r = run(history(days=40, gap_share=0.6, seed=8))
        assert r.status == "unavailable"
        assert "at least 60%" in r.unavailable_reason

    def test_between_two_and_six_weeks_only_baselines_run_and_it_says_so(self):
        r = run(history(days=30))
        assert r.status == "ok"
        assert {m.method for m in r.methods} == {"last_week", "same_hour_of_week", "same_hour_recent"}
        assert any("needs at least 42 days" in n for n in r.notes)

    def test_a_start_before_the_first_reading_is_declined(self):
        r = run(history(days=30), forecast_start="2025-12-01T00:00:00+05:30")
        assert r.status == "unavailable" and "before the first reading" in r.unavailable_reason


class TestInputRefusals:
    def test_readings_must_be_sane(self):
        for kwh in ([-1.0] + [1.0] * 30, [float("inf")] + [1.0] * 30, [None] * 30, [1.0] * 5):
            with pytest.raises(ValidationError):
                LoadSeriesIn(start_time="2026-01-01T00:00:00Z", interval_minutes=60, kwh=kwh)

    def test_times_need_an_offset_and_the_interval_must_be_one_the_meters_use(self):
        with pytest.raises(ValidationError, match="time zone offset"):
            LoadSeriesIn(start_time="2026-01-01T00:00:00", interval_minutes=60, kwh=[1.0] * 48)
        with pytest.raises(ValidationError):
            LoadSeriesIn(start_time="2026-01-01T00:00:00Z", interval_minutes=45, kwh=[1.0] * 48)  # type: ignore[arg-type]

    def test_the_horizon_is_bounded(self):
        h = LoadSeriesIn(start_time="2026-01-01T00:00:00Z", interval_minutes=60, kwh=[1.0] * 400)
        for bad in (0, 169):
            with pytest.raises(ValidationError):
                LoadForecastRequest(history=h, horizon_hours=bad)
