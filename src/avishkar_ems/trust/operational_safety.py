"""Operational Safety, Resilience, and Secret Redaction for UrjaSetu EMS.

Provides:
1. Secret redaction (stripping passwords, consumer PII, utility credentials, API tokens).
2. Resilient retry policy with bounded retries and exponential backoff.
3. Token bucket rate limiter preventing upstream DOS/throttling.
4. Schema-drift detection.
5. Structured JSON logging with ingestion-run tracking.
"""

from __future__ import annotations

import json
import logging
import random
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypeVar

T = TypeVar("T")

# Patterns matching sensitive keys and sensitive string contents
SENSITIVE_KEY_PATTERNS = [
    re.compile(r"pass(word)?", re.IGNORECASE),
    re.compile(r"token", re.IGNORECASE),
    re.compile(r"secret", re.IGNORECASE),
    re.compile(r"api[-_]?key", re.IGNORECASE),
    re.compile(r"auth(orization)?", re.IGNORECASE),
    re.compile(r"credential", re.IGNORECASE),
    re.compile(r"mobile|phone", re.IGNORECASE),
    re.compile(r"aadhaar", re.IGNORECASE),
]

# Sensitive value pattern matches (e.g. Bearer tokens, 10-digit mobile, emails)
BEARER_PATTERN = re.compile(r"Bearer\s+([a-zA-Z0-9_\-\.]+)", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"\b[6-9]\d{9}\b")
ACCOUNT_NUM_PATTERN = re.compile(r"\b(\d{4})\d{4,8}(\d{2})\b")


class SecretRedactor:
    """Sanitizes configuration dictionaries, payloads, URLs, and log messages."""

    @classmethod
    def redact_string(cls, text: str) -> str:
        """Redacts sensitive tokens, phone numbers, and bearer credentials inside strings."""
        if not text:
            return text
        sanitized = BEARER_PATTERN.sub("Bearer ***REDACTED_TOKEN***", text)
        sanitized = PHONE_PATTERN.sub("***PHONE_REDACTED***", sanitized)
        # Partially mask account numbers: 1234567890 -> 1234****90
        sanitized = ACCOUNT_NUM_PATTERN.sub(r"\1****\2", sanitized)
        return sanitized

    @classmethod
    def redact_dict(cls, data: dict[str, Any]) -> dict[str, Any]:
        """Recursively sanitizes dictionary keys and values."""
        clean: dict[str, Any] = {}
        for k, v in data.items():
            # Check if key itself is sensitive
            if any(p.search(k) for p in SENSITIVE_KEY_PATTERNS):
                clean[k] = "***REDACTED_CREDENTIAL***"
            elif isinstance(v, dict):
                clean[k] = cls.redact_dict(v)
            elif isinstance(v, list):
                clean[k] = [
                    cls.redact_dict(item) if isinstance(item, dict)
                    else cls.redact_string(str(item)) if isinstance(item, str)
                    else item
                    for item in v
                ]
            elif isinstance(v, str):
                clean[k] = cls.redact_string(v)
            else:
                clean[k] = v
        return clean


@dataclass(frozen=True)
class RetryPolicy:
    """Configurable exponential backoff policy with jitter."""

    max_retries: int = 3
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 30.0
    backoff_factor: float = 2.0
    jitter: bool = True

    def calculate_delay(self, attempt: int) -> float:
        """Calculates backoff delay in seconds for the given zero-indexed attempt."""
        delay = self.base_delay_seconds * (self.backoff_factor ** attempt)
        delay = min(delay, self.max_delay_seconds)
        if self.jitter:
            delay = delay * (0.5 + random.random() * 0.5)
        return round(delay, 3)


class RateLimiter:
    """Token-bucket rate limiter enforcing maximum requests per time window."""

    def __init__(self, max_requests: int = 30, window_seconds: float = 60.0):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.tokens = float(max_requests)
        self.last_update = time.monotonic()

    def acquire(self) -> bool:
        """Attempts to acquire 1 token. Returns True if permitted, False if throttled."""
        now = time.monotonic()
        elapsed = now - self.last_update
        self.last_update = now

        # Replenish tokens
        self.tokens = min(float(self.max_requests), self.tokens + elapsed * (self.max_requests / self.window_seconds))

        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False


class SchemaDriftDetector:
    """Detects unexpected structural mutations in external provider datasets."""

    @staticmethod
    def inspect(expected_columns: set[str], actual_columns: set[str]) -> tuple[bool, list[str]]:
        """Verifies column presence. Returns (is_valid, list_of_drift_warnings)."""
        warnings: list[str] = []
        missing = expected_columns - actual_columns
        unexpected = actual_columns - expected_columns

        if missing:
            warnings.append(f"Missing required columns in source dataset: {sorted(missing)}")
        if unexpected:
            warnings.append(f"Unexpected new columns found in source dataset: {sorted(unexpected)}")

        is_valid = len(missing) == 0
        return is_valid, warnings


class StructuredAuditLogger:
    """Emits structured, sanitized JSON audit logs for ingestion pipelines."""

    def __init__(self, logger_name: str = "UrjaSetuDataTrust"):
        self.logger = logging.getLogger(logger_name)

    def log_event(
        self,
        event_type: str,
        ingestion_run_id: str,
        source_id: str,
        level: int = logging.INFO,
        details: dict[str, Any] | None = None,
    ) -> str:
        """Logs a sanitized structured event."""
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "event_type": event_type,
            "ingestion_run_id": ingestion_run_id,
            "source_id": source_id,
            "details": SecretRedactor.redact_dict(details or {}),
        }
        json_str = json.dumps(payload)
        self.logger.log(level, json_str)
        return json_str


def execute_with_resilience(
    func: Callable[[], T],
    policy: RetryPolicy = RetryPolicy(),
    rate_limiter: RateLimiter | None = None,
    on_retry: Callable[[int, Exception, float], None] | None = None,
) -> T:
    """Executes a function with rate limiting, bounded retries, and exponential backoff."""
    attempt = 0
    while True:
        if rate_limiter and not rate_limiter.acquire():
            time.sleep(0.5)

        try:
            return func()
        except Exception as exc:
            if attempt >= policy.max_retries:
                raise
            delay = policy.calculate_delay(attempt)
            if on_retry:
                on_retry(attempt, exc, delay)
            time.sleep(delay)
            attempt += 1
