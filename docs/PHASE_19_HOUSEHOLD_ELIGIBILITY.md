# UrjaSetu EMS Phase 19: Household-Level Policy Eligibility & Impact Assessment

## 1. Overview & Objective

Macro-level energy policies produce genuine decarbonization only when translated into actionable household decisions. The **HouseholdPolicyAssessor** module calculates the exact statutory financial assistance, physical system sizing constraints, Discom net-metering caps, and CO2 abatement potential for any registered residential consumer.

---

## 2. Statutory CFA Subsidy Sizing Tiers (PM Surya Ghar: Muft Bijli Yojana)

Under MNRE Gazette Notification No. 318/38/2024-GCRT, the Central Financial Assistance (CFA) for residential consumers is calculated using a non-linear, tiered schedule:

| System Capacity ($C_{\text{kWp}}$) | Statutory CFA Subsidy Formula | Maximum Subsidy Payable |
| :--- | :--- | :--- |
| $C \le 0.0\text{ kWp}$ | ₹0 | ₹0 |
| $0 < C \le 2.0\text{ kWp}$ | $C \times ₹30,000$ | ₹60,000 |
| $2.0 < C < 3.0\text{ kWp}$ | ₹60,000 + $(C - 2.0) \times ₹18,000$ | < ₹78,000 |
| $C \ge 3.0\text{ kWp}$ | Capped at ₹78,000 | **₹78,000** |

### Mathematical Edge-Cases
- A 1.0 kW system receives exactly $1.0 \times 30,000 = ₹30,000$.
- A 2.0 kW system receives exactly $2.0 \times 30,000 = ₹60,000$.
- A 2.5 kW system receives $60,000 + 0.5 \times 18,000 = ₹69,000$.
- A 3.0 kW system receives $60,000 + 1.0 \times 18,000 = ₹78,000$.
- A 5.0 kW or 10.0 kW system receives exactly **₹78,000** (statutory residential cap).
- Systems larger than 10 kW (or commercial/industrial installations) do not receive additional residential CFA.

---

## 3. Physical & Regulatory Constraint Enforcement

The assessor does not assume arbitrary system sizes. It evaluates three binding real-world constraints:

### 1. Physical Rooftop Area Constraint
Solar PV panels require unshaded physical space. The assessor enforces standard solar engineering geometry:
$$\text{Area Requirement} = 10.0\text{ m}^2 \text{ per kWp}$$
$$\text{Max Capacity}_{\text{rooftop}} = \frac{\text{Unshaded Rooftop Area (m}^2\text{)}}{10.0}$$

### 2. Discom Sanctioned Load Constraint
State Electricity Regulatory Commissions (SERCs) stipulate that grid-interactive domestic solar capacity cannot exceed the consumer's sanctioned connected load:
$$\text{Max Capacity}_{\text{load}} = 1.00 \times \text{Sanctioned Connected Load (kW)}$$

### 3. State Net-Metering Ceilings
Under KERC (Karnataka) and APERC (Andhra Pradesh) regulations:
- LT domestic net-metering is capped at 10 kW in Karnataka (systems above 10 kW require gross-metering arrangements).
- Systems above 100% of sanctioned load require an official load enhancement application to the local Discom (BESCOM, HESCOM, APCPDCL) prior to bidirectional meter approval.

### 4. Binding Recommended Sizing
The final recommended system capacity is determined by the minimum of physical rooftop capacity and sanctioned load:
$$C_{\text{recommended}} = \min(\text{Max Capacity}_{\text{rooftop}}, \text{Max Capacity}_{\text{load}})$$

---

## 4. Environmental Decarbonization & CO2 Mitigation

To ensure data honesty, the module rejects unverified, arbitrary carbon multipliers. All avoided emissions are calculated using the official Central Electricity Authority (CEA) Baseline Database for the Indian Power Sector:

$$\text{Statutory Factor: } \mathbf{0.716\text{ kg CO}_2/\text{kWh}} \quad (\text{Central Electricity Authority, Version 19, 2024})$$

### Annual Energy Yield & Abatement Formula
Assuming standard tropical solar insolation in peninsular India ($1,400\text{ kWh/kWp/year}$):
$$\text{Annual Generation (kWh)} = C_{\text{recommended}} \times 1,400\text{ kWh/kWp}$$
$$\text{Annual Avoided CO}_2\text{ (kg)} = \text{Annual Generation (kWh)} \times 0.716\text{ kg CO}_2/\text{kWh}$$
$$\text{Annual Avoided CO}_2\text{ (Tonnes)} = \frac{\text{Annual Avoided CO}_2\text{ (kg)}}{1,000.0}$$

### Worked Example: 3 kW System
- Annual Generation: $3.0 \times 1,400 = 4,200\text{ kWh/year}$.
- Avoided $\text{CO}_2$: $4,200 \times 0.716 = 3,007.2\text{ kg CO}_2/\text{year}$ ($3.01\text{ Tonnes CO}_2/\text{year}$).
- 25-Year Lifetime Mitigation: $75.18\text{ Tonnes CO}_2$.

---

## 5. Mandatory Statutory Disclaimers

The system automatically appends the following statutory disclaimers to every household assessment:
1. *Subsidies are disbursed directly by MNRE through the National Portal into the beneficiary's Aadhaar-linked bank account upon physical Discom inspection and bidirectional meter commissioning.*
2. *System sizing exceeding 100% of sanctioned load requires an approved Load Enhancement application with the local distribution utility prior to installation.*
3. *Net-metering energy banking rules and settlement tariffs are subject to periodic SERC tariff orders.*
