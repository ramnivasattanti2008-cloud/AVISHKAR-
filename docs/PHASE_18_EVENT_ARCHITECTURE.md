# UrjaSetu EMS Phase 18: Event-Driven Monitoring & System Architecture

## 1. Executive Summary & Objective

Phase 18 introduces a dependable, evidence-backed event monitoring, alert management, and notification delivery subsystem to the UrjaSetu Energy Management System (EMS). Designed for high data fidelity and operational transparency, the subsystem provides continuous event classification, deterministic rule evaluation, stable idempotency, multi-channel dispatch, and server-enforced tenant isolation.

Crucially, the architecture rejects synthetic data generation, unconfirmed delivery claims, and arbitrary AI-generated severities. Every alert records traceable physical measurements or operational failures, citing specific rules, baselines, and data fresh-state timestamps.

---

## 2. Core Architectural Principles

1. **Strict Data Honesty**: An absence of data is never fabricated as a zero-consumption event or an equipment fault. Missing telemetry is classified explicitly as `DATA_STALENESS` or `DATA_QUALITY_FAILURE`.
2. **Deterministic Classification**: Events are categorized into four explicit domains:
   - `DETECTED_EVENT`: Real-time anomalies detected on physical telemetry streams.
   - `CALCULATED_CONDITION`: Analytical threshold crossings (e.g. overdrawn sanctioned capacity).
   - `SIMULATED_EVENT`: Outcomes of what-if scenario models and digital twin sweeps.
   - `OPERATIONAL_FAILURE`: External connector transport errors, API rate-limits, or gateway failures.
3. **Idempotency & Deduplication**: Cryptographic SHA-256 fingerprints prevent alert storms, duplicate background job processing, and multiple notifications for recurring conditions within identical reporting periods.
4. **Server-Side Tenant Isolation**: Strict server-enforced authorization ensures consumers only inspect, acknowledge, and resolve alerts for properties they legitimately own.
5. **Truth-in-Delivery**: External notification dispatch strictly distinguishes between provider acknowledgment (`ACCEPTED_BY_PROVIDER`) and verifiable receipt (`DELIVERED`).

---

## 3. System Topology & Data Flow

```
   [ Upstream Telemetry Feeds ]
   - Smart Meter Interval Telemetry (HouseholdManager)
   - Statutory Grid Reports (HealthCenter / CEA / Discoms)
   - Anomaly Detection Engine (MAD / Residuals)
   - Recommendation Engine & What-If Simulations
                  │
                  ▼
      ┌───────────────────────┐
      │  Event Ingestion Pipe │
      │  Schema Validation    │
      └───────────┬───────────┘
                  │
                  ▼
      ┌───────────────────────┐
      │  Idempotency Guard    │◄─── Compute 16-char SHA-256 fingerprint
      │  Duplicate Check      │     Suppress duplicate alerts & increment count
      └───────────┬───────────┘
                  │
                  ▼
      ┌───────────────────────┐
      │   Alert Rule Engine   │◄─── Deterministic evaluation against explicit bounds
      │   Evidence Assembly   │     (Spikes, Load Overdraw, Staleness, Failures)
      └───────────┬───────────┘
                  │
                  ▼
      ┌───────────────────────┐
      │  Alert Lifecycle Mgr  │◄─── Formal State Machine
      │  Tenant Authorization │     (OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED)
      └───────────┬───────────┘
                  │
                  ▼
      ┌───────────────────────┐
      │  Notification Engine  │◄─── User Preferences & Quiet Hours Filter
      │  PII Redaction Guard  │     Bounded Exponential Backoff (Max 3 Attempts)
      └───────────┬───────────┘
                  │
      ┌───────────┴───────────────────────┐
      ▼                                   ▼
 [ In-App UI Inbox ]            [ Outbound Channels ]
 Streamlit Tab 16 &             - Mock Email Gateway
 AI Copilot Assistant           - Mock SMS Gateway
                                - Mock Webhook Endpoints
```

---

## 4. Canonical Typed Schema Definitions

### 4.1 EventRecord

| Field | Type | Description |
|---|---|---|
| `event_id` | `str` | Unique event identifier (`evt_...`). |
| `event_type` | `str` | Hierarchical dot-notation signal code (e.g. `consumption.spike`, `demand.overdraw`). |
| `event_category` | `EventCategory` | Enum classifying the domain category. |
| `severity` | `EventSeverity` | Operational urgency (`INFORMATIONAL`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). |
| `source_service` | `str` | Originating engine (`anomaly_detector`, `health_center`, `household_module`). |
| `entity_id` | `str` | Monitored resource identifier (e.g. `home_blr_bescom`, `CEA_POWER_SUPPLY_POSITION`). |
| `rule_id` | `str` | Audited detection rule reference (e.g. `RULE-EVT-SPIKE-01`). |
| `rule_version` | `str` | Version identifier for deterministic rule reproducibility. |
| `occurrence_time` | `str` | ISO 8601 timestamp of when physical event occurred. |
| `detection_time` | `str` | ISO 8601 timestamp of when analytical pipeline flagged the condition. |
| `reporting_period` | `str` | Temporal reporting window (e.g. `2026-03`, `2026-03-24`). |
| `evidence_references`| `list[dict]` | Complete list of quantitative evidence records and citations. |
| `payload` | `dict[str, Any]` | Validated, strongly typed event-specific payload. |
| `scope` | `str` | Organizational scope (`HOUSEHOLD`, `DISTRICT`, `STATE`, `SYSTEM`). |
| `idempotency_key` | `str` | Cryptographic deduplication key. |
| `classification` | `EventClassification`| `DETECTED_EVENT`, `CALCULATED_CONDITION`, `SIMULATED_EVENT`, `OPERATIONAL_FAILURE`. |
| `processing_status`| `ProcessingStatus` | `RECEIVED`, `VALIDATED`, `PROCESSED`, `DUPLICATE_SUPPRESSED`, `FAILED`. |

---

## 5. Persistence & Ingestion Invariants

1. **Non-Blocking I/O**: The event ingestion and rule evaluation pipeline executes in memory with deterministic bounding, preventing long database locks while external notification providers are invoked.
2. **Auditability**: State transitions record the actor ID, timestamp, and optional resolution or acknowledgement notes.
3. **Traceability**: An alert record contains a direct pointer (`event_id` and `idempotency_key`) back to the originating event and rule definition.
