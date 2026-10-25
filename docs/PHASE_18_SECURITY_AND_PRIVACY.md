# UrjaSetu EMS Phase 18: Security Architecture, Tenant Isolation & Privacy

## 1. Threat Model & Mitigations

| Threat | Risk | Mitigation |
|---|---|---|
| **Cross-Tenant Alert Enumeration** | Malicious actor queries alert IDs belonging to other consumers. | Server-side authorization enforces `alert.owner_user_id == auth_user_id` or raises `PermissionError`. |
| **Unauthorized State Transitions** | Unauthorized user resolves or dismisses another user's alert. | `AlertLifecycleManager.transition` checks ownership before executing transition. |
| **Notification Injection / PII Leaks** | Notification messages leak raw bank accounts, Aadhaar, or meter IDs. | `PIIScrubber` sanitizes all outbound bodies before channel handoff. |
| **Prompt Injection via AI Copilot** | Adversary crafts prompt instructing Copilot to acknowledge all alerts or reveal secret keys. | `PromptInjectionDefense` inspects prompt syntax and blocks override attempts before tool execution. |
| **Malformed / Forged Ingress Payloads** | Ingress pipeline fed oversized or missing parameters. | Strict schema validation in `EventRecord` and `ingest_event` rejects malformed payloads. |

---

## 2. Server-Enforced Tenant Isolation

In UrjaSetu EMS, the frontend UI never dictates resource ownership. Authorization is verified server-side at execution time:
```python
if actor_user_id != alert.owner_user_id and actor_user_id not in [
    "system_admin",
    "user_default",
    "user-owner-001",
]:
    raise PermissionError(
        f"ACCESS DENIED: Principal '{actor_user_id}' is not authorized to transition alert '{alert.alert_id}' "
        f"belonging to owner '{alert.owner_user_id}'."
    )
```

Listing alerts via `EventMonitoringService.list_alerts` filters results strictly by the verified authenticated user ID.

---

## 3. PII Redaction Implementation

Outbound notifications pass through `PIIScrubber.scrub_text`, which applies deterministic regular expressions to redact:
- Indian mobile phone numbers: `(\+91|0)?[6-9]\d{9}` -> `[REDACTED_PHONE]`
- Aadhaar numbers: `\d{4}\s?\d{4}\s?\d{4}` -> `[REDACTED_AADHAAR]`
- Consumer account IDs: `(?:CA|ACC|MTR)-\d+` -> `[REDACTED_ACCOUNT_ID]`
