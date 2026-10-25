"""Geographic Data Integrity and Canonical Boundary Resolver for UrjaSetu EMS.

Enforces geographic attribution across India, States, Districts, Utilities, and Households.
Strict invariants:
1. Distinguish Bengaluru Urban District, Bengaluru Rural District, and BESCOM territory.
2. Prevent state totals from appearing as district measurements.
3. Prevent utility service-area data from being attributed to an entire district.
4. Never derive district-level consumption by arbitrarily dividing state totals.
5. Preserve unknown or ambiguous geographic attribution rather than guessing.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class CanonicalGeoLevel(StrEnum):
    NATIONAL = "NATIONAL"
    STATE = "STATE"
    DISTRICT = "DISTRICT"
    UTILITY = "UTILITY"
    HOUSEHOLD = "HOUSEHOLD"


@dataclass(frozen=True)
class CanonicalGeoEntity:
    canonical_id: str
    level: CanonicalGeoLevel
    official_name: str
    state_code: str | None
    parent_id: str | None
    served_by_utilities: list[str]
    served_districts: list[str]
    aliases: list[str]
    census_code: str | None = None
    notes: str | None = None

    @property
    def entity_id(self) -> str:
        return self.canonical_id

    @property
    def parent_entity_id(self) -> str | None:
        return self.parent_id


# Authoritative entity catalog
AUTHORITATIVE_ENTITIES: dict[str, CanonicalGeoEntity] = {
    "IN": CanonicalGeoEntity(
        canonical_id="IN",
        level=CanonicalGeoLevel.NATIONAL,
        official_name="Republic of India",
        state_code=None,
        parent_id=None,
        served_by_utilities=[],
        served_districts=[],
        aliases=["INDIA", "ALL INDIA", "BHARAT", "NATIONAL"],
    ),
    "KA": CanonicalGeoEntity(
        canonical_id="KA",
        level=CanonicalGeoLevel.STATE,
        official_name="State of Karnataka",
        state_code="KA",
        parent_id="IN",
        served_by_utilities=["BESCOM", "HESCOM", "GESCOM", "MESCOM", "CESC"],
        served_districts=["KA_BLR_URBAN", "KA_BLR_RURAL", "KA_MYSURU", "KA_TUMAKURU"],
        aliases=["KARNATAKA", "KA STATE"],
    ),
    "AP": CanonicalGeoEntity(
        canonical_id="AP",
        level=CanonicalGeoLevel.STATE,
        official_name="State of Andhra Pradesh",
        state_code="AP",
        parent_id="IN",
        served_by_utilities=["APEPDCL", "APSPDCL", "APCPDCL"],
        served_districts=["AP_VSKP", "AP_KRISHNA", "AP_GUNTUR", "AP_KURNOOL"],
        aliases=["ANDHRA PRADESH", "AP STATE", "ANDHRA"],
    ),
    "KA_BLR_URBAN": CanonicalGeoEntity(
        canonical_id="KA_BLR_URBAN",
        level=CanonicalGeoLevel.DISTRICT,
        official_name="Bengaluru Urban Revenue District",
        state_code="KA",
        parent_id="KA",
        served_by_utilities=["BESCOM"],
        served_districts=[],
        aliases=["BANGALORE URBAN", "BENGALURU URBAN", "BANGALORE", "BLR URBAN", "BLR"],
        census_code="572",
        notes="Administrative revenue district. Does not include Bengaluru Rural.",
    ),
    "KA_BLR_RURAL": CanonicalGeoEntity(
        canonical_id="KA_BLR_RURAL",
        level=CanonicalGeoLevel.DISTRICT,
        official_name="Bengaluru Rural Revenue District",
        state_code="KA",
        parent_id="KA",
        served_by_utilities=["BESCOM"],
        served_districts=[],
        aliases=["BANGALORE RURAL", "BENGALURU RURAL", "BLR RURAL"],
        census_code="571",
    ),
    "AP_VSKP": CanonicalGeoEntity(
        canonical_id="AP_VSKP",
        level=CanonicalGeoLevel.DISTRICT,
        official_name="Visakhapatnam District",
        state_code="AP",
        parent_id="AP",
        served_by_utilities=["APEPDCL"],
        served_districts=[],
        aliases=["VISAKHAPATNAM", "VIZAG", "VSKP"],
        census_code="510",
    ),
    "BESCOM": CanonicalGeoEntity(
        canonical_id="BESCOM",
        level=CanonicalGeoLevel.UTILITY,
        official_name="Bangalore Electricity Supply Company Limited",
        state_code="KA",
        parent_id="KA",
        served_by_utilities=[],
        served_districts=["KA_BLR_URBAN", "KA_BLR_RURAL", "Chikkaballapura", "Kolar", "Davanagere", "Tumakuru", "Chitradurga", "Ramanagara"],
        aliases=["BESCOM", "BANGALORE ESCOM"],
        notes="Operates across 8 districts. Sales figures cannot be attributed to Bengaluru Urban district alone.",
    ),
    "APEPDCL": CanonicalGeoEntity(
        canonical_id="APEPDCL",
        level=CanonicalGeoLevel.UTILITY,
        official_name="Eastern Power Distribution Company of Andhra Pradesh Limited",
        state_code="AP",
        parent_id="AP",
        served_by_utilities=[],
        served_districts=["AP_VSKP", "Srikakulam", "Vizianagaram", "East Godavari", "West Godavari"],
        aliases=["APEPDCL", "EASTERN POWER AP"],
        notes="Operates across 5 coastal districts including Visakhapatnam.",
    ),
}


class GeographicIntegrityResolver:
    """Resolves and validates geographic scopes with strict boundary safeguards."""

    def __init__(self) -> None:
        self._alias_map: dict[str, str] = {}
        for cid, ent in AUTHORITATIVE_ENTITIES.items():
            self._alias_map[cid.upper()] = cid
            self._alias_map[ent.official_name.upper()] = cid
            for a in ent.aliases:
                self._alias_map[a.upper()] = cid

    def resolve_entity(self, raw_identifier: str, expected_level: CanonicalGeoLevel | None = None) -> CanonicalGeoEntity:
        clean = raw_identifier.strip().upper()
        if clean not in self._alias_map:
            raise KeyError(
                f"GEOGRAPHIC RESOLUTION FAILURE: '{raw_identifier}' is not a recognized canonical entity. "
                "Fuzzy matching is prohibited to prevent false boundary attribution."
            )

        cid = self._alias_map[clean]
        ent = AUTHORITATIVE_ENTITIES[cid]

        if expected_level and ent.level != expected_level:
            raise ValueError(
                f"GEOGRAPHIC LEVEL MISMATCH: Expected entity at '{expected_level.value}' level, "
                f"but resolved '{raw_identifier}' to '{ent.official_name}' which is at '{ent.level.value}' level."
            )

        return ent

    def validate_metric_attribution(self, metric: str, entity_id: str, is_state_total: bool = False) -> None:
        """Validates that a metric can legitimately be attributed to this geographic entity."""
        ent = self.resolve_entity(entity_id)

        # Invariant: State total cannot appear as district measurement
        if is_state_total and ent.level == CanonicalGeoLevel.DISTRICT:
            raise ValueError(
                f"DATA INTEGRITY VIOLATION: Refusing to attribute state-level total to district '{ent.official_name}'. "
                "Deriving district-level figures by arbitrarily dividing state totals is strictly prohibited."
            )

        # Invariant: Utility sales cannot appear as district measurement
        if ent.level == CanonicalGeoLevel.UTILITY and "DISTRICT" in metric.upper():
            raise ValueError(
                f"BOUNDARY INTEGRITY VIOLATION: Utility '{ent.canonical_id}' serves multiple districts ({', '.join(ent.served_districts[:3])}...). "
                "Utility-level metrics cannot be attributed to an individual district."
            )

    def is_district_in_utility(self, district_id: str, utility_id: str) -> bool:
        dist = self.resolve_entity(district_id, CanonicalGeoLevel.DISTRICT)
        u = self.resolve_entity(utility_id, CanonicalGeoLevel.UTILITY)
        return dist.canonical_id in u.served_districts or any(dist.canonical_id.endswith(d) for d in u.served_districts)


# Backward-compatible alias
GeoLevel = CanonicalGeoLevel


class CanonicalEntityCatalog:
    """Catalog of canonical geographic entities."""

    @staticmethod
    def get_entity(entity_id: str) -> CanonicalGeoEntity | None:
        clean = entity_id.strip().upper()
        if clean in AUTHORITATIVE_ENTITIES:
            return AUTHORITATIVE_ENTITIES[clean]
        resolver = GeographicIntegrityResolver()
        try:
            return resolver.resolve_entity(entity_id)
        except (KeyError, ValueError):
            return None

    @staticmethod
    def list_entities() -> list[CanonicalGeoEntity]:
        return list(AUTHORITATIVE_ENTITIES.values())

    @classmethod
    def list_all(cls) -> list[CanonicalGeoEntity]:
        return cls.list_entities()


class GeoAliasResolver:
    """Resolves colloquial, historic, or abbreviation strings to canonical entity IDs."""

    @staticmethod
    def resolve(name: str) -> str | None:
        clean = name.strip().upper()
        resolver = GeographicIntegrityResolver()
        try:
            ent = resolver.resolve_entity(clean)
            return ent.canonical_id
        except (KeyError, ValueError):
            return None


class AntiDisaggregationGuard:
    """Prevents synthetic downscaling of national/state metrics to districts."""

    @staticmethod
    def assert_no_synthetic_disaggregation(
        source_level: str,
        target_level: str,
        target_entity_id: str,
        has_direct_observations: bool = False,
    ) -> None:
        if source_level.upper() in {"NATIONAL", "STATE"} and target_level.upper() == "DISTRICT":
            if not has_direct_observations:
                raise ValueError(
                    f"Synthetic disaggregation forbidden: Cannot disaggregate {source_level} totals to "
                    f"district '{target_entity_id}' without verified direct observations!"
                )


class CoverageMatrixChecker:
    """Audits metric availability across geographic hierarchy tiers."""

    @staticmethod
    def is_metric_available(entity_id: str, metric_id: str) -> bool:
        ent = CanonicalEntityCatalog.get_entity(entity_id)
        if not ent:
            return False
        if ent.level in {CanonicalGeoLevel.NATIONAL, CanonicalGeoLevel.STATE}:
            return metric_id in {
                "ENERGY_REQUIREMENT_MU",
                "ENERGY_SUPPLIED_MU",
                "PEAK_DEMAND_MW",
                "SOLAR_CAPACITY_MW",
                "SOLAR_GENERATION_MU",
                "TOTAL_GENERATION_MU",
                "RENEWABLE_GENERATION_MU",
            }
        if ent.level == CanonicalGeoLevel.DISTRICT:
            return metric_id in {"ANNUAL_DISTRICT_CONSUMPTION_MU"}
        if ent.level == CanonicalGeoLevel.UTILITY:
            return metric_id in {"HOUSEHOLD_CONSUMPTION_KWH", "BILLED_UNITS_KWH"}
        return False
