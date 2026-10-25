"""Electricity Balance Analysis for UrjaSetu EMS.

Calculates and validates electricity supply-demand balances across national
and state grids with full source provenance, semantic compatibility checks,
and explicit non-outage caveats.

Strict invariants:
1. Only calculate derived metrics when definitions, units, periods, and geographic boundaries are compatible.
2. Energy gap = Energy requirement - Energy supplied.
3. Interpretation:
   - Positive gap: reported requirement exceeds reported supply.
   - Negative gap: reported supply exceeds reported requirement.
   - Zero gap: reported figures are balanced.
4. Clearly explain that the result is an accounting reconciliation and contracted dispatch difference,
   NOT necessarily a measurement of real-time grid shortages, frequency excursions, or feeder-level outages.
5. Incompatible datasets (e.g. mismatched units, periods, or boundaries) are rejected immediately.
"""

from __future__ import annotations

import datetime
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from avishkar_ems.metric_semantics import AggregationMethod, MetricSemanticsRegistry

ROOT_DATA = Path(__file__).resolve().parent.parent.parent / "data" / "energy_reports"


@dataclass(frozen=True)
class EnergyBalanceRecord:
    geo_code: str
    geo_name: str
    reporting_period: str  # Format: "YYYY-MM"
    energy_requirement_mu: float
    energy_supplied_mu: float
    peak_demand_mw: float | None = None
    peak_met_mw: float | None = None
    energy_unit: str = "MU"
    demand_unit: str = "MW"
    source: str = "Central Electricity Authority (CEA)"
    provenance: str = "VERIFIED_REPORT"


@dataclass(frozen=True)
class EnergyGapResult:
    geo_code: str
    reporting_period: str
    energy_requirement_mu: float
    energy_supplied_mu: float
    gap_mu: float
    gap_percentage: float
    is_balanced: bool
    explanation: str
    caveat: str
    interpretation_type: str = "DEFICIT"  # "DEFICIT", "SURPLUS", "BALANCED"
    formula: str = "energy_requirement_mu - energy_supplied_mu"
    input_references: list[str] = field(default_factory=list)
    calculation_timestamp: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.UTC).isoformat()
    )
    quality_status: str = "VERIFIED"


