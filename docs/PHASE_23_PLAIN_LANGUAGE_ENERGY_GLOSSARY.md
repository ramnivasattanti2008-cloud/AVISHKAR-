# UrjaSetu EMS — Phase 23: Plain-Language Energy Terminology Glossary

**Document Version:** 1.0.0  
**Phase:** 23 — Accessibility, Usability & Operational Support  
**Audience:** Residential Consumers, Prosumers, Support Representatives & Policy Analysts  

---

## 1. Purpose of the Plain-Language Glossary

Energy management systems often overwhelm residential users with technical abbreviations, physics equations, and utility billing jargon.

The UrjaSetu **Plain-Language Energy Glossary** provides clear, empathetic, and relatable explanations for everyday energy concepts without sacrificing mathematical or engineering rigor.

---

## 2. Core Energy Terms & Consumer Explanations

### 1. Kilowatt-hour (kWh)
- **Abbreviation**: `kWh` (commonly referred to as an electricity *"Unit"*).
- **Plain Language**: The fundamental unit of electricity consumption. One kilowatt-hour equals using 1,000 watts of electrical power continuously for one full hour.
- **Consumer Example**: Running a 1,000-watt electric iron for 1 hour or a 100-watt television for 10 hours uses exactly 1 kWh (1 unit).
- **Technical Nuance**: $1\text{ kWh} = 3.6\text{ Megajoules (MJ)}$. Utility invoices bill consumption on a per-kWh rate.
- **Category**: `METRICS`

---

### 2. Kilowatt (kW / Connected Load)
- **Abbreviation**: `kW` (Sanctioned Load).
- **Plain Language**: The rate at which electricity is being drawn from the grid at any single instant. It measures demand capacity, not cumulative energy over time.
- **Consumer Example**: Turning on two 1.5-ton air conditioners simultaneously demands about 3.0 kW of electric power instantly.
- **Technical Nuance**: $1\text{ kW} = 1,000\text{ Watts} = 1,000\text{ Joules/second}$. Determines the monthly fixed demand charge on utility bills.
- **Category**: `METRICS`

---

### 3. Peak Demand
- **Abbreviation**: `kW (Max)`
- **Plain Language**: The single highest electrical load recorded by your meter during any 15-minute interval in a billing month.
- **Consumer Example**: If your household turns on the electric oven, water heater, and washing machine at the exact same moment, your peak demand spikes for that hour.
- **Technical Nuance**: Exceeding your sanctioned contract load triggers penal demand surcharges under state electricity regulatory commission rules.
- **Category**: `METRICS`

---

### 4. Telescopic Tariff Slab
- **Abbreviation**: `Slab`
- **Plain Language**: A progressive pricing structure where electricity rates increase in tiers as you use more energy during the billing cycle.
- **Consumer Example**: Under BESCOM LT-2(a), your first 100 units cost ₹4.75 each; every unit above 100 costs ₹7.00 each. If you use 150 units, only the last 50 units are charged at ₹7.00.
- **Technical Nuance**: Telescopic slabs bill only incremental units at the higher tier, protecting baseline essential consumption.
- **Category**: `TARIFFS`

---

### 5. Time-of-Use Tariff (ToU / ToD)
- **Abbreviation**: `ToU`
- **Plain Language**: Dynamic electricity pricing that changes based on the time of day, making power cheaper during solar/night hours and more expensive during evening peak hours.
- **Consumer Example**: Shifting washing machine cycles from 7:00 PM (evening peak) to 11:00 AM (solar off-peak) lowers energy bills.
- **Technical Nuance**: Reflects the marginal cost of grid dispatch during daily peak ramp hours (typically 18:00–22:00 in India).
- **Category**: `TARIFFS`

---

### 6. PM Surya Ghar CFA Subsidy
- **Abbreviation**: `CFA` (Central Financial Assistance)
- **Plain Language**: Direct government financial grants provided by the Ministry of New and Renewable Energy (MNRE) to reduce rooftop solar installation costs for residential homes.
- **Consumer Example**: A 1 kWp system receives ₹30,000 direct subsidy; a 2 kWp system receives ₹60,000; and a 3 kWp or larger system receives the maximum cap of ₹78,000.
- **Technical Nuance**: Governed by MNRE 2024 Gazette Guidelines; requires installation via approved vendors registered on pmsuryaghar.gov.in.
- **Category**: `POLICY`

---

### 7. Capacity Utilization Factor (CUF)
- **Abbreviation**: `CUF`
- **Plain Language**: The ratio of actual solar electricity generated over a period compared to the maximum theoretical electricity the panels could produce if the sun shone at peak intensity 24 hours a day.
- **Consumer Example**: In South India, a well-maintained residential solar installation achieves a monthly CUF of 18% to 22% due to nighttime and seasonal clouds.
- **Technical Nuance**: $\text{CUF} = \frac{\text{Total Generation (kWh)}}{\text{Capacity (kW)} \times \text{Total Period Hours}}$.
- **Category**: `SOLAR`

---

### 8. Grid Emissions Factor (Carbon Footprint)
- **Abbreviation**: `kg CO2 / kWh`
- **Plain Language**: The average amount of greenhouse gas emissions released by power plants to generate one unit of grid electricity in India.
- **Consumer Example**: Consuming 100 kWh of grid electricity generates approximately 71.6 kg of carbon dioxide.
- **Technical Nuance**: Sourced directly from Central Electricity Authority (CEA) Baseline Database Version 19.0 ($0.716\text{ kg CO}_2/\text{kWh}$).
- **Category**: `PHYSICS`

---

### 9. Solar Self-Consumption vs Gross Export
- **Plain Language**:
  - **Self-Consumption**: Solar electricity used immediately inside your home by running appliances while the sun is shining.
  - **Grid Export**: Surplus solar electricity sent back into the utility grid through your net meter.
- **Consumer Example**: If your solar panels generate 15 units today and your home uses 10 units during the daytime, you self-consumed 10 units and exported 5 units to the grid.
- **Category**: `SOLAR`

---

### 10. Data Freshness & Provenance
- **Plain Language**: Clear, honest labeling showing where every number came from (your actual meter, an uploaded bill, a weather satellite, or a computer simulation) and how recently it was recorded.
- **Consumer Example**: An indicator reading `MEASURED (T-1h)` means the data came from your physical smart meter 1 hour ago. An indicator reading `SIMULATED` is a what-if calculation.
- **Category**: `POLICY`
