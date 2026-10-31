"""Smoke test: the dashboard script runs top to bottom for every site without raising.

It reads the real disk cache, so it only runs when `scripts/precompute_cache.py` has been run on the current code
(otherwise the first page load would train models and replay a year, which takes minutes).
"""

import pytest

from avishkar_ems import cache

pytest.importorskip("streamlit")
pytestmark = pytest.mark.skipif(cache.cache_status() != "fresh",
                                reason="no fresh cache: run python scripts/precompute_cache.py first")


def test_dashboard_runs_for_every_site():
    from streamlit.testing.v1 import AppTest

    # the default view is the national and state explorer; it must load without raising too
    at = AppTest.from_file(str(cache.ROOT / "app" / "dashboard.py"), default_timeout=300).run()
    assert not at.exception, [e.value for e in at.exception]
    at = at.sidebar.radio[0].set_value(at.sidebar.radio[0].options[0]).run()
    assert not at.exception, [e.value for e in at.exception]
    labels = [t.label for t in at.tabs]
    expected_tab_keywords = (
        "Satellite Radar",
        "Citizen Guide",
        "Plan for the Day",
        "Offers & Beckn",
        "Hardware Inverter",
        "Wheeling & UPI",
        "EV V2H",
        "Fleet Pooling",
        "Payback",
        "Advisor",
        "Smart Meter",
        "Fault Monitoring",
    )
    for kw in expected_tab_keywords:
        assert any(kw in label for label in labels), (kw, labels)
    for site in ("home-mathura", "clinic-jaipur", "shop-pune"):
        at = at.sidebar.selectbox[0].set_value(site).run()
        assert not at.exception, (site, [e.value for e in at.exception])
