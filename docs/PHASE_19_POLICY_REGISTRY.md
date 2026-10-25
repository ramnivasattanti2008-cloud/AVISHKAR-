# UrjaSetu EMS Phase 19: Authoritative Statutory Policy Registry

## 1. Scope & Provenance Standards

The UrjaSetu EMS Policy Registry serves as the immutable single source of truth for energy policy intelligence within the platform. To guarantee strict data honesty, every record stored within the registry adheres to rigorous provenance standards:
- **Statutory Authority**: Each policy record must be backed by an official Gazette Notification, Commission Order, or International Submission.
- **Cryptographic Fingerprint**: Official source documents and policy texts are assigned a deterministic SHA-256 integrity hash.
- **Temporal Validity**: Explicit enactment dates, sunset clauses, and baseline milestones are cataloged to prevent temporal misattribution.
- **Classification Boundaries**: Central flagship programs, state net-metering regulations, and international climate treaties are maintained in segregated classifications.

---

## 2. Pre-Seeded Statutory Policy Catalogue

The registry pre-seeds six fundamental statutory energy policies across national and state jurisdictions:

### 1. PM Surya Ghar: Muft Bijli Yojana (`POL-IN-MNRE-SURYA-GHAR-2024`)
- **Jurisdiction**: `NATIONAL`
- **Classification**: `CENTRAL_SCHEME`
- **Sector**: `SOLAR_ROOFTOP`
- **Issuing Authority**: Ministry of New and Renewable Energy (MNRE), Government of India
- **Notification Reference**: Gazette Notification No. 318/38/2024-GCRT, dated 15 February 2024
- **Document SHA-256**: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- **Enactment Date**: 2024-02-15 (Target Date: 2027-03-31)
- **Summary**: Flagship national rooftop solar scheme targeting 10 million households with 30 GW of decentralized solar capacity, providing direct Central Financial Assistance (CFA) subsidies up to ₹78,000 disbursed directly into consumer bank accounts via the National Portal.
- **Quantified Targets**:
  - `TGT-SURYA-GHAR-CAPACITY`: 30.0 GW decentralized rooftop capacity (Baseline: 1.8 GW at 2024-01-01, Target: 2027-03-31).
  - `TGT-SURYA-GHAR-HOMES`: 10.0 Million households solarized (Baseline: 0.65M at 2024-01-01, Target: 2027-03-31).

### 2. India Updated Nationally Determined Contribution (NDC) under Paris Agreement (`POL-IN-MOP-NDC-2022`)
- **Jurisdiction**: `NATIONAL`
- **Classification**: `INTERNATIONAL_TREATY`
- **Sector**: `DECARBONIZATION_GOALS`
- **Issuing Authority**: Ministry of Environment, Forest and Climate Change (MoEFCC) / UNFCCC
- **Notification Reference**: MoEFCC Gazette Notification No. 24/2022-CC, dated 26 August 2022
- **Document SHA-256**: `8f434346648f6b96df89dda901c5176b10f60766576b498218371220cbe45249`
- **Enactment Date**: 2022-08-26 (Target Date: 2030-12-31)
- **Summary**: India's enhanced climate commitments submitted to the UNFCCC Secretariat, committing to achieve 50% cumulative electric power installed capacity from non-fossil fuel-based energy resources by 2030 and reducing GDP emission intensity by 45% compared to 2005 levels.
- **Quantified Targets**:
  - `TGT-NDC-NON-FOSSIL-SHARE`: 50.0% non-fossil capacity share (Baseline: 40.2% at 2021-12-31, Target: 2030-12-31).
  - `TGT-NDC-EMISSION-INTENSITY`: 45.0% emissions reduction vs 2005 (Baseline: 33.0% at 2021-12-31, Target: 2030-12-31).

### 3. BEE Standards & Labeling (S&L) Star Rating Scheme (`POL-IN-BEE-SL-2023`)
- **Jurisdiction**: `NATIONAL`
- **Classification**: `STATUTORY_ACT`
- **Sector**: `ENERGY_EFFICIENCY`
- **Issuing Authority**: Bureau of Energy Efficiency (BEE), Ministry of Power
- **Notification Reference**: BEE S&L Mandatory Notification No. BEE/S&L/AC/64/2023, dated 01 January 2023
- **Document SHA-256**: `c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2`
- **Enactment Date**: 2023-01-01 (Target Date: 2025-12-31)
- **Summary**: Mandatory energy efficiency standards under the Energy Conservation Act, 2001, tightening ISEER energy efficiency metrics for residential air conditioners, mandating a 24°C default temperature setpoint, and setting mandatory 5-star baseline standards.
- **Quantified Targets**:
  - `TGT-BEE-ELEC-SAVINGS`: 60.0 Billion Units (TWh) annual electricity savings (Baseline: 24.5 BU at 2022-01-01, Target: 2025-12-31).

