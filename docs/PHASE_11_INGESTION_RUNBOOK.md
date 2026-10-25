# UrjaSetu EMS — Phase 11 Ingestion Operations Runbook

> **Standard**: Production Operations, Failure Recovery & Data Ingestion Runbook  
> **Status**: Verified Operational Runbook  
> **Date**: 2026-10-24  
> **Auditor**: Antigravity Data Platform & Security Engineering  

---

## 1. System Overview & Ingestion Architecture

The **UrjaSetu Energy Management System (EMS)** ingestion subsystem coordinates automated, scheduled, and on-demand synchronization of official Indian public energy data, meteorological models, and distribution licensee statistics.

### Components
1. **`BaseEnergyConnector`**: Typed interface enforcing config validation, access check, raw fetch, schema validation, record parsing, canonical normalization, and idempotent persistence.
2. **`IdempotentIngestionEngine`**: Ensures duplicate-safe storage, composite key indexing, and versioned official provider revision recording.
3. **`IngestionScheduler`**: Thread-safe background orchestrator with mutex concurrency locks preventing duplicate execution of the same connector.
4. **`DataSourceHealthCenter`**: Centralized operational observability engine providing telemetry, freshness classification, latency tracking, and error redaction.
5. **`SecretRedactor`**: Strips passwords, auth tokens, API keys, and private consumer connection numbers from logs and diagnostics.

---

## 2. On-Demand Connector Synchronization

Authorized operators can invoke connector ingestion on demand through the Python runtime API or administrative CLI scripts.

### 2.1. Python Programmatic Ingestion

```python
from avishkar_ems.trust.connectors import (
    OpenMeteoSolarConnector,
    NasaPowerConnector,
    ApEnergyConnector,
    BescomHistoricalConnector,
    NppGenerationConnector,
)
from avishkar_ems.trust.idempotent_ingestion import IdempotentIngestionEngine
from avishkar_ems.trust.source_registry import SourceRegistry

# 1. Initialize persistent or in-memory idempotent engine
engine = IdempotentIngestionEngine()

# 2. Instantiate verified connector from authoritative registry
source_record = SourceRegistry.get_source("NASA_POWER_SOLAR")
connector = NasaPowerConnector(source_record, lat=12.9716, lon=77.5946)

# 3. Execute synchronized ingestion with full audit summary
summary, results = connector.ingest_with_summary(engine)

print(f"Run ID: {summary.run_id}")
print(f"Status: {summary.status}")
print(f"Records Retrieved: {summary.retrieved_count}")
print(f"Records Accepted: {summary.accepted_count}")
print(f"Records Skipped: {summary.skipped_count}")
print(f"Duration: {summary.duration_ms:.2f} ms")
```

### 2.2. Batch Execution Across All Connectors

```python
from avishkar_ems.trust.ingestion_scheduler import IngestionScheduler
from avishkar_ems.trust.idempotent_ingestion import IdempotentIngestionEngine
from avishkar_ems.trust.source_registry import SourceRegistry
from avishkar_ems.trust.connectors import (
    OpenMeteoSolarConnector,
    NasaPowerConnector,
    BescomHistoricalConnector,
    ApEnergyConnector,
    NppGenerationConnector,
)

engine = IdempotentIngestionEngine()
scheduler = IngestionScheduler()

# Register connectors with appropriate cadence
scheduler.register_connector(
    "OPEN_METEO_SOLAR", "HOURLY",
    lambda: OpenMeteoSolarConnector(SourceRegistry.get_source("OPEN_METEO_SOLAR")),
    engine, is_automated=True
)
scheduler.register_connector(
    "NASA_POWER_SOLAR", "MONTHLY",
    lambda: NasaPowerConnector(SourceRegistry.get_source("NASA_POWER_SOLAR")),
    engine, is_automated=True
)
scheduler.register_connector(
    "BESCOM_OPENCITY_HISTORICAL", "MANUAL",
    lambda: BescomHistoricalConnector(SourceRegistry.get_source("BESCOM_OPENCITY_HISTORICAL")),
    engine, is_automated=False
)

# Trigger immediate authorized sync
summary = scheduler.trigger_sync("NASA_POWER_SOLAR", operator_id="OPS_ENGINEER_01")
assert summary.status == "COMPLETED"
```

