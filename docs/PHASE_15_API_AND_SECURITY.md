# Phase 15: API Surface, Security Invariants & Upload Protection

## 1. Programmatic API Surface

The `CitizenPortalService` exposes a unified, type-safe API for public energy transparency, observation intake, and moderation:

### 1.1 Public Transparency Endpoints
- `get_public_indicators(geo_scope: str = "ALL", category: IndicatorCategory | None = None) -> list[PublicEnergyIndicator]`
  Retrieves verified public indicators with full provenance lineage, engineering units, reporting periods, and limitations.
- `get_public_datasets_catalogue() -> list[dict[str, Any]]`
  Lists registered open statutory datasets under GODL-India with official URLs, descriptions, and verified statuses.
- `check_public_eligibility(data_item: dict[str, Any]) -> PublicDataEligibilityResult`
  Evaluates data items against the deny-by-default public publication policy.

### 1.2 Citizen Submission & Ingestion Endpoints
- `submit_citizen_report(category, title, description, geographic_level, location_name, submitter_id, contact_email="", consent_public_display=True, user_role=UserRole.CITIZEN) -> tuple[bool, CitizenReport | str]`
  Validates input, scrubs PII, rejects private house numbers, enforces rate limits, and registers report in `SUBMITTED` status.
- `upload_evidence_for_report(report_id, filename, content_bytes, declared_content_type, submitter_id, user_role=UserRole.CITIZEN) -> tuple[bool, EvidenceFileMetadata | str]`
  Enforces 5 MB limit, verifies magic bytes, defends against path traversal, and attaches evidence privately.

### 1.3 Moderation & Public Retrieval Endpoints
- `moderate_report(report_id, new_status, moderator_id, notes, user_role=UserRole.MODERATOR, public_resolution_summary=None, rejection_reason=None, approve_evidence_ids=None) -> tuple[bool, str]`
  Applies server-side state machine transition, records immutable audit entry, and approves public evidence if specified.
- `list_public_reports(geo_scope="ALL", category=None, search_query=None, page=1, page_size=10) -> dict[str, Any]`
  Returns paginated list of approved reports (`ACCEPTED_FOR_PUBLICATION` or `RESOLVED`) with all private submitter details stripped.
- `get_citizen_report_for_user(report_id, requester_id, user_role=UserRole.CITIZEN) -> dict[str, Any] | None`
  Enforces strict authorization: Submitters see their own report in any status; moderators see full detail with audit trail; unauthorized users are denied.
- `list_moderation_queue(status_filter=None, user_role=UserRole.MODERATOR) -> list[dict[str, Any]]`
  Lists pending reports for authorized moderators.

### 1.4 Privacy Aggregation Endpoint
- `aggregate_safely(records, area_key="locality", metric_key="consumption_kwh", min_k=10) -> list[dict[str, Any]]`
  Enforces $k$-anonymity ($k \ge 10$) and suppresses small groups.

---

## 2. Security Invariants & Defenses

### 2.1 File Upload & Storage Security
- **Max File Size**: 5 MB (`MAX_UPLOAD_SIZE_BYTES = 5,242,880`). Oversized uploads are rejected immediately with `FILE_OVERSIZED`.
- **Magic Bytes Signature Validation**:
  - `JPEG`: Verified against `\xff\xd8\xff`
  - `PNG`: Verified against `\x89PNG\r\n\x1a\n`
  - `PDF`: Verified against `%PDF-`
  - `CSV / TXT`: Verified as valid UTF-8/ASCII without binary null control bytes (`\x00`).
- **Path Traversal Defense**: Filenames are stripped of directory separators (`os.path.basename`) and stored under randomized hash-based paths (`cit_evid_{sha256[:12]}_{uuid[:6]}.ext`).
- **Executable Rejection**: File extensions such as `.exe`, `.py`, `.sh`, `.bat`, `.js`, `.html` are rejected with `DISALLOWED_EXTENSION`.

### 2.2 Rate Limiting & Anti-Abuse
- **Sliding-Window Limiter**: Enforces a maximum of 5 submissions per hour per submitter handle/IP.
- **Evidence Count Limit**: Maximum 3 evidence files per report.

### 2.3 Cross-User Privacy & Data Isolation
- Direct object reference attacks (e.g. changing `report_id` to view another citizen's pending complaint) are blocked:
  `portal.get_citizen_report_for_user(report_id, requester_id)` returns `None` unless the requester is the submitter or an authorized moderator.
