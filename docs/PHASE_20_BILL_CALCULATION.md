# UrjaSetu EMS Phase 20: Authoritative Bill Calculation Engine

## 1. Mathematical Formulation & Calculation Hierarchy

The UrjaSetu **AuthoritativeTariffEngine** executes deterministic electricity billing calculations. Calculations strictly reflect the statutory computation hierarchy mandated by state distribution utilities:

$$\text{Net Bill} = \max\Big(\text{Min Bill Floor},\ \text{Gross Bill} - \text{Solar Export Credit}\Big)$$

Where:
$$\text{Gross Bill} = \text{Fixed Demand Charges} + \text{Energy Charges} + \text{ToU Adjustment} + \text{FAC Charges} + \text{State Electricity Duty}$$

---

## 2. Component-by-Component Mathematical Execution

### 1. Fixed & Demand Charges ($C_{\text{fixed}}$)
Fixed charges recover distribution capacity costs based on the consumer's sanctioned connected load ($L_{\text{kW}}$):

$$C_{\text{fixed\_raw}} = \big( L_{\text{kW}} \times R_{\text{fixed\_kw}} \big) + C_{\text{flat}}$$
$$C_{\text{fixed}} = \max\big( C_{\text{fixed\_raw}},\ C_{\text{minimum\_floor}} \big)$$

*Example*: For a 3 kW sanctioned load under BESCOM LT-2(a) (₹70/kW):
$$C_{\text{fixed}} = \max(3.0 \times 70.00,\ 100.00) = \mathbf{₹210.00}$$

### 2. Telescopic Slab Energy Charges ($C_{\text{energy}}$)
Under telescopic schedules, units are billed incrementally across progressive tiers:

$$C_{\text{energy}} = \sum_{i=1}^{N} \Big( U_i \times R_i \Big)$$

Where $U_i$ represents the consumption units falling within slab $[S_{i,\text{min}},\ S_{i,\text{max}}]$:
$$U_i = \max\Big(0,\ \min\big(U_{\text{remaining}},\ S_{i,\text{max}} - S_{i,\text{min}}\big)\Big)$$

*Example*: 250 kWh under BESCOM LT-2(a) (0–100 kWh @ ₹4.75; >100 kWh @ ₹7.00):
- Slab 1 (0 to 100 kWh): $100.0 \times 4.75 = \mathbf{₹475.00}$
- Slab 2 (>100 kWh): $150.0 \times 7.00 = \mathbf{₹1,050.00}$
- Total Energy Charges: $475.00 + 1,050.00 = \mathbf{₹1,525.00}$

### 3. Time-of-Use Diurnal Adjustments ($A_{\text{tou}}$)
Applied to ToU-metered consumers (e.g. Commercial LT-3 or smart-metered domestic):

$$A_{\text{tou}} = \sum \Big( U_{\text{peak}} \times \Delta R_{\text{peak}} \Big) - \sum \Big( U_{\text{off\_peak}} \times \Delta R_{\text{off\_peak}} \Big)$$

Where $\Delta R$ includes statutory percentage surcharges/rebates and absolute rate adders:
$$\Delta R_{\text{peak}} = \big( R_{\text{base}} \times \text{Surcharge}\% \big) + \text{Adder}_{\text{peak}}$$
$$\Delta R_{\text{off\_peak}} = \big( R_{\text{base}} \times \text{Rebate}\% \big) + |\text{Adder}_{\text{off\_peak}}|$$

### 4. Fuel Adjustment Charges ($C_{\text{fac}}$)
Dynamic quarterly or bi-monthly fuel and power purchase cost adjustments approved by the SERC:

$$C_{\text{fac}} = U_{\text{total}} \times R_{\text{fac}}$$

*Example*: 250 kWh at BESCOM Q1 approved FAC rate (₹0.22/kWh):
$$C_{\text{fac}} = 250.0 \times 0.22 = \mathbf{₹55.00}$$

### 5. State Electricity Tax & Duty ($C_{\text{duty}}$)
Statutory excise tax levied as a percentage of energy-related charges:

$$C_{\text{duty}} = \Big( C_{\text{energy}} + A_{\text{tou}} \Big) \times \left( \frac{\text{Duty}\%}{100.0} \right)$$

*Example*: 9% Karnataka Electricity Duty on ₹1,525.00 energy charges:
$$C_{\text{duty}} = 1,525.00 \times 0.09 = \mathbf{₹137.25}$$

### 6. Solar Net-Metering Export Compensation ($C_{\text{solar}}$)
Credit credited for surplus exported generation fed into the grid:

$$C_{\text{solar}} = U_{\text{exported}} \times R_{\text{export}}$$

*Example*: 100 kWh exported at KERC solar generic tariff (₹3.10/kWh):
$$C_{\text{solar}} = 100.0 \times 3.10 = \mathbf{₹310.00}$$

---

## 3. Reference Verification Cases

| Consumption (kWh) | Sanctioned Load (kW) | Tariff Schedule | Fixed Charges | Energy Charges | Duty & Tax | Net Bill (INR) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **0.0 kWh** | 1.0 kW | `KA_BESCOM_LT2A_2024` | ₹100.00 (Floor) | ₹0.00 | ₹0.00 | **₹100.00** |
| **50.0 kWh** | 3.0 kW | `KA_BESCOM_LT2A_2024` | ₹210.00 | ₹237.50 | ₹21.38 | **₹479.88** |
| **250.0 kWh** | 3.0 kW | `KA_BESCOM_LT2A_2024` | ₹210.00 | ₹1,525.00 | ₹137.25 | **₹1,927.25** |
| **250.0 kWh** (+100 exp) | 3.0 kW | `KA_BESCOM_LT2A_2024` | ₹210.00 | ₹1,525.00 | ₹137.25 | **₹1,617.25** |
| **500.0 kWh** (ToU) | 10.0 kW | `KA_BESCOM_LT3A_2024` | ₹1,500.00 | ₹4,250.00 | ₹390.82 | **₹6,358.32** |

---

## 4. Honest Labeling Invariant

Every calculation result is codified with:
```python
is_official_bill: bool = False
calculation_type: str = "RECONSTRUCTED_ESTIMATE"
```

The system strictly displays the statutory disclaimer:
> *"NOTICE: This calculation is a reconstructed mathematical estimate derived from gazetted regulatory tariff schedules. It is not an official utility bill. Utility invoices may include power factor penalties, meter rent, or delayed payment surcharges."*
