# UrjaSetu EMS — Household Energy Intelligence & Multi-Home Monitoring (Phase 9)

## 1. Overview & Architectural Principles

Phase 9 implements a production-grade, privacy-conscious household energy intelligence system inside UrjaSetu EMS. It provides software-only monitoring and predictive intelligence across multiple residential connections, with specialized support for:
- **Home A**: Bengaluru, Karnataka (served by Bangalore Electricity Supply Company — BESCOM).
- **Home B**: Visakhapatnam / Andhra Pradesh (served by Eastern Power Distribution Company of AP — APEPDCL, or APSPDCL / APCPDCL).

### Core Invariants:
1. **Software-Only Architecture**: Operates on utility bills and smart meter exports. Zero dependence on proprietary IoT hubs, hardware smart meters, or paid APIs.
2. **Multi-Home Isolation & Ownership**: Every household property is owned by an authenticated user. Cross-user access is denied at the server layer with strict `PermissionError` enforcement.
3. **Cumulative vs. Interval Distinction**: Cumulative meter readings are differentiated ($\Delta R = R_t - R_{t-1}$) to calculate interval energy consumption. Cumulative readings are **never summed** as interval consumption.
4. **Meter Reset Safety**: When a cumulative reading drops ($R_t < R_{t-1}$), the system detects `RESET_DETECTED` and records positive consumption, avoiding spurious negative intervals.
5. **Decoupled Solar Physics**: Solar installed capacity (kWp) represents DC nameplate rating and is strictly decoupled from actual generated energy (kWh). The system never presents capacity-based estimates as measured generation.
6. **Zero Utility Password Storage**: Scraped browser sessions and stored utility passwords are explicitly forbidden. Live synchronization is restricted to official OAuth tokens or consumer OTPs.
7. **No Synthetic Downscaling**: Household consumption is strictly property-level and is never inferred from state-level or national totals.

---

## 2. Supported Data-Source Registry & Status

| Data-Source Type | Description | Implementation Status | Verification Notes |
|:---|:---|:---:|:---|
| **Official Provider API** | Direct authenticated REST/OAuth API from DISCOM | **AWAITING_AUTHORIZATION / NOT_CONFIGURED** | BESCOM Mithra portal requires OAuth token; AP DISCOMs require consumer mobile OTP. No unauthenticated background API exists. Password scraping is strictly prohibited. |
| **Official Bill Statement (PDF)** | Downloaded utility bill PDF statement | **SUPPORTED** | Text-based PDF extracts parsed for bill month, dates, units, amounts, and solar credits with review step. |
| **Structured Bill (CSV / XLSX)** | Utility portal tabular billing statement | **SUPPORTED** | Parsed via pure standard-library CSV and zipfile+XML XLSX parsers. |
| **Smart Meter Intervals (CSV / XLSX)** | Sub-hourly/hourly meter data from consumer portal | **SUPPORTED** | Configurable 9-step wizard with column mapping, duplicate skipping, reset detection, and spike alerts. |
| **Manual Reading / Entry** | User-entered meter reading or bill figures | **SUPPORTED** | Fallback for scanned/unparseable paper bills with explicit audit provenance. |
| **Solar Inverter Telemetry** | Exported generation records from solar inverter | **SUPPORTED** | Recorded as `SOLAR_GENERATION` observations, keeping generation distinct from grid import/export. |

---

## 3. Multi-Home Management

Users can register, rename, reconfigure, and delete multiple properties. Each property record maintains:

```python
@dataclass
class HouseholdProfile:
    profile_id: str
    user_id: str
    display_name: str
    city: str
    district: str
    locality: str
    state: str  # "KA", "AP"
    utility: UtilityProvider  # BESCOM, APEPDCL, APSPDCL, APCPDCL, OTHER
    connection_account_id: str  # Masked in UI, e.g., "BES***1029"
    sanctioned_load_kw: float
    solar_capacity_kwp: float
    battery_capacity_kwh: float
    tariff_category: str  # "LT-2(a) Domestic", "LT-1 Domestic"
    integration_status: IntegrationStatus
    has_submetered_appliances: bool
    bills: list[UtilityBillRecord]
    observations: list[HouseholdObservation]
```

### Privacy & Account Number Masking
- Consumer account identifiers are masked using SHA-256 truncation or prefix/suffix masking (e.g. `BES982341029` -> `BES...1029`).
- Server-side authorization gates (`get_home`, `update_home`, `delete_home`) verify that the active `user_id` matches the property's `user_id`. Unauthorized cross-user calls raise `PermissionError`.

---

## 4. Electricity Bill Import & Review Workflow

The bill import engine ([`HouseholdBillParser`](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/household_import.py)) extracts key financial and energy fields from utility statements:

1. **Billing Period**: Detects `YYYY-MM` (e.g. `2026-02`).
2. **Billed Date & Due Date**: Date of issuance and payment deadline.
3. **Consumption (kWh)**: Total billed energy.
4. **Financial Breakdown**:
   - Total Net Bill Amount (₹)
   - Fixed Charges (₹)
   - Energy Charges (₹)
   - State Electricity Duties & Taxes (₹)
