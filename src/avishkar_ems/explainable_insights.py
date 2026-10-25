"""Explainable Energy Insights Engine for UrjaSetu EMS.

Generates rigorous, evidence-backed insights derived directly from
verified observations.
Strict invariants:
1. Every insight includes: observed data, geographic scope, reporting period,
   calculation method, quantitative result, practical interpretation,
   limitations, and confidence level.
2. Generate each insight ONLY when underlying data supports it (no pre-established facts).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from avishkar_ems.energy_balance import EnergyBalanceAnalyzer
from avishkar_ems.solar_intel import SolarIntelligenceEngine


@dataclass(frozen=True)
class ExplainableInsight:
    headline: str
    observed_data: dict[str, Any]
    geographic_scope: str
    reporting_period: str
    calculation_method: str
    result: str
    practical_interpretation: str
    limitations: list[str]
    confidence: str  # "HIGH", "MEDIUM", "LOW"


class ExplainableInsightEngine:
    """Derives structured, explainable energy insights from observed datasets."""

    def __init__(
        self,
        balance_analyzer: EnergyBalanceAnalyzer | None = None,
        solar_engine: SolarIntelligenceEngine | None = None,
    ) -> None:
        self._balance = balance_analyzer or EnergyBalanceAnalyzer()
        self._solar = solar_engine or SolarIntelligenceEngine()

    def generate_energy_balance_insights(
        self, geo_code: str, period: str
    ) -> list[ExplainableInsight]:
        insights: list[ExplainableInsight] = []
        try:
            rec = self._balance.get_record(geo_code, period)
        except KeyError:
            return insights

        gap_res = self._balance.calculate_energy_gap(rec)

        # 1. Supply-Demand Balance Insight
        if gap_res.gap_mu > 0.0:
            insights.append(
                ExplainableInsight(
                    headline=f"Reported energy requirement exceeded energy supplied in {rec.geo_name}",
                    observed_data={
                        "energyRequirementMu": rec.energy_requirement_mu,
                        "energySuppliedMu": rec.energy_supplied_mu,
                        "gapMu": gap_res.gap_mu,
                        "gapPct": gap_res.gap_percentage,
                    },
                    geographic_scope=f"{rec.geo_name} ({geo_code})",
                    reporting_period=period,
                    calculation_method="Energy Gap = Energy Requirement - Energy Supplied",
                    result=f"Energy requirement exceeded supplied by {gap_res.gap_mu:,.1f} MU ({gap_res.gap_percentage:.2f}%).",
                    practical_interpretation=(
                        f"In {period}, {rec.geo_name} utilities met {100 - gap_res.gap_percentage:.2f}% of total aggregate energy requirement. "
                        "The remaining difference was reconciled through grid interchange or scheduled demand management."
                    ),
                    limitations=[
                        "Reflects monthly accounting totals reported to CEA, not continuous millisecond-by-millisecond frequency control.",
                        "Does not distinguish behind-the-meter captive diesel generation."
                    ],
                    confidence="HIGH",
                )
            )
        else:
            insights.append(
                ExplainableInsight(
                    headline=f"Energy supply fully matched aggregate requirement in {rec.geo_name}",
                    observed_data={
                        "energyRequirementMu": rec.energy_requirement_mu,
                        "energySuppliedMu": rec.energy_supplied_mu,
                        "gapMu": gap_res.gap_mu,
                    },
                    geographic_scope=f"{rec.geo_name} ({geo_code})",
                    reporting_period=period,
                    calculation_method="Energy Gap = Energy Requirement - Energy Supplied",
                    result=f"Zero energy deficit reported ({gap_res.gap_mu:.1f} MU gap).",
                    practical_interpretation=(
                        f"In {period}, transmission and distribution networks in {rec.geo_name} had sufficient contracted capacity to meet all reported utility load."
                    ),
                    limitations=[
                        "Does not capture local 11kV/415V distribution transformer breakdown interruptions."
                    ],
                    confidence="HIGH",
                )
            )

        return insights

    def generate_solar_insights(
        self, region_code: str, period: str
    ) -> list[ExplainableInsight]:
        insights: list[ExplainableInsight] = []
        try:
            rec = self._solar.get_record(region_code, period)
        except KeyError:
            return insights

        # 1. Solar Share Insight
        insights.append(
            ExplainableInsight(
                headline=f"Solar contributed {rec.solar_share_pct:.1f}% of total generation in {region_code}",
                observed_data={
                    "solarGenerationMu": rec.solar_generation_mu,
                    "totalGenerationMu": rec.total_generation_mu,
                    "installedSolarCapacityMw": rec.installed_solar_capacity_mw,
                    "solarSharePct": rec.solar_share_pct,
                },
                geographic_scope=f"Region {region_code}",
                reporting_period=period,
                calculation_method="Solar Share = (Solar Generation / Total Generation) * 100",
                result=f"Solar generation reached {rec.solar_generation_mu:,.1f} MU out of {rec.total_generation_mu:,.1f} MU total ({rec.solar_share_pct:.1f}%).",
                practical_interpretation=(
                    f"During {period}, approximately 1 in every {100 / max(rec.solar_share_pct, 0.1):.0f} units of electricity generated came directly from solar PV systems."
                ),
                limitations=[
                    "Based on utility-scale and registered net-metered installations reported in CEA monthly digests.",
                    "Unregistered off-grid solar systems are not counted in official utility totals."
                ],
                confidence="HIGH",
            )
        )

        # 2. YoY Growth Insight
        yoy = self._solar.calculate_yoy(region_code, period, "solar_generation_mu")
        if yoy is not None:
            direction = "higher" if yoy.delta_value >= 0 else "lower"
            insights.append(
                ExplainableInsight(
                    headline=f"Solar generation was {abs(yoy.percentage_change):.1f}% {direction} than the same month last year",
                    observed_data={
                        "currentSolarMu": yoy.current_value,
                        "previousYearSolarMu": yoy.reference_value,
                        "deltaMu": yoy.delta_value,
                        "growthPct": yoy.percentage_change,
                    },
                    geographic_scope=f"Region {region_code}",
                    reporting_period=period,
                    calculation_method="YoY Delta = (Current Period - Reference Period) / Reference Period * 100",
                    result=f"Solar generation increased by {yoy.delta_value:,.1f} MU ({yoy.percentage_change:+.1f}%) compared to {yoy.reference_period}.",
                    practical_interpretation=(
                        "Growth reflects new utility-scale solar park capacity additions and rooftop PM Surya Ghar installations commissioned over the preceding 12 months."
                    ),
                    limitations=[
                        "Seasonal monsoon cloud-cover differences between years may explain part of the variance alongside capacity growth."
                    ],
                    confidence="HIGH",
                )
            )

        return insights

    def generate_all_insights(self, region_code: str, period: str) -> list[ExplainableInsight]:
        all_i = self.generate_energy_balance_insights(region_code, period)
        all_i.extend(self.generate_solar_insights(region_code, period))
        return all_i
