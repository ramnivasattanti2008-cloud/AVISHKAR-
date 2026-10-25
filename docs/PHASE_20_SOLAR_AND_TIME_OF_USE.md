# UrjaSetu EMS Phase 20: Solar Net-Metering & Time-of-Use Demand Optimization

## 1. Solar Net-Metering Economics

Rooftop solar systems generate intermittent power during daytime solar hours. When generation exceeds instantaneous household load, surplus power flows into the distribution grid through a bidirectional energy meter.

### Statutory Export Compensation Sourcing
UrjaSetu rejects arbitrary assumptions that exported solar electricity offsets imported power at a 1:1 retail parity unless state regulations explicitly mandate full net-energy metering.

| State / Utility | Regulatory Mechanism | Statutory Buyback Rate | Official Source Authority |
| :--- | :--- | :--- | :--- |
| **Karnataka (BESCOM)** | Net-Metering / Gross-Metering | **₹3.10 / kWh** | KERC Generic Solar Tariff Order |
| **Andhra Pradesh (APCPDCL)** | Net-Billing Settlement | **₹2.50 / kWh** | APERC Approved Average Power Purchase Cost (APPC) |
| **Tamil Nadu (TANGEDCO)** | Net-Feed-in Scheme | **₹2.25 / kWh** | TNERC Solar Net Feed-in Order |
| **Gujarat (UGVCL)** | Surya Gujarat Net-Metering | **₹2.25 / kWh** | GERC Distributed Solar Regulation |

### Mathematical Solar Offset Invariant
The solar export credit ($C_{\text{solar}}$) can offset gross charges, but the net payable bill is always bounded below by the utility's minimum monthly charge floor ($C_{\text{minimum\_floor}}$):

$$\text{Net Payable Bill} = \max\Big( C_{\text{minimum\_floor}},\ \text{Gross Bill} - (U_{\text{export}} \times R_{\text{export}}) \Big)$$

---

## 2. Time-of-Use (ToU) Demand-Shifting Optimization

Time-of-Day (ToD) tariffs incentivize consumers to reduce demand during high-cost peak periods (typically 18:00 to 22:00) and shift flexible energy consumption to off-peak night hours or solar generation hours.

### The Energy Conservation Invariant
A critical integrity invariant of the **TimeOfUseOptimizer** is strict energy conservation:

$$\sum U_{\text{baseline}}(t) \equiv \sum U_{\text{optimized}}(t) = U_{\text{total}}$$

The optimizer models shifting flexible kilowatt-hours between diurnal pricing windows, but it **never manufactures energy savings by destroying or deleting kilowatt-hours**. If 80 kWh of EV charging is shifted from peak to off-peak, exactly 80 kWh is added to the off-peak block.

---

## 3. Optimization Mathematical Formulation

### Baseline Peak-Weighted Cost ($C_{\text{base\_tou}}$)
$$C_{\text{base\_tou}} = C_{\text{flat}}(U_{\text{total}}) + \Big( U_{\text{shift}} \times \Delta R_{\text{peak}} \Big)$$

### Optimized Shifted Cost ($C_{\text{opt\_tou}}$)
$$C_{\text{opt\_tou}} = C_{\text{flat}}(U_{\text{total}}) - \Big( U_{\text{shift}} \times \Delta R_{\text{off\_peak}} \Big)$$

### Net Monthly Financial Savings ($\text{Savings}_{\text{inr}}$)
$$\text{Savings}_{\text{inr}} = U_{\text{shift}} \times \Big( \Delta R_{\text{peak}} + \Delta R_{\text{off\_peak}} \Big)$$

### Worked Example: Commercial LT-3 (500 kWh, 10 kW Load, 80 kWh Shift)
- Base Tariff Energy Rate: ₹8.50 / kWh
- Evening Peak (18:00–22:00): +15% surcharge + ₹1.00 rate adder = **+₹2.275 / kWh**
- Solar Off-Peak (10:00–16:00): -10% rebate + ₹0.50 rate adder = **-₹1.350 / kWh**
- Total Rate Differential: $2.275 + 1.350 = \mathbf{₹3.625 / kWh}$
- Monthly Savings for 80 kWh Shift:
  $$\text{Savings} = 80.0 \times 3.625 = \mathbf{₹290.00 / month}$$
- Invariant Preserved: Total monthly consumption remains exactly **500.0 kWh**.

---

## 4. Technical Feasibility Disclosures

The optimization engine automatically attaches technical feasibility notes:
1. *Time-of-Use pricing slots require bidirectional or smart Time-of-Day electronic meters configured with Discom ToD registers.*
2. *Shifting load is economically meaningful only when the consumer's tariff schedule incorporates active peak surcharges and off-peak concessions.*
3. *Consumers on flat domestic rates will not realize monetary savings from shifting load unless their Discom formally rolls out domestic ToU tariffs.*
