"""Metric Semantics and Compatibility Layer for UrjaSetu EMS.

Establishes the exact physical, geographic, temporal, and authority semantics
for every electricity and solar metric.
Strict invariants:
1. Two similarly named metrics are never treated as equivalent without verification.
2. Distinguish instantaneous power (MW), interval energy (kWh), reporting period totals (MU),
   and nameplate capacity (MW).
3. Rejects incompatible calculations with structured, explainable diagnostics.
4. Prevents invalid temporal aggregations (e.g. summing peak power readings).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from avishkar_ems.trust.geo_integrity import GeoLevel
from avishkar_ems.trust.source_registry import ReportingCadence
from avishkar_ems.trust.unit_validation import UnitCategory


class AggregationMethod(StrEnum):
    SUM = "SUM"  # Valid for cumulative energy totals (MU, kWh)
    MAX = "MAX"  # Valid for peak demand (MW)
    MEAN = "MEAN"  # Valid for average load (kW, MW)
    LATEST = "LATEST"  # Valid for installed nameplate capacity (MW snapshot)
    WEIGHTED_AVG = "WEIGHTED_AVG"  # Valid for ratios, shares, and tariff rates


class MetricCompatibilityError(ValueError):
    """Raised when an operation attempts to combine incompatible metrics."""

    def __init__(self, metric_a: str, metric_b: str, reason: str, guidance: str):
        super().__init__(f"INCOMPATIBLE METRICS: '{metric_a}' and '{metric_b}'. {reason} Guidance: {guidance}")
        self.metric_a = metric_a
        self.metric_b = metric_b
        self.reason = reason
        self.guidance = guidance


@dataclass(frozen=True)
class MetricMetadata:
    metric_id: str
    display_name: str
    definition: str
    canonical_unit: str
    dimension_category: UnitCategory
    allowed_geo_levels: list[GeoLevel]
    supported_cadences: list[ReportingCadence]
    aggregation_method: AggregationMethod
    source_authority: str
    compatibility_domain: str  # e.g. "CEA_GRID_BALANCE", "CEA_RENEWABLE_REPORT", "DISCOM_METER"
    is_instantaneous: bool = False
    is_cumulative: bool = False
    is_derived: bool = False
    derivation_formula: str | None = None
    physical_min: float = 0.0
    physical_max: float | None = None
    caveats: list[str] = field(default_factory=list)

    @property
    def metric_name(self) -> str:
        return self.display_name

    @property
    def unit(self) -> str:
        return self.canonical_unit


# Central Registry of Canonical Metrics
CANONICAL_METRICS: dict[str, MetricMetadata] = {
    "ENERGY_REQUIREMENT": MetricMetadata(
        metric_id="ENERGY_REQUIREMENT",
        display_name="Energy Requirement",
        definition=(
            "Total electrical energy required to meet consumer demand plus transmission and distribution "
            "losses across the grid control area during the reporting month."
        ),
        canonical_unit="MU",
        dimension_category=UnitCategory.ENERGY,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.SUM,
        source_authority="Central Electricity Authority (CEA) Power Supply Position",
        compatibility_domain="CEA_GRID_BALANCE",
        is_derived=False,
        physical_min=0.0,
        caveats=[
            "Reflects aggregate monthly requirement; does not provide 15-minute feeder-level load curves.",
            "Not available at revenue district level in official CEA bulletins.",
        ],
    ),
    "ENERGY_SUPPLIED": MetricMetadata(
        metric_id="ENERGY_SUPPLIED",
        display_name="Energy Supplied",
        definition=(
            "Total electrical energy actually dispatched and delivered to distribution entities by generators "
            "and inter-regional transmission lines during the reporting month."
        ),
        canonical_unit="MU",
        dimension_category=UnitCategory.ENERGY,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.SUM,
        source_authority="Central Electricity Authority (CEA) Power Supply Position",
        compatibility_domain="CEA_GRID_BALANCE",
        is_derived=False,
        physical_min=0.0,
        caveats=[
            "Derived from grid dispatch logs; difference from requirement reflects unserved energy.",
        ],
    ),
    "PEAK_DEMAND": MetricMetadata(
        metric_id="PEAK_DEMAND",
        display_name="Peak Electricity Demand",
        definition=(
            "Maximum instantaneous electric power load registered on the regional or state grid during "
            "the reporting period."
        ),
        canonical_unit="MW",
        dimension_category=UnitCategory.POWER,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.DAILY, ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.MAX,
        source_authority="Central Electricity Authority (CEA) & POSOCO/NLDC",
        compatibility_domain="CEA_GRID_BALANCE",
        is_instantaneous=True,
        physical_min=0.0,
        caveats=[
            "Instantaneous power quantity; must NEVER be summed across days or months to obtain energy.",
        ],
    ),
    "PEAK_MET": MetricMetadata(
        metric_id="PEAK_MET",
        display_name="Peak Demand Met",
        definition=(
            "Maximum electric power load successfully served and dispatched by the system during the peak demand hour."
        ),
        canonical_unit="MW",
        dimension_category=UnitCategory.POWER,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.DAILY, ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.MAX,
        source_authority="Central Electricity Authority (CEA) & POSOCO/NLDC",
        compatibility_domain="CEA_GRID_BALANCE",
        is_instantaneous=True,
        physical_min=0.0,
        caveats=[
            "Power quantity; cannot exceed Peak Demand under normal grid conditions.",
        ],
    ),
    "INSTALLED_SOLAR_CAPACITY": MetricMetadata(
        metric_id="INSTALLED_SOLAR_CAPACITY",
        display_name="Installed Solar Capacity",
        definition=(
            "Total rated nameplate capacity (MW) of grid-connected ground-mounted and registered rooftop solar systems."
        ),
        canonical_unit="MW",
        dimension_category=UnitCategory.CAPACITY,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE, GeoLevel.DISTRICT],
        supported_cadences=[ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.LATEST,
        source_authority="MNRE & Central Electricity Authority",
        compatibility_domain="CEA_RENEWABLE_REPORT",
        is_cumulative=True,
        physical_min=0.0,
        caveats=[
            "Capacity is a power rating, NOT energy. Must never be used as denominator for solar share %.",
            "District breakdown from state nodal agencies (KREDL, NREDCAP) covers registered rooftop systems.",
        ],
    ),
    "SOLAR_GENERATION": MetricMetadata(
        metric_id="SOLAR_GENERATION",
        display_name="Solar Energy Generation",
        definition=(
            "Gross electrical energy produced by grid-connected and registered solar photovoltaic systems "
            "during the reporting period."
        ),
        canonical_unit="MU",
        dimension_category=UnitCategory.ENERGY,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.SUM,
        source_authority="Central Electricity Authority (CEA) Monthly Renewable Reports",
        compatibility_domain="CEA_RENEWABLE_REPORT",
        physical_min=0.0,
        caveats=[
            "Energy volume (1 MU = 1 GWh = 1,000,000 kWh).",
            "Does not include un-metered captive off-grid systems.",
        ],
    ),
    "TOTAL_GENERATION": MetricMetadata(
        metric_id="TOTAL_GENERATION",
        display_name="Total Electricity Generation",
        definition=(
            "Total gross electrical energy generated across all fuel sources (Thermal, Hydro, Nuclear, Renewable) "
            "within the geographic area."
        ),
        canonical_unit="MU",
        dimension_category=UnitCategory.ENERGY,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.SUM,
        source_authority="Central Electricity Authority (CEA)",
        compatibility_domain="CEA_RENEWABLE_REPORT",
        physical_min=0.0,
        caveats=[
            "Compatible denominator for Solar Share (%) and Renewable Share (%).",
        ],
    ),
    "TOTAL_RENEWABLE_GENERATION": MetricMetadata(
        metric_id="TOTAL_RENEWABLE_GENERATION",
        display_name="Total Renewable Generation",
        definition=(
            "Total electrical energy produced from Renewable Energy Sources (RES): Solar, Wind, Biomass, Bagasse, "
            "and Small Hydro (<= 25 MW)."
        ),
        canonical_unit="MU",
        dimension_category=UnitCategory.ENERGY,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.SUM,
        source_authority="Central Electricity Authority (CEA) Monthly Renewable Reports",
        compatibility_domain="CEA_RENEWABLE_REPORT",
        physical_min=0.0,
        caveats=[
            "Per CEA classification, includes Small Hydro (<= 25 MW). Large hydro (> 25 MW) is reported separately under conventional hydro.",
        ],
    ),
    "ENERGY_GAP": MetricMetadata(
        metric_id="ENERGY_GAP",
        display_name="Energy Deficit / Gap",
        definition="Difference between reported Energy Requirement and reported Energy Supplied.",
        canonical_unit="MU",
        dimension_category=UnitCategory.ENERGY,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.SUM,
        source_authority="UrjaSetu Analytics Engine",
        compatibility_domain="CEA_GRID_BALANCE",
        is_derived=True,
        derivation_formula="ENERGY_REQUIREMENT - ENERGY_SUPPLIED",
        physical_min=-1000.0,  # Negative gap indicates surplus
        caveats=[
            "Positive gap indicates unserved energy requirement in the reporting month.",
            "Reflects grid accounting conventions; does not equal consumer feeder-level outage duration.",
        ],
    ),
    "GAP_PERCENTAGE": MetricMetadata(
        metric_id="GAP_PERCENTAGE",
        display_name="Energy Gap Percentage",
        definition="Relative energy gap expressed as a percentage of total energy requirement.",
        canonical_unit="%",
        dimension_category=UnitCategory.PERCENTAGE,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.WEIGHTED_AVG,
        source_authority="UrjaSetu Analytics Engine",
        compatibility_domain="CEA_GRID_BALANCE",
        is_derived=True,
        derivation_formula="(ENERGY_REQUIREMENT - ENERGY_SUPPLIED) / ENERGY_REQUIREMENT * 100",
        physical_min=-100.0,
        physical_max=100.0,
        caveats=[
            "Denominator is Energy Requirement. If requirement is zero or missing, result is undefined.",
        ],
    ),
    "SOLAR_SHARE_PERCENT": MetricMetadata(
        metric_id="SOLAR_SHARE_PERCENT",
        display_name="Solar Generation Share",
        definition="Percentage contribution of solar energy generation to total electricity generation.",
        canonical_unit="%",
        dimension_category=UnitCategory.PERCENTAGE,
        allowed_geo_levels=[GeoLevel.NATIONAL, GeoLevel.STATE],
        supported_cadences=[ReportingCadence.MONTHLY, ReportingCadence.ANNUAL],
        aggregation_method=AggregationMethod.WEIGHTED_AVG,
        source_authority="UrjaSetu Analytics Engine",
        compatibility_domain="CEA_RENEWABLE_REPORT",
        is_derived=True,
        derivation_formula="SOLAR_GENERATION / TOTAL_GENERATION * 100",
        physical_min=0.0,
        physical_max=100.0,
        caveats=[
            "Strictly requires both numerator and denominator in UnitCategory.ENERGY.",
            "Installed capacity (MW) cannot be used in place of generation.",
        ],
    ),
    "HOUSEHOLD_CONSUMPTION": MetricMetadata(
        metric_id="HOUSEHOLD_CONSUMPTION",
        display_name="Household Electricity Consumption",
        definition="Electrical energy consumed by a residential consumer account over a discrete time window.",
        canonical_unit="kWh",
        dimension_category=UnitCategory.ENERGY,
        allowed_geo_levels=[GeoLevel.HOUSEHOLD],
        supported_cadences=[ReportingCadence.REALTIME_15MIN, ReportingCadence.HOURLY, ReportingCadence.DAILY, ReportingCadence.MONTHLY],
        aggregation_method=AggregationMethod.SUM,
        source_authority="DISCOM Smart Meter / Billed Statement",
        compatibility_domain="DISCOM_METER",
        physical_min=0.0,
        caveats=[
            "Consumer-level telemetry; cannot be combined with national/state transmission balances.",
        ],
    ),
}


class MetricSemanticsRegistry:
    """Provides semantic validation, compatibility assertions, and safe temporal aggregation."""

    @classmethod
    def get_metric(cls, metric_id: str) -> MetricMetadata:
        """Retrieves metadata for a metric, resolving common aliases."""
        clean = metric_id.strip().upper()
        # Aliases mapping
        aliases = {
            "ENERGY_REQUIREMENT_MU": "ENERGY_REQUIREMENT",
            "ENERGY_SUPPLIED_MU": "ENERGY_SUPPLIED",
            "PEAK_DEMAND_MW": "PEAK_DEMAND",
            "ELECTRICITY_DEMAND": "PEAK_DEMAND",
            "PEAK_MET_MW": "PEAK_MET",
            "DEMAND_MET": "PEAK_MET",
            "SOLAR_CAPACITY_MW": "INSTALLED_SOLAR_CAPACITY",
            "SOLAR_CAPACITY": "INSTALLED_SOLAR_CAPACITY",
            "INSTALLED_CAPACITY": "INSTALLED_SOLAR_CAPACITY",
            "SOLAR_GENERATION_MU": "SOLAR_GENERATION",
            "TOTAL_GENERATION_MU": "TOTAL_GENERATION",
            "ELECTRICITY_GENERATION": "TOTAL_GENERATION",
            "GENERATION": "TOTAL_GENERATION",
            "SOLAR_SHARE": "SOLAR_SHARE_PERCENT",
            "RENEWABLE_GENERATION_MU": "TOTAL_RENEWABLE_GENERATION",
            "ENERGY_GAP_MU": "ENERGY_GAP",
            "HOUSEHOLD_CONSUMPTION_KWH": "HOUSEHOLD_CONSUMPTION",
        }
        canonical_id = aliases.get(clean, clean)
        if canonical_id not in CANONICAL_METRICS:
            raise KeyError(f"Metric '{metric_id}' is not registered in Canonical Metric Semantics Registry.")
        return CANONICAL_METRICS[canonical_id]

    @classmethod
    def list_metrics(cls) -> list[MetricMetadata]:
        """Returns all registered canonical metric definitions."""
        return list(CANONICAL_METRICS.values())

    @classmethod
    def is_registered(cls, metric_id: str) -> bool:
        clean = metric_id.strip().upper()
        try:
            cls.get_metric(clean)
            return True
        except KeyError:
            return False

    @classmethod
    def assert_compatible_for_subtraction(cls, metric_a: str, metric_b: str) -> None:
        """Ensures two metrics can physically and contextually be subtracted (e.g. Req - Sup)."""
        meta_a = cls.get_metric(metric_a)
        meta_b = cls.get_metric(metric_b)

        # 1. Dimensional check
        if meta_a.dimension_category != meta_b.dimension_category:
            raise MetricCompatibilityError(
                metric_a,
                metric_b,
                f"Dimension mismatch: '{meta_a.metric_id}' is {meta_a.dimension_category.value} "
                f"while '{meta_b.metric_id}' is {meta_b.dimension_category.value}.",
                "Only metrics sharing identical physical dimensions can be subtracted.",
            )

        # 2. Compatibility domain check
        if meta_a.compatibility_domain != meta_b.compatibility_domain:
            raise MetricCompatibilityError(
                metric_a,
                metric_b,
                f"Domain mismatch: '{meta_a.metric_id}' is from domain '{meta_a.compatibility_domain}' "
                f"while '{meta_b.metric_id}' is from '{meta_b.compatibility_domain}'.",
                "Cannot subtract metrics originating from unrelated accounting boundaries (e.g. DISCOM meter vs CEA Grid Balance).",
            )

    @classmethod
    def assert_compatible_for_ratio(cls, numerator_metric: str, denominator_metric: str) -> None:
        """Ensures two metrics can form a valid dimensionless share or percentage."""
        meta_num = cls.get_metric(numerator_metric)
        meta_den = cls.get_metric(denominator_metric)

        # 1. Solar share check
        if meta_num.dimension_category != meta_den.dimension_category:
            raise MetricCompatibilityError(
                numerator_metric,
                denominator_metric,
                f"Dimension mismatch: Numerator is {meta_num.dimension_category.value} but denominator is {meta_den.dimension_category.value}.",
                "Ratios and shares require matching dimensions. Installed capacity (MW) cannot be the denominator for generated energy (MU).",
            )

        # 2. Denominator category check
        if meta_den.dimension_category == UnitCategory.CAPACITY:
            raise MetricCompatibilityError(
                numerator_metric,
                denominator_metric,
                "Denominator cannot be an installed capacity metric.",
                "Energy shares must be computed against total generated energy (MU), not nameplate capacity (MW).",
            )

    @classmethod
    def aggregate_values(cls, metric_id: str, values: list[float]) -> float:
        """Aggregates a sequence of values according to the metric's valid aggregation method."""
        if not values:
            raise ValueError(f"Cannot aggregate empty value list for metric '{metric_id}'.")

        meta = cls.get_metric(metric_id)
        if meta.aggregation_method == AggregationMethod.SUM:
            return round(sum(values), 2)
        elif meta.aggregation_method == AggregationMethod.MAX:
            return round(max(values), 2)
        elif meta.aggregation_method == AggregationMethod.MEAN:
            return round(sum(values) / len(values), 2)
        elif meta.aggregation_method == AggregationMethod.LATEST:
            return round(values[-1], 2)
        elif meta.aggregation_method == AggregationMethod.WEIGHTED_AVG:
            return round(sum(values) / len(values), 2)

        return round(sum(values), 2)
