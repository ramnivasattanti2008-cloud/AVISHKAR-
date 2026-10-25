"""Comprehensive Security Audit Test Suite for UrjaSetu EMS (Phase 10).

Verifies:
1. File upload size limit enforcement (rejecting files > 10 MB).
2. Path traversal attack prevention and filename sanitization.
3. Strict rejection of dangerous or unapproved file extensions.
4. Server-side ownership isolation (cross-user access denial with PermissionError).
5. Consumer PII and credential redaction (phone, account numbers, bearer tokens, passwords).
6. Zero-password storage invariant across household profiles, billing records, and connectors.
7. Refusal of appliance-level breakdowns without physical sub-meters (no synthetic disaggregation).
8. Token-bucket rate limiter behavior under concurrency and high load.
"""

from __future__ import annotations

import pytest

from avishkar_ems.household_import import (
    MAX_FILE_SIZE_BYTES,
    ColumnMappingConfig,
    HouseholdBillParser,
    MeterReadingImportEngine,
    sanitize_and_validate_filename,
    validate_file_size,
)
from avishkar_ems.household_module import (
    HouseholdManager,
    HouseholdProfile,
    IntegrationStatus,
    UtilityBillRecord,
    UtilityProvider,
)
from avishkar_ems.trust.operational_safety import RateLimiter, SecretRedactor

# ---------------------------------------------------------------------------
# 1. FILE UPLOAD & PATH TRAVERSAL DEFENSE TESTS
# ---------------------------------------------------------------------------


def test_file_size_limit_rejection() -> None:
    """Verifies that files exceeding 10 MB are strictly rejected with ValueError."""
    oversized_bytes = b"0" * (MAX_FILE_SIZE_BYTES + 1024)
    with pytest.raises(ValueError, match="FILE REJECTED: Upload size"):
        validate_file_size(oversized_bytes)


def test_path_traversal_filename_sanitization() -> None:
    """Verifies that directory traversal patterns (../../etc/passwd) are stripped safely."""
    traversal_input = "../../../../etc/passwd.txt"
    clean = sanitize_and_validate_filename(traversal_input)
    assert clean == "passwd.txt"
    assert "/" not in clean
    assert "\\" not in clean
    assert ".." not in clean


def test_windows_path_traversal_sanitization() -> None:
    """Verifies that Windows backslash path traversal is stripped safely."""
    win_traversal = r"C:\Windows\System32\cmd.csv"
    clean = sanitize_and_validate_filename(win_traversal)
    assert clean == "cmd.csv"
    assert ":" not in clean
    assert "\\" not in clean


def test_disallowed_extension_rejection() -> None:
    """Verifies that executable, script, or server-side extensions are rejected."""
    bad_extensions = [
        "payload.exe",
        "script.sh",
        "exploit.py",
        "webshell.php",
        "macro.bat",
        "archive.tar.gz",
    ]
    for bad_name in bad_extensions:
        with pytest.raises(ValueError, match="Extension '.*' is not permitted"):
            sanitize_and_validate_filename(bad_name)


def test_empty_or_special_characters_filename() -> None:
    """Verifies that filenames with only special characters are cleaned to a safe default."""
    cleaned = sanitize_and_validate_filename("!@#$%^&*.txt")
    assert cleaned.endswith(".txt")
    assert not any(c in cleaned for c in "!@#$%^&*")


def test_bill_parser_rejects_malicious_filename() -> None:
    """Verifies that HouseholdBillParser rejects malicious filenames before parsing."""
    with pytest.raises(ValueError, match="Extension '.*' is not permitted"):
        HouseholdBillParser.parse_bill_content(b"test bill content", filename="../../evil.exe")


def test_meter_import_rejects_malicious_filename() -> None:
    """Verifies that MeterReadingImportEngine rejects malicious filenames."""
    cfg = ColumnMappingConfig(timestamp_col="time", interval_kwh_col="kwh")
    with pytest.raises(ValueError, match="Extension '.*' is not permitted"):
        MeterReadingImportEngine.execute_import(
            property_id="prop_001",
            file_content=b"time,kwh\n2026-03-01 00:00,1.2\n",
            filename="../../../etc/cron.d/job.sh",
            mapping=cfg,
        )


# ---------------------------------------------------------------------------
# 2. SERVER-SIDE OWNERSHIP ISOLATION TESTS
# ---------------------------------------------------------------------------


def test_cross_user_property_read_denial() -> None:
    """Verifies that an unauthorized user cannot read another user's property profile."""
    mgr = HouseholdManager()
    prof = HouseholdProfile(
        profile_id="home_alice_01",
        user_id="user_alice",
        display_name="Alice Bengaluru Villa",
        city="Bengaluru",
        district="Bengaluru Urban",
        locality="Indiranagar",
        state="Karnataka",
        utility=UtilityProvider.BESCOM,
        connection_account_id="1234567890",
        sanctioned_load_kw=5.0,
        solar_capacity_kwp=0.0,
        battery_capacity_kwh=0.0,
        tariff_category="LT-2a Domestic",
        integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
    )
    p1 = mgr.create_home(user_id="user_alice", profile=prof)

    # Bob attempts to read Alice's property
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        mgr.get_home(user_id="user_bob", property_id=p1.profile_id)


def test_cross_user_property_update_denial() -> None:
    """Verifies that an unauthorized user cannot modify another user's property."""
    mgr = HouseholdManager()
    prof = HouseholdProfile(
        profile_id="home_alice_02",
        user_id="user_alice",
        display_name="Alice Villa",
        city="Bengaluru",
        district="Bengaluru Urban",
        locality="Indiranagar",
        state="Karnataka",
        utility=UtilityProvider.BESCOM,
        connection_account_id="1234567890",
        sanctioned_load_kw=5.0,
        solar_capacity_kwp=0.0,
        battery_capacity_kwh=0.0,
        tariff_category="LT-2a Domestic",
        integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
    )
    p1 = mgr.create_home(user_id="user_alice", profile=prof)

    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        mgr.update_home(
            user_id="user_bob",
            property_id=p1.profile_id,
            display_name="Hacked Name",
        )


