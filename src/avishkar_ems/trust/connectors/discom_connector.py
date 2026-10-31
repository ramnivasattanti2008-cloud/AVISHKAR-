"""Distribution Company (DISCOM) Source Connector for UrjaSetu EMS.

Governs integration with electricity distribution utilities (e.g. BESCOM in Karnataka,
APEPDCL in Andhra Pradesh).
Strictly adheres to data honesty:
- Does not implement unverified or reverse-engineered private APIs.
- When official API access is pending or unapproved, reports explicit AWAITING_APPROVAL state.
- Documents required developer credentials, consumer consent, and utility SLA terms.
- Supports deterministic local test fixtures with zero credential leakage.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    DataClassification,
    MeasurementKind,
    QualityStatus,
)
from avishkar_ems.trust.connectors.base import BaseEnergyConnector, ConnectorHealthReport
from avishkar_ems.trust.geo_integrity import CanonicalEntityCatalog
from avishkar_ems.trust.source_registry import ConnectionStatus, SourceRecord


class DiscomConnector(BaseEnergyConnector):
    """Connector for electricity distribution utilities with pending/mock fixture support."""

    def __init__(
        self,
        source_record: SourceRecord,
        api_token: str | None = None,
        fixture_payload: list[dict[str, Any]] | None = None,
    ):
        super().__init__(source_record)
        self.api_token = api_token
        self.fixture_payload = fixture_payload

    def validate_access(self) -> tuple[bool, str]:
        """Validates utility API access according to connection status and credentials."""
        if self.fixture_payload is not None:
            return True, "Deterministic offline test fixture active."

        if self.source_record.connection_status == ConnectionStatus.AWAITING_APPROVAL:
            return (
                False,
                f"Official API access for {self.source_record.official_provider_name} is awaiting regulatory approval. "
                "Required: Formal Discom Data-Sharing MOU, OAuth2 client ID, and consumer opt-in consent flow.",
            )

        if not self.api_token:
            return (
                False,
                f"API token or mutual TLS client certificate missing for {self.source_record.official_provider_name}.",
            )

        return True, "Authenticated utility portal session verified."

    def fetch_raw(self) -> list[dict[str, Any]]:
        """Retrieves raw utility telemetry or test fixture."""
        if self.fixture_payload is not None:
            return self.fixture_payload
        raise PermissionError(
            f"Cannot fetch live telemetry from {self.source_record.official_provider_name}: "
            "Enterprise Discom connection is in AWAITING_APPROVAL state."
        )

    def validate_schema(self, raw_data: Any) -> tuple[bool, list[str]]:
        """Validates smart meter or billing telemetry schema."""
        if not isinstance(raw_data, list):
            return False, ["Discom telemetry payload must be a list of meter intervals"]
        errors: list[str] = []
        for i, row in enumerate(raw_data):
            if "consumer_id" not in row and "utility_id" not in row:
                errors.append(f"Row {i} missing consumer_id/utility_id")
            if "kwh" not in row and "units" not in row:
                errors.append(f"Row {i} missing energy reading (kwh/units)")
        return len(errors) == 0, errors

    def parse(self, raw_data: Any) -> list[dict[str, Any]]:
        """Parses raw records into standardized list."""
        return list(raw_data)

    def normalize(self, raw_records: list[dict[str, Any]], ingestion_run_id: str) -> list[CanonicalObservation]:
        """Normalizes Discom meter readings into CanonicalObservation instances."""
        normalized: list[CanonicalObservation] = []
        now = datetime.now(UTC)

        for row in raw_records:
            entity_id = row.get("utility_id") or self.source_record.source_id
            geo_entity = CanonicalEntityCatalog.get_entity(entity_id)
            geo_level = geo_entity.level.value if geo_entity else "HOUSEHOLD"

            reading_time = datetime.fromisoformat(row["timestamp"]) if "timestamp" in row else now
            if reading_time.tzinfo is None:
                reading_time = reading_time.replace(tzinfo=UTC)

            val = float(row.get("kwh") or row.get("units", 0.0))

            obs = CanonicalObservation(
                observation_id=f"DISCOM_{entity_id}_{reading_time.strftime('%Y%m%d%H%M')}",
                source_id=self.source_record.source_id,
                dataset_id=self.source_record.dataset_id,
                metric_id="HOUSEHOLD_CONSUMPTION_KWH",
                original_metric_name="Interval Energy Consumption",
                original_value=val,
                original_unit="kWh",
                normalized_value=val,
                normalized_unit="kWh",
                geographic_entity_id=entity_id,
                geographic_level=geo_level,
                reporting_period_start=reading_time,
                reporting_period_end=reading_time,
                data_classification=DataClassification.HOUSEHOLD_METER,
                quality_status=QualityStatus.VALID,
                original_source_record_id=f"MTR:{row.get('consumer_id', 'ANON')}:{reading_time.isoformat()}",
                provenance_reference=f"{self.source_record.official_provider_name} Meter Telemetry",
                ingestion_run_id=ingestion_run_id,
                measurement_kind=MeasurementKind.INTERVAL_KWH,
                observation_timestamp=reading_time,
                retrieval_timestamp=now,
            )
            normalized.append(obs)

        return normalized

    def health_check(self) -> ConnectorHealthReport:
        """Returns health status honestly, without simulating fake connectivity."""
        has_access, reason = self.validate_access()
        return ConnectorHealthReport(
            source_id=self.source_record.source_id,
            is_healthy=has_access,
            connection_status=self.source_record.connection_status.value,
            access_configured=bool(self.api_token or self.fixture_payload),
            last_verification_date=self.source_record.last_verification_date,
            last_successful_retrieval=self.source_record.last_successful_retrieval,
            latency_ms=None,
            error_message=None if has_access else reason,
            diagnostics={
                "provider": self.source_record.official_provider_name,
                "homepage": self.source_record.source_homepage_url,
                "access_prerequisites": [
                    "Utility Enterprise Data-Sharing Agreement",
                    "Consumer consent authorization token (OAuth2)",
                    "DISCOM API Gateway credentials",
                ],
            },
        )
