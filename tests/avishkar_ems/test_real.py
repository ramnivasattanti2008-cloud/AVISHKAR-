import json
import os
import pathlib

import pandas as pd
import pytest

from avishkar_ems.ies import validate_publish
from avishkar_ems.realdata import real_site_frame
from avishkar_ems.schema import validate_site_frame
from avishkar_ems.sim import demo_sites

DEG = pathlib.Path(os.environ.get("DEG_PUBLISH_EXAMPLE", "beckn-deg/publish-catalog.json"))  # official devkit example


@pytest.fixture(scope="module")
def real_pune():
    return demo_sites()["shop-pune"][0], real_site_frame(demo_sites()["shop-pune"][0])


def test_real_frame_matches_schema_and_physics(real_pune):
    site, df = real_pune
    assert validate_site_frame(df) == []
    assert not df.isna().any().any()
    kwh_per_kwp_day = df["pv_kw"].resample("D").sum().mean() * 0.25 / site.dc_kwp
    assert 3.0 < kwh_per_kwp_day < 5.0  # real Indian rooftop yield range
    monthly = df["pv_kw"].groupby(df.index.month).mean()
    assert monthly[[6, 7, 8]].mean() < monthly[[2, 3, 4]].mean()  # monsoon months are weaker


def test_forecast_inputs_use_only_past_information(real_pune):
    _, df = real_pune
    d1 = df[df.index.date == df.index[96 * 10].date()]
    prev = df[df.index.date == df.index[96 * 9].date()]
    sun = prev["kt_actual"][prev["pv_clear_kw"] > 0]
    assert d1["kt_fcst"].iloc[0] == pytest.approx(sun.mean(), abs=0.15)  # yesterday's clearness, not today's


@pytest.mark.skipif(not DEG.exists(), reason="set DEG_PUBLISH_EXAMPLE to the devkit publish-catalog.json")
def test_validator_accepts_official_devkit_example():
    assert validate_publish(json.loads(DEG.read_text())) == []


def test_real_home_has_measured_outages_and_load():
    from avishkar_ems.realdata import real_sites
    site, _, meter = real_sites()["home-mathura"]
    df = real_site_frame(site, meter=meter)
    assert validate_site_frame(df) == []
    assert 0.005 < df["outage"].mean() < 0.05  # measured grid-down share, about 1.4%
    assert 8 < df["load_kw"].resample("D").sum().mean() * 0.25 < 16  # a real household's kWh/day


def test_tariff_file_loader(tmp_path):
    from avishkar_ems.tariffs import load_tariff
    f = tmp_path / "t.json"
    f.write_text('{"name":"x","tou_blocks":[[0,24,6.5]],"export_rate":2.5,"p2p_charges":0.5,"shortfall_penalty":4}')
    t = load_tariff(f)
    idx = pd.date_range("2024-01-01", periods=4, freq="15min", tz="Asia/Kolkata")
    assert (t.import_rates(idx) == 6.5).all() and t.export_rate == 2.5


def test_plain_summary_both_languages():
    import logging
    logging.disable(logging.WARNING)
    from avishkar_ems.demo import day_view, prepare
    from avishkar_ems.summary import plain_summary
    p = prepare("home-mathura")
    dv = day_view(p, p.test_start + pd.Timedelta(days=20))
    en, hi = plain_summary(dv, p.site.backup_hours, "en"), plain_summary(dv, p.site.backup_hours, "hi")
    assert "battery" in en and "बैटरी" in hi
