# UrjaSetu EMS — Phase 23: Error Diagnostics & Operational Support Runbook

**Document Version:** 1.0.0  
**Phase:** 23 — Accessibility, Usability & Operational Support  
**Scope:** Standardized Error Codes, Correlation IDs, PII Redaction & Support Triage  

---

## 1. Diagnostic Error Architecture

UrjaSetu EMS implements a defense-in-depth error handling architecture designed to:
1. Provide safe, empathetic, and actionable plain-language explanations to end users.
2. Generate unique tracking identifiers (`correlation_id`) for every system anomaly.
3. Automatically scrub passwords, bearer tokens, API credentials, and personal data from error logs.
4. Supply on-call support engineers with reproducible diagnostic context without exposing sensitive user records.

---

## 2. Standardized Error Taxonomy

| Error Code | Category | Safe User Message | Suggested Remediation Action | Reference Documentation |
| :--- | :--- | :--- | :--- | :--- |
| `ERR_AUTH_UNAUTHORIZED` | `AUTHENTICATION_AUTHORIZATION` | You do not have permission to access or modify this property. | Verify that you are signed in with the correct account. | `/docs/help#access-control` |
| `ERR_AUTH_SESSION_EXPIRED` | `AUTHENTICATION_AUTHORIZATION` | Your authenticated session has expired. | Please sign in again to continue your session. | `/docs/help#login` |
| `ERR_TARIFF_NOT_FOUND` | `RESOURCE_NOT_FOUND` | The requested electricity tariff schedule is not recognized. | Select an approved gazetted tariff schedule from the dropdown. | `/docs/help#tariffs` |
| `ERR_PROPERTY_NOT_FOUND` | `RESOURCE_NOT_FOUND` | The requested household or property profile does not exist. | Confirm the property ID or select a property from your registered list. | `/docs/help#properties` |
| `ERR_INVALID_FILE_TYPE` | `INPUT_VALIDATION` | The uploaded file format is not supported. | Upload a supported format (.pdf, .csv, .xlsx, .png, .jpg). | `/docs/help#bill-upload` |
| `ERR_PAYLOAD_VALIDATION_FAILED` | `INPUT_VALIDATION` | One or more form fields contain invalid or incomplete values. | Review highlighted fields, correct values, and resubmit. | `/docs/help#forms` |
| `ERR_NEGATIVE_CONSUMPTION` | `INPUT_VALIDATION` | Consumption units (kWh) cannot be negative. | Enter a valid positive consumption figure. | `/docs/help#meter-readings` |
| `ERR_SIMULATION_BOUNDARY_EXCEEDED` | `SIMULATION_BOUNDARY` | Simulation parameters exceed physical engineering limits. | Adjust inputs within allowed bounds (e.g., solar capacity $\le 50$ kWp). | `/docs/help#digital-twin` |
| `ERR_CONNECTOR_TIMEOUT` | `EXTERNAL_DATA_PROVIDER` | An external data provider took too long to respond. | Cached telemetry remains available; try refreshing in a few minutes. | `/docs/help#data-freshness` |
| `ERR_SERVICE_DEGRADED` | `SYSTEM_DEGRADED` | The service is operating in degraded mode due to upstream latency. | Real-time sync will resume automatically once latency stabilizes. | `/docs/help#system-status` |

---

## 3. Correlation ID & Secret Sanitization

### 3.1 Tracking Identifier Protocol
Every exception processed by `DiagnosticErrorRegistry.create` assigns a cryptographically unique identifier:
```text
corr_9f8a12e4b7
```
When a user encounters a failure, the interface displays:
> *"Support Reference: `corr_9f8a12e4b7`"*

### 3.2 Automated Secret Scrubbing
Before writing technical details to disk or transmitting payloads, `SecretRedactor` automatically applies regex sanitization:
- **Bearer Tokens**: `Bearer eyJ...` $\to$ `Bearer ***REDACTED_TOKEN***`
- **Passwords**: `password="SuperSecret123!"` $\to$ `password="***REDACTED***"`
- **Phone Numbers**: `9876543210` $\to$ `***PHONE_REDACTED***`
- **Account Numbers**: `1234567890` $\to$ `1234****90`
- **Internal Stack Frames**: `File "app/service.py", line 42` $\to$ `[internal stack frame redacted]`

---

## 4. Support Engineer Troubleshooting Runbook

When a consumer files a support request citing a correlation ID:

### Step 1: Query Structured Logs
Search the centralized operational log buffer for the correlation ID:
```bash
grep "corr_9f8a12e4b7" /var/log/urjasetu/operational.log
```

### Step 2: Inspect Error Category & Redacted Technical Detail
Verify the assigned error code (e.g. `ERR_SIMULATION_BOUNDARY_EXCEEDED`).
- If `ERR_SIMULATION_BOUNDARY_EXCEEDED`: Check whether user requested solar sizing beyond 50 kWp or battery capacity beyond 100 kWh.
- If `ERR_TARIFF_NOT_FOUND`: Check whether the user submitted a custom tariff schedule ID that has not yet been seeded into the registry.
- If `ERR_CONNECTOR_TIMEOUT`: Verify upstream provider status in `DataSourceHealthCenter`.

### Step 3: Resolution & Communication
Communicate resolution directly referencing the help documentation URL provided in the diagnostic record without requesting passwords or consumer credentials.
