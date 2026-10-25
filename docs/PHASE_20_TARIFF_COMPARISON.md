# UrjaSetu EMS Phase 20: Eligible Tariff Comparison Engine

## 1. Principles of Honest Tariff Comparison

Energy consumers often ask: *"Would my electricity bill be cheaper under a different tariff schedule?"* Or: *"How much did the recent tariff revision increase my monthly expenditure?"*

The **TariffComparisonEngine** evaluates economic trade-offs across tariff schedules. To maintain mathematical and legal integrity, every comparison enforces four mandatory invariants:
1. **Identical Consumption Profile**: The exact same monthly units ($U_{\text{kwh}}$) and sanctioned load ($L_{\text{kw}}$) must be applied to both schedules.
2. **Consumer Category Verification**: A domestic household cannot be shown hypothetical savings under an agricultural or high-tension industrial tariff without flagging category ineligibility.
3. **Temporal Validity Check**: Superseded or expired tariff schedules cannot be presented as currently adoptable options.
4. **Full Component Parity**: Comparisons must account for energy slabs, fixed demand charges, fuel adjustments, and state electricity duties simultaneously.

---

## 2. Comparison Metrics & Component Differential

The comparison engine computes the absolute and percentage differential:

$$\Delta_{\text{cost}} = C_{\text{comparison}} - C_{\text{base}}$$
$$\text{Percentage Diff} = \left( \frac{\Delta_{\text{cost}}}{C_{\text{base}}} \right) \times 100\%$$

Where:
- $\Delta_{\text{cost}} < 0$: The alternative tariff is more economical.
- $\Delta_{\text{cost}} > 0$: The current base tariff is more economical.

### Itemized Differential Decomposition
The engine itemizes where savings or cost increases arise:
- `energy_charge_diff_inr`
- `fixed_charge_diff_inr`
- `tax_duty_diff_inr`
- `fac_diff_inr`

---

## 3. Case Studies

### Case 1: Historical Tariff Revision Impact (BESCOM FY25 vs FY24)
- **Base Tariff**: `KA_BESCOM_LT2A_2024` (Current FY25: 0–100 @ ₹4.75; >100 @ ₹7.00; Fixed ₹70/kW)
- **Comparison Tariff**: `KA_BESCOM_LT2A_2023` (Prior FY24: 0–50 @ ₹4.15; 51–100 @ ₹5.60; >100 @ ₹7.15; Fixed ₹60/kW)
- **Consumption Profile**: 300 kWh, 3.0 kW sanctioned load.
- **Outcome**:
  - Base Cost: ₹2,329.80
  - Historical Cost: ₹2,357.70
  - Delta: -₹27.90 (-1.18%)
  - **Eligibility Check**: `eligibility_verified = False` (*Tariff 'KA_BESCOM_LT2A_2023' is superseded and no longer legally applicable*).

### Case 2: Consumer Category Ineligibility (Domestic vs Commercial)
- **Base Tariff**: `KA_BESCOM_LT2A_2024` (Domestic)
- **Comparison Tariff**: `KA_BESCOM_LT3A_2024` (Commercial LT-3)
- **Consumption Profile**: 300 kWh, 3.0 kW sanctioned load.
- **Outcome**:
  - Base Cost: ₹2,329.80
  - Commercial Cost: ₹3,539.00
  - Delta: +₹1,209.20 (+51.90%)
  - **Eligibility Check**: `eligibility_verified = False` (*Category mismatch: Comparison tariff is for COMMERCIAL, but property is registered as DOMESTIC*).
- **Recommendation Summary**: *"Cost comparison is theoretical only. Option 'LT-3(a)' cannot be adopted: Category mismatch."*

---

## 4. Algorithmic Decision Tree

```
[ User Requests Comparison ]
               │
               ▼
   ┌───────────────────────┐
   │ Check Consumer Type   │ ──► Mismatch? Flag eligibility_verified = False
   └───────────┬───────────┘
               │
               ▼
   ┌───────────────────────┐
   │ Check Sunset Dates    │ ──► Superseded? Flag eligibility_verified = False
   └───────────┬───────────┘
               │
               ▼
   ┌───────────────────────┐
   │ Run Authoritative     │ ──► Compute Base Net Bill (C_base)
   │ Calculation Engine    │     Compute Comparison Net Bill (C_comp)
   └───────────┬───────────┘
               │
               ▼
   ┌───────────────────────┐
   │ Decompose Differences │ ──► Compute Energy, Fixed, Duty, and FAC Deltas
   └───────────┬───────────┘
               │
               ▼
   ┌───────────────────────┐
   │ Formulate Structured  │ ──► Return TariffComparisonResult with honest advice
   │ Recommendation        │     (Never advise switching to ineligible tariffs)
   └───────────────────────┘
```
