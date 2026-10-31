"""Comparative Energy Insights Engine for UrjaSetu EMS.

Generates strictly evidence-backed, deterministic analytical findings:
1. Demand changes compared to the prior year (YoY).
2. Solar generation growth and capacity utilization milestones.
3. Electricity requirement vs. supply gap findings with clear physical and accounting caveats.
4. Renewable generation share shifts.
5. Invariant enforcement: deduplication hashes prevent duplicate alerts for the same underlying event.
"""

from __future__ import annotations

import datetime
import hashlib
import json
from dataclasses import dataclass
from typing import Any

from avishkar_ems.energy_balance import EnergyBalanceAnalyzer
from avishkar_ems.generation_mix import GenerationMixEngine
from avishkar_ems.solar_intel import SolarIntelligenceEngine
from avishkar_ems.time_series_trends import TimeSeriesPoint, TimeSeriesTrendsEngine


@dataclass(frozen=True)
class EnergyInsight:
    insight_id: str
    insight_type: str  # "DEMAND_YOY_GROWTH", "SOLAR_YOY_GROWTH", "SUPPLY_GAP", "RE_SHARE_MILESTONE"
    title: str
    plain_language_explanation: str
    geographic_scope: str
    comparison_period: str
    supporting_metric_values: dict[str, Any]
    source_observation_references: list[str]
    calculation_method: str
    data_freshness: str
    limitations: list[str]
    confidence: str = "HIGH"


