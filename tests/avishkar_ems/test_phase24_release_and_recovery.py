"""Automated Test Suite for Phase 24: UrjaSetu EMS Release Engineering, Backup/Restore & Safety.

Test cases TC-2401 through TC-2413 validate:
- Canonical configuration inventory definitions and secret labeling
- Fail-closed startup validation for missing or malformed production configuration
- Rejection of default placeholder secrets in production
- Detection and prevention of client-side leaks (NEXT_PUBLIC_ secrets)
- Secret hygiene and log sanitization of connection strings and bearer tokens
- Backup creation, SHA-256 integrity calculation, and non-empty enforcement
- Symmetric encryption/decryption with authenticated envelope and tamper detection
- Backup retention policy pruning
- Restore validation drills against isolated payloads
- Tampered and corrupted backup detection
- Prisma database migration safety inspection
- Rollback decision matrix evaluation
- RPO and RTO compliance benchmarking
"""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from avishkar_ems.release_safety import (
    SYSTEM_CONFIG_INVENTORY,
    BackupManager,
    ConfigEnvironmentManager,
    EnvironmentTier,
    MigrationSafetyAuditor,
    RecoveryBenchmark,
    RestoreValidator,
    RollbackAction,
    RollbackDecisionEngine,
    SecretHygieneScanner,
    decrypt_payload,
    encrypt_payload,
)


def test_tc2401_canonical_config_inventory_completeness() -> None:
    """TC-2401: Verify configuration inventory completeness and secret labeling."""
    var_names = {v.name for v in SYSTEM_CONFIG_INVENTORY}
    required_names = {
        "NODE_ENV",
        "DATABASE_URL",
        "SESSION_SECRET",
        "COOKIE_SECURE",
        "ENGINE_URL",
        "ENGINE_API_KEY",
        "PROVIDER_USER_AGENT",
        "API_URL",
        "ANTHROPIC_API_KEY",
        "JOBS_ENABLED",
    }
    assert required_names.issubset(var_names)

    # Verify sensitive flags
    secrets_map = {v.name: v.is_secret for v in SYSTEM_CONFIG_INVENTORY}
    assert secrets_map["DATABASE_URL"] is True
    assert secrets_map["SESSION_SECRET"] is True
    assert secrets_map["ENGINE_API_KEY"] is True
    assert secrets_map["ANTHROPIC_API_KEY"] is True
    assert secrets_map["NODE_ENV"] is False
    assert secrets_map["COOKIE_SECURE"] is False


def test_tc2402_fail_closed_missing_production_config() -> None:
    """TC-2402: Production environment fails closed when required variables are absent."""
    report = ConfigEnvironmentManager.validate_environment({}, tier=EnvironmentTier.PRODUCTION)
    assert report.is_valid is False
    assert "DATABASE_URL" in report.missing_required
    assert "SESSION_SECRET" in report.missing_required
    assert "ENGINE_API_KEY" in report.missing_required
    assert "PROVIDER_USER_AGENT" in report.missing_required
    assert report.correlation_id.startswith("corr_")


def test_tc2403_reject_placeholder_secrets_in_production() -> None:
    """TC-2403: Rejects development placeholder credentials in production environments."""
    dummy_prod_env = {
        "NODE_ENV": "production",
        "DATABASE_URL": "postgresql://avishkar:CHANGE_ME_TO_A_STRONG_RANDOM_PASSWORD@localhost:5432/avishkar",
        "SESSION_SECRET": "ci-session-secret-0123456789abcdef-0123456789",
        "COOKIE_SECURE": "true",
        "ENGINE_URL": "http://127.0.0.1:8090",
        "ENGINE_API_KEY": "ci-engine-key-0123456789abcdef",
        "PROVIDER_USER_AGENT": "UrjaSetuEMS/1.0 (+https://example.invalid)",
        "API_URL": "http://127.0.0.1:8080",
    }
    report = ConfigEnvironmentManager.validate_environment(dummy_prod_env, tier=EnvironmentTier.PRODUCTION)
    assert report.is_valid is False
    assert "DATABASE_URL" in report.placeholder_secrets
    assert "SESSION_SECRET" in report.placeholder_secrets
    assert "ENGINE_API_KEY" in report.placeholder_secrets


