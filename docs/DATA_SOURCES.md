# Authoritative Data Sources Registry & Operational Verification — UrjaSetu EMS
**Phase 10: Production Hardening, Live Operations & Provenance Audit**

---

## 1. Regulatory Context & Data Honesty Invariants

In strict adherence to UrjaSetu Architecture Principles (D6, D7), **data honesty is the product**. The system enforces the following core tenets:
1. **No Synthetic Masquerading**: Synthetic, modeled, or test fixture data is never presented as official live observations.
2. **Distinct Access Modalities**: A publicly viewable web dashboard does **not** imply that a machine-readable REST API exists.
3. **Authentication Boundary**: Automatic extraction from utility systems without verified consumer consent or official Data-Sharing Memoranda of Understanding (MoU) is strictly prohibited.
4. **Transport Reachability vs. Observation Age**: A reachable HTTP 200 endpoint returning stale data is marked `DELAYED_STALE`, never `HEALTHY`.
5. **Observation Provenance**: Every observation maintains its original retrieval timestamp, source identifier, and raw payload checksum.

---

## 2. Source Access Modality Classifications

Every external data integration is categorized into one of six mutually exclusive operational access tiers:

| Modality Tier | Definition | Examples | Handling Strategy |
|---|---|---|---|
| **Tier 1: Public Dashboards** | Publicly viewable web interfaces designed for human interaction; no public API. | National Power Portal (NPP), PM Surya Ghar Portal | Scraped or manually exported with schema drift monitors. |
| **Tier 2: Public Downloadable Datasets** | Periodic machine-readable reports (PDF, Excel, CSV) released under open licenses. | CEA Monthly PSP, CEA Renewable Generation, Karnataka Open Data | Atomic scheduled download, PDF/XLSX parser, SHA-256 ingestion check. |
| **Tier 3: Documented Public APIs** | Documented, open, or token-authenticated REST/JSON endpoints with public schemas. | Open-Meteo, NASA POWER | Authenticated HTTP client with rate limiting, timeouts, and bounded retries. |
| **Tier 4: Restricted Enterprise APIs** | Utility enterprise endpoints requiring bilateral MoUs, consumer OAuth2, or IP whitelisting. | BESCOM Mithra Consumer API | Isolated under `AWAITING_APPROVAL`; offline deterministic fixtures for tests. |
| **Tier 5: Manually Imported Records** | Consumer-provided monthly statements, interval CSVs, or spreadsheet logs. | APEPDCL consumer bills, BESCOM PDF statements | Secure file upload wizard with sanitization, pre-commit validation, and user ownership. |
| **Tier 6: Unavailable Integrations** | Data sources evaluated during discovery but found technically infeasible or legally closed. | Private feeder SCADA, unmetered agricultural pumps | Explicitly marked `UNSUPPORTED`; no mock fallbacks permitted. |

---

## 3. Comprehensive Source Audits & Verification Catalog

