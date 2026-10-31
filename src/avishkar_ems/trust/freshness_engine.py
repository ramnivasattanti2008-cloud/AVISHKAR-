"""Source Freshness and Reliability Engine for UrjaSetu EMS.

Distinguishes transport/retrieval success from observation freshness and source cadence.
Evaluates reporting delay, expected cadence, and historical staleness.
Never presents a stale cache as a newly measured value.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from avishkar_ems.trust.canonical_observation import CanonicalObservation
from avishkar_ems.trust.source_registry import ConnectionStatus, ReportingCadence, SourceRecord


class FreshnessStatus(StrEnum):
    FRESH = "FRESH"
    DELAYED = "DELAYED"
    STALE = "STALE"
    HISTORICAL = "HISTORICAL"
    AWAITING_DATA = "AWAITING_DATA"
    UNAVAILABLE = "UNAVAILABLE"
    ACCESS_NOT_CONFIGURED = "ACCESS_NOT_CONFIGURED"


@dataclass(frozen=True)
class FreshnessEvaluation:
    source_id: str
    dataset_id: str
    status: FreshnessStatus
    last_successful_retrieval: datetime | None
    latest_observation_timestamp: datetime | None
    latest_publication_timestamp: datetime | None
    expected_cadence_days: int | None
    actual_delay_days: float | None
    days_since_latest_observation: float | None
    explanation: str
    is_cache_stale: bool
    confidence_score: float  # 0.0 to 1.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def is_usable(self) -> bool:
        """Determines if the data is fresh or acceptable historical evidence."""
        return self.status in {FreshnessStatus.FRESH, FreshnessStatus.HISTORICAL, FreshnessStatus.DELAYED}


# Cadence in nominal days
CADENCE_DAYS_MAP: dict[ReportingCadence, int] = {
    ReportingCadence.REALTIME_15MIN: 0,
    ReportingCadence.HOURLY: 0,
    ReportingCadence.DAILY: 1,
    ReportingCadence.WEEKLY: 7,
    ReportingCadence.MONTHLY: 30,
    ReportingCadence.QUARTERLY: 91,
    ReportingCadence.ANNUAL: 365,
    ReportingCadence.IRREGULAR: 60,
    ReportingCadence.UNKNOWN: 90,
}


class FreshnessEngine:
    """Evaluates data freshness using multi-dimensional temporal checks."""

    @staticmethod
    def evaluate(
        source: SourceRecord,
        latest_obs: CanonicalObservation | None = None,
        now: datetime | None = None,
    ) -> FreshnessEvaluation:
        """Evaluates freshness for a source and its latest available observation."""
        current_time = now or datetime.now(UTC)

        # 1. Connection / access pre-checks
        if source.connection_status in {
            ConnectionStatus.DISCOVERED,
            ConnectionStatus.DOCUMENTATION_VERIFIED,
            ConnectionStatus.AWAITING_APPROVAL,
        }:
            return FreshnessEvaluation(
                source_id=source.source_id,
                dataset_id=source.dataset_id,
                status=FreshnessStatus.ACCESS_NOT_CONFIGURED,
                last_successful_retrieval=source.last_successful_retrieval,
                latest_observation_timestamp=None,
                latest_publication_timestamp=None,
                expected_cadence_days=None,
                actual_delay_days=None,
                days_since_latest_observation=None,
                explanation=f"Source access is not yet configured (status: {source.connection_status.value}).",
                is_cache_stale=True,
                confidence_score=0.0,
            )

        if source.connection_status == ConnectionStatus.TEMPORARILY_UNAVAILABLE:
            return FreshnessEvaluation(
                source_id=source.source_id,
                dataset_id=source.dataset_id,
                status=FreshnessStatus.UNAVAILABLE,
                last_successful_retrieval=source.last_successful_retrieval,
                latest_observation_timestamp=latest_obs.reporting_period_end if latest_obs else None,
                latest_publication_timestamp=None,
                expected_cadence_days=CADENCE_DAYS_MAP.get(source.reporting_frequency),
                actual_delay_days=None,
                days_since_latest_observation=None,
                explanation="Source endpoint is currently offline or unreachable.",
                is_cache_stale=True,
                confidence_score=0.2,
            )

        if latest_obs is None:
            return FreshnessEvaluation(
                source_id=source.source_id,
                dataset_id=source.dataset_id,
                status=FreshnessStatus.AWAITING_DATA,
                last_successful_retrieval=source.last_successful_retrieval,
                latest_observation_timestamp=None,
                latest_publication_timestamp=None,
                expected_cadence_days=CADENCE_DAYS_MAP.get(source.reporting_frequency),
                actual_delay_days=None,
                days_since_latest_observation=None,
                explanation="No observations ingested yet. Awaiting initial publication or ingestion run.",
                is_cache_stale=True,
                confidence_score=0.3,
            )

        # 2. Time differences
        obs_time = (
            latest_obs.observation_timestamp
            or latest_obs.reporting_period_end
            or latest_obs.reporting_period_start
        )
        if obs_time.tzinfo is None:
            obs_time = obs_time.replace(tzinfo=UTC)

        days_since_obs = max(0.0, (current_time - obs_time).total_seconds() / 86400.0)

        cadence_str = (
            source.reporting_frequency.value
            if hasattr(source.reporting_frequency, "value")
            else str(source.reporting_frequency)
        )

        cadence_days = CADENCE_DAYS_MAP.get(source.reporting_frequency)
        if cadence_days is None:
            for k, v in CADENCE_DAYS_MAP.items():
                if k.value.upper() == cadence_str.upper():
                    cadence_days = v
                    break
        if cadence_days is None:
            cadence_days = 30

        expected_delay = float(source.expected_publication_delay_days or 15)

        # Total expected window = cadence + publication delay
        freshness_threshold_days = cadence_days + expected_delay
        stale_threshold_days = freshness_threshold_days * 2.0

        # Check if source is historical archive
        is_historical = (
            "historical" in source.dataset_description.lower()
            or "2024" in source.dataset_name
            or cadence_str.upper() == "ANNUAL"
        )

        if days_since_obs <= freshness_threshold_days:
            status = FreshnessStatus.FRESH
            explanation = (
                f"Data is current within expected {cadence_str} cadence "
                f"and {expected_delay:.0f}d publication delay."
            )
            confidence = 0.95
            is_stale = False
        elif days_since_obs <= stale_threshold_days:
            status = FreshnessStatus.DELAYED
            explanation = (
                f"Observation is {days_since_obs:.1f} days old; exceeds nominal delay of "
                f"{expected_delay:.0f} days for {cadence_str} updates."
            )
            confidence = 0.75
            is_stale = False
        elif is_historical:
            status = FreshnessStatus.HISTORICAL
            explanation = (
                f"Completed historical series. Observation timestamp is {obs_time.strftime('%Y-%m-%d')}."
            )
            confidence = 0.90
            is_stale = False
        else:
            status = FreshnessStatus.STALE
            explanation = (
                f"Observation is {days_since_obs:.1f} days old (> {stale_threshold_days:.0f}d threshold). "
                "Upstream publication appears suspended or delayed."
            )
            confidence = 0.40
            is_stale = True

        return FreshnessEvaluation(
            source_id=source.source_id,
            dataset_id=source.dataset_id,
            status=status,
            last_successful_retrieval=source.last_successful_retrieval,
            latest_observation_timestamp=obs_time,
            latest_publication_timestamp=latest_obs.source_publication_timestamp,
            expected_cadence_days=cadence_days,
            actual_delay_days=round(max(0.0, days_since_obs - cadence_days), 1),
            days_since_latest_observation=round(days_since_obs, 1),
            explanation=explanation,
            is_cache_stale=is_stale,
            confidence_score=confidence,
        )
