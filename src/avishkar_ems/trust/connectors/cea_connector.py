"""Central Electricity Authority (CEA) Source Connector.

Implements the BaseEnergyConnector contract for CEA Power Supply Position
and Monthly Renewable Generation reports.
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


class CeaConnector(BaseEnergyConnector):
    """Connector for Central Electricity Authority reports (National and State)."""

    def __init__(self, source_record: SourceRecord, file_path: str | Path | None = None):
        super().__init__(source_record)
        default_path = Path(__file__).resolve().parents[4] / "data" / "energy_reports" / "cea_national_balance.json"
        self.file_path = Path(file_path) if file_path else default_path

    def validate_access(self) -> tuple[bool, str]:
        """CEA data is published under Government Open Data License (GODL-India)."""
        if self.file_path.exists():
            return True, "Official report file verified on local data store."
        return False, f"Report file not found at {self.file_path}"

    def fetch_raw(self) -> dict[str, Any]:
        """Loads and parses raw JSON report from disk or repository data cache."""
        with open(self.file_path, encoding="utf-8") as f:
            return json.load(f)

    def validate_schema(self, raw_data: Any) -> tuple[bool, list[str]]:
        """Validates expected schema elements for CEA reports."""
        errors: list[str] = []
        if not isinstance(raw_data, dict):
            return False, ["Root element must be a JSON object"]

        if "observations" not in raw_data and "records" not in raw_data:
            errors.append("Payload missing 'observations' or 'records' array")

        return len(errors) == 0, errors

    def parse(self, raw_data: Any) -> list[dict[str, Any]]:
        """Parses observations into structured list of rows."""
        if "observations" in raw_data:
            region = raw_data.get("regionCode", "IN")
            rows = []
            for obs in raw_data["observations"]:
                obs_copy = dict(obs)
                obs_copy.setdefault("regionCode", region)
                rows.append(obs_copy)
            return rows
        elif "records" in raw_data:
            return list(raw_data["records"])
        return []

    def normalize(self, raw_records: list[dict[str, Any]], ingestion_run_id: str) -> list[CanonicalObservation]:
        """Normalizes raw CEA rows into strongly-typed CanonicalObservation models."""
        normalized: list[CanonicalObservation] = []
        now = datetime.now(UTC)

        for idx, row in enumerate(raw_records):
            period_str = row.get("reportingPeriod", "2024-04")
            year, month = map(int, period_str.split("-"))
            start_date = datetime(year, month, 1, tzinfo=UTC)
            # Calculate end date (last day of month)
            if month == 12:
                end_date = datetime(year + 1, 1, 1, tzinfo=UTC)
            else:
                end_date = datetime(year, month + 1, 1, tzinfo=UTC)

            region_code = row.get("regionCode", "IN")
            geo_entity = CanonicalEntityCatalog.get_entity(region_code)
            geo_id = geo_entity.entity_id if geo_entity else region_code
            geo_level = geo_entity.level.value if geo_entity else "UNKNOWN"

            # Check if this is a balance observation (energyRequirementMu, energySuppliedMu, peakDemandMw)
            if "energyRequirementMu" in row:
                obs_req = CanonicalObservation(
                    observation_id=f"CEA_REQ_{region_code}_{period_str}",
                    source_id=self.source_record.source_id,
                    dataset_id=self.source_record.dataset_id,
                    metric_id="ENERGY_REQUIREMENT_MU",
                    original_metric_name="Energy Requirement",
                    original_value=float(row["energyRequirementMu"]),
                    original_unit="MU",
                    normalized_value=float(row["energyRequirementMu"]),
                    normalized_unit="MU",
                    geographic_entity_id=geo_id,
                    geographic_level=geo_level,
                    reporting_period_start=start_date,
                    reporting_period_end=end_date,
                    data_classification=DataClassification.OFFICIAL_OBSERVATION,
                    quality_status=QualityStatus.VALID,
                    original_source_record_id=f"{self.file_path.name}:{idx}:req",
                    provenance_reference="CEA Power Supply Position Monthly Report",
                    ingestion_run_id=ingestion_run_id,
                    measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
                    observation_timestamp=end_date,
                    retrieval_timestamp=now,
                )
                normalized.append(obs_req)

            if "energySuppliedMu" in row:
                obs_sup = CanonicalObservation(
                    observation_id=f"CEA_SUP_{region_code}_{period_str}",
                    source_id=self.source_record.source_id,
                    dataset_id=self.source_record.dataset_id,
                    metric_id="ENERGY_SUPPLIED_MU",
                    original_metric_name="Energy Supplied",
                    original_value=float(row["energySuppliedMu"]),
                    original_unit="MU",
                    normalized_value=float(row["energySuppliedMu"]),
                    normalized_unit="MU",
                    geographic_entity_id=geo_id,
                    geographic_level=geo_level,
                    reporting_period_start=start_date,
                    reporting_period_end=end_date,
                    data_classification=DataClassification.OFFICIAL_OBSERVATION,
                    quality_status=QualityStatus.VALID,
                    original_source_record_id=f"{self.file_path.name}:{idx}:sup",
                    provenance_reference="CEA Power Supply Position Monthly Report",
                    ingestion_run_id=ingestion_run_id,
                    measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
                    observation_timestamp=end_date,
                    retrieval_timestamp=now,
                )
                normalized.append(obs_sup)

            if "peakDemandMw" in row:
                obs_peak = CanonicalObservation(
                    observation_id=f"CEA_PEAK_{region_code}_{period_str}",
                    source_id=self.source_record.source_id,
                    dataset_id=self.source_record.dataset_id,
                    metric_id="PEAK_DEMAND_MW",
                    original_metric_name="Peak Demand",
                    original_value=float(row["peakDemandMw"]),
                    original_unit="MW",
                    normalized_value=float(row["peakDemandMw"]) * 1000.0,  # normalized to kW
                    normalized_unit="kW",
                    geographic_entity_id=geo_id,
                    geographic_level=geo_level,
                    reporting_period_start=start_date,
                    reporting_period_end=end_date,
                    data_classification=DataClassification.OFFICIAL_OBSERVATION,
                    quality_status=QualityStatus.VALID,
                    original_source_record_id=f"{self.file_path.name}:{idx}:peak",
                    provenance_reference="CEA Power Supply Position Monthly Report",
                    ingestion_run_id=ingestion_run_id,
                    measurement_kind=MeasurementKind.INSTANTANEOUS_KW,
                    observation_timestamp=end_date,
                    retrieval_timestamp=now,
                )
                normalized.append(obs_peak)

            # Check if this is a renewable generation record (installedSolarCapacityMw, solarGenerationMu)
            if "installedSolarCapacityMw" in row:
                obs_cap = CanonicalObservation(
                    observation_id=f"CEA_SOLAR_CAP_{region_code}_{period_str}",
                    source_id=self.source_record.source_id,
                    dataset_id=self.source_record.dataset_id,
                    metric_id="SOLAR_CAPACITY_MW",
                    original_metric_name="Installed Solar Capacity",
                    original_value=float(row["installedSolarCapacityMw"]),
                    original_unit="MW",
                    normalized_value=float(row["installedSolarCapacityMw"]),
                    normalized_unit="MW",
                    geographic_entity_id=geo_id,
                    geographic_level=geo_level,
                    reporting_period_start=start_date,
                    reporting_period_end=end_date,
                    data_classification=DataClassification.OFFICIAL_OBSERVATION,
                    quality_status=QualityStatus.VALID,
                    original_source_record_id=f"{self.file_path.name}:{idx}:cap",
                    provenance_reference="CEA Monthly Renewable Generation & MNRE Statistics",
                    ingestion_run_id=ingestion_run_id,
                    measurement_kind=MeasurementKind.NAMEPLATE_CAPACITY_MW,
                    observation_timestamp=end_date,
                    retrieval_timestamp=now,
                )
                normalized.append(obs_cap)

            if "solarGenerationMu" in row:
                obs_gen = CanonicalObservation(
                    observation_id=f"CEA_SOLAR_GEN_{region_code}_{period_str}",
                    source_id=self.source_record.source_id,
                    dataset_id=self.source_record.dataset_id,
                    metric_id="SOLAR_GENERATION_MU",
                    original_metric_name="Solar Generation",
                    original_value=float(row["solarGenerationMu"]),
                    original_unit="MU",
                    normalized_value=float(row["solarGenerationMu"]),
                    normalized_unit="MU",
                    geographic_entity_id=geo_id,
                    geographic_level=geo_level,
                    reporting_period_start=start_date,
                    reporting_period_end=end_date,
                    data_classification=DataClassification.OFFICIAL_OBSERVATION,
                    quality_status=QualityStatus.VALID,
                    original_source_record_id=f"{self.file_path.name}:{idx}:gen",
                    provenance_reference="CEA Monthly Renewable Generation Report",
                    ingestion_run_id=ingestion_run_id,
                    measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
                    observation_timestamp=end_date,
                    retrieval_timestamp=now,
                )
                normalized.append(obs_gen)

        return normalized

    def health_check(self) -> ConnectorHealthReport:
        """Probes the local report cache or upstream accessibility."""
        start = datetime.now(UTC)
        access_ok, reason = self.validate_access()
        latency = (datetime.now(UTC) - start).total_seconds() * 1000.0

        return ConnectorHealthReport(
            source_id=self.source_record.source_id,
            is_healthy=access_ok,
            connection_status=self.source_record.connection_status.value,
            access_configured=access_ok,
            last_verification_date=self.source_record.last_verification_date,
            last_successful_retrieval=self.source_record.last_successful_retrieval,
            latency_ms=round(latency, 2),
            error_message=None if access_ok else reason,
            diagnostics={"file_path": str(self.file_path), "file_exists": self.file_path.exists()},
        )
