"""Typical days: a month's mean irradiation turned into one day of power, tested against physics and the forecast engine."""

from __future__ import annotations

import numpy as np
import pytest
from avishkar_engine import solar
from avishkar_engine.forecast_schemas import (
    LocationIn,
    MonthClimate,
    PvSystemIn,
    TypicalDaysRequest,
)
from pydantic import ValidationError

BENGALURU = LocationIn(latitude=12.97, longitude=77.59, altitude_m=900)
SYSTEM = PvSystemIn(capacity_kwp=5, tilt_deg=13, azimuth_deg=180)


def run(months=None, system=SYSTEM, loc=BENGALURU, **kw):
    months = months or [MonthClimate(month=m, ghi_kwh_m2_day=5.5, air_temp_c=26) for m in range(1, 13)]
    return solar.typical_days(TypicalDaysRequest(location=loc, system=system, months=months, **kw))


class TestPhysics:
    def test_each_day_carries_exactly_the_irradiation_it_was_given(self):
        r = run()
        assert len(r.days) == 12
        for d in r.days:
            assert not d.capped
            assert d.ghi_kwh_m2_day_used == pytest.approx(5.5, rel=0.002), d.month

    def test_power_follows_the_sun_with_none_at_night_and_a_midday_peak(self):
        d = run().days[2]  # March
        p = np.array(d.pv_kw)
        assert len(p) == 24
        assert p[:5].sum() == 0 and p[20:].sum() == 0  # local midnight to 5 am and 8 pm onward
        assert 10 <= int(np.argmax(p)) <= 13  # local solar noon in India is near 12:15 to 12:30
        assert p.max() <= 5.0  # a 5 kWp system never exceeds its rating
        assert 4.0 <= d.kwh_per_kwp <= 5.3  # 5.5 kWh/m2/day through a 14% loss and heat: a believable yield

    def test_the_hours_are_local_not_utc(self):
        utc = run(timezone_offset_minutes=0).days[0]
        ist = run(timezone_offset_minutes=330).days[0]
        # the same sun reads 5.5 hours later on the Indian clock than on UTC: the peak moves by 5 or 6 hours
        shift = int(np.argmax(utc.pv_kw)) - int(np.argmax(ist.pv_kw))
        assert shift in (-5, -6)
        assert sum(utc.pv_kw) == pytest.approx(sum(ist.pv_kw), rel=0.01)  # the same day's energy

    def test_more_irradiation_gives_proportionally_more_energy_until_the_system_clips(self):
        dim = run([MonthClimate(month=6, ghi_kwh_m2_day=3.0)]).days[0]
        bright = run([MonthClimate(month=6, ghi_kwh_m2_day=6.0)]).days[0]
        assert bright.kwh_per_kwp == pytest.approx(2 * dim.kwh_per_kwp, rel=0.08)  # not exactly 2: heat is not in this call

    def test_capacity_is_linear_and_orientation_matters(self):
        one = run([MonthClimate(month=3, ghi_kwh_m2_day=5.5)], PvSystemIn(capacity_kwp=1, tilt_deg=13, azimuth_deg=180)).days[0]
        five = run([MonthClimate(month=3, ghi_kwh_m2_day=5.5)]).days[0]
        assert sum(five.pv_kw) == pytest.approx(5 * sum(one.pv_kw), rel=1e-3)
        north = run([MonthClimate(month=3, ghi_kwh_m2_day=5.5)], PvSystemIn(capacity_kwp=5, tilt_deg=30, azimuth_deg=0)).days[0]
        south = run([MonthClimate(month=3, ghi_kwh_m2_day=5.5)], PvSystemIn(capacity_kwp=5, tilt_deg=30, azimuth_deg=180)).days[0]
        assert south.kwh_per_kwp > north.kwh_per_kwp

    def test_the_inverter_limit_clips_and_heat_costs_output(self):
        clipped = run([MonthClimate(month=3, ghi_kwh_m2_day=6.0)], PvSystemIn(capacity_kwp=5, tilt_deg=13, azimuth_deg=180, inverter_kw=2)).days[0]
        assert max(clipped.pv_kw) == pytest.approx(2.0, abs=1e-6)
        cool = run([MonthClimate(month=3, ghi_kwh_m2_day=5.5, air_temp_c=15)]).days[0]
        hot = run([MonthClimate(month=3, ghi_kwh_m2_day=5.5, air_temp_c=40)]).days[0]
        assert cool.kwh_per_kwp > hot.kwh_per_kwp

    def test_a_climatology_far_above_a_clear_day_is_capped_and_says_so(self):
        r = run([MonthClimate(month=12, ghi_kwh_m2_day=11.5)])
        d = r.days[0]
        assert d.capped and d.clearness == pytest.approx(1.25)
        assert d.ghi_kwh_m2_day_used < 11.5
        assert any("capped" in n for n in r.notes)

    def test_the_energy_matches_the_forecast_engine_on_the_same_clear_sky_scaled_day(self):
        # the same scaled clear day, fed to the forecast engine as an hourly weather series (labelled by hour end), must give the same energy
        from avishkar_engine.forecast_schemas import HourlyWeatherIn, SolarForecastRequest

        d = run([MonthClimate(month=3, ghi_kwh_m2_day=5.5, air_temp_c=26)]).days[0]
        import pandas as pd

        off = pd.Timedelta(minutes=330)
        starts = pd.date_range(pd.Timestamp(year=2026, month=3, day=15, tz="UTC") - off, periods=24, freq="1h")
        ch = solar._chain(BENGALURU, starts + pd.Timedelta(minutes=30))
        ghi = (ch.cs_ghi * d.clearness).tolist()
        w = HourlyWeatherIn(start_time=(starts[0] + pd.Timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"), convention="end", ghi_wm2=ghi, temperature_c=[26.0] * 24)
        f = solar.forecast(SolarForecastRequest(location=BENGALURU, system=SYSTEM, weather=w))
        assert sum(d.pv_kw) == pytest.approx(f.kwh_p50, rel=1e-3)


class TestInput:
    def test_months_must_be_real_and_unique(self):
        with pytest.raises(ValidationError):
            MonthClimate(month=13, ghi_kwh_m2_day=5)
        with pytest.raises(ValidationError):
            MonthClimate(month=3, ghi_kwh_m2_day=0)
        with pytest.raises(ValidationError, match="each month may appear once"):
            run([MonthClimate(month=3, ghi_kwh_m2_day=5), MonthClimate(month=3, ghi_kwh_m2_day=6)])
        with pytest.raises(ValidationError):
            TypicalDaysRequest(location=BENGALURU, system=SYSTEM, months=[])

    def test_the_assumptions_are_stated(self):
        r = run([MonthClimate(month=3, ghi_kwh_m2_day=5.5)])
        text = " ".join(r.assumptions)
        assert "no cloudy-day variability" in text and "15th" in text

    def test_it_is_deterministic(self):
        assert run().model_dump() == run().model_dump()
