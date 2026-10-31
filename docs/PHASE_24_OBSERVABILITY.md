# Phase 24: UrjaSetu EMS Observability & Diagnostics

## 1. System Health Architecture

UrjaSetu EMS provides honest, transparent health reporting across process, database, optimization solver, and external upstream data providers.

### Health Endpoint Boundaries

| Endpoint | Responsibility | Authentication | Intended Consumer | Failure Response |
|---|---|---|---|---|
| `GET /api/health` | **Liveness Probe**: Confirms the Fastify HTTP process is running and accepting event loop tasks. | Public / None | Kubernetes / Docker liveness probe; load balancer | HTTP 500 / Connection refused |
| `GET /api/system/health` | **Readiness & Dependency Probe**: Evaluates database connectivity, PostGIS version, HiGHS solver state, and rolling 15-minute provider health. | Public / None | Cluster readiness probe; Prometheus / Datadog synthetic monitors | HTTP 200 with `status: "degraded"` |

---

## 2. Honest Health Semantics (Spec D6/D7 Invariant)

The system adheres strictly to honest operational health reporting:
1. **No Guessing**: A provider that has received zero requests in the last 15-minute window is reported as `state: "unknown"`, **never** falsely claimed as `healthy`.
2. **Degraded vs Down**:
   - `healthy`: 0 failures in window.
   - `degraded`: Failure rate between 0% and 100% (specifically $\ge 20\%$).
   - `down`: 100% failure rate in window.
3. **Decoupled Engine Failure**: If the Python optimization engine is offline, the API does not crash. It reports `engine.state: "down"` and returns `status: "degraded"`. Static pages, household bill audits, and tariffs remain fully functional.

### Example `/api/system/health` Response
```json
{
  "status": "ok",
  "database": {
    "state": "healthy",
    "postgis": "3.4.2",
    "latencyMs": 4,
    "error": null
  },
  "providers": [
    {
      "provider": "nominatim",
      "state": "healthy",
      "calls": 12,
      "failures": 0,
      "p50Ms": 142,
      "p95Ms": 310,
      "lastSuccessAt": "2026-10-24T15:30:12.412Z",
      "lastErrorAt": null,
      "lastError": null
    },
    {
      "provider": "open-meteo",
      "state": "unknown",
      "calls": 0,
      "failures": 0,
      "p50Ms": null,
      "p95Ms": null,
      "lastSuccessAt": null,
      "lastErrorAt": null,
      "lastError": null
    }
  ],
  "engine": {
    "state": "healthy",
    "version": "0.1.0",
    "solver": "HiGHS 1.8.0",
    "error": null
  },
  "windowMinutes": 15,
  "generatedAt": "2026-10-24T15:32:00.000Z"
}
```

---

## 3. Structured Logging & Correlation Tracking

1. **Correlation Identifiers (`corr_...`)**:
   - Every request is assigned a unique tracking identifier via `x-request-id` header or generated internally (`corr_<hex>`).
   - All database queries, engine optimization runs, external provider calls, and caught exceptions propagate this correlation ID.
2. **Safe Diagnostic Error Reporting**:
   - User-facing error responses display `safe_user_message` and `correlation_id`.
   - Raw stack traces, SQL syntax strings, database credentials, and consumer telephone/account numbers are scrubbed by `SecretRedactor` before being written to operational logs.
3. **Log Format**:
   Structured JSON logs are emitted on stdout for seamless ingestion by Fluentd, Promtail, AWS CloudWatch, or Google Cloud Logging:
   ```json
   {
     "level": "error",
     "time": 1792855920000,
     "pid": 1240,
     "hostname": "urjasetu-api-prod-01",
     "reqId": "corr_9a8f21b4",
     "category": "DATA_SOURCE_UNAVAILABLE",
     "message": "Open-Meteo endpoint returned HTTP 504 Gateway Timeout",
     "provider": "open-meteo",
     "latencyMs": 10002
   }
   ```

---

## 4. Current Monitoring Gaps & Future Enhancements

The following operational telemetry capabilities are documented as **Recommended Future Enhancements**:
1. **Prometheus Metrics Exporter**: Native `/metrics` endpoint exporting OpenMetrics format (request duration histograms, active DB connections, LP solve duration percentiles).
2. **APM Distributed Tracing**: OpenTelemetry instrumentation for end-to-end tracing across Next.js Web -> Fastify API -> Python Engine -> PostgreSQL.
3. **Automated Alerting Thresholds**: PagerDuty / Opsgenie alert webhooks triggered when `/api/system/health` reports `status: "degraded"` for $\ge 5$ consecutive polling intervals.
