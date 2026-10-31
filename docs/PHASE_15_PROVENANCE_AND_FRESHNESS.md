# Phase 15: Source Provenance, Freshness & Data Quality

## 1. Truth-in-Data & Provenance Lineage

In UrjaSetu EMS, data honesty is paramount. Every indicator exposed through the Citizen Energy Portal carries explicit, audit-ready provenance metadata tracing back to the primary publisher.

### 1.1 Traceable Lineage Schema
Every `PublicEnergyIndicator` encapsulates:
- `indicator_id`: Unique canonical identifier (e.g., `ind_nat_demand_met`).
- `source_organization`: Official publisher (e.g., Central Electricity Authority (CEA), Ministry of Power).
- `source_dataset`: Statutory report title (e.g., "CEA Power Supply Position Monthly Reports").
- `source_url`: Verifiable official HTTPS URL.
- `reporting_period`: Period to which observation applies (e.g., `2026-03`).
- `retrieval_timestamp`: Timestamp when data was retrieved and validated by UrjaSetu.
- `unit`: Exact engineering unit (`MU` for energy volume, `MW` for power demand).
- `methodology`: Summary of upstream measurement or accounting method.
- `known_limitations`: Documented operational boundaries and caveats.

---

## 2. Multi-Dimensional Freshness Taxonomy

A critical invariant of the platform is that **transport success (e.g., HTTP 200 or file presence) must never be conflated with observation freshness**.

| Freshness Status | Definition | Interpretation & Action |
| :--- | :--- | :--- |
| `FRESH` | Data timestamp is within expected cadence + nominal publication delay. | Current operational data. High confidence. |
| `HISTORICAL_SERIES` | Closed historical accounting series (e.g., completed fiscal year). | Validated historical baseline. Stated explicitly. |
| `DELAYED` | Upstream publisher has exceeded expected publication delay. | Notice displayed: Upstream release overdue. |
| `STALE` | Data exceeds twice nominal cadence window without update. | Warning badge: Stale telemetry; do not assume current state. |
| `AWAITING_DATA` | Connector configured but initial observations pending. | Empty state with informative explanation. |

---

## 3. Publisher Methodology & Known Limitations

### 3.1 Central Electricity Authority (CEA) Power Supply Position
- **Methodology**: Monthly statutory accounting reconciliation across Regional Load Dispatch Centers (RLDCs) and state transmission utilities. Captures total energy requirements and energy supplied in Million Units (MU), alongside peak demand and peak met in Megawatts (MW).
- **Known Limitations**:
  1. Represents **reporting-period accounting reconciliations**, not sub-second frequency regulation or local feeder trips.
  2. Excludes captive off-grid power generation (e.g., private commercial diesel gensets, isolated microgrids).
  3. Figures represent bulk high-voltage grid supply and cannot be proportionally downscaled to revenue districts.

### 3.2 CEA & MNRE Renewable Generation Reports
- **Methodology**: Aggregated monthly generation data for grid-connected utility-scale solar PV, wind, biomass, and small hydro plants submitted by SLDCs and renewable nodal agencies.
- **Known Limitations**:
  1. **Capacity vs. Generation**: Installed capacity (MW) is a nameplate rating; energy generation (MU) reflects actual delivered output under local weather and irradiance.
  2. Unregistered off-grid solar rooftop installations (< 1 kW) without net metering are not captured in utility grid telemetry.

### 3.3 National Power Portal (NPP) Daily Outturn
- **Methodology**: Daily operational generation outturn and peak demand reports compiled by POSOCO (Grid-India).
- **Known Limitations**: Provisional daily estimates subject to monthly SLDC settlement reconciliation.
