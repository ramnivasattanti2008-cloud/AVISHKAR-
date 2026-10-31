# UrjaSetu EMS — Phase 22: Independent Calculation Verification

**Document Version:** 1.0.0  
**Audit Focus:** Quantitative Verification of Energy, Tariff, Physical Systems & Subsidy Mathematics  
**Status:** FULLY VERIFIED (0 Discrepancies)  

---

## 1. Scope of Independent Numerical Audit

This document details the quantitative verification performed by the Independent Validation Team to confirm that all financial, physical, and thermodynamic calculations within UrjaSetu EMS are mathematically accurate and adhere to statutory gazetted orders and physical conservation laws.

All mathematical assertions were benchmarked against **independent reference models implemented separately from the production codebase** (see test `test_phase22_independent_validation.py`).

---

## 2. Independent Tariff & Bill Calculation Verification

### 2.1 BESCOM LT-2(a) Telescopic Slab Structure (KERC Order S/01/24)
- **Slab 1 (0 to 100 kWh)**: ₹4.75 / kWh
- **Slab 2 (> 100 kWh)**: ₹7.00 / kWh
- **Fixed Charges**:
  - Up to 50 kW: ₹70.00 / kW / month
  - 50 kW and above: ₹140.00 / kW / month
- **Fuel Adjustment Charge (FAC / FPPCA)**: ₹0.43 / kWh
- **Karnataka State Electricity Duty**: 9.0% on total energy charges
- **Solar Export Settlement**: ₹3.10 / kWh (gross export credit)
- **Minimum Monthly Charge Floor**: ₹100.00 / month

### 2.2 Independent Test Case Comparison
**Test Scenario**: Domestic prosumer with 250 kWh grid consumption, 4.0 kW sanctioned load, 50 kWh gross solar export.

| Component | Independent Reference Model | Production Engine (`calculate_bill`) | Delta | Audit Result |
| :--- | :--- | :--- | :--- | :--- |
| **Slab 1 Energy (100 kWh @ ₹4.75)** | ₹475.00 | ₹475.00 | ₹0.00 | **MATCH** |
| **Slab 2 Energy (150 kWh @ ₹7.00)** | ₹1,050.00 | ₹1,050.00 | ₹0.00 | **MATCH** |
| **Total Base Energy Charge** | ₹1,525.00 | ₹1,525.00 | ₹0.00 | **MATCH** |
| **Fixed Demand Charge (4 kW @ ₹70)** | ₹280.00 | ₹280.00 | ₹0.00 | **MATCH** |
| **FAC / FPPCA (250 kWh @ ₹0.43)** | ₹107.50 | ₹107.50 | ₹0.00 | **MATCH** |
| **Electricity Duty (9% on ₹1,525.00)** | ₹137.25 | ₹137.25 | ₹0.00 | **MATCH** |
| **Gross Electricity Bill** | ₹2,049.75 | ₹2,049.75 | ₹0.00 | **MATCH** |
| **Solar Export Credit (50 kWh @ ₹3.10)** | -₹155.00 | -₹155.00 | ₹0.00 | **MATCH** |
| **Net Payable Bill** | **₹1,894.75** | **₹1,894.75** | **₹0.00** | **PERFECT MATCH** |

### 2.3 Boundary & Edge Condition Behavior
1. **Zero Consumption ($0\text{ kWh}$)**: Fixed charge (₹280.00) exceeds minimum floor (₹100.00), yielding net bill ₹280.00. Correctly handled.
2. **Excess Solar Export ($300\text{ kWh export vs } 100\text{ kWh consumption}$)**: Bill floors at ₹0.00 or yields negative credit without arithmetic error.
3. **Negative Input Protection**: Rejects negative consumption inputs with `ValueError("Units consumed cannot be negative")`.

---

## 3. Physical Energy Conservation in Diurnal Load Shifting

