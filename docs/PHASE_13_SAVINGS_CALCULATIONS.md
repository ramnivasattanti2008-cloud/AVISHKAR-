# UrjaSetu EMS — Phase 13 Savings Calculations & Mathematical Lineage

> **Standard**: Financial Calculation Methodology & Anti-Double-Counting Specification  
> **Status**: Verified & Enforced  
> **Author**: UrjaSetu Systems Architecture & Engineering  
> **Audit Date**: 2026-10-24  

---

## 1. Financial Transparency & Calculation Principles

In consumer energy analytics, presenting inflated or fabricated savings estimates damages user trust and creates regulatory compliance liabilities. UrjaSetu EMS strictly adheres to four financial calculation principles:
1. **Authoritative Tariff Integration**: All electricity cost savings are evaluated through `HouseholdTariffEngine.calculate_bill()`, accounting for telescopic energy charge slabs, fixed demand charges per kW, minimum monthly charges, electricity taxes, and net-metering feed-in credits.
2. **Marginal Valuation**: Energy reductions are valued at the true marginal tariff rate of the impacted slab, rather than an unweighted average rate.
3. **Anti-Double-Counting Guard**: Cumulative savings across multiple recommendations are evaluated sequentially on the shared consumption baseline, preventing the stacking of independent reductions on identical kilowatt-hours.
4. **Honest Labeling**: Reconstructed estimates and scenario projections are clearly labeled with applicable assumptions and exclusions (e.g. municipal cess or fuel adjustment charges).

---

## 2. Mathematical Formulation by Recommendation Category

### 2.1. Telescopic Slab Clipping (`RULE-SLAB-01`)
- **Objective**: Identify when monthly consumption $C$ crosses a major slab boundary $S_{\text{threshold}}$ by a manageable margin $\Delta C = C - S_{\text{threshold}}$ (where $5\text{ kWh} \le \Delta C \le 45\text{ kWh}$).
- **Formula**:
  $$\text{Baseline Bill} = \text{calculate\_bill}(C, P_{\text{sanctioned}}, \text{TariffSchedule})$$
  $$\text{Target Bill} = \text{calculate\_bill}(S_{\text{threshold}}, P_{\text{sanctioned}}, \text{TariffSchedule})$$
  $$\text{Monthly Cost Savings} = \text{Baseline.net\_bill\_inr} - \text{Target.net\_bill\_inr}$$
  $$\text{Annual Cost Savings} = \text{Monthly Cost Savings} \times 12.0$$
- **Tariff Example (BESCOM LT-2a Domestic)**:
  - Slabs: $0 - 100\text{ kWh} @ ₹4.75/\text{kWh}$; $> 100\text{ kWh} @ ₹7.00/\text{kWh}$. Tax: $9\%$. Fixed: ₹70/kW.
  - For $C = 115\text{ kWh}$, $P = 3\text{ kW}$:
    - Baseline Bill: Fixed (₹210) + Energy ($100 \times 4.75 + 15 \times 7.00 = ₹580$) + Tax ($9\% \times 580 = ₹52.20$) = **₹842.20**.
    - Target Bill ($100\text{ kWh}$): Fixed (₹210) + Energy ($100 \times 4.75 = ₹475$) + Tax ($9\% \times 475 = ₹42.75$) = **₹727.75**.
    - **Exact Monthly Savings**: $₹842.20 - ₹727.75 =$ **₹114.45/month** (₹1,373.40/year).

---

### 2.2. Sanctioned Connected Load Realignment (`RULE-LOAD-01`)
- **Objective**: Realize fixed charge savings when a consumer's peak monthly consumption indicates significant connected load over-provisioning.
- **Trigger**: $\max(C_{\text{historical}}) < 220\text{ kWh}$ and $P_{\text{sanctioned}} \ge 4.0\text{ kW}$.
- **Formula**:
  $$P_{\text{optimized}} = \max\left(2.0, P_{\text{sanctioned}} - 2.0\right)$$
  $$\Delta P = P_{\text{sanctioned}} - P_{\text{optimized}}$$
  $$\text{Monthly Fixed Savings} = \Delta P \times R_{\text{fixed\_per\_kw}}$$
  $$\text{Annual Fixed Savings} = \text{Monthly Fixed Savings} \times 12.0$$