---

## 3. Scheduled Background Ingestion (`IngestionScheduler`)

### 3.1. Mutex Concurrency Protection

To prevent race conditions, database deadlocks, and duplicate API quota consumption, `IngestionScheduler` enforces a strict thread-safe mutex lock:

```python
# If an ingestion run is already executing for 'OPEN_METEO_SOLAR':
try:
    scheduler.trigger_sync("OPEN_METEO_SOLAR")
except RuntimeError as exc:
    # Raises: CONCURRENCY VIOLATION: An ingestion run for source 'OPEN_METEO_SOLAR'
    # is already actively executing. Concurrent duplicate runs are prohibited.
    pass
```

### 3.2. Automated Polling Loop

When running in daemon mode:

```python
import time

# Periodic tick (e.g. executed via systemd, Windows Task Scheduler, or worker loop)
while True:
    summaries = scheduler.run_pending_jobs()
    for s in summaries:
        print(f"[{s.completion_time.isoformat()}] Source {s.source_id} -> {s.status} ({s.accepted_count} observations)")
    time.sleep(300)  # Check every 5 minutes
```

---

## 4. Failure Recovery & Error Diagnostics

### 4.1. Network Timeouts & Rate Limits (HTTP 429)

- **Root Cause**: Provider API throttling (e.g. Open-Meteo burst limits) or transient gateway timeout.
- **Automated Mitigation**: `BaseEnergyConnector.execute_with_retry()` automatically applies exponential backoff:
  - Attempt 1: Immediate.
  - Attempt 2: $0.5\text{s}$ delay.
  - Attempt 3: $1.0\text{s}$ delay.
- **Permanent Failure Recovery**: If 3 attempts fail:
  1. The connector logs a redacted error string via `SecretRedactor`.
  2. The connector attempts to fall back to the deterministic offline fixture cache if configured.
  3. Returns `ImportSummary(status="FAILED", errors=[...])`.
  4. The previous version of observations remains intact in `IdempotentIngestionEngine`.

### 4.2. Schema Mismatch & Malformed Response

- **Root Cause**: Upstream provider modified table headers, JSON structure, or date formatting.
- **Handling**:
  - `validate_schema(raw_data)` intercepts the payload before any record parsing begins.
  - Generates an explicit list of missing keys or schema errors.
  - Rejects the payload in its entirety. Zero partial or corrupt records enter the storage layer.
- **Remediation**:
  1. Inspect the raw payload captured in `summary.diagnostics`.
  2. Update the provider schema mapping in `src/avishkar_ems/trust/connectors/<connector_name>.py`.
  3. Run unit tests: `pytest tests/avishkar_ems/test_phase11_connectors.py`.

### 4.3. Data Corruption or Reversal

- **Recovery Command**:
```python
# To inspect observation history and rollback if necessary:
record = engine.get_record(composite_key)
print(f"Current Version: {record.current_version}")
for version_num, obs, ingested_at in record.history:
    print(f"  v{version_num} ({ingested_at}): {obs.normalized_value} {obs.normalized_unit}")
```

---

## 5. File-Based Import Procedures & Safeguards

When official bodies publish monthly reports as CSV or JSON files (e.g. BESCOM historical CSV, CEA statutory bulletins, AP state balance JSON):

### 5.1. Permitted Import Formats & Path Validation
- Only `.csv` and `.json` file formats are accepted.
- File paths are validated against allowed project directories (`data/energy_reports/` and `data/sample_bills/`). Arbitrary path traversal (`../../`) is blocked.
- Maximum file size: **25 MB**.
- Maximum row count: **100,000 rows**.

