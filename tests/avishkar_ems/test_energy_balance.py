"""Tests for Electricity Balance Analysis and Energy Gap calculations."""

from __future__ import annotations

import pytest

from avishkar_ems.energy_balance import EnergyBalanceAnalyzer


@pytest.fixture
def analyzer():
    return EnergyBalanceAnalyzer()


def test_national_record_loading(analyzer):
    rec = analyzer.get_record("IN", "2024-05")
    assert rec.geo_code == "IN"
    assert rec.energy_requirement_mu == 156320.0
    assert rec.energy_supplied_mu == 155120.0
    assert rec.peak_demand_mw == 250200.0


def test_energy_gap_calculation(analyzer):
    rec = analyzer.get_record("KA", "2024-05")
    res = analyzer.calculate_energy_gap(rec)
    assert res.energy_requirement_mu == 7920.0
    assert res.energy_supplied_mu == 7880.0
    assert res.gap_mu == 40.0
    assert res.gap_percentage == pytest.approx(0.505, abs=0.01)
    assert not res.is_balanced
    assert "IMPORTANT CAVEAT" in res.caveat
    assert "NOT necessarily a measurement of real-time grid shortages" in res.caveat


def test_incompatible_unit_rejection(analyzer):
    rec = analyzer.get_record("IN", "2024-05")
    # Incompatible unit: "GWh" passed instead of "MU"
    with pytest.raises(ValueError, match="Incompatible energy units"):
        analyzer.calculate_energy_gap(rec, external_supplied=(155120.0, "GWh", "2024-05", "IN"))


def test_incompatible_period_rejection(analyzer):
    rec = analyzer.get_record("IN", "2024-05")
    with pytest.raises(ValueError, match="Incompatible reporting periods"):
        analyzer.calculate_energy_gap(rec, external_supplied=(155120.0, "MU", "2024-06", "IN"))


def test_incompatible_geo_rejection(analyzer):
    rec = analyzer.get_record("KA", "2024-05")
    with pytest.raises(ValueError, match="Incompatible geographic boundaries"):
        analyzer.calculate_energy_gap(rec, external_supplied=(7880.0, "MU", "2024-05", "AP"))


def test_state_comparison(analyzer):
    comp = analyzer.compare_states("KA", "AP", "2024-05")
    assert comp["period"] == "2024-05"
    assert comp["stateA"]["code"] == "KA"
    assert comp["stateB"]["code"] == "AP"
    assert comp["stateA"]["requirementMu"] == 7920.0
    assert comp["stateB"]["requirementMu"] == 6780.0