class ComparativeEnergyInsightEngine:
    """Derives, filters, and deduplicates evidence-grounded insights across regions."""

    def __init__(
        self,
        balance_analyzer: EnergyBalanceAnalyzer | None = None,
        solar_engine: SolarIntelligenceEngine | None = None,
        mix_engine: GenerationMixEngine | None = None,
    ) -> None:
        self._balance = balance_analyzer or EnergyBalanceAnalyzer()
        self._solar = solar_engine or SolarIntelligenceEngine()
        self._mix = mix_engine or GenerationMixEngine(self._solar)
        self._seen_insight_hashes: set[str] = set()

    def _generate_insight_hash(self, insight_type: str, geo_code: str, period: str, detail: str) -> str:
        raw = f"{insight_type}:{geo_code}:{period}:{detail}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def generate_demand_growth_insights(self, geo_code: str, period: str) -> list[EnergyInsight]:
        """Evaluates Year-over-Year energy requirement growth for the given period."""
        insights: list[EnergyInsight] = []
        try:
            cur_rec = self._balance.get_record(geo_code, period)
        except KeyError:
            return insights

        # Build time series to pass to TimeSeriesTrendsEngine
        periods = self._balance.list_periods(geo_code)
        series = [
            TimeSeriesPoint(
                period=p,
                value=self._balance.get_record(geo_code, p).energy_requirement_mu,
                unit="MU",
                source_ref=cur_rec.source,
            )
            for p in periods
        ]

        yoy = TimeSeriesTrendsEngine.calculate_yoy(series, period, metric_name="Energy Requirement")
        if yoy is not None and yoy.percentage_change is not None:
            direction = "increased" if yoy.delta > 0 else "decreased"
            h = self._generate_insight_hash("DEMAND_YOY_GROWTH", geo_code, period, str(yoy.delta))
            if h not in self._seen_insight_hashes:
                self._seen_insight_hashes.add(h)
                insights.append(
                    EnergyInsight(
                        insight_id=h,
                        insight_type="DEMAND_YOY_GROWTH",
                        title=f"Electricity requirement {direction} by {abs(yoy.percentage_change):.1f}% YoY in {cur_rec.geo_name}",
                        plain_language_explanation=(
                            f"In {period}, reported electricity requirement in {cur_rec.geo_name} was {cur_rec.energy_requirement_mu:,.1f} MU, "
                            f"compared to {yoy.reference_value:,.1f} MU in {yoy.reference_period}, a net change of {yoy.delta:+,.1f} MU."
                        ),
                        geographic_scope=f"{cur_rec.geo_name} ({geo_code})",
                        comparison_period=f"{yoy.reference_period} vs {period}",
                        supporting_metric_values={
                            "currentRequirementMu": cur_rec.energy_requirement_mu,
                            "previousRequirementMu": yoy.reference_value,
                            "deltaMu": yoy.delta,
                            "percentageChange": yoy.percentage_change,
                        },
                        source_observation_references=[
                            f"{cur_rec.source}: {geo_code} {period} Requirement",
                            f"{cur_rec.source}: {geo_code} {yoy.reference_period} Requirement",
                        ],
                        calculation_method="YoY % Change = ((Current - PriorYear) / PriorYear) * 100",
                        data_freshness=datetime.datetime.now(datetime.UTC).date().isoformat(),
                        limitations=[
                            "Reflects aggregate monthly utility billing requirements reported to CEA.",
                            "Does not normalize for weather anomalies or holiday variations between years.",
                        ],
                        confidence="HIGH",
                    )
                )

        return insights

    def generate_solar_trends_insights(self, region_code: str, period: str) -> list[EnergyInsight]:
        """Evaluates Solar Generation growth and Capacity additions."""
        insights: list[EnergyInsight] = []
        try:
            cur_rec = self._solar.get_record(region_code, period)
        except KeyError:
            return insights

        yoy = self._solar.calculate_yoy(region_code, period, metric="solar_generation_mu")
        if yoy is not None and yoy.percentage_change != 0.0:
            direction = "surged" if yoy.percentage_change > 15.0 else ("increased" if yoy.delta_value > 0 else "decreased")
            h = self._generate_insight_hash("SOLAR_YOY_GROWTH", region_code, period, str(yoy.delta_value))
            if h not in self._seen_insight_hashes:
                self._seen_insight_hashes.add(h)
                insights.append(
                    EnergyInsight(
                        insight_id=h,
                        insight_type="SOLAR_YOY_GROWTH",
                        title=f"Solar generation {direction} by {abs(yoy.percentage_change):.1f}% YoY in region {region_code}",
                        plain_language_explanation=(
                            f"Solar power generation reached {cur_rec.solar_generation_mu:,.1f} MU in {period}, "
                            f"up from {yoy.reference_value:,.1f} MU in {yoy.reference_period} (delta: {yoy.delta_value:+,.1f} MU)."
                        ),
                        geographic_scope=f"Region {region_code}",
                        comparison_period=f"{yoy.reference_period} vs {period}",
                        supporting_metric_values={
                            "currentSolarGenMu": cur_rec.solar_generation_mu,
                            "priorYearSolarGenMu": yoy.reference_value,
                            "deltaMu": yoy.delta_value,
                            "percentageChange": yoy.percentage_change,
                            "installedCapacityMw": cur_rec.installed_solar_capacity_mw,
                        },
                        source_observation_references=[
                            f"{cur_rec.source}: {region_code} {period} Solar Gen",
                            f"{cur_rec.source}: {region_code} {yoy.reference_period} Solar Gen",
                        ],
                        calculation_method="YoY % Change = ((Current - PriorYear) / PriorYear) * 100",
                        data_freshness=datetime.datetime.now(datetime.UTC).date().isoformat(),
                        limitations=[
                            "Monthly solar totals include grid-synchronized rooftop and utility solar plants.",
                            "Off-grid and agricultural pump micro-installations are not captured.",
                        ],
                        confidence="HIGH",
                    )
                )

        return insights

    def generate_supply_gap_insights(self, geo_code: str, period: str) -> list[EnergyInsight]:
        """Evaluates Energy Requirement vs. Supplied gap with physical caveats."""
        insights: list[EnergyInsight] = []
        try:
            rec = self._balance.get_record(geo_code, period)
        except KeyError:
            return insights

        gap_res = self._balance.calculate_energy_gap(rec)
        h = self._generate_insight_hash("SUPPLY_GAP", geo_code, period, str(gap_res.gap_mu))
        if h in self._seen_insight_hashes:
            return insights

        self._seen_insight_hashes.add(h)

        if gap_res.gap_mu > 0.0:
            title = f"Reported energy requirement exceeded supply by {gap_res.gap_mu:,.1f} MU in {rec.geo_name}"
            expl = (
                f"In {period}, {rec.geo_name} reported an energy requirement of {rec.energy_requirement_mu:,.1f} MU "
                f"and energy supplied of {rec.energy_supplied_mu:,.1f} MU, leaving an accounting gap of {gap_res.gap_mu:,.1f} MU ({gap_res.gap_percentage:.2f}%)."
            )
        else:
            title = f"Reported energy supply fully matched requirement in {rec.geo_name}"
            expl = (
                f"In {period}, energy supplied ({rec.energy_supplied_mu:,.1f} MU) met or exceeded reported requirement "
                f"({rec.energy_requirement_mu:,.1f} MU) in {rec.geo_name}."
            )

        insights.append(
            EnergyInsight(
                insight_id=h,
                insight_type="SUPPLY_GAP",
                title=title,
                plain_language_explanation=expl,
                geographic_scope=f"{rec.geo_name} ({geo_code})",
                comparison_period=period,
                supporting_metric_values={
                    "energyRequirementMu": rec.energy_requirement_mu,
                    "energySuppliedMu": rec.energy_supplied_mu,
                    "gapMu": gap_res.gap_mu,
                    "gapPercentage": gap_res.gap_percentage,
                },
                source_observation_references=gap_res.input_references,
                calculation_method="Energy Gap = Energy Requirement - Energy Supplied",
                data_freshness=datetime.datetime.now(datetime.UTC).date().isoformat(),
                limitations=[
                    gap_res.caveat,
                    "Does not indicate localized feeder outages or distribution transformer failures.",
                ],
                confidence="HIGH",
            )
        )

        return insights

    def generate_all_insights(self, geo_code: str, period: str) -> list[EnergyInsight]:
        """Aggregates all deterministic insights for the entity in the given period without duplication."""
        all_res: list[EnergyInsight] = []
        all_res.extend(self.generate_demand_growth_insights(geo_code, period))
        if geo_code in {"IN", "KA", "AP"}:
            all_res.extend(self.generate_solar_trends_insights(geo_code, period))
        all_res.extend(self.generate_supply_gap_insights(geo_code, period))
        return all_res

    def serialize_insights_json(self, insights: list[EnergyInsight]) -> str:
        """Serializes insights to formatted JSON string."""
        return json.dumps([i.__dict__ for i in insights], indent=2)
