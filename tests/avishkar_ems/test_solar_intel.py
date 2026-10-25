"""Tests for Solar Intelligence Engine, share calculation, and ingestion safeguards."""

from __future__ import annotations

import pytest

from avishkar_ems.solar_intel import SolarIntelligenceEngine


@pytest.fixture
def solar_engine():
    return SolarIntelligenceEngine()


def test_capacity_vs_generation_distinction(solar_engine):
    rec = solar_engine.get_record("KA", "2024-04")
    # Capacity is in MW, Generation is in MU (Million Units / GWh)
    assert rec.installed_solar_capacity_mw == 9450.0
    assert rec.solar_generation_mu == 1380.0
    # Solar share = (1380 / 7620) * 100 = 18.11%
    assert rec.solar_share_pct == pytest.approx(18.11, abs=0.1)


def test_duplicate_record_prevention(solar_engine):
    dup_item = {
        "reportingPeriod": "2024-04",
        "regionCode": "KA",
        "installedSolarCapacityMw": 9450.0,
        "solarGenerationMu": 1380.0,
        "totalGenerationMu": 7620.0,
        "totalRenewableGenerationMu": 2450.0,
        "renewableAdditionsMw": 110.0,
    }
    # Ingesting the same record twice must be detected as duplicate
    success, msg = solar_engine.ingest_record(dup_item, "CEA Report")
    assert not success
    assert "Duplicate record detected" in msg


def test_mom_and_yoy_calculations(solar_engine):
    # May 2024 vs April 2024
    mom = solar_engine.calculate_mom("KA", "2024-05", "solar_generation_mu")
    assert mom is not None
    assert mom.current_period == "2024-05"
    assert mom.reference_period == "2024-04"
    assert mom.delta_value == 40.0  # 1420 - 1380

    # April 2025 vs April 2024
    yoy = solar_engine.calculate_yoy("KA", "2025-04", "solar_generation_mu")
    assert yoy is not None
    assert yoy.current_period == "2025-04"
    assert yoy.reference_period == "2024-04"
    assert yoy.delta_value == 200.0  # 1580 - 1380
    assert yoy.percentage_change == pytest.approx(14.49, abs=0.1)


def test_refuse_hourly_synthesis_from_monthly(solar_engine):
    # Invariant: Never create hourly curves from monthly observations
    with pytest.raises(ValueError, match="DATA HONESTY INVARIANT VIOLATION"):
        solar_engine.refuse_hourly_synthesis(requested_frequency="HOURLY", observation_frequency="MONTHLY")
