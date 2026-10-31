# Phase 20: Electricity Market Intelligence & Tariff Engine — Known Limitations & Operational Boundaries

## 1. Statutory Scope & Regulatory Boundaries

The UrjaSetu EMS Electricity Market Intelligence module (`src/avishkar_ems/tariff_intelligence.py`) provides deterministic, auditable bill calculations, utility bill validation, tariff comparisons, and time-of-use (ToU) demand optimization. In strict adherence to the **Data Honesty Invariant (D6/D7)**, the following statutory boundaries and limitations apply.

---

## 2. Inventory of Known Limitations

### 2.1 Lack of Machine-Readable Real-Time APIs from Indian State Electricity Regulatory Commissions (SERCs)
- **Constraint**: Indian SERCs (KERC, APERC, TNERC, GERC, MERC, DERC, etc.) do not expose automated, version-controlled JSON/REST APIs for retail electricity tariffs.
- **Operational Reality**: Tariff orders are published as signed statutory gazette PDF documents or scanned image PDFs.
- **System Mitigation**:
  - The module implements a formal statutory registry pre-seeded with verified schedules extracted from official tariff orders.
  - Every schedule records the official document URL, publishing commission/licensee, publication date, retrieval date, verification status, and an immutable SHA-256 document digest (`source_document_sha256`).
  - Automated dynamic scraping is deliberately restricted to prevent silent ingestion of corrupt or unratified draft proposals.

### 2.2 Quarterly Fuel Adjustment Charges (FAC / FPPCA)
- **Constraint**: Fuel and Power Purchase Cost Adjustments (FPPCA/FAC) fluctuate quarterly or bi-monthly based on actual thermal coal/gas import spot prices and Discom generation pass-through petitions.
- **Operational Reality**: Baseline tariff schedules define base energy rates and fixed charges for the regulatory tariff year (FY24, FY25). While statutory base FAC adders (e.g., BESCOM ₹0.22/kWh, APCPDCL ₹0.18/kWh, UGVCL ₹0.30/kWh) are captured in the verified schedule, sudden interim fuel surcharges levied mid-quarter by state discoms may cause minor variances.
- **System Mitigation**:
  - The bill validation engine distinguishes statutory base rates from quarterly fuel adders.
  - When an imported bill exhibits a discrepancy strictly bounded by $U \times R_{\text{fac}} + \text{₹}5.00$, the system classifies it as `DISCREPANCY_EXPLAINED`, citing specific FAC/fuel adjustments rather than alleging billing errors.

### 2.3 Reactive Power, Low Power Factor (PF) Penalties, and Maximum Demand Charges
- **Constraint**: High-tension (HT) industrial and large commercial installations (>50 kW) face power factor surcharges (e.g., penalty for PF < 0.85 lag, incentives for PF > 0.95 lead/lag) and recorded Maximum Demand Indicator (MDI) kVArh penalties.
- **Operational Reality**: Low-tension (LT) domestic and commercial consumers (LT-2, LT-3, LT-1) under 50 kW sanctioned load are billed on active energy (kWh) and sanctioned load (kW).
- **System Mitigation**:
  - Phase 20 explicitly scopes Low-Tension (LT) retail categories.
  - HT power factor penalty algorithms and two-part tariff kVA maximum demand evaluations are explicitly flagged as out-of-scope for the retail LT engine and documented in `CalculatedBillBreakdown.notes`.

### 2.4 Multi-Tenant Master Meter vs Sub-Metered Billing
- **Constraint**: Gated communities, residential apartment complexes, and shared commercial buildings frequently possess a single HT/LT bulk master meter from the Discom, while individual tenants use private sub-meters.
- **Operational Reality**: The Discom bills the master meter at higher commercial or bulk domestic slabs, whereas internal sub-meter billing applies internal association maintenance rates.
- **System Mitigation**:
  - `TariffIntelligenceService` requires a valid `property_id` and checks multi-tenant household ownership.
  - Bill validation explicitly identifies whether the ingested bill represents an individual Discom utility consumer account (`account_number` matched) or a sub-meter reading, disallowing direct SERC tariff comparisons against arbitrary tenant sub-billing arrangements.

### 2.5 Time-of-Day (ToD) Interval Resolution
- **Constraint**: Accurate time-of-use (ToU) billing calculations require smart meter interval data (15-minute or 1-hour interval profiles).
- **Operational Reality**: In households equipped with legacy electromechanical or non-communicating electronic meters, only cumulative monthly kWh is recorded.
- **System Mitigation**:
  - The engine strictly refuses to synthesize artificial hourly consumption profiles if only monthly cumulative energy is supplied.
  - When hourly interval data is available, `TimeOfUseOptimizer` enforces the **Energy Conservation Invariant** ($100\%$ kWh preservation across shifted slots) and models statutory SERC peak/off-peak surcharges.

### 2.6 Solar Gross Metering vs Net Metering Settlement Cycles
- **Constraint**: State solar policies differ in settlement cycles:
  - Karnataka KERC mandates monthly banking settlement with solar export compensation credited at ₹3.10/kWh against gross bills, subject to monthly fixed charge floors.
  - Andhra Pradesh APERC enforces annual settlement (March 31) with unutilized banked units lapsing or reimbursed at average pooled purchase cost (APPC).
- **Operational Reality**: The retail billing engine models monthly net billing offset down to `min_monthly_charge_inr`.
- **System Mitigation**:
  - Export compensation is calculated strictly from verified schedule `solar_export_credit_rate_inr` and capped such that payable bill cannot drop below the statutory Discom minimum monthly fixed charge.

---

## 3. Disclaimers & Consumer Guidance

1. **Not an Official Bill**: All outputs generated by `AuthoritativeTariffEngine` are labeled with `is_official_bill = False` and `calculation_type = RECONSTRUCTED_ESTIMATE`. They do not constitute statutory tax invoices or legal utility bills.
2. **Consumer Eligibility Proof**: Recommending an alternative tariff (e.g., LT-2 to LT-3, or time-of-use opt-in) is strictly conditional on consumer category eligibility, sanctioned load limits, and local Discom approval. UrjaSetu EMS does not claim guaranteed tariff migration or unverified financial returns.
3. **Audit Trail**: Every calculation and comparison provides full transparency into applicable components, excluded components, assumptions, statutory SERC order citations, and SHA-256 document fingerprints.
