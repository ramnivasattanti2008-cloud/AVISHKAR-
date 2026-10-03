import json
import pathlib

import pytest

from avishkar_ems.ies import validate_publish
from avishkar_ems.realdata import real_site_frame
from avishkar_ems.schema import validate_site_frame
from avishkar_ems.sim import demo_sites

DEG = pathlib.Path("/home/claude/beckn/deg/devkits/p2p-trading-ies-wave2/uc1/examples/publish-catalog.json")


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


@pytest.mark.skipif(not DEG.exists(), reason="beckn/DEG clone not present")
def test_validator_accepts_official_devkit_example():
    assert validate_publish(json.loads(DEG.read_text())) == []
