"""Automated Unit, Security, and Integration Test Suite for UrjaSetu EMS Phase 18.

Verifies:
- TC-1801: Event creation, payload schema validation, and severity policy.
- TC-1802: Idempotency and deduplication (identical conditions produce single alert, duplicate event suppressed).
- TC-1803: Alert generation from consumption spikes (rolling MAD deviation).
- TC-1804: Alert generation from sanctioned load overdraw (>130%).
- TC-1805: Alert generation from data staleness and connector failures (missing data != energy anomaly).
- TC-1806: Alert lifecycle state machine transitions (valid steps vs prohibited state jumps).
- TC-1807: User notification preferences evaluation (channel opt-ins, quiet hours suppression).
- TC-1808: Notification delivery statuses (distinguishing ACCEPTED_BY_PROVIDER from DELIVERED).
- TC-1809: Bounded retry backoff and failure exhaustion handling (max 3 attempts).
- TC-1810: Server-side authorization and cross-user alert isolation (PermissionError).
- TC-1811: AI Copilot integration (get_active_alerts and acknowledge_alert tools).
- TC-1812: End-to-end event-to-alert-to-notification delivery lifecycle.
"""

from __future__ import annotations

import pytest

from avishkar_ems.ai_copilot import AICopilotService, CopilotIntent, ToolExecutionStatus
from avishkar_ems.event_monitoring import (
    AlertLifecycleManager,
    AlertRecord,
    AlertRuleEngine,
    AlertSeverity,
    AlertStatus,
    DeliveryStatus,
    EventCategory,
    EventClassification,
    EventIdempotencyGuard,
    EventMonitoringService,
    EventRecord,
    EventSeverity,
    NotificationChannel,
    NotificationDeliveryService,
    NotificationPreference,
    ProcessingStatus,
)


def test_tc1801_event_creation_and_payload_validation() -> None:
    """TC-1801: Verifies event creation, payload schema validation, classification, and severity."""
    evt = EventRecord(
        event_id="evt_test_01",
        event_type="consumption.spike",
        event_category=EventCategory.UNUSUAL_CONSUMPTION,
        severity=EventSeverity.HIGH,
        source_service="anomaly_detector",
        entity_id="home_blr_bescom",
        rule_id="RULE-EVT-SPIKE-01",
        reporting_period="2026-03",
        payload={"observed_value": 1.25, "threshold_value": 0.85, "unit": "kWh"},
        classification=EventClassification.DETECTED_EVENT,
    )

    assert evt.event_id == "evt_test_01"
    assert evt.severity == EventSeverity.HIGH
    assert evt.classification == EventClassification.DETECTED_EVENT
    assert len(evt.idempotency_key) == 16
    assert evt.processing_status == ProcessingStatus.RECEIVED

    # Verify serialization
    d = evt.to_dict()
    assert d["event_category"] == "UNUSUAL_CONSUMPTION"
    assert d["severity"] == "HIGH"
    assert d["payload"]["observed_value"] == 1.25


def test_tc1802_idempotency_and_duplicate_suppression() -> None:
    """TC-1802: Verifies that duplicate events are suppressed and alert occurrence counts incremented."""
    service = EventMonitoringService()

    evt1 = EventRecord(
        event_id="evt_dedup_01",
        event_type="demand.overdraw",
        event_category=EventCategory.SANCTIONED_LOAD_EXCEEDED,
        severity=EventSeverity.CRITICAL,
        source_service="household_module",
        entity_id="home_blr_bescom",
        rule_id="RULE-EVT-LOAD-01",
        reporting_period="2026-03",
        payload={
            "owner_user_id": "user_default",
            "title": "Load Overdrawn 6.5 kW",
            "observed_value": 6.5,
            "threshold_value": 5.0,
            "unit": "kW",
        },
    )

    res_evt1, alert1 = service.ingest_event(evt1)
    assert res_evt1.processing_status == ProcessingStatus.PROCESSED
    assert alert1 is not None
    assert alert1.occurrence_count == 1

    # Second event with identical parameters (same entity, category, rule, period)
    evt2 = EventRecord(
        event_id="evt_dedup_02",
        event_type="demand.overdraw",
        event_category=EventCategory.SANCTIONED_LOAD_EXCEEDED,
        severity=EventSeverity.CRITICAL,
        source_service="household_module",
        entity_id="home_blr_bescom",
        rule_id="RULE-EVT-LOAD-01",
        reporting_period="2026-03",
        payload={
            "owner_user_id": "user_default",
            "title": "Load Overdrawn 6.5 kW",
            "observed_value": 6.5,
            "threshold_value": 5.0,
            "unit": "kW",
        },
    )

    res_evt2, alert2 = service.ingest_event(evt2)
    assert res_evt2.processing_status == ProcessingStatus.DUPLICATE_SUPPRESSED
    assert alert2 is not None
    assert alert2.alert_id == alert1.alert_id
    assert alert2.occurrence_count == 2  # Incremented count without duplicate alert creation