### 5.2. Spreadsheet Formula Injection Defense
When parsing CSV files:
- Any cell beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` is sanitized to prevent formula injection when exported or viewed in spreadsheet software.
- Numeric columns are parsed strictly using `float(re.sub(r'[^0-9.-]', '', cell))` with explicit boundary validation.

### 5.3. Household Bill Isolation
- Consumer billing statements (BESCOM Mithra, APEPDCL) are processed through `HouseholdImportEngine` ([household_import.py](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/household_import.py)).
- Private consumer identifiers, meter serial numbers, and account numbers are tokenized and hashed.
- Household readings are classified as `HOUSEHOLD_METER` and stored separately from public grid statistics.

---

## 6. Operational Health Monitoring (`DataSourceHealthCenter`)

The `DataSourceHealthCenter` ([health_center.py](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/health_center.py)) evaluates system health continuously.

### 6.1. Health States Matrix

| State | Definition | Operator Action Required |
| :--- | :--- | :--- |
| **`HEALTHY`** | Transport OK, data fresh within threshold, zero critical schema errors. | None. Operational normal. |
| **`DELAYED_STALE`** | Transport succeeds, but published observations are older than threshold. | Check official provider publishing schedule; verify if upstream report is delayed. |
| **`DEGRADED`** | Validation warnings detected (e.g. unusual peak demand variance). | Review warnings in diagnostic dashboard; verify if grid event occurred. |
| **`FAILED`** | HTTP 5xx, network socket error, or schema validation failed. | Inspect network connectivity, DNS resolution, or provider schema changes. |
| **`ACCESS_RESTRICTED`** | Source requires consumer authentication or official utility MOU. | Do not attempt to bypass. Use manual statement import fallback. |
| **`NOT_CONFIGURED`** | Source configured but required file or credentials missing. | Supply required report file or configuration parameters. |

### 6.2. Cadence-Aware Freshness Thresholds

| Source ID | Reporting Cadence | Freshness Max Age | Rationale |
| :--- | :--- | :--- | :--- |
| `OPEN_METEO_SOLAR` | Hourly | 0.1 days (2.4 hours) | Rapidly updating numerical weather prediction |
| `NPP_DAILY_OUTTURN` | Daily | 3.0 days | Daily national outturn with 24-48h publishing lag |
| `AP_STATE_ENERGY_STATISTICS` | Monthly | 45.0 days | Monthly SLDC report cycle |
| `CEA_POWER_SUPPLY_POSITION` | Monthly | 65.0 days | Statutory report with 45-day compilation lag |
| `CEA_RENEWABLE_GENERATION` | Monthly | 75.0 days | Statutory report with 60-day compilation lag |
| `NASA_POWER_SOLAR` | Multi-Year Climatology | 35.0 days | Monthly solar insolation averages |
| `BESCOM_OPENCITY_HISTORICAL` | Annual (13 FYs) | 365.0 days | Annual public statistical archive |

---

## 7. Security & Secret Redaction

### 7.1. Log Redaction Rules
Every error message, diagnostic dictionary, and connector summary passes through `SecretRedactor` ([operational_safety.py](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/trust/operational_safety.py)):
- Regex patterns detect and redact:
  - API Keys: `key=[REDACTED]`, `Bearer [REDACTED]`.
  - Passwords: `password=[REDACTED]`, `pwd=[REDACTED]`.
  - Consumer IDs / CA Numbers: Account numbers longer than 8 digits are masked (`****-1234`).
  - Database Connection Strings: `postgres://user:[REDACTED]@host...`.

### 7.2. Prohibited Actions
- **NEVER** commit live utility portal passwords to git repositories or configuration files.
- **NEVER** bypass DISCOM CAPTCHA or OTP endpoints via headless automation or scraping tools.
- **NEVER** run untrusted scripts against production databases.
- **NEVER** disable verification assertions in tests to force builds to pass.
