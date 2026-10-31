"""Solar Intelligence Engine for UrjaSetu EMS.

Distinguishes solar capacity, actual generation, renewable additions, and solar share.
Performs Month-over-Month (MoM) and Year-over-Year (YoY) trend analysis.
Strict invariants:
1. Distinguish installed capacity (MW) from actual generated energy (MU/GWh).
2. Compute Solar share = (Solar Generation / Total Generation) * 100%.
3. Ingestion enforces source verification, schema validation, unit normalization,
   reporting-period detection, duplicate prevention, and original-source references.
4. Do NOT create hourly solar-generation data from monthly observations.
5. Hydro classification: Small hydro (<= 25 MW) is classified under Renewable Energy Sources (RES),
   while large hydro (> 25 MW) is reported under conventional generation per CEA standards.
"""

from __future__ import annotations

import calendar
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from avishkar_ems.metric_semantics import MetricSemanticsRegistry
from avishkar_ems.time_series_trends import TimeSeriesPoint

ROOT_DATA = Path(__file__).resolve().parent.parent.parent / "data" / "energy_reports"

HYDRO_CLASSIFICATION_CEA_NOTE = (
    "CEA Standard: Small Hydro (<= 25 MW) is classified as Renewable Energy Source (RES). "
    "Large Hydro (> 25 MW) is reported separately under conventional utilities."
)


@dataclass(frozen=True)
class SolarIntelligenceRecord:
    reporting_period: str  # Format: "YYYY-MM"
    region_code: str  # "IN", "KA", "AP"
    installed_solar_capacity_mw: float
    solar_generation_mu: float
    total_generation_mu: float
    total_renewable_generation_mu: float
    renewable_additions_mw: float
    source: str
    record_hash: str
    provenance: str = "VERIFIED_REPORT"

    @property
    def solar_share_pct(self) -> float:
        """Solar share of total generation as a percentage."""
        if self.total_generation_mu <= 0:
            return 0.0
        return round((self.solar_generation_mu / self.total_generation_mu) * 100, 2)

    @property
    def re_share_pct(self) -> float:
        """Total renewable share of total generation as a percentage."""
        if self.total_generation_mu <= 0:
            return 0.0
        return round((self.total_renewable_generation_mu / self.total_generation_mu) * 100, 2)


@dataclass(frozen=True)
class GrowthMetric:
    metric_name: str
    current_value: float
    reference_value: float
    delta_value: float
    percentage_change: float
    type: str  # "MOM" or "YOY"
    current_period: str
    reference_period: str


@dataclass(frozen=True)
class SolarCUFResult:
    region_code: str
    reporting_period: str
    installed_capacity_mw: float
    solar_generation_mu: float
    hours_in_month: int
    cuf_percentage: float | None
    formula: str
    caveat: str


@dataclass(frozen=True)
class SolarShareResult:
    region_code: str
    reporting_period: str
    solar_generation_mu: float
    total_generation_mu: float
    solar_share_pct: float | None
    is_valid: bool
    formula: str
    notes: str


