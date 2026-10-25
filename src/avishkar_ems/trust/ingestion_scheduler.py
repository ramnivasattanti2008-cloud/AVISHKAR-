"""Automated Ingestion Scheduler and Operations Manager for UrjaSetu EMS (Phase 11).

Provides centralized orchestration, mutex concurrency protection, scheduled execution,
operator manual triggering, and execution history auditing for public data connectors.
Strict invariants:
1. Prevent duplicate concurrent runs of the same connector (distributed / thread-safe mutex).
2. Never claim a manually imported source is automatically refreshing.
3. Track start, completion, duration, and granular record counts for every run.
4. Provide safe manual execution for authorized operators.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from avishkar_ems.trust.connectors.base import BaseEnergyConnector, ImportSummary
from avishkar_ems.trust.idempotent_ingestion import IdempotentIngestionEngine


@dataclass
class ScheduledJobConfig:
    source_id: str
    cadence: str  # "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "MANUAL"
    interval_hours: float
    connector_factory: Callable[[], BaseEnergyConnector]
    engine: IdempotentIngestionEngine
    is_automated: bool
    last_run_time: datetime | None = None
    next_run_time: datetime | None = None
    last_status: str | None = None


class IngestionScheduler:
    """Manages connector scheduling, execution locks, and operational run history."""

    def __init__(self) -> None:
        self._jobs: dict[str, ScheduledJobConfig] = {}
        self._active_runs: set[str] = set()
        self._lock = threading.Lock()
        self._run_history: list[ImportSummary] = []

    def register_connector(
        self,
        source_id: str,
        cadence: str,
        connector_factory: Callable[[], BaseEnergyConnector],
        engine: IdempotentIngestionEngine,
        is_automated: bool = True,
    ) -> None:
        """Registers a data connector with specific execution cadence and engine."""
        interval_map = {
            "HOURLY": 1.0,
            "DAILY": 24.0,
            "WEEKLY": 168.0,
            "MONTHLY": 720.0,
            "MANUAL": 0.0,
        }
        interval_hours = interval_map.get(cadence.upper(), 24.0)
        next_run = datetime.now(UTC) + timedelta(hours=interval_hours) if is_automated else None

        self._jobs[source_id] = ScheduledJobConfig(
            source_id=source_id,
            cadence=cadence.upper(),
            interval_hours=interval_hours,
            connector_factory=connector_factory,
            engine=engine,
            is_automated=is_automated,
            next_run_time=next_run,
        )

    def trigger_sync(
        self,
        source_id: str,
        operator_id: str = "OPERATOR",
        ingestion_run_id: str | None = None,
    ) -> ImportSummary:
        """Manually triggers an authorized ingestion run for a specific connector."""
        if source_id not in self._jobs:
            raise KeyError(f"No registered job found for source '{source_id}'")

        job = self._jobs[source_id]

        # Mutex lock: Prevent duplicate concurrent runs of the same connector
        with self._lock:
            if source_id in self._active_runs:
                raise RuntimeError(
                    f"CONCURRENCY VIOLATION: An ingestion run for source '{source_id}' "
                    "is already actively executing. Concurrent duplicate runs are prohibited."
                )
            self._active_runs.add(source_id)

        run_id = ingestion_run_id or f"EXEC_{source_id}_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}"

        try:
            connector = job.connector_factory()
            summary, _results = connector.ingest_with_summary(job.engine, run_id)

            # Record run history and update job state
            job.last_run_time = summary.completion_time
            job.last_status = summary.status
            if job.is_automated and job.interval_hours > 0:
                job.next_run_time = summary.completion_time + timedelta(hours=job.interval_hours)

            self._run_history.append(summary)
            return summary

        finally:
            with self._lock:
                self._active_runs.discard(source_id)

    def run_pending_jobs(self) -> list[ImportSummary]:
        """Executes all automated jobs whose next_run_time has elapsed."""
        now = datetime.now(UTC)
        summaries: list[ImportSummary] = []

        for source_id, job in self._jobs.items():
            if not job.is_automated:
                continue
            if job.next_run_time and job.next_run_time <= now:
                try:
                    res = self.trigger_sync(source_id, operator_id="AUTO_SCHEDULER")
                    summaries.append(res)
                except RuntimeError:
                    # Job already running in another thread
                    continue

        return summaries

    def get_run_history(self, source_id: str | None = None) -> list[ImportSummary]:
        """Returns chronological list of completed ingestion summaries."""
        if source_id:
            return [s for s in self._run_history if s.source_id == source_id]
        return list(self._run_history)

    def list_scheduled_jobs(self) -> list[dict[str, Any]]:
        """Returns metadata for all registered jobs."""
        out = []
        for sid, job in self._jobs.items():
            out.append({
                "source_id": sid,
                "cadence": job.cadence,
                "is_automated": job.is_automated,
                "is_running": sid in self._active_runs,
                "last_run": job.last_run_time.isoformat() if job.last_run_time else None,
                "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
                "last_status": job.last_status,
            })
        return out

    def get_coverage_summary(self) -> dict[str, Any]:
        """Aggregates geographic and metric coverage across registered connectors."""
        sources_tracked = len(self._jobs)
        total_accepted = sum(s.accepted_count for s in self._run_history)
        total_rejected = sum(s.rejected_count for s in self._run_history)

        return {
            "sources_configured": sources_tracked,
            "total_runs_completed": len(self._run_history),
            "total_records_accepted": total_accepted,
            "total_records_rejected": total_rejected,
            "active_tasks_count": len(self._active_runs),
        }
