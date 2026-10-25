# UrjaSetu EMS Phase 20: Utility Bill Validation & Reconciliation Diagnostics

## 1. Objective & Philosophy

Consumers frequently experience mistrust when inspecting their monthly electricity bills. When an invoice appears unexpectedly high, consumers often assume billing errors or utility overcharging. Conversely, naive software calculators often brand legitimate utility adjustments as "fraud".

The **BillValidationEngine** provides analytical reconciliation between official utility-issued invoices and expected mathematical models. It decomposes the bill into constituent line items, calculates exact deltas, and provides transparent explanations without premature accusations.

---

## 2. Validation Status Classification

Reconciliations are categorized into four explicit states:

| Status Code | Criteria | Meaning & Diagnostic Behavior |
| :--- | :--- | :--- |
| `EXACT_MATCH` | $|\Delta| \le \text{₹}1.00$ | Mathematical identity within standard 2-decimal rounding tolerance. |
| `DISCREPANCY_EXPLAINED` | $|\Delta| \le (U \times R_{\text{fac}} + \text{₹}5.00)$ | Variance is fully consistent with known unmodeled items (e.g. quarterly Fuel Adjustment Charges, meter rent, or municipal cess). |
| `UNRESOLVED_DISCREPANCY` | $|\Delta| > (U \times R_{\text{fac}} + \text{₹}5.00)$ | Material variance requiring investigation. Triggers breakdown analysis (e.g. arrears, load mismatch, or power factor penalties). |
| `INSUFFICIENT_DATA` | Missing units, load, or tariff code | Reconciling inputs are incomplete; engine refuses to fabricate a validation verdict. |

---

## 3. Component-by-Component Reconciliation Matrix

When an authorized user validates an imported `UtilityBillRecord`, the engine performs comparative analysis across four distinct dimensions:

```python
component_comparison = {
    "billed_energy_charge": 1525.00,
    "calculated_energy_charge": 1525.00,
    "billed_fixed_charge": 210.00,
    "calculated_fixed_charge": 210.00,
    "billed_tax_duty": 137.25,
    "calculated_tax_duty": 137.25,
    "solar_credit": 0.00,
}
```

---

## 4. Anti-False Accusation Safeguards

1. **Unmodeled Regulatory Fees**: Official electricity bills routinely incorporate legitimate line items not published in base tariff orders, such as:
   - Dynamic monthly fuel surcharge adjustments (FAC / FPPCA / FPPPA).
   - Bi-annual meter testing / smart meter modem maintenance fees (typically ₹15–₹40/month).
   - Municipal drainage and street-lighting cess (often 1–2% in select municipal corporations).
   - Delayed payment interest or carried-forward arrears from previous billing cycles.
2. **Strict Advisory Disclaimer**:
   The engine automatically attaches the mandatory disclaimer:
   > *"Reconciliation note: Differences between utility bills and calculated estimates do not necessarily indicate billing fraud. Utility statements frequently include dynamic quarterly FAC rates, power factor rebates, or adjustments for previous billing cycles."*
3. **Evidence-Based Recommendations**:
   If an unresolved discrepancy is flagged, the system advises the consumer to verify their bill for:
   - Carried-forward arrears (`Arrears / Baki` line item).
   - Sanctioned load penalty (exceeding sanctioned demand triggers temporary 1.5x fixed charges).
   - Discom meter reading corrections or provisional average billing adjustments.