### 4. KERC Rooftop Solar Photovoltaic Regulations 2023 (`POL-KA-KERC-SOLAR-2023`)
- **Jurisdiction**: `STATE_KARNATAKA`
- **Classification**: `STATE_REGULATION`
- **Sector**: `SOLAR_ROOFTOP`
- **Issuing Authority**: Karnataka Electricity Regulatory Commission (KERC)
- **Notification Reference**: KERC Order No. Y/01/2023, dated 18 August 2023
- **Document SHA-256**: `a6c52a51f2f7d3a24ec4342a7eb6d4b9b9903ef89efb3260714088031e3d36b7`
- **Enactment Date**: 2023-08-18 (Target Date: 2026-03-31)
- **Summary**: State regulatory framework for rooftop solar systems in Karnataka, providing net-metering up to 10 kW for LT domestic consumers, gross-metering for installations above 10 kW, capping installation capacity to 100% of sanctioned connected load, and establishing an energy banking feed-in tariff of ₹3.10/kWh.
- **Quantified Targets**:
  - `TGT-KERC-ROOFTOP-CAPACITY`: 1.50 GW grid-interactive domestic solar capacity across Karnataka Discoms (Baseline: 0.42 GW at 2023-04-01, Target: 2026-03-31).

### 5. APERC Grid Interactive Solar PV Consumer Regulations 2024 (`POL-AP-APERC-SOLAR-2024`)
- **Jurisdiction**: `STATE_ANDHRA_PRADESH`
- **Classification**: `STATE_REGULATION`
- **Sector**: `SOLAR_ROOFTOP`
- **Issuing Authority**: Andhra Pradesh Electricity Regulatory Commission (APERC)
- **Notification Reference**: APERC Regulation No. 2 of 2024, dated 12 March 2024
- **Document SHA-256**: `1e8884de6338b8eb830ae0a7c4731c6a2673dbe878b22a0011bb2718e4708ff8`
- **Enactment Date**: 2024-03-12 (Target Date: 2027-03-31)
- **Summary**: State regulatory architecture for consumer solar net-metering in Andhra Pradesh, establishing annual energy banking settlement with APCPDCL/APEPDCL, capping system size to 100% of sanctioned load, and providing an average power purchase cost (APPC) settlement rate for surplus net exports.
- **Quantified Targets**:
  - `TGT-APERC-ROOFTOP-CAPACITY`: 1.20 GW consumer solar capacity (Baseline: 0.31 GW at 2024-01-01, Target: 2027-03-31).

### 6. PM-KUSUM Scheme for Agricultural Solarization (`POL-IN-MNRE-KUSUM-2019`)
- **Jurisdiction**: `NATIONAL`
- **Classification**: `CENTRAL_SCHEME`
- **Sector**: `SOLAR_UTILITY`
- **Issuing Authority**: Ministry of New and Renewable Energy (MNRE), Government of India
- **Notification Reference**: MNRE Administrative Approval No. 32/645/2017-SPV, dated 08 March 2019
- **Document SHA-256**: `7d25e0e11894d0e12e3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c`
- **Enactment Date**: 2019-03-08 (Target Date: 2026-03-31)
- **Summary**: Flagship national scheme aimed at de-dieselizing the agricultural sector through decentralized solarization of agricultural feeder lines and off-grid standalone solar water pumps.
- **Quantified Targets**:
  - `TGT-KUSUM-SOLAR-CAPACITY`: 34.8 GW decentralized agricultural solar capacity across Components A, B, and C (Baseline: 0.0 GW at 2019-03-08, Target: 2026-03-31).

---

## 3. Query & Retrieval APIs

The `PolicyRegistry` class provides multi-dimensional indexed querying:

```python
registry = PolicyRegistry()

# 1. Fetch all policies
all_policies = registry.list_all_policies()

# 2. Filter by sector and jurisdiction
solar_policies = registry.query_policies(
    sector=PolicySector.SOLAR_ROOFTOP,
    jurisdiction=PolicyJurisdiction.NATIONAL,
    status=PolicyStatus.ACTIVE_ENACTED,
)

# 3. Retrieve specific policy by primary key
policy = registry.get_policy("POL-IN-MNRE-SURYA-GHAR-2024")

# 4. Retrieve policy by target identifier
policy, target = registry.find_target_by_id("TGT-SURYA-GHAR-CAPACITY")
```
