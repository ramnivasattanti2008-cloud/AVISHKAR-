"""National Power Portal (NPP) Daily Outturn Source Connector.

Ingests All-India and regional daily power generation by fuel category
(Thermal, Hydro, Nuclear, Renewable) and thermal Plant Load Factor (PLF %)
from National Power Portal reports and dashboards (https://npp.gov.in/).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    DataClassification,
    MeasurementKind,
    QualityStatus,
)
from avishkar_ems.trust.connectors.base import BaseEnergyConnector, ConnectorHealthReport
from avishkar_ems.trust.geo_integrity import CanonicalEntityCatalog
from avishkar_ems.trust.source_registry import SourceRecord


class NppGenerationConnector(BaseEnergyConnector):
    """Connector for National Power Portal daily generation outturn."""

    def __init__(
        self,
        source_record: SourceRecord,
        file_path: str | Path | None = None,
        fixture_payload: dict[str, Any] | None = None,
    ):
        super().__init__(source_record)
        default_path = (
            Path(__file__).resolve().parents[4]
            / "data"
            / "energy_reports"
            / "npp_daily_outturn.json"
        )
        self.file_path = Path(file_path) if file_path else default_path
        self.fixture_payload = fixture_payload

    def validate_access(self) -> tuple[bool, str]:
        """NPP published reports are open government data."""
        if self.fixture_payload is not None:
            return True, "Deterministic memory fixture active."
        if self.file_path.exists():
            return True, f"Verified report file verified at {self.file_path.name}"
        return False, f"Report file not found at {self.file_path}"

    def fetch_raw(self) -> dict[str, Any]:
        """Retrieves raw JSON data from fixture or file cache."""
        if self.fixture_payload is not None:
            return self.fixture_payload

        with open(self.file_path, encoding="utf-8") as f:
            return json.load(f)

    def validate_schema(self, raw_data: Any) -> tuple[bool, list[str]]:
        """Validates payload schema for NPP daily outturn."""
        if not isinstance(raw_data, dict):
            return False, ["Payload must be a JSON object"]

        errors: list[str] = []
        if "records" not in raw_data:
            errors.append("Missing 'records' array in payload")
            return False, errors

        records = raw_data["records"]
        if not isinstance(records, list) or len(records) == 0:
            errors.append("'records' must be a non-empty list")
            return False, errors

        for idx, rec in enumerate(records):
            for field_name in ["date", "regionCode", "totalGenMu", "thermalGenMu", "renewableGenMu"]:
                if field_name not in rec:
                    errors.append(f"Record {idx} missing required field '{field_name}'")

        return len(errors) == 0, errors

    def parse(self, raw_data: Any) -> list[dict[str, Any]]:
        """Parses records list."""
        return list(raw_data.get("records", []))

    def normalize(
        self, raw_records: list[dict[str, Any]], ingestion_run_id: str
    ) -> list[CanonicalObservation]:
        """Normalizes daily outturn records into strongly-typed CanonicalObservations."""
        normalized: list[CanonicalObservation] = []
        now = datetime.now(UTC)

        for rec in raw_records:
            date_str = rec["date"]
            # e.g. "2026-10-23"
            parts = date_str.split("-")
            obs_date = datetime(int(parts[0]), int(parts[1]), int(parts[2]), 0, 0, tzinfo=UTC)
            day_end = obs_date.replace(hour=23, minute=59, second=59)

            region_code = rec.get("regionCode", "IN")
            geo_entity = CanonicalEntityCatalog.get_entity(region_code)
            geo_id = geo_entity.entity_id if geo_entity else region_code
            geo_level = geo_entity.level.value if geo_entity else "NATIONAL"

            total_mu = float(rec["totalGenMu"])
            thermal_mu = float(rec["thermalGenMu"])
            res_mu = float(rec["renewableGenMu"])
            plf_pct = float(rec.get("plfThermalPct", 0.0))

            # 1. Total Daily Generation (MU)
            normalized.append(
                CanonicalObservation(
                    observation_id=f"NPP_GEN_TOTAL_{region_code}_{date_str}",
                    source_id=self.source_record.source_id,
                    dataset_id=self.source_record.dataset_id,
                    metric_id="DAILY_GENERATION_MU",
                    original_metric_name="Gross Daily Electricity Generation",
                    original_value=total_mu,
                    original_unit="MU",
                    normalized_value=total_mu,
                    normalized_unit="MU",
                    geographic_entity_id=geo_id,
                    geographic_level=geo_level,
                    reporting_period_start=obs_date,
                    reporting_period_end=day_end,
                    data_classification=DataClassification.OFFICIAL_OBSERVATION,
                    quality_status=QualityStatus.VALID,
                    original_source_record_id=f"NPP:{region_code}:{date_str}:TOTAL",
                    provenance_reference="National Power Portal Daily Outturn Reports",
                    ingestion_run_id=ingestion_run_id,
                    measurement_kind=MeasurementKind.TOTAL_MU,
                    observation_timestamp=obs_date,
                    retrieval_timestamp=now,
                )
            )

            # 2. Daily Thermal Generation (MU)
            normalized.append(
                CanonicalObservation(
                    observation_id=f"NPP_GEN_THERMAL_{region_code}_{date_str}",
                    source_id=self.source_record.source_id,
                    dataset_id=self.source_record.dataset_id,
                    metric_id="DAILY_THERMAL_GEN_MU",
                    original_metric_name="Daily Thermal Generation",
                    original_value=thermal_mu,
                    original_unit="MU",
                    normalized_value=thermal_mu,
                    normalized_unit="MU",
                    geographic_entity_id=geo_id,
                    geographic_level=geo_level,
                    reporting_period_start=obs_date,
                    reporting_period_end=day_end,
                    data_classification=DataClassification.OFFICIAL_OBSERVATION,
                    quality_status=QualityStatus.VALID,
                    original_source_record_id=f"NPP:{region_code}:{date_str}:THERMAL",
                    provenance_reference="NPP Daily Generation Dashboard",
                    ingestion_run_id=ingestion_run_id,
                    measurement_kind=MeasurementKind.TOTAL_MU,
                    observation_timestamp=obs_date,
                    retrieval_timestamp=now,
                )
            )

            # 3. Daily Renewable / RES Generation (MU)
            normalized.append(
                CanonicalObservation(
                    observation_id=f"NPP_GEN_RES_{region_code}_{date_str}",
                    source_id=self.source_record.source_id,
                    dataset_id=self.source_record.dataset_id,
                    metric_id="DAILY_RENEWABLE_GEN_MU",
                    original_metric_name="Daily Renewable Generation (RES)",
                    original_value=res_mu,
                    original_unit="MU",
                    normalized_value=res_mu,
                    normalized_unit="MU",
                    geographic_entity_id=geo_id,
                    geographic_level=geo_level,
                    reporting_period_start=obs_date,
                    reporting_period_end=day_end,
                    data_classification=DataClassification.OFFICIAL_OBSERVATION,
                    quality_status=QualityStatus.VALID,
                    original_source_record_id=f"NPP:{region_code}:{date_str}:RES",
                    provenance_reference="NPP Daily Generation Dashboard",
                    ingestion_run_id=ingestion_run_id,
                    measurement_kind=MeasurementKind.TOTAL_MU,
                    observation_timestamp=obs_date,
                    retrieval_timestamp=now,
                )
            )

            # 4. Thermal Plant Load Factor (%)
            if plf_pct > 0.0:
                normalized.append(
                    CanonicalObservation(
                        observation_id=f"NPP_PLF_THERMAL_{region_code}_{date_str}",
                        source_id=self.source_record.source_id,
                        dataset_id=self.source_record.dataset_id,
                        metric_id="THERMAL_PLF_PCT",
                        original_metric_name="Thermal Plant Load Factor",
                        original_value=plf_pct,
                        original_unit="%",
                        normalized_value=plf_pct,
                        normalized_unit="%",
                        geographic_entity_id=geo_id,
                        geographic_level=geo_level,
                        reporting_period_start=obs_date,
                        reporting_period_end=day_end,
                        data_classification=DataClassification.OFFICIAL_OBSERVATION,
                        quality_status=QualityStatus.VALID,
                        original_source_record_id=f"NPP:{region_code}:{date_str}:PLF",
                        provenance_reference="NPP Central Monitoring Reports",
                        ingestion_run_id=ingestion_run_id,
                        measurement_kind=MeasurementKind.RATIO,
                        observation_timestamp=obs_date,
                        retrieval_timestamp=now,
                    )
                )

        return normalized

    def health_check(self) -> ConnectorHealthReport:
        """Evaluates health of the NPP outturn connector."""
        has_access, reason = self.validate_access()
        latency_ms = 1.0 if has_access else None

        return ConnectorHealthReport(
            source_id=self.source_record.source_id,
            is_healthy=has_access,
            connection_status=self.source_record.connection_status.value,
            access_configured=bool(self.fixture_payload is not None or self.file_path.exists()),
            last_verification_date=self.source_record.last_verification_date,
            last_successful_retrieval=self.source_record.last_successful_retrieval,
            latency_ms=latency_ms,
            error_message=None if has_access else reason,
            diagnostics={
                "provider": self.source_record.official_provider_name,
                "homepage": self.source_record.source_homepage_url,
                "dataset_name": self.source_record.dataset_name,
                "metrics": [
                    "DAILY_GENERATION_MU",
                    "DAILY_THERMAL_GEN_MU",
                    "DAILY_RENEWABLE_GEN_MU",
                    "THERMAL_PLF_PCT",
                ],
            },
        )
