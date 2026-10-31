# Phase 24: UrjaSetu EMS Production Rollback Runbook

## 1. Rollback Justification & Decision Protocol

A rollback is an emergency operational procedure executed when a production deployment introduces critical defects that cannot be safely resolved in place within 15 minutes.

### Mandatory Rollback Triggers
1. **Critical Health Failure**: `/api/health` returns non-200 or `/api/system/health` reports `status: "down"` for database or engine for > 3 consecutive minutes.
2. **Elevated Error Rates**: HTTP 5xx error rates exceed 2.0% of total incoming requests over a 5-minute rolling window.
3. **Database Connectivity / Integrity Failure**: Database connection pool exhaustion, unhandled schema mismatch errors, or transaction deadlock spikes.
4. **Data Corruption Hazard**: Any condition where user energy consumption, tariff calculations, or financial billing records are recorded with invalid values.
5. **Security Compromise**: Detection of an exposed secret, unauthorized privilege escalation, or cross-tenant IDOR leak.

---

## 2. Authorization & Roles

| Role | Responsibility | Authority |
|---|---|---|
| **Incident Commander (IC)** | Declares incident, coordinates team, authorizes rollback execution | **Final Authorization** |
| **Site Reliability Engineer (SRE)** | Executes container image re-pointing, health checks, and traffic shifting | Operational Execution |
| **Lead Database Engineer** | Assesses migration reversibility, takes snapshot, coordinates DB restore | Database Authority |
| **Security Officer** | Assesses compromise, initiates credential revocation if secrets leaked | Security Veto |

---

## 3. Rollback Decision Matrix

Before rolling back application code, the SRE and Database Engineer must determine the database schema state using the `RollbackDecisionEngine`:

```mermaid
flowchart TD
    Trigger[Incident Triggered] --> Q1{Is Database Corrupted?}
    Q1 -- Yes --> A1[Action: DATABASE_RESTORE_REQUIRED<br/>• Stop incoming traffic<br/>• Restore from pre-release backup<br/>• Estimated RTO: 30 mins]
    Q1 -- No --> Q2{Did release include schema migrations?}
    Q2 -- No --> A2[Action: SAFE_APP_REVERT<br/>• Re-deploy previous container image<br/>• Zero DB changes needed<br/>• Estimated RTO: 2 mins]
    Q2 -- Yes --> Q3{Was migration purely additive?}
    Q3 -- Yes (Expand) --> A3[Action: SAFE_APP_REVERT<br/>• Re-deploy previous container image<br/>• New columns ignored by old code<br/>• Estimated RTO: 5 mins]
    Q3 -- No (Destructive) --> A4[Action: FORWARD_FIX_REQUIRED<br/>• Do NOT revert code alone (will crash)<br/>• Push emergency hotfix or restore DB<br/>• Estimated RTO: 15-30 mins]
```

### Action Protocols
- **`SAFE_APP_REVERT`**: Previous application code is fully compatible with the current database state. Re-point load balancer or rolling update container images to previous known-good tag.
- **`FORWARD_FIX_REQUIRED`**: A column was dropped or renamed. Rolling back application code will crash immediately because the old code expects the missing schema element. A fast-forward hotfix must be released.
- **`DATABASE_RESTORE_REQUIRED`**: Unrecoverable data corruption occurred. Maintenance window must be enabled, traffic paused, and the database restored from the pre-release backup.

---

## 4. Step-by-Step Rollback Execution Procedure

### Step 1: Identify Known-Good Release Artifacts
Inspect deployment logs or Git tags to locate the previous release SHA:
```bash
# Locate previous deployment tag or commit
git tag --list "release-*" --sort=-v:refname | head -n 2
# Example output:
# release-v1.2.0 (broken)
# release-v1.1.9 (known-good target)

TARGET_SHA="<commit-sha-for-v1.1.9>"
```

### Step 2: Roll Back Application Services
In Docker Compose / Container Orchestrator:
```bash
# 1. Re-tag or redeploy previous container images
export API_IMAGE="avishkar/api:${TARGET_SHA}"
export ENGINE_IMAGE="avishkar/engine:${TARGET_SHA}"
export WEB_IMAGE="avishkar/web:${TARGET_SHA}"

# 2. Re-deploy container stack
docker compose up -d api engine web
```

### Step 3: Verify Service Health
Immediately poll the liveness and readiness endpoints:
```bash
# Check API liveness
curl -fsS http://127.0.0.1:8080/api/health

# Check System readiness & dependency states
curl -fsS http://127.0.0.1:8080/api/system/health | jq .
```
Expected verification criteria:
- HTTP status 200.
- `database.state == "healthy"`.
- `engine.state == "healthy"`.
- Response latency < 200 ms.

### Step 4: Validate Critical User Journeys
Perform synthetic smoke queries against the rolled-back deployment:
1. `GET /api/properties` (Database reading & multi-tenant isolation).
2. `GET /api/health` (Process liveness).
3. `POST /api/engine/optimise` (Optimization engine solver connectivity).
4. `GET /login` (Web frontend rendering & CSRF cookie issuance).

---

## 5. Post-Rollback Diagnostics & Incident Preservation

1. **Preserve Container Logs**:
   Export container logs from the failed deployment before containers are recycled:
   ```bash
   docker logs avishkar-api-failed > /tmp/incident_api_$(date +%s).log
   docker logs avishkar-engine-failed > /tmp/incident_engine_$(date +%s).log
   ```
2. **Preserve Diagnostic Correlation IDs**:
   Extract all `corr_...` error identifiers logged during the incident window.
3. **Draft Post-Mortem Incident Report**:
   Document root cause, trigger conditions, time to detect (TTD), time to recover (TTR), and remediation actions.
