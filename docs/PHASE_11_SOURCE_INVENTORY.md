# UrjaSetu EMS — Phase 11 Official Energy Data Source Inventory

> **Standard**: Truth-in-Data & Provenance Integrity Protocol  
> **Status**: Verified Operational Inventory  
> **Audit Date**: 2026-10-24  
> **Auditor**: Antigravity Data Platform & Security Engineering  

---

## 1. Executive Summary & Verification Principles

The **UrjaSetu Energy Management System (EMS)** integrates official, verifiable energy datasets across India, state jurisdictions (Karnataka and Andhra Pradesh), utility territories (BESCOM and APEPDCL), revenue districts, and residential consumer accounts.

### Truth-in-Data Invariants
1. **No Hallucinated Telemetry**: An official homepage or ministerial announcement is **not** evidence that an unauthenticated public API exists.
2. **Decoupling Transport from Observation Age**: An HTTP 200 response on a portal or report server proves transport reachability only. If the published data is older than the cadence-aware threshold, it is classified as `DELAYED_STALE`, never `HEALTHY`.
3. **Anti-Disaggregation Prohibition**: State-level aggregate metrics cannot be downscaled to districts through synthetic allocation without direct meter telemetry.
4. **Zero Credential / Password Persistence**: Utility accounts requiring consumer credentials or dynamic SMS OTPs must never persist plaintext passwords. Access is marked `ACCESS_RESTRICTED` pending formal utility developer MOUs or on-demand consumer authorization.
5. **Separation of Climatology from Nowcasts**: Multi-year satellite/weather reanalysis models (NASA POWER, Open-Meteo) are labeled as numerical models/climatology, never as physical pyranometer measurements.

---

## 2. Authoritative Source Registry Matrix

| Source ID | Official Provider | Access Tier | Retrieval Modality | Geographic Scope | Temporal Cadence | Primary Units | Connection Status | Freshness Threshold |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `CEA_POWER_SUPPLY_POSITION` | Central Electricity Authority (MoP) | Public Statutory Report | `VERIFIED_OFFICIAL_REPORT` | National, State | Monthly | MU, MW | `DATA_INGESTED` | 65.0 days |
| `CEA_RENEWABLE_GENERATION` | Central Electricity Authority & MNRE | Public Statutory Report | `VERIFIED_OFFICIAL_REPORT` | National, State | Monthly | MU, MW | `DATA_INGESTED` | 75.0 days |
| `NPP_DAILY_OUTTURN` | National Power Portal (MoP) | Public Transparency Data | `SCHEDULED_BULK_DOWNLOAD` | National | Daily | MU, % | `DATA_INGESTED` | 3.0 days |
| `NPP_GENERATION_DASHBOARD` | National Power Portal (MoP) | Public Portal Dashboard | `SCHEDULED_BULK_DOWNLOAD` | National, Regional | Daily | MU | `DOCUMENTATION_VERIFIED` | 3.0 days |
| `KARNATAKA_OPEN_DATA` | Centre for e-Governance, Karnataka | Open Government Data | `SCHEDULED_BULK_DOWNLOAD` | State, District | Annual | MW, Count | `DOCUMENTATION_VERIFIED` | 365.0 days |
| `BESCOM_OPENCITY_HISTORICAL` | BESCOM via OpenCity.in | Public Research Dataset | `OPEN_DOWNLOAD` | Utility (8 Districts) | Annual (13 FYs) | MU, %, Rs. Cr | `DATA_INGESTED` | 365.0 days |
| `BESCOM_MITHRA_API` | BESCOM IT Cell | Restricted Consumer API | `AUTOMATED_REST_API` | Utility, Household | Daily / Monthly | kWh, kW, INR | `CONNECTION_TESTED` | 35.0 days |
| `AP_STATE_ENERGY_STATISTICS` | APSLDC & APERC | State Open Data | `VERIFIED_OFFICIAL_REPORT` | State, Utility | Monthly | MU, MW | `DATA_INGESTED` | 45.0 days |
| `APEPDCL_CONSUMER_SERVICES` | APEPDCL Customer Services | Restricted Consumer Portal | `MANUAL_STATEMENT_IMPORT` | Utility, Household | Monthly | kWh, INR | `AWAITING_APPROVAL` | 35.0 days |
| `OPEN_METEO_SOLAR` | Open-Meteo Science API | Public Science API | `OPEN_DOWNLOAD` | National, State, District | Hourly | W/m², °C | `DATA_INGESTED` | 0.1 days (2.4h) |
| `NASA_POWER_SOLAR` | NASA Langley Research Center | Public Science API | `OPEN_DOWNLOAD` | National, State, District | Monthly Climatology | kWh/m²/day | `DATA_INGESTED` | 35.0 days |

