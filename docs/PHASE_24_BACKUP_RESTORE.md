# Phase 24: UrjaSetu EMS Backup, Restore & Recovery Engineering

## 1. Data Inventory & Store Classification

UrjaSetu EMS manages three primary classes of state:

| Category | Storage Engine | Tables / Files | Sensitivity | Backup Criticality |
|---|---|---|---|---|
| **Relational & Spatial Core** | PostgreSQL 16 + PostGIS 3.4 | 31 tables (`Account`, `Property`, `MeterReading`, `TariffSchedule`, `TwinModel`, `AuditLog`, `_prisma_migrations`, etc.) | **High** (Contains salted password hashes, household addresses, electricity consumption) | **Tier 1 (Critical)**: Point-in-time recovery required |
| **Tariffs & Policy Rules** | JSON / Version Control | `data/tariffs/*.json`, `data/policy/*.json` | Low (Public regulatory data from KERC, APERC, GERC, TNERC) | **Tier 2 (Sourced)**: Tracked in git, seeded idempotently |
| **Precomputed Result Cache** | Local Filesystem / Disk | `data/cache/*.parquet`, `data/cache/*.json` | Low (Regenerated via `scripts/precompute_cache.py --rebuild`) | **Tier 3 (Disposable)**: Excluded from backups |

---

## 2. Backup Policy (Implemented & Proposed)

### Current Implemented Mechanisms
1. **Linux / Shell Backup Utility (`platform/scripts/backup-db.sh`)**:
   - Creates custom-format compressed dumps (`pg_dump -Fc`).
   - Symmetrically encrypts using OpenPGP AES-256 via GPG (`--passphrase-fd 3`).
   - Generates SHA-256 checksum file alongside the encrypted dump.
   - Fail-closed security: refuses execution without `BACKUP_PASSPHRASE` or if `gpg` is absent.
   - Deletes plaintext temporary dump immediately upon encryption.
   - Enforces automatic retention pruning (retains newest 7 backups by default).
2. **Cross-Platform Python Backup Engine (`src/avishkar_ems/release_safety.py`)**:
   - `BackupManager.create_backup(...)`: Operates across Windows, Linux, and MacOS.
   - Encrypt-then-MAC authenticated stream cipher (PBKDF2-HMAC-SHA256 CTR + HMAC-SHA256 authentication tag).
   - Computes and verifies SHA-256 hashes (`.sha256`).
   - Fails closed on empty or truncated payloads (< 32 bytes).
   - Automatic retention policy enforcement (`prune_retention(...)`).

### Proposed Operational Policy (Awaiting SRE / Stakeholder Approval)
- **Snapshot Frequency**: Full backup every 24 hours at 02:00 UTC (off-peak).
- **WAL Archiving**: Continuous Write-Ahead Log (WAL) archiving to secondary object storage (AWS S3 / Google Cloud Storage with Object Lock) to enable Point-In-Time Recovery (PITR).
- **Retention Period**:
  - Daily backups: Retained for 14 days.
  - Weekly backups: Retained for 8 weeks.
  - Monthly archives: Retained for 12 months.
- **Off-Site Storage**: Encrypted copies replicated across separate geographic cloud failure domains (e.g. AWS `ap-south-1` primary to `ap-south-2` secondary).

---

## 3. Step-by-Step Backup Procedures

### A. Shell-Based Backup (Production Linux / Docker)
```bash
# 1. Export encryption passphrase (must not be committed to disk or logged)
export BACKUP_PASSPHRASE="your-secure-operator-passphrase"

# 2. Execute backup script
./platform/scripts/backup-db.sh \
  --db avishkar \
  --host localhost \
  --port 5432 \
  --user avishkar \
  --out-dir platform/backups \
  --keep 7

# Expected output:
# === UrjaSetu EMS Database Backup ===
# Timestamp:   20261024_153000Z
# Database:    avishkar
# Destination: platform/backups/avishkar_20261024_153000Z.dump
# Encrypting backup with OpenPGP symmetric cipher...
# SHA-256:     e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
# Size:        458920 bytes
# Encrypted:   true
# Status:      SUCCESS
```

### B. Python-Native Backup (Cross-Platform / Automated SRE Job)
```python
from pathlib import Path
from avishkar_ems.release_safety import BackupManager

record = BackupManager.create_backup(
    payload=database_dump_bytes,
    out_dir=Path("platform/backups"),
    db_name="avishkar",
    passphrase=os.environ["BACKUP_PASSPHRASE"],
    retention_count=7,
)
print(f"Backup created: {record.file_path} (SHA-256: {record.sha256})")
```

---

## 4. Restore & Recovery Procedures

> [!CAUTION]
> Never restore a backup directly into a live production database. Always perform restores into an isolated throwaway database first (`avishkar_restore_test`) to verify table schemas and data integrity before pointing application traffic to it.

### Step 1: Pre-Restore Integrity Check
Verify that the backup file has not experienced bit rot or tampering:
```bash
sha256sum -c platform/backups/avishkar_20261024_153000Z.dump.gpg.sha256
```

### Step 2: Sandbox Restore Execution
```bash
export BACKUP_PASSPHRASE="your-secure-operator-passphrase"

./platform/scripts/restore-db.sh \
  --file platform/backups/avishkar_20261024_153000Z.dump.gpg \
  --db avishkar_restore_test \
  --host localhost \
  --port 5432 \
  --user avishkar \
  --create-db
```

### Step 3: Schema & Table Verification
The restore harness automatically verifies:
1. Integrity checksum match.
2. In-memory decryption into transient secure file descriptor.
3. Successful `pg_restore` execution with zero non-recoverable errors.
4. Schema count check: verifies that the target database contains $\ge 15$ public tables.
5. PostGIS extension verification: verifies `PostGIS_Version()` is active.
6. Migration verification: checks `_prisma_migrations` row count.

---

## 5. Unverified Recovery Requirements

The following disaster recovery capabilities are documented as **Architectural Proposals** and remain unverified until dedicated cloud infrastructure is provisioned:
1. **Automated Cross-Region Replication**: Physical replication to a second cloud region or cloud provider is not configured in local development.
2. **Point-In-Time Continuous WAL Replay**: Requires continuous archiving setup in `postgresql.conf` (`archive_mode = on`, `archive_command = 'test ! -f /mnt/wal/%f && cp %p /mnt/wal/%f'`).
3. **Automated Failover Orchestrator**: High-availability clustering (Patroni / PgBouncer / Cloud SQL HA) requires production orchestration.
