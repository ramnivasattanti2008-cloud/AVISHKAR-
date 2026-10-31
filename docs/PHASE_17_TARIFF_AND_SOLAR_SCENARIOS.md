# Phase 17: Tariff Integration & Solar Scenarios

## 1. Authoritative Tariff Integration

UrjaSetu EMS rejects generative AI arithmetic or generic average rates (e.g. "₹8/kWh flat") for financial modeling. All scenario billing is executed through `HouseholdTariffEngine` using statutory regulatory schedules.

### A. Karnataka BESCOM LT-2(a) Domestic Schedule
- **Fixed Charges**: ₹70.00 / kW sanctioned load / month (minimum ₹100.00 / month).
- **Telescopic Energy Slabs**:
  - Tier 1 (0 to 100 kWh): ₹4.75 / kWh
  - Tier 2 (> 100 kWh): ₹7.00 / kWh
- **Electricity Tax & Duty**: 9.0% on energy charges.
- **Solar Net-Metering Feed-in Credit**: ₹3.10 / kWh of surplus exported energy.

### B. Andhra Pradesh APEPDCL LT-1 Domestic Schedule (Group B)
- **Fixed Charges**: ₹60.00 / kW sanctioned load / month (minimum ₹75.00 / month).
- **Telescopic Energy Slabs**:
  - Slab 1 (0 to 30 kWh): ₹1.90 / kWh
  - Slab 2 (31 to 75 kWh): ₹3.00 / kWh
  - Slab 3 (76 to 125 kWh): ₹4.50 / kWh
  - Slab 4 (126 to 225 kWh): ₹6.00 / kWh
  - Slab 5 (> 225 kWh): ₹8.75 / kWh
- **Electricity Duty**: 6.0% effective duty on energy charges.
- **Solar Net-Metering Settlement Rate**: ₹2.50 / kWh approved APPC feed-in rate.

---

## 2. Solar Generation Calculation Methodology

Solar generation is calculated via physical irradiance integration:

$$E_{\text{monthly}} = C_{\text{kWp}} \times I_{\text{daily}} \times N_{\text{days}} \times PR$$

### Example Reference Calculation:
- **Location**: Indiranagar, Bengaluru (KA)
- **Capacity**: 4.0 kWp
- **Daily Insolation**: $4.8\text{ kWh/m}^2/\text{day}$
- **Performance Ratio**: $0.75$ ($14\%$ thermal/spectral loss, $4\%$ inverter conversion loss, $3\%$ soiling loss, $4\%$ cable/DC mismatch)
- **Month Length**: 30 days

$$E_{\text{monthly}} = 4.0 \times 4.8 \times 30 \times 0.75 = 432.00\text{ kWh}$$

### Net Energy Flow & Billing:
- Baseline Consumption: $460.00\text{ kWh}$
- Self-Consumption ($65\%$): $280.80\text{ kWh}$
- Grid Imports: $460.00 - 280.80 = 179.20\text{ kWh}$
- Grid Exports: $432.00 - 280.80 = 151.20\text{ kWh}$
- Energy Charge (BESCOM LT-2a on 179.2 kWh):
  - First 100 kWh @ ₹4.75 = ₹475.00
  - Remaining 79.2 kWh @ ₹7.00 = ₹554.40
  - Total Energy Charge = ₹1,029.40
- Fixed Charge (5.0 kW @ ₹70/kW) = ₹350.00
- Electricity Duty (9% of ₹1,029.40) = ₹92.65
- Gross Bill = $1029.40 + 350.00 + 92.65 = ₹1,472.05$
- Solar Export Credit ($151.2\text{ kWh} \times ₹3.10/\text{kWh}$) = ₹468.72
- **Net Bill Payable** = $1472.05 - 468.72 = ₹1,003.33$
- **Net Monthly Savings** = $3540.00 - 1003.33 = ₹2,536.67$ ($71.7\%$ reduction)