- **Tariff Example (BESCOM LT-2a)**:
  - $P_{\text{sanctioned}} = 6\text{ kW} \rightarrow P_{\text{optimized}} = 4\text{ kW}$ ($\Delta P = 2\text{ kW}$).
  - Fixed charge rate = ₹70/kW/month.
  - **Monthly Savings**: $2\text{ kW} \times ₹70 = \mathbf{₹140.00/\text{month}}$ (**₹1,680.00/year**).

---

### 2.3. Rooftop Solar PV Sizing & PM Surya Ghar Subsidy (`RULE-SOLAR-01`)
- **Objective**: Size rooftop solar PV to offset $\approx 75\%$ of annual electricity consumption, capped by state net-metering limits.
- **Sizing Formula**:
  $$P_{\text{target\_kwp}} = \frac{C_{\text{annual}} \times 0.75}{Y_{\text{specific}}}$$
  $$P_{\text{recommended}} = \min\left(P_{\text{sanctioned}} \times \frac{\text{MaxLoadPct}}{100}, P_{\text{target\_kwp}}\right)$$
  where specific yield $Y_{\text{specific}} \approx 1,450\text{ kWh/kWp/year}$ (verified southern India solar insolation from NASA POWER / Open-Meteo).
- **PM Surya Ghar CFA Subsidy Formula (`pm_surya_ghar.json`)**:
  $$\text{Subsidy}(\text{kWp}) = \min\left(78000, \sum_{\text{tier}} \Delta \text{kWp}_{\text{tier}} \times R_{\text{tier}}\right)$$
  - Up to $2\text{ kWp}$: ₹30,000 per kW.
  - $2\text{ kWp}$ to $3\text{ kWp}$: ₹18,000 per kW.
  - Systems $\ge 3\text{ kWp}$: Capped at ₹78,000.
- **Financial Payback Formula**:
  $$\text{Gross Capital Cost} = P_{\text{recommended}} \times ₹55,000/\text{kWp}$$
  $$\text{Net Capital Cost} = \text{Gross Capital Cost} - \text{Subsidy}$$
  $$\text{Annual Bill Savings} = 12 \times \left( \text{Bill}(C_{\text{monthly}}) - \text{Bill}(\max(0, C_{\text{monthly}} - G_{\text{monthly}}), \text{Export}=\max(0, G_{\text{monthly}} - C_{\text{monthly}})) \right)$$
  $$\text{Simple Payback (Years)} = \frac{\text{Net Capital Cost}}{\text{Annual Bill Savings}}$$

---

### 2.4. Air Conditioner Thermostat Setpoint Tuning (`RULE-AC-01`)
- **Objective**: Evaluate energy and cost reductions from raising AC thermostat setpoints (e.g. $20^\circ\text{C} \rightarrow 24^\circ\text{C}$).
- **Formula (Bureau of Energy Efficiency Standard)**:
  $$\Delta T = T_{\text{target}} - T_{\text{current}} = 24.0 - T_{\text{current}}$$
  $$\text{Savings Fraction} = \Delta T \times 0.06 \quad (6\% \text{ per } 1^\circ\text{C increase})$$
  $$E_{\text{daily\_kwh}} = \left(\frac{P_{\text{rated\_w}}}{1000}\right) \times H_{\text{daily}} \times \text{DutyCycleFactor} \quad (\text{DutyCycle} \approx 0.70)$$
  $$\Delta E_{\text{month}} = E_{\text{daily\_kwh}} \times 30 \times \text{Savings Fraction}$$
  $$\text{Monthly Cost Savings} = \Delta E_{\text{month}} \times R_{\text{marginal\_top\_slab}} \times (1 + \text{TaxRatePct}/100)$$
