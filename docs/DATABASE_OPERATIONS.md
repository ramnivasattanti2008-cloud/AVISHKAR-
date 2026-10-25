# Database Architecture, Migration Reliability & Operational Runbook — UrjaSetu EMS
**Phase 10: Production Hardening & Reliability Engineering**

---

## 1. Production Database Architecture Overview

UrjaSetu EMS utilizes a dual-tier persistence architecture designed for high integrity, spatial intelligence, and resilience:
1. **Core Platform Database**: **PostgreSQL 16** with the **PostGIS 3.4** spatial extension. Manages multi-tenant accounts, properties, building polygons, meters, interval timeseries, tariff plans, optimization scenarios, and audit logs.
2. **Analytical Observation Store**: **Append-Only Local & Time-Series Observations** backed by SHA-256 payload checksums, source provenance metadata, and atomic cache managers.

### Key Invariants:
- **UUID Primary Keys**: Every database entity utilizes UUIDv4 primary keys to prevent enumeration attacks and simplify distributed merging.
- **Timestamps with Time Zone**: All temporal columns are declared as `TIMESTAMPTZ(3)` (UTC microsecond precision).
- **Spatial Triggers**: Geometries (`Point`, `Polygon`) are maintained in EPSG:4326 using automated database triggers that synchronize spatial columns with latitude/longitude updates.
- **Data Status Semantics**: All analytical and telemetry tables enforce an explicit `data_status` enum (`LIVE`, `UPDATED`, `FORECAST`, `ESTIMATED`, `SIMULATED`, `DEMO`, `REFERENCE`, `UNAVAILABLE`) ensuring no simulated figure is ever mistaken for an official observation.

---

## 2. Connection Configuration & Connection Pooling

### 2.1 Environment Variable Specification
Database connection strings are strictly injected via environment variables and validated at process initialization:

```bash
# Production Connection String (PostgreSQL 16 + PostGIS 3.4)
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require&connection_limit=25&pool_timeout=10"

# Dedicated Isolated Test Database (Used solely by CI & automated integration tests)
DATABASE_URL_TEST="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}_test?schema=public&connection_limit=5"
```

### 2.2 Connection Pooling Parameters
In containerized environments (Kubernetes, Docker Swarm, Cloud Run), connection pooling is configured according to instance sizing:
- **`connection_limit`**: Set to `25` per API replica. (Total pooled connections across replicas must not exceed `max_connections * 0.8` on the primary database).
- **`pool_timeout`**: `10` seconds. Prevents request threads from hanging indefinitely during database saturation.
- **PgBouncer Recommendation**: When scaling beyond 4 API worker replicas, a transaction-mode `pgbouncer` sidecar should be placed before PostgreSQL.

### 2.3 Zero-Credential Leakage Invariant
- Connection strings must **never** be printed to stdout, stderr, debug logs, exception traces, or HTTP response bodies.
- The `DataSourceHealthCenter` and logging frameworks utilize `redact_sensitive_keys()` which sanitizes connection strings, API tokens, passwords, and consumer IDs.

---

## 3. Migration History & Version Control Runbook

All database schema evolutions are managed via version-controlled SQL migrations located in `platform/api/prisma/migrations/`. 

### 3.1 Migration Audit Log

| Sequence | Migration Name | Scope & Changes Applied |
|---|---|---|
| `01` | `20261007094916_foundation` | Enables PostGIS extension; creates `users`, `sessions`, `properties`, and spatial triggers. |
| `02` | `20261007095707_reference_status` | Adds `REFERENCE` enum value to `DataStatus` for invariant geocoding/policy data. |
| `03` | `20261007101148_weather_observations` | Creates `weather_observations` and `satellite_observations` tables with GIST spatial indexes. |
| `04` | `20261007102555_energy_twin_and_satellite` | Creates `energy_twins` table with heat pump, thermal inertia, and roof geometry parameters. |
| `05` | `20261007140000_tariffs_and_policy` | Creates `tariff_plans`, `energy_rates`, `fixed_charges`, and `policy_rules` tables. |
| `06` | `20261007160000_assets_and_meter_data` | Creates `assets` (PV, battery, EV, heat pump) and `meter_readings` (15-min interval) tables. |
| `07` | `20261008090000_forecast_runs` | Creates `forecast_runs` table storing model competition tournament scores and prediction intervals. |
| `08` | `20261008100000_optimization_runs` | Creates `optimization_runs` tracking MILP/Rule dispatch schedules and cost savings. |
| `09` | `20261008120000_scenarios` | Creates `scenarios` and `scenario_runs` for hypothetical battery/solar sizing explorations. |
| `10` | `20261008150000_jobs_and_control` | Creates `job_runs` (distributed lock table) and `control_proposals` (VPP dispatch logs). |
| `11` | `20261008170000_erase_ip_on_account_delete` | Privacy enforcement: trigger that nulls client IP addresses upon account soft-deletion. |

