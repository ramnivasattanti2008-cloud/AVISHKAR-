# Phase 15: UrjaSetu Citizen Energy Portal & Public Transparency

## 1. Executive Summary

The **Citizen Energy Portal & Public Transparency** subsystem delivers an authentic, verifiable, and privacy-conscious public energy observatory within the UrjaSetu EMS platform. It empowers citizens to explore official electricity statistics, understand source provenance and statutory data limits, inspect registered open energy datasets, and submit local energy observations (such as feeder trips, electrical hazards, or rooftop solar anomalies) through a controlled, server-side moderated intake workflow.

Crucially, this is not a static or decorative dashboard. It enforces an unyielding **Server-Side Data Access Boundary**:
- **Deny-by-Default Policy**: Internal telemetry, raw customer billing details, smart meter serial numbers, and private household consumption records are strictly barred from public APIs and dashboards.
- **Truth-in-Data Invariant**: Official statutory figures (CEA, KPTCL, POSOCO) are transparently distinguished from citizen-submitted observations. Citizen reports are explicitly labeled as **unverified user observations** and are never presented as government-certified or utility-verified facts.
- **Anti-Disaggregation Guard**: State-level figures are never artificially downscaled to revenue districts or municipalities without genuine direct metering.

---

## 2. Architecture & Data Access Boundary

