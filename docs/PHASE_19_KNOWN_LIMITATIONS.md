# UrjaSetu EMS Phase 19: Operational Boundaries & Known Limitations

## 1. Operational Scope & Boundaries

In accordance with UrjaSetu's core principle of data honesty, this document catalogs the exact operational boundaries, external dependencies, and technical limitations of the Phase 19 Energy Policy Intelligence Subsystem.

---

## 2. Documented Limitations

### 1. Advisory Nature & National Portal Interface
- **Limitation**: UrjaSetu EMS is an independent analytical advisory platform. It computes accurate statutory CFA eligibility and sizing recommendations but does **not** directly execute formal subsidy applications on the PM Surya Ghar National Portal (`pmsuryaghar.gov.in`) or submit Discom net-metering paperwork.
- **Consumer Requirement**: Beneficiaries must complete formal consumer authentication (Aadhaar KYC, electricity consumer number linking) and vendor contracting directly through the official National Portal.

### 2. Discom Net-Metering Approval Dependencies
- **Limitation**: While the module calculates regulatory caps based on statutory KERC/APERC regulations (100% connected load, 10 kW LT threshold), actual grid-connection approval depends on local distribution transformer (DT) reverse power flow capacity (typically capped at 80% of rated DT capacity by Discoms).
- **Mitigation**: The system explicitly warns consumers that local Discom site feasibility surveys govern final technical approval.

### 3. CEA & MNRE Baseline Data Refresh Latency
- **Limitation**: Target progress evaluations are grounded in official monthly reports published by the Central Electricity Authority (CEA) and Ministry of New and Renewable Energy (MNRE). Publication lag for these official statistics typically ranges from 30 to 60 days.
- **Mitigation**: Every progress assessment explicitly displays the `baseline_date`, `observation_date`, and issuing report reference to ensure temporal transparency.

### 4. Municipal & Building Bye-law Heterogeneity
- **Limitation**: While state SERC regulations are codified, hyper-local municipal bye-laws (e.g., Bruhat Bengaluru Mahanagara Palike structural load clearances, heritage zone restrictions) are not automatically ingested.
- **Consumer Advisory**: Homeowners in protected or multi-story apartments are advised to verify Resident Welfare Association (RWA) no-objection certificates (NOCs).

### 5. Linear Run-Rate Assumption
- **Limitation**: The linear run-rate benchmark assumes an idealized constant monthly adoption rate across the policy horizon. In practice, rooftop solar installations often follow an S-curve (slow initial uptake accelerating as vendor supply chains and public awareness mature).
- **Transparency**: The system labels this as an "expected linear benchmark" and provides explicit performance ratios rather than claiming predictive infallibility.

---

## 3. Future Roadmap

1. **Direct National Portal API Connectors**: Integrate with authenticated government open APIs when public Discom net-metering webhook gateways become accessible.
2. **Dynamic DT Capacity Feasibility**: Allow consumers to query feeder-level and distribution transformer spare capacity if Discoms publish open SCADA telemetry.
3. **Automated Gazette Scrapers**: Ingest state regulatory tariff orders automatically via PDF parsing and cryptographic verification pipelines.
