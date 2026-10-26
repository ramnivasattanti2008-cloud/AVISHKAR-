"""Tests for battery degradation, ASTM E1049 rainflow counting, and thermal derating physics."""

from __future__ import annotations

import pytest
from avishkar_engine.degradation import (
    DegradationRequest,
    analyze_degradation,
    compute_thermal_derating,
    rainflow_count,
)


class TestRainflowCounting:
    def test_single_full_cycle(self):
        # 0 -> 1 -> 0
        soc = [0.0, 1.0, 0.0]
        cycles = rainflow_count(soc)
        assert len(cycles) >= 1
        total_range = sum(r * c for r, c in cycles)
        assert total_range == pytest.approx(1.0, abs=1e-3)

    def test_sub_cycle_ranges(self):
        # 0 -> 0.8 -> 0.2 -> 0.6 -> 0.0
        soc = [0.0, 0.8, 0.2, 0.6, 0.0]
        cycles = rainflow_count(soc)
        assert len(cycles) >= 2
        for r, count in cycles:
            assert 0.0 < r <= 1.0
            assert count in (0.5, 1.0)


class TestThermalDerating:
    def test_freezing_temperatures(self):
        assert compute_thermal_derating(-5.0) == 0.2
        assert compute_thermal_derating(0.0) == 0.2

    def test_optimal_range(self):
        assert compute_thermal_derating(20.0) == 1.0
        assert compute_thermal_derating(25.0) == 1.0
        assert compute_thermal_derating(35.0) == 1.0

    def test_elevated_temperature_derating(self):
        d40 = compute_thermal_derating(40.0)
        assert 0.4 <= d40 < 1.0
        assert compute_thermal_derating(50.0) == 0.2


class TestDegradationAnalysis:
    def test_ideal_operating_profile(self):
        # 10 kWh battery cycling from 2 kWh to 10 kWh (80% DoD)
        req = DegradationRequest(
            socKwh=[2.0, 10.0, 2.0, 10.0, 2.0],
            capacityKwh=10.0,
            nominalCycleLife=4000.0,
            replacementCostInr=30000.0,
            cellTemperatureCelsius=25.0,
            maxChargeKw=5.0,
            maxDischargeKw=5.0,
            operationalDays=1.0,
        )
        res = analyze_degradation(req)
        assert res.equivalent_full_cycles > 0.0
        assert res.state_of_health_percent > 99.0
        assert res.thermal_derate_factor == 1.0
        assert res.derated_max_charge_kw == 5.0
        assert res.summary_verdict in ("EXCELLENT_HEALTH", "NORMAL_OPERATING_HEALTH")
        assert res.wear_cost_inr > 0.0

    def test_high_temperature_thermal_protection(self):
        req = DegradationRequest(
            socKwh=[2.0, 8.0, 2.0],
            capacityKwh=10.0,
            cellTemperatureCelsius=42.0,
            maxChargeKw=5.0,
            maxDischargeKw=5.0,
        )
        res = analyze_degradation(req)
        assert res.thermal_derate_factor < 1.0
        assert res.derated_max_charge_kw < 5.0