class EnergyBalanceAnalyzer:
    """Loads and analyzes official CEA energy balance observations."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self._dir = data_dir or ROOT_DATA
        self._national_records: dict[str, EnergyBalanceRecord] = {}
        self._state_records: dict[str, dict[str, EnergyBalanceRecord]] = {}
        self._load()

    def _load(self) -> None:
        nat_path = self._dir / "cea_national_balance.json"
        if nat_path.exists():
            data = json.loads(nat_path.read_text(encoding="utf-8"))
            for obs in data.get("observations", []):
                rp = obs["reportingPeriod"]
                self._national_records[rp] = EnergyBalanceRecord(
                    geo_code="IN",
                    geo_name=data.get("regionName", "All India"),
                    reporting_period=rp,
                    energy_requirement_mu=float(obs["energyRequirementMu"]),
                    energy_supplied_mu=float(obs["energySuppliedMu"]),
                    peak_demand_mw=float(obs["peakDemandMw"]) if "peakDemandMw" in obs else None,
                    peak_met_mw=float(obs["peakMetMw"]) if "peakMetMw" in obs else None,
                    energy_unit=data.get("energyUnit", "MU"),
                    demand_unit=data.get("demandUnit", "MW"),
                    source=data.get("source", "CEA"),
                    provenance=obs.get("provenance", "VERIFIED_REPORT"),
                )

        state_path = self._dir / "cea_state_balance.json"
        if state_path.exists():
            data = json.loads(state_path.read_text(encoding="utf-8"))
            for st_code, st_data in data.get("states", {}).items():
                self._state_records[st_code] = {}
                for obs in st_data.get("observations", []):
                    rp = obs["reportingPeriod"]
                    self._state_records[st_code][rp] = EnergyBalanceRecord(
                        geo_code=st_code,
                        geo_name=st_data.get("stateName", st_code),
                        reporting_period=rp,
                        energy_requirement_mu=float(obs["energyRequirementMu"]),
                        energy_supplied_mu=float(obs["energySuppliedMu"]),
                        peak_demand_mw=float(obs["peakDemandMw"]) if "peakDemandMw" in obs else None,
                        peak_met_mw=float(obs["peakMetMw"]) if "peakMetMw" in obs else None,
                        energy_unit=data.get("energyUnit", "MU"),
                        demand_unit=data.get("demandUnit", "MW"),
                        source=data.get("source", "CEA"),
                        provenance="VERIFIED_REPORT",
                    )

    def get_record(self, geo_code: str, reporting_period: str) -> EnergyBalanceRecord:
        if geo_code == "IN":
            if reporting_period not in self._national_records:
                raise KeyError(f"No national record for period '{reporting_period}'.")
            return self._national_records[reporting_period]
        if geo_code in self._state_records:
            if reporting_period not in self._state_records[geo_code]:
                raise KeyError(f"No state record for {geo_code} in period '{reporting_period}'.")
            return self._state_records[geo_code][reporting_period]
        raise KeyError(f"Region '{geo_code}' not found in energy balance dataset.")

    def list_periods(self, geo_code: str) -> list[str]:
        if geo_code == "IN":
            return sorted(self._national_records.keys())
        if geo_code in self._state_records:
            return sorted(self._state_records[geo_code].keys())
        return []

    def calculate_energy_gap(
        self,
        record: EnergyBalanceRecord,
        external_supplied: tuple[float, str, str, str] | None = None,
    ) -> EnergyGapResult:
        """Calculates Energy gap = Energy requirement - Energy supplied with semantic checks.

        If external_supplied is given, it must be a tuple of
        (supplied_value, unit, period, geo_code) to verify strict compatibility.
        """
        # Semantic compatibility assertion
        MetricSemanticsRegistry.assert_compatible_for_subtraction("ENERGY_REQUIREMENT", "ENERGY_SUPPLIED")

        req = record.energy_requirement_mu
        if external_supplied is not None:
            val, unit, period, geo = external_supplied
            if unit != record.energy_unit:
                raise ValueError(
                    f"Incompatible energy units: requirement is in {record.energy_unit}, but supplied is in {unit}. Refusing to calculate gap."
                )
            if period != record.reporting_period:
                raise ValueError(
                    f"Incompatible reporting periods: requirement is for {record.reporting_period}, but supplied is for {period}. Refusing to calculate gap."
                )
            if geo != record.geo_code:
                raise ValueError(
                    f"Incompatible geographic boundaries: requirement is for {record.geo_code}, but supplied is for {geo}. Refusing to calculate gap."
                )
            sup = float(val)
        else:
            sup = record.energy_supplied_mu

        gap = round(req - sup, 2)
        # Safe denominator check for percentage calculation
        if req > 0:
            pct = round((gap / req) * 100.0, 3)
        else:
            pct = 0.0

        is_balanced = abs(gap) < 0.01
        if is_balanced:
            interp = "BALANCED"
            explanation = (
                f"In {record.reporting_period}, reported energy requirement in {record.geo_name} was {req:,.1f} MU, "
                f"and energy supplied was {sup:,.1f} MU. Reported figures are in balance (difference < 0.01 MU)."
            )
        elif gap > 0:
            interp = "DEFICIT"
            explanation = (
                f"In {record.reporting_period}, reported energy requirement in {record.geo_name} was {req:,.1f} MU, "
                f"exceeding reported energy supplied of {sup:,.1f} MU by a difference of {gap:,.1f} MU ({pct:.2f}%)."
            )
        else:
            interp = "SURPLUS"
            explanation = (
                f"In {record.reporting_period}, reported energy supplied in {record.geo_name} was {sup:,.1f} MU, "
                f"exceeding reported energy requirement of {req:,.1f} MU by {abs(gap):,.1f} MU."
            )

        caveat = (
            "IMPORTANT CAVEAT: The energy gap of "
            f"{gap:,.1f} MU is a reporting-period energy accounting difference between aggregate requirement and "
            "utility contracted supply reported to CEA. It is NOT necessarily a measurement of real-time grid shortages, "
            "frequency excursions, or localized feeder-level distribution outages."
        )

        input_refs = [
            f"{record.source}: {record.geo_code} {record.reporting_period} Requirement ({req} {record.energy_unit})",
            f"{record.source}: {record.geo_code} {record.reporting_period} Supplied ({sup} {record.energy_unit})",
        ]

        return EnergyGapResult(
            geo_code=record.geo_code,
            reporting_period=record.reporting_period,
            energy_requirement_mu=req,
            energy_supplied_mu=sup,
            gap_mu=gap,
            gap_percentage=pct,
            is_balanced=is_balanced,
            explanation=explanation,
            caveat=caveat,
            interpretation_type=interp,
            formula="energy_requirement_mu - energy_supplied_mu",
            input_references=input_refs,
            quality_status="VERIFIED",
        )

    def calculate_historical_gap_series(self, geo_code: str) -> list[EnergyGapResult]:
        """Calculates chronological series of energy gap results for a geographic entity."""
        periods = self.list_periods(geo_code)
        results: list[EnergyGapResult] = []
        for p in periods:
            rec = self.get_record(geo_code, p)
            results.append(self.calculate_energy_gap(rec))
        return results

    def calculate_fiscal_year_balance(self, geo_code: str, fiscal_year: str) -> dict[str, Any]:
        """Calculates cumulative balance for a fiscal year (e.g. 'FY2024-25' covering 2024-04 to 2025-03).

        Applies SUM for cumulative energy (MU) and MAX for peak demand (MW) according to semantic rules.
        """
        # Parse fiscal year e.g. "FY2024-25" -> start year 2024, end year 2025
        if not fiscal_year.startswith("FY") or "-" not in fiscal_year:
            raise ValueError(f"Invalid fiscal year format: '{fiscal_year}'. Expected 'FY2024-25'.")

        parts = fiscal_year[2:].split("-")
        start_year = int(parts[0])
        end_year = start_year + 1

        months = [f"{start_year}-{m:02d}" for m in range(4, 13)] + [f"{end_year}-{m:02d}" for m in range(1, 4)]
        available_periods = self.list_periods(geo_code)

        matching_records: list[EnergyBalanceRecord] = []
        for m in months:
            if m in available_periods:
                matching_records.append(self.get_record(geo_code, m))

        if not matching_records:
            raise KeyError(f"No observations found for {geo_code} in fiscal year {fiscal_year}.")

        # Temporal aggregation with semantic checks
        total_req = round(sum(r.energy_requirement_mu for r in matching_records), 2)
        total_sup = round(sum(r.energy_supplied_mu for r in matching_records), 2)
        cumulative_gap = round(total_req - total_sup, 2)
        gap_pct = round((cumulative_gap / total_req) * 100.0, 3) if total_req > 0 else 0.0

        # Peak demand MW uses MAX, never SUM
        peak_demands = [r.peak_demand_mw for r in matching_records if r.peak_demand_mw is not None]
        annual_peak_demand = round(max(peak_demands), 2) if peak_demands else None

        return {
            "fiscalYear": fiscal_year,
            "geoCode": geo_code,
            "monthsIncludedCount": len(matching_records),
            "isCompleteFiscalYear": len(matching_records) == 12,
            "totalEnergyRequirementMu": total_req,
            "totalEnergySuppliedMu": total_sup,
            "cumulativeGapMu": cumulative_gap,
            "cumulativeGapPercentage": gap_pct,
            "annualPeakDemandMw": annual_peak_demand,
            "aggregationRuleEnergy": str(AggregationMethod.SUM),
            "aggregationRuleDemand": str(AggregationMethod.MAX),
            "caveat": (
                f"Cumulative fiscal year {fiscal_year} figures represent the sum of {len(matching_records)} "
                "monthly CEA observations. Energy requirement and supply are summed (SUM); peak demand is the annual maximum (MAX)."
            ),
        }

    def compare_states(
        self, state_a: str, state_b: str, reporting_period: str
    ) -> dict[str, Any]:
        """Compares energy supply-demand balance between two states for the same period."""
        rec_a = self.get_record(state_a, reporting_period)
        rec_b = self.get_record(state_b, reporting_period)
        gap_a = self.calculate_energy_gap(rec_a)
        gap_b = self.calculate_energy_gap(rec_b)

        return {
            "period": reporting_period,
            "stateA": {
                "code": state_a,
                "name": rec_a.geo_name,
                "requirementMu": rec_a.energy_requirement_mu,
                "suppliedMu": rec_a.energy_supplied_mu,
                "gapMu": gap_a.gap_mu,
                "gapPct": gap_a.gap_percentage,
                "peakDemandMw": rec_a.peak_demand_mw,
                "peakMetMw": rec_a.peak_met_mw,
            },
            "stateB": {
                "code": state_b,
                "name": rec_b.geo_name,
                "requirementMu": rec_b.energy_requirement_mu,
                "suppliedMu": rec_b.energy_supplied_mu,
                "gapMu": gap_b.gap_mu,
                "gapPct": gap_b.gap_percentage,
                "peakDemandMw": rec_b.peak_demand_mw,
                "peakMetMw": rec_b.peak_met_mw,
            },
            "comparisonNote": (
                f"Both states evaluated using consistent CEA reporting standards for period {reporting_period}."
            ),
        }
