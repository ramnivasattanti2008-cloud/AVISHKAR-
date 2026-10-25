"""Tests for Source Reliability, Freshness vs Transport, and Retry Policies."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from avishkar_ems.source_reliability import (
    SourceReliabilityRegistry,
    SourceStatus,
    evaluate_status,
    execute_with_backoff,
)


def test_distinguish_transport_success_from_freshness():
    now = datetime(2026, 10, 24, 0, 0, tzinfo=UTC)
    # 1. Transport OK, but observation is 90 days old (limit 30) -> STALE
    old_obs = now - timedelta(days=90)
    status, exp = evaluate_status(
        transport_success=True,
        latest_obs=old_obs,
        as_of=now,
        max_acceptable_age_days=30,
        completeness_pct=100.0,
        validation_failures=0,
    )
    assert status == SourceStatus.STALE
    assert "Transport succeeded, but observation is 90.0 days old" in exp

    # 2. Transport failed -> UNAVAILABLE
    status_fail, _ = evaluate_status(
        transport_success=False,
        latest_obs=old_obs,
        as_of=now,
        max_acceptable_age_days=30,
        completeness_pct=100.0,
        validation_failures=0,
    )
    assert status_fail == SourceStatus.UNAVAILABLE


def test_retry_with_backoff():
    attempts = 0

    def flaky_service():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise ConnectionError("Transient network blip")
        return "SUCCESS"

    res = execute_with_backoff(flaky_service, max_retries=3, initial_delay_sec=0.01)
    assert res == "SUCCESS"
    assert attempts == 3


def test_refuse_synthetic_data_substitution():
    reg = SourceReliabilityRegistry()
    # Invariant: Never silently substitute sample or generated data for real observations
    with pytest.raises(ValueError, match="DATA HONESTY INVARIANT VIOLATION"):
        reg.fallback_on_unavailability("Central Electricity Authority (CEA)", allow_synthetic_substitution=True)
