"""Comprehensive Automated Test Suite for Phase 7: Advanced Electricity Balance and Solar Intelligence.

Verifies:
1. Metric semantics and aggregation invariants (MW cannot be summed across time).
2. Energy gap and percentage calculations with safe zero/negative denominator handling.
3. Unit, period, and geographic boundary incompatibility rejections.
4. Solar intelligence: Capacity (MW) vs. Generation (MU) separation, Solar share, and CUF.
5. Time-series trends: MoM, YoY, rolling averages, peak/min, and seasonal patterns.
6. Multi-fuel generation mix and CEA hydro classification conventions.
7. Coverage-aware geographic query filtering and district/utility boundary separation.
8. Deterministic comparative insights and deduplication hash guarantees.
9. EnergyAnalyticsService unified orchestration and lineage propagation.
"""

from __future__ import annotations

import pytest

from avishkar_ems.analytics_service import EnergyAnalyticsService
from avishkar_ems.comparative_insights import ComparativeEnergyInsightEngine
from avishkar_ems.energy_balance import EnergyBalanceAnalyzer, EnergyBalanceRecord
from avishkar_ems.generation_mix import GenerationMixEngine
from avishkar_ems.geo_analytics_service import GeographicAnalyticsService
from avishkar_ems.geo_explorer import GeoExplorer
from avishkar_ems.metric_semantics import (
    AggregationMethod,
    MetricCompatibilityError,
    MetricSemanticsRegistry,
)
from avishkar_ems.solar_intel import SolarIntelligenceEngine
from avishkar_ems.time_series_trends import TimeSeriesPoint, TimeSeriesTrendsEngine


@pytest.fixture
def balance_analyzer() -> EnergyBalanceAnalyzer:
    return EnergyBalanceAnalyzer()


@pytest.fixture
def solar_engine() -> SolarIntelligenceEngine:
    return SolarIntelligenceEngine()


@pytest.fixture
def geo_service() -> GeographicAnalyticsService:
    return GeographicAnalyticsService(GeoExplorer())


@pytest.fixture
def mix_engine(solar_engine: SolarIntelligenceEngine) -> GenerationMixEngine:
    return GenerationMixEngine(solar_engine)


@pytest.fixture
def insights_engine(
    balance_analyzer: EnergyBalanceAnalyzer,
    solar_engine: SolarIntelligenceEngine,
    mix_engine: GenerationMixEngine,
) -> ComparativeEnergyInsightEngine:
    return ComparativeEnergyInsightEngine(balance_analyzer, solar_engine, mix_engine)


@pytest.fixture
def analytics_service(
    balance_analyzer: EnergyBalanceAnalyzer,
    solar_engine: SolarIntelligenceEngine,
    geo_service: GeographicAnalyticsService,
    mix_engine: GenerationMixEngine,
    insights_engine: ComparativeEnergyInsightEngine,
) -> EnergyAnalyticsService:
    return EnergyAnalyticsService(balance_analyzer, solar_engine, geo_service, mix_engine, insights_engine)


# ==============================================================================
# 1. METRIC SEMANTICS & AGGREGATION INVARIANTS
# ==============================================================================


def test_metric_semantics_registry_completeness():
    metrics = MetricSemanticsRegistry.list_metrics()
    assert len(metrics) >= 12
    metric_ids = {m.metric_id for m in metrics}
    assert "ENERGY_REQUIREMENT" in metric_ids
    assert "ENERGY_SUPPLIED" in metric_ids
    assert "PEAK_DEMAND" in metric_ids
    assert "INSTALLED_SOLAR_CAPACITY" in metric_ids
    assert "SOLAR_GENERATION" in metric_ids
    assert "SOLAR_SHARE_PERCENT" in metric_ids
    assert MetricSemanticsRegistry.get_metric("SOLAR_SHARE").metric_id == "SOLAR_SHARE_PERCENT"


