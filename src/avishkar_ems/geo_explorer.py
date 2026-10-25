"""Evidence-based Geographic Energy Explorer for UrjaSetu EMS.

Enforces geographic boundary rigor across National (India), State (KA, AP),
District (e.g. Bengaluru Urban, Visakhapatnam), and Utility (DISCOM) service areas.
Strict invariants:
1. Never invent district statistics from state-level totals.
2. Never assume a utility service area has the same boundary as a district.
3. Show unavailable data explicitly rather than presenting false precision.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

ROOT_DATA = Path(__file__).resolve().parent.parent.parent / "data" / "energy_reports"


class GeoLevel(StrEnum):
    NATIONAL = "NATIONAL"
    STATE = "STATE"
    DISTRICT = "DISTRICT"
    UTILITY = "UTILITY"


@dataclass(frozen=True)
class MetricAvailability:
    metric: str
    level: GeoLevel
    status: str  # "AVAILABLE", "PERIODIC", "UNAVAILABLE"
    source: str | None = None
    reason: str | None = None


@dataclass(frozen=True)
class GeoEntity:
    code: str
    level: GeoLevel
    name: str
    parent_code: str | None = None
    served_districts: list[str] = field(default_factory=list)
    served_by_utilities: list[str] = field(default_factory=list)
    boundary_notes: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class GeoExplorer:
    """Manages spatial entities, geographic attribution, and the coverage matrix."""

    def __init__(self, data_path: Path | None = None) -> None:
        p = data_path or (ROOT_DATA / "geo_hierarchy.json")
        if not p.exists():
            raise FileNotFoundError(f"Geographic hierarchy file not found: {p}")
        self._raw = json.loads(p.read_text(encoding="utf-8"))
        self._entities: dict[str, GeoEntity] = {}
        self._coverage: dict[str, dict[GeoLevel, MetricAvailability]] = {}
        self._load()

    def _load(self) -> None:
        for code, ent in self._raw.get("entities", {}).items():
            lvl = GeoLevel(ent["level"])
            served_d = ent.get("servedDistricts", [])
            served_u = ent.get("servedByUtilities", [])
            boundary_note = ent.get("boundaryNote")
            self._entities[code] = GeoEntity(
                code=code,
                level=lvl,
                name=ent.get("name", code),
                parent_code=ent.get("parent"),
                served_districts=served_d,
                served_by_utilities=served_u,
                boundary_notes=boundary_note,
                metadata={k: v for k, v in ent.items() if k not in {"level", "name", "parent", "servedDistricts", "servedByUtilities", "boundaryNote"}},
            )

        cov = self._raw.get("coverageMatrix", {})
        for metric, levels in cov.items():
            self._coverage[metric] = {}
            for lvl_str, info in levels.items():
                lvl = GeoLevel(lvl_str)
                self._coverage[metric][lvl] = MetricAvailability(
                    metric=metric,
                    level=lvl,
                    status=info["status"],
                    source=info.get("source"),
                    reason=info.get("reason"),
                )

    def get_entity(self, code: str) -> GeoEntity:
        if code not in self._entities:
            raise KeyError(f"Geographic entity '{code}' is not recognized in hierarchy.")
        return self._entities[code]

    def list_entities(self, level: GeoLevel | None = None) -> list[GeoEntity]:
        if level is None:
            return list(self._entities.values())
        return [e for e in self._entities.values() if e.level == level]

    def get_availability(self, metric: str, level: GeoLevel) -> MetricAvailability:
        if metric not in self._coverage or level not in self._coverage[metric]:
            return MetricAvailability(
                metric=metric,
                level=level,
                status="UNAVAILABLE",
                reason=f"No coverage policy defined for {metric} at {level.value} level.",
            )
        return self._coverage[metric][level]

    def get_coverage_matrix(self) -> dict[str, dict[str, dict[str, str | None]]]:
        matrix: dict[str, dict[str, dict[str, str | None]]] = {}
        for metric, lvl_map in self._coverage.items():
            matrix[metric] = {}
            for lvl, avail in lvl_map.items():
                matrix[metric][lvl.value] = {
                    "status": avail.status,
                    "source": avail.source,
                    "reason": avail.reason,
                }
        return matrix

    def can_attribute_metric(self, metric: str, entity_code: str) -> tuple[bool, str]:
        """Validates whether a metric can legitimately be shown for a geographic entity.

        Returns (is_attributable, explanation).
        """
        ent = self.get_entity(entity_code)
        avail = self.get_availability(metric, ent.level)
        if avail.status == "AVAILABLE":
            return True, f"Attributable via {avail.source}."
        if avail.status == "PERIODIC":
            return True, f"Periodically attributable via {avail.source} (check reporting period)."
        return False, f"Metric '{metric}' is UNAVAILABLE at {ent.level.value} level: {avail.reason}"

    def verify_no_disaggregation(self, metric: str, state_code: str, district_code: str) -> bool:
        """Enforces invariant: never invent district statistics from state-level totals.

        Returns False if trying to synthesize district data from state.
        """
        st = self.get_entity(state_code)
        dist = self.get_entity(district_code)
        if st.level != GeoLevel.STATE or dist.level != GeoLevel.DISTRICT:
            raise ValueError("First entity must be STATE and second entity must be DISTRICT.")

        # Check if metric is directly available at district level
        avail = self.get_availability(metric, GeoLevel.DISTRICT)
        if avail.status == "UNAVAILABLE":
            # Disaggregation is strictly forbidden
            return False
        return True

    def are_utility_and_district_coterminous(self, utility_code: str, district_code: str) -> bool:
        """Enforces invariant: never assume a utility service area has the same boundary as a district.

        Always returns False for Indian DISCOMs unless proven with gazette boundary match.
        """
        u = self.get_entity(utility_code)
        d = self.get_entity(district_code)
        if u.level != GeoLevel.UTILITY or d.level != GeoLevel.DISTRICT:
            raise ValueError("Entities must be UTILITY and DISTRICT.")
        # Indian DISCOMs (e.g. BESCOM) span multiple districts (e.g. 8 districts)
        # and do not share identical administrative boundaries with any single district.
        return False