def test_tc1803_alert_generation_from_consumption_spike() -> None:
    """TC-1803: Verifies alert generation from rolling MAD consumption deviation."""
    # Historical intervals averaging 0.40 kWh, with a sudden spike to 1.10 kWh (>30% and >0.3 kWh)
    intervals = [0.35, 0.42, 0.38, 0.40, 0.41, 0.39, 1.10]
    alert = AlertRuleEngine.evaluate_consumption_spike(
        entity_id="home_blr_bescom",
        owner_user_id="user_default",
        recent_intervals_kwh=intervals,
        reporting_period="2026-03-24",
    )

    assert alert is not None
    assert alert.category == EventCategory.UNUSUAL_CONSUMPTION
    assert alert.severity in [AlertSeverity.HIGH, AlertSeverity.CRITICAL]
    assert alert.observed_value == 1.10
    assert len(alert.evidence_items) > 0
    assert alert.evidence_items[0]["rule_id"] == "RULE-EVT-SPIKE-01"
    assert "recommended_action" in alert.evidence_items[0]


def test_tc1804_alert_generation_from_sanctioned_load_overdraw() -> None:
    """TC-1804: Verifies alert generation when demand exceeds 130% of sanctioned load."""
    # 5.0 kW sanctioned capacity; drawing 7.2 kW (144% -> HIGH/CRITICAL)
    alert = AlertRuleEngine.evaluate_sanctioned_load_overdraw(
        entity_id="home_blr_bescom",
        owner_user_id="user_default",
        peak_draw_kw=7.2,
        sanctioned_load_kw=5.0,
        reporting_period="2026-03",
    )

    assert alert is not None
    assert alert.category == EventCategory.SANCTIONED_LOAD_EXCEEDED
    assert alert.severity == AlertSeverity.HIGH
    assert alert.observed_value == 7.2
    assert alert.threshold_value == 6.5  # 5.0 * 1.30


def test_tc1805_data_staleness_and_connector_failures() -> None:
    """TC-1805: Verifies that missing/stale data produces staleness events, NOT fake consumption anomalies."""
    # Source freshness check: 75 days age vs 65 days threshold
    stale_alert = AlertRuleEngine.evaluate_data_staleness(
        source_id="CEA_POWER_SUPPLY_POSITION",
        source_name="Central Electricity Authority Balance",
        observation_age_days=75.0,
        cadence_threshold_days=65.0,
        owner_user_id="system_admin",
    )

    assert stale_alert is not None
    assert stale_alert.category == EventCategory.DATA_STALENESS
    assert stale_alert.severity == AlertSeverity.MEDIUM
    assert stale_alert.evidence_items[0]["truth_in_data_invariant"] == (
        "Missing data is classified as staleness, NOT as zero consumption or fault."
    )

    # Connector failure check
    fail_alert = AlertRuleEngine.evaluate_connector_failure(
        source_id="AP_STATE_ENERGY_STATISTICS",
        source_name="AP State Energy Statistics",
        failure_reason="HTTP 502 Bad Gateway",
        owner_user_id="system_admin",
    )

    assert fail_alert.category == EventCategory.CONNECTOR_INGESTION_FAILURE
    assert fail_alert.severity == AlertSeverity.HIGH