def test_instantaneous_power_cannot_be_summed_over_time():
    """Invariant: Summing peak demand power readings across time intervals is physically invalid."""
    power_values = [14200.0, 14500.0, 15100.0]
    # Summing power must be rejected
    with pytest.raises(MetricCompatibilityError, match="Instantaneous power metric with unit 'MW' cannot be summed"):
        TimeSeriesTrendsEngine.aggregate_interval_data(power_values, AggregationMethod.SUM, unit="MW")

    # MAX aggregation is permitted for peak power
    max_power = TimeSeriesTrendsEngine.aggregate_interval_data(power_values, AggregationMethod.MAX, unit="MW")
    assert max_power == 15100.0

    # MEAN aggregation is permitted for average power
    mean_power = TimeSeriesTrendsEngine.aggregate_interval_data(power_values, AggregationMethod.MEAN, unit="MW")
    assert mean_power == pytest.approx(14600.0, abs=0.1)


def test_energy_totals_can_be_summed():
    """Cumulative energy totals (MU) can be legitimately aggregated via SUM."""
    monthly_mu = [7650.0, 7920.0, 6840.0]
    total_mu = TimeSeriesTrendsEngine.aggregate_interval_data(monthly_mu, AggregationMethod.SUM, unit="MU")
    assert total_mu == 22410.0


def test_semantic_compatibility_assertion_rejections():
    """Rejects cross-category subtraction (e.g. subtracting power from energy or capacity from generation)."""
    with pytest.raises(MetricCompatibilityError, match="INCOMPATIBLE METRICS"):
        MetricSemanticsRegistry.assert_compatible_for_subtraction("INSTALLED_SOLAR_CAPACITY", "SOLAR_GENERATION")

    with pytest.raises(MetricCompatibilityError, match="INCOMPATIBLE METRICS"):
        MetricSemanticsRegistry.assert_compatible_for_ratio("PEAK_DEMAND", "ENERGY_REQUIREMENT")


# ==============================================================================
# 2. ELECTRICITY REQUIREMENT AND SUPPLY BALANCE
# ==============================================================================


def test_energy_gap_calculation_positive_deficit(balance_analyzer: EnergyBalanceAnalyzer):
    rec = balance_analyzer.get_record("KA", "2024-05")
    res = balance_analyzer.calculate_energy_gap(rec)
    assert res.energy_requirement_mu == 7920.0
    assert res.energy_supplied_mu == 7880.0
    assert res.gap_mu == 40.0
    assert res.gap_percentage == pytest.approx(0.505, abs=0.01)
    assert res.interpretation_type == "DEFICIT"
    assert not res.is_balanced
    assert "IMPORTANT CAVEAT" in res.caveat
    assert "NOT necessarily a measurement of real-time grid shortages" in res.caveat


def test_energy_gap_safe_zero_denominator():
    dummy = EnergyBalanceRecord(
        geo_code="TEST",
        geo_name="Test Region",
        reporting_period="2025-01",
        energy_requirement_mu=0.0,
        energy_supplied_mu=0.0,
    )
    analyzer = EnergyBalanceAnalyzer()
    res = analyzer.calculate_energy_gap(dummy)
    assert res.gap_mu == 0.0
    assert res.gap_percentage == 0.0
    assert res.is_balanced
    assert res.interpretation_type == "BALANCED"


def test_energy_gap_incompatible_unit_rejection(balance_analyzer: EnergyBalanceAnalyzer):
    rec = balance_analyzer.get_record("IN", "2024-04")
    with pytest.raises(ValueError, match="Incompatible energy units"):
        balance_analyzer.calculate_energy_gap(rec, external_supplied=(143890.0, "GWh", "2024-04", "IN"))


def test_energy_gap_incompatible_period_rejection(balance_analyzer: EnergyBalanceAnalyzer):
    rec = balance_analyzer.get_record("IN", "2024-04")
    with pytest.raises(ValueError, match="Incompatible reporting periods"):
        balance_analyzer.calculate_energy_gap(rec, external_supplied=(143890.0, "MU", "2024-05", "IN"))