### 3.1 First-Principles Invariant: $\sum_{t=1}^{24} P_{\text{shifted}}(t) \cdot \Delta t \equiv \sum_{t=1}^{24} P_{\text{baseline}}(t) \cdot \Delta t$
Energy can neither be created nor destroyed. A demand-response or load-shifting algorithm must conserve total daily consumption unless an explicit curtailment efficiency factor is introduced.

### 3.2 Verification Results
- **Baseline 24-hour Profile**: 50.000 kWh total consumption (hourly variations 1.0 to 3.5 kW).
- **Shift Parameters**: Shift 4.0 kWh from peak hours (18:00–22:00) to off-peak solar hours (10:00–14:00).
- **Optimized Profile Total**: 50.000 kWh.
- **Energy Conservation Delta**: $|50.000 - 50.000| = 0.000\text{ kWh}$ ($0.000\%$).
- **Peak Hour Reduction**: Shifted exactly -4.000 kWh from peak hours.
- **Off-Peak Hour Addition**: Added exactly +4.000 kWh to solar generation window.

---

## 4. Battery Physics & Non-Linear Degradation Verification

### 4.1 ASTM E1049 Rainflow Cycle Counting
- **Methodology**: Applied standard ASTM E1049-85 (2017) Rainflow counting algorithm to track closed hysteresis loops in battery state of charge (SoC).
- **Verification Vector**: Sinusoidal SoC oscillation between 0.3 and 0.8 (amplitude 0.5).
- **Observed Cycles**: Counted 1 full cycle (amplitude 0.5) and 2 half cycles, matching analytical mechanics.

### 4.2 Monotonic Depth-of-Discharge (DoD) Wear Cost
The battery degradation model uses an empirical power-law exponent ($\alpha = 1.8$):
$$\text{Cost}_{\text{wear}}(\text{DoD}) = \frac{\text{CAPEX}}{2 \cdot N_{\text{nominal}} \cdot \text{DoD}_{\text{nom}}} \cdot \left(\frac{\text{DoD}}{0.80}\right)^{\alpha - 1}$$

- **20% DoD**: ₹3.23 / kWh
- **50% DoD**: ₹6.72 / kWh
- **80% DoD**: ₹9.77 / kWh
- **95% DoD**: ₹11.23 / kWh
- **Monotonicity Verification**: $\text{Wear}(20\%) < \text{Wear}(50\%) < \text{Wear}(80\%) < \text{Wear}(95\%)$ strictly holds.

### 4.3 Thermal C-Rate Derating
- **Nominal Operating Zone (10°C to 35°C)**: Derate factor = 1.000 (1.000 C continuous).
- **Freezing Temperature (0°C)**: Derated to 0.500 C to prevent lithium plating.
- **High Temperature (42°C)**: Derated to 0.650 C to prevent electrolyte decomposition.
- **Extreme Heat (>45°C, tested at 50°C)**: Derated to safety floor = 0.200 C.

---

## 5. Statutory Benchmark Verification

### 5.1 MNRE PM Surya Ghar CFA Subsidy Tiers
Verified against official MNRE Gazette Notification dated February 2024:
- **1.0 kW**: ₹30,000.00 (verified against `pm_surya_ghar(1.0)`)
- **1.5 kW**: ₹45,000.00 (verified against `pm_surya_ghar(1.5)`)
- **2.0 kW**: ₹60,000.00 (verified against `pm_surya_ghar(2.0)`)
- **3.0 kW**: ₹78,000.00 (verified against `pm_surya_ghar(3.0)`)
- **5.0 kW**: ₹78,000.00 (strictly capped at ₹78,000.00 for systems $\ge 3\text{ kWp}$)

### 5.2 CEA Grid Carbon Factor
- **Reference**: Central Electricity Authority (CEA) CO2 Baseline Database for the Indian Power Sector, Version 19.0 (December 2023).
- **Factor**: $0.716\text{ kg CO}_2/\text{kWh}$ (Weighted Average Emission Factor including RES).
- **Application Assertion**: Confirmed exact constant `0.716` in `policy_intelligence.py` and `digital_twin.py`.

---

## 6. Audit Conclusion

All audited mathematical calculations have passed independent verification with **zero numerical discrepancies**.
