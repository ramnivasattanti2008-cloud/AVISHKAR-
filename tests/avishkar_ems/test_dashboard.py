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
    at = at.sidebar.radio[0].set_value("⚡ Site Dispatch EMS (AVISHKAR)").run()
    assert not at.exception, [e.value for e in at.exception]
    labels = [t.label for t in at.tabs]
    for name in ("Plan for the day", "Offers & Settlement", "Fleet / Community Pooling", "Payback & Subsidy", "Smart Advisory", "Live Fault Monitor", "Shiftable Loads", "Upload Your Meter"):
        assert any(name in label for label in labels), (name, labels)
    for site in ("home-mathura", "clinic-jaipur", "shop-pune"):
        at = at.sidebar.selectbox[0].set_value(site).run()
        assert not at.exception, (site, [e.value for e in at.exception])