def test_energy_gap_incompatible_geo_rejection(balance_analyzer: EnergyBalanceAnalyzer):
    rec = balance_analyzer.get_record("KA", "2024-04")
    with pytest.raises(ValueError, match="Incompatible geographic boundaries"):
        balance_analyzer.calculate_energy_gap(rec, external_supplied=(7620.0, "MU", "2024-04", "AP"))


def test_fiscal_year_balance_aggregation(balance_analyzer: EnergyBalanceAnalyzer):
    fy_res = balance_analyzer.calculate_fiscal_year_balance("KA", "FY2024-25")
    assert fy_res["fiscalYear"] == "FY2024-25"
    assert fy_res["geoCode"] == "KA"
    assert fy_res["monthsIncludedCount"] == 12
    assert fy_res["isCompleteFiscalYear"] is True
    assert fy_res["totalEnergyRequirementMu"] > 80000.0
    assert fy_res["totalEnergySuppliedMu"] > 80000.0
    assert fy_res["cumulativeGapMu"] > 0.0
    assert fy_res["annualPeakDemandMw"] == 17150.0  # Peak reached in 2025-03


# ==============================================================================
# 3. TIME-SERIES TRENDS ENGINE (MOM, YOY, ROLLING AVG, SEASONALITY)
# ==============================================================================


def test_time_series_mom_calculation():
    series = [
        TimeSeriesPoint(period="2024-04", value=100.0, unit="MU"),
        TimeSeriesPoint(period="2024-05", value=110.0, unit="MU"),
    ]
    mom = TimeSeriesTrendsEngine.calculate_mom(series, "2024-05", "Test Metric")
    assert mom is not None
    assert mom.current_period == "2024-05"
    assert mom.reference_period == "2024-04"
    assert mom.delta == 10.0
    assert mom.percentage_change == 10.0
    assert mom.is_comparable is True


def test_time_series_mom_zero_denominator_safe():
    series = [
        TimeSeriesPoint(period="2024-04", value=0.0, unit="MU"),
        TimeSeriesPoint(period="2024-05", value=50.0, unit="MU"),
    ]
    mom = TimeSeriesTrendsEngine.calculate_mom(series, "2024-05", "Test Metric")
    assert mom is not None
    assert mom.percentage_change is None
    assert "baseline reference value is zero" in mom.notes


def test_time_series_yoy_calculation():
    series = [
        TimeSeriesPoint(period="2024-04", value=1000.0, unit="MU"),
        TimeSeriesPoint(period="2025-04", value=1150.0, unit="MU"),
    ]
    yoy = TimeSeriesTrendsEngine.calculate_yoy(series, "2025-04", "Test Metric")
    assert yoy is not None
    assert yoy.current_period == "2025-04"
    assert yoy.reference_period == "2024-04"
    assert yoy.delta == 150.0
    assert yoy.percentage_change == 15.0


def test_time_series_partial_period_comparability_flag():
    series = [
        TimeSeriesPoint(period="2024-04", value=1000.0, unit="MU", is_partial=False),
        TimeSeriesPoint(period="2025-04", value=500.0, unit="MU", is_partial=True),
    ]
    yoy = TimeSeriesTrendsEngine.calculate_yoy(series, "2025-04", "Test Metric")
    assert yoy is not None
    assert yoy.is_comparable is False
    assert "Comparability caveat: Period 2025-04 is partial" in yoy.notes


def test_time_series_rolling_average():
    series = [
        TimeSeriesPoint(period="2024-01", value=10.0, unit="MU"),
        TimeSeriesPoint(period="2024-02", value=20.0, unit="MU"),
        TimeSeriesPoint(period="2024-03", value=30.0, unit="MU"),
        TimeSeriesPoint(period="2024-04", value=40.0, unit="MU"),
    ]
    roll_3 = TimeSeriesTrendsEngine.calculate_rolling_average(series, "2024-04", window_size=3)
    assert roll_3 is not None
    assert roll_3.rolling_average == 30.0  # (20 + 30 + 40) / 3
    assert roll_3.valid_points_count == 3


