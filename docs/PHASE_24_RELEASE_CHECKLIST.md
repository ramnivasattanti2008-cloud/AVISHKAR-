# Phase 24: UrjaSetu EMS Production Release Checklist

An authorized release manager or Site Reliability Engineer (SRE) must execute this checklist before and after every production release.

---

## Part 1: Pre-Release Gate (Mandatory Preconditions)

All items in this section must be verified and checked before deploying code to production.

- [ ] **1. CI Quality Gates Green**:
  - The latest commit SHA on the release branch has passed the GitHub Actions `ci.yml` pipeline (unit tests, integration tests against real PostGIS, and Playwright browser journeys).
- [ ] **2. Container Image Verification**:
  - Docker images built successfully and are tagged with the exact immutable Git commit SHA (`avishkar/api:<sha>`, `avishkar/engine:<sha>`, `avishkar/web:<sha>`).
  - Mutable tags (e.g. `:latest`) are not used.
- [ ] **3. Configuration & Secret Validation**:
  - Environment configuration validated with `ConfigEnvironmentManager.validate_environment(..., tier=EnvironmentTier.PRODUCTION)`.
  - Zero placeholder strings (`CHANGE_ME...`, `ci_only...`) present in production environment secrets.
  - No secret keys prefixed with `NEXT_PUBLIC_`.
- [ ] **4. Database Migration Vetting**:
  - Database migrations audited with `MigrationSafetyAuditor`.
  - Confirmed that migrations are additive (expand phase). No `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` statements exist in this release.
- [ ] **5. Pre-Release Database Backup**:
  - A verified database dump was created and encrypted using `backup-db.sh` or `BackupManager.create_backup(...)`.
  - SHA-256 checksum file is generated and validated.
  - Backup verified to be non-empty and contains expected table schemas.
- [ ] **6. Rollback Runbook Reviewed**:
  - Rollback target identified (previous known-good Git SHA and container image tags).
  - Rollback Decision Engine guidelines confirmed.
- [ ] **7. Operational Approvals Logged**:
  - Release approved by Lead SRE and Lead Application Architect.

---

## Part 2: Deployment Execution

- [ ] **1. Database Migrations Applied**:
  - Applied via `pnpm -C platform/api db:migrate` in an isolated pre-deployment job.
- [ ] **2. Engine Service Rolling Update**:
  - Optimization engine microservice updated and health probe returns HTTP 200.
- [ ] **3. API Service Rolling Update**:
  - Fastify API containers updated with zero dropped connections.
- [ ] **4. Web Frontend Rolling Update**:
  - Next.js standalone containers updated.

---

## Part 3: Post-Release Verification Gate

Immediately following deployment, the operator must execute these verification steps:

- [ ] **1. Process Liveness Check**:
  ```bash
  curl -fsS https://urjasetu.gov.in/api/health
  # Must return: {"status": "ok", "time": "..."}
  ```
- [ ] **2. System Dependency Health Check**:
  ```bash
  curl -fsS https://urjasetu.gov.in/api/system/health
  # Must confirm: database.state == "healthy", engine.state == "healthy"
  ```
- [ ] **3. User Authentication & Session Verification**:
  - Perform test user login on `/login`.
  - Verify that the session cookie is marked `HttpOnly`, `Secure`, and `SameSite=Lax`.
  - Verify CSRF token is issued and validated on state-mutating requests.
- [ ] **4. Optimization Engine Verification**:
  - Trigger a test day-ahead plan optimization run.
  - Confirm linear programming solver HiGHS completes in $< 500\text{ ms}$.
- [ ] **5. Tariff & Bill Audit Verification**:
  - Load a verified household bill (e.g. BESCOM LT-2(a) statement).
  - Confirm telescopic slab calculations match authoritative schedule.
- [ ] **6. Live Log & Error Monitoring**:
  - Tail operational logs for 15 minutes.
  - Verify HTTP 5xx error rate remains $< 0.1\%$.
  - Confirm zero unredacted secrets or internal database credentials appear in logs.

---

## Part 4: Rollback Decision Point

If any of the post-release checks fail or error rates spike $> 2.0\%$ for $> 3$ minutes:
1. **Declare Rollback**: Halt further rollout immediately.
2. **Consult Runbook**: Open `docs/PHASE_24_ROLLBACK_RUNBOOK.md`.
3. **Execute Rollback**: Re-point container tags to the previous known-good release SHA.
4. **Notify Team**: Post incident update with correlation IDs.
