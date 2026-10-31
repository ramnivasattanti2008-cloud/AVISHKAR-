# Phase 16 — Known Limitations & Operational Boundaries

## 1. Scope Boundaries

In accordance with UrjaSetu Truth-in-Data invariants, the AI Energy Copilot operates strictly within verified capabilities and transparently declares the following limitations:

---

## 2. Documented Limitations

### 2.1 Main-Meter vs. Sub-Meter Telemetry
- **Limitation**: Household consumption intervals and anomalies are recorded at the property main service connection.
- **Impact**: The Copilot cannot definitively attribute an energy spike to a specific appliance (e.g. distinguishing an EV charger from an air conditioner) unless the user has explicitly declared appliance ratings.
- **Handling**: Evidence items include the limitation: *"Intervals reflect main meter; appliance sub-metering is unavailable."*

### 2.2 Statutory Billing Cycles vs. Calendar Months
- **Limitation**: DISCOM meter reading cycles rarely coincide with strict calendar months (e.g. cycle runs from 8th to 8th).
- **Impact**: Monthly bill amounts cannot be assumed to represent calendar-month kWh sums exactly.
- **Handling**: Bill breakdown evidence items state: *"Reflects DISCOM billing cycle dates, not strict calendar month."*

### 2.3 Grid Telemetry vs. District Downscaling
- **Limitation**: Official Central Electricity Authority (CEA) power supply position reports are published at national, regional, and state transmission levels.
- **Impact**: The Copilot refuses to invent synthetic downscaled electricity demand numbers for individual municipal revenue districts.
- **Handling**: The Copilot directs users to state-level statutory balances and explicitly notes: *"Bulk high-voltage supply figures; not downscaled to revenue districts."*

### 2.4 Statistical Anomaly vs. Physical Fault
- **Limitation**: Consumption anomalies are flagged using Median Absolute Deviation (MAD > 3.0σ).
- **Impact**: A statistical outlier indicates unusual usage, not physical equipment malfunction or utility meter tampering.
- **Handling**: Anomaly evidence includes the limitation: *"Flags statistical outliers; does not prove equipment fault without physical audit."*

### 2.5 Dynamic Fuel Adjustment Charges (FAC)
- **Limitation**: Tariff calculations currently model statutory base telescopic slabs and fixed demand charges.
- **Impact**: Fluctuating monthly fuel adjustment charges (FAC/FPPCA) published post-facto by state commissions are not predicted dynamically.
- **Handling**: Tariff calculation evidence explicitly states: *"Excludes ad-hoc fuel cost adjustment charges (FAC)."*