---

## 3. Granular Source Audits & Verified Technical Specifications

### 3.1. Central Electricity Authority — Monthly Power Supply Position (`CEA_POWER_SUPPLY_POSITION`)
* **Official Provider**: Central Electricity Authority (CEA), Ministry of Power, Government of India.
* **Homepage**: `https://cea.nic.in/` (HTTP 200 verified).
* **Documented Page**: `https://cea.nic.in/power-supply-position-monthly-reports` (Statutory monthly report archive).
* **API Availability Investigation**: The purported endpoint `https://cea.nic.in/api-for-central-electricity-authority-data/?lang=en` returns **HTTP 404: Not Found**. CEA does not expose an unauthenticated public JSON API. Public access is granted through official monthly PDF and structured executive summary bulletins.
* **Retrieval Method**: `VERIFIED_OFFICIAL_REPORT` via structured ingest from `data/energy_reports/cea_national_balance.json` and `cea_state_balance.json`.
* **Geographic Coverage**: `NATIONAL` (All-India totals) and `STATE` (36 States/UTs).
* **Temporal Coverage**: Monthly reporting cycles from April 2024 to March 2026. Publication lag is approximately 45 days following calendar month closure.
* **Field Definitions & Semantics**:
  - `ENERGY_REQUIREMENT_MU`: Total electricity required by consumers and distribution licensees (Million Units = GWh).
  - `ENERGY_SUPPLIED_MU`: Total electricity dispatched and delivered across state transmission interfaces (MU).
  - `PEAK_DEMAND_MW`: Maximum coincident instantaneous demand observed during the month (MW).
  - `PEAK_MET_MW`: Maximum instantaneous demand successfully met by available generation (MW).
* **Licensing**: National Data Sharing and Accessibility Policy (NDSAP) — Government Open Data.
* **Known Limitations**: Does not provide sub-monthly interval curves or district-level telemetry. Downscaling state totals to districts is explicitly prohibited.

### 3.2. Central Electricity Authority — Renewable Energy Generation Reports (`CEA_RENEWABLE_GENERATION`)
* **Official Provider**: Central Electricity Authority (Renewable Energy Division) & Ministry of New and Renewable Energy (MNRE).
* **Homepage**: `https://cea.nic.in/` | Division Page: `https://www.cea.nic.in/divisionPage/506?lang=en`.
* **Retrieval Method**: `VERIFIED_OFFICIAL_REPORT` via `data/energy_reports/cea_renewable_generation.json`.
* **Geographic Coverage**: `NATIONAL` and `STATE`.
* **Temporal Coverage**: Monthly observations from April 2024 to March 2026 with ~60 days publication delay.
* **Field Definitions & Semantics**:
  - `INSTALLED_SOLAR_CAPACITY_MW`: Cumulative utility and grid-connected rooftop capacity in MW (nameplate DC capacity).
  - `SOLAR_GENERATION_MU`: Metered gross solar energy generated during the month in MU.
  - `TOTAL_GENERATION_MU`: Total multi-fuel utility electricity generated (MU).
  - `RENEWABLE_GENERATION_MU`: Sum of Solar, Wind, Biomass, and Small Hydro (<= 25 MW).
