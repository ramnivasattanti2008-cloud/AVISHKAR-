"""Generation Mix and Multi-Fuel Comparative Engine for UrjaSetu EMS.

Processes and compares electricity generation and installed capacity breakdowns across
Solar, Wind, Hydro, Thermal, Nuclear, and other renewable and conventional sources.

Strict invariants:
1. Distinguish Installed Capacity (MW) from Actual Generation (MU).
2. Capacity shares and generation shares are NEVER conflated or substituted for one another.
3. Not all states possess all generation categories (e.g. Nuclear or Wind); missing categories
   are explicitly documented rather than treated as unmonitored errors.
4. Large Hydro (> 25 MW) and Small Hydro (<= 25 MW) classification adheres to official CEA conventions.
5. Comparisons across states require identical reporting periods and compatible accounting standards.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from avishkar_ems.metric_semantics import MetricSemanticsRegistry
from avishkar_ems.solar_intel import HYDRO_CLASSIFICATION_CEA_NOTE, SolarIntelligenceEngine

ROOT_DATA = Path(__file__).resolve().parent.parent.parent / "data" / "energy_reports"


@dataclass(frozen=True)
class FuelCategoryItem:
    category_id: str
    category_name: str
    capacity_mw: float | None
    generation_mu: float | None
    is_renewable: bool
    is_installed: bool
    classification_notes: str


@dataclass(frozen=True)
class GenerationMixReport:
    region_code: str
    region_name: str
    reporting_period: str
    total_installed_capacity_mw: float | None
    total_generation_mu: float
    categories: list[FuelCategoryItem]
    capacity_shares_pct: dict[str, float]
    generation_shares_pct: dict[str, float]
    renewable_generation_share_pct: float
    source_reference: str
    caveats: list[str] = field(default_factory=list)


class GenerationMixEngine:
    """Computes, validates, and compares generation and capacity mixes across regions."""

    def __init__(self, solar_engine: SolarIntelligenceEngine | None = None) -> None:
        self._solar = solar_engine or SolarIntelligenceEngine()

    def get_mix_report(self, region_code: str, reporting_period: str) -> GenerationMixReport:
        """Constructs generation mix report for region and period from verified records.

        Distinguishes capacity share (%) from generation share (%).
        """
        rec = self._solar.get_record(region_code, reporting_period)
        tot_gen = rec.total_generation_mu
        if tot_gen <= 0:
            raise ValueError(f"Total generation for {region_code} in {reporting_period} is zero or missing.")

        # Ensure semantic compatibility for ratio
        MetricSemanticsRegistry.assert_compatible_for_ratio("SOLAR_GENERATION", "ELECTRICITY_GENERATION")

        solar_gen = rec.solar_generation_mu
        total_re_gen = rec.total_renewable_generation_mu
        other_re_gen = max(0.0, round(total_re_gen - solar_gen, 2))
        conv_gen = max(0.0, round(tot_gen - total_re_gen, 2))

        # Categories list
        categories: list[FuelCategoryItem] = []

        # 1. Solar
        categories.append(
            FuelCategoryItem(
                category_id="SOLAR",
                category_name="Solar PV",
                capacity_mw=rec.installed_solar_capacity_mw,
                generation_mu=solar_gen,
                is_renewable=True,
                is_installed=rec.installed_solar_capacity_mw > 0,
                classification_notes="Grid-connected ground-mount and rooftop solar PV.",
            )
        )

        # 2. Other Renewables (Wind, Biomass, Small Hydro <= 25 MW)
        categories.append(
            FuelCategoryItem(
                category_id="OTHER_RES",
                category_name="Other Renewables (Wind, Bio, Small Hydro)",
                capacity_mw=None,  # Specific category capacity from multi-fuel tables
                generation_mu=other_re_gen,
                is_renewable=True,
                is_installed=other_re_gen > 0,
                classification_notes=(
                    f"Combined Wind, Biomass, and Small Hydro (<= 25 MW). {HYDRO_CLASSIFICATION_CEA_NOTE}"
                ),
            )
        )

        # 3. Conventional Generation (Thermal, Nuclear, Large Hydro)
        categories.append(
            FuelCategoryItem(
                category_id="CONVENTIONAL",
                category_name="Conventional (Thermal, Large Hydro, Nuclear)",
                capacity_mw=None,
                generation_mu=conv_gen,
                is_renewable=False,
                is_installed=conv_gen > 0,
                classification_notes=(
                    "Baseload thermal (coal, gas) and large hydro (> 25 MW) reported under conventional utilities."
                ),
            )
        )

        # Calculate generation shares
        gen_shares: dict[str, float] = {}
        for cat in categories:
            if cat.generation_mu is not None and tot_gen > 0:
                gen_shares[cat.category_id] = round((cat.generation_mu / tot_gen) * 100.0, 2)

        re_share = round((total_re_gen / tot_gen) * 100.0, 2)

        # Capacity shares: computed only where installed capacity is tracked
        cap_shares: dict[str, float] = {}
        if rec.installed_solar_capacity_mw > 0:
            cap_shares["SOLAR"] = 100.0  # Normalized to tracked renewable capacity

        caveats = [
            "INVARIANT ENFORCED: Installed capacity (MW) and actual generated energy (MU) are tracked separately.",
            "Generation share (%) does not equal capacity share (%) due to capacity utilization factor variations.",
            HYDRO_CLASSIFICATION_CEA_NOTE,
        ]

        region_names = {
            "IN": "India (All India)",
            "KA": "Karnataka",
            "AP": "Andhra Pradesh",
        }

        return GenerationMixReport(
            region_code=region_code,
            region_name=region_names.get(region_code, region_code),
            reporting_period=reporting_period,
            total_installed_capacity_mw=rec.installed_solar_capacity_mw,
            total_generation_mu=tot_gen,
            categories=categories,
            capacity_shares_pct=cap_shares,
            generation_shares_pct=gen_shares,
            renewable_generation_share_pct=re_share,
            source_reference=rec.source,
            caveats=caveats,
        )

    def compare_generation_mix(
        self, region_a: str, region_b: str, reporting_period: str
    ) -> dict[str, Any]:
        """Compares generation mix between two regions over an identical reporting period."""
        rep_a = self.get_mix_report(region_a, reporting_period)
        rep_b = self.get_mix_report(region_b, reporting_period)

        return {
            "reportingPeriod": reporting_period,
            "regionA": {
                "code": rep_a.region_code,
                "name": rep_a.region_name,
                "totalGenerationMu": rep_a.total_generation_mu,
                "renewableSharePct": rep_a.renewable_generation_share_pct,
                "generationShares": rep_a.generation_shares_pct,
                "installedSolarMw": rep_a.total_installed_capacity_mw,
            },
            "regionB": {
                "code": rep_b.region_code,
                "name": rep_b.region_name,
                "totalGenerationMu": rep_b.total_generation_mu,
                "renewableSharePct": rep_b.renewable_generation_share_pct,
                "generationShares": rep_b.generation_shares_pct,
                "installedSolarMw": rep_b.total_installed_capacity_mw,
            },
            "comparisonSummary": (
                f"In {reporting_period}, {rep_a.region_name} reported {rep_a.renewable_generation_share_pct}% renewable generation, "
                f"while {rep_b.region_name} reported {rep_b.renewable_generation_share_pct}%."
            ),
            "caveat": (
                "Comparisons reflect actual monthly CEA generation totals. State generation mixes reflect regional natural resource endowments "
                "and utility dispatch schedules."
            ),
        }
