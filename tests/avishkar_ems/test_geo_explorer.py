"""Tests for Geographic Energy Explorer and Boundary Rigor."""

from __future__ import annotations

import pytest

from avishkar_ems.geo_explorer import GeoExplorer, GeoLevel


@pytest.fixture
def explorer():
    return GeoExplorer()


def test_hierarchy_loads_entities(explorer):
    entities = explorer.list_entities()
    assert len(entities) >= 4
    in_ent = explorer.get_entity("IN")
    assert in_ent.level == GeoLevel.NATIONAL
    assert in_ent.name == "India (All India)"

    ka = explorer.get_entity("KA")
    assert ka.level == GeoLevel.STATE
    assert "BESCOM" in ka.served_by_utilities or "BESCOM" in ka.metadata.get("utilities", [])

    ap = explorer.get_entity("AP")
    assert ap.level == GeoLevel.STATE


def test_coverage_matrix_rigor(explorer):
    # Energy requirement is available at National and State, but explicitly UNAVAILABLE at District
    nat_cov = explorer.get_availability("ENERGY_REQUIREMENT", GeoLevel.NATIONAL)
    assert nat_cov.status == "AVAILABLE"

    st_cov = explorer.get_availability("ENERGY_REQUIREMENT", GeoLevel.STATE)
    assert st_cov.status == "AVAILABLE"

    dist_cov = explorer.get_availability("ENERGY_REQUIREMENT", GeoLevel.DISTRICT)
    assert dist_cov.status == "UNAVAILABLE"
    assert "disaggregation prohibited" in dist_cov.reason.lower()


def test_refuse_district_disaggregation_from_state(explorer):
    # Attempting to synthesize district stats from state total is prohibited
    allowed = explorer.verify_no_disaggregation("ENERGY_REQUIREMENT", "KA", "KA_BLR_URBAN")
    assert not allowed, "Should strictly disallow creating synthetic district data from state totals"


def test_utility_and_district_not_coterminous(explorer):
    # BESCOM serves 8 districts, not just Bengaluru Urban
    assert not explorer.are_utility_and_district_coterminous("BESCOM", "KA_BLR_URBAN")
