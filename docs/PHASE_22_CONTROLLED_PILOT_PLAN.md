# UrjaSetu EMS — Phase 22: Controlled Pilot Plan

**Document Version:** 1.0.0  
**Phase:** Controlled Field Pilot Design  
**Status:** READY FOR OPERATIONAL DEPLOYMENT  
**Pilot Code:** `PILOT-URJA-2026-R1`  

---

## 1. Pilot Objectives & Scope

The purpose of the **UrjaSetu Controlled Pilot (R1)** is to evaluate the software's analytical accuracy, user comprehension, and operational stability in real residential household environments under strictly monitored conditions.

### Primary Objectives
1. **Billing Audit Field Accuracy**: Verify that UrjaSetu's tariff engine matches actual monthly DISCOM utility invoices within $\pm 0.5\%$.
2. **Solar CFA Estimation Usability**: Validate whether prosumers can successfully utilize PM Surya Ghar subsidy estimations and yield projections to make informed solar installation decisions.
3. **Load Shifting Feasibility**: Measure voluntary consumer adoption of recommended off-peak appliance rescheduling.
4. **Data Privacy & System Reliability**: Achieve zero IDOR occurrences, zero unhandled errors, and 100% compliance with data minimization.

---

## 2. Participant Cohort & Geographic Boundary

- **Target Cohort Size**: Exactly 50 opt-in residential households.
- **Geographic Segments**:
  - **Cluster A (Bengaluru Urban, Karnataka)**: 25 households served by BESCOM under tariff LT-2(a).
  - **Cluster B (Visakhapatnam Urban, Andhra Pradesh)**: 25 households served by APEPDCL under tariff LT-1.
- **Sanctioned Load Restriction**: Residential single-phase or three-phase domestic connections with sanctioned load $\le 10\text{ kW}$.
- **Exclusions**: Commercial entities, industrial prosumers, and high-voltage connections are strictly excluded.

---

## 3. Entry & Exit Criteria

### Entry Criteria
1. Written, informed digital consent adhering to the Digital Personal Data Protection (DPDP) Act 2023.
2. Submission of at least 3 consecutive months of official DISCOM billing statements for baseline calibration.
3. Valid meter connection (AMR smart meter or accessible utility meter for monthly photograph submission).
4. Completion of initial property onboarding profile (sanctioned load, tariff category, existing solar capacity).

### Exit Criteria
1. Completion of the full 90-day pilot cycle (3 monthly billing cycles).
2. Receipt of all 3 monthly validation audit reports comparing UrjaSetu calculations against official DISCOM bills.
3. Submission of post-pilot qualitative usability and satisfaction survey.
4. Final delivery of exportable household energy insights report to the participant.

---

## 4. Hard Stop Conditions & Emergency Circuit Breakers

The pilot coordinator must immediately halt the pilot or suspend affected property accounts under any of the following conditions:
1. **Financial Discrepancy Circuit Breaker**: Any calculation discrepancy exceeding $> 2.0\%$ between UrjaSetu's verified bill calculation and an official DISCOM invoice where the input data has been validated.
2. **Privacy / Authorization Violation**: Any detected attempt or software bug allowing cross-household profile access or data leakage.
3. **Data Loss / Integrity Breach**: Any database corruption or telemetry loss that cannot be restored from immutable logs.
4. **Participant Revocation**: Immediate cessation of data processing upon participant withdrawal request (Right to Erasure honored within 48 hours).

---

## 5. Operational Governance & Responsible Roles

| Role | Key Responsibilities | Assigned Operator |
| :--- | :--- | :--- |
| **Pilot Coordinator** | Participant onboarding, consent tracking, weekly status check-ins, participant communication. | Lead Operations Specialist |
| **Quantitative Verification Lead** | Discrepancy investigation, tariff schedule version control, mathematical audit. | Senior Quantitative Engineer |
| **Platform Security Officer** | Access log review, multi-tenant IDOR audit, credential management, encryption enforcement. | Security Assurance Owner |
| **Incident Response Lead** | On-call incident response, circuit-breaker execution, bug triage and patch coordination. | Reliability Engineer |

---

## 6. Privacy, DPDP Act Compliance & Data Retention

1. **Explicit Purpose Limitation**: Telemetry, billing records, and appliance profiles are collected solely for energy optimization and billing audits. Telemetry will never be sold, monetized, or shared with third-party advertisers.
2. **Right to be Forgotten**: Upon pilot completion or early participant exit, all uploaded billing PDFs and granular telemetry can be permanently purged upon written request.
3. **Data Encryption**: All data at rest is encrypted using AES-256; all communications enforce TLS 1.3.

---

## 7. Success Metrics & KPIs

- **Bill Audit Agreement Rate**: $\ge 98.0\%$ of bills within $\pm 0.5\%$ variance.
- **System Uptime**: $\ge 99.5\%$ during the 90-day pilot window.
- **User Task Completion Rate**: $\ge 90.0\%$ for bill upload and recommendation review.
- **Critical Security Incidents**: Exactly 0.