def test_time_series_peak_and_min():
    series = [
        TimeSeriesPoint(period="2024-01", value=50.0, unit="MU"),
        TimeSeriesPoint(period="2024-02", value=95.0, unit="MU"),
        TimeSeriesPoint(period="2024-03", value=30.0, unit="MU"),
    ]
    pm = TimeSeriesTrendsEngine.find_peak_and_min(series, "Test Metric")
    assert pm is not None
    assert pm.peak_value == 95.0
    assert pm.peak_period == "2024-02"
    assert pm.min_value == 30.0
    assert pm.min_period == "2024-03"


def test_time_series_seasonal_pattern(balance_analyzer: EnergyBalanceAnalyzer):
    periods = balance_analyzer.list_periods("KA")
    series = [
        TimeSeriesPoint(
            period=p,
            value=balance_analyzer.get_record("KA", p).energy_requirement_mu,
            unit="MU",
        )
        for p in periods
    ]
    seas = TimeSeriesTrendsEngine.calculate_seasonal_pattern(series, "Energy Requirement")
    assert seas is not None
    assert len(seas.monthly_indices) == 12
    # Karnataka peak demand is typically in March/May (pre-monsoon summer)
    assert seas.peak_season_month in {3, 4, 5}
    # Trough is typically July/August during monsoon
    assert seas.trough_season_month in {6, 7, 8}


# ==============================================================================
# 4. SOLAR INTELLIGENCE ENGINE & CAPACITY VS GENERATION SEPARATION
# ==============================================================================


def test_solar_share_calculation_valid(solar_engine: SolarIntelligenceEngine):
    res = solar_engine.calculate_solar_share("KA", "2024-04")
    assert res.is_valid is True
    assert res.solar_generation_mu == 1380.0
    assert res.total_generation_mu == 7620.0
    assert res.solar_share_pct == pytest.approx(18.11, abs=0.1)


def test_solar_cuf_calculation(solar_engine: SolarIntelligenceEngine):
    # April has 30 days = 720 hours
    cuf_res = solar_engine.calculate_cuf("KA", "2024-04")
    assert cuf_res.hours_in_month == 720
    assert cuf_res.installed_capacity_mw == 9450.0
    assert cuf_res.solar_generation_mu == 1380.0
    # CUF = (1380 * 1000) / (9450 * 720) * 100 = 1380000 / 6804000 = 20.28%
    assert cuf_res.cuf_percentage == pytest.approx(20.28, abs=0.2)
    assert "Monthly CUF estimate based on reported monthly generation" in cuf_res.caveat


def test_capacity_and_generation_series_separation(solar_engine: SolarIntelligenceEngine):
    cap_s = solar_engine.get_capacity_series("KA")
    gen_s = solar_engine.get_generation_series("KA")
    assert len(cap_s) > 0
    assert len(gen_s) > 0
    assert all(p.unit == "MW" for p in cap_s)
    assert all(p.unit == "MU" for p in gen_s)


def test_refuse_hourly_disaggregation_invariant(solar_engine: SolarIntelligenceEngine):
    with pytest.raises(ValueError, match="DATA HONESTY INVARIANT VIOLATION"):
        solar_engine.refuse_hourly_synthesis("HOURLY", "MONTHLY")


def test_hydro_classification_standard():
    assert SolarIntelligenceEngine.classify_hydro_source(25.0) == "SMALL_HYDRO_RES"
    assert SolarIntelligenceEngine.classify_hydro_source(10.0) == "SMALL_HYDRO_RES"
    assert SolarIntelligenceEngine.classify_hydro_source(25.1) == "LARGE_HYDRO_CONVENTIONAL"
    assert SolarIntelligenceEngine.classify_hydro_source(100.0) == "LARGE_HYDRO_CONVENTIONAL"


