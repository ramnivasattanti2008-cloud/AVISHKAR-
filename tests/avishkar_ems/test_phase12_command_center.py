"""Comprehensive Automated Test Suite for Phase 12: Unified Energy Command Center & Explainable Insights.

Verifies:
1. CommandCenterService initialization and geographic / period discovery.
2. Executive overview KPIs for National (IN) and State (KA, AP) scopes with exact units.
3. Anti-disaggregation enforcement for district and utility scopes (no fake downscaling).
4. Decoupling of solar capacity (MW) from solar generated energy (MU).
5. Renewable generation share calculation with compatible total generation denominator.
6. Chronological time-series trends without synthetic hourly interpolation.
7. Multi-fuel generation mix breakdown and CEA hydro classification standards.
8. Geographic boundary explorer and coverage-aware matrix.
9. Operational data-source health center telemetry and freshness states.
10. Evidence-backed explainable insights with complete mathematical lineage.
11. Metric provenance inspector returning canonical definitions and audit states.
12. Audit report export in JSON and CSV formats with spreadsheet formula injection defense.
"""

from __future__ import annotations

import json

import pytest

from avishkar_ems.command_center_service import (
    CommandCenterService,
    sanitize_csv_value,
)


@pytest.fixture
def cmd_service() -> CommandCenterService:
    return CommandCenterService()


