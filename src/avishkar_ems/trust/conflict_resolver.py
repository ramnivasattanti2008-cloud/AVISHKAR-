"""Data Quality, Conflict Resolution, and Multi-Source Precedence Engine for UrjaSetu EMS.

Governs detection and resolution of conflicting observations across multiple independent sources
for the same metric, geographic entity, and reporting period.
Strict invariants:
1. Never arbitrarily overwrite conflicting observations from competing sources.
2. Use an explicit, documented source-precedence hierarchy.
3. Retain competing observations with explicit provenance and quality metadata.
4. Distinguish acceptable rounding variances (<= 1%) from material discrepancies (> 1%).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    QualityStatus,
)

# Source Precedence Tiers (higher integer = higher precedence)
SOURCE_PRECEDENCE_TIERS: dict[str, int] = {
    "CEA_POWER_SUPPLY_POSITION": 100,  # Central Electricity Authority statutory monthly reports
    "CEA_RENEWABLE_GENERATION": 100,  # CEA & MNRE official renewable energy generation
    "KERC_TARIFF_ORDER": 95,  # State electricity regulatory commission orders
    "APERC_TARIFF_ORDER": 95,
    "BESCOM_MITHRA_API": 90,  # Direct DISCOM operating telemetry
    "APEPDCL_CONSUMER_SERVICES": 90,
    "NPP_GENERATION_DASHBOARD": 80,  # Ministry of Power national dashboard
    "NPP_DAILY_OUTTURN": 80,
    "KARNATAKA_OPEN_DATA": 70,  # State open government data portals
    "AP_STATE_ENERGY_STATISTICS": 70,
    "BESCOM_OPENCITY_HISTORICAL": 60,  # Verified public research datasets
    "OPEN_METEO_SOLAR": 50,  # Numerical weather & satellite models
    "NASA_POWER_SOLAR": 50,
}


class ConflictSeverity(StrEnum):
    IDENTICAL = "IDENTICAL"
    ACCEPTABLE_ROUNDING = "ACCEPTABLE_ROUNDING"
    MATERIAL_DISCREPANCY = "MATERIAL_DISCREPANCY"


@dataclass(frozen=True)
class ConflictReport:
    """Audit record capturing a detected discrepancy between two competing data sources."""

    conflict_id: str
    metric_id: str
    geographic_entity_id: str
    period_start: datetime
    period_end: datetime
    primary_source_id: str
    primary_value: float
    primary_unit: str
    secondary_source_id: str
    secondary_value: float
    secondary_unit: str
    relative_difference_pct: float
    severity: ConflictSeverity
    resolution_applied: str
    resolved_canonical_value: float
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    details: dict[str, Any] = field(default_factory=dict)


class ConflictResolver:
    """Evaluates cross-source discrepancies and reconciles them according to source precedence."""

    def __init__(self, tolerance_pct: float = 1.0):
        self.tolerance_pct = tolerance_pct
        self._recorded_conflicts: list[ConflictReport] = []

    def get_source_priority(self, source_id: str) -> int:
        """Returns numeric priority weight for a source identifier."""
        return SOURCE_PRECEDENCE_TIERS.get(source_id, 10)

    def compare_observations(
        self,
        obs_a: CanonicalObservation,
        obs_b: CanonicalObservation,
    ) -> ConflictReport | None:
        """Compares two observations sharing the same metric, entity, and period."""
        # Must match metric, entity, and period
        if (
            obs_a.metric_id != obs_b.metric_id
            or obs_a.geographic_entity_id != obs_b.geographic_entity_id
            or obs_a.reporting_period_start != obs_b.reporting_period_start
            or obs_a.reporting_period_end != obs_b.reporting_period_end
        ):
            return None

        # Determine priority
        p_a = self.get_source_priority(obs_a.source_id)
        p_b = self.get_source_priority(obs_b.source_id)

        if p_a >= p_b:
            primary, secondary = obs_a, obs_b
        else:
            primary, secondary = obs_b, obs_a

        val_p = primary.normalized_value
        val_s = secondary.normalized_value

        # Calculate relative variance
        denom = max(abs(val_p), abs(val_s), 1e-6)
        diff_pct = round((abs(val_p - val_s) / denom) * 100.0, 3)

        if diff_pct == 0.0:
            severity = ConflictSeverity.IDENTICAL
        elif diff_pct <= self.tolerance_pct:
            severity = ConflictSeverity.ACCEPTABLE_ROUNDING
        else:
            severity = ConflictSeverity.MATERIAL_DISCREPANCY

        conflict_id = f"CONF_{primary.source_id}_{secondary.source_id}_{primary.observation_id}"

        report = ConflictReport(
            conflict_id=conflict_id,
            metric_id=primary.metric_id,
            geographic_entity_id=primary.geographic_entity_id,
            period_start=primary.reporting_period_start,
            period_end=primary.reporting_period_end,
            primary_source_id=primary.source_id,
            primary_value=val_p,
            primary_unit=primary.normalized_unit,
            secondary_source_id=secondary.source_id,
            secondary_value=val_s,
            secondary_unit=secondary.normalized_unit,
            relative_difference_pct=diff_pct,
            severity=severity,
            resolution_applied=f"Precedence awarded to {primary.source_id} (Priority {max(p_a, p_b)})",
            resolved_canonical_value=val_p,
            details={
                "primary_observation_id": primary.observation_id,
                "secondary_observation_id": secondary.observation_id,
                "tolerance_threshold_pct": self.tolerance_pct,
            },
        )
        self._recorded_conflicts.append(report)
        return report

    def reconcile_batch(
        self, observations: list[CanonicalObservation]
    ) -> tuple[list[CanonicalObservation], list[ConflictReport]]:
        """Reconciles a list of observations, grouping by slot and resolving collisions."""
        # Slot key: (metric_id, geo_id, period_start, period_end)
        slots: dict[tuple[str, str, datetime, datetime], list[CanonicalObservation]] = {}
        for obs in observations:
            key = (
                obs.metric_id,
                obs.geographic_entity_id,
                obs.reporting_period_start,
                obs.reporting_period_end,
            )
            slots.setdefault(key, []).append(obs)

        resolved_observations: list[CanonicalObservation] = []
        conflicts: list[ConflictReport] = []

        for _slot_key, obs_list in slots.items():
            if len(obs_list) == 1:
                resolved_observations.append(obs_list[0])
                continue

            # Sort by precedence descending
            obs_list.sort(key=lambda o: self.get_source_priority(o.source_id), reverse=True)
            winner = obs_list[0]
            resolved_observations.append(winner)

            # Compare winner against all secondary contenders
            for sec in obs_list[1:]:
                rep = self.compare_observations(winner, sec)
                if rep:
                    conflicts.append(rep)
                    if rep.severity == ConflictSeverity.MATERIAL_DISCREPANCY:
                        # Flag secondary with explicit conflict note rather than discarding
                        sec.quality_status = QualityStatus.FLAGGED
                        sec.rejection_reason = (
                            f"Material conflict with primary source {winner.source_id} "
                            f"(diff {rep.relative_difference_pct}% > {self.tolerance_pct}%)."
                        )
                        resolved_observations.append(sec)

        return resolved_observations, conflicts

    def get_recorded_conflicts(self) -> list[ConflictReport]:
        """Returns all conflicts audited during this session."""
        return list(self._recorded_conflicts)
