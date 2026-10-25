# UrjaSetu EMS Phase 18: Notification Delivery & Channel Management

## 1. Multi-Channel Notification Model

UrjaSetu EMS provides provider-neutral notification dispatch across four supported channels:
1. `IN_APP`: Real-time dashboard notification in Streamlit UI Tab 16 and AI Copilot.
2. `EMAIL_MOCK`: Provider-abstracted email dispatch service.
3. `WEBHOOK_MOCK`: REST JSON payload dispatch to user-registered endpoints.
4. `SMS_MOCK`: Mobile alert dispatch via transactional SMS mock gateway.

---

## 2. Delivery Status Semantics

The system strictly tracks delivery lifecycle states to prevent unwarranted delivery claims:

| Status | Definition | Next Actions |
|---|---|---|
| `QUEUED` | Notification record created; awaiting dispatch worker or quiet-hours expiration. | Dispatched when conditions met. |
| `ATTEMPTED` | Outbound request sent to upstream transport provider; awaiting response. | Await response or timeout. |
| `ACCEPTED_BY_PROVIDER` | Provider received and queued the payload. Final delivery is unverified. | Recorded as accepted. Blind retries PROHIBITED. |
| `DELIVERED` | Explicit cryptographic delivery receipt or webhook callback verified. | Terminal success. |
| `FAILED` | Transient network failure, HTTP 503, or gateway timeout. | Scheduled for exponential backoff retry. |
| `PERMANENTLY_FAILED` | Permanent error (invalid recipient syntax) or retry attempt exhaustion ($n \ge 3$). | Dead-lettered. Operational alert logged. |
| `DELIVERY_UNKNOWN` | Provider timed out after initial receipt; status could not be confirmed. | Reconciled via polling or logged as uncertain. |

---

## 3. User Preferences & Quiet Hours

Consumers maintain granular control over outbound communications:
- **Enabled Channels**: Selectively toggle In-App, Email, Webhook, and SMS.
- **Minimum Severity Threshold**: Filter out low-priority alerts (e.g., only dispatch `HIGH` or `CRITICAL`).
- **Category Opt-Ins**: Enable or disable alerts for specific event categories (e.g. disable high-savings advisories while keeping consumption spikes).
- **Quiet Hours**: Define daily quiet window (e.g. 22:00 to 07:00 IST).
  - `INFORMATIONAL`, `LOW`, and `MEDIUM` alerts are suppressed or held in `QUEUED` state.
  - `CRITICAL` alerts (e.g. security breaches, equipment tampering, severe overdraw) **always bypass quiet hours** to protect consumer and grid safety.

---

## 4. Privacy & PII Redaction Invariants

Before any notification payload leaves the server boundary:
1. All Indian mobile numbers (`+91...`), Aadhaar IDs (`XXXX-XXXX-XXXX`), and raw consumer account numbers are scrubbed using `PIIScrubber`.
2. Outbound notifications provide an authenticated deep link to the application rather than embedding sensitive interval consumption histories or financial totals in plaintext emails or SMS.
