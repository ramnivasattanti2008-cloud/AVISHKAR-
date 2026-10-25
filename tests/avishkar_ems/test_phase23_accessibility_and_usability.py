"""Phase 23 Automated Test Suite: Accessibility, Usability & Operational Support.

Tests:
- TC-2301: Standardized Diagnostic Error Taxonomy & Correlation ID Generation
- TC-2302: Secret and PII Redaction in Error Diagnostics
- TC-2303: Multi-Modal Status Badges (Never Color Alone Invariant)
- TC-2304: Plain-Language Energy Terminology Glossary & Search
- TC-2305: Accessible Tabular Data Alternatives for Charts
- TC-2306: Anti-Duplicate Submission / Debounce Guard
- TC-2307: Safe User-Facing Error Messages (No Stack Traces / DB Leaks)
- TC-2308: Multi-Modal Data Provenance Labeling
- TC-2309: Form Input Validation Error Guidance
- TC-2310: Contextual Explanation Card Formatting
- TC-2311: Audit Log and Structured Error Telemetry Serialization
- TC-2312: End-to-End Usability, Recovery & Support Workflow Integration
"""

from __future__ import annotations

import time

from avishkar_ems.accessibility_support import (
    AccessibleTableGenerator,
    AntiDuplicateGuard,
    DiagnosticErrorRegistry,
    EnergyGlossary,
    ErrorCategory,
    MultiModalStatusRegistry,
)

# ------------------ TC-2301: DIAGNOSTIC ERROR TAXONOMY & CORRELATION IDS ------------------


def test_tc2301_diagnostic_error_taxonomy_and_correlation_ids() -> None:
    """TC-2301: Verifies standardized error codes, correlation IDs, and actionable guidance."""
    codes_to_test = [
        ("ERR_AUTH_UNAUTHORIZED", ErrorCategory.AUTHENTICATION_AUTHORIZATION),
        ("ERR_TARIFF_NOT_FOUND", ErrorCategory.RESOURCE_NOT_FOUND),
        ("ERR_PROPERTY_NOT_FOUND", ErrorCategory.RESOURCE_NOT_FOUND),
        ("ERR_INVALID_FILE_TYPE", ErrorCategory.INPUT_VALIDATION),
        ("ERR_NEGATIVE_CONSUMPTION", ErrorCategory.INPUT_VALIDATION),
        ("ERR_SIMULATION_BOUNDARY_EXCEEDED", ErrorCategory.SIMULATION_BOUNDARY),
        ("ERR_CONNECTOR_TIMEOUT", ErrorCategory.EXTERNAL_DATA_PROVIDER),
        ("ERR_SERVICE_DEGRADED", ErrorCategory.SYSTEM_DEGRADED),
    ]

    for code, expected_cat in codes_to_test:
        rec = DiagnosticErrorRegistry.create(code, technical_detail="Internal detail")
        assert rec.error_code == code
        assert rec.category == expected_cat
        assert rec.correlation_id.startswith("corr_")
        assert len(rec.correlation_id) > 6
        assert len(rec.safe_user_message) > 10
        assert len(rec.suggested_action) > 10
        assert rec.support_reference_url.startswith("/docs/help")

        # Verify formatted alert contains code, message, and correlation ID
        alert_md = rec.format_accessible_alert()
        assert code in alert_md
        assert rec.correlation_id in alert_md
        assert rec.suggested_action in alert_md


# ------------------ TC-2302: SECRET & PII REDACTION IN ERROR DIAGNOSTICS ------------------


def test_tc2302_secret_and_pii_redaction_in_diagnostics() -> None:
    """TC-2302: Verifies secrets, tokens, phone numbers, and stack traces are redacted from error logs."""
    leaky_detail = (
        'Error connecting to db with password="SuperSecret123!" and Bearer eyJhbGciOiJIUzI1Ni. '
        'Contact phone: 9876543210. User consumer account 1234567890. '
        'File "app/service.py", line 42, in execute_query'
    )

    rec = DiagnosticErrorRegistry.create("ERR_SERVICE_DEGRADED", technical_detail=leaky_detail)

    # Secrets and PII must be sanitized
    assert "SuperSecret123!" not in rec.technical_detail_redacted
    assert "Bearer eyJhbGci" not in rec.technical_detail_redacted
    assert "9876543210" not in rec.technical_detail_redacted
    assert "1234567890" not in rec.technical_detail_redacted

    # Redaction placeholders present
    assert "***REDACTED_TOKEN***" in rec.technical_detail_redacted
    assert "***PHONE_REDACTED***" in rec.technical_detail_redacted
    assert "1234****90" in rec.technical_detail_redacted
    assert "[internal stack frame redacted]" in rec.technical_detail_redacted


# ------------------ TC-2303: MULTI-MODAL STATUS INDICATORS (NEVER COLOR ALONE) ------------------