def test_tc1806_alert_lifecycle_state_machine() -> None:
    """TC-1806: Verifies valid lifecycle state transitions and rejection of prohibited jumps."""
    alert = AlertRecord(
        alert_id="alt_life_01",
        event_id="evt_life_01",
        idempotency_key="idemp_life_01",
        entity_id="home_blr_bescom",
        owner_user_id="user_default",
        category=EventCategory.UNUSUAL_CONSUMPTION,
        severity=AlertSeverity.HIGH,
        title="Spike Alert",
        description="Spike detected",
    )

    assert alert.status == AlertStatus.OPEN

    # 1. OPEN -> ACKNOWLEDGED
    alert = AlertLifecycleManager.transition(alert, AlertStatus.ACKNOWLEDGED, "user_default", "Saw it")
    assert alert.status == AlertStatus.ACKNOWLEDGED
    assert alert.acknowledged_by == "user_default"
    assert alert.acknowledged_at is not None

    # 2. ACKNOWLEDGED -> IN_PROGRESS
    alert = AlertLifecycleManager.transition(alert, AlertStatus.IN_PROGRESS, "user_default")
    assert alert.status == AlertStatus.IN_PROGRESS

    # 3. IN_PROGRESS -> RESOLVED
    alert = AlertLifecycleManager.transition(alert, AlertStatus.RESOLVED, "user_default", "Replaced faulty heater")
    assert alert.status == AlertStatus.RESOLVED
    assert alert.resolution_note == "Replaced faulty heater"

    # 4. Prohibited jump: RESOLVED is terminal (cannot transition back to OPEN)
    with pytest.raises(ValueError, match="ILLEGAL STATE TRANSITION"):
        AlertLifecycleManager.transition(alert, AlertStatus.OPEN, "user_default")


def test_tc1807_notification_preferences_evaluation() -> None:
    """TC-1807: Verifies channel enables, minimum severity filtering, and quiet hours suppression."""
    service = NotificationDeliveryService()
    alert_med = AlertRecord(
        alert_id="alt_pref_01",
        event_id="evt_pref_01",
        idempotency_key="idemp_pref_01",
        entity_id="home_blr_bescom",
        owner_user_id="user_test",
        category=EventCategory.UNUSUAL_CONSUMPTION,
        severity=AlertSeverity.MEDIUM,
        title="Medium Anomaly",
        description="Moderate deviation",
    )

    # Preference: Only receive CRITICAL alerts
    pref_crit_only = NotificationPreference(
        user_id="user_test",
        enabled_channels=[NotificationChannel.IN_APP, NotificationChannel.EMAIL_MOCK],
        min_severity=AlertSeverity.CRITICAL,
    )

    dispatched = service.dispatch_alert_notifications(alert_med, pref_crit_only)
    assert len(dispatched) == 0  # Filtered out by min_severity

    # Preference: Enable MEDIUM alerts, but quiet hours active
    pref_quiet = NotificationPreference(
        user_id="user_test",
        enabled_channels=[NotificationChannel.IN_APP],
        min_severity=AlertSeverity.LOW,
        quiet_hours_enabled=True,
        quiet_hours_start="00:00",
        quiet_hours_end="23:59",  # Active all day
    )

    dispatched_quiet = service.dispatch_alert_notifications(alert_med, pref_quiet)
    assert len(dispatched_quiet) == 0  # Suppressed by quiet hours

    # Critical alert bypasses quiet hours
    alert_crit = AlertRecord(
        alert_id="alt_pref_02",
        event_id="evt_pref_02",
        idempotency_key="idemp_pref_02",
        entity_id="home_blr_bescom",
        owner_user_id="user_test",
        category=EventCategory.SECURITY_VIOLATION,
        severity=AlertSeverity.CRITICAL,
        title="Critical Security",
        description="Tamper detected",
    )

    dispatched_crit = service.dispatch_alert_notifications(alert_crit, pref_quiet)
    assert len(dispatched_crit) == 1
    assert dispatched_crit[0].status == DeliveryStatus.DELIVERED