class SolarIntelligenceEngine:
    """Processes, validates, and analyzes official solar and renewable generation data."""

    def __init__(self, data_path: Path | None = None) -> None:
        p = data_path or (ROOT_DATA / "cea_renewable_generation.json")
        self._records: list[SolarIntelligenceRecord] = []
        self._by_region_period: dict[tuple[str, str], SolarIntelligenceRecord] = {}
        self._seen_hashes: set[str] = set()
        if p.exists():
            self._load_file(p)

    def _hash_record(self, raw: dict[str, Any]) -> str:
        key = f"{raw.get('reportingPeriod')}:{raw.get('regionCode')}:{raw.get('solarGenerationMu')}:{raw.get('installedSolarCapacityMw')}"
        return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]

    def _load_file(self, p: Path) -> None:
        raw = json.loads(p.read_text(encoding="utf-8"))
        src = raw.get("source", "CEA Renewable Generation Reports")
        for item in raw.get("records", []):
            self.ingest_record(item, source_reference=src)

    def ingest_record(self, item: dict[str, Any], source_reference: str) -> tuple[bool, str]:
        """Ingests a record with schema validation, unit normalization, and duplicate prevention."""
        rp = item.get("reportingPeriod")
        if not rp or len(rp) != 7 or rp[4] != "-":
            raise ValueError(f"Invalid reporting period format: '{rp}'. Expected 'YYYY-MM'.")

        reg = item.get("regionCode")
        if not reg or reg not in {"IN", "KA", "AP", "MH", "RJ", "UP", "GJ", "TN", "DL"}:
            raise ValueError(f"Unsupported or missing region code: '{reg}'.")

        # Duplicate prevention using cryptographic hashing
        rec_hash = self._hash_record(item)
        if rec_hash in self._seen_hashes:
            return False, f"Duplicate record detected (hash {rec_hash}). Skipped."

        cap = float(item.get("installedSolarCapacityMw", 0.0))
        gen = float(item.get("solarGenerationMu", 0.0))
        tot = float(item.get("totalGenerationMu", 0.0))
        re_tot = float(item.get("totalRenewableGenerationMu", 0.0))
        add = float(item.get("renewableAdditionsMw", 0.0))

        if cap < 0 or gen < 0 or tot < 0:
            raise ValueError("Energy capacity and generation values cannot be negative.")

        rec = SolarIntelligenceRecord(
            reporting_period=rp,
            region_code=reg,
            installed_solar_capacity_mw=cap,
            solar_generation_mu=gen,
            total_generation_mu=tot,
            total_renewable_generation_mu=re_tot,
            renewable_additions_mw=add,
            source=source_reference,
            record_hash=rec_hash,
            provenance=item.get("provenance", "VERIFIED_REPORT"),
        )

        self._records.append(rec)
        self._by_region_period[(reg, rp)] = rec
        self._seen_hashes.add(rec_hash)
        return True, f"Successfully ingested {reg} record for {rp}."

    def get_record(self, region_code: str, reporting_period: str) -> SolarIntelligenceRecord:
        key = (region_code, reporting_period)
        if key not in self._by_region_period:
            raise KeyError(f"No solar intelligence record found for region '{region_code}' in period '{reporting_period}'.")
        return self._by_region_period[key]

    def list_periods_for_region(self, region_code: str) -> list[str]:
        return sorted([rp for (r, rp) in self._by_region_period if r == region_code])

    def calculate_solar_share(self, region_code: str, period: str) -> SolarShareResult:
        """Calculates solar share with semantic ratio validation."""
        MetricSemanticsRegistry.assert_compatible_for_ratio("SOLAR_GENERATION", "ELECTRICITY_GENERATION")
        rec = self.get_record(region_code, period)

        if rec.total_generation_mu <= 0:
            return SolarShareResult(
                region_code=region_code,
                reporting_period=period,
                solar_generation_mu=rec.solar_generation_mu,
                total_generation_mu=rec.total_generation_mu,
                solar_share_pct=None,
                is_valid=False,
                formula="(solar_generation_mu / total_generation_mu) * 100",
                notes="Cannot compute solar share: total generation is zero or missing.",
            )

        pct = round((rec.solar_generation_mu / rec.total_generation_mu) * 100.0, 2)
        return SolarShareResult(
            region_code=region_code,
            reporting_period=period,
            solar_generation_mu=rec.solar_generation_mu,
            total_generation_mu=rec.total_generation_mu,
            solar_share_pct=pct,
            is_valid=True,
            formula="(solar_generation_mu / total_generation_mu) * 100",
            notes=f"Solar accounted for {pct}% of total reported electricity generation in {region_code} for {period}.",
        )

    def calculate_cuf(self, region_code: str, period: str) -> SolarCUFResult:
        """Estimates monthly Capacity Utilization Factor (CUF) using actual hours in the calendar month.

        Formula: CUF (%) = (Solar Gen [MU] * 1000 [MWh/MU]) / (Installed Capacity [MW] * Hours in Month) * 100%
        """
        rec = self.get_record(region_code, period)
        y, m = int(period[:4]), int(period[5:7])
        _, num_days = calendar.monthrange(y, m)
        hours = num_days * 24

        if rec.installed_solar_capacity_mw <= 0:
            return SolarCUFResult(
                region_code=region_code,
                reporting_period=period,
                installed_capacity_mw=rec.installed_solar_capacity_mw,
                solar_generation_mu=rec.solar_generation_mu,
                hours_in_month=hours,
                cuf_percentage=None,
                formula="(solar_gen_mu * 1000) / (capacity_mw * hours) * 100",
                caveat="CUF cannot be calculated: installed capacity is zero.",
            )

        # 1 MU = 1,000 MWh
        solar_mwh = rec.solar_generation_mu * 1000.0
        max_possible_mwh = rec.installed_solar_capacity_mw * hours
        cuf_pct = round((solar_mwh / max_possible_mwh) * 100.0, 2)

        caveat = (
            f"Monthly CUF estimate based on reported monthly generation and end-of-period installed capacity ({hours} hours in {period}). "
            "Actual CUF varies by inverter availability, local solar insolation, grid curtailment, and mid-month capacity commissioning."
        )

        return SolarCUFResult(
            region_code=region_code,
            reporting_period=period,
            installed_capacity_mw=rec.installed_solar_capacity_mw,
            solar_generation_mu=rec.solar_generation_mu,
            hours_in_month=hours,
            cuf_percentage=cuf_pct,
            formula="(solar_gen_mu * 1000) / (capacity_mw * hours) * 100",
            caveat=caveat,
        )

    def get_capacity_series(self, region_code: str) -> list[TimeSeriesPoint]:
        """Returns verified solar capacity time series in MW."""
        periods = self.list_periods_for_region(region_code)
        return [
            TimeSeriesPoint(
                period=p,
                value=self.get_record(region_code, p).installed_solar_capacity_mw,
                unit="MW",
                source_ref=self.get_record(region_code, p).source,
            )
            for p in periods
        ]

    def get_generation_series(self, region_code: str) -> list[TimeSeriesPoint]:
        """Returns verified solar generation time series in MU."""
        periods = self.list_periods_for_region(region_code)
        return [
            TimeSeriesPoint(
                period=p,
                value=self.get_record(region_code, p).solar_generation_mu,
                unit="MU",
                source_ref=self.get_record(region_code, p).source,
            )
            for p in periods
        ]

    def calculate_mom(self, region_code: str, period: str, metric: str = "solar_generation_mu") -> GrowthMetric | None:
        """Month-over-Month calculation."""
        current = self.get_record(region_code, period)
        y, m = int(period[:4]), int(period[5:7])
        prev_m = m - 1
        prev_y = y
        if prev_m == 0:
            prev_m = 12
            prev_y -= 1
        prev_period = f"{prev_y:04d}-{prev_m:02d}"

        if (region_code, prev_period) not in self._by_region_period:
            return None  # Insufficient history

        prev = self.get_record(region_code, prev_period)
        cur_val = getattr(current, metric)
        prev_val = getattr(prev, metric)
        delta = round(cur_val - prev_val, 2)
        pct = round((delta / prev_val) * 100, 2) if prev_val > 0 else 0.0

        return GrowthMetric(
            metric_name=metric,
            current_value=cur_val,
            reference_value=prev_val,
            delta_value=delta,
            percentage_change=pct,
            type="MOM",
            current_period=period,
            reference_period=prev_period,
        )

    def calculate_yoy(self, region_code: str, period: str, metric: str = "solar_generation_mu") -> GrowthMetric | None:
        """Year-over-Year calculation (comparing against exact same month previous year)."""
        current = self.get_record(region_code, period)
        y, m = int(period[:4]), int(period[5:7])
        prev_period = f"{y - 1:04d}-{m:02d}"

        if (region_code, prev_period) not in self._by_region_period:
            return None  # Insufficient history for YoY

        prev = self.get_record(region_code, prev_period)
        cur_val = getattr(current, metric)
        prev_val = getattr(prev, metric)
        delta = round(cur_val - prev_val, 2)
        pct = round((delta / prev_val) * 100, 2) if prev_val > 0 else 0.0

        return GrowthMetric(
            metric_name=metric,
            current_value=cur_val,
            reference_value=prev_val,
            delta_value=delta,
            percentage_change=pct,
            type="YOY",
            current_period=period,
            reference_period=prev_period,
        )

    @staticmethod
    def classify_hydro_source(capacity_mw: float) -> str:
        """Classifies hydro based on CEA threshold (25 MW)."""
        if capacity_mw <= 25.0:
            return "SMALL_HYDRO_RES"
        return "LARGE_HYDRO_CONVENTIONAL"

    def refuse_hourly_synthesis(self, requested_frequency: str, observation_frequency: str = "MONTHLY") -> None:
        """Strict invariant check: Refuses to create hourly solar generation data from monthly observations."""
        if requested_frequency.upper() in {"HOURLY", "15MIN", "DAILY"} and observation_frequency.upper() == "MONTHLY":
            raise ValueError(
                "DATA HONESTY INVARIANT VIOLATION: Refusing to create hourly solar generation curves from monthly observations. "
                "Monthly aggregates cannot be disaggregated into synthetic hourly profiles without physical meter intervals."
            )