### 3.2 Production Migration Execution Runbook

> **CRITICAL PRODUCTION RULE**: Never execute `prisma migrate reset` or `prisma db push` in production. These commands can destroy tables or bypass migration history verification.

#### Step 1: Pre-Migration Health & Lock Check
Verify that the database is reachable and that no unapplied migrations or schema drifts exist:
```bash
cd platform/api
pnpm prisma migrate status
```

#### Step 2: Dry-Run Review
Examine pending SQL files in `platform/api/prisma/migrations/` to ensure no destructive `DROP TABLE` or `DROP COLUMN` statements exist without preceding deprecation steps.

#### Step 3: Apply Migrations Atomically
Apply pending migrations using the non-destructive deployment command:
```bash
pnpm prisma migrate deploy
```

#### Step 4: Verification
Confirm that all migrations have been recorded in the `_prisma_migrations` table:
```bash
pnpm prisma migrate status
# Expected output: "Database schema is up to date!"
```

---

## 4. Indexing & Query Performance Optimization

Frequently queried access paths have been audited and indexed to ensure sub-50ms query response times under high concurrency:

### 4.1 Spatial Indexes (`GIST`)
- `properties.location`: `CREATE INDEX idx_properties_location ON properties USING GIST (location);`
- `properties.polygon_4326`: `CREATE INDEX idx_properties_polygon ON properties USING GIST (polygon_4326);`
- Enables rapid bounding-box queries for map-based neighborhood aggregation.

### 4.2 High-Throughput Time-Series Indexes (`B-Tree`)
- `meter_readings (property_id, interval_start DESC)`: Optimizes dashboard timeseries queries and billing reconstruction.
- `weather_observations (location_hash, timestamp_utc DESC)`: Rapid weather lookups for forecasting engines.
- `forecast_runs (property_id, target_metric, created_at DESC)`: Instant retrieval of winning prediction cones.
- `audit_logs (user_id, timestamp DESC)`: Fast user security and access history pagination.

---

## 5. Backup, Restoration & Disaster Recovery Runbooks

### 5.1 Automated Logical Backup (`pg_dump`)
Run daily logical backups using PostgreSQL custom format (`-Fc`), which supports parallel compression and selective restoration:

```bash
# Export compressed archive with timestamp
BACKUP_FILE="backup_urjasetu_$(date +%Y%m%d_%H%M%S).dump"
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  -F c -b -v -f "${BACKUP_FILE}"

# Calculate and record cryptographic checksum
sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"
```

### 5.2 Backup Verification & Dry-Run Test
Monthly restoration rehearsals must verify backup integrity against an ephemeral staging container:

```bash
# 1. Spin up ephemeral postgres instance
docker run --name pg_verify -e POSTGRES_PASSWORD=test -d postgis/postgis:16-3.4

# 2. Re-create schema
docker exec -i pg_verify createdb -U postgres urjasetu_restore

# 3. Dry-run restoration
pg_restore -h localhost -p 5432 -U postgres -d urjasetu_restore \
  --schema-only --no-owner "${BACKUP_FILE}"
```

### 5.3 Disaster Recovery Restoration Runbook (`pg_restore`)
In the event of database corruption or hardware failure:

```bash
# Step 1: Ensure active API services are paused to prevent partial writes
# Step 2: Restore database from certified backup
pg_restore -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --clean --if-exists --no-owner --role="${DB_USER}" -v "${BACKUP_FILE}"

# Step 3: Verify migration alignment
cd platform/api && pnpm prisma migrate status

# Step 4: Resume API services and execute health check
curl -I http://127.0.0.1:8080/health/readiness
```

---

## 6. Fault-Tolerance & Startup Behavior

To prevent cascading container restarts when the database undergoes maintenance:
1. **Liveness Independence**: The process `/health/liveness` check returns `HTTP 200 OK` as long as the event loop is responsive, even if the database is temporarily unreachable.
2. **Readiness Gating**: The `/health/readiness` probe connects to PostgreSQL with a 2-second timeout. If the database is down, readiness returns `HTTP 503 Service Unavailable`, preventing the ingress load balancer from routing traffic to unready replicas while avoiding container kill loops.
3. **Bounded Reconnection**: The Prisma client implements exponential backoff with jitter on initial connection attempts (retrying up to 5 times before failing gracefully).

---
*Maintained by UrjaSetu DevOps & Reliability Engineering.*
