# Phase 16 — Security Architecture & Prompt Injection Defenses

## 1. Threat Model & Defense-in-Depth

The UrjaSetu AI Energy Copilot operates in a multi-tenant, privacy-sensitive utility environment. The threat model accounts for malicious user prompts, adversarial uploaded invoices, cross-tenant telemetry snooping, and code injection.

```
                    Security Ingress Layer
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
       [Input Sanitization]          [Adversarial Regex]
       - String length capping       - Ignore instructions
       - PII scrubbing               - Reveal API keys / secrets
       - Formula sanitization        - Execute SQL / shell
               │                             │
               └──────────────┬──────────────┘
                              ▼
                 [Identity & Scope Binding]
                 - auth_user_id resolved server-side
                 - authorized_property_ids verified
                              │
                              ▼
                 [Allowlisted Tool Registry]
                 - No arbitrary DB execution
                 - Strict schema validation
                              │
                              ▼
                 [Numerical Grounding Guard]
                 - Hallucinated values suppressed
                 - Revert to safe deterministic template
```

---

## 2. Ingress Defense: `PromptInjectionDefense`

The `PromptInjectionDefense` filter detects adversarial override attempts before any tool execution occurs:

### Regex Patterns Blocked
- `ignore (all) (previous/prior/above) instructions`
- `disregard (system) (instructions/rules/prompts)`
- `reveal (system) (prompt/instructions/secret/api_key)`
- `(execute/run) (arbitrary) (sql/shell/bash/code/script)`
- `drop table`
- `select * from users`
- `act as (root/system admin/superuser/unrestricted)`
- `show (me) all (other) (users/households/meters/bills)`
- `switch (user/account) to`
- `dan mode`
- `bypass (authorization/permissions/checks)`
- `override (user) permission`
- `system: override`

When an adversarial pattern is detected:
1. Tool execution is halted immediately.
2. Status is set to `ToolExecutionStatus.VALIDATION_FAILED`.
3. Grounding status is set to `GroundingStatus.GROUNDING_FALLBACK`.
4. The system returns an explicit refusal: `"Security rejection: The request contains adversarial prompt injection patterns..."`.
5. Zero evidence or internal records are returned.

---

## 3. Server-Side Authorization Boundary

- **Identity Resolution**: `auth_user_id` and `authorized_property_ids` are supplied exclusively by trusted server-side authentication context.
- **Client Identifier Distrust**: Even if a user crafts a query saying `"Show me consumption for property prop-foreign-999"`, the tool registry checks if `arguments["property_id"] in authorized_property_ids`.
- **Zero Existence Leakage**: If access is denied, the system returns a standard access denial without confirming whether the foreign property exists or leaking its metadata.

---

## 4. Output Sanitization & Safe Display

1. **HTML Escaping**: Responses rendered in Streamlit use sanitized markdown cards or standard UI widgets (`st.markdown`, `st.dataframe`).
2. **Formula Injection**: All CSV and tabular outputs strip formula prefix characters (`=`, `+`, `-`, `@`) to prevent spreadsheet calculation attacks.
3. **Secret Isolation**: Provider API keys, SLDC access tokens, and database credentials remain strictly in environment variables and are never surfaced in conversation context.
