"""Unit tests for Rainflow cycle counting and battery non-linear degradation physics."""

import pytest

from avishkar_ems.battery_physics import (
    nonlinear_wear_cost_per_kwh,
    rainflow_count_cycles,
    temperature_c_rate_derating,
)


def test_rainflow_cycle_counting_simple_sinusoid():
    # 0.2 -> 0.8 -> 0.2 -> 0.8 -> 0.2 (2 full cycles of range 0.6)
    soc = [0.2, 0.4, 0.6, 0.8, 0.6, 0.4, 0.2, 0.4, 0.6, 0.8, 0.6, 0.4, 0.2]
    cycles = rainflow_count_cycles(soc)
    assert len(cycles) >= 1
    # Check total damage / count
    total_count = sum(c[1] for c in cycles)
    assert total_count >= 1.5
    # Max range should be approximately 0.6
    max_range = max(c[0] for c in cycles)
    assert pytest.approx(max_range, abs=0.01) == 0.6


def test_rainflow_empty_or_short_series():
    assert rainflow_count_cycles([]) == []
    assert rainflow_count_cycles([0.5, 0.6]) == []


def test_nonlinear_wear_cost_increases_with_dod():
    cost_shallow = nonlinear_wear_cost_per_kwh(dod=0.2)
    cost_nominal = nonlinear_wear_cost_per_kwh(dod=0.8)
    cost_deep = nonlinear_wear_cost_per_kwh(dod=0.95)

    assert cost_shallow < cost_nominal
    assert cost_nominal < cost_deep
    # Check nominal sanity (~3.9 to 4.5 INR/kWh for typical LFP cell replacement)
    assert 2.0 < cost_nominal < 6.0


def test_temperature_c_rate_derating():
    # Nominal temperature
    assert temperature_c_rate_derating(25.0, nominal_c_rate=0.5) == 0.5
    # Cold temperature derates
    assert temperature_c_rate_derating(0.0, nominal_c_rate=0.5) < 0.5
    # Hot temperature (>35°C) derates
    assert temperature_c_rate_derating(40.0, nominal_c_rate=0.5) < 0.5
    # Extreme heat (>45°C) severe derate
    assert temperature_c_rate_derating(50.0, nominal_c_rate=0.5) == 0.1
