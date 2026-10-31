"""Andhra Pradesh State & APEPDCL Electricity Data Connector.

Ingests state-level electricity demand, supply, peak met, and APEPDCL utility statistics
sourced from APERC regulatory filings and APSLDC open data.
Strict geographic invariants:
1. AP state totals are kept on 'AP' (STATE level).
2. APEPDCL metrics are kept on 'APEPDCL' (UTILITY level, covering 5 coastal districts).
3. Visakhapatnam metrics are kept on 'AP_VSKP' (DISTRICT level).
4. Never distributes state totals across districts.
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


class ApEnergyConnector(BaseEnergyConnector):
    """Connector for Andhra Pradesh state power balance and APEPDCL utility performance."""

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
            / "ap_state_balance.json"
        )
        self.file_path = Path(file_path) if file_path else default_path
        self.fixture_payload = fixture_payload

    def validate_access(self) -> tuple[bool, str]:
        """Validates file presence or test fixture."""
        if self.fixture_payload is not None:
            return True, "Deterministic offline test fixture active."
        if self.file_path.exists():
            return True, f"Verified AP report file verified at {self.file_path.name}"
        return False, f"Report file not found at {self.file_path}"

    def fetch_raw(self) -> dict[str, Any]:
        """Loads AP report payload."""
        if self.fixture_payload is not None:
            return self.fixture_payload
        with open(self.file_path, encoding="utf-8") as f:
            return json.load(f)

    def validate_schema(self, raw_data: Any) -> tuple[bool, list[str]]:
        """Validates expected schema for AP energy balance."""
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
            for field_name in ["period", "entityId", "energyRequirementMu", "energySuppliedMu"]:
                if field_name not in rec:
                    errors.append(f"Record {idx} missing required field '{field_name}'")

        return len(errors) == 0, errors

    def parse(self, raw_data: Any) -> list[dict[str, Any]]:
        """Parses combined state records and utility records."""
        items: list[dict[str, Any]] = []
        for rec in raw_data.get("records", []):
            rec_copy = dict(rec)
            rec_copy["_record_type"] = "STATE_BALANCE"
            items.append(rec_copy)
        for urec in raw_data.get("utilityRecords", []):
            urec_copy = dict(urec)
            urec_copy["_record_type"] = "UTILITY_STATS"
            items.append(urec_copy)
        return items

    def normalize(
        self, raw_records: list[dict[str, Any]], ingestion_run_id: str
    ) -> list[CanonicalObservation]:
        """Transforms AP records into CanonicalObservation instances."""
        normalized: list[CanonicalObservation] = []
        now = datetime.now(UTC)

        for row in raw_records:
            rtype = row.get("_record_type", "STATE_BALANCE")
            entity_id = row.get("entityId", "AP")
            geo_entity = CanonicalEntityCatalog.get_entity(entity_id)
            geo_id = geo_entity.entity_id if geo_entity else entity_id
            geo_level = geo_entity.level.value if geo_entity else "STATE"

            period_str = row.get("period", "2025-10")

            if rtype == "STATE_BALANCE":
                parts = period_str.split("-")
                year = int(parts[0])
                month = int(parts[1])
                start_dt = datetime(year, month, 1, 0, 0, tzinfo=UTC)
                if month == 12:
                    end_dt = datetime(year + 1, 1, 1, 0, 0, tzinfo=UTC)
                else:
                    end_dt = datetime(year, month + 1, 1, 0, 0, tzinfo=UTC)

                req_mu = float(row["energyRequirementMu"])
                sup_mu = float(row["energySuppliedMu"])
                peak_req_mw = float(row.get("peakDemandMw", 0.0))
                peak_met_mw = float(row.get("peakMetMw", 0.0))
                solar_mw = float(row.get("solarInstalledMw", 0.0))

                # Energy Requirement (MU)
                normalized.append(
                    CanonicalObservation(
                        observation_id=f"AP_REQ_{geo_id}_{period_str}",
                        source_id=self.source_record.source_id,
                        dataset_id=self.source_record.dataset_id,
                        metric_id="ENERGY_REQUIREMENT_MU",
                        original_metric_name="Monthly Energy Requirement",
                        original_value=req_mu,
                        original_unit="MU",
                        normalized_value=req_mu,
                        normalized_unit="MU",
                        geographic_entity_id=geo_id,
                        geographic_level=geo_level,
                        reporting_period_start=start_dt,
                        reporting_period_end=end_dt,
                        data_classification=DataClassification.OFFICIAL_OBSERVATION,
                        quality_status=QualityStatus.VALID,
                        original_source_record_id=f"AP:{geo_id}:{period_str}:REQ",
                        provenance_reference="APSLDC Monthly Power Supply Position",
                        ingestion_run_id=ingestion_run_id,
                        measurement_kind=MeasurementKind.TOTAL_MU,
                        observation_timestamp=end_dt,
                        retrieval_timestamp=now,
                    )
                )

                # Energy Supplied (MU)
                normalized.append(
                    CanonicalObservation(
                        observation_id=f"AP_SUP_{geo_id}_{period_str}",
                        source_id=self.source_record.source_id,
                        dataset_id=self.source_record.dataset_id,
                        metric_id="ENERGY_SUPPLIED_MU",
                        original_metric_name="Monthly Energy Supplied",
                        original_value=sup_mu,
                        original_unit="MU",
                        normalized_value=sup_mu,
                        normalized_unit="MU",
                        geographic_entity_id=geo_id,
                        geographic_level=geo_level,
                        reporting_period_start=start_dt,
                        reporting_period_end=end_dt,
                        data_classification=DataClassification.OFFICIAL_OBSERVATION,
                        quality_status=QualityStatus.VALID,
                        original_source_record_id=f"AP:{geo_id}:{period_str}:SUP",
                        provenance_reference="APSLDC Monthly Power Supply Position",
                        ingestion_run_id=ingestion_run_id,
                        measurement_kind=MeasurementKind.TOTAL_MU,
                        observation_timestamp=end_dt,
                        retrieval_timestamp=now,
                    )
                )

                # Peak Demand (MW)
                if peak_req_mw > 0:
                    normalized.append(
                        CanonicalObservation(
                            observation_id=f"AP_PEAK_DEM_{geo_id}_{period_str}",
                            source_id=self.source_record.source_id,
                            dataset_id=self.source_record.dataset_id,
                            metric_id="PEAK_DEMAND_MW",
                            original_metric_name="Peak Demand",
                            original_value=peak_req_mw,
                            original_unit="MW",
                            normalized_value=peak_req_mw,
                            normalized_unit="MW",
                            geographic_entity_id=geo_id,
                            geographic_level=geo_level,
                            reporting_period_start=start_dt,
                            reporting_period_end=end_dt,
                            data_classification=DataClassification.OFFICIAL_OBSERVATION,
                            quality_status=QualityStatus.VALID,
                            original_source_record_id=f"AP:{geo_id}:{period_str}:PEAK_DEM",
                            provenance_reference="APSLDC Monthly Bulletins",
                            ingestion_run_id=ingestion_run_id,
                            measurement_kind=MeasurementKind.PEAK_MW,
                            observation_timestamp=end_dt,
                            retrieval_timestamp=now,
                        )
                    )

                # Peak Met (MW)
                if peak_met_mw > 0:
                    normalized.append(
                        CanonicalObservation(
                            observation_id=f"AP_PEAK_MET_{geo_id}_{period_str}",
                            source_id=self.source_record.source_id,
                            dataset_id=self.source_record.dataset_id,
                            metric_id="PEAK_MET_MW",
                            original_metric_name="Peak Met",
                            original_value=peak_met_mw,
                            original_unit="MW",
                            normalized_value=peak_met_mw,
                            normalized_unit="MW",
                            geographic_entity_id=geo_id,
                            geographic_level=geo_level,
                            reporting_period_start=start_dt,
                            reporting_period_end=end_dt,
                            data_classification=DataClassification.OFFICIAL_OBSERVATION,
                            quality_status=QualityStatus.VALID,
                            original_source_record_id=f"AP:{geo_id}:{period_str}:PEAK_MET",
                            provenance_reference="APSLDC Monthly Bulletins",
                            ingestion_run_id=ingestion_run_id,
                            measurement_kind=MeasurementKind.PEAK_MW,
                            observation_timestamp=end_dt,
                            retrieval_timestamp=now,
                        )
                    )

                # Installed Solar Capacity (MW)
                if solar_mw > 0:
                    normalized.append(
                        CanonicalObservation(
                            observation_id=f"AP_SOLAR_CAP_{geo_id}_{period_str}",
                            source_id=self.source_record.source_id,
                            dataset_id=self.source_record.dataset_id,
                            metric_id="INSTALLED_SOLAR_CAPACITY_MW",
                            original_metric_name="Cumulative Installed Solar Capacity",
                            original_value=solar_mw,
                            original_unit="MW",
                            normalized_value=solar_mw,
                            normalized_unit="MW",
                            geographic_entity_id=geo_id,
                            geographic_level=geo_level,
                            reporting_period_start=start_dt,
                            reporting_period_end=end_dt,
                            data_classification=DataClassification.OFFICIAL_OBSERVATION,
                            quality_status=QualityStatus.VALID,
                            original_source_record_id=f"AP:{geo_id}:{period_str}:SOLAR_MW",
                            provenance_reference="APSLDC & MNRE Cumulative Solar Registry",
                            ingestion_run_id=ingestion_run_id,
                            measurement_kind=MeasurementKind.CAPACITY_MW,
                            observation_timestamp=end_dt,
                            retrieval_timestamp=now,
                        )
                    )

            elif rtype == "UTILITY_STATS":
                # Annual utility sales
                start_year = int(period_str.split("-")[0])
                p_start = datetime(start_year, 4, 1, 0, 0, tzinfo=UTC)
                p_end = datetime(start_year + 1, 3, 31, 23, 59, 59, tzinfo=UTC)

                billed_mu = float(row.get("billedUnitsMu", 0.0))
                consumers = float(row.get("consumersLakhs", 0.0))

                if billed_mu > 0:
                    normalized.append(
                        CanonicalObservation(
                            observation_id=f"APEPDCL_BILLED_{start_year}_{start_year+1}",
                            source_id=self.source_record.source_id,
                            dataset_id=self.source_record.dataset_id,
                            metric_id="APEPDCL_BILLED_UNITS_MU",
                            original_metric_name="APEPDCL Annual Billed Units",
                            original_value=billed_mu,
                            original_unit="MU",
                            normalized_value=billed_mu,
                            normalized_unit="MU",
                            geographic_entity_id=geo_id,
                            geographic_level=geo_level,
                            reporting_period_start=p_start,
                            reporting_period_end=p_end,
                            data_classification=DataClassification.OFFICIAL_OBSERVATION,
                            quality_status=QualityStatus.VALID,
                            original_source_record_id=f"APEPDCL:FY{period_str}:BILLED",
                            provenance_reference="APERC Retail Supply Tariff Filings",
                            ingestion_run_id=ingestion_run_id,
                            measurement_kind=MeasurementKind.TOTAL_MU,
                            observation_timestamp=p_end,
                            retrieval_timestamp=now,
                        )
                    )

                if consumers > 0:
                    normalized.append(
                        CanonicalObservation(
                            observation_id=f"APEPDCL_CONSUMERS_{start_year}_{start_year+1}",
                            source_id=self.source_record.source_id,
                            dataset_id=self.source_record.dataset_id,
                            metric_id="APEPDCL_CONSUMERS_LAKHS",
                            original_metric_name="APEPDCL Active Consumer Base",
                            original_value=consumers,
                            original_unit="Lakhs",
                            normalized_value=consumers,
                            normalized_unit="Lakhs",
                            geographic_entity_id=geo_id,
                            geographic_level=geo_level,
                            reporting_period_start=p_start,
                            reporting_period_end=p_end,
                            data_classification=DataClassification.OFFICIAL_OBSERVATION,
                            quality_status=QualityStatus.VALID,
                            original_source_record_id=f"APEPDCL:FY{period_str}:CONSUMERS",
                            provenance_reference="APERC Annual Reports",
                            ingestion_run_id=ingestion_run_id,
                            measurement_kind=MeasurementKind.COUNT,
                            observation_timestamp=p_end,
                            retrieval_timestamp=now,
                        )
                    )

        return normalized

    def health_check(self) -> ConnectorHealthReport:
        """Evaluates health of the AP energy connector."""
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
                "dataset_name": self.source_record.dataset_name,
                "geographic_entities": ["AP (State)", "APEPDCL (Utility)", "AP_VSKP (District)"],
                "anti_disaggregation": "Preserved. State totals never downscaled to districts.",
            },
        )
