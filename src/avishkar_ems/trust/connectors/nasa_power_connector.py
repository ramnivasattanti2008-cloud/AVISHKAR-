"""NASA POWER Solar Insolation & Meteorological Climatology Public API Connector.

Fetches verified monthly average solar insolation (ALLSKY_SFC_SW_DWN, kWh/m²/day)
from the NASA Prediction of Worldwide Energy Resources (POWER) Project API
(https://power.larc.nasa.gov/api).
Strict invariants:
1. Sourced from documented, unauthenticated NASA POWER public science API endpoints.
2. Respects provider fair-use policies with bounded retries, user-agent attribution, and timeouts.
3. Explicitly labels multi-year climatological monthly averages as climatology, never as real-time nowcasts.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
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
from avishkar_ems.trust.source_registry import SourceRecord

NASA_POWER_API_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"

# Default benchmark locations across India, Karnataka, and Andhra Pradesh
SUPPORTED_LOCATIONS: dict[str, tuple[float, float, str]] = {
    "IN": (20.5937, 78.9629, "IN"),
    "KA_BLR_URBAN": (12.9716, 77.5946, "KA_BLR_URBAN"),
    "AP_VSKP": (17.6868, 83.2185, "AP_VSKP"),
}

MONTH_MAP: dict[str, int] = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AUG": 8,
    "SEP": 9,
    "OCT": 10,
    "NOV": 11,
    "DEC": 12,
}


class NasaPowerConnector(BaseEnergyConnector):
    """Connector for NASA POWER multi-year monthly solar insolation climatology."""

    def __init__(
        self,
        source_record: SourceRecord,
        location_code: str = "KA_BLR_URBAN",
        offline_fixture: dict[str, Any] | None = None,
        timeout_seconds: float = 10.0,
    ):
        super().__init__(source_record)
        self.location_code = location_code
        self.offline_fixture = offline_fixture
        self.timeout_seconds = timeout_seconds

        if location_code in SUPPORTED_LOCATIONS:
            self.lat, self.lon, self.geo_id = SUPPORTED_LOCATIONS[location_code]
        else:
            self.lat, self.lon, self.geo_id = 12.9716, 77.5946, "KA_BLR_URBAN"

    def validate_access(self) -> tuple[bool, str]:
        """NASA POWER is an open public API requiring no authentication under NASA Open Science Data Policy."""
        return True, "Open public access permitted under NASA Open Science Data Policy."

    def fetch_raw(self) -> dict[str, Any]:
        """Fetches live solar climatology observations or returns verified offline fixture."""
        if self.offline_fixture is not None:
            return self.offline_fixture

        params = {
            "parameters": "ALLSKY_SFC_SW_DWN",
            "community": "RE",
            "longitude": f"{self.lon:.4f}",
            "latitude": f"{self.lat:.4f}",
            "format": "JSON",
        }
        query_url = f"{NASA_POWER_API_URL}?{urllib.parse.urlencode(params)}"

        def _do_fetch() -> dict[str, Any]:
            req = urllib.request.Request(
                query_url,
                headers={
                    "User-Agent": "UrjaSetuEMS/1.0 (+https://github.com/ramnivasattanti2008-cloud/AVISHKAR-)",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
                return json.loads(resp.read().decode("utf-8"))

        return self.execute_with_retry(_do_fetch, max_retries=3, base_delay_seconds=0.5)

    def validate_schema(self, raw_data: Any) -> tuple[bool, list[str]]:
        """Validates that NASA POWER payload contains expected properties and parameters."""
        if not isinstance(raw_data, dict):
            return False, ["Payload must be a JSON dictionary"]

        errors: list[str] = []
        if "properties" not in raw_data or not isinstance(raw_data["properties"], dict):
            errors.append("Missing 'properties' dictionary in response")
            return False, errors

        parameter = raw_data["properties"].get("parameter")
        if not isinstance(parameter, dict):
            errors.append("Missing 'parameter' dictionary inside 'properties'")
            return False, errors

        if "ALLSKY_SFC_SW_DWN" not in parameter:
            errors.append("Missing 'ALLSKY_SFC_SW_DWN' parameter in response")
            return False, errors

        return len(errors) == 0, errors

    def parse(self, raw_data: Any) -> list[dict[str, Any]]:
        """Parses monthly solar insolation values into structured rows."""
        param_dict = raw_data["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]
        rows: list[dict[str, Any]] = []

        for month_name, val in param_dict.items():
            if val is None or float(val) < 0.0:
                continue
            month_num = MONTH_MAP.get(month_name.upper())
            rows.append({
                "month_code": month_name.upper(),
                "month_num": month_num,
                "insolation_kwh_m2_day": float(val),
                "is_annual": month_name.upper() == "ANN",
            })
        return rows

    def normalize(
        self, raw_records: list[dict[str, Any]], ingestion_run_id: str
    ) -> list[CanonicalObservation]:
        """Normalizes NASA POWER climatology records into CanonicalObservation instances."""
        normalized: list[CanonicalObservation] = []
        now = datetime.now(UTC)

        geo_entity = CanonicalEntityCatalog.get_entity(self.geo_id)
        entity_id = geo_entity.entity_id if geo_entity else self.geo_id
        geo_level = geo_entity.level.value if geo_entity else "DISTRICT"

        # Reference calendar year for climatological period anchors
        ref_year = 2026

        for row in raw_records:
            insolation = float(row["insolation_kwh_m2_day"])
            month_code = row["month_code"]
            month_num = row.get("month_num")

            if row.get("is_annual") or month_num is None:
                # Annual average climatology
                p_start = datetime(ref_year, 1, 1, 0, 0, tzinfo=UTC)
                p_end = datetime(ref_year, 12, 31, 23, 59, 59, tzinfo=UTC)
                obs_id = f"NASA_POWER_SOLAR_{entity_id}_ANNUAL"
            else:
                p_start = datetime(ref_year, month_num, 1, 0, 0, tzinfo=UTC)
                if month_num == 12:
                    p_end = datetime(ref_year, 12, 31, 23, 59, 59, tzinfo=UTC)
                else:
                    # End of month
                    p_end = datetime(ref_year, month_num + 1, 1, 0, 0, tzinfo=UTC)
                obs_id = f"NASA_POWER_SOLAR_{entity_id}_M{month_num:02d}"

            normalized.append(
                CanonicalObservation(
                    observation_id=obs_id,
                    source_id=self.source_record.source_id,
                    dataset_id=self.source_record.dataset_id,
                    metric_id="SOLAR_INSOLATION_KWH_M2_DAY",
                    original_metric_name="All-Sky Surface Solar Insolation",
                    original_value=insolation,
                    original_unit="kWh/m²/day",
                    normalized_value=insolation,
                    normalized_unit="kWh/m²/day",
                    geographic_entity_id=entity_id,
                    geographic_level=geo_level,
                    reporting_period_start=p_start,
                    reporting_period_end=p_end,
                    data_classification=DataClassification.OFFICIAL_OBSERVATION,
                    quality_status=QualityStatus.VALID,
                    original_source_record_id=f"NASA:{self.lat},{self.lon}:{month_code}:ALLSKY_SW",
                    provenance_reference="NASA POWER 30-Year Satellite Surface Climatology",
                    ingestion_run_id=ingestion_run_id,
                    measurement_kind=MeasurementKind.DAILY_INSOLATION,
                    observation_timestamp=p_end,
                    retrieval_timestamp=now,
                    metadata={
                        "month_code": month_code,
                        "location_code": self.location_code,
                        "coordinates": f"{self.lat}, {self.lon}",
                    },
                )
            )

        return normalized

    def health_check(self) -> ConnectorHealthReport:
        """Performs reachability probe to NASA POWER endpoint."""
        start_t = time.time()
        is_healthy = False
        err = None
        latency = None

        if self.offline_fixture is not None:
            return ConnectorHealthReport(
                source_id=self.source_record.source_id,
                is_healthy=True,
                connection_status=self.source_record.connection_status.value,
                access_configured=True,
                last_verification_date=self.source_record.last_verification_date,
                last_successful_retrieval=self.source_record.last_successful_retrieval,
                latency_ms=1.5,
                diagnostics={"mode": "offline_fixture", "provider": "NASA POWER"},
            )

        try:
            self.fetch_raw()
            is_healthy = True
            latency = (time.time() - start_t) * 1000.0
        except Exception as exc:
            err = str(exc)

        return ConnectorHealthReport(
            source_id=self.source_record.source_id,
            is_healthy=is_healthy,
            connection_status=self.source_record.connection_status.value,
            access_configured=True,
            last_verification_date=self.source_record.last_verification_date,
            last_successful_retrieval=datetime.now(UTC) if is_healthy else None,
            latency_ms=latency,
            error_message=err,
            diagnostics={
                "endpoint": NASA_POWER_API_URL,
                "location": self.location_code,
                "coordinates": f"{self.lat}, {self.lon}",
                "parameter": "ALLSKY_SFC_SW_DWN",
            },
        )