* **Hydro Classification Note**: CEA classifies Small Hydro (<= 25 MW) under Renewable Energy Sources (RES), whereas Large Hydro (> 25 MW) is reported under conventional generation.
* **Known Limitations**: Captive solar generation is partially estimated by CEA; hourly generation curves cannot be synthesized from these monthly totals.

### 3.3. National Power Portal — Daily Generation Outturn (`NPP_DAILY_OUTTURN`)
* **Official Provider**: National Power Portal (NPP), Central Electricity Authority, Ministry of Power.
* **Homepage**: `https://npp.gov.in/` (HTTP 200 verified).
* **Documented Endpoint**: `https://npp.gov.in/dashBoard/cp-overall-generation`
* **Retrieval Method**: `SCHEDULED_BULK_DOWNLOAD` via verified daily snapshots in `data/energy_reports/npp_daily_outturn.json`.
* **Geographic Coverage**: `NATIONAL`.
* **Temporal Coverage**: Daily observations with 24-48 hours publication delay.
* **Field Definitions**:
  - `DAILY_GENERATION_MU`: Gross daily national electricity generated across all fuels (MU).
  - `DAILY_THERMAL_GEN_MU`: Coal, lignite, gas, and diesel thermal generation (MU).
  - `DAILY_RENEWABLE_GEN_MU`: Daily grid-scale renewable generation (MU).
  - `THERMAL_PLF_PCT`: Thermal Plant Load Factor percentage (%).
* **Known Limitations**: NPP provides national and regional aggregates; distribution-level consumer consumption is not included.

### 3.4. OpenCity & BESCOM — 13-Year Historical Consumption Dataset (`BESCOM_OPENCITY_HISTORICAL`)
* **Official Provider**: Bangalore Electricity Supply Company Limited via OpenCity.in public data portal.
* **Verified URL**: `https://data.opencity.in/dataset/bescom-consumption-data` (Public Domain).
* **Retrieval Method**: `OPEN_DOWNLOAD` via `data/energy_reports/bescom_historical_consumption.csv`.
* **Geographic Coverage**: `UTILITY` (BESCOM service area spanning 8 revenue districts: Bengaluru Urban, Bengaluru Rural, Chikkaballapura, Kolar, Davanagere, Tumakuru, Chitradurga, and Ramanagara).
* **Temporal Coverage**: 13 continuous financial years (FY 2010-11 to FY 2022-23).
* **Field Definitions**:
  - `BESCOM_METERED_CONSUMPTION_MU`: Total billed consumer consumption (MU).
  - `BESCOM_ENERGY_INPUT_MU`: Total energy received at transmission interface (MU).
  - `BESCOM_T_AND_D_LOSS_PCT`: Transmission & Distribution loss percentage $((Input - Billed)/Input) \times 100$.
  - `BESCOM_CONSUMER_COUNT_LAKHS`: Active sanctioned service connections in Lakhs ($10^5$).
* **Critical Boundary Invariant**: BESCOM covers 8 districts. Equating BESCOM totals to Bengaluru Urban district alone violates geographic boundary integrity.

### 3.5. Andhra Pradesh State Energy Balance & Utility Statistics (`AP_STATE_ENERGY_STATISTICS`)
* **Official Provider**: Andhra Pradesh State Load Despatch Centre (APSLDC) & Andhra Pradesh Electricity Regulatory Commission (APERC).
* **Homepage**: `https://www.apeasternpower.com` (HTTP 200 verified).
* **Retrieval Method**: `VERIFIED_OFFICIAL_REPORT` via `data/energy_reports/ap_state_balance.json`.
* **Geographic Coverage**: `STATE` (`AP`) and `UTILITY` (`APEPDCL`).
* **Temporal Coverage**: Monthly observations from October 2025 to March 2026.
* **Field Definitions**:
  - State Level (`AP`): `ENERGY_REQUIREMENT_MU`, `ENERGY_SUPPLIED_MU`, `PEAK_DEMAND_MW`, `PEAK_MET_MW`, `INSTALLED_SOLAR_CAPACITY_MW`.
  - Utility Level (`APEPDCL`): `APEPDCL_BILLED_UNITS_MU`, `CONSUMER_COUNT_LAKHS`, `SOLAR_ROOFTOP_CAPACITY_MW`.