# ==============================================================================
# 5. GENERATION MIX AND FUEL BREAKDOWN
# ==============================================================================


def test_generation_mix_report(mix_engine: GenerationMixEngine):
    rep = mix_engine.get_mix_report("KA", "2024-04")
    assert rep.region_code == "KA"
    assert rep.total_generation_mu == 7620.0
    assert rep.renewable_generation_share_pct == pytest.approx(32.15, abs=0.2)  # 2450 / 7620
    cat_ids = {c.category_id for c in rep.categories}
    assert "SOLAR" in cat_ids
    assert "OTHER_RES" in cat_ids
    assert "CONVENTIONAL" in cat_ids


def test_generation_mix_comparison(mix_engine: GenerationMixEngine):
    comp = mix_engine.compare_generation_mix("KA", "AP", "2024-04")
    assert comp["reportingPeriod"] == "2024-04"
    assert comp["regionA"]["code"] == "KA"
    assert comp["regionB"]["code"] == "AP"
    assert comp["regionA"]["renewableSharePct"] > comp["regionB"]["renewableSharePct"]


# ==============================================================================
# 6. GEOGRAPHIC INTELLIGENCE & BOUNDARY INTEGRITY
# ==============================================================================


def test_geographic_coverage_discovery(geo_service: GeographicAnalyticsService):
    resp_nat = geo_service.get_supported_metrics_for_entity("IN")
    assert resp_nat.entity_level == "NATIONAL"
    supported_nat_ids = {m.metric_id for m in resp_nat.supported_metrics}
    assert "ENERGY_REQUIREMENT" in supported_nat_ids
    assert "SOLAR_GENERATION" in supported_nat_ids

    resp_dist = geo_service.get_supported_metrics_for_entity("KA_BLR_URBAN")
    assert resp_dist.entity_level == "DISTRICT"
    # State-level balance metrics are UNAVAILABLE for districts
    unavail_dist_ids = {m.metric_id for m in resp_dist.unavailable_metrics}
    assert "ENERGY_REQUIREMENT" in unavail_dist_ids
    assert "ENERGY_SUPPLIED" in unavail_dist_ids


def test_prohibit_synthetic_downscaling_assert(geo_service: GeographicAnalyticsService):
    """Attempting to query state-level energy requirement for a district must raise MetricCompatibilityError."""
    with pytest.raises(MetricCompatibilityError, match="is not attributable to Bengaluru Urban District"):
        geo_service.assert_metric_supported("ENERGY_REQUIREMENT", "KA_BLR_URBAN")


def test_bengaluru_vs_bescom_boundary_distinction(geo_service: GeographicAnalyticsService):
    info_blr = geo_service.explain_boundary_distinction("KA_BLR_URBAN")
    assert info_blr["type"] == "DISTRICT"
    assert info_blr["isUtilityCoterminous"] is False
    assert "served by BESCOM" in info_blr["relationshipSummary"]

    info_bescom = geo_service.explain_boundary_distinction("BESCOM")
    assert info_bescom["type"] == "UTILITY"
    assert info_bescom["isDistrictCoterminous"] is False
    assert len(info_bescom["servedDistricts"]) == 8


# ==============================================================================
# 7. COMPARATIVE ENERGY INSIGHTS & DEDUPLICATION
# ==============================================================================


def test_comparative_insights_generation(insights_engine: ComparativeEnergyInsightEngine):
    insights = insights_engine.generate_all_insights("KA", "2025-04")
    assert len(insights) >= 2
    types = {i.insight_type for i in insights}
    assert "DEMAND_YOY_GROWTH" in types or "SOLAR_YOY_GROWTH" in types
    for ins in insights:
        assert ins.title != ""
        assert ins.plain_language_explanation != ""
        assert ins.calculation_method != ""
        assert len(ins.source_observation_references) > 0
        assert len(ins.limitations) > 0


