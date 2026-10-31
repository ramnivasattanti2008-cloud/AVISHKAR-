# AVISHKAR EMS — Real Database Architecture & Operations Guide

This document describes the real, zero-cost database architecture for **AVISHKAR EMS / UrjaSetu**, covering both local development (PostgreSQL 16 + PostGIS 3.4 in WSL) and free cloud database provisioning (Neon, Supabase).

---

## 1. Executive Summary

AVISHKAR requires a **real PostgreSQL 16+ instance with the PostGIS 3.4+ spatial extension** enabled. It does not use mocks or SQLite.

- **Status**: **100% Verified & Healthy**
- **Engine**: PostgreSQL 16.15 (x86_64 Ubuntu)
- **Spatial Extension**: PostGIS 3.4.2
- **Tables**: 31 relational & spatial tables
- **Migrations**: 11 Prisma migrations deployed
- **Reference Data**: 7 State Tariff Plans + 3 National Policy Rules (PM Surya Ghar CFA schedules) seeded

---

## 2. Option A: Local Real Database (100% Free & Self-Hosted)

Your machine runs PostgreSQL 16 and PostGIS 3.4 natively inside WSL Ubuntu, accessible directly from Windows on port `5432`.

### Connection Endpoints
- **Development Database**:  
  `postgresql://avishkar:<password in platform/api/.env>@127.0.0.1:5432/avishkar_dev?schema=public`
- **Integration Test Database**:  
  `postgresql://avishkar:<password in platform/api/.env>@127.0.0.1:5432/avishkar_test?schema=public`

### One-Click Startup & Keep-Alive Launcher
Windows can put idle WSL instances to sleep, stopping PostgreSQL. To prevent this, use the launcher:
```cmd
start-database.cmd
```
What `start-database.cmd` does automatically:
1. Starts the PostgreSQL service in WSL Ubuntu.
2. Creates the `avishkar` user, `avishkar_dev`, and `avishkar_test` databases if missing.
3. Enables the `postgis` spatial extension on both databases.
4. Spawns a background keepalive daemon so WSL never goes idle or terminates.
5. Deploys pending Prisma migrations (`pnpm -C platform/api db:migrate`).
6. Seeds reference tariffs and policy rules (`pnpm -C platform/api db:seed`).
7. Runs the full diagnostic audit (`pnpm -C platform/api db:health`).

### Health Diagnostic Command
Run at any time to audit the database connection, PostGIS spatial queries, and record counts:
```bash
pnpm -C platform/api db:health
```

---

## 3. Option B: Free Cloud Database (Neon / Supabase)

If you want your database hosted in the cloud for deployment, team collaboration, or without running WSL:

### Active Neon Cloud Database (Project: `avishkar`)
- **Host**: `<your-neon-host>`
- **Database**: `avishkar`
- **Role**: `avishkar_owner`
- **PostgreSQL Version**: 18.6
- **PostGIS Version**: 3.6.4
- **Connection URI**:
  ```text
  postgresql://avishkar_owner:<password>@<your-neon-host>/avishkar?sslmode=require
  ```
- **Status**: **100% HEALTHY** (All 11 migrations applied, 31 tables, 7 tariffs + 3 policy rules seeded, PostGIS spatial queries verified).
- **Environment**: Active in `platform/api/.env` as `DATABASE_URL`.

