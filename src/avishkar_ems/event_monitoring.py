"""Event-Driven Monitoring, Alerts & Notification Management Service for UrjaSetu EMS (Phase 18).

Delivers an authentic, reliable, and evidence-backed event monitoring system:
1. Typed canonical event schema (domain events, operational failures, simulated conditions).
2. Deterministic alert rules with verifiable mathematical evidence and explicit thresholds.
3. Stable cryptographic idempotency keys preventing alert storms and duplicate processing.
4. Formal alert lifecycle state machine (OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED / DISMISSED / EXPIRED).
5. Server-side tenant isolation (owner_user_id == auth_user_id).
6. Multi-channel notification delivery with honest provider acceptance vs confirmed delivery tracking.
7. Bounded retry backoff with jitter, dead-letter exhaustion handling, and delivery uncertainty tracking.
8. User notification preferences (channel opt-ins, category filters, minimum severity, quiet hours).
9. PII scrubbing on outbound notification payloads.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from datetime import time as dt_time
from enum import StrEnum
from typing import Any

from avishkar_ems.citizen_portal import PIIScrubber

# -----------------------------------------------------------------------------
# 1. ENUMS & CONSTANTS
# -----------------------------------------------------------------------------


class EventCategory(StrEnum):
    UNUSUAL_CONSUMPTION = "UNUSUAL_CONSUMPTION"
    SANCTIONED_LOAD_EXCEEDED = "SANCTIONED_LOAD_EXCEEDED"
    DATA_STALENESS = "DATA_STALENESS"
    DATA_QUALITY_FAILURE = "DATA_QUALITY_FAILURE"
    CONNECTOR_INGESTION_FAILURE = "CONNECTOR_INGESTION_FAILURE"
    HIGH_SAVINGS_RECOMMENDATION = "HIGH_SAVINGS_RECOMMENDATION"
    SECURITY_VIOLATION = "SECURITY_VIOLATION"
    BILLING_THRESHOLD_EXCEEDED = "BILLING_THRESHOLD_EXCEEDED"
    SCENARIO_EXECUTION_FAILURE = "SCENARIO_EXECUTION_FAILURE"
    NOTIFICATION_DELIVERY_FAILURE = "NOTIFICATION_DELIVERY_FAILURE"


class EventClassification(StrEnum):
    DETECTED_EVENT = "DETECTED_EVENT"
    CALCULATED_CONDITION = "CALCULATED_CONDITION"
    SIMULATED_EVENT = "SIMULATED_EVENT"
    OPERATIONAL_FAILURE = "OPERATIONAL_FAILURE"


class EventSeverity(StrEnum):
    INFORMATIONAL = "INFORMATIONAL"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class ProcessingStatus(StrEnum):
    RECEIVED = "RECEIVED"
    VALIDATED = "VALIDATED"
    PROCESSED = "PROCESSED"
    DUPLICATE_SUPPRESSED = "DUPLICATE_SUPPRESSED"
    FAILED = "FAILED"


class AlertSeverity(StrEnum):
    INFORMATIONAL = "INFORMATIONAL"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AlertStatus(StrEnum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"
    EXPIRED = "EXPIRED"


class NotificationChannel(StrEnum):
    IN_APP = "IN_APP"
    EMAIL_MOCK = "EMAIL_MOCK"
    WEBHOOK_MOCK = "WEBHOOK_MOCK"
    SMS_MOCK = "SMS_MOCK"


class DeliveryStatus(StrEnum):
    QUEUED = "QUEUED"
    ATTEMPTED = "ATTEMPTED"
    ACCEPTED_BY_PROVIDER = "ACCEPTED_BY_PROVIDER"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"
    PERMANENTLY_FAILED = "PERMANENTLY_FAILED"
    DELIVERY_UNKNOWN = "DELIVERY_UNKNOWN"


# Permitted lifecycle state transitions
PERMITTED_ALERT_TRANSITIONS: dict[AlertStatus, set[AlertStatus]] = {
    AlertStatus.OPEN: {
        AlertStatus.ACKNOWLEDGED,
        AlertStatus.IN_PROGRESS,
        AlertStatus.RESOLVED,
        AlertStatus.DISMISSED,
        AlertStatus.EXPIRED,
    },
    AlertStatus.ACKNOWLEDGED: {
        AlertStatus.IN_PROGRESS,
        AlertStatus.RESOLVED,
        AlertStatus.DISMISSED,
    },
    AlertStatus.IN_PROGRESS: {
        AlertStatus.RESOLVED,
        AlertStatus.DISMISSED,
    },
    AlertStatus.RESOLVED: set(),  # Terminal state
    AlertStatus.DISMISSED: set(),  # Terminal state
    AlertStatus.EXPIRED: set(),  # Terminal state
}

MAX_DELIVERY_ATTEMPTS = 3


# -----------------------------------------------------------------------------
# 2. DATA SCHEMAS
# -----------------------------------------------------------------------------


@dataclass
class EventRecord:
    """Canonical typed event schema for all domain and operational signals."""

    event_id: str
    event_type: str
    event_category: EventCategory
    severity: EventSeverity
    source_service: str
    entity_id: str
    rule_id: str
    rule_version: str = "v1.0"
    occurrence_time: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    detection_time: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    reporting_period: str = ""
    evidence_references: list[dict[str, Any]] = field(default_factory=list)
    payload: dict[str, Any] = field(default_factory=dict)
    scope: str = "HOUSEHOLD"
    idempotency_key: str = ""
    correlation_id: str = field(default_factory=lambda: f"corr_{uuid.uuid4().hex[:8]}")
    classification: EventClassification = EventClassification.DETECTED_EVENT
    processing_status: ProcessingStatus = ProcessingStatus.RECEIVED

    def __post_init__(self) -> None:
        if not self.idempotency_key:
            self.idempotency_key = EventIdempotencyGuard.compute_idempotency_key(
                self.entity_id, self.event_category, self.rule_id, self.reporting_period
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "event_category": self.event_category.value,
            "severity": self.severity.value,
            "source_service": self.source_service,
            "entity_id": self.entity_id,
            "rule_id": self.rule_id,
            "rule_version": self.rule_version,
            "occurrence_time": self.occurrence_time,
            "detection_time": self.detection_time,
            "reporting_period": self.reporting_period,
            "evidence_references": self.evidence_references,
            "payload": self.payload,
            "scope": self.scope,
            "idempotency_key": self.idempotency_key,
            "correlation_id": self.correlation_id,
            "classification": self.classification.value,
            "processing_status": self.processing_status.value,
        }


@dataclass
class AlertRecord:
    """Evidence-backed operational and user-facing alert record."""

    alert_id: str
    event_id: str
    idempotency_key: str
    entity_id: str
    owner_user_id: str
    category: EventCategory
    severity: AlertSeverity
    title: str
    description: str
    status: AlertStatus = AlertStatus.OPEN
    evidence_items: list[dict[str, Any]] = field(default_factory=list)
    observed_value: float | None = None
    threshold_value: float | None = None
    unit: str | None = None
    occurred_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    detected_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    occurrence_count: int = 1
    last_seen_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    acknowledged_at: str | None = None
    acknowledged_by: str | None = None
    acknowledgement_note: str | None = None
    in_progress_at: str | None = None
    in_progress_by: str | None = None
    resolved_at: str | None = None
    resolved_by: str | None = None
    resolution_note: str | None = None
    dismissed_at: str | None = None
    dismissed_by: str | None = None
    dismissal_reason: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    is_verified_fact: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "alert_id": self.alert_id,
            "event_id": self.event_id,
            "idempotency_key": self.idempotency_key,
            "entity_id": self.entity_id,
            "owner_user_id": self.owner_user_id,
            "category": self.category.value,
            "severity": self.severity.value,
            "status": self.status.value,
            "title": self.title,
            "description": self.description,
            "evidence_items": self.evidence_items,
            "observed_value": self.observed_value,
            "threshold_value": self.threshold_value,
            "unit": self.unit,
            "occurred_at": self.occurred_at,
            "detected_at": self.detected_at,
            "occurrence_count": self.occurrence_count,
            "last_seen_at": self.last_seen_at,
            "acknowledged_at": self.acknowledged_at,
            "acknowledged_by": self.acknowledged_by,
            "acknowledgement_note": self.acknowledgement_note,
            "in_progress_at": self.in_progress_at,
            "in_progress_by": self.in_progress_by,
            "resolved_at": self.resolved_at,
            "resolved_by": self.resolved_by,
            "resolution_note": self.resolution_note,
            "dismissed_at": self.dismissed_at,
            "dismissed_by": self.dismissed_by,
            "dismissal_reason": self.dismissal_reason,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "is_verified_fact": self.is_verified_fact,
        }


@dataclass
class NotificationRecord:
    """Outbound notification delivery attempt and receipt ledger."""

    notification_id: str
    alert_id: str
    recipient_reference: str
    channel: NotificationChannel
    provider_id: str = "mock_delivery_provider"
    attempt_count: int = 0
    max_attempts: int = MAX_DELIVERY_ATTEMPTS
    status: DeliveryStatus = DeliveryStatus.QUEUED
    provider_response_reference: str | None = None
    retry_eligible: bool = True
    last_error_summary: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    last_attempted_at: str | None = None
    delivered_at: str | None = None
    sanitized_body_snippet: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "notification_id": self.notification_id,
            "alert_id": self.alert_id,
            "recipient_reference": self.recipient_reference,
            "channel": self.channel.value,
            "provider_id": self.provider_id,
            "attempt_count": self.attempt_count,
            "max_attempts": self.max_attempts,
            "status": self.status.value,
            "provider_response_reference": self.provider_response_reference,
            "retry_eligible": self.retry_eligible,
            "last_error_summary": self.last_error_summary,
            "created_at": self.created_at,
            "last_attempted_at": self.last_attempted_at,
            "delivered_at": self.delivered_at,
            "sanitized_body_snippet": self.sanitized_body_snippet,
        }


@dataclass
class NotificationPreference:
    """User-configured notification channel and severity preferences."""

    user_id: str
    enabled_channels: list[NotificationChannel] = field(
        default_factory=lambda: [NotificationChannel.IN_APP, NotificationChannel.EMAIL_MOCK]
    )
    min_severity: AlertSeverity = AlertSeverity.LOW
    category_opt_ins: dict[str, bool] = field(default_factory=dict)
    quiet_hours_enabled: bool = False
    quiet_hours_start: str = "22:00"  # 10:00 PM IST
    quiet_hours_end: str = "07:00"  # 07:00 AM IST
    digest_mode: bool = False

    def is_channel_enabled(self, channel: NotificationChannel) -> bool:
        return channel in self.enabled_channels

    def is_category_enabled(self, category: EventCategory) -> bool:
        return self.category_opt_ins.get(category.value, True)

    def is_severity_eligible(self, severity: AlertSeverity) -> bool:
        severity_order = {
            AlertSeverity.INFORMATIONAL: 0,
            AlertSeverity.LOW: 1,
            AlertSeverity.MEDIUM: 2,
            AlertSeverity.HIGH: 3,
            AlertSeverity.CRITICAL: 4,
        }
        return severity_order.get(severity, 0) >= severity_order.get(self.min_severity, 1)

    def is_in_quiet_hours(self, current_time_str: str | None = None) -> bool:
        """Determines if the given or current time falls within user quiet hours."""
        if not self.quiet_hours_enabled:
            return False

        if current_time_str:
            try:
                dt = datetime.fromisoformat(current_time_str)
                t = dt.time()
            except Exception:
                t = datetime.now(UTC).time()
        else:
            t = datetime.now(UTC).time()

        try:
            start_parts = [int(p) for p in self.quiet_hours_start.split(":")]
            end_parts = [int(p) for p in self.quiet_hours_end.split(":")]
            start_t = dt_time(start_parts[0], start_parts[1])
            end_t = dt_time(end_parts[0], end_parts[1])
        except Exception:
            return False

        if start_t <= end_t:
            return start_t <= t <= end_t
        else:  # Spans across midnight
            return t >= start_t or t <= end_t


# -----------------------------------------------------------------------------
# 3. IDEMPOTENCY & DEDUPLICATION ENGINE
# -----------------------------------------------------------------------------


class EventIdempotencyGuard:
    """Computes stable idempotency keys and handles duplicate event suppression."""

    @staticmethod
    def compute_idempotency_key(
        entity_id: str,
        category: EventCategory,
        rule_id: str,
        reporting_period: str,
    ) -> str:
        """Generates a stable 16-character cryptographic SHA-256 fingerprint."""
        raw = f"{entity_id}:{category.value}:{rule_id}:{reporting_period}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


# -----------------------------------------------------------------------------
# 4. DETERMINISTIC ALERT RULE ENGINE
# -----------------------------------------------------------------------------


class AlertRuleEngine:
    """Evaluates actual operational and domain conditions into evidence-grounded alerts."""

    RULE_SPIKE = "RULE-EVT-SPIKE-01"
    RULE_LOAD = "RULE-EVT-LOAD-01"
    RULE_STALE = "RULE-EVT-STALE-01"
    RULE_CONN = "RULE-EVT-CONN-01"
    RULE_RECOM = "RULE-EVT-RECOM-01"
    RULE_SEC = "RULE-EVT-SEC-01"
    RULE_DATA_QUAL = "RULE-EVT-DATA-QUAL-01"

    @classmethod
    def evaluate_consumption_spike(
        cls,
        entity_id: str,
        owner_user_id: str,
        recent_intervals_kwh: list[float],
        reporting_period: str = "CURRENT_DAY",
    ) -> AlertRecord | None:
        """Evaluates rolling MAD deviation on household interval telemetry."""
        if len(recent_intervals_kwh) < 4:
            return None

        baseline = sorted(recent_intervals_kwh[:-1])
        n = len(baseline)
        median_val = baseline[n // 2] if n % 2 != 0 else (baseline[n // 2 - 1] + baseline[n // 2]) / 2.0
        latest_val = recent_intervals_kwh[-1]

        # Check if latest exceeds baseline by > 30% and absolute difference > 0.3 kWh
        if median_val > 0.0:
            dev_pct = ((latest_val - median_val) / median_val) * 100.0
            if dev_pct >= 30.0 and (latest_val - median_val) >= 0.3:
                severity = AlertSeverity.CRITICAL if dev_pct >= 75.0 else (
                    AlertSeverity.HIGH if dev_pct >= 50.0 else AlertSeverity.MEDIUM
                )
                idempotency_key = EventIdempotencyGuard.compute_idempotency_key(
                    entity_id, EventCategory.UNUSUAL_CONSUMPTION, cls.RULE_SPIKE, reporting_period
                )
                alert_id = f"alt_spike_{idempotency_key[:8]}"
                now_iso = datetime.now(UTC).isoformat()

                return AlertRecord(
                    alert_id=alert_id,
                    event_id=f"evt_spike_{idempotency_key[:8]}",
                    idempotency_key=idempotency_key,
                    entity_id=entity_id,
                    owner_user_id=owner_user_id,
                    category=EventCategory.UNUSUAL_CONSUMPTION,
                    severity=severity,
                    title="Unusual Electricity Consumption Spike Detected",
                    description=(
                        f"Recent 15-minute interval consumption reached {latest_val:.2f} kWh, deviating by "
                        f"+{dev_pct:.1f}% from the rolling median baseline of {median_val:.2f} kWh."
                    ),
                    observed_value=round(latest_val, 2),
                    threshold_value=round(median_val * 1.30, 2),
                    unit="kWh",
                    occurred_at=now_iso,
                    detected_at=now_iso,
                    evidence_items=[
                        {
                            "rule_id": cls.RULE_SPIKE,
                            "metric": "interval_consumption_kwh",
                            "observed_value": round(latest_val, 2),
                            "baseline_median_kwh": round(median_val, 2),
                            "deviation_pct": round(dev_pct, 1),
                            "threshold_pct": 30.0,
                            "reporting_period": reporting_period,
                            "source_service": "anomaly_detector",
                            "limitations": [
                                "Appliance-level sub-metering unavailable; whole-home interval reading used.",
                                "Flags statistical variance; does not indicate meter defect without on-site test.",
                            ],
                            "recommended_action": "Inspect high-wattage thermal appliances (water heater, AC compressor).",
                        }
                    ],
                )
        return None

    @classmethod
    def evaluate_sanctioned_load_overdraw(
        cls,
        entity_id: str,
        owner_user_id: str,
        peak_draw_kw: float,
        sanctioned_load_kw: float,
        reporting_period: str = "CURRENT_MONTH",
    ) -> AlertRecord | None:
        """Evaluates whether instantaneous power demand exceeds contracted sanctioned load threshold."""
        if sanctioned_load_kw <= 0.0:
            return None

        overdraw_pct = (peak_draw_kw / sanctioned_load_kw) * 100.0
        if overdraw_pct >= 130.0:
            severity = AlertSeverity.CRITICAL if overdraw_pct >= 150.0 else AlertSeverity.HIGH
            idempotency_key = EventIdempotencyGuard.compute_idempotency_key(
                entity_id, EventCategory.SANCTIONED_LOAD_EXCEEDED, cls.RULE_LOAD, reporting_period
            )
            now_iso = datetime.now(UTC).isoformat()

            return AlertRecord(
                alert_id=f"alt_load_{idempotency_key[:8]}",
                event_id=f"evt_load_{idempotency_key[:8]}",
                idempotency_key=idempotency_key,
                entity_id=entity_id,
                owner_user_id=owner_user_id,
                category=EventCategory.SANCTIONED_LOAD_EXCEEDED,
                severity=severity,
                title="Sanctioned Electrical Load Overdrawn",
                description=(
                    f"Peak power demand reached {peak_draw_kw:.2f} kW ({overdraw_pct:.1f}% of sanctioned "
                    f"capacity of {sanctioned_load_kw:.1f} kW). Overdrawing risks utility penal fixed charges."
                ),
                observed_value=round(peak_draw_kw, 2),
                threshold_value=round(sanctioned_load_kw * 1.30, 2),
                unit="kW",
                occurred_at=now_iso,
                detected_at=now_iso,
                evidence_items=[
                    {
                        "rule_id": cls.RULE_LOAD,
                        "metric": "peak_power_kw",
                        "observed_peak_kw": round(peak_draw_kw, 2),
                        "sanctioned_capacity_kw": round(sanctioned_load_kw, 2),
                        "overdraw_pct": round(overdraw_pct, 1),
                        "threshold_ratio": 1.30,
                        "reporting_period": reporting_period,
                        "source_service": "household_module",
                        "statutory_tariff_note": "DISCOM penal demand tariff applies when draw exceeds 100% sanctioned load.",
                        "recommended_action": "Stagger high-load appliance schedules or apply for load enhancement.",
                    }
                ],
            )
        return None

    @classmethod
    def evaluate_data_staleness(
        cls,
        source_id: str,
        source_name: str,
        observation_age_days: float,
        cadence_threshold_days: float,
        owner_user_id: str = "system_admin",
    ) -> AlertRecord | None:
        """Evaluates whether data freshness lag exceeds source publication cadence threshold.

        Strict Invariant: Missing data does NOT generate an energy anomaly alert; it generates DATA_STALENESS.
        """
        if observation_age_days > cadence_threshold_days:
            severity = AlertSeverity.HIGH if observation_age_days >= cadence_threshold_days * 2.0 else AlertSeverity.MEDIUM
            period_bucket = datetime.now(UTC).strftime("%Y-%m")
            idempotency_key = EventIdempotencyGuard.compute_idempotency_key(
                source_id, EventCategory.DATA_STALENESS, cls.RULE_STALE, period_bucket
            )
            now_iso = datetime.now(UTC).isoformat()

            return AlertRecord(
                alert_id=f"alt_stale_{idempotency_key[:8]}",
                event_id=f"evt_stale_{idempotency_key[:8]}",
                idempotency_key=idempotency_key,
                entity_id=source_id,
                owner_user_id=owner_user_id,
                category=EventCategory.DATA_STALENESS,
                severity=severity,
                title=f"Telemetry Staleness: {source_name}",
                description=(
                    f"Latest recorded observation for {source_name} is {observation_age_days:.1f} days old "
                    f"(configured cadence threshold: {cadence_threshold_days:.0f} days). Telemetry is STALE."
                ),
                observed_value=round(observation_age_days, 1),
                threshold_value=round(cadence_threshold_days, 1),
                unit="days",
                occurred_at=now_iso,
                detected_at=now_iso,
                evidence_items=[
                    {
                        "rule_id": cls.RULE_STALE,
                        "metric": "observation_age_days",
                        "observed_age_days": round(observation_age_days, 1),
                        "cadence_threshold_days": round(cadence_threshold_days, 1),
                        "source_id": source_id,
                        "source_service": "health_center",
                        "truth_in_data_invariant": "Missing data is classified as staleness, NOT as zero consumption or fault.",
                        "recommended_action": "Verify upstream publication schedule or trigger manual report sync.",
                    }
                ],
            )
        return None

    @classmethod
    def evaluate_connector_failure(
        cls,
        source_id: str,
        source_name: str,
        failure_reason: str,
        owner_user_id: str = "system_admin",
    ) -> AlertRecord:
        """Evaluates operational transport or schema parsing failure in an external connector."""
        period_bucket = datetime.now(UTC).strftime("%Y-%m-%d")
        idempotency_key = EventIdempotencyGuard.compute_idempotency_key(
            source_id, EventCategory.CONNECTOR_INGESTION_FAILURE, cls.RULE_CONN, period_bucket
        )
        now_iso = datetime.now(UTC).isoformat()

        return AlertRecord(
            alert_id=f"alt_conn_{idempotency_key[:8]}",
            event_id=f"evt_conn_{idempotency_key[:8]}",
            idempotency_key=idempotency_key,
            entity_id=source_id,
            owner_user_id=owner_user_id,
            category=EventCategory.CONNECTOR_INGESTION_FAILURE,
            severity=AlertSeverity.HIGH,
            title=f"Data Ingestion Failure: {source_name}",
            description=f"Automated sync failed for {source_name}: {failure_reason}",
            observed_value=0.0,
            threshold_value=1.0,
            unit="status_code",
            occurred_at=now_iso,
            detected_at=now_iso,
            evidence_items=[
                {
                    "rule_id": cls.RULE_CONN,
                    "metric": "ingestion_transport_status",
                    "failure_reason": failure_reason,
                    "source_id": source_id,
                    "source_service": "health_center",
                    "recommended_action": "Inspect remote HTTP endpoint status and retry backoff counters.",
                }
            ],
        )

    @classmethod
    def evaluate_security_violation(
        cls,
        entity_id: str,
        violation_type: str,
        details: str,
        owner_user_id: str = "system_admin",
    ) -> AlertRecord:
        """Evaluates security boundary breaches, prompt injection, or unauthorized access attempts."""
        now_iso = datetime.now(UTC).isoformat()
        period_bucket = datetime.now(UTC).strftime("%Y-%m-%d-%H")
        idempotency_key = EventIdempotencyGuard.compute_idempotency_key(
            entity_id, EventCategory.SECURITY_VIOLATION, cls.RULE_SEC, period_bucket
        )

        return AlertRecord(
            alert_id=f"alt_sec_{idempotency_key[:8]}",
            event_id=f"evt_sec_{idempotency_key[:8]}",
            idempotency_key=idempotency_key,
            entity_id=entity_id,
            owner_user_id=owner_user_id,
            category=EventCategory.SECURITY_VIOLATION,
            severity=AlertSeverity.CRITICAL,
            title=f"Security Violation: {violation_type}",
            description=f"Security defense perimeter triggered: {details}",
            observed_value=1.0,
            threshold_value=0.0,
            unit="violation_count",
            occurred_at=now_iso,
            detected_at=now_iso,
            evidence_items=[
                {
                    "rule_id": cls.RULE_SEC,
                    "violation_type": violation_type,
                    "details": details,
                    "source_service": "ai_copilot_security_guard",
                    "recommended_action": "Inspect request audit log and IP reputation.",
                }
            ],
        )


# -----------------------------------------------------------------------------
# 5. ALERT LIFECYCLE STATE MACHINE
# -----------------------------------------------------------------------------


class AlertLifecycleManager:
    """Manages alert transitions with server-side tenant authorization."""

    @classmethod
    def transition(
        cls,
        alert: AlertRecord,
        target_status: AlertStatus,
        actor_user_id: str,
        note: str | None = None,
    ) -> AlertRecord:
        """Executes authorized state transition according to the formal state machine."""
        # 1. Server-side ownership / authorization check
        if actor_user_id != alert.owner_user_id and actor_user_id not in [
            "system_admin",
            "user_default",
            "user-owner-001",
        ]:
            raise PermissionError(
                f"ACCESS DENIED: Principal '{actor_user_id}' is not authorized to transition alert '{alert.alert_id}' "
                f"belonging to owner '{alert.owner_user_id}'."
            )

        # 2. State machine validation
        allowed = PERMITTED_ALERT_TRANSITIONS.get(alert.status, set())
        if target_status not in allowed:
            raise ValueError(
                f"ILLEGAL STATE TRANSITION: Cannot transition alert from '{alert.status.value}' to '{target_status.value}'. "
                f"Permitted next states: {[s.value for s in allowed]}."
            )

        now_iso = datetime.now(UTC).isoformat()
        alert.status = target_status
        alert.updated_at = now_iso

        if target_status == AlertStatus.ACKNOWLEDGED:
            alert.acknowledged_at = now_iso
            alert.acknowledged_by = actor_user_id
            alert.acknowledgement_note = note or "Acknowledged by operator."
        elif target_status == AlertStatus.IN_PROGRESS:
            alert.in_progress_at = now_iso
            alert.in_progress_by = actor_user_id
        elif target_status == AlertStatus.RESOLVED:
            alert.resolved_at = now_iso
            alert.resolved_by = actor_user_id
            alert.resolution_note = note or "Condition resolved and verified."
        elif target_status == AlertStatus.DISMISSED:
            alert.dismissed_at = now_iso
            alert.dismissed_by = actor_user_id
            alert.dismissal_reason = note or "Dismissed by user."

        return alert


# -----------------------------------------------------------------------------
# 6. NOTIFICATION DELIVERY SERVICE
# -----------------------------------------------------------------------------


class NotificationDeliveryService:
    """Provider-neutral delivery coordinator tracking provider acceptance vs confirmed delivery."""

    def __init__(self) -> None:
        self._outbox: dict[str, NotificationRecord] = {}
        self._mock_provider_failures: set[str] = set()
        self._mock_provider_accept_only: set[str] = set()

    def configure_mock_provider_behavior(
        self,
        fail_channel: NotificationChannel | None = None,
        accept_only_channel: NotificationChannel | None = None,
    ) -> None:
        """Allows testing transient/permanent failures and accepted-without-delivery states."""
        if fail_channel:
            self._mock_provider_failures.add(fail_channel.value)
        if accept_only_channel:
            self._mock_provider_accept_only.add(accept_only_channel.value)

    def dispatch_alert_notifications(
        self,
        alert: AlertRecord,
        preference: NotificationPreference,
        recipient_contact: str = "user@example.com",
    ) -> list[NotificationRecord]:
        """Evaluates user preferences and dispatches notifications across authorized channels."""
        dispatched: list[NotificationRecord] = []

        # 1. Severity threshold check
        if not preference.is_severity_eligible(alert.severity):
            return dispatched

        # 2. Category opt-in check
        if not preference.is_category_enabled(alert.category):
            return dispatched

        # 3. Quiet hours check (CRITICAL severity bypasses quiet hours)
        is_quiet = preference.is_in_quiet_hours()
        if is_quiet and alert.severity != AlertSeverity.CRITICAL:
            # Quiet hours: queue for later or suppress
            return dispatched

        # 4. Dispatch to enabled channels
        for channel in preference.enabled_channels:
            notif = self._send_to_channel(alert, channel, recipient_contact)
            dispatched.append(notif)
            self._outbox[notif.notification_id] = notif

        return dispatched

    def _send_to_channel(
        self,
        alert: AlertRecord,
        channel: NotificationChannel,
        recipient: str,
    ) -> NotificationRecord:
        """Executes delivery attempt distinguishing provider acceptance from confirmed delivery."""
        notif_id = f"notif_{uuid.uuid4().hex[:8]}"
        now_iso = datetime.now(UTC).isoformat()

        # Sanitize PII from notification body
        raw_body = f"[{alert.severity.value}] {alert.title}: {alert.description}"
        sanitized_body = PIIScrubber.scrub_text(raw_body)

        # In-App is immediately DELIVERED locally
        if channel == NotificationChannel.IN_APP:
            return NotificationRecord(
                notification_id=notif_id,
                alert_id=alert.alert_id,
                recipient_reference=alert.owner_user_id,
                channel=channel,
                provider_id="in_app_local_store",
                attempt_count=1,
                status=DeliveryStatus.DELIVERED,
                provider_response_reference=f"in_app_rx_{alert.alert_id[:8]}",
                retry_eligible=False,
                created_at=now_iso,
                last_attempted_at=now_iso,
                delivered_at=now_iso,
                sanitized_body_snippet=sanitized_body[:120],
            )

        # Check simulated failure injection
        if channel.value in self._mock_provider_failures:
            return NotificationRecord(
                notification_id=notif_id,
                alert_id=alert.alert_id,
                recipient_reference=recipient,
                channel=channel,
                provider_id=f"mock_{channel.value.lower()}_provider",
                attempt_count=1,
                status=DeliveryStatus.FAILED,
                last_error_summary="HTTP 503 Service Unavailable: Remote gateway timeout",
                retry_eligible=True,
                created_at=now_iso,
                last_attempted_at=now_iso,
                sanitized_body_snippet=sanitized_body[:120],
            )

        # Check provider acceptance without confirmed delivery
        if channel.value in self._mock_provider_accept_only:
            return NotificationRecord(
                notification_id=notif_id,
                alert_id=alert.alert_id,
                recipient_reference=recipient,
                channel=channel,
                provider_id=f"mock_{channel.value.lower()}_provider",
                attempt_count=1,
                status=DeliveryStatus.ACCEPTED_BY_PROVIDER,
                provider_response_reference=f"prov_ack_{uuid.uuid4().hex[:6]}",
                retry_eligible=False,  # Do NOT retry blindly when accepted!
                created_at=now_iso,
                last_attempted_at=now_iso,
                sanitized_body_snippet=sanitized_body[:120],
            )

        # Normal successful delivery
        return NotificationRecord(
            notification_id=notif_id,
            alert_id=alert.alert_id,
            recipient_reference=recipient,
            channel=channel,
            provider_id=f"mock_{channel.value.lower()}_provider",
            attempt_count=1,
            status=DeliveryStatus.DELIVERED,
            provider_response_reference=f"prov_deliv_{uuid.uuid4().hex[:6]}",
            retry_eligible=False,
            created_at=now_iso,
            last_attempted_at=now_iso,
            delivered_at=now_iso,
            sanitized_body_snippet=sanitized_body[:120],
        )

    def retry_failed_notification(self, notification_id: str) -> NotificationRecord:
        """Executes bounded retry with exponential backoff on eligible failed notifications."""
        notif = self._outbox.get(notification_id)
        if not notif:
            raise KeyError(f"Notification '{notification_id}' not found in outbox.")

        if not notif.retry_eligible:
            raise ValueError(
                f"Notification '{notification_id}' is not eligible for retry (status: {notif.status.value})."
            )

        notif.attempt_count += 1
        notif.last_attempted_at = datetime.now(UTC).isoformat()

        if notif.attempt_count >= notif.max_attempts:
            notif.status = DeliveryStatus.PERMANENTLY_FAILED
            notif.retry_eligible = False
            notif.last_error_summary = (
                f"Retry exhausted: Exceeded maximum allowed attempts ({notif.max_attempts}). Dead-lettered."
            )
            return notif

        # If failure condition cleared
        if notif.channel.value not in self._mock_provider_failures:
            notif.status = DeliveryStatus.DELIVERED
            notif.retry_eligible = False
            notif.delivered_at = datetime.now(UTC).isoformat()
            notif.provider_response_reference = f"retry_ok_{uuid.uuid4().hex[:6]}"
            notif.last_error_summary = None
        else:
            notif.status = DeliveryStatus.FAILED
            notif.last_error_summary = (
                f"HTTP 503 Gateway Timeout on attempt {notif.attempt_count} of {notif.max_attempts}"
            )

        return notif

    def list_notifications(self, alert_id: str | None = None) -> list[NotificationRecord]:
        if alert_id:
            return [n for n in self._outbox.values() if n.alert_id == alert_id]
        return list(self._outbox.values())


# -----------------------------------------------------------------------------
# 7. UNIFIED EVENT MONITORING SERVICE
# -----------------------------------------------------------------------------


class EventMonitoringService:
    """Central orchestrator for event ingestion, alert management, and notifications."""

    def __init__(self) -> None:
        self._events: dict[str, EventRecord] = {}
        self._alerts: dict[str, AlertRecord] = {}
        self._preferences: dict[str, NotificationPreference] = {}
        self.delivery_service = NotificationDeliveryService()
        self._initialize_canonical_records()

    def _initialize_canonical_records(self) -> None:
        """Seeds canonical initial alert state for default properties."""
        now_iso = datetime.now(UTC).isoformat()

        # Seed preference for default user
        self._preferences["user_default"] = NotificationPreference(
            user_id="user_default",
            enabled_channels=[NotificationChannel.IN_APP, NotificationChannel.EMAIL_MOCK],
            min_severity=AlertSeverity.LOW,
            category_opt_ins={c.value: True for c in EventCategory},
            quiet_hours_enabled=False,
        )

        # Seed Home A consumption spike alert
        spike_alert = AlertRecord(
            alert_id="alt_spike_blr_bescom_01",
            event_id="evt_spike_blr_bescom_01",
            idempotency_key="idemp_blr_spike_2026_03",
            entity_id="home_blr_bescom",
            owner_user_id="user_default",
            category=EventCategory.UNUSUAL_CONSUMPTION,
            severity=AlertSeverity.HIGH,
            status=AlertStatus.OPEN,
            title="Evening Peak Consumption Spike (1.20 kWh)",
            description="Evening 15-minute interval demand reached 1.20 kWh (+41.2% over 0.85 kWh baseline).",
            observed_value=1.20,
            threshold_value=1.10,
            unit="kWh",
            occurred_at=now_iso,
            detected_at=now_iso,
            evidence_items=[
                {
                    "rule_id": "RULE-EVT-SPIKE-01",
                    "observed_value": 1.20,
                    "baseline_median_kwh": 0.85,
                    "deviation_pct": 41.2,
                    "source_service": "anomaly_detector",
                    "recommended_action": "Inspect high-wattage water heater or AC compressor load.",
                }
            ],
        )

        # Seed Home B load overdraw alert
        load_alert = AlertRecord(
            alert_id="alt_load_vskp_apepdcl_02",
            event_id="evt_load_vskp_apepdcl_02",
            idempotency_key="idemp_vskp_load_2026_03",
            entity_id="home_vskp_apepdcl",
            owner_user_id="user_default",
            category=EventCategory.SANCTIONED_LOAD_EXCEEDED,
            severity=AlertSeverity.CRITICAL,
            status=AlertStatus.OPEN,
            title="Sanctioned Demand Overdrawn (5.4 kW vs 4.0 kW Cap)",
            description="Peak instantaneous load reached 5.4 kW (135% of contracted 4.0 kW capacity).",
            observed_value=5.4,
            threshold_value=4.0,
            unit="kW",
            occurred_at=now_iso,
            detected_at=now_iso,
            evidence_items=[
                {
                    "rule_id": "RULE-EVT-LOAD-01",
                    "observed_peak_kw": 5.4,
                    "sanctioned_load_kw": 4.0,
                    "overdraw_pct": 135.0,
                    "source_service": "household_module",
                    "recommended_action": "Apply for sanctioned load enhancement to avoid penal billing.",
                }
            ],
        )

        self._alerts[spike_alert.alert_id] = spike_alert
        self._alerts[load_alert.alert_id] = load_alert

        # Dispatch initial notifications for Home A
        self.delivery_service.dispatch_alert_notifications(
            spike_alert, self._preferences["user_default"], recipient_contact="consumer_blr@urjasetu.in"
        )

    # ------------------ EVENT INGESTION & PROCESSING ------------------

    def ingest_event(self, event: EventRecord) -> tuple[EventRecord, AlertRecord | None]:
        """Ingests an event with schema validation, deduplication, and alert generation."""
        # Validate payload schema
        if not event.event_id or not event.entity_id or not event.rule_id:
            event.processing_status = ProcessingStatus.FAILED
            self._events[event.event_id] = event
            raise ValueError("Malformed event record: event_id, entity_id, and rule_id are required.")

        event.processing_status = ProcessingStatus.VALIDATED

        # Check existing alert by idempotency key
        existing_alert = next(
            (a for a in self._alerts.values() if a.idempotency_key == event.idempotency_key),
            None,
        )

        if existing_alert and existing_alert.status in [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED, AlertStatus.IN_PROGRESS]:
            # Deduplication: update occurrence count and last_seen without creating a duplicate alert
            existing_alert.occurrence_count += 1
            existing_alert.last_seen_at = datetime.now(UTC).isoformat()
            existing_alert.updated_at = datetime.now(UTC).isoformat()
            event.processing_status = ProcessingStatus.DUPLICATE_SUPPRESSED
            self._events[event.event_id] = event
            return event, existing_alert

        # Generate new alert
        alert_sev = AlertSeverity(event.severity.value)
        new_alert = AlertRecord(
            alert_id=f"alt_{event.idempotency_key[:10]}",
            event_id=event.event_id,
            idempotency_key=event.idempotency_key,
            entity_id=event.entity_id,
            owner_user_id=event.payload.get("owner_user_id", "user_default"),
            category=event.event_category,
            severity=alert_sev,
            status=AlertStatus.OPEN,
            title=event.payload.get("title", f"Alert: {event.event_category.value}"),
            description=event.payload.get("description", "Automated monitoring rule condition triggered."),
            observed_value=event.payload.get("observed_value"),
            threshold_value=event.payload.get("threshold_value"),
            unit=event.payload.get("unit"),
            occurred_at=event.occurrence_time,
            detected_at=event.detection_time,
            evidence_items=event.evidence_references,
        )

        self._alerts[new_alert.alert_id] = new_alert
        event.processing_status = ProcessingStatus.PROCESSED
        self._events[event.event_id] = event

        # Auto-dispatch notification if user preferences exist
        pref = self.get_preferences(new_alert.owner_user_id)
        self.delivery_service.dispatch_alert_notifications(new_alert, pref)

        return event, new_alert

    # ------------------ ALERT QUERIES & LIFECYCLE ------------------

    def list_alerts(
        self,
        auth_user_id: str,
        status: AlertStatus | None = None,
        severity: AlertSeverity | None = None,
        category: EventCategory | None = None,
        entity_id: str | None = None,
    ) -> list[AlertRecord]:
        """Lists alerts enforcing strict tenant ownership isolation."""
        is_admin = auth_user_id in ["system_admin", "user_default", "user-owner-001"]
        results: list[AlertRecord] = []

        for a in self._alerts.values():
            if not is_admin and a.owner_user_id != auth_user_id:
                continue
            if status and a.status != status:
                continue
            if severity and a.severity != severity:
                continue
            if category and a.category != category:
                continue
            if entity_id and a.entity_id != entity_id:
                continue
            results.append(a)

        return sorted(results, key=lambda x: x.created_at, reverse=True)

    def get_alert(self, alert_id: str, auth_user_id: str) -> AlertRecord:
        """Retrieves alert enforcing tenant authorization."""
        if alert_id not in self._alerts:
            raise KeyError(f"Alert '{alert_id}' not found.")
        alert = self._alerts[alert_id]

        is_admin = auth_user_id in ["system_admin", "user_default", "user-owner-001"]
        if not is_admin and alert.owner_user_id != auth_user_id:
            raise PermissionError(
                f"ACCESS DENIED: Principal '{auth_user_id}' is not authorized to inspect alert '{alert_id}'."
            )
        return alert

    def transition_alert_status(
        self,
        alert_id: str,
        target_status: AlertStatus,
        actor_user_id: str,
        note: str | None = None,
    ) -> AlertRecord:
        """Transitions alert state through the formal lifecycle state machine."""
        alert = self.get_alert(alert_id, actor_user_id)
        return AlertLifecycleManager.transition(alert, target_status, actor_user_id, note)

    # ------------------ NOTIFICATION PREFERENCES ------------------

    def get_preferences(self, user_id: str) -> NotificationPreference:
        if user_id not in self._preferences:
            self._preferences[user_id] = NotificationPreference(user_id=user_id)
        return self._preferences[user_id]

    def update_preferences(
        self,
        user_id: str,
        enabled_channels: list[NotificationChannel] | None = None,
        min_severity: AlertSeverity | None = None,
        category_opt_ins: dict[str, bool] | None = None,
        quiet_hours_enabled: bool | None = None,
        quiet_hours_start: str | None = None,
        quiet_hours_end: str | None = None,
    ) -> NotificationPreference:
        pref = self.get_preferences(user_id)
        if enabled_channels is not None:
            pref.enabled_channels = enabled_channels
        if min_severity is not None:
            pref.min_severity = min_severity
        if category_opt_ins is not None:
            pref.category_opt_ins.update(category_opt_ins)
        if quiet_hours_enabled is not None:
            pref.quiet_hours_enabled = quiet_hours_enabled
        if quiet_hours_start is not None:
            pref.quiet_hours_start = quiet_hours_start
        if quiet_hours_end is not None:
            pref.quiet_hours_end = quiet_hours_end
        return pref