def test_comparative_insights_deduplication(insights_engine: ComparativeEnergyInsightEngine):
    # Calling twice for the same entity and period must NOT emit duplicates
    ins1 = insights_engine.generate_demand_growth_insights("KA", "2025-04")
    ins2 = insights_engine.generate_demand_growth_insights("KA", "2025-04")
    assert len(ins1) > 0
    assert len(ins2) == 0  # Deduplication hash prevented duplicate emit


# ==============================================================================
# 8. MASTER ANALYTICS SERVICE INTEGRATION
# ==============================================================================


def test_analytics_service_end_to_end(analytics_service: EnergyAnalyticsService):
    # Metric definitions
    defs = analytics_service.get_metric_definitions()
    assert len(defs) >= 12

    # Balance calculation
    bal = analytics_service.get_energy_balance("KA", "2024-05")
    assert bal.gap_mu == 40.0

    # Demand growth
    growth = analytics_service.get_demand_growth_analysis("KA", "2025-05")
    assert growth["mom"] is not None
    assert growth["yoy"] is not None

    # Solar share & CUF
    share = analytics_service.get_solar_share("KA", "2024-05")
    assert share.is_valid is True
    cuf = analytics_service.get_solar_cuf("KA", "2024-05")
    assert cuf.cuf_percentage is not None

    # Generation mix
    mix = analytics_service.get_generation_mix("KA", "2024-05")
    assert mix.total_generation_mu > 0

    # Insights
    ins = analytics_service.get_entity_insights("KA", "2025-05")
    assert len(ins) > 0


def test_negative_denominator_handling_for_growth():
    series = [
        TimeSeriesPoint(period="2024-04", value=-10.0, unit="MU"),
        TimeSeriesPoint(period="2024-05", value=20.0, unit="MU"),
    ]
    mom = TimeSeriesTrendsEngine.calculate_mom(series, "2024-05", "Test Negative Denominator")
    assert mom is not None
    assert mom.percentage_change is None
    assert "omitted for negative baseline" in mom.notes


def test_missing_dates_preserved_in_rolling_average():
    # Gap between 2024-01 and 2024-04 (missing 02 and 03)
    series = [
        TimeSeriesPoint(period="2024-01", value=100.0, unit="MU"),
        TimeSeriesPoint(period="2024-04", value=120.0, unit="MU"),
    ]
    roll = TimeSeriesTrendsEngine.calculate_rolling_average(series, "2024-04", window_size=3)
    assert roll is not None
    # Must preserve observed points, not fabricate synthetic zeroes
    assert roll.valid_points_count == 2
    assert roll.rolling_average == 110.0


def test_solar_share_zero_total_generation_safe(solar_engine: SolarIntelligenceEngine):
    dummy_item = {
        "reportingPeriod": "2024-09",
        "regionCode": "DL",
        "installedSolarCapacityMw": 100.0,
        "solarGenerationMu": 10.0,
        "totalGenerationMu": 0.0,  # Zero generation scenario
        "totalRenewableGenerationMu": 10.0,
        "renewableAdditionsMw": 0.0,
    }
    solar_engine.ingest_record(dummy_item, "Test Source")
    res = solar_engine.calculate_solar_share("DL", "2024-09")
    assert res.is_valid is False
    assert res.solar_share_pct is None
    assert "total generation is zero or missing" in res.notes


def test_fiscal_year_balance_missing_period_rejection(balance_analyzer: EnergyBalanceAnalyzer):
    # Year 2010 has no observations
    with pytest.raises(KeyError, match="No observations found"):
        balance_analyzer.calculate_fiscal_year_balance("KA", "FY2010-11")


def test_geo_analytics_visakhapatnam_boundary(geo_service: GeographicAnalyticsService):
    info = geo_service.explain_boundary_distinction("AP_VSKP")
    assert info["type"] == "DISTRICT"
    assert info["isUtilityCoterminous"] is False
    assert "APEPDCL" in info["servedByUtilities"]

