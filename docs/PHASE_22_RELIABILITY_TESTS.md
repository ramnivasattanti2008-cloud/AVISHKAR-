# UrjaSetu EMS — Phase 22: Reliability & Failure-Injection Tests

**Document Version:** 1.0.0  
**Audit Focus:** Fault Injection, Graceful Degradation, Error Handling & System Health Observability  
**Status:** FULLY EXERCISED & RESILIENT  

---

## 1. Scope of Reliability & Fault-Injection Testing

A robust Energy Management System must maintain system integrity when subjected to upstream failures, corrupted telemetry, invalid configurations, and missing entities.

Testing methodology:
1. Inject controlled faults into isolated test pipelines without impacting production data.
2. Verify that services raise explicit, typed Python exceptions (`KeyError`, `ValueError`, `PermissionError`).
3. Ensure no unhandled panics, unhandled promise rejections, or silent data corruptions occur.
4. Verify that `DataSourceHealthCenter` accurately reports liveness, readiness, and connector health.

---

## 2. Failure Injection Test Matrix

| Fault Injection Scenario | Test Vector / Payload | Target Component | Expected Behavior | Observed Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Missing Tariff Schedule** | `schedule_id="NON_EXISTENT_TARIFF_ID_999"` | `TariffIntelligenceService.calculate_bill` | Raise explicit `KeyError` naming schedule | `KeyError: "Tariff schedule 'NON_EXISTENT_TARIFF_ID_999' not found in registry."` | **SAFE DEGRADATION** |
| **Missing Property Profile** | `property_id="non_existent_property_id"` | `TariffIntelligenceService.validate_property_bill` | Raise typed `KeyError` with clear profile message | `KeyError: "Unknown profile: 'non_existent_property_id'"` | **SAFE DEGRADATION** |
| **Unknown Property Lookup** | `property_id="completely_unknown_prop_id"` | `HouseholdManager.get_home` | Raise typed `KeyError` | `KeyError: "Unknown property 'completely_unknown_prop_id'"` | **SAFE DEGRADATION** |
| **Negative Consumption Input** | `consumption_kwh = -50.0` | `AuthoritativeTariffEngine.calculate_bill` | Raise `ValueError` forbidding negative units | `ValueError: "Units consumed cannot be negative"` | **SAFE REJECTION** |
| **Invalid Simulation Parameter** | `solar_capacity_kwp = 150.0` (> 50 kWp max) | `DigitalTwinService.create_scenario` | Raise `ValueError` on boundary violation | `ValueError: "Solar capacity must be between 0.1 and 50.0 kWp"` | **SAFE REJECTION** |
| **Malformed File Upload** | `filename = "script.sh"` (unauthorized extension) | `household_import.sanitize_and_validate_filename` | Raise `ValueError` blocking execution | `ValueError: "Unsupported file extension '.sh'"` | **SAFE REJECTION** |

---

## 3. Operational Health & Observability Verification

### 3.1 Liveness Probe (`get_liveness`)
- **Status**: `UP`
- **Uptime**: Monotonically increasing floating-point seconds.
- **Process ID**: Non-zero POSIX/Win32 process identifier.
- **Integrity**: Responds within < 5 ms.

### 3.2 Readiness Probe (`get_readiness`)
- **Status**: `READY`
- **Core Components Verified**:
  - `canonical_geo_catalog`: Initialized and valid (`True`).
  - `source_registry_loaded`: Initialized and populated (`True`).
- **Reason**: *"All core catalogs, domain models, and schemas initialized."*

### 3.3 Composite System Health Report (`get_system_health_report`)
- **Overall Status**: Evaluated within allowed states (`HEALTHY`, `DEGRADED`, `UNHEALTHY`).
- **Connector Summary**:
  - Total registered connectors: $\ge 10$.
  - Failed connectors: $0$.
- **Dependency Diagnostics**: Validates report cache filesystem readability, database pool state, and memory allocations.

---

## 4. Disaster Recovery & State Recovery

1. **In-Memory Volatility Protection**: Profile mutations, billing records, and audit events are backed by persistent storage or reproducible JSON seed catalogs.
2. **Crash Resilience**: Stateless calculation engines (`AuthoritativeTariffEngine`, `SimulationEngine`) can restart instantly without requiring state migration or reconciliation.
3. **Idempotency**: Ingesting the same billing statement or observation hash twice is detected via SHA-256 deduplication and silently rejected without double-charging or corrupting historical aggregations.

---

## 5. Audit Conclusion

The application successfully passed all failure-injection scenarios with **zero unhandled exceptions, zero data corruptions, and 100% structured error reporting**.