def test_tc2404_detect_leaked_public_secrets() -> None:
    """TC-2404: Rejects sensitive credentials exposed under NEXT_PUBLIC_ prefixes."""
    leaked_env = {
        "NODE_ENV": "production",
        "DATABASE_URL": "postgresql://avishkar:ValidRealPassword123!@localhost:5432/avishkar",
        "SESSION_SECRET": "a" * 48,
        "COOKIE_SECURE": "true",
        "ENGINE_URL": "http://127.0.0.1:8090",
        "ENGINE_API_KEY": "b" * 24,
        "PROVIDER_USER_AGENT": "UrjaSetuEMS/1.0 (+https://urjasetu.gov.in)",
        "API_URL": "http://127.0.0.1:8080",
        "NEXT_PUBLIC_DATABASE_PASSWORD": "secret_database_password",
        "NEXT_PUBLIC_SESSION_SECRET": "leaked_session_key",
    }
    report = ConfigEnvironmentManager.validate_environment(leaked_env, tier=EnvironmentTier.PRODUCTION)
    assert report.is_valid is False
    assert "NEXT_PUBLIC_DATABASE_PASSWORD" in report.leaked_public_secrets
    assert "NEXT_PUBLIC_SESSION_SECRET" in report.leaked_public_secrets


def test_tc2405_secret_hygiene_and_log_sanitization() -> None:
    """TC-2405: Sanitizes embedded database passwords and bearer tokens from logs."""
    raw_log = "Error connecting to postgresql://user:SuperSecretPassword123!@db.internal:5432/avishkar with Bearer abc.def.ghi"
    sanitized = SecretHygieneScanner.sanitize_string(raw_log)
    assert "SuperSecretPassword123!" not in sanitized
    assert "abc.def.ghi" not in sanitized
    assert "***REDACTED_PASSWORD***" in sanitized
    assert "***REDACTED_TOKEN***" in sanitized

    # Environment dictionary sanitization
    env = {
        "PORT": "8080",
        "SESSION_SECRET": "secret_session_token_xyz",
        "API_KEY": "sk-1234567890abcdef",
    }
    safe_env = SecretHygieneScanner.sanitize_env_dict(env)
    assert safe_env["PORT"] == "8080"
    assert safe_env["SESSION_SECRET"] == "***REDACTED_SECRET***"
    assert safe_env["API_KEY"] == "***REDACTED_SECRET***"


def test_tc2406_backup_creation_and_sha256_checksum() -> None:
    """TC-2406: Creates backup archive, calculates SHA-256 checksum, and generates audit record."""
    with TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir)
        payload = {"tables": {"users": 10, "meters": 50, "tariffs": 5}, "version": "1.0.0"}

        record = BackupManager.create_backup(
            payload=payload,
            out_dir=out_path,
            db_name="test_ems",
            passphrase=None,
            retention_count=5,
        )

        assert record.status == "SUCCESS"
        assert record.is_encrypted is False
        assert Path(record.file_path).exists()
        assert Path(record.checksum_path).exists()
        assert record.sha256 != ""

        # Verify checksum on disk matches record
        checksum_content = Path(record.checksum_path).read_text(encoding="utf-8")
        assert record.sha256 in checksum_content


def test_tc2407_backup_encryption_and_integrity_verification() -> None:
    """TC-2407: Authenticated PBKDF2-HMAC encryption and decryption."""
    data = b"PostgreSQL database table dump data with consumer meters and tariffs"
    passphrase = "OperatorStrongReleasePassphrase2026!"

    encrypted = encrypt_payload(data, passphrase)
    assert encrypted.startswith(b"URJABACKUP\x01")
    assert data not in encrypted

    # Successful decryption
    decrypted = decrypt_payload(encrypted, passphrase)
    assert decrypted == data

    # Failure with incorrect passphrase
    with pytest.raises(ValueError, match="Decryption failed"):
        decrypt_payload(encrypted, "WrongPassphrase123")

    # Failure with tampered ciphertext (bit flip)
    tampered = bytearray(encrypted)
    tampered[-5] ^= 0xFF
    with pytest.raises(ValueError, match="Decryption failed"):
        decrypt_payload(bytes(tampered), passphrase)


def test_tc2408_retention_pruning_policy() -> None:
    """TC-2408: Prunes old backups beyond retention count threshold."""
    with TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir)

        # Create 8 backup files with fake chronological timestamps
        for i in range(8):
            filename = f"avishkar_20261024_1000{i:02d}Z.dump"
            (out_path / filename).write_text(f"dummy dump data {i}", encoding="utf-8")
            (out_path / f"{filename}.sha256").write_text(f"hash{i} {filename}", encoding="utf-8")

        # Keep only newest 3
        pruned = BackupManager.prune_retention(out_path, "avishkar", keep_count=3)
        assert len(pruned) == 5

        # Verify only 3 dumps remain
        remaining = list(out_path.glob("avishkar_*.dump"))
        assert len(remaining) == 3