class TestPhase12CommandCenterService:
    """Verifies core application service methods and business logic."""

    def test_geographic_and_period_discovery(self, cmd_service: CommandCenterService):
        scopes = cmd_service.get_available_geographic_scopes()
        assert len(scopes) >= 7
        codes = [s["code"] for s in scopes]
        assert "IN" in codes
        assert "KA" in codes
        assert "AP" in codes
        assert "BESCOM" in codes
        assert "KA_BLR_URBAN" in codes

        # Periods discovery
        nat_periods = cmd_service.get_available_periods("IN")
        assert len(nat_periods) >= 12
        assert "2024-04" in nat_periods
        assert "2025-03" in nat_periods

    def test_national_system_overview_kpis(self, cmd_service: CommandCenterService):
        overview = cmd_service.get_system_overview("IN", "2024-05")

        assert overview.geo_code == "IN"
        assert overview.geo_level == "NATIONAL"
        assert overview.reporting_period == "2024-05"
        assert overview.energy_balance_status in {"BALANCED", "DEFICIT", "SURPLUS"}

        kpis = overview.kpis
        assert "DEMAND" in kpis
        assert "SUPPLY" in kpis
        assert "ENERGY_GAP" in kpis
        assert "SOLAR_CAPACITY" in kpis
        assert "SOLAR_GENERATION" in kpis
        assert "RENEWABLE_GENERATION" in kpis
        assert "SOLAR_CUF" in kpis

        # Physical dimension verification
        assert kpis["DEMAND"].unit == "MU"
        assert kpis["DEMAND"].numeric_value is not None
        assert kpis["DEMAND"].numeric_value > 50_000.0  # National demand > 50,000 MU

        assert kpis["SOLAR_CAPACITY"].unit == "MW"
        assert kpis["SOLAR_CAPACITY"].numeric_value is not None
        assert kpis["SOLAR_CAPACITY"].numeric_value > 50_000.0  # All-India solar capacity > 50 GW

        assert kpis["SOLAR_GENERATION"].unit == "MU"
        assert kpis["SOLAR_GENERATION"].numeric_value is not None

        # Solar capacity (MW) decoupled from generation (MU)
        assert kpis["SOLAR_CAPACITY"].unit != kpis["SOLAR_GENERATION"].unit

        # Freshness and health
        assert overview.freshness_status in {"HEALTHY", "DELAYED_STALE"}
        assert overview.source_health_summary["total"] >= 10
        assert overview.forecast_available is True

    def test_state_system_overview_kpis(self, cmd_service: CommandCenterService):
        # Karnataka (KA)
        ka_overview = cmd_service.get_system_overview("KA", "2024-05")
        assert ka_overview.geo_code == "KA"
        assert ka_overview.geo_level == "STATE"
        assert ka_overview.kpis["DEMAND"].numeric_value is not None
        assert ka_overview.kpis["DEMAND"].numeric_value > 1_000.0

        # Andhra Pradesh (AP)
        ap_overview = cmd_service.get_system_overview("AP", "2024-05")
        assert ap_overview.geo_code == "AP"
        assert ap_overview.geo_level == "STATE"
        assert ap_overview.kpis["DEMAND"].numeric_value is not None
        assert ap_overview.kpis["DEMAND"].numeric_value > 1_000.0

    def test_district_anti_disaggregation_enforcement(self, cmd_service: CommandCenterService):
        """Verifies that selecting a district explicitly communicates uncalculated monthly CEA balance."""
        dist_overview = cmd_service.get_system_overview("KA_BLR_URBAN", "2024-05")

        assert dist_overview.geo_code == "KA_BLR_URBAN"
        assert dist_overview.geo_level == "DISTRICT"
        assert dist_overview.energy_balance_status == "UNAVAILABLE"

        # Monthly CEA metrics must be marked UNAVAILABLE, not synthetically downscaled
        assert dist_overview.kpis["DEMAND"].status == "UNAVAILABLE"
        assert dist_overview.kpis["SUPPLY"].status == "UNAVAILABLE"

        # Annual district metric from open data is available
        assert "DISTRICT_CONSUMPTION" in dist_overview.kpis
        assert dist_overview.kpis["DISTRICT_CONSUMPTION"].status == "AVAILABLE"
        assert dist_overview.kpis["DISTRICT_CONSUMPTION"].numeric_value == 18450.0

        # Active limitations explain anti-disaggregation invariant
        assert len(dist_overview.active_limitations) >= 1
        assert any("Anti-Disaggregation" in lim for lim in dist_overview.active_limitations)

    def test_utility_territory_integrity(self, cmd_service: CommandCenterService):
        """Verifies utility territory boundaries and historical consumption reporting."""
        util_overview = cmd_service.get_system_overview("BESCOM", "2024-05")

        assert util_overview.geo_code == "BESCOM"
        assert util_overview.geo_level == "UTILITY"
        assert util_overview.energy_balance_status == "UNAVAILABLE"

        # Utility annual consumption from historical dataset is available
        assert "HISTORICAL_CONSUMPTION" in util_overview.kpis
        assert util_overview.kpis["HISTORICAL_CONSUMPTION"].status == "AVAILABLE"
        assert util_overview.kpis["HISTORICAL_CONSUMPTION"].numeric_value == 29842.0
        assert util_overview.kpis["TD_LOSS"].numeric_value == 11.8

    def test_chronological_electricity_trends(self, cmd_service: CommandCenterService):
        trends = cmd_service.get_electricity_trends("IN")

        assert trends.geo_code == "IN"
        assert trends.unit == "MU"
        assert len(trends.points) >= 12

        # Verify points have valid requirement and supply
        for pt in trends.points:
            assert pt.requirement_mu is not None
            assert pt.requirement_mu > 0
            assert pt.supplied_mu is not None
            assert pt.supplied_mu > 0
            assert pt.gap_mu == pt.requirement_mu - pt.supplied_mu

        # All-time Peak and Min
        assert trends.peak_value is not None
        assert trends.min_value is not None
        assert trends.peak_value >= trends.min_value
        assert trends.peak_period is not None

        # Seasonal indices (12 calendar months)
        if trends.seasonal_pattern:
            assert len(trends.seasonal_pattern) == 12
            for month_idx in range(1, 13):
                assert month_idx in trends.seasonal_pattern

    def test_district_trends_graceful_missing_indication(self, cmd_service: CommandCenterService):
        trends = cmd_service.get_electricity_trends("KA_BLR_URBAN")
        assert len(trends.points) == 0
        assert len(trends.missing_periods) >= 1
        assert "district/utility" in trends.missing_periods[0]

    def test_generation_and_renewables_breakdown(self, cmd_service: CommandCenterService):
        gen_mix = cmd_service.get_generation_and_renewables("IN", "2024-05")

        assert gen_mix.total_generation_mu > 50_000.0
        assert len(gen_mix.categories) >= 3

        # Renewable share percentage must be valid
        assert 0.0 <= gen_mix.renewable_share_pct <= 100.0

        # Sum of shares should equal ~100%
        total_share = sum(cat["share_pct"] for cat in gen_mix.categories)
        assert pytest.approx(total_share, rel=0.05) == 100.0

        # CUF check
        if gen_mix.cuf_pct is not None:
            assert 0.0 <= gen_mix.cuf_pct <= 100.0

        # CEA Hydro standard note present
        assert "Small Hydro" in gen_mix.hydro_note

    def test_geographic_exploration_view(self, cmd_service: CommandCenterService):
        geo_view = cmd_service.get_geographic_exploration("KA")

        assert geo_view.entity_code == "KA"
        assert geo_view.entity_level == "STATE"
        assert len(geo_view.supported_metrics) >= 3
        assert len(geo_view.boundary_caveats) >= 1

    def test_explainable_insights_lineage_and_quality(self, cmd_service: CommandCenterService):
        insights = cmd_service.get_explainable_insights("KA", "2024-05")

        assert len(insights) >= 2
        for ins in insights:
            assert ins.insight_id
            assert ins.headline
            assert ins.explanation
            assert ins.calculation_method
            assert ins.result
            assert len(ins.source_references) >= 1
            assert ins.confidence in {"HIGH", "MEDIUM", "LOW"}
            assert len(ins.limitations) >= 1

            # Assert non-accusatory language
            assert "fraud" not in ins.explanation.lower()
            assert "corruption" not in ins.explanation.lower()
            assert "theft" not in ins.explanation.lower()

    def test_metric_provenance_inspector(self, cmd_service: CommandCenterService):
        prov = cmd_service.get_metric_provenance("ENERGY_REQUIREMENT", "KA", "2024-05")

        assert prov.metric_id == "ENERGY_REQUIREMENT"
        assert prov.metric_name == "Energy Requirement"
        assert prov.unit == "MU"
        assert prov.dimension == "ENERGY"
        assert "Central Electricity Authority" in prov.source_authority
        assert prov.observed_value is not None
        assert prov.observed_value > 0
        assert prov.validation_status == "VERIFIED_COMPLIANT"

    def test_export_report_json_and_csv(self, cmd_service: CommandCenterService):
        # 1. JSON Export
        json_report = cmd_service.export_report("KA", "2024-05", format_type="json")
        data = json.loads(json_report)

        assert data["report_metadata"]["system"] == "UrjaSetu Energy Command Center"
        assert data["report_metadata"]["geographic_scope"] == "KA"
        assert data["report_metadata"]["reporting_period"] == "2024-05"
        assert "kpis" in data["system_overview"]
        assert "categories" in data["generation_mix"]
        assert len(data["time_series_points"]) >= 12
        assert len(data["insights"]) >= 1

        # 2. CSV Export
        csv_report = cmd_service.export_report("KA", "2024-05", format_type="csv")
        assert "UrjaSetu Energy Command Center Export Report" in csv_report
        assert "Energy Requirement" in csv_report
        assert "Chronological Observations" in csv_report

    def test_csv_formula_injection_defense(self):
        """Verifies that malicious cell prefixes are escaped with a leading single quote."""
        assert sanitize_csv_value("=1+1") == "'=1+1"
        assert sanitize_csv_value("+SUM(A1:A10)") == "'+SUM(A1:A10)"
        assert sanitize_csv_value("-500") == "'-500"
        assert sanitize_csv_value("@cmd") == "'@cmd"
        assert sanitize_csv_value("\tmalicious") == "'\tmalicious"
        assert sanitize_csv_value("\rnewline") == "'\rnewline"

        # Legitimate benign strings are preserved without modification
        assert sanitize_csv_value("Karnataka") == "Karnataka"
        assert sanitize_csv_value(12345.67) == "12345.67"
        assert sanitize_csv_value(None) == ""
