# UrjaSetu EMS Phase 18: Retry Policies, Idempotency & Failure Handling

## 1. Idempotency Key Architecture

To eliminate alert storms and duplicate processing when background workers retry or ingestion feeds replay, UrjaSetu EMS generates a 16-character cryptographic SHA-256 fingerprint:

$$\text{idempotency\_key} = \text{SHA256}(\text{entity\_id} \parallel \text{event\_category} \parallel \text{rule\_id} \parallel \text{reporting\_period})[0:16]$$

### 1.1 Invariant Rules:
1. **Stable Identity**: The key combines the entity ID, category enum, rule ID, and reporting period bucket (e.g. `2026-03` for monthly rules, `2026-03-24` for daily rules).
2. **Duplicate Suppression**: When an incoming event matches the `idempotency_key` of an existing open or in-progress alert:
   - The event processing status is marked `DUPLICATE_SUPPRESSED`.
   - The alert's `occurrence_count` is incremented.
   - The alert's `last_seen_at` is updated.
   - Outbound notification dispatch is **skipped** to prevent consumer alert fatigue.
3. **Legitimate Recurrence**: If a condition is marked `RESOLVED`, a subsequent event in a *new* reporting period generates a fresh alert with a distinct idempotency key.

---

## 2. Bounded Exponential Backoff Retry Model

When transient failures occur on external delivery channels (e.g. HTTP 503 gateway timeouts, network blips):
1. **Max Retries Capped**: Strictly bounded to `MAX_DELIVERY_ATTEMPTS = 3`.
2. **Backoff Schedule**:
   $$\text{Delay}_n = 2^n \times \text{BaseDelay} + \text{jitter}$$
   - Attempt 1: Immediate dispatch ($t=0$).
   - Attempt 2: Retry at $t = 2\text{s}$.
   - Attempt 3: Retry at $t = 4\text{s}$.
3. **Dead-Letter State**: After attempt 3 fails, the record is transitioned to `PERMANENTLY_FAILED` with `retry_eligible = False`.
4. **Anti-Duplication Guard**: If an upstream provider returns `ACCEPTED_BY_PROVIDER` but the client times out awaiting a final receipt, blind retries are **prohibited** to prevent sending multiple emails/SMS to consumers.