def test_tc1808_delivery_status_tracking() -> None:
    """TC-1808: Verifies distinction between provider acceptance and confirmed delivery."""
    service = NotificationDeliveryService()
    # Configure mock email provider to accept without confirming final delivery
    service.configure_mock_provider_behavior(accept_only_channel=NotificationChannel.EMAIL_MOCK)

    alert = AlertRecord(
        alert_id="alt_stat_01",
        event_id="evt_stat_01",
        idempotency_key="idemp_stat_01",
        entity_id="home_blr_bescom",
        owner_user_id="user_test",
        category=EventCategory.UNUSUAL_CONSUMPTION,
        severity=AlertSeverity.HIGH,
        title="High Anomaly",
        description="Spike detected",
    )
    pref = NotificationPreference(
        user_id="user_test",
        enabled_channels=[NotificationChannel.EMAIL_MOCK],
        min_severity=AlertSeverity.LOW,
    )

    dispatched = service.dispatch_alert_notifications(alert, pref, recipient_contact="user@test.org")
    assert len(dispatched) == 1
    notif = dispatched[0]

    # Must be ACCEPTED_BY_PROVIDER, NOT DELIVERED
    assert notif.status == DeliveryStatus.ACCEPTED_BY_PROVIDER
    assert notif.provider_response_reference is not None
    assert notif.retry_eligible is False  # Invariant: Never retry accepted unconfirmed messages blindly


def test_tc1809_bounded_retry_and_dead_letter_exhaustion() -> None:
    """TC-1809: Verifies bounded exponential retries capped at 3 attempts resulting in PERMANENTLY_FAILED."""
    service = NotificationDeliveryService()
    service.configure_mock_provider_behavior(fail_channel=NotificationChannel.EMAIL_MOCK)

    alert = AlertRecord(
        alert_id="alt_retry_01",
        event_id="evt_retry_01",
        idempotency_key="idemp_retry_01",
        entity_id="home_blr_bescom",
        owner_user_id="user_test",
        category=EventCategory.UNUSUAL_CONSUMPTION,
        severity=AlertSeverity.HIGH,
        title="Spike Alert",
        description="Spike detected",
    )
    pref = NotificationPreference(
        user_id="user_test",
        enabled_channels=[NotificationChannel.EMAIL_MOCK],
    )

    dispatched = service.dispatch_alert_notifications(alert, pref)
    notif = dispatched[0]
    assert notif.status == DeliveryStatus.FAILED
    assert notif.attempt_count == 1
    assert notif.retry_eligible is True

    # Attempt 2
    notif = service.retry_failed_notification(notif.notification_id)
    assert notif.status == DeliveryStatus.FAILED
    assert notif.attempt_count == 2
    assert notif.retry_eligible is True

    # Attempt 3 (Max attempts reached -> PERMANENTLY_FAILED)
    notif = service.retry_failed_notification(notif.notification_id)
    assert notif.status == DeliveryStatus.PERMANENTLY_FAILED
    assert notif.attempt_count == 3
    assert notif.retry_eligible is False
    assert "Retry exhausted" in (notif.last_error_summary or "")


def test_tc1810_tenant_authorization_and_isolation() -> None:
    """TC-1810: Verifies cross-tenant isolation where unauthorized users raise PermissionError."""
    service = EventMonitoringService()
    # Create private alert for user_owner_a
    alert = AlertRecord(
        alert_id="alt_priv_01",
        event_id="evt_priv_01",
        idempotency_key="idemp_priv_01",
        entity_id="home_private_a",
        owner_user_id="user_owner_a",
        category=EventCategory.UNUSUAL_CONSUMPTION,
        severity=AlertSeverity.HIGH,
        title="Private Spike",
        description="Spike on private meter",
    )
    service._alerts[alert.alert_id] = alert

    # user_owner_b tries to query alerts -> receives empty list
    user_b_alerts = service.list_alerts(auth_user_id="user_owner_b")
    assert not any(a.alert_id == "alt_priv_01" for a in user_b_alerts)

    # user_owner_b tries to inspect alert directly -> raises PermissionError
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        service.get_alert("alt_priv_01", auth_user_id="user_owner_b")

    # user_owner_b tries to transition status -> raises PermissionError
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        service.transition_alert_status("alt_priv_01", AlertStatus.ACKNOWLEDGED, actor_user_id="user_owner_b")