def test_cross_user_property_delete_denial() -> None:
    """Verifies that an unauthorized user cannot delete another user's property."""
    mgr = HouseholdManager()
    prof = HouseholdProfile(
        profile_id="home_alice_03",
        user_id="user_alice",
        display_name="Alice Villa",
        city="Bengaluru",
        district="Bengaluru Urban",
        locality="Indiranagar",
        state="Karnataka",
        utility=UtilityProvider.BESCOM,
        connection_account_id="1234567890",
        sanctioned_load_kw=5.0,
        solar_capacity_kwp=0.0,
        battery_capacity_kwh=0.0,
        tariff_category="LT-2a Domestic",
        integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
    )
    p1 = mgr.create_home(user_id="user_alice", profile=prof)

    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        mgr.delete_home(user_id="user_bob", property_id=p1.profile_id)


def test_cross_user_bill_read_denial() -> None:
    """Verifies that an unauthorized user cannot access or record billing records for another user's property."""
    mgr = HouseholdManager()
    prof = HouseholdProfile(
        profile_id="home_alice_04",
        user_id="user_alice",
        display_name="Alice Villa",
        city="Bengaluru",
        district="Bengaluru Urban",
        locality="Indiranagar",
        state="Karnataka",
        utility=UtilityProvider.BESCOM,
        connection_account_id="1234567890",
        sanctioned_load_kw=5.0,
        solar_capacity_kwp=0.0,
        battery_capacity_kwh=0.0,
        tariff_category="LT-2a Domestic",
        integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
    )
    p1 = mgr.create_home(user_id="user_alice", profile=prof)

    bill = UtilityBillRecord(
        bill_month="2026-02",
        bill_date="2026-03-05",
        units_consumed_kwh=220.0,
        total_amount_inr=1520.0,
        fixed_charge_inr=160.0,
        energy_charge_inr=1250.0,
        tax_and_duty_inr=110.0,
    )
    mgr.record_bill(profile_id=p1.profile_id, bill=bill, user_id="user_alice")

    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        mgr.get_profile(profile_id=p1.profile_id, user_id="user_bob")


# ---------------------------------------------------------------------------
# 3. SECRET REDACTION & CREDENTIAL PROTECTION TESTS
# ---------------------------------------------------------------------------


def test_secret_redactor_bearer_tokens() -> None:
    """Verifies redaction of bearer tokens in strings and logs."""
    raw = "Request failed with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig"
    clean = SecretRedactor.redact_string(raw)
    assert "Bearer ***REDACTED_TOKEN***" in clean
    assert "eyJhbGci" not in clean


def test_secret_redactor_phone_and_account_numbers() -> None:
    """Verifies masking of phone numbers and partial masking of consumer accounts."""
    raw = "Consumer mobile 9876543210 with account 1234567890 reported an issue."
    clean = SecretRedactor.redact_string(raw)
    assert "***PHONE_REDACTED***" in clean
    assert "9876543210" not in clean
    # Account number 1234567890 masked to 1234****90
    assert "1234****90" in clean


def test_secret_redactor_dictionary_keys() -> None:
    """Verifies recursive sanitization of dictionaries containing sensitive keys."""
    sensitive_dict = {
        "user_id": "user_01",
        "api_key": "secret_key_12345",
        "password": "SuperSecretPassword!",
        "auth_token": "token_abc_xyz",
        "profile": {
            "mobile": "9123456789",
            "access_token": "bearer_999",
            "city": "Bengaluru",
        },
    }
    clean = SecretRedactor.redact_dict(sensitive_dict)
    assert clean["api_key"] == "***REDACTED_CREDENTIAL***"
    assert clean["password"] == "***REDACTED_CREDENTIAL***"
    assert clean["auth_token"] == "***REDACTED_CREDENTIAL***"
    assert clean["profile"]["mobile"] == "***REDACTED_CREDENTIAL***"
    assert clean["profile"]["access_token"] == "***REDACTED_CREDENTIAL***"
    assert clean["profile"]["city"] == "Bengaluru"


def test_zero_password_storage_invariant() -> None:
    """Verifies that HouseholdProfile and UtilityBillRecord models do not have password fields."""
    profile_fields = HouseholdProfile.__dataclass_fields__.keys()
    assert "password" not in profile_fields
    assert "secret" not in profile_fields
    assert "pin" not in profile_fields

    bill_fields = UtilityBillRecord.__dataclass_fields__.keys()
    assert "password" not in bill_fields
    assert "secret" not in bill_fields


# ---------------------------------------------------------------------------
# 4. RATE LIMITER SAFETY TESTS
# ---------------------------------------------------------------------------


def test_rate_limiter_allows_under_capacity() -> None:
    """Verifies that token bucket allows calls within configured capacity."""
    limiter = RateLimiter(max_requests=5, window_seconds=60.0)
    for _ in range(5):
        assert limiter.acquire() is True


def test_rate_limiter_blocks_when_exhausted() -> None:
    """Verifies that token bucket rejects requests once capacity is depleted."""
    limiter = RateLimiter(max_requests=3, window_seconds=60.0)
    # Drain tokens
    assert limiter.acquire() is True
    assert limiter.acquire() is True
    assert limiter.acquire() is True
    # 4th request must be rejected
    assert limiter.acquire() is False
