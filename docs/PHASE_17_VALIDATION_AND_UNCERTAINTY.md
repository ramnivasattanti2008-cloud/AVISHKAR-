# Phase 17: Validation, Calibration & Uncertainty Analysis

## 1. Model Calibration Status

UrjaSetu EMS explicitly documents the calibration and validation tiers of every digital twin:

### Calibration Tiers (`CalibrationStatus`):
1. **`CALIBRATED_HISTORICAL`**:
   - Calibrated against at least 3 months of verified DISCOM billing statements and high-resolution interval readings.
   - Fixed charges, sanctioned loads, and historic consumption totals are grounded in official utility records.
   - Applied to: `twin_blr_bescom_01`, `twin_vskp_apepdcl_02`, `twin_ka_macro_grid`.
2. **`UNCALIBRATED_SCENARIO_MODEL`**:
   - Parametric scenario model applied where empirical meter history is incomplete.
   - Uses regional averages or default user assumptions.
   - Explicitly labeled to prevent users from mistaking generic models for calibrated assets.

### Validation Tiers (`ValidationStatus`):
1. **`VALIDATED_METER_DATA`**: Baseline verified by cryptographic content hash of utility bills and official meter files.
2. **`PARAMETRIC_HEURISTIC`**: Derived using published engineering formulas without empirical sensor validation.
3. **`UNVALIDATED`**: User-defined theoretical model without statutory ground truth.

---

## 2. Sensitivity Sweep Engine & Uncertainty Analysis

To help users understand the sensitivity of financial and energy outcomes to parametric variations, UrjaSetu EMS provides bounded deterministic sensitivity sweeps.

### Resource Boundary Protection
- **Rule**: Sensitivity sweeps are bounded to a maximum of $50$ steps (`MAX_SENSITIVITY_STEPS = 50`).
- **Enforcement**: Parameter ranges requesting more than 50 steps raise an immediate `ValueError` before computation starts.
- **Safety**: Guarantees bounded CPU and memory footprint, preventing thread lockup.

### Parameter Sweep Behavior
- Varying solar capacity from $1.0\text{ kWp}$ to $6.0\text{ kWp}$ produces monotonic savings increases with piecewise-linear slopes reflecting tariff slab boundaries.
- As consumption drops across slab thresholds (e.g. crossing 100 kWh under BESCOM LT-2a), marginal unit savings increase because the higher slab rate (₹7.00/kWh) is avoided first.

---

## 3. Handling Uncertainty Honestly

1. **No Pseudo-Precision**: Rounding rules reflect physical measurement precision (energy rounded to $0.1\text{ kWh}$, currency rounded to ₹$0.01$).
2. **Zero-Baseline Protection**: All relative percentage changes guard against division-by-zero:
   $$\text{delta\_pct} = \frac{\Delta E}{E_{\text{baseline}}} \times 100\% \quad \text{if } E_{\text{baseline}} > 0 \text{ else } 0.0\%$$
3. **Disclosure of Unmodeled Costs**: Discloses that actual utility bills may include municipal cess, delayed payment surcharges, or Fuel Adjustment Charges (FAC / FPPCA) not captured in published base tariff orders.