* **Boundary Integrity Invariant**: State-level requirements cannot be attributed to Visakhapatnam district (`AP_VSKP`) without localized AMR/SCADA feeder telemetry.

### 3.6. Open-Meteo Verified Solar & Meteorological API (`OPEN_METEO_SOLAR`)
* **Official Provider**: Open-Meteo Open Science API.
* **Documented Endpoint**: `https://api.open-meteo.com/v1/forecast` (Live HTTP 200 verified).
* **Retrieval Method**: `OPEN_DOWNLOAD` (Unauthenticated public REST API respecting fair-use limits and user-agent attribution).
* **Geographic Coverage**: Continuous coordinate interpolation across India (`IN`, `KA_BLR_URBAN`, `AP_VSKP`).
* **Temporal Coverage & Cadence**: Hourly resolution from 1940 to present archive; 7-day forward forecasts.
* **Field Definitions**:
  - `DIRECT_NORMAL_IRRADIANCE_WM2`: Direct normal solar beam irradiance in $W/m^2$.
  - `SURFACE_TEMPERATURE_C`: Ambient 2-meter air temperature in $^{\circ}C$.
* **Licensing**: Creative Commons Attribution 4.0 International (CC BY 4.0).
* **Known Limitations**: Reanalysis numerical models (ECMWF, GFS), not physical on-site pyranometer hardware.

### 3.7. NASA POWER Solar Climatology API (`NASA_POWER_SOLAR`)
* **Official Provider**: NASA Prediction of Worldwide Energy Resources (POWER) Project, Langley Research Center.
* **Documented Endpoint**: `https://power.larc.nasa.gov/api/temporal/climatology/point` (Live HTTP 200 verified).
* **Retrieval Method**: `OPEN_DOWNLOAD` (Public science REST API).
* **Geographic Coverage**: Global 0.5° latitude/longitude grid covering India benchmark sites.
* **Temporal Coverage**: 30-year multi-year monthly satellite solar climatology.
* **Field Definitions**:
  - `SOLAR_INSOLATION_KWH_M2_DAY`: Monthly average all-sky solar downward irradiance ($kWh/m^2/day$).
* **Licensing**: Public Domain (NASA Open Science Data Policy).
* **Known Limitations**: Climatological averages; does not model sub-hourly cloud dynamics or instant shadows.

### 3.8. DISCOM Consumer Integration Seams (`BESCOM_MITHRA_API` & `APEPDCL_CONSUMER_SERVICES`)
* **Access Tier**: `ACCESS_RESTRICTED` / `AWAITING_APPROVAL`.
* **Protocol Invariant**: Consumer billing records and AMI smart meters require authenticated consumer consent (OAuth2 bearer token or on-demand SMS OTP).
* **Security Guard**: Plaintext utility passwords and session hijacking cookies are strictly prohibited. In the absence of an authorized consumer session, the connectors operate in verified offline fixture mode or file-statement import mode (`household_import.py`).

---

## 4. Verification Evidence & Probe Log

```bash
# Probe 1: Open-Meteo Live API
curl "https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&hourly=direct_normal_irradiance,temperature_2m&forecast_days=1"
Status: HTTP 200 OK | Records: 24 hourly intervals | Latency: 480ms

# Probe 2: NASA POWER Climatology API
curl "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=77.5946&latitude=12.9716&format=JSON"
Status: HTTP 200 OK | Parameters: ALLSKY_SFC_SW_DWN | Latency: 920ms

# Probe 3: CEA Public API URL Investigation
curl "https://cea.nic.in/api-for-central-electricity-authority-data/?lang=en"
Status: HTTP 404 Not Found (Confirms absence of unauthenticated public REST API)

# Probe 4: CEA Homepage
curl -I "https://cea.nic.in/"
Status: HTTP 200 OK | Server: Apache/NIC

# Probe 5: National Power Portal
curl -I "https://npp.gov.in/"
Status: HTTP 200 OK | Server: NIC
```
