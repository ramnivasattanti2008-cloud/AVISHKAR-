"""Coverage-Aware Geographic Analytics Service for UrjaSetu EMS.

Bridges the 5-tier geographic hierarchy (National, State, District, Utility, Household)
with the Metric Semantics Registry.

Strict invariants:
1. If data exists only at state level, do not render it as a district measurement.
2. If Bengaluru Urban District and BESCOM service-area data have different boundaries,
   label both accurately and prohibit synthetic downscaling.
3. Tell the frontend and API explicitly which metrics can and cannot be displayed for each entity.
4. Reject incompatible geographic queries with actionable explanations rather than returning synthetic zeroes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from avishkar_ems.geo_explorer import GeoExplorer, GeoLevel
from avishkar_ems.metric_semantics import MetricCompatibilityError, MetricSemanticsRegistry


@dataclass(frozen=True)
class SupportedMetricInfo:
    metric_id: str
    metric_name: str
    unit: str
    status: str  # "AVAILABLE", "PERIODIC", "UNAVAILABLE"
    source_authority: str
    cadence: str
    explanation: str


@dataclass(frozen=True)
class CoverageAwareMetricResponse:
    entity_code: str
    entity_name: str
    entity_level: str
    parent_code: str | None
    supported_metrics: list[SupportedMetricInfo]
    unavailable_metrics: list[SupportedMetricInfo]
    boundary_caveats: list[str]


class GeographicAnalyticsService:
    """Provides coverage-aware metric discovery and boundary reconciliation across regions."""

    def __init__(self, geo_explorer: GeoExplorer | None = None) -> None:
        self._geo = geo_explorer or GeoExplorer()

    def get_supported_metrics_for_entity(self, entity_code: str) -> CoverageAwareMetricResponse:
        """Determines exactly which canonical metrics are available for the selected entity."""
        ent = self._geo.get_entity(entity_code)
        canonical_metrics = MetricSemanticsRegistry.list_metrics()

        supported: list[SupportedMetricInfo] = []
        unavailable: list[SupportedMetricInfo] = []

        for m in canonical_metrics:
            is_attributable, reason = self._geo.can_attribute_metric(m.metric_id, entity_code)
            cadence_str = ", ".join([c.value for c in m.supported_cadences])

            if is_attributable:
                supported.append(
                    SupportedMetricInfo(
                        metric_id=m.metric_id,
                        metric_name=m.metric_name,
                        unit=m.unit,
                        status="AVAILABLE",
                        source_authority=m.source_authority,
                        cadence=cadence_str,
                        explanation=reason,
                    )
                )
            else:
                unavailable.append(
                    SupportedMetricInfo(
                        metric_id=m.metric_id,
                        metric_name=m.metric_name,
                        unit=m.unit,
                        status="UNAVAILABLE",
                        source_authority=m.source_authority,
                        cadence=cadence_str,
                        explanation=reason,
                    )
                )

        caveats: list[str] = []
        if ent.boundary_notes:
            caveats.append(ent.boundary_notes)

        if ent.level == GeoLevel.DISTRICT:
            caveats.append(
                "DATA HONESTY INVARIANT: District-level statistics are only reported when published directly by district "
                "authorities or the national rooftop portal. State-level CEA observations are never allocated synthetically to districts."
            )
        elif ent.level == GeoLevel.UTILITY:
            caveats.append(
                f"Utility territory notice: {ent.name} serves multiple revenue districts. Utility sales cannot be equated with any single district."
            )

        return CoverageAwareMetricResponse(
            entity_code=ent.code,
            entity_name=ent.name,
            entity_level=ent.level.value,
            parent_code=ent.parent_code,
            supported_metrics=supported,
            unavailable_metrics=unavailable,
            boundary_caveats=caveats,
        )

    def assert_metric_supported(self, metric_name: str, entity_code: str) -> None:
        """Asserts that a metric is supported for the geographic entity, raising MetricCompatibilityError if not."""
        ent = self._geo.get_entity(entity_code)
        is_attributable, reason = self._geo.can_attribute_metric(metric_name, entity_code)
        if not is_attributable:
            raise MetricCompatibilityError(
                metric_a=metric_name,
                metric_b=entity_code,
                reason=f"Metric '{metric_name}' is not attributable to {ent.name} ({ent.level.value}). {reason}",
                guidance=f"Select an entity at a supported geographic level or query one of the supported metrics for {entity_code}.",
            )

    def explain_boundary_distinction(self, entity_code: str) -> dict[str, Any]:
        """Provides explicit boundary relationships between districts and utility service territories."""
        ent = self._geo.get_entity(entity_code)
        if entity_code == "KA_BLR_URBAN":
            return {
                "entityCode": entity_code,
                "name": ent.name,
                "type": "DISTRICT",
                "servedByUtilities": ent.served_by_utilities,
                "relationshipSummary": (
                    "Bengaluru Urban is a revenue district with census code 572. It is one of eight districts served by BESCOM. "
                    "BESCOM total utility sales are broader than Bengaluru Urban District consumption."
                ),
                "isUtilityCoterminous": False,
            }
        elif entity_code == "BESCOM":
            return {
                "entityCode": entity_code,
                "name": ent.name,
                "type": "UTILITY",
                "servedDistricts": ent.served_districts,
                "relationshipSummary": (
                    "BESCOM operates across 8 districts: Bengaluru Urban, Bengaluru Rural, Chikkaballapura, Kolar, Davanagere, "
                    "Chitradurga, Shivamogga, and Ramanagara. Its regulatory tariff filings encompass all 8 districts."
                ),
                "isDistrictCoterminous": False,
            }
        elif entity_code == "AP_VSKP":
            return {
                "entityCode": entity_code,
                "name": ent.name,
                "type": "DISTRICT",
                "servedByUtilities": ent.served_by_utilities,
                "relationshipSummary": (
                    "Visakhapatnam is a coastal district in Andhra Pradesh. It is served by APEPDCL, whose service area extends across 5 districts."
                ),
                "isUtilityCoterminous": False,
            }
        else:
            return {
                "entityCode": entity_code,
                "name": ent.name,
                "type": ent.level.value,
                "relationshipSummary": ent.boundary_notes or f"Geographic entity {ent.name} at {ent.level.value} level.",
                "isCoterminous": True,
            }
