import pytest

from avishkar_ems.sim import demo_sites, simulate_site


@pytest.fixture(scope="session")
def shop():
    site, kind = demo_sites()["shop-pune"]
    return site, kind


@pytest.fixture(scope="session")
def shop_year(shop):
    site, kind = shop
    return simulate_site(site, start="2025-01-01", days=730, seed=3, load_kind=kind)
