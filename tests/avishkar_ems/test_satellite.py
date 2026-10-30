import pytest

from avishkar_ems.satellite import (
    INDIAN_SATELLITE_HUBS,
    build_microgrid_map_deck,
    build_microgrid_plotly_map,
    fetch_satellite_solar,
)
from avishkar_ems.site import SiteSpec
from avishkar_ems.tariffs import COMMERCIAL_TOD


def test_indian_satellite_hubs_metadata():
    assert "shop-pune" in INDIAN_SATELLITE_HUBS
    assert "home-mathura" in INDIAN_SATELLITE_HUBS
    assert "clinic-jaipur" in INDIAN_SATELLITE_HUBS
    for _k, v in INDIAN_SATELLITE_HUBS.items():
        assert 8.0 <= v["lat"] <= 37.0  # Indian latitude bounds
        assert 68.0 <= v["lon"] <= 97.0 # Indian longitude bounds
        assert "INSAT" in v["primary_satellite"]

def test_fetch_satellite_solar():
    report = fetch_satellite_solar(18.5204, 73.8567, days=1)
    assert report.lat == pytest.approx(18.5204)
    assert report.lon == pytest.approx(73.8567)
    assert -10.0 <= report.current_temp_c <= 60.0
    assert 0.0 <= report.current_cloud_cover_pct <= 100.0
    assert report.current_dni_wm2 >= 0.0
    assert len(report.hourly_df) >= 24
    assert "dni_wm2" in report.hourly_df.columns
    assert "cloud_pct" in report.hourly_df.columns

def test_build_microgrid_map_deck():
    pytest.importorskip("pydeck", reason="pydeck is an optional dashboard dependency")
    mock_site = SiteSpec(
        site_id="shop-pune",
        lat=18.52,
        lon=73.85,
        dc_kwp=15.0,
        ac_kw=15.0,
        tilt=15.0,
        azimuth=180.0,
        battery_kwh=20.0,
        battery_kw=10.0,
        critical_kw=1.5,
        backup_hours=4.0,
        system_cost_inr=1150000.0,
        tariff=COMMERCIAL_TOD,
    )
    deck = build_microgrid_map_deck({"shop-pune": mock_site}, selected_key="shop-pune")
    assert len(deck.layers) == 3 # Scatter, Text, Arc
    assert deck.initial_view_state.latitude == pytest.approx(22.2)

def test_build_microgrid_plotly_map():
    mock_site = SiteSpec(
        site_id="shop-pune",
        lat=18.52,
        lon=73.85,
        dc_kwp=15.0,
        ac_kw=15.0,
        tilt=15.0,
        azimuth=180.0,
        battery_kwh=20.0,
        battery_kw=10.0,
        critical_kw=1.5,
        backup_hours=4.0,
        system_cost_inr=1150000.0,
        tariff=COMMERCIAL_TOD,
    )
    # With no trades given, the map draws the node categories and nothing else. It used to hardcode three
    # trades with invented energies and prices and draw them between real cities; nothing is invented now.
    fig = build_microgrid_plotly_map({"shop-pune": mock_site}, selected_key="shop-pune")
    assert len(fig.data) >= 1
    traces_without_trades = len(fig.data)
    assert not any("Matched trade" in str(t.text or "") for t in fig.data)

    # A real matched trade adds exactly one line, and names the two ends.
    with_trade = build_microgrid_plotly_map(
        {"shop-pune": mock_site},
        selected_key="shop-pune",
        trades=[{"from": "shop-pune", "to": "home-mathura", "kwh": 6.8, "price": 7.25}],
    )
    assert len(with_trade.data) == traces_without_trades + 1
    assert any("Matched trade" in str(t.text or "") for t in with_trade.data)

    # A trade naming somewhere this map does not know is skipped, not guessed at.
    unknown = build_microgrid_plotly_map(
        {"shop-pune": mock_site},
        selected_key="shop-pune",
        trades=[{"from": "atlantis", "to": "home-mathura", "kwh": 1.0, "price": 1.0}],
    )
    assert len(unknown.data) == traces_without_trades

    # A node AVISHKAR holds no equipment for says so, instead of showing a plausible size nobody entered.
    hovers = " ".join(str(t.hovertext) for t in fig.data)
    assert "not configured in AVISHKAR" in hovers
    assert "15.0 kWp" in hovers  # the configured site's real size is still shown