5. **Solar Net-Metering**:
   - Gross/Net Export Energy (kWh)
   - Solar Export Credit (₹)
6. **Pre-Commit Review Step**:
   - The user reviews extracted values, confidence scores, and parsing caveats before confirming persistence.

---

## 5. Meter-Reading Import Wizard (9 Steps)

The meter-reading import engine ([`MeterReadingImportEngine`](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/household_import.py)) implements an end-to-end wizard:

1. **Select Property**: Chooses target home.
2. **Upload File**: Accepts CSV or XLSX (size $\le 10$ MB).
3. **Map Columns**: Maps source columns to `timestamp`, `cumulative_reading_kwh`, `interval_kwh`, `solar_kwh`.
4. **Preview & Validate**: Differentiates cumulative readings, detects cadences (e.g. 15-min, 60-min).
5. **Resolve Timestamps**: Parses ISO 8601, DD/MM/YYYY, or Indian standard timestamp formats.
6. **Diagnostics Review**: Reports valid rows, skipped duplicates, detected meter resets, and consumption jumps.
7. **Deduplication**: SHA-256 fingerprinting prevents processing the same file multiple times.
8. **Confirmation**: Commits valid records to the active property.
9. **Summary**: Displays inserted, skipped, and rejected counts.

---

## 6. Official Regulatory Tariffs & Cost Reconstruction

UrjaSetu computes exact bill breakdowns using verified regulatory tariff orders from KERC (Karnataka) and APERC (Andhra Pradesh):

### A. Karnataka — BESCOM LT-2(a) Domestic (FY24-25)
- **Source**: KERC Retail Supply Tariff Order for BESCOM.
- **Fixed Charge**: ₹70.00 / kW sanctioned load / month.
- **Telescopic Slabs**:
  - Slab 1 (0–100 kWh): ₹4.75 / kWh
  - Slab 2 (>100 kWh): ₹7.00 / kWh
- **Electricity Tax**: 9% levied on energy charges.
- **Solar Net-Metering Export Credit**: ₹3.10 / kWh.

### B. Andhra Pradesh — APEPDCL LT-1 Domestic Group B (FY24-25)
- **Source**: APERC Retail Supply Tariff Order for AP DISCOMs.
- **Fixed Charge**: ₹60.00 / kW sanctioned load / month.
- **Telescopic Slabs**:
  - 0–30 kWh: ₹1.90 / kWh
  - 31–75 kWh: ₹3.00 / kWh
  - 76–125 kWh: ₹4.50 / kWh
  - 126–225 kWh: ₹6.00 / kWh
  - >225 kWh: ₹8.75 / kWh
- **Electricity Duty**: ~6% effective on energy charges.
- **Solar Net-Metering Export Credit**: ₹2.50 / kWh.

### Honest Cost Labeling
Every financial figure is labeled as:
- `ACTUAL_BILL_AMOUNT`: Sourced directly from official utility billing statements.
- `RECONSTRUCTED_ESTIMATE`: Calculated from published regulatory orders. Minor variances against actual bills arise from monthly fuel cost adjustments (FAC/FPPCA) and municipal cess.
- `FORECAST_ESTIMATE`: Future projected bill from Phase 8 forecasting models.

---

## 7. Household Predictive Intelligence & Demand Forecasting

Reuses Phase 8's tournament engine ([`ModelTournamentEngine`](file:///c:/Users/Ram%20Nivas/projects/AVISHKAR-/src/avishkar_ems/forecasting_engine.py)):
- **Pre-Flight Eligibility Check**: Enforces a strict minimum of 6 monthly billing observations and $\le 25\%$ missing data.
- **Graceful Fallback**: If a household has $< 6$ observations, forecasting is marked unavailable with an explicit explanation rather than generating fictitious predictions.
- **Model Tournament**: On eligible series, evaluates 4 transparent baselines (Last Observation, Moving Average, Seasonal Naive, Linear Trend) on an out-of-sample holdout test window.
- **Uncertainty Intervals**: Computes 80% empirical residual uncertainty bands (P10, P50, P90) expanding with horizon step by $\sqrt{h}$.

---

## 8. Multi-Home Comparative Analytics

Provides side-by-side comparative views for Home A (Bengaluru) and Home B (Visakhapatnam):
- **Normalized Consumption**: Measures energy in `kWh / kW sanctioned load`, allowing fair comparison across differing house sizes.
- **Effective Rate**: Evaluates `₹ / kWh` under distinct state regulatory schedules.
- **Solar & Storage Tracking**: Separates rooftop solar capacity (kWp) from measured energy generation and net exports.
- **Appliance-Level Submetering Safeguard**: Appliance breakdowns are explicitly refused unless verified physical submeter telemetry (CT clamps or smart plugs) is active.
