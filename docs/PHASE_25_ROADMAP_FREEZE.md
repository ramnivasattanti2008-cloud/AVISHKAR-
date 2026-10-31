# PHASE 25: PRODUCT ROADMAP & FEATURE SCOPE FREEZE
## URJASETU EMS — SCOPE FREEZE SPECIFICATION & POST-PILOT HORIZONS

**Effective Date:** 2026-10-24  
**Status:** **ACTIVE FEATURE FREEZE IN EFFECT**  
**Governing Authority:** UrjaSetu Product Acceptance Board  
**Target Baseline:** Phase 25 Release Candidate (`v1.0.0-rc.1`)

---

## 1. Feature Freeze Declaration

In accordance with Section 17 of the Phase 25 Product Acceptance Mandate, **all feature development on UrjaSetu EMS is officially FROZEN**. No new functional capabilities, user interface features, or external third-party integrations may be introduced into the repository until the conclusion of the controlled pilot (`PILOT-URJA-2026-R1`).

Only emergency security patches or low-risk defect fixes directly required to sustain pilot operations are permitted.

---

## 2. Capability Classification & Prioritization Matrix

### Priority Tiers:
- **P0 — Acceptance Blockers (Pilot Scope):** Must be complete for pilot acceptance. **(STATUS: 100% COMPLETE)**.
- **P1 — Required Before Broader Deployment:** Must be completed before expanding beyond 50 households.
- **P2 — Post-Pilot Improvements:** Non-blocking operational and usability refinements.
- **P3 — Future Roadmap:** Speculative or next-generation product features.

| Item ID | Category | Tier | Feature Description | Justification & Verification Criteria | Target Milestone |
|---|---|---|---|---|---|
| **F-01** | Core EMS | **P0** | Authoritative Tariff Engine (BESCOM / APEPDCL) | Verified math on slab tiers, minimum charges, tax duty. | `Phase 25 Complete` |
| **F-02** | Core EMS | **P0** | Anti-Double-Counting Invariant Guard | Prevents cumulative savings from exceeding baseline bill. | `Phase 25 Complete` |
| **F-03** | Core EMS | **P0** | Diurnal Energy Conservation Simulation | Strict hourly energy balance in digital twin scenarios. | `Phase 25 Complete` |
| **F-04** | Security | **P0** | Multi-Tenant IDOR & Unauthorized Access Guard | Server-side household ownership verification. | `Phase 25 Complete` |
| **F-05** | Security | **P0** | AI Copilot Adversarial Prompt Injection Defense | Regex defusal of instruction overrides and SQL probes. | `Phase 25 Complete` |
| **F-06** | Security | **P0** | Upload File Path Traversal & Executable Stripper| Blocks `.exe` and strips `../` in bill import. | `Phase 25 Complete` |
| **F-07** | Reliability| **P0** | Authenticated Encrypted Backup & Restore Drills | PBKDF2-HMAC AES-CBC backup with verified $<50$ ms drill. | `Phase 25 Complete` |
| **F-08** | Ingestion | **P1** | Live DISCOM Smart Meter AMI Connectors | Automated OAuth2/AMI synchronization replacing manual CSV. | `Phase 26 (Post-Pilot)` |
| **F-09** | Hardware | **P1** | Hardware Modbus/SunSpec Inverter Control Bus | Automated bidirectional inverter dispatch schedules. | `Phase 26 (Post-Pilot)` |
| **F-10** | Tariffs | **P1** | National Tariff Expansion (MSEDCL, TSERC, UPPCL)| Ingestion and verification of additional state schedules. | `Phase 26 (Post-Pilot)` |
| **F-11** | Reliability| **P2** | Multi-Region Remote Backup Replication (S3/GCS)| Automated encrypted backup sync to cloud object storage. | `Phase 27` |
| **F-12** | AI Safety | **P2** | Semantic LLM Guardrails (Llama-Guard / NeMo) | Multi-turn semantic context evaluation for copilot queries. | `Phase 27` |
| **F-13** | UX / A11y | **P2** | SVG Chart Sonification & Dynamic Screen-Reader | Audio tones and spoken descriptions for interactive graphs. | `Phase 27` |
| **F-14** | Market | **P3** | Peer-to-Peer (P2P) Microgrid Energy Trading | Blockchain/ledger-based localized energy trading. | `Future Roadmap` |
| **F-15** | Fintech | **P3** | Automated UPI / BBPS Electricity Bill Payments | Embedded settlement and automated direct bill clearing. | `Future Roadmap` |

---

## 3. Scope Reopening Protocol

To propose any alteration to the frozen codebase during the pilot phase, the following process must be observed:
1. **Formal Request Submission:** Submit a Change Request (CR) documenting the bug/vulnerability with reproducible test evidence.
2. **Impact Assessment:** The SRE lead must certify that the change introduces zero schema modifications, zero external API dependencies, and does not alter statutory tariff math.
3. **Approval Threshold:** Approval requires unanimous consensus between the Principal Software Architect and QA Director.
4. **Post-Fix Verification:** Must execute the 194-test regression suite and demonstrate 100% pass rate prior to merging.
