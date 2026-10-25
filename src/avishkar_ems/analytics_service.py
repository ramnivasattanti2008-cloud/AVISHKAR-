"""Unified Energy Analytics Application Service for UrjaSetu EMS.

Orchestrates Metric Semantics, Electricity Balance, Solar Intelligence,
Time-Series Trends, Generation Mix, and Geographic Coverage into a cohesive,
validated service API.

Strict invariants:
1. Validates geographic entities, date ranges, and metric identifiers.
2. Returns explicit unavailable-data structures instead of empty or zero values.
3. Separates installed capacity (MW) from actual generation (MU).
4. Strictly enforces geographic coverage boundaries (no synthetic downscaling).
5. Provides full lineage, formulas, and source references for all derived metrics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from avishkar_ems.comparative_insights import ComparativeEnergyInsightEngine, EnergyInsight
from avishkar_ems.energy_balance import EnergyBalanceAnalyzer, EnergyGapResult
from avishkar_ems.generation_mix import GenerationMixEngine, GenerationMixReport
from avishkar_ems.geo_analytics_service import (
    CoverageAwareMetricResponse,
    GeographicAnalyticsService,
)
from avishkar_ems.metric_semantics import MetricMetadata, MetricSemanticsRegistry
from avishkar_ems.solar_intel import SolarCUFResult, SolarIntelligenceEngine, SolarShareResult
from avishkar_ems.time_series_trends import (
    PeakMinResult,
    PeriodComparisonResult,
    RollingAverageResult,
    SeasonalPatternResult,
    TimeSeriesPoint,
    TimeSeriesTrendsEngine,
)


@dataclass(frozen=True)
class AnalyticsResponse:
    success: bool
    status_code: int
    data: dict[str, Any]
    error_message: str | None = None
    caveats: list[str] = field(default_factory=list)


class EnergyAnalyticsService:
    """Master application service for UrjaSetu electricity balance and renewable intelligence."""

    def __init__(
        self,
        balance_analyzer: EnergyBalanceAnalyzer | None = None,
        solar_engine: SolarIntelligenceEngine | None = None,
        geo_service: GeographicAnalyticsService | None = None,
        mix_engine: GenerationMixEngine | None = None,
        insights_engine: ComparativeEnergyInsightEngine | None = None,
    ) -> None:
        self.balance = balance_analyzer or EnergyBalanceAnalyzer()
        self.solar = solar_engine or SolarIntelligenceEngine()
        self.geo = geo_service or GeographicAnalyticsService()
        self.mix = mix_engine or GenerationMixEngine(self.solar)
        self.insights = insights_engine or ComparativeEnergyInsightEngine(self.balance, self.solar, self.mix)

    def get_metric_definitions(self) -> list[MetricMetadata]:
        """Returns the complete canonical metric registry with exact semantics."""
        return MetricSemanticsRegistry.list_metrics()

    def get_entity_coverage(self, entity_code: str) -> CoverageAwareMetricResponse:
        """Discovers which metrics are genuinely supported for an entity."""
        return self.geo.get_supported_metrics_for_entity(entity_code)

    def get_energy_balance(self, geo_code: str, period: str) -> EnergyGapResult:
        """Retrieves and calculates energy balance with lineage for the specified entity and period."""
        self.geo.assert_metric_supported("ENERGY_REQUIREMENT", geo_code)
        rec = self.balance.get_record(geo_code, period)
        return self.balance.calculate_energy_gap(rec)

    def get_historical_balance_series(self, geo_code: str) -> list[EnergyGapResult]:
        """Returns all chronological energy balance calculations for the entity."""
        self.geo.assert_metric_supported("ENERGY_REQUIREMENT", geo_code)
        return self.balance.calculate_historical_gap_series(geo_code)

    def get_demand_time_series(self, geo_code: str) -> list[TimeSeriesPoint]:
        """Returns time series of energy requirement in MU."""
        self.geo.assert_metric_supported("ENERGY_REQUIREMENT", geo_code)
        periods = self.balance.list_periods(geo_code)
        series: list[TimeSeriesPoint] = []
        for p in periods:
            rec = self.balance.get_record(geo_code, p)
            series.append(
                TimeSeriesPoint(
                    period=p,
                    value=rec.energy_requirement_mu,
                    unit=rec.energy_unit,
                    source_ref=rec.source,
                )
            )
        return series

    def get_demand_growth_analysis(
        self, geo_code: str, period: str
    ) -> dict[str, PeriodComparisonResult | None]:
        """Calculates both MoM and YoY demand changes for the specified period."""
        series = self.get_demand_time_series(geo_code)
        mom = TimeSeriesTrendsEngine.calculate_mom(series, period, metric_name="Energy Requirement")
        yoy = TimeSeriesTrendsEngine.calculate_yoy(series, period, metric_name="Energy Requirement")
        return {"mom": mom, "yoy": yoy}

    def get_demand_rolling_average(
        self, geo_code: str, period: str, window_size: int = 3
    ) -> RollingAverageResult | None:
        """Calculates trailing rolling average for electricity requirement."""
        series = self.get_demand_time_series(geo_code)
        return TimeSeriesTrendsEngine.calculate_rolling_average(
            series, period, window_size=window_size, metric_name="Energy Requirement"
        )

    def get_peak_and_min_demand(self, geo_code: str) -> PeakMinResult | None:
        """Finds all-time historical peak and minimum requirements."""
        series = self.get_demand_time_series(geo_code)
        return TimeSeriesTrendsEngine.find_peak_and_min(series, metric_name="Energy Requirement")

    def get_demand_seasonality(self, geo_code: str) -> SeasonalPatternResult | None:
        """Calculates 12-month seasonal indices when sufficient history exists."""
        series = self.get_demand_time_series(geo_code)
        return TimeSeriesTrendsEngine.calculate_seasonal_pattern(series, metric_name="Energy Requirement")

    def get_solar_capacity_series(self, region_code: str) -> list[TimeSeriesPoint]:
        """Returns verified installed solar capacity series in MW (strictly separated from MU)."""
        self.geo.assert_metric_supported("INSTALLED_SOLAR_CAPACITY", region_code)
        return self.solar.get_capacity_series(region_code)

    def get_solar_generation_series(self, region_code: str) -> list[TimeSeriesPoint]:
        """Returns verified solar generation series in MU."""
        self.geo.assert_metric_supported("SOLAR_GENERATION", region_code)
        return self.solar.get_generation_series(region_code)

    def get_solar_share(self, region_code: str, period: str) -> SolarShareResult:
        """Calculates solar share of total generation."""
        self.geo.assert_metric_supported("SOLAR_GENERATION", region_code)
        return self.solar.calculate_solar_share(region_code, period)

    def get_solar_cuf(self, region_code: str, period: str) -> SolarCUFResult:
        """Calculates monthly Capacity Utilization Factor estimate."""
        self.geo.assert_metric_supported("SOLAR_GENERATION", region_code)
        return self.solar.calculate_cuf(region_code, period)

    def get_generation_mix(self, region_code: str, period: str) -> GenerationMixReport:
        """Returns multi-fuel generation and capacity breakdown."""
        self.geo.assert_metric_supported("SOLAR_GENERATION", region_code)
        return self.mix.get_mix_report(region_code, period)

    def compare_regions_generation_mix(
        self, region_a: str, region_b: str, period: str
    ) -> dict[str, Any]:
        """Compares generation mix between two regions over the same period."""
        self.geo.assert_metric_supported("SOLAR_GENERATION", region_a)
        self.geo.assert_metric_supported("SOLAR_GENERATION", region_b)
        return self.mix.compare_generation_mix(region_a, region_b, period)

    def compare_states_balance(
        self, state_a: str, state_b: str, period: str
    ) -> dict[str, Any]:
        """Compares energy supply-demand balance between two states."""
        self.geo.assert_metric_supported("ENERGY_REQUIREMENT", state_a)
        self.geo.assert_metric_supported("ENERGY_REQUIREMENT", state_b)
        return self.balance.compare_states(state_a, state_b, period)

    def get_entity_insights(self, geo_code: str, period: str) -> list[EnergyInsight]:
        """Retrieves all deterministic, deduplicated insights for the entity in the given period."""
        return self.insights.generate_all_insights(geo_code, period)