```
+---------------------------------------------------------------------------------------------------+
|                                     PUBLIC BROWSER / CITIZEN UI                                   |
|   Tab 13: "🏛️ Citizen Energy Portal & Public Transparency" (UrjaSetu Unified Dashboard)           |
+---------------------------------------------------------------------------------------------------+
                                            |
                                            v (Strict RBAC & Data Boundary)
+---------------------------------------------------------------------------------------------------+
|                                       CITIZEN PORTAL SERVICE                                      |
|                               (src/avishkar_ems/citizen_portal.py)                                |
|                                                                                                   |
|  +-----------------------------+  +-------------------------------+  +-------------------------+  |
|  |  Public Data Policy Engine  |  |   PII & Security Scrubber     |  | Evidence Upload Guard   |  |
|  |  - Deny-by-default boundary |  |   - Masks Indian phone numbers|  | - Max 5 MB size limit   |  |
|  |  - Household meter denial   |  |   - Redacts email addresses   |  | - Magic byte validation |  |
|  |  - Raw PII field denial     |  |   - Strips Aadhaar patterns   |  | - Traversal prevention  |  |
|  +-----------------------------+  +-------------------------------+  +-------------------------+  |
|                                                                                                   |
|  +-----------------------------+  +-------------------------------+  +-------------------------+  |
|  | Verified Public Indicators  |  |  Citizen Submission & Intake  |  | Moderation Workflow     |  |
|  | - CEA National Power Supply |  |  - Category classification    |  | - State machine engine  |  |
|  | - CEA State Balance (KA,AP) |  |  - Coarse location capture    |  | - Transition validation |  |
|  | - CEA Renewable Generation  |  |  - Rate limiting (5/hour)     |  | - Mandatory audit log   |  |
|  +-----------------------------+  +-------------------------------+  +-------------------------+  |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  |                      Privacy-Aware Aggregation Engine (k-Anonymity k >= 10)                 |  |
|  |  - Small group suppression (< 10 households -> SUPPRESSED_PRIVACY_THRESHOLD)                |  |
|  |  - Sequential query differencing attack defense (delta < 10 denied)                         |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
                                            |
                                            v
+---------------------------------------------------------------------------------------------------+
|                                  LOCAL DATA & STATUTORY SOURCES                                   |
|  - data/energy_reports/cea_national_balance.json   (CEA Power Supply Position, verified)          |
|  - data/energy_reports/cea_state_balance.json      (CEA State balances KA & AP, verified)         |
|  - data/energy_reports/cea_renewable_generation.json (CEA Monthly Renewable Generation, verified) |
|  - data/citizen_evidence/                          (Isolated, non-public storage directory)       |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Core Capabilities Implemented

### 3.1 Verified Public Energy Indicators
The portal loads official monthly statutory observations directly from `data/energy_reports/` files, including:
1. **National Electricity Supplied**: Monthly energy delivered across India (e.g., 155,250 MU in March 2026).
2. **National Peak Demand Met**: Peak simultaneous load served across all five regional grids (e.g., 247,900 MW in March 2026).
3. **Karnataka Energy Supplied**: State grid intake and utility dispatch (e.g., 8,510 MU in March 2026).
4. **Andhra Pradesh Energy Supplied**: State grid intake and utility dispatch (e.g., 7,080 MU in March 2026).
5. **All-India Solar Generation**: Grid-connected solar PV generation (e.g., 11,420 MU from CEA & MNRE).

Every indicator exposes full lineage metadata:
- Source Organization, Statutory Report Title, and Official URL.
- Measurement units (`MU`, `MW`) and reporting periods.
- Methodology summary and documented limitations.

### 3.2 Statutory Open Energy Datasets Catalogue
Maintains an auditable register of authorized open datasets released under **Government Open Data License - India (GODL-India)**:
- `ds_pub_cea_balance`: National and state monthly energy balances.
- `ds_pub_cea_renewables`: Renewable generation and capacity benchmarks.
- `ds_pub_npp_outturn`: National Power Portal daily outturn telemetry.

### 3.3 Citizen Observation Submission Workflow
Citizens can submit observations across six defined categories:
- `SERVICE_INTERRUPTION`: Unscheduled outages or voltage fluctuations.
- `INFRASTRUCTURE_HAZARD`: Leaning poles, sparking transformers, or exposed cables.
- `SOLAR_OBSERVATION`: Feed-in anomalies or community solar inverter errors.
- `DATA_CORRECTION`: Queries or discrepancies in published public numbers.
- `EFFICIENCY_FEEDBACK`: Energy conservation notices (e.g., midday streetlight burning).
- `OTHER`: General electricity transparency inquiries.

Security & privacy rules applied at submission:
- **Automatic PII Scrubbing**: Mobile phone numbers, email addresses, Aadhaar numbers, and consumer account IDs are scrubbed with redaction tokens (`[REDACTED_PHONE]`, `[REDACTED_EMAIL]`, etc.).
- **Private Home Address Denial**: Rejects exact door/flat numbers to prevent exposing private residences; requires neighborhood, landmark, or district level.
- **Sliding-Window Rate Limiting**: Enforces a maximum of 5 submissions per hour per submitter.
- **Initial Status**: Every submission enters `SUBMITTED` status and is private to the submitter and authorized moderators.

### 3.4 Moderation Workflow & State Machine
A formal server-side state machine governs observation lifecycle:
$$\text{SUBMITTED} \longrightarrow \text{UNDER\_REVIEW} \longrightarrow \text{ACCEPTED\_FOR\_PUBLICATION} \longrightarrow \text{RESOLVED} \longrightarrow \text{ARCHIVED}$$
Alternative branches include `NEEDS_CLARIFICATION` and `REJECTED`.
- Role-based authorization: Only `MODERATOR` or `ADMIN` roles can transition report states.
- Rejection invariant: Rejection requires a mandatory, non-empty `rejection_reason`.
- Evidence approval: Attached evidence remains strictly private until an authorized moderator explicitly approves individual files for public view.
- Tamper-evident audit trail: Every action appends an immutable `AuditLogEntry` recording timestamp, actor ID, actor role, previous status, new status, and explanatory notes.

### 3.5 Evidence File Upload Security
Files attached to observations are subjected to strict defenses:
- **Size Quota**: Strict 5 MB maximum limit (`MAX_UPLOAD_SIZE_BYTES = 5,242,880`).
- **Allowed Formats**: `.jpg`, `.jpeg`, `.png`, `.pdf`, `.csv`, `.txt`.
- **Magic Bytes Validation**: Verifies file signatures (e.g., `\xff\xd8\xff` for JPEG, `\x89PNG\r\n\x1a\n` for PNG, `%PDF-` for PDF, valid UTF-8 without null bytes for CSV/TXT) to prevent forged extensions.
- **Path Traversal Defense**: Uses sanitized basenames and stores files under randomized identifiers (`cit_evid_{sha256[:12]}_{uuid[:6]}.ext`).
- **Private Storage**: Files are stored outside web-accessible roots and inaccessible to the public without moderator approval.

### 3.6 Privacy-Preserving Energy Aggregation ($k \ge 10$)
When computing regional or locality consumption aggregates from residential meter records:
- **$k$-Anonymity Threshold**: Groups with fewer than 10 distinct households are suppressed with status `SUPPRESSED_PRIVACY_THRESHOLD`.
- **Differencing Attack Defense**: Sequential overlapping queries differing by fewer than $k$ entities are rejected with `DIFFERENCING_ATTACK_DETECTED`.