def test_tc2303_multi_modal_status_indicators_non_color_rule() -> None:
    """TC-2303: Verifies that status is NEVER communicated by color alone (WCAG 2.2 AA 1.4.1)."""
    statuses = [
        "HEALTHY",
        "DELAYED_STALE",
        "DEGRADED",
        "FAILED",
        "CRITICAL",
        "HIGH",
        "MEDIUM",
        "LOW",
        "OPEN",
        "ACKNOWLEDGED",
        "RESOLVED",
        "MEASURED",
        "IMPORTED",
        "USER_SUPPLIED",
        "DERIVED",
        "ASSUMED",
    ]

    for s in statuses:
        ind = MultiModalStatusRegistry.get(s)
        assert ind.status_code == s
        # 1. Unambiguous textual label
        assert len(ind.label) >= 3
        # 2. Distinct non-empty symbol / icon
        assert len(ind.symbol) >= 1
        # 3. Screen-reader accessible explanation
        assert len(ind.accessible_description) > 5
        # 4. Badge text has both symbol and label
        badge = ind.format_badge_text()
        assert ind.symbol in badge
        assert ind.label in badge

        # 5. HTML contains role="status" and sr-only explanation
        html_out = ind.format_accessible_html()
        assert 'role="status"' in html_out
        assert 'class="sr-only"' in html_out
        assert ind.accessible_description in html_out

    # Fallback behavior for unknown status
    unknown = MultiModalStatusRegistry.get("CUSTOM_UNKNOWN_STATE")
    assert unknown.status_code == "CUSTOM_UNKNOWN_STATE"
    assert unknown.label == "Custom Unknown State"
    assert unknown.symbol == "•"


# ------------------ TC-2304: PLAIN-LANGUAGE ENERGY GLOSSARY & SEARCH ------------------


def test_tc2304_energy_glossary_lookup_and_search() -> None:
    """TC-2304: Verifies plain-language definitions, consumer examples, and search functionality."""
    # 1. Direct key lookups
    kwh_entry = EnergyGlossary.get("kwh")
    assert kwh_entry is not None
    assert kwh_entry.abbreviation == "kWh"
    assert "1,000 watts" in kwh_entry.plain_explanation
    assert len(kwh_entry.consumer_example) > 10

    cfa_entry = EnergyGlossary.get("pm_surya_ghar")
    assert cfa_entry is not None
    assert "PM Surya Ghar" in cfa_entry.term
    assert "78,000" in cfa_entry.consumer_example

    # 2. Search capabilities
    solar_results = EnergyGlossary.search("solar")
    assert len(solar_results) >= 2
    terms = [e.term for e in solar_results]
    assert "PM Surya Ghar CFA Subsidy" in terms or "Capacity Utilization Factor" in terms

    # Non-existent term
    assert EnergyGlossary.get("completely_non_existent_term_123") is None
    assert EnergyGlossary.search("xyznonexistentterm") == []


# ------------------ TC-2305: ACCESSIBLE TABULAR CHART ALTERNATIVES ------------------


def test_tc2305_accessible_tabular_chart_alternatives() -> None:
    """TC-2305: Verifies that time-series charts provide accessible markdown/tabular alternatives."""
    timestamps = ["2026-03-01", "2026-03-02", "2026-03-03"]
    values = [12.45, 14.80, 11.20]

    table_md = AccessibleTableGenerator.generate_markdown_table(
        title="Daily Residential Consumption",
        time_column_name="Date",
        value_column_name="Energy",
        timestamps=timestamps,
        values=values,
        unit="kWh",
        provenance_label="MEASURED (METER)",
    )

    assert "### 📋 Tabular Data Alternative: Daily Residential Consumption" in table_md
    assert "| Date | Energy (kWh) | Data Provenance |" in table_md
    assert "| 2026-03-01 | 12.45 | MEASURED (METER) |" in table_md
    assert "| 2026-03-03 | 11.20 | MEASURED (METER) |" in table_md

    # Mismatched lengths return fallback warning
    bad_table = AccessibleTableGenerator.generate_markdown_table(
        title="Broken",
        time_column_name="Date",
        value_column_name="Val",
        timestamps=["2026-03-01"],
        values=[1.0, 2.0],
    )
    assert "No data points available" in bad_table


# ------------------ TC-2306: ANTI-DUPLICATE SUBMISSION / DEBOUNCE GUARD ------------------


def test_tc2306_anti_duplicate_submission_debounce_guard() -> None:
    """TC-2306: Verifies that actions cannot be accidentally triggered twice within the debounce window."""
    guard = AntiDuplicateGuard(debounce_window_seconds=1.0)

    action = "execute_solar_simulation"
    user_a = "user_indiranagar"
    user_b = "user_visakhapatnam"

    # User A: first click succeeds
    assert guard.try_acquire(action, user_id=user_a) is True

    # User A: immediate second click within 1.0s is blocked
    assert guard.try_acquire(action, user_id=user_a) is False

    # User B: independent user is not blocked
    assert guard.try_acquire(action, user_id=user_b) is True

    # Wait for debounce window to expire
    time.sleep(1.05)

    # User A: can submit again after window expires
    assert guard.try_acquire(action, user_id=user_a) is True


# ------------------ TC-2307: SAFE USER-FACING ERROR MESSAGES (NO INTERNAL LEAKS) ------------------


