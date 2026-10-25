"""Canonical Energy Observation Model for UrjaSetu EMS.

Normalized data structure capable of representing electricity demand, energy requirement,
energy supplied, consumption, generation, installed capacity, and household meter intervals.
Strict invariants:
1. Distinguish instantaneous/interval measurements from cumulative readings and reporting-period totals.
2. Preserve original source values and units so every conversion can be audited.
3. Every value is strictly classified into one of the 7 data provenance tiers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class MeasurementKind(StrEnum):
    INSTANTANEOUS_KW = "INSTANTANEOUS_KW"  # Power demand, peak load (kW / MW)
    PEAK_MW = "PEAK_MW"  # Peak demand or peak met in MW
    INTERVAL_KWH = "INTERVAL_KWH"  # Energy consumed or exported in discrete interval (15m, 1h)
    CUMULATIVE_KWH = "CUMULATIVE_KWH"  # Monotonically increasing register reading
    PERIOD_TOTAL_MU = "PERIOD_TOTAL_MU"  # Monthly or annual aggregated volume (MU / GWh)
    TOTAL_MU = "TOTAL_MU"  # Total energy in MU
    NAMEPLATE_CAPACITY_MW = "NAMEPLATE_CAPACITY_MW"  # Installed rating (kWp / MW)
    CAPACITY_MW = "CAPACITY_MW"  # Capacity in MW
    RATIO_PERCENT = "RATIO_PERCENT"  # Dimensionless share or fraction (%)
    RATIO = "RATIO"  # Ratio or percentage
    COUNT = "COUNT"  # Consumer count or discrete quantity
    IRRADIANCE_WM2 = "IRRADIANCE_WM2"  # Solar irradiance in W/m²
    TEMPERATURE_C = "TEMPERATURE_C"  # Ambient surface temperature in °C
    DAILY_INSOLATION = "DAILY_INSOLATION"  # Daily solar insolation (kWh/m²/day)


class DataClassification(StrEnum):
    OFFICIAL_OBSERVATION = "OFFICIAL_OBSERVATION"
    IMPORTED_HISTORICAL = "IMPORTED_HISTORICAL"
    HOUSEHOLD_METER = "HOUSEHOLD_METER"
    CALCULATED_STATISTIC = "CALCULATED_STATISTIC"
    FORECAST = "FORECAST"
    SCENARIO_SIMULATION = "SCENARIO_SIMULATION"
    UNVERIFIED_OR_UNAVAILABLE = "UNVERIFIED_OR_UNAVAILABLE"


class QualityStatus(StrEnum):
    VALID = "VALID"
    VALID_WITH_WARNINGS = "VALID_WITH_WARNINGS"
    INCOMPLETE = "INCOMPLETE"
    REJECTED = "REJECTED"
    REQUIRES_REVIEW = "REQUIRES_REVIEW"


@dataclass(frozen=True)
class CanonicalObservation:
    observation_id: str
    source_id: str
    dataset_id: str
    metric_id: str
    original_metric_name: str
    original_value: float
    original_unit: str
    normalized_value: float
    normalized_unit: str
    geographic_entity_id: str
    geographic_level: str  # NATIONAL, STATE, DISTRICT, UTILITY, HOUSEHOLD
    reporting_period_start: datetime
    reporting_period_end: datetime
    data_classification: DataClassification
    quality_status: QualityStatus
    original_source_record_id: str
    provenance_reference: str
    ingestion_run_id: str
    measurement_kind: MeasurementKind
    observation_timestamp: datetime | None = None
    source_publication_timestamp: datetime | None = None
    retrieval_timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    warnings: list[str] = field(default_factory=list)
    rejection_reason: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def is_usable(self) -> bool:
        """Determines whether this observation is valid for analytical consumption."""
        return self.quality_status in {QualityStatus.VALID, QualityStatus.VALID_WITH_WARNINGS}
