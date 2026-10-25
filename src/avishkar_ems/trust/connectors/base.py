"""Base Source Connector Contract for UrjaSetu EMS.

Defines the universal lifecycle and interface for all electricity and solar data providers.
Separates retrieval, schema validation, parsing, unit normalization, geographic mapping,
provenance assignment, incremental checkpointing, and idempotent persistence.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from avishkar_ems.trust.canonical_observation import CanonicalObservation
from avishkar_ems.trust.idempotent_ingestion import (
    IdempotentIngestionEngine,
    IngestionAction,
    IngestionResult,
)
from avishkar_ems.trust.source_registry import SourceRecord


@dataclass(frozen=True)
class ConnectorHealthReport:
    source_id: str
    is_healthy: bool
    connection_status: str
    access_configured: bool
    last_verification_date: str | None
    last_successful_retrieval: datetime | None
    latency_ms: float | None
    error_message: str | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ImportSummary:
    """Standardized summary produced by each ingestion run."""

    run_id: str
    source_id: str
    status: str  # "COMPLETED", "FAILED", "PARTIAL"
    start_time: datetime
    completion_time: datetime
    duration_ms: float
    retrieved_count: int
    accepted_count: int
    rejected_count: int
    skipped_count: int
    updated_count: int
    checkpoint: str | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    diagnostics: dict[str, Any] = field(default_factory=dict)


class BaseEnergyConnector(ABC):
    """Abstract connector contract governing all external energy source integrations."""

    def __init__(self, source_record: SourceRecord):
        self.source_record = source_record
        self._checkpoint: str | None = None

    def validate_config(self) -> tuple[bool, str]:
        """Validates connector-specific configuration parameters."""
        return True, "Configuration verified."

    @abstractmethod
    def validate_access(self) -> tuple[bool, str]:
        """Verifies authentication credentials, certificates, or open access permissions."""
        ...

    @abstractmethod
    def fetch_raw(self) -> Any:
        """Retrieves raw data payload (JSON, CSV, XML, or file bytes) from the provider."""
        ...

    @abstractmethod
    def validate_schema(self, raw_data: Any) -> tuple[bool, list[str]]:
        """Validates that the received payload matches expected schema before parsing."""
        ...

    @abstractmethod
    def parse(self, raw_data: Any) -> list[dict[str, Any]]:
        """Parses the raw payload into intermediate tabular records."""
        ...

    @abstractmethod
    def normalize(self, raw_records: list[dict[str, Any]], ingestion_run_id: str) -> list[CanonicalObservation]:
        """Transforms parsed records into CanonicalObservations with strict unit & geo validation."""
        ...

    def get_checkpoint(self) -> str | None:
        """Retrieves current incremental checkpoint for this connector."""
        return self._checkpoint

    def save_checkpoint(self, checkpoint: str) -> None:
        """Saves current incremental checkpoint (e.g. latest timestamp or sequence ID)."""
        self._checkpoint = checkpoint

    def execute_with_retry(
        self,
        func: Callable[[], Any],
        max_retries: int = 3,
        base_delay_seconds: float = 0.5,
        backoff_factor: float = 2.0,
    ) -> Any:
        """Executes a function with bounded retries and exponential backoff."""
        last_exception = None
        delay = base_delay_seconds

        for attempt in range(max_retries):
            try:
                return func()
            except Exception as exc:
                last_exception = exc
                if attempt == max_retries - 1:
                    break
                time.sleep(delay)
                delay *= backoff_factor

        raise last_exception or RuntimeError("Retry attempts exhausted without result.")

    def ingest(
        self,
        engine: IdempotentIngestionEngine,
        ingestion_run_id: str | None = None,
    ) -> list[IngestionResult]:
        """Executes the complete end-to-end ingestion pipeline idempotently."""
        summary, results = self.ingest_with_summary(engine, ingestion_run_id)
        return results

    def ingest_with_summary(
        self,
        engine: IdempotentIngestionEngine,
        ingestion_run_id: str | None = None,
    ) -> tuple[ImportSummary, list[IngestionResult]]:
        """Executes end-to-end ingestion and returns both the summary and granular results."""
        start_time = datetime.now(UTC)
        run_id = ingestion_run_id or f"RUN_{start_time.strftime('%Y%m%d_%H%M%S')}"
        errors: list[str] = []
        warnings: list[str] = []

        # 1. Config & Access
        valid_cfg, cfg_msg = self.validate_config()
        if not valid_cfg:
            errors.append(f"Config error: {cfg_msg}")
            comp = datetime.now(UTC)
            return (
                ImportSummary(
                    run_id=run_id,
                    source_id=self.source_record.source_id,
                    status="FAILED",
                    start_time=start_time,
                    completion_time=comp,
                    duration_ms=(comp - start_time).total_seconds() * 1000.0,
                    retrieved_count=0,
                    accepted_count=0,
                    rejected_count=0,
                    skipped_count=0,
                    updated_count=0,
                    errors=errors,
                    warnings=warnings,
                ),
                [],
            )

        has_access, reason = self.validate_access()
        if not has_access:
            errors.append(f"Access check failed: {reason}")
            comp = datetime.now(UTC)
            return (
                ImportSummary(
                    run_id=run_id,
                    source_id=self.source_record.source_id,
                    status="FAILED",
                    start_time=start_time,
                    completion_time=comp,
                    duration_ms=(comp - start_time).total_seconds() * 1000.0,
                    retrieved_count=0,
                    accepted_count=0,
                    rejected_count=0,
                    skipped_count=0,
                    updated_count=0,
                    errors=errors,
                    warnings=warnings,
                ),
                [],
            )

        # 2. Fetch
        try:
            raw_data = self.fetch_raw()
        except Exception as exc:
            errors.append(f"Fetch failed: {exc}")
            comp = datetime.now(UTC)
            return (
                ImportSummary(
                    run_id=run_id,
                    source_id=self.source_record.source_id,
                    status="FAILED",
                    start_time=start_time,
                    completion_time=comp,
                    duration_ms=(comp - start_time).total_seconds() * 1000.0,
                    retrieved_count=0,
                    accepted_count=0,
                    rejected_count=0,
                    skipped_count=0,
                    updated_count=0,
                    errors=errors,
                    warnings=warnings,
                ),
                [],
            )

        # 3. Schema
        valid_schema, schema_errors = self.validate_schema(raw_data)
        if not valid_schema:
            errors.extend(schema_errors)
            comp = datetime.now(UTC)
            return (
                ImportSummary(
                    run_id=run_id,
                    source_id=self.source_record.source_id,
                    status="FAILED",
                    start_time=start_time,
                    completion_time=comp,
                    duration_ms=(comp - start_time).total_seconds() * 1000.0,
                    retrieved_count=0,
                    accepted_count=0,
                    rejected_count=0,
                    skipped_count=0,
                    updated_count=0,
                    errors=errors,
                    warnings=warnings,
                ),
                [],
            )

        # 4. Parse & Normalize
        parsed_records = self.parse(raw_data)
        retrieved_count = len(parsed_records)

        canonical_observations = self.normalize(parsed_records, run_id)

        # 5. Ingest into Engine
        results = engine.ingest_batch(canonical_observations)

        accepted_count = sum(1 for r in results if r.action == IngestionAction.INSERTED_NEW)
        updated_count = sum(1 for r in results if r.action == IngestionAction.REVISED_CORRECTION)
        skipped_count = sum(1 for r in results if r.action == IngestionAction.IGNORED_DUPLICATE)
        rejected_count = sum(1 for r in results if r.action == IngestionAction.REJECTED_INVALID)

        comp = datetime.now(UTC)
        duration_ms = (comp - start_time).total_seconds() * 1000.0

        status = "COMPLETED"
        if rejected_count > 0 and accepted_count > 0:
            status = "PARTIAL"
        elif rejected_count > 0 and accepted_count == 0:
            status = "FAILED"

        summary = ImportSummary(
            run_id=run_id,
            source_id=self.source_record.source_id,
            status=status,
            start_time=start_time,
            completion_time=comp,
            duration_ms=duration_ms,
            retrieved_count=retrieved_count,
            accepted_count=accepted_count,
            rejected_count=rejected_count,
            skipped_count=skipped_count,
            updated_count=updated_count,
            checkpoint=self._checkpoint,
            errors=errors,
            warnings=warnings,
        )

        return summary, results

    @abstractmethod
    def health_check(self) -> ConnectorHealthReport:
        """Performs a lightweight probe verifying provider reachability and credential health."""
        ...
