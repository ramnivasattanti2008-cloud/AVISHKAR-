# PHASE 25: KNOWN SYSTEM LIMITATIONS & DEPENDENCIES
## URJASETU EMS — RESIDUAL CONSTRAINTS, ENVIRONMENTAL DEPENDENCIES & TECHNICAL GAPS

**Audit Date:** 2026-10-24  
**Auditor:** Reliability Engineer & System Architect  
**Scope:** UrjaSetu EMS v1.0.0-rc.1

---

## 1. Hardware & Physical Infrastructure Limitations

1. **No Hardware Modbus / SunSpec Bridge:**
   - *Current State:* Inverter optimization ([optimise.py](file:///C:/Users/Ram%20Nivas/projects/AVISHKAR-/platform/engine/avishkar_engine/optimise.py)) computes mathematical charge/discharge schedules using Linear Programming (LP), but does not issue physical register writes to hardware inverters over RS-485.
   - *Impact:* The system operates strictly as an **advisory decision-support system**. Users must manually set inverter operating modes or battery charging schedules.
2. **Sub-Metered Telemetry Absence:**
   - *Current State:* Appliance-specific energy breakdowns (e.g. air conditioning, water heaters) rely on user-reported wattage and hours rather than dedicated physical CT clamps.
   - *Impact:* Recommendations derived from user-reported appliance specs carry moderate uncertainty (confidence score $\approx 0.82$).

---

## 2. External Integration & Third-Party Dependencies

1. **Live DISCOM Smart Meter API Credentials:**
   - *Current State:* Indian DISCOMs (BESCOM, APEPDCL) do not provide public, open, standardized OAuth2 APIs for automated consumer smart-meter telemetry streaming without formal institutional enterprise agreements.
   - *Impact:* Pilot households must upload utility statements in CSV/PDF format. Direct smart-meter streaming in [discom.ts](file:///C:/Users/Ram%20Nivas/projects/AVISHKAR-/platform/api/src/energy/discom.ts) is simulated for development.
2. **Public Solar & Weather Feeds:**
   - *Current State:* Solar generation predictions rely on external feeds (NASA POWER and Open-Meteo).
   - *Impact:* When network access is unavailable, solar generation relies on cached historical seasonal yield figures ($1,450$ kWh/kWp/year in southern India).

---

## 3. Mathematical & Algorithmic Boundaries

1. **Statutory Tariff Geographic Coverage:**
   - *Current State:* Full mathematical verification is established for Karnataka (BESCOM LT-2a) and Andhra Pradesh (APEPDCL LT-1). Tamil Nadu (TANGEDCO) and Gujarat (UGVCL) are cataloged but lack 12-month reconciliation field datasets. Other states (e.g. Maharashtra, Telangana) are unindexed.
   - *Impact:* Households outside the verified pilot states receive indicative benchmark calculations rather than certified billing reconciliations.
2. **Simplified Thermal Capacitance in Scenario Simulations:**
   - *Current State:* The Digital Twin scenario model ([digital_twin.py](file:///C:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/digital_twin.py)) simulates AC setpoint adjustments using standard thermodynamic BEE benchmarks (6% energy reduction per 1°C increase).
   - *Impact:* Structural thermal inertia, building insulation quality, and air infiltration rates are not individually modeled.

---

## 4. Operational & Deployment Constraints

1. **Local-Only Backup Storage:**
   - *Current State:* Encrypted database backups created by [release_safety.py](file:///C:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/release_safety.py) are stored on the local filesystem.
   - *Impact:* Offsite redundancy requires external orchestration (e.g. S3 sync or cloud backup volume snapshot).
2. **Standalone Memory Sessions:**
   - *Current State:* In standalone Streamlit mode ([app/dashboard.py](file:///C:/Users/Ram%20Nivas/projects/AVISHKAR-/app/dashboard.py)), user sessions are maintained in process memory.
   - *Impact:* Server restarts terminate active UI sessions; persistent multi-user sessions require the Next.js platform web tier with PostgreSQL session storage.
3. **Screen-Reader Speech Synthesis Testing:**
   - *Current State:* Automated contrast, markup, and keyboard focus tests pass; manual evaluation with physical JAWS/NVDA screen-reader software across diverse screen sizes remains pending field pilot validation.