def test_tc1811_ai_copilot_alert_investigation() -> None:
    """TC-1811: Verifies AI Copilot integration with get_active_alerts and acknowledge_alert tools."""
    copilot = AICopilotService()

    # Query for active alerts
    resp = copilot.ask(
        user_id="user_default",
        property_id="home_blr_bescom",
        query="Do I have any active alerts or notifications on my meter?",
    )

    assert resp.intent == CopilotIntent.ALERT_INVESTIGATION
    assert resp.tool_execution_status == ToolExecutionStatus.SUCCESS
    assert len(resp.evidence_items) > 0
    assert "home_blr_bescom" in resp.answer_text
    assert resp.grounding_status.value == "GROUNDED_VERIFIED"

    # Execute acknowledge_alert tool directly via tool registry
    tool_res = copilot.tool_registry.execute(
        "acknowledge_alert",
        {"alert_id": "alt_spike_blr_bescom_01", "note": "Acknowledged in test"},
        "user_default",
        ["home_blr_bescom"],
    )
    assert tool_res.status == ToolExecutionStatus.SUCCESS
    assert tool_res.data["status"] == "ACKNOWLEDGED"


def test_tc1812_end_to_end_lifecycle() -> None:
    """TC-1812: End-to-end event creation, alert processing, deduplication, notification, and resolution."""
    service = EventMonitoringService()
    now_iso = "2026-03-24T18:00:00Z"

    # Step 1: Create event
    idemp_key = EventIdempotencyGuard.compute_idempotency_key(
        "home_vskp_apepdcl", EventCategory.SANCTIONED_LOAD_EXCEEDED, "RULE-EVT-LOAD-01", "2026-03"
    )
    event = EventRecord(
        event_id="evt_e2e_01",
        event_type="demand.overdraw",
        event_category=EventCategory.SANCTIONED_LOAD_EXCEEDED,
        severity=EventSeverity.CRITICAL,
        source_service="household_module",
        entity_id="home_vskp_apepdcl",
        rule_id="RULE-EVT-LOAD-01",
        reporting_period="2026-03",
        idempotency_key=idemp_key,
        occurrence_time=now_iso,
        detection_time=now_iso,
        payload={
            "owner_user_id": "user_default",
            "title": "Demand Overdraw 5.8 kW",
            "description": "Exceeded 4.0 kW sanctioned load by 45%",
            "observed_value": 5.8,
            "threshold_value": 4.0,
            "unit": "kW",
        },
    )

    # Step 2: Ingest and generate alert
    ev_res, alert = service.ingest_event(event)
    assert ev_res.processing_status == ProcessingStatus.PROCESSED
    assert alert is not None
    assert alert.status == AlertStatus.OPEN

    # Step 3: Verify notification generated
    outbox = service.delivery_service.list_notifications(alert.alert_id)
    assert len(outbox) > 0

    # Step 4: Duplicate event arrives -> suppressed
    dup_event = EventRecord(
        event_id="evt_e2e_02",
        event_type="demand.overdraw",
        event_category=EventCategory.SANCTIONED_LOAD_EXCEEDED,
        severity=EventSeverity.CRITICAL,
        source_service="household_module",
        entity_id="home_vskp_apepdcl",
        rule_id="RULE-EVT-LOAD-01",
        reporting_period="2026-03",
        occurrence_time=now_iso,
        detection_time=now_iso,
        payload=event.payload,
    )
    dup_res, dup_alert = service.ingest_event(dup_event)
    assert dup_res.processing_status == ProcessingStatus.DUPLICATE_SUPPRESSED
    assert dup_alert is not None
    assert dup_alert.occurrence_count == 2

    # Step 5: Acknowledge and resolve
    alert_ack = service.transition_alert_status(alert.alert_id, AlertStatus.ACKNOWLEDGED, "user_default")
    assert alert_ack.status == AlertStatus.ACKNOWLEDGED

    alert_res = service.transition_alert_status(
        alert.alert_id, AlertStatus.RESOLVED, "user_default", "Load staggered"
    )
    assert alert_res.status == AlertStatus.RESOLVED
    assert alert_res.resolved_at is not None
