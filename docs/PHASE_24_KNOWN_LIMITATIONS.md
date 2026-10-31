# Phase 24: UrjaSetu EMS Release & Recovery Known Limitations

## 1. Architectural Boundaries & Operational Gaps

While UrjaSetu EMS features complete, verified software release safety, configuration validation, and disaster recovery harnesses, the following operational gaps exist and require dedicated cloud infrastructure before physical production launch:

### 1. Absence of Live Multi-Region Cloud Staging Cluster
- **Limitation**: The current repository environment contains complete container definitions (`docker-compose.yml`, `api.Dockerfile`, `engine.Dockerfile`, `web.Dockerfile`) and staging preflight scripts (`deploy-staging.sh`), but no live remote Kubernetes cluster or cloud staging environment is currently provisioned.
- **Operational Impact**: Staging smoke tests must be run locally or within GitHub Actions Docker runners until dedicated cloud staging accounts (AWS / GCP / Hetzner) are provisioned.
- **Remediation**: Provision an isolated staging VPC with identical PostGIS database versions and private network topography.

### 2. Physical Point-In-Time Continuous WAL Replication
- **Limitation**: Full transactional dumps (`pg_dump -Fc` with OpenPGP/PBKDF2-HMAC encryption) are implemented and tested, but continuous PostgreSQL WAL archiving (`archive_command` streaming to immutable object storage) has not been configured against a live persistent cluster.
- **Operational Impact**: In the event of catastrophic primary storage loss between scheduled daily backups, data recorded since the last daily snapshot (up to 24 hours of provisional readings) would need to be re-ingested from upstream provider caches.
- **Remediation**: Configure `pgBackRest` or AWS RDS / GCP Cloud SQL automated continuous WAL archiving.

### 3. Automated Blue/Green Traffic Shifting
- **Limitation**: Rollbacks currently rely on container image re-deployment (`docker compose up -d`) rather than instantaneous DNS or reverse proxy blue/green traffic slicing (e.g. Envoy / NGINX ingress canary deployments).
- **Operational Impact**: A container rollback requires approximately 60–120 seconds of container stop/start latency rather than a sub-second traffic switch.
- **Remediation**: Deploy ingress controller with weight-based traffic shifting.

### 4. Hardware NavIC Receiver Integration
- **Limitation**: The system maintains `NAVIC_RECEIVER_ENABLED=false` by default. Real NavIC GNSS receiver hardware is not connected in developer and CI environments.
- **Operational Impact**: Location-aware solar coordinates rely on OpenStreetMap/Nominatim geocoding and browser geolocation rather than hardware satellite time pulses.
- **Remediation**: Connect real NavIC receiver via serial/USB driver when deploying physical microgrid command hardware.

---

## 2. Unverified Disaster Recovery Claims (Explicitly Disclaimed)

In accordance with Phase 24 Mandatory Rule 10 ("Do not claim that backups exist, restores work, or recovery objectives are achieved unless evidence supports those claims"):
1. **End-to-End Live Restores**: Restores have been verified in isolated, throwaway sandbox test environments (`avishkar_restore_test` and temporary directories) with mock and custom-format schema data. Restores have **not** been executed against a live multi-terabyte production dataset.
2. **Recovery Objectives**: RPO (1 hour) and RTO (30 minutes) are **Proposed Policies**, not proven production SLAs, until formal cross-region disaster recovery drills are executed with live operations staff.