def test_tc2409_restore_drill_isolated_verification() -> None:
    """TC-2409: Executes isolated restore drill verifying checksum and minimum tables."""
    with TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir)

        # Mock payload with 20 tables
        payload = {
            "tables": {f"table_{i}": [{"id": 1}] for i in range(20)},
            "migrations": ["20261007094916_foundation", "20261007095707_reference_status"],
        }

        record = BackupManager.create_backup(
            payload=payload,
            out_dir=out_path,
            db_name="drill_db",
            passphrase="DrillPassphrase123!",
        )

        drill_res = RestoreValidator.execute_drill(
            backup_path=Path(record.file_path),
            passphrase="DrillPassphrase123!",
            min_expected_tables=15,
        )

        assert drill_res.is_successful is True
        assert drill_res.verified_checksum is True
        assert drill_res.decrypted_successfully is True
        assert drill_res.table_count == 20
        assert drill_res.migration_count == 2
        assert drill_res.elapsed_ms > 0
        assert drill_res.error_message is None


def test_tc2410_detect_corrupt_or_tampered_backup_drill() -> None:
    """TC-2410: Fails restore drill immediately if SHA-256 checksum fails."""
    with TemporaryDirectory() as tmp_dir:
        out_path = Path(tmp_dir)
        payload = {"tables": {"t1": []}}

        record = BackupManager.create_backup(
            payload=payload,
            out_dir=out_path,
            db_name="tamper_db",
            passphrase=None,
        )

        # Corrupt the file on disk without updating checksum
        with open(record.file_path, "ab") as f:
            f.write(b"CORRUPTED_BYTES_APPENDED")

        drill_res = RestoreValidator.execute_drill(
            backup_path=Path(record.file_path),
            passphrase=None,
        )

        assert drill_res.is_successful is False
        assert drill_res.verified_checksum is False
        assert "Checksum mismatch" in str(drill_res.error_message)


def test_tc2411_migration_safety_auditor() -> None:
    """TC-2411: Inspects real Prisma migrations directory for lockfile and non-destructive schema."""
    migrations_dir = Path("platform/api/prisma/migrations")
    assert migrations_dir.exists(), "Platform prisma migrations directory must exist"

    report = MigrationSafetyAuditor.audit_directory(migrations_dir)
    assert report.total_migrations == 12
    assert report.lockfile_present is True
    # The committed migrations are additive and non-destructive
    assert report.is_safe is True
    assert len([f for f in report.findings if f.risk_level == "HIGH"]) == 0


def test_tc2412_rollback_decision_engine() -> None:
    """TC-2412: Evaluates rollback decisions across diverse failure scenarios."""
    # Scenario 1: State/data corrupted -> Database restore required
    d1 = RollbackDecisionEngine.evaluate(
        target_version="v1.1.0",
        current_version="v1.2.0",
        has_new_migrations=False,
        migration_is_destructive=False,
        database_data_corrupted=True,
    )
    assert d1.recommended_action == RollbackAction.DATABASE_RESTORE_REQUIRED
    assert d1.can_revert_code_only is False

    # Scenario 2: Destructive migration -> Forward-fix required
    d2 = RollbackDecisionEngine.evaluate(
        target_version="v1.1.0",
        current_version="v1.2.0",
        has_new_migrations=True,
        migration_is_destructive=True,
        database_data_corrupted=False,
    )
    assert d2.recommended_action == RollbackAction.FORWARD_FIX_REQUIRED
    assert d2.can_revert_code_only is False

    # Scenario 3: Additive expand migration -> Safe code revert
    d3 = RollbackDecisionEngine.evaluate(
        target_version="v1.1.0",
        current_version="v1.2.0",
        has_new_migrations=True,
        migration_is_destructive=False,
        database_data_corrupted=False,
    )
    assert d3.recommended_action == RollbackAction.SAFE_APP_REVERT
    assert d3.can_revert_code_only is True

    # Scenario 4: Code-only defect without migrations -> Safe code revert
    d4 = RollbackDecisionEngine.evaluate(
        target_version="v1.1.0",
        current_version="v1.2.0",
        has_new_migrations=False,
        migration_is_destructive=False,
        database_data_corrupted=False,
    )
    assert d4.recommended_action == RollbackAction.SAFE_APP_REVERT
    assert d4.can_revert_code_only is True


def test_tc2413_recovery_objectives_rpo_and_rto_benchmarks() -> None:
    """TC-2413: Benchmarks RPO and RTO compliance against proposed targets."""
    benchmark = RecoveryBenchmark(proposed_rpo_seconds=3600, proposed_rto_seconds=1800)

    # 1. Fresh backup (15 mins old) with 4.5s drill time -> Compliant
    res_compliant = benchmark.evaluate_compliance(
        last_backup_age_seconds=900.0,
        drill_time_seconds=4.5,
    )
    assert res_compliant["rpo_met"] is True
    assert res_compliant["rto_met"] is True

    # 2. Stale backup (2 hours old) -> RPO violation
    res_stale = benchmark.evaluate_compliance(
        last_backup_age_seconds=7200.0,
        drill_time_seconds=10.0,
    )
    assert res_stale["rpo_met"] is False
    assert res_stale["rto_met"] is True