### Alternative: Supabase (Free Tier)
1. Sign up at [https://supabase.com](https://supabase.com) (free tier includes PostGIS).
2. Create a new project `avishkar`.
3. Go to **Project Settings -> Database** and copy the URI connection string.
4. Run:
   ```bash
   pnpm -C platform/api db:setup-cloud "<your-supabase-connection-string>" --apply
   ```

### What `pnpm -C platform/api db:setup-cloud` Does:
- Verifies TLS/SSL connectivity to the cloud host.
- Installs PostGIS (`CREATE EXTENSION IF NOT EXISTS postgis;`).
- Applies all 11 Prisma migrations (`prisma migrate deploy`).
- Seeds all tariffs (Maharashtra, Rajasthan, UP, Delhi, Gujarat, Tamil Nadu, Bengaluru) and PM Surya Ghar policy rules.
- Tests geodesic distance calculations (`ST_Distance`, `ST_MakePoint`).
- Backs up existing `platform/api/.env` and updates `DATABASE_URL`.

---

## 4. Database Inspection & Administration

### Interactive Web Management
- **Prisma Studio (Interactive Visual GUI)**:
  ```bash
  pnpm -C platform/api exec prisma studio
  ```
  Opens at `http://localhost:5555` to view, search, sort, filter, and edit all 31 relational and spatial tables directly from your browser.

- **Neon Cloud Web Console**:
  Log into [https://console.neon.tech](https://console.neon.tech) to access:
  - Built-in SQL Editor for ad-hoc spatial queries.
  - Compute autoscaling and branch creation (instant copy-on-write dev/staging branches).
  - Point-in-time recovery and metrics graphs.

### CLI Administrative Tasks
- **Grant Administrator Role to an Account**:
  ```bash
  pnpm -C platform/api db:make-admin user@example.com
  ```
  *(Audited in `audit_logs` table; promotes user to `Role.ADMIN`)*

- **Revoke Administrator Role**:
  ```bash
  pnpm -C platform/api db:make-admin user@example.com --revoke
  ```

- **Run Comprehensive Spatial & Health Diagnostics**:
  ```bash
  pnpm -C platform/api db:health
  ```

- **Manual Direct PSQL Terminal (WSL Local)**:
  ```bash
  wsl -d Ubuntu -u postgres -- psql -d avishkar_dev
  ```

---

## 5. Seamless Switching: Cloud vs Local

You can switch between the free Neon Cloud database and your local WSL database at any time without data loss:

### Switch to Neon Cloud Database
Update `DATABASE_URL` in `platform/api/.env`:
```env
DATABASE_URL="postgresql://avishkar_owner:<password>@<your-neon-host>/avishkar?sslmode=require"
```

### Switch to Local WSL Database
Update `DATABASE_URL` in `platform/api/.env`:
```env
DATABASE_URL="postgresql://avishkar:<password in platform/api/.env>@127.0.0.1:5432/avishkar_dev?schema=public"
```
Then ensure the local service is active:
```cmd
start-database.cmd
```

---

## 6. Table Manifest (31 Relational & Spatial Tables)

The database schema is partitioned into modular, high-integrity domain schemas:

| Domain | Tables | Key Constraints & Spatial Attributes |
|---|---|---|
| **Identity & Access** | `users`, `sessions`, `audit_logs` | Argon2id password hashing, append-only immutable audit trail with IP erasure trigger. |
| **Properties & GIS** | `properties`, `property_geometries` | WGS84 EPSG:4326 PostGIS geometry, GiST spatial indexing (`properties_location_idx`), building footprint polygons. |
| **Physical Assets** | `batteries`, `evs`, `appliances`, `appliance_events` | Non-linear DoD aging models, charge/discharge efficiency checks, priority classifications. |
| **Energy & Smart Metering** | `energy_imports`, `energy_observations`, `energy_dna` | Strict 15-minute interval readings, provenance labeling (`LIVE`, `ESTIMATED`, `SIMULATED`), gap-preserving ingestion. |
| **Weather & Environmental** | `weather_observations`, `satellite_observations` | Multi-horizon forecast caches, cloud-cover metrics, Earth Search STAC metadata. |
| **Tariffs & Policy** | `tariff_plans`, `policy_rules` | Time-of-Day slabs, Telescopic billing rules, PM Surya Ghar central subsidy schedules. |
| **Optimization & Planning** | `forecast_runs`, `optimization_runs`, `scenarios` | HiGHS MILP 24-48h dispatch schedules, CVaR risk-aware battery profiles, 25-year LCOE/NPV what-if simulations. |
| **Control & Governance** | `control_proposals`, `job_runs` | Safety limit checks, human approval audit records, advisory-only hardware boundary. |

---

## 7. Backup, Disaster Recovery & Restore Procedures

### Automated Backup Pipeline
The Python EMS release engineering suite (`src/avishkar_ems/release_safety.py`) includes authenticated, encrypted backup management:
- **HMAC-SHA256 Encrypt-then-MAC** payload encryption with PBKDF2 key derivation.
- Checksums computed and verified against SHA-256 digests.
- Strict pruning policy enforcing 7-generation retention.

### Manual SQL Snapshot Export (Neon Cloud)
To export a full snapshot of your Neon Cloud database:
```bash
pg_dump "postgresql://avishkar_owner:<password>@<your-neon-host>/avishkar?sslmode=require" -Fc -f "platform/backups/avishkar_neon_backup.dump"
```

### Manual SQL Snapshot Export (Local WSL)
```bash
wsl -d Ubuntu -u postgres -- pg_dump -d avishkar_dev -Fc -f /mnt/c/Users/Ram\ Nivas/projects/AVISHKAR-/platform/backups/avishkar_local_backup.dump
```

---

## 8. Troubleshooting & Common Pitfalls

1. **Neon Serverless Cold Starts**:
   - Neon serverless compute scales down to zero after 5 minutes of inactivity to preserve free tier hours.
   - The first request after an idle period may take ~300ms to wake up. This is normal and expected for serverless PostgreSQL.
2. **PostGIS Version Compatibility**:
   - Both Neon (PostGIS 3.6.4) and WSL (PostGIS 3.4.2) exceed the minimum PostGIS 3.4 requirement.
   - Spatial queries (`ST_Distance`, `ST_MakePoint`, `ST_Area`) use WGS84 standard geography (`SRID 4326`).
3. **SSL Mode Parameters**:
   - In PostgreSQL 16-18, `sslmode=require` ensures secure TLS encryption with cloud databases.
   - For local connections (`127.0.0.1`), SSL is not required.
4. **Prisma Schema Drift**:
   - Never use `prisma db push` on production or live databases. Always use `pnpm -C platform/api db:migrate` (`prisma migrate deploy`) to ensure triggers, CHECK constraints, and GiST spatial indexes are preserved.