### Source 1: Central Electricity Authority (CEA) — Monthly Power Supply Position
- **Official Source Name**: Central Electricity Authority (CEA) — Monthly Power Supply Position Reports (Annexures I & II)
- **Official Source URL**: [https://cea.nic.in/power-supply-position-monthly-reports](https://cea.nic.in/power-supply-position-monthly-reports)
- **Data Owner / Provider**: Power Supply Position (PSP) Division, Central Electricity Authority, Ministry of Power, Government of India
- **Access Modality**: Tier 2: Publicly Downloadable Dataset (`OPEN_DOWNLOAD` / `VERIFIED_OFFICIAL_REPORT`)
- **Authentication Requirements**: None (Public Open Government Data under GODL-India / NDSAP)
- **Supported Metrics**:
  - `ENERGY_REQUIREMENT`: Electrical energy required to meet total demand (MU)
  - `ENERGY_SUPPLIED`: Electrical energy actually delivered into the grid (MU)
  - `PEAK_DEMAND`: Maximum instantaneous system demand (MW)
  - `PEAK_MET`: Maximum instantaneous demand successfully met (MW)
- **Geographic Granularity**: National (`IN`) and State-level (`KA`, `AP`, `TN`, `MH`, etc.)
- **Temporal Granularity**: Monthly (`MONTHLY`)
- **Unit Definitions**: Million Units (`MU` = $10^6\text{ kWh} = 1\text{ GWh}$), Megawatts (`MW`)
- **Historical Coverage**: 2024-04 to 2026-03 (24 continuous monthly observation periods)
- **Rate Limits & Access Restrictions**: None documented; downloads cached locally to prevent server load.
- **Last Successful Retrieval**: 2026-10-24T11:45:00Z
- **Most Recent Source Observation**: 2026-03-31T00:00:00Z
- **Connector Status**: `DATA_SUCCESSFULLY_INGESTED`
- **Validation Status**: Fully verified (`tests/avishkar_ems/test_energy_balance.py`)
- **Operational Health**: `DELAYED_STALE` (~207 days since last published observation; publication lag exceeds 65-day threshold)
- **Known Limitations**:
  - Reports aggregate state transmission figures; does not provide feeder-level or hourly interval data.
  - Revenue district disaggregation is not officially supported by CEA; downscaling to districts is prohibited by `AntiDisaggregationGuard`.

---

### Source 2: Central Electricity Authority (CEA) — Monthly Renewable Generation
- **Official Source Name**: Central Electricity Authority (CEA) & MNRE — Monthly Renewable Generation Reports
- **Official Source URL**: [https://cea.nic.in/monthly-renewable-generation-reports](https://cea.nic.in/monthly-renewable-generation-reports)
- **Data Owner / Provider**: Grid Connected Renewable Energy (GCRE) Division, CEA & Ministry of New and Renewable Energy (MNRE)
- **Access Modality**: Tier 2: Publicly Downloadable Dataset (`OPEN_DOWNLOAD` / `VERIFIED_OFFICIAL_REPORT`)
- **Authentication Requirements**: None (GODL-India)
- **Supported Metrics**:
  - `INSTALLED_SOLAR_CAPACITY`: Cumulative grid-connected solar capacity (MW)
  - `SOLAR_GENERATION`: Total metered generation from solar projects (MU)
  - `TOTAL_GENERATION`: All-India and state generation across all fuel categories (MU)
  - `RENEWABLE_GENERATION`: Generation from solar, wind, biomass, and small hydro (MU)
- **Geographic Granularity**: National (`IN`) and State-level (`KA`, `AP`, `TN`, `RJ`, etc.)
- **Temporal Granularity**: Monthly (`MONTHLY`)
- **Unit Definitions**: Megawatts (`MW`), Million Units (`MU`)
- **Historical Coverage**: 2024-04 to 2026-03 (Includes a documented 9-month historical gap from 2024-06 to 2025-02)
- **Rate Limits & Access Restrictions**: None.
- **Last Successful Retrieval**: 2026-10-24T11:45:00Z
- **Most Recent Source Observation**: 2026-03-31T00:00:00Z
- **Connector Status**: `DATA_SUCCESSFULLY_INGESTED`
- **Validation Status**: Fully verified (`tests/avishkar_ems/test_solar_intel.py`)
- **Operational Health**: `DELAYED_STALE` (Observation age > 65 days)
- **Known Limitations**:
  - Captive and non-net-metered rooftop solar installations are estimated by survey; utility-scale solar is directly metered.
  - The 9-month observation gap is represented as missing data; no synthetic imputation is permitted.

---

### Source 3: National Power Portal (NPP) — Generation Outturn Dashboard
- **Official Source Name**: National Power Portal (NPP) Central Power Outturn & Outage Monitoring
- **Official Source URL**: [https://npp.gov.in/dashBoard/cp-overall-generation](https://npp.gov.in/dashBoard/cp-overall-generation)
- **Data Owner / Provider**: Ministry of Power, Government of India
- **Access Modality**: Tier 1: Public Dashboard (`SCRAPED_HTML` / `SCHEDULED_BULK_DOWNLOAD`)
- **Authentication Requirements**: None (Public Open Portal)
- **Supported Metrics**:
  - `DAILY_GENERATION`: National daily gross electricity generation (MU)
  - `THERMAL_GENERATION`: Coal, lignite, and gas daily generation (MU)
  - `HYDRO_GENERATION`: Large and small hydro generation (MU)
  - `PLANT_LOAD_FACTOR`: Operating capacity utilization of thermal stations (%)
- **Geographic Granularity**: National (`IN`) and Regional Grids (Northern, Western, Southern, Eastern, North Eastern)
- **Temporal Granularity**: Daily (`DAILY`)
- **Unit Definitions**: Million Units (`MU`), Megawatts (`MW`), Percentage (`%`)
- **Historical Coverage**: Rolling 365 days on live dashboard
- **Rate Limits & Access Restrictions**: No documented API rate limits; web scraper enforces 1 request per 10 seconds.
- **Last Successful Retrieval**: Awaiting automated daily pipeline deployment
- **Most Recent Source Observation**: 2026-10-23T00:00:00Z (Available on web portal)
- **Connector Status**: `DOCUMENTATION_VERIFIED`
- **Validation Status**: Schema and parsing rules verified against NPP daily report format
- **Operational Health**: `NOT_CONFIGURED` (Requires local ingestion worker activation)
- **Known Limitations**:
  - NPP dashboard frequently alters HTML structure and table layouts during portal updates.
  - Does not provide an official JSON endpoint; relies on scheduled bulk tabular report downloads.

---

### Source 4: PM Surya Ghar: Muft Bijli Yojana National Portal
- **Official Source Name**: PM Surya Ghar Muft Bijli Yojana National Rooftop Solar Portal
- **Official Source URL**: [https://pmsuryaghar.gov.in](https://pmsuryaghar.gov.in)
- **Data Owner / Provider**: Ministry of New and Renewable Energy (MNRE), Government of India
- **Access Modality**: Tier 1: Public Dashboard / National Registry
- **Authentication Requirements**: Consumer Mobile OTP for personal accounts; public statistics dashboard for aggregate data.
- **Supported Metrics**:
  - `ROOFTOP_APPLICATIONS_COUNT`: Total rooftop solar subsidy applications received
  - `SANCTIONED_CAPACITY_MW`: Capacity approved for central financial assistance (CFA)
  - `DISCOM_BENCHMARK_COST`: DISCOM-specific benchmark pricing per kW installed
- **Geographic Granularity**: State and DISCOM service territory
- **Temporal Granularity**: Cumulative monthly updates
- **Unit Definitions**: Installed Capacity (`kW`, `MW`), System Count (`COUNT`), Cost (`INR/kW`)
- **Historical Coverage**: 2024 to present
- **Rate Limits & Access Restrictions**: Captcha on consumer login; public statistics updated weekly.
- **Last Successful Retrieval**: 2026-10-24
- **Most Recent Source Observation**: 2026-09-30
- **Connector Status**: `DOCUMENTATION_VERIFIED`
- **Validation Status**: Subsidy calculations cross-checked against MNRE operational guidelines
- **Operational Health**: `NOT_CONFIGURED`
- **Known Limitations**:
  - Individual consumer installation statuses cannot be scraped; must be manually imported by the homeowner.

---

### Source 5: Bangalore Electricity Supply Company (BESCOM) — Mithra Consumer API
- **Official Source Name**: BESCOM Mithra Consumer Self-Service Portal & AMR Ingestion
- **Official Source URL**: [https://bescom.karnataka.gov.in](https://bescom.karnataka.gov.in)
- **Data Owner / Provider**: Bangalore Electricity Supply Company Limited (BESCOM), Government of Karnataka
- **Access Modality**: Tier 4: Restricted Enterprise API (`AUTHENTICATED_API` / `AWAITING_APPROVAL`)
- **Authentication Requirements**: Consumer OAuth2 bearer token / Account ID + Registered Mobile OTP
- **Supported Metrics**:
  - `METER_INTERVAL_CONSUMPTION`: 15-minute AMR smart meter intervals (kWh)
  - `MONTHLY_BILL`: Official monthly billed amount, fixed charges, and tax breakdown (INR)
  - `SOLAR_NET_EXPORT`: Net-metered solar export energy (kWh)
  - `SANCTIONED_LOAD`: Contracted load demand (kW / kVA)
- **Geographic Granularity**: Utility service territory (Bengaluru Urban, Bengaluru Rural, Ramanagara, Tumakuru, Chitradurga, Davanagere, Kolar, Chikkaballapura)
- **Temporal Granularity**: Real-time 15-minute (`REALTIME_15MIN`) and Monthly (`MONTHLY`)
- **Unit Definitions**: Kilowatt-hours (`kWh`), Indian Rupees (`INR`), Kilowatts (`kW`)
- **Historical Coverage**: 12 to 24 billing cycles per consumer account
- **Rate Limits & Access Restrictions**: Enterprise API access requires formal DISCOM MoU and consumer authorization.
- **Last Successful Retrieval**: 2026-10-24 (Offline verified deterministic test fixtures)
- **Most Recent Source Observation**: 2026-10-01 (October 2024 - October 2026 test fixtures)
- **Connector Status**: `AWAITING_APPROVAL` (Standby mode; offline fixtures verified)
- **Validation Status**: 26 household automated tests passing (`tests/avishkar_ems/test_household_module.py`)
- **Operational Health**: `ACCESS_RESTRICTED` (Honest status: live automatic retrieval blocked awaiting utility API agreement)
- **Known Limitations**:
  - Plaintext password or credential storage is strictly prohibited by security architecture.
  - Consumers use the Tier 5 statement upload wizard until bilateral OAuth2 is provisioned.

---

### Source 6: Eastern Power Distribution Company of AP (APEPDCL) — Consumer Portal
- **Official Source Name**: APEPDCL Customer Web Self Service & Solar Rooftop Portal
- **Official Source URL**: [https://www.apeasternpower.com](https://www.apeasternpower.com)
- **Data Owner / Provider**: Eastern Power Distribution Company of Andhra Pradesh Limited (APEPDCL)
- **Access Modality**: Tier 5: Manually Imported Records / Statement Import (`MANUAL_STATEMENT_IMPORT`)
- **Authentication Requirements**: Service Connection Number + SMS OTP for portal; none for local file upload.
- **Supported Metrics**:
  - `MONTHLY_BILL`: Billed consumption, telescopic slab breakdown, customer charges (INR)
  - `CONSUMPTION_KWH`: Monthly consumed active units (kWh)
  - `SOLAR_EXPORT_KWH`: Solar export units credited under AP net-metering regulations (kWh)
- **Geographic Granularity**: APEPDCL service territory (Visakhapatnam, Srikakulam, Vizianagaram, East Godavari, West Godavari)
- **Temporal Granularity**: Monthly billing cycle (`MONTHLY`)
- **Unit Definitions**: Kilowatt-hours (`kWh`), Indian Rupees (`INR`)
- **Historical Coverage**: 12 monthly statements supported in household parser
- **Rate Limits & Access Restrictions**: Web portal protected by dynamic CAPTCHA and SMS OTP. Automated scraping without consumer presence is refused.
- **Last Successful Retrieval**: 2026-10-24 (Via statement parsing engine)
- **Most Recent Source Observation**: 2026-09-30
- **Connector Status**: `AWAITING_APPROVAL` (Manual statement workflow fully active)
- **Validation Status**: Fully verified in `test_household_module.py` and `test_phase10_operations.py`
- **Operational Health**: `ACCESS_RESTRICTED`
- **Known Limitations**:
  - Third-party programmatic API access does not currently exist in APERC regulations.

---

### Source 7: Karnataka Open Data Initiative (KODI)
- **Official Source Name**: Centre for e-Governance — Karnataka Open Data Portal
- **Official Source URL**: [https://data.karnataka.gov.in](https://data.karnataka.gov.in)
- **Data Owner / Provider**: Centre for e-Governance, Department of Personnel and Administrative Reforms, Government of Karnataka
- **Access Modality**: Tier 2: Publicly Downloadable Dataset (`OPEN_DOWNLOAD` / `DOCUMENTATION_VERIFIED`)
- **Authentication Requirements**: None (Open Data Karnataka Policy)
- **Supported Metrics**:
  - `ROOFTOP_SOLAR_CAPACITY`: District-wise registered solar installations (MW)
  - `SOLAR_INTERCONNECTIONS`: Number of sanctioned grid-connected consumer systems (COUNT)
  - `DISTRICT_CONSUMPTION`: Annual aggregated electricity consumption by district (MU)
- **Geographic Granularity**: State (`KA`) and 31 Districts
- **Temporal Granularity**: Annual (`ANNUAL`)
- **Unit Definitions**: Megawatts (`MW`), Count (`COUNT`), Million Units (`MU`)
- **Historical Coverage**: 2021 to 2024
- **Rate Limits & Access Restrictions**: None.
- **Last Successful Retrieval**: 2026-10-24
- **Most Recent Source Observation**: 2024-03-31
- **Connector Status**: `DOCUMENTATION_VERIFIED`
- **Validation Status**: Schema validated against district naming conventions in `geo_hierarchy.json`
- **Operational Health**: `DELAYED_STALE` (High publication lag: 6–9 months post financial year)
- **Known Limitations**:
  - Annual publication cadence makes this dataset suitable for baseline capacity tracking, not operational dispatch.

---

### Source 8: Open-Meteo Solar & Meteorological API
- **Official Source Name**: Open-Meteo Global Weather and Solar Radiation API
- **Official Source URL**: [https://open-meteo.com/en/docs](https://open-meteo.com/en/docs)
- **Data Owner / Provider**: Open-Meteo GmbH
- **Access Modality**: Tier 3: Documented Public API (`OPEN_API` / `CONNECTION_TESTED`)
- **Authentication Requirements**: None for non-commercial tier (< 10,000 daily calls); API key supported.
- **Supported Metrics**:
  - `DIRECT_NORMAL_IRRADIANCE`: Direct normal solar irradiance (W/m²)
  - `GLOBAL_HORIZONTAL_IRRADIANCE`: Global horizontal solar irradiance (W/m²)
  - `SURFACE_TEMPERATURE`: Ambient dry-bulb temperature 2 meters above ground (°C)
  - `CLOUD_COVER`: Total cloud cover fraction (%)
- **Geographic Granularity**: Global grid coordinates (0.1° resolution ~ 11 km)
- **Temporal Granularity**: Hourly (`HOURLY`) and 15-minute intervals
- **Unit Definitions**: Watts per square meter (`W/m²`), Degrees Celsius (`°C`), Percentage (`%`)
- **Historical Coverage**: 1940 to present (Historical Archive API); 7-day forward forecasts
- **Rate Limits & Access Restrictions**: 10,000 calls per day free tier; client enforces rate limiting and caching.
- **Last Successful Retrieval**: 2026-10-24T12:00:00Z
- **Most Recent Source Observation**: 2026-10-24T11:00:00Z
- **Connector Status**: `CONNECTION_TESTED`
- **Validation Status**: Integration tests in `platform/api/test/` verified
- **Operational Health**: `HEALTHY` (Active retrieval within 1 hour latency)
- **Known Limitations**:
  - Weather model resolutions (ECMWF, GFS) may have micro-climate variance in complex terrain.

---

### Source 9: NASA POWER Solar Irradiance
- **Official Source Name**: NASA Prediction of Worldwide Energy Resources (POWER) Project
- **Official Source URL**: [https://power.larc.nasa.gov](https://power.larc.nasa.gov)
- **Data Owner / Provider**: NASA Langley Research Center (LaRC), United States
- **Access Modality**: Tier 3: Documented Public API (`OPEN_API` / `CONNECTION_TESTED`)
- **Authentication Requirements**: None (Public Open Science Data)
- **Supported Metrics**:
  - `ALLSKY_SFC_SW_DWN`: All-sky insolation incident on a horizontal surface (kWh/m²/day)
  - `CLRSKY_SFC_SW_DWN`: Clear-sky insolation incident on a horizontal surface (kWh/m²/day)
  - `T2M`: Temperature at 2 meters (°C)
- **Geographic Granularity**: Global 0.5° × 0.5° latitude/longitude grid (~50 km)
- **Temporal Granularity**: Daily (`DAILY`) and Monthly Climatology
- **Unit Definitions**: Kilowatt-hours per square meter per day (`kWh/m²/day`), Degrees Celsius (`°C`)
- **Historical Coverage**: 1984 to present (~3-day latency)
- **Rate Limits & Access Restrictions**: 30 requests per minute recommended; enforced in client retry wrapper.
- **Last Successful Retrieval**: 2026-10-24T12:00:00Z
- **Most Recent Source Observation**: 2026-10-21T00:00:00Z
- **Connector Status**: `CONNECTION_TESTED`
- **Validation Status**: Validated for baseline solar resource assessment and rooftop PV potential calculations
- **Operational Health**: `HEALTHY`
- **Known Limitations**:
  - Satellite derivation has higher spatial aggregation than ground pyranometer stations.

---

## 4. Source Health & Operational Summary

| Source ID | Provider | Access Tier | Ingested Obs. | Observation Age | Health Status | Production Verdict |
|---|---|---|---|---|---|---|
| `CEA_POWER_SUPPLY_POSITION` | CEA | Tier 2: Public Download | 1,440 records | 2026-03-31 | `DELAYED_STALE` | Sourced from official monthly bulletin |
| `CEA_RENEWABLE_GENERATION` | CEA & MNRE | Tier 2: Public Download | 960 records | 2026-03-31 | `DELAYED_STALE` | Sourced from official renewable bulletin |
| `NPP_GENERATION_DASHBOARD` | Ministry of Power | Tier 1: Public Dashboard | Standby | 2026-10-23 | `NOT_CONFIGURED` | Dashboard active; worker scheduled |
| `MNRE_SURYA_GHAR` | MNRE | Tier 1: Public Dashboard | Benchmarks | 2026-09-30 | `NOT_CONFIGURED` | Tariff/subsidy benchmark verified |
| `BESCOM_MITHRA_API` | BESCOM | Tier 4: Restricted API | 24 cycles | 2026-10-01 | `ACCESS_RESTRICTED` | Offline test fixtures active; pending OAuth |
| `APEPDCL_CONSUMER_SERVICES` | APEPDCL | Tier 5: Manual Statement | 12 statements | 2026-09-30 | `ACCESS_RESTRICTED` | Secure parser active; dynamic OTP blocks live pull |
| `KARNATAKA_OPEN_DATA` | Govt of Karnataka | Tier 2: Public Download | 31 districts | 2024-03-31 | `DELAYED_STALE` | Annual statistics verified |
| `OPEN_METEO_API` | Open-Meteo GmbH | Tier 3: Documented API | Live telemetry | 2026-10-24 | `HEALTHY` | Live solar & weather active |
| `NASA_POWER_API` | NASA LaRC | Tier 3: Documented API | Climatology | 2026-10-21 | `HEALTHY` | Satellite solar irradiance verified |

---
*Maintained under UrjaSetu Data Governance Policy.*
