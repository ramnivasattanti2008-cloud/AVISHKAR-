# UrjaSetu EMS — Phase 14: Dataset Catalogue & Provenance

## 1. Overview
The **Dataset Catalogue** in UrjaSetu EMS establishes an authoritative, tamper-evident registry for all datasets utilized across forecasting benchmarks, anomaly evaluation, and data-quality audits. It strictly prohibits unverified or synthetic datasets from posing as official measurements.

---

## 2. Dataset Classification Taxonomy

Every dataset in the catalogue is classified under one of four non-negotiable categories:

| Classification | Meaning & Criteria | Example Sources |
|---|---|---|
| **`VERIFIED_REAL_WORLD`** | Actual physical observations collected via calibrated hardware (smart meters, weather stations, pyranometers). | CEEW Smart Meter Load (Site MH21), PVGIS ERA5 surface irradiance. |
| **`IMPORTED_STATUTORY`** | Official filings and reports published by state or national electricity regulatory commissions, load dispatch centers, or ministries. | CEA Executive Summaries, KPTCL State Load Dispatch Reports, APGENCO Generation Filings. |
| **`DEMONSTRATION`** | Verified reference profiles utilized exclusively for interactive UI demonstrations and user walkthroughs. | Baseline residential what-if profiles. |
| **`SYNTHETIC`** | Artificially generated or simulated mathematical profiles (e.g. Markov chain load models, synthetic noise). Must be explicitly labeled. | Synthetic load profiles for stress-testing. |

---

## 3. Pre-Registered Canonical Datasets

### A. CEEW Maharashtra Smart Meter Load (`ds_ceew_mh21`)
- **Name**: CEEW Maharashtra Smart Meter (Site MH21)
- **Classification**: `VERIFIED_REAL_WORLD`
- **Source Authority**: Council on Energy, Environment and Water (CEEW)
- **Source Reference**: [https://www.ceew.in/publications/electricity-consumption-data-india](https://www.ceew.in/publications/electricity-consumption-data-india)
- **License**: Creative Commons Zero (CC0)
- **Geographic Scope**: Maharashtra, India (Rural/Semi-urban Residential)
- **Temporal Range**: 2023-01-01 to 2023-02-28
- **Sampling Cadence**: Daily aggregated consumption (derived from 15-minute smart meter pulses)
- **Variables**: `electricity_consumption_kwh` (Unit: `kWh`)
- **Data Quality Score**: 100% Completeness, 100% Validity, 100% Continuity.
- **Documented Limitations**:
  - Single residential metering point in rural Maharashtra.
  - Aggregated from 15-minute pulses to daily totals.

### B. CEA National Electricity Demand Met (`ds_national_demand_cea`)
- **Name**: Central Electricity Authority National Electricity Demand Met (MU)
- **Classification**: `IMPORTED_STATUTORY`
- **Source Authority**: Central Electricity Authority (CEA), Ministry of Power
- **Source Reference**: [https://cea.nic.in/executive-summary](https://cea.nic.in/executive-summary)
- **License**: Open Government Data License - India (OGDL)
- **Geographic Scope**: India (National Grid Total)
- **Temporal Range**: 2021-01 to 2024-12 (48 monthly observations)
- **Sampling Cadence**: Monthly
- **Variables**: `energy_supplied_mu` (Unit: `MU`)
- **Data Quality Score**: 100% Completeness, 100% Validity, 100% Continuity.
- **Documented Limitations**:
  - Excludes behind-the-meter captive industrial power generation without grid injection.
  - Subject to post-audit reconciliation in CEA annual power review.

### C. Karnataka State Monthly Solar PV Generation (`ds_karnataka_solar_kptcl`)
- **Name**: Karnataka Power Transmission Corporation Monthly Solar Generation (MU)
- **Classification**: `IMPORTED_STATUTORY`
- **Source Authority**: Karnataka Power Transmission Corporation Ltd (KPTCL)
- **Source Reference**: [https://kptcl.karnataka.gov.in/page/Power+Generation](https://kptcl.karnataka.gov.in/page/Power+Generation)
- **License**: Government of Karnataka Public Information
- **Geographic Scope**: Karnataka, India
- **Temporal Range**: 2021-01 to 2024-12 (48 monthly observations)
- **Sampling Cadence**: Monthly
- **Variables**: `solar_generation_mu` (Unit: `MU`)
- **Data Quality Score**: 100% Completeness, 100% Validity, 100% Continuity.
- **Documented Limitations**:
  - Covers utility-scale solar parks and grid-injected rooftop net metering; unmetered distributed solar is excluded.

---

## 4. Ingestion Validation Protocol

When a custom dataset is imported through the Ingestion Wizard, it must satisfy the following checks:
1. **File Format & Quota**: Valid UTF-8 CSV text; maximum file size 15 MB.
2. **Schema Matching**: Must include designated `period` (timestamp) and `value` (numeric reading) columns.
3. **Parse Validity**: Every row must have a non-empty timestamp and a finite float value (`math.isnan()` and `math.isinf()` are rejected).
4. **Physical Bounds**: Values must be $\ge 0.0$ unless `allow_negative=True` is explicitly toggled by the user for net export or signed battery power.
5. **Quality Audit Execution**: Evaluates completeness, validity, uniqueness, temporal continuity, and duplicate rates before catalog registration.
6. **Cryptographic Checksum**: Calculates SHA-256 fingerprint on the raw file content and permanently associates it with the dataset ID.