- **Example Calculation**:
  - $1,500\text{ W}$ AC running $8\text{ hrs/day}$, setpoint raised $20^\circ\text{C} \rightarrow 24^\circ\text{C}$ ($\Delta T = 4^\circ\text{C}$).
  - Savings Fraction = $4 \times 0.06 = 0.24$ ($24\%$).
  - Baseline Monthly AC Energy = $1.5 \times 8 \times 0.70 \times 30 = 252.0\text{ kWh/month}$.
  - **Energy Saved**: $252.0 \times 0.24 = \mathbf{60.48\text{ kWh/month}}$ ($725.76\text{ kWh/year}$).
  - In BESCOM ($₹7.00 + 9\% = ₹7.63/\text{kWh}$): **₹461.46/month** (**₹5,537.52/year**).

---

### 2.5. Solar Battery Dispatch Arbitrage (`RULE-BATTERY-01`)
- **Objective**: Monetize the tariff spread between grid import costs and solar net-metering feed-in credits by storing midday solar export in an existing battery for evening peak self-consumption.
- **Formula**:
  $$E_{\text{shiftable}} = \min\left(E_{\text{grid\_export\_month}}, P_{\text{battery\_kwh}} \times \text{DoD} \times 30\right) \quad (\text{DoD} = 85\%)$$
  $$R_{\text{spread}} = R_{\text{import\_top\_slab\_with\_tax}} - R_{\text{export\_feed\_in}}$$
  $$\text{Monthly Arbitrage Savings} = E_{\text{shiftable}} \times R_{\text{spread}}$$
  $$\text{Annual Arbitrage Savings} = \text{Monthly Arbitrage Savings} \times 12.0$$
- **Example (Home A Bengaluru)**:
  - Export: $245.0\text{ kWh/month}$. Battery: $7.2\text{ kWh}$ ($6.12\text{ kWh/day} \times 30 = 183.6\text{ kWh/month}$).
  - $E_{\text{shiftable}} = \min(245.0, 183.6) = 183.6\text{ kWh/month}$.
  - Avoided import: ₹7.63/kWh. Export credit: ₹3.10/kWh. Net spread = **₹4.53/kWh**.
  - **Monthly Savings**: $183.6 \times 4.53 = \mathbf{₹831.71/\text{month}}$ (**₹9,980.50/year**).

---

## 3. Anti-Double-Counting Guard Architecture

When a consumer considers multiple recommendations, summing independent savings claims leads to **phantom savings** where the total claimed reduction exceeds the physical bill. UrjaSetu EMS implements the **Sequential Marginal Evaluation Engine**:

```
[ Baseline Consumption: C0 ] ──────── Baseline Bill B0 = calculate_bill(C0)
             │
             ▼
[ Action 1: Energy Conservation (ΔC1) ] ── New C1 = max(0, C0 - ΔC1)
             │                             Marginal Savings S1 = B0 - calculate_bill(C1)
             ▼
[ Action 2: Secondary Efficiency (ΔC2) ] ─ New C2 = max(0, C1 - ΔC2)
             │                             Marginal Savings S2 = calculate_bill(C1) - calculate_bill(C2)
             ▼
[ Action 3: Solar Generation (GSolar) ] ── Net Import C3 = max(0, C2 - GSolar)
             │                             Marginal Savings S3 = calculate_bill(C2) - calculate_bill(C3, Export)
             ▼
[ Action 4: Fixed Charge Realignment ] ── Fixed Demand Savings S4 = ΔP * FixedRate * 12
             │
             ▼
Total Unduplicated Savings: S_total = S1 + S2 + S3 + S4 <= B0_annual
```

### Mathematical Guarantee:
$$S_{\text{unduplicated}} \le \sum_{i} S_{\text{independent}, i} \quad \text{and} \quad S_{\text{unduplicated}} \le B_{\text{baseline\_annual}}$$
This ensures that estimated cost savings never exceed the baseline utility bill and never double-count overlapping kilowatt-hours.
