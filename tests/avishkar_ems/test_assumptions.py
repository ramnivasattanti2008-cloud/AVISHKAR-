"""Inputs that used to be hard-coded assumptions are now explicit settings."""

import json
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest

from avishkar_ems import realdata
from avishkar_ems.sim import demo_sites, simulate_site
from avishkar_ems.tariffs import COMMERCIAL_TOD, load_tariff


def test_p2p_share_defaults_to_the_old_55_percent():
    assert COMMERCIAL_TOD.p2p_share == 0.55


def test_load_tariff_reads_p2p_share(tmp_path):
    f = tmp_path / "t.json"
    base = {"tou_blocks": [[0, 24, 7.0]], "export_rate": 3.0, "p2p_charges": 0.6, "shortfall_penalty": 5.0}
    f.write_text(json.dumps(base))
    assert load_tariff(f).p2p_share == 0.55
    f.write_text(json.dumps({**base, "p2p_share": 0.8}))
    assert load_tariff(f).p2p_share == 0.8


def test_simulated_p2p_forecast_follows_the_tariff_share():
    site, kind = demo_sites()["shop-pune"]
    site = replace(site, tariff=replace(site.tariff, p2p_share=0.9))
    df = simulate_site(site, "2025-03-01", 3, seed=1, load_kind=kind)
    expected = df["export_rate"] + (df["import_rate"] - df["export_rate"]) * 0.9
    assert np.allclose(df["p2p_price_fcst"], expected)


def test_pvgis_cache_key_includes_the_location(tmp_path, monkeypatch):
    """Two sites that differ only in coordinates must not share one cached weather file."""
    monkeypatch.setattr(realdata, "DATA", tmp_path)
    calls = []

    def fake_pvgis(lat, lon, **kwargs):
        calls.append((lat, lon))
        idx = pd.DatetimeIndex(["2023-01-01 00:00", "2023-01-01 01:00"], tz="UTC")
        return pd.DataFrame({"poa_global": [1.0, 2.0], "temp_air": [20.0, 21.0]}, index=idx), {}

    monkeypatch.setattr(realdata, "get_pvgis_hourly", fake_pvgis)
    site, _ = demo_sites()["shop-pune"]
    elsewhere = replace(site, lat=site.lat + 5.0, lon=site.lon + 5.0)
    realdata.pvgis_weather(site, 2023, 2023)
    realdata.pvgis_weather(site, 2023, 2023)  # cached
    realdata.pvgis_weather(elsewhere, 2023, 2023)  # a different place: must fetch again
    assert calls == [(site.lat, site.lon), (elsewhere.lat, elsewhere.lon)]


def _hourly(years):
    idx = pd.date_range(f"{years[0]}-01-01", f"{years[-1]}-12-31 23:00", freq="h", tz="UTC")
    return pd.DataFrame({"poa_global": 1.0, "temp_air": 20.0}, index=idx)


def test_a_cached_file_covering_the_years_is_reused_without_a_download(tmp_path, monkeypatch):
    monkeypatch.setattr(realdata, "DATA", tmp_path)
    monkeypatch.setattr(realdata, "get_pvgis_hourly",
                        lambda *a, **k: pytest.fail("must not download: a cached file already covers 2020"))
    site, _ = demo_sites()["shop-pune"]
    name = f"pvgis_{site.site_id}_{site.lat:.2f}_{site.lon:.2f}_{site.tilt:.0f}_{site.azimuth:.0f}_2019_2021.csv"
    _hourly([2019, 2020, 2021]).tz_convert(site.tz).to_csv(tmp_path / name)
    got = realdata.pvgis_weather(site, 2020, 2020)
    assert set(got.index.year) == {2020}


def test_an_unreachable_weather_service_gives_a_plain_error(tmp_path, monkeypatch):
    import requests

    monkeypatch.setattr(realdata, "DATA", tmp_path)

    def down(*a, **k):
        raise requests.exceptions.ConnectTimeout("timed out")

    monkeypatch.setattr(realdata, "get_pvgis_hourly", down)
    site, _ = demo_sites()["shop-pune"]
    with pytest.raises(RuntimeError, match="PVGIS"):
        realdata.pvgis_weather(site, 2023, 2023)


def test_leap_year_weather_can_be_laid_over_ordinary_years(monkeypatch):
    """Regression: relabelling 29 Feb of a leap weather year into a non-leap year raised 'day is out of range'."""
    site, _ = demo_sites()["shop-pune"]
    weather = _hourly([2020]).tz_convert(site.tz)
    monkeypatch.setattr(realdata, "pvgis_weather", lambda s, start, end: weather)
    idx = pd.date_range("2021-01-01", periods=96 * 120, freq="15min", tz=site.tz)
    df = realdata.real_site_frame(site, load_kw=pd.Series(2.0, index=idx), weather_year=2020)
    assert len(df) == len(idx) and df["pv_kw"].notna().all()
