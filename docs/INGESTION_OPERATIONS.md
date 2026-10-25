# Ingestion Operations, Idempotency & Operational Safety — UrjaSetu EMS

## 1. Idempotent Ingestion Architecture

Ingestion into UrjaSetu EMS is strictly idempotent. Repeated execution against the same source file or feed produces zero duplicate records.

### Composite Key Design
Each observation slot is identified by a deterministic SHA-256 composite hash:
$$\text{CompositeKey} = \text{SHA256}(\text{source\_id} : \text{metric\_id} : \text{geo\_id} : \text{period\_start} : \text{period\_end} : \text{measurement\_kind})[:24]$$

### Ingestion Decision Matrix:
1. **New Slot**: Composite key unseen $\rightarrow$ Action `INSERTED_NEW`, Version = 1.
2. **Byte-Identical Re-Ingestion**: Composite key exists, normalized value is identical $\rightarrow$ Action `IGNORED_DUPLICATE`.
3. **Official Provider Revision**: Composite key exists, normalized value differs, publication timestamp updated $\rightarrow$ Action `REVISED_CORRECTION`.
   - Current record updated to new value.
   - Version incremented to $N+1$.
   - Previous record archived in `history: list[tuple[version, observation, timestamp]]`.
4. **Rejected Record**: Quality rule failure $\rightarrow$ Action `REJECTED_INVALID`. Logged with failure diagnostic.

---

## 2. Operational Safety Mechanisms

### 1. Secret & PII Redaction (`SecretRedactor`)
- Automatically redacts sensitive fields before persisting or logging:
  - Passwords and database secrets (`***REDACTED_CREDENTIAL***`).
  - Bearer tokens (`Bearer ***REDACTED_TOKEN***`).
  - 10-digit consumer phone numbers (`***PHONE_REDACTED***`).
  - Consumer account and meter numbers (partially masked: `1234****90`).

### 2. Resilient Retry Policy (`RetryPolicy`)
- Default: `max_retries = 3`, `base_delay = 1.0s`, `backoff_factor = 2.0`, `max_delay = 30.0s`.
- Applies randomized jitter to avoid thundering-herd spikes on upstream government portals.

### 3. Token-Bucket Rate Limiter (`RateLimiter`)
- Protects public utility and open data portals from overload.
- Default limit: 30 requests per minute per provider domain.

### 4. Schema-Drift Detection (`SchemaDriftDetector`)
- Compares incoming JSON/CSV column sets against registered schema contracts.
- Missing required columns halt ingestion with fatal error.
- Unexpected new columns generate non-blocking warnings while preserving new metadata.

---

## 3. Operational CLI Commands

### Run Data Trust Automated Test Suite:
```bash
.\.venv\Scripts\python -m pytest tests/avishkar_ems/test_data_trust.py -v
```

### Run Full Python EMS Test Suite:
```bash
.\.venv\Scripts\python -m pytest tests/avishkar_ems -q
```

### Run Linter (Zero Fix Mode):
```bash
.\.venv\Scripts\python -m ruff check src/avishkar_ems app tests/avishkar_ems --no-fix
```

### Execute Connector Health Checks:
```python
from avishkar_ems.trust.source_registry import SourceRegistry
from avishkar_ems.trust.connectors.cea_connector import CeaConnector

cea_source = SourceRegistry.get_source("CEA_PSP_MONTHLY")
connector = CeaConnector(cea_source)
report = connector.health_check()
print(f"CEA Health: {report.is_healthy} | Latency: {report.latency_ms}ms")
```

### Launch Unified Explorer Dashboard:
```bash
.\.venv\Scripts\python -m streamlit run app/dashboard.py
```
