"""Data Provenance Separation and Calculation/Forecast Lineage for UrjaSetu EMS.

Enforces strict separation between official observations, historical data,
household meter telemetry, calculated statistics, forecasts, and scenario simulations.
Prevents silent promotion of calculations or predictions into official measurements.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    DataClassification,
    MeasurementKind,
    QualityStatus,
)


@dataclass(frozen=True)
class CalculatedStatisticLineage:
    """Full auditable lineage for any derived or calculated metric."""

    statistic_id: str
    metric_id: str
    name: str
    value: float
    unit: str
    formula: str
    input_observation_ids: list[str]
    geographic_entity_id: str
    geographic_level: str
    reporting_period_start: datetime
    reporting_period_end: datetime
    calculated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    assumptions: list[str] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_canonical_observation(self, ingestion_run_id: str = "CALC_LINEAGE") -> CanonicalObservation:
        """Converts this calculated statistic to a CanonicalObservation with strict CALCULATED_STATISTIC tier."""
        return CanonicalObservation(
            observation_id=self.statistic_id,
            source_id="URJASETU_ANALYTICS_ENGINE",
            dataset_id="CALCULATED_STATISTICS",
            metric_id=self.metric_id,
            original_metric_name=self.name,
            original_value=self.value,
            original_unit=self.unit,
            normalized_value=self.value,
            normalized_unit=self.unit,
            geographic_entity_id=self.geographic_entity_id,
            geographic_level=self.geographic_level,
            reporting_period_start=self.reporting_period_start,
            reporting_period_end=self.reporting_period_end,
            data_classification=DataClassification.CALCULATED_STATISTIC,
            quality_status=QualityStatus.VALID,
            original_source_record_id=f"CALC:{self.statistic_id}",
            provenance_reference=f"Formula: {self.formula} | Inputs: {','.join(self.input_observation_ids[:5])}",
            ingestion_run_id=ingestion_run_id,
            measurement_kind=MeasurementKind.RATIO_PERCENT if "%" in self.unit else MeasurementKind.PERIOD_TOTAL_MU,
            observation_timestamp=self.calculated_at,
            metadata={
                "formula": self.formula,
                "input_observation_ids": self.input_observation_ids,
                "assumptions": self.assumptions,
                "caveats": self.caveats,
                **self.metadata,
            },
        )


@dataclass(frozen=True)
class ForecastLineage:
    """Full auditable metadata for any predictive energy projection."""

    forecast_id: str
    metric_id: str
    target_metric_name: str
    predicted_value: float
    unit: str
    model_id: str
    model_version: str
    input_period_start: datetime
    input_period_end: datetime
    forecast_generation_time: datetime
    forecast_horizon_months: int
    target_period_start: datetime
    target_period_end: datetime
    geographic_entity_id: str
    geographic_level: str
    lower_bound: float | None = None
    upper_bound: float | None = None
    confidence_level: float = 0.95
    evaluation_metadata: dict[str, Any] = field(default_factory=dict)
    notes: str = ""

    def to_canonical_observation(self, ingestion_run_id: str = "FC_LINEAGE") -> CanonicalObservation:
        """Converts this forecast to a CanonicalObservation with strict FORECAST tier."""
        return CanonicalObservation(
            observation_id=self.forecast_id,
            source_id="URJASETU_FORECAST_ENGINE",
            dataset_id=f"MODEL_{self.model_id}_{self.model_version}",
            metric_id=self.metric_id,
            original_metric_name=f"{self.target_metric_name} (Forecast)",
            original_value=self.predicted_value,
            original_unit=self.unit,
            normalized_value=self.predicted_value,
            normalized_unit=self.unit,
            geographic_entity_id=self.geographic_entity_id,
            geographic_level=self.geographic_level,
            reporting_period_start=self.target_period_start,
            reporting_period_end=self.target_period_end,
            data_classification=DataClassification.FORECAST,
            quality_status=QualityStatus.VALID,
            original_source_record_id=f"FC:{self.forecast_id}",
            provenance_reference=f"Model: {self.model_id} v{self.model_version} | Horizon: {self.forecast_horizon_months}m",
            ingestion_run_id=ingestion_run_id,
            measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
            observation_timestamp=self.forecast_generation_time,
            metadata={
                "model_id": self.model_id,
                "model_version": self.model_version,
                "forecast_horizon_months": self.forecast_horizon_months,
                "lower_bound": self.lower_bound,
                "upper_bound": self.upper_bound,
                "confidence_level": self.confidence_level,
                "evaluation_metadata": self.evaluation_metadata,
            },
        )


class ProvenanceAuditor:
    """Verifies that data provenance is respected across ingestion, calculation, and UI presentation."""

    @staticmethod
    def audit_classification(obs: CanonicalObservation) -> None:
        """Asserts that the observation cannot masquerade as an official observation if it is derived."""
        # Check source and dataset claims
        if obs.data_classification == DataClassification.OFFICIAL_OBSERVATION:
            if "CALCULATED" in obs.dataset_id.upper() or "MODEL" in obs.dataset_id.upper():
                raise ValueError(
                    f"Observation {obs.observation_id} claims OFFICIAL_OBSERVATION but dataset_id is {obs.dataset_id}!"
                )
            if obs.source_id in {"URJASETU_ANALYTICS_ENGINE", "URJASETU_FORECAST_ENGINE"}:
                raise ValueError(
                    f"Observation {obs.observation_id} cannot be OFFICIAL_OBSERVATION from internal engine {obs.source_id}!"
                )

    @staticmethod
    def classify_breakdown(observations: list[CanonicalObservation]) -> dict[DataClassification, int]:
        """Returns the distribution of data provenance classifications across an observation set."""
        breakdown = dict.fromkeys(DataClassification, 0)
        for obs in observations:
            breakdown[obs.data_classification] += 1
        return breakdown
