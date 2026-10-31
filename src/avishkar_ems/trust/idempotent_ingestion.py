"""Idempotent Ingestion and Official Revision Tracking for UrjaSetu EMS.

Ensures that reprocessing identical source records never creates duplicates, while
systematically recording official provider revisions with full audit history.
Strict invariants:
1. Make ingestion strictly idempotent.
2. Stable composite key: source_id + metric_id + geo_id + period_start + period_end.
3. Do not deduplicate different legitimate observations simply because their values are equal.
4. When an official revision occurs, preserve prior version and document revision metadata.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum

from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    QualityStatus,
)


class IngestionAction(StrEnum):
    INSERTED_NEW = "INSERTED_NEW"
    IGNORED_DUPLICATE = "IGNORED_DUPLICATE"
    REVISED_CORRECTION = "REVISED_CORRECTION"
    REJECTED_INVALID = "REJECTED_INVALID"


@dataclass(frozen=True)
class IngestionResult:
    observation_id: str
    composite_key: str
    action: IngestionAction
    version: int
    message: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass
class VersionedObservationRecord:
    composite_key: str
    current_version: int
    current_observation: CanonicalObservation
    history: list[tuple[int, CanonicalObservation, datetime]] = field(default_factory=list)


def generate_composite_key(obs: CanonicalObservation) -> str:
    """Generates a stable, canonical composite key identifying this exact observation slot."""
    p_start = obs.reporting_period_start.strftime("%Y-%m-%d")
    p_end = obs.reporting_period_end.strftime("%Y-%m-%d")
    raw = f"{obs.source_id}:{obs.metric_id}:{obs.geographic_entity_id}:{p_start}:{p_end}:{obs.measurement_kind.value}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


class IdempotentIngestionEngine:
    """Stores observations idempotently, handling official provider revisions cleanly."""

    def __init__(self) -> None:
        self._store: dict[str, VersionedObservationRecord] = {}
        self._raw_file_hashes: set[str] = set()

    def check_file_duplicate(self, file_content_bytes: bytes) -> bool:
        """Checks if a whole raw file has already been ingested."""
        h = hashlib.sha256(file_content_bytes).hexdigest()
        if h in self._raw_file_hashes:
            return True
        self._raw_file_hashes.add(h)
        return False

    def ingest_observation(
        self,
        obs: CanonicalObservation,
        allow_official_revisions: bool = True,
    ) -> IngestionResult:
        """Idempotently ingests an observation."""
        if obs.quality_status == QualityStatus.REJECTED:
            return IngestionResult(
                observation_id=obs.observation_id,
                composite_key=generate_composite_key(obs),
                action=IngestionAction.REJECTED_INVALID,
                version=0,
                message=f"Rejected: {obs.rejection_reason or 'Failed quality checks'}",
            )

        ckey = generate_composite_key(obs)

        # 1. New Observation
        if ckey not in self._store:
            record = VersionedObservationRecord(
                composite_key=ckey,
                current_version=1,
                current_observation=obs,
                history=[(1, obs, datetime.now(UTC))],
            )
            self._store[ckey] = record
            return IngestionResult(
                observation_id=obs.observation_id,
                composite_key=ckey,
                action=IngestionAction.INSERTED_NEW,
                version=1,
                message="Observation accepted as new record.",
            )

        existing_record = self._store[ckey]
        existing_obs = existing_record.current_observation

        # 2. Duplicate Detection: Check if values and metadata are identical
        values_match = abs(existing_obs.normalized_value - obs.normalized_value) < 1e-6
        units_match = existing_obs.normalized_unit == obs.normalized_unit

        if values_match and units_match:
            return IngestionResult(
                observation_id=existing_obs.observation_id,
                composite_key=ckey,
                action=IngestionAction.IGNORED_DUPLICATE,
                version=existing_record.current_version,
                message="Identical observation already stored. Skipped duplicate import.",
            )

        # 3. Official Revision Handling
        if not allow_official_revisions:
            return IngestionResult(
                observation_id=existing_obs.observation_id,
                composite_key=ckey,
                action=IngestionAction.IGNORED_DUPLICATE,
                version=existing_record.current_version,
                message="Conflicting value detected, but revision mode is disabled.",
            )

        new_version = existing_record.current_version + 1
        now = datetime.now(UTC)

        # Preserve previous version in history
        existing_record.history.append((new_version, obs, now))
        existing_record.current_version = new_version
        existing_record.current_observation = obs

        return IngestionResult(
            observation_id=obs.observation_id,
            composite_key=ckey,
            action=IngestionAction.REVISED_CORRECTION,
            version=new_version,
            message=(
                f"Official provider revision recorded (v{new_version}). "
                f"Previous value: {existing_obs.original_value} {existing_obs.original_unit}; "
                f"Revised value: {obs.original_value} {obs.original_unit}."
            ),
        )

    def ingest(
        self,
        obs: CanonicalObservation,
        allow_official_revisions: bool = True,
    ) -> IngestionResult:
        """Alias for ingest_observation."""
        return self.ingest_observation(obs, allow_official_revisions=allow_official_revisions)

    def ingest_batch(
        self,
        observations: list[CanonicalObservation],
        allow_official_revisions: bool = True,
    ) -> list[IngestionResult]:
        """Ingests a batch of observations sequentially and returns results."""
        return [self.ingest_observation(obs, allow_official_revisions=allow_official_revisions) for obs in observations]

    def get_record(self, composite_key: str) -> VersionedObservationRecord | None:
        """Retrieves full versioned observation record for a composite key."""
        return self._store.get(composite_key)

    def get_current(self, composite_key: str) -> CanonicalObservation | None:
        rec = self._store.get(composite_key)
        return rec.current_observation if rec else None

    def get_revision_history(self, composite_key: str) -> list[tuple[int, CanonicalObservation, datetime]]:
        rec = self._store.get(composite_key)
        return list(rec.history) if rec else []

    def list_all(self) -> list[CanonicalObservation]:
        """Returns all current observations in the store."""
        return [rec.current_observation for rec in self._store.values()]

    @property
    def count(self) -> int:
        return len(self._store)

    def __len__(self) -> int:
        return len(self._store)
