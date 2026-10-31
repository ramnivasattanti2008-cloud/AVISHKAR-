# Phase 21: Data Integrity & Provenance Audit
**UrjaSetu Energy Management & Intelligence System**
*Evaluation Date: October 24, 2026 | Technical Acceptance Owner & Data Integrity Lead*

---

## 1. Data Honesty Mandate

In accordance with UrjaSetu Core Architectural Principles D6 and D7:
1. **Data honesty is the product**: Never present simulated, estimated, or demo data as live.
2. **Every metric carries an explicit provenance status**:
   - `OFFICIAL_OBSERVATION`: Gazetted reports from Central Electricity Authority (CEA) or National Power Portal (NPP).
   - `IMPORTED_STATUTORY`: Verified utility statements issued by licensed DISCOMs.
   - `CALCULATED_STATISTIC`: Reconstructed mathematical estimates under documented formulas.
   - `SIMULATED`: Counterfactual What-If scenarios clearly bannered with parameter origin maps.
   - `UNAVAILABLE`: Missing or unsupported telemetry is visibly displayed as `UNAVAILABLE`, never defaulted to zero.

---

## 2. Invariant & Calculation Audit

### Invariant 1: Physical Dimension & Unit Segregation (MU vs MW)
- **Rule**: Installed power capacity (MW) must never be conflated with generated or consumed energy (MU / kWh).
- **Audit Result**: Verified in `UnitValidator.get_category()`. Energy metrics (`ENERGY_REQUIREMENT`, `ENERGY_SUPPLIED`, `SOLAR_GENERATION`) are typed as `UnitCategory.ENERGY`. Power metrics (`PEAK_DEMAND`, `PEAK_MET`, `INSTALLED_CAPACITY`) are typed as `UnitCategory.POWER`. Incompatible cross-dimension additions raise validation errors.

### Invariant 2: Anti-Disaggregation Guard
- **Rule**: State-level energy balances from CEA or State Load Dispatch Centers (SLDCs) cannot be proportionally downscaled to revenue districts or municipalities without direct physical metering.
- **Audit Result**: Verified in `GeoExplorer.verify_no_disaggregation()`. The platform strictly reports district-level peak demand as `UNAVAILABLE` rather than synthesizing numbers from Karnataka or Andhra Pradesh totals.

### Invariant 3: Non-Coterminous Utility Boundaries
- **Rule**: Utility supply territories (e.g. BESCOM) must never be assumed coterminous with revenue districts (e.g. Bengaluru Urban District).
- **Audit Result**: Verified in `GeoExplorer.are_utility_and_district_coterminous()`. Always returns `False` for Indian DISCOMs, as BESCOM spans 8 distinct districts (Bengaluru Urban, Bengaluru Rural, Chikkaballapura, Kolar, Davanagere, Tumakuru, Chitradurga, Ramanagara).

### Invariant 4: Statutory Tariff Mathematical Integrity
- **Rule**: Tariff calculations must implement exact SERC retail tariff orders (telescopic slabs, two-part demand, ToU surcharges, FAC, and state duties). Estimates must disclose that they are reconstructed, not official utility statements.
- **Audit Result**: Verified in `AuthoritativeTariffEngine.calculate_bill()`. BESCOM LT-2(a) FY25 bill calculation reproduces exact tiered charges:
  - First 100 kWh @ ₹4.75/kWh = ₹475.00
  - Remaining 150 kWh @ ₹7.00/kWh = ₹1,050.00
  - Fixed demand charges: 4 kW × ₹70/kW/month = ₹280.00
  - Fuel adjustment: 250 kWh × ₹0.22/kWh = ₹55.00
  - State Electricity Tax: 9.0% on taxable energy = ₹137.25
  - Solar net-meter export credit: 50 kWh × ₹3.10/kWh = -₹155.00
  - Net calculated bill: ₹1,842.25 (`is_official_bill = False`).

### Invariant 5: Anti-False Accusation Policy
- **Rule**: Reconciliation differences between imported utility statements and calculations must not accuse the utility or consumer of fraud or theft.
- **Audit Result**: Verified in `BillValidationResult`. Discrepancies are categorized as `EXACT_MATCH`, `DISCREPANCY_EXPLAINED` (attributable to fuel surcharges or meter rent), or `UNRESOLVED_DISCREPANCY` (attributable to arrears or power factor penalties). Disclaimers explicitly state that differences do not indicate billing fraud.

### Invariant 6: Strict Energy Conservation in What-If Simulations
- **Rule**: Time-of-Use diurnal load shifting simulations must conserve total energy consumption across the 24-hour cycle ($\sum \Delta E_h = 0$).
- **Audit Result**: Verified in `TimeOfUseOptimizer.evaluate_load_shift()`. Shifting 50 kWh from evening peak to solar off-peak results in baseline 360.0 kWh and optimized 360.0 kWh (zero energy creation or destruction).

### Invariant 7: Statutory Grid Emission Factors
- **Rule**: Carbon mitigation claims must trace to authoritative government benchmarks, not arbitrary international constants.
- **Audit Result**: Verified across `policy_intelligence.py` and `recommendations.py`. Grid emissions factor is pinned to official Central Electricity Authority (CEA) CO2 Baseline Database Version 19: **0.716 kg CO2/kWh** (weighted national grid operating margin).

---

## 3. Data Traceability Matrix

| Metric ID | Display Label | Physical Unit | Authoritative Source | Aggregation Level | Provenance Status |
|:---|:---|:---:|:---|:---:|:---:|
| `ENERGY_REQUIREMENT_MU` | Energy Requirement | MU | CEA Monthly Power Supply Position Bulletins | National / State | `OFFICIAL_OBSERVATION` |
| `ENERGY_SUPPLIED_MU` | Energy Supplied | MU | CEA Monthly Power Supply Position Bulletins | National / State | `OFFICIAL_OBSERVATION` |
| `PEAK_MET_MW` | Peak Demand Met | MW | CEA Monthly Power Supply Position Bulletins | National / State | `OFFICIAL_OBSERVATION` |
| `SOLAR_GEN_MU` | Renewable Solar Generation | MU | CEA Monthly Renewable Generation Reports | National / State | `OFFICIAL_OBSERVATION` |
| `DAILY_OUTTURN_MU` | Daily Generation Outturn | MU | National Power Portal (NPP) Daily Summaries | National | `OFFICIAL_OBSERVATION` |
| `TARIFF_NET_BILL` | Reconstructed Bill Estimate | INR | Gazetted SERC Retail Supply Tariff Orders | Household Profile | `CALCULATED_STATISTIC` |
| `CFA_SUBSIDY_INR` | PM Surya Ghar Subsidy | INR | MNRE National Portal for Rooftop Solar Guidelines | Household Profile | `CALCULATED_STATISTIC` |
| `SIM_SOLAR_KWH` | What-If Solar Generation | kWh | Calibrated Physics Digital Twin Engine | Household Profile | `SIMULATED` |