def test_tc2307_safe_user_facing_error_messages_no_stack_traces() -> None:
    """TC-2307: Verifies unexpected internal exceptions return safe, non-revealing messages."""
    raw_db_error = "psycopg2.OperationalError: could not connect to server: Connection refused (0x0000274D/10061)"

    rec = DiagnosticErrorRegistry.create("UNKNOWN_INTERNAL_CRASH", technical_detail=raw_db_error)

    # User message must be friendly and actionable
    assert "An unexpected error occurred" in rec.safe_user_message
    assert "psycopg2" not in rec.safe_user_message
    assert "Connection refused" not in rec.safe_user_message
    assert rec.category == ErrorCategory.UNEXPECTED_INTERNAL
    assert rec.correlation_id.startswith("corr_")


# ------------------ TC-2308: MULTI-MODAL DATA PROVENANCE LABELING ------------------


def test_tc2308_multi_modal_data_provenance_labeling() -> None:
    """TC-2308: Verifies data provenance badges use symbols, text, and accessible descriptions."""
    prov_tiers = ["MEASURED", "IMPORTED", "USER_SUPPLIED", "DERIVED", "ASSUMED"]

    for p in prov_tiers:
        ind = MultiModalStatusRegistry.get(p)
        assert ind.symbol in ["📊", "📥", "👤", "🧮", "📐"]
        assert ind.label != ""
        assert len(ind.accessible_description) > 10


# ------------------ TC-2309: FORM INPUT VALIDATION ERROR GUIDANCE ------------------


def test_tc2309_form_input_validation_error_guidance() -> None:
    """TC-2309: Verifies structured input validation errors include helpful remediation steps."""
    neg_err = DiagnosticErrorRegistry.create("ERR_NEGATIVE_CONSUMPTION")
    assert "cannot be negative" in neg_err.safe_user_message
    assert "valid positive consumption" in neg_err.suggested_action

    file_err = DiagnosticErrorRegistry.create("ERR_INVALID_FILE_TYPE")
    assert "format is not supported" in file_err.safe_user_message
    assert ".pdf, .csv" in file_err.suggested_action


# ------------------ TC-2310: CONTEXTUAL EXPLANATION CARD FORMATTING ------------------


def test_tc2310_contextual_explanation_card_formatting() -> None:
    """TC-2310: Verifies formatted glossary cards render structured markdown."""
    entry = EnergyGlossary.get("tariff_slab")
    assert entry is not None

    card = entry.format_accessible_card()
    assert "### 📖 Telescopic Tariff Slab (Slab)" in card
    assert "**In Plain Language:**" in card
    assert "**Real-World Example:**" in card
    assert "Category: TARIFFS" in card


# ------------------ TC-2311: AUDIT LOG AND ERROR TELEMETRY SERIALIZATION ------------------


def test_tc2311_audit_log_and_structured_error_telemetry_serialization() -> None:
    """TC-2311: Verifies diagnostic errors serialize cleanly for audit logging and support tickets."""
    rec = DiagnosticErrorRegistry.create(
        "ERR_TARIFF_NOT_FOUND",
        technical_detail="Schedule 'UNKNOWN_2026' not in AuthoritativeTariffEngine",
    )

    d = rec.to_dict()
    assert isinstance(d, dict)
    assert d["error_code"] == "ERR_TARIFF_NOT_FOUND"
    assert d["category"] == "RESOURCE_NOT_FOUND"
    assert d["correlation_id"] == rec.correlation_id
    assert "UNKNOWN_2026" in d["technical_detail_redacted"]
    assert "timestamp" in d


# ------------------ TC-2312: END-TO-END USABILITY, RECOVERY & SUPPORT INTEGRATION ------------------


def test_tc2312_end_to_end_usability_workflow_integration() -> None:
    """TC-2312: Simulates an end-to-end user journey encountering an error, consulting the glossary, and recovering."""
    # 1. User attempts to configure simulation with out-of-bounds parameters
    param_solar = 120.0  # > 50 kWp max limit
    assert param_solar > 50.0

    # 2. Application generates accessible diagnostic error record
    diag = DiagnosticErrorRegistry.create(
        "ERR_SIMULATION_BOUNDARY_EXCEEDED",
        technical_detail=f"Requested solar_capacity_kwp={param_solar} > max_allowed=50.0",
    )
    assert diag.error_code == "ERR_SIMULATION_BOUNDARY_EXCEEDED"
    alert = diag.format_accessible_alert()
    assert "exceed physical engineering limits" in alert

    # 3. User accesses plain-language glossary to understand solar capacity & subsidy
    cfa = EnergyGlossary.get("pm_surya_ghar")
    assert cfa is not None
    assert "78,000" in cfa.consumer_example

    # 4. User corrects parameter to 3.0 kWp and retries safely
    corrected_solar = 3.0
    assert 0.1 <= corrected_solar <= 50.0

    # 5. Anti-duplicate submission guard permits corrected action
    guard = AntiDuplicateGuard()
    assert guard.try_acquire("run_simulation_3kwp") is True

    # 6. Status is reported multi-modally
    status = MultiModalStatusRegistry.get("HEALTHY")
    assert "✅" in status.format_badge_text()
    assert "Healthy" in status.format_badge_text()
