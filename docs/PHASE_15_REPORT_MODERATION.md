# Phase 15: Citizen Submissions & Report Moderation Workflow

## 1. Objectives & Guiding Principles

The citizen reporting subsystem enables citizens to log factual, non-defamatory energy observations (e.g. unexpected service outages, electrical hazards, public solar inverter faults) to increase community visibility and public accountability.

### 1.1 Invariants
1. **Unverified Observation Invariant**: Every citizen submission is recorded with `is_verified_fact = False`. Submissions represent user-submitted observations and are never represented as official utility certifications or regulatory findings.
2. **Server-Side State Machine**: Transitions between intake, review, publication, resolution, or rejection are strictly validated on the server. Direct database state mutations or client-side status tampering are impossible.
3. **Audit Immutability**: Every lifecycle update appends an immutable `AuditLogEntry` recording timestamp, actor ID, actor role, previous status, target status, and rationale.

---

## 2. State Machine Architecture

```
                          +------------------------+
                          |       SUBMITTED        |
                          +------------------------+
                             /        |         \
                            /         |          \
                           v          v           v
           +------------------+  +----------+  +----------+
           |  PENDING_REVIEW  |  |  REJECTED|  |   UNDER  |
           +------------------+  +----------+  |  REVIEW  |
                     \                  ^      +----------+
                      \                 |        /      \
                       +----------------+-------+        \
                                        |                 v
                                        |       +--------------------+
                                        |       | NEEDS_CLARIFICATION|
                                        |       +--------------------+
                                        |                 |
                                        |                 v
                                        |       +-------------------------+
                                        +-------| ACCEPTED_FOR_PUBLICATION|
                                                +-------------------------+
                                                             |
                                                             v
                                                +-------------------------+
                                                |        RESOLVED         |
                                                +-------------------------+
                                                             |
                                                             v
                                                +-------------------------+
                                                |        ARCHIVED         |
                                                +-------------------------+
```

### 2.1 State Definitions & Valid Transitions
| Status | Meaning | Allowed Transitions | Permitted Actor Roles |
| :--- | :--- | :--- | :--- |
| `SUBMITTED` | Observation logged by citizen; queued for initial triage. | `PENDING_REVIEW`, `UNDER_REVIEW`, `REJECTED` | CITIZEN (create), MODERATOR, ADMIN |
| `PENDING_REVIEW` | Queued in moderation pool. | `UNDER_REVIEW`, `REJECTED` | MODERATOR, ADMIN |
| `UNDER_REVIEW` | Active investigation by safety / operations team. | `NEEDS_CLARIFICATION`, `ACCEPTED_FOR_PUBLICATION`, `REJECTED` | MODERATOR, ADMIN |
| `NEEDS_CLARIFICATION` | Submitter requested for non-sensitive clarifying details. | `UNDER_REVIEW`, `SUBMITTED`, `REJECTED` | CITIZEN (clarify), MODERATOR, ADMIN |
| `ACCEPTED_FOR_PUBLICATION` | Approved for display on public community bulletin. | `RESOLVED`, `UNDER_REVIEW`, `ARCHIVED` | MODERATOR, ADMIN |
| `REJECTED` | Rejected due to PII, spam, or private billing dispute. | `ARCHIVED`, `UNDER_REVIEW` | MODERATOR, ADMIN |
| `RESOLVED` | Issue inspected and addressed (e.g., pole reinforced). | `ARCHIVED` | MODERATOR, ADMIN |
| `ARCHIVED` | Closed historical record. | *(Terminal state)* | None |

---

## 3. Role-Based Access Control (RBAC)

Three distinct roles are enforced server-side:

### 3.1 CITIZEN
- Can submit energy observations and attach up to 3 evidence files (< 5 MB).
- Can inspect their own report status (`get_citizen_report_for_user()`) in any state (`SUBMITTED`, `UNDER_REVIEW`, etc.).
- Cannot view pending, unmoderated submissions from other citizens.
- Cannot trigger status transitions.

### 3.2 MODERATOR
- Can list the complete moderation queue (`list_moderation_queue()`).
- Can inspect full report details, including submitter pseudonyms and attached evidence files.
- Can transition reports across valid state machine edges.
- Can approve specific evidence files for public display.
- Rejection requires providing a clear `rejection_reason`.

### 3.3 ADMIN
- Superuser privileges: Can audit historical state transitions and archive records.

---

## 4. Privacy & Scrubbing Rules at Intake

1. **PII Redaction**: All titles and descriptions are processed through `PIIScrubber.scrub_text()` to mask 10-digit Indian phone numbers, email addresses, Aadhaar numbers, and consumer billing IDs.
2. **Private Address Prohibition**: Locations containing door numbers, flat numbers, or apartment numbers are rejected with `PRIVATE_ADDRESS_DISALLOWED`. Citizens are instructed to provide neighborhood, intersection, or district-level landmarks.
3. **Hashed Contact Metadata**: Submitter email addresses are hashed with SHA-256 for notification reconciliation and are never exposed on public dashboards.
