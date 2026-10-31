# UrjaSetu EMS Phase 18: Known Limitations & Boundary Disclaimers

## 1. Truth-in-Data Boundary Limitations

1. **Absence of Device Sub-Metering**: Interval consumption alerts are derived from the household main smart meter feed. In the absence of physical appliance sub-meters (e.g. CT clamps or smart plugs), the system cannot pinpoint the exact appliance causing an interval spike.
2. **Provider Delivery Uncertainty**: When an external provider returns `ACCEPTED_BY_PROVIDER`, the system records this status honestly. Until upstream delivery receipts or webhooks are returned, delivery remains unconfirmed.
3. **Mock Gateway Boundaries**: In the current development and demonstration environment, email, SMS, and webhook providers run through realistic mock adapters with simulated latency and failure injection. They must not be conflated with commercial production delivery credits.
4. **Periodic Ingestion vs. Real-Time Streaming**: External public datasets (e.g. CEA national balances, KPTCL generation reports) are published on monthly or daily schedules. Operational alerts reflect the actual publication cadence, not sub-second telemetry feeds.

---

## 2. Scope Boundaries

1. **Automated Control Actions**: Acknowledging or resolving an alert in UrjaSetu EMS records the operational lifecycle state; it does NOT remotely disconnect consumer circuit breakers or dispatch field utility crews.
2. **Regulatory Approval**: Direct automated two-way integrations with state DISCOM SCADA grids (BESCOM, APEPDCL) remain subject to formal consumer OTP verification and institutional MOUs.
