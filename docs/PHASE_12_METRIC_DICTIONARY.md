# UrjaSetu EMS — Phase 12 Metric Dictionary & Semantics Specification

> **Standard**: Authoritative Data Dictionary & Dimensional Semantics  
> **Status**: Verified & Enforced  
> **Author**: UrjaSetu Systems Architecture & Engineering  
> **Audit Date**: 2026-10-24  

---

## 1. Dimensional Distinctions & Semantic Taxonomy

A primary failure mode in energy analytics is conflating instantaneous power (MW) with cumulative electrical energy (MU), or equating installed equipment capacity with actual electrical generation. UrjaSetu EMS enforces semantic distinctions codified in `src/avishkar_ems/metric_semantics.py` and validated by `CommandCenterService`.

| Category | Fundamental Unit | Physical Dimension | Definition & Operational Meaning |
| :--- | :--- | :--- | :--- |
| **Instantaneous Power / Demand** | $\text{MW}$ | $\text{Energy} / \text{Time}$ ($10^6\text{ W}$) | The instantaneous rate of electrical energy transfer met by the grid at system peak. |
| **Installed Capacity** | $\text{MW}$ | $\text{Nameplate Power}$ ($10^6\text{ W}$) | Rated maximum continuous generator output under standard test conditions. |
| **Electrical Energy** | $\text{MU}$ ($\text{GWh}$) | $\text{Work / Energy}$ ($10^6\text{ kWh}$) | Cumulative electrical energy produced, supplied, or consumed over a defined interval. |
| **Energy Insolation** | $\text{kWh/m}^2/\text{day}$ | $\text{Surface Energy}$ | Solar radiation energy incident per square meter per day. |
| **Solar Irradiance** | $\text{W/m}^2$ | $\text{Surface Power}$ | Instantaneous power of solar electromagnetic radiation incident per square meter. |
| **Dimensionless Ratio** | $\%$ | Ratio | Dimensionless proportion requiring dimensionally and geographically compatible numerator and denominator. |

---

## 2. Metric Specifications

### M-101: Peak Demand Met
- **Business Meaning**: The maximum instantaneous electrical power delivered across the grid transmission network during the peak coincident interval of the reporting period.
- **Formula / Query**: $\max_{t \in \text{period}} P_{\text{instantaneous}}(t)$ as reported by statutory grid operators (CEA / POSOCO / SLDC).
- **Input Dataset**: CEA Executive Summaries; POSOCO Monthly Operational Outturn; SLDC Operational Reports.
- **Unit**: Megawatts ($\text{MW}$).
- **Geographic Scope**: National (`IN`), Regional Grids (`SR`, `WR`, `NR`, `ER`, `NER`), State (`KA`, `AP`).
- **Observation / Reporting Period**: Monthly coincident peak (`YYYY-MM`) or Daily instantaneous peak.
- **Data Freshness**: T+15 to T+30 days following month close.
- **Source & Provenance**: Verified statutory filings; priority-100 authoritative ingestion.
- **Missing-Data Behavior**: Not disaggregated down to district boundaries (`AntiDisaggregationGuard`). If missing, labeled `UNAVAILABLE`.
- **Applicable Limitations**: Measures grid transmission peak met; does not include unserved captive off-grid generation.

---

### M-102: Electricity Energy Requirement
- **Business Meaning**: Total electrical energy required by all consumers across a territory before grid transmission or distribution deficits.
- **Formula / Query**: $E_{\text{requirement}} = E_{\text{supplied}} + E_{\text{unserved\_deficit}}$
- **Input Dataset**: CEA Monthly Load Generation Balance Reports (LGBR).
- **Unit**: Million Units ($\text{MU}$), where $1\text{ MU} = 1\text{ GWh} = 10^6\text{ kWh}$.
- **Geographic Scope**: National (`IN`), State (`KA`, `AP`).
- **Observation / Reporting Period**: Calendar Month (`YYYY-MM`).
- **Data Freshness**: T+25 days following calendar month.
- **Source & Provenance**: Statutory utility reporting to Central Electricity Authority.
- **Missing-Data Behavior**: Labeled `UNAVAILABLE` when unserved load data is not recorded.
- **Applicable Limitations**: Relies on state distribution companies declaring true unserved demand rather than unannounced load curtailments.

---

### M-103: Electricity Energy Supplied / Availability
- **Business Meaning**: Net electrical energy delivered to consumer distribution boundaries through the transmission grid.
- **Formula / Query**: $\sum_{t=1}^{N} E_{\text{net\_delivered}}(t)$
- **Input Dataset**: CEA Monthly Executive Summaries; APSLDC Monthly Generation & Inflow Reports; BESCOM Operational CSVs.
- **Unit**: Million Units ($\text{MU}$).
- **Geographic Scope**: National (`IN`), State (`KA`, `AP`), Discom (`KA_BESCOM`).
- **Observation / Reporting Period**: Monthly (`YYYY-MM`) or Annual FY.
- **Data Freshness**: T+20 days for state-level outturn; T+45 days for utility-level auditable logs.
- **Source & Provenance**: CEA / SLDC statutory releases; cryptographically hashed records.
- **Missing-Data Behavior**: Marked `MISSING` if SLDC has not published reconciled figures.
- **Applicable Limitations**: Distinct from retail billed consumption, as it includes distribution and technical losses.

---

### M-104: Installed Solar Capacity
- **Business Meaning**: Cumulative rated nameplate capacity of all commissioned grid-scale ground-mounted and authorized rooftop solar photovoltaic installations.
- **Formula / Query**: $\sum_{i \in \text{commissioned}} P_{\text{nameplate\_dc\_mw}}(i)$
- **Input Dataset**: Ministry of New and Renewable Energy (MNRE); CEA Installed Capacity Reports.
- **Unit**: Megawatts ($\text{MW}$).
- **Geographic Scope**: National (`IN`), State (`KA`, `AP`, `RJ`, `GJ`, `TN`, `MH`, `UP`).
- **Observation / Reporting Period**: As of month close (`YYYY-MM`).
- **Data Freshness**: T+30 days.
- **Source & Provenance**: CEA / MNRE Monthly Physical Progress Reports.
- **Missing-Data Behavior**: Preserves previous verified cumulative capacity; never inferred from solar generation figures.
- **Applicable Limitations**: Represents nameplate DC/AC rating, not instantaneous generation.

---

### M-105: Solar Energy Generation
- **Business Meaning**: Cumulative gross electrical energy generated by grid-connected solar photovoltaic power plants.
- **Formula / Query**: $\int_{\text{period}} P_{\text{solar}}(t) dt$
- **Input Dataset**: CEA Monthly Generation Reports (Renewable Energy Sources Section).
- **Unit**: Million Units ($\text{MU}$).
- **Geographic Scope**: National (`IN`), State (`KA`, `AP`).
- **Observation / Reporting Period**: Calendar Month (`YYYY-MM`).
- **Data Freshness**: T+30 days.
- **Source & Provenance**: CEA Operational RE Statistics.
- **Missing-Data Behavior**: Strictly unavailable at district level without dedicated substation meter telemetry (`AntiDisaggregationGuard`).
- **Applicable Limitations**: Does not include unregistered off-grid agricultural solar pumps.

---

### M-106: Total Renewable Generation
- **Business Meaning**: Cumulative gross generation from all statutory Renewable Energy Sources (RES).
- **Formula / Query**: $E_{\text{RE}} = E_{\text{Solar}} + E_{\text{Wind}} + E_{\text{Biomass}} + E_{\text{SmallHydro\_}\le 25\text{MW}}$
- **Input Dataset**: CEA Renewable Generation Reports.
- **Unit**: Million Units ($\text{MU}$).
- **Geographic Scope**: National (`IN`), State (`KA`, `AP`).
- **Observation / Reporting Period**: Calendar Month (`YYYY-MM`).
- **Data Freshness**: T+30 days.
- **Source & Provenance**: CEA RES Division.
- **Missing-Data Behavior**: Labeled `UNAVAILABLE` for territories lacking unified RE monitoring centers.
- **Applicable Limitations**: CEA Standard: Hydro installations $> 25\text{ MW}$ are statutory conventional utilities, not RES.

---

### M-107: Renewable Generation Share
- **Business Meaning**: The proportion of total gross electrical generation produced by renewable sources within the same territorial boundary over the identical reporting interval.
- **Formula / Query**: $\text{RE Share} = \left( \frac{E_{\text{Renewable}}(\text{MU})}{E_{\text{Total Gross Generation}}(\text{MU})} \right) \times 100$
- **Input Dataset**: CEA Generation Mix and Renewable Outturn Reports.
- **Unit**: Percentage ($\%$).
- **Geographic Scope**: National (`IN`), State (`KA`, `AP`).
- **Observation / Reporting Period**: Calendar Month (`YYYY-MM`).
- **Data Freshness**: T+30 days.
- **Source & Provenance**: Deterministic calculation in `GenerationMixEngine` / `SolarIntelligenceEngine`.
- **Missing-Data Behavior**: Evaluates to `None` if total gross generation is zero or missing; never fabricated.
- **Applicable Limitations**: Strictly requires identical geographic boundaries for numerator and denominator (e.g. state RE divided by state gross generation, never district divided by state).

---

### M-108: Solar Capacity Utilization Factor (CUF)
- **Business Meaning**: The ratio of actual energy generated by solar plants to the theoretical energy that could have been produced if operating at rated nameplate capacity continuously for all hours in the month.
- **Formula / Query**: $\text{CUF}(\%) = \frac{E_{\text{solar}}(\text{MU}) \times 10^3}{P_{\text{installed\_mw}} \times (\text{DaysInMonth} \times 24)} \times 100$
- **Input Dataset**: CEA Monthly Solar Generation and Capacity Reports.
- **Unit**: Percentage ($\%$).
- **Geographic Scope**: National (`IN`), State (`KA`, `AP`).
- **Observation / Reporting Period**: Calendar Month (`YYYY-MM`).
- **Data Freshness**: T+30 days.
- **Source & Provenance**: Deterministic calculation in `SolarIntelligenceEngine.calculate_cuf()`.
- **Missing-Data Behavior**: Returns `None` if installed capacity is zero or unrecorded.
- **Applicable Limitations**: Fluctuates seasonally (higher in March–May, lower during monsoon in July–August).

---

### M-109: Peak Deficit Percentage
- **Business Meaning**: The proportion of peak electricity demand that could not be met due to generation shortages or transmission constraints.
- **Formula / Query**: $\text{Deficit}(\%) = \max\left(0, \frac{P_{\text{requirement}} - P_{\text{met}}}{P_{\text{requirement}}}\right) \times 100$
- **Input Dataset**: CEA Monthly LGBR.
- **Unit**: Percentage ($\%$).
- **Geographic Scope**: National (`IN`), State (`KA`, `AP`).
- **Observation / Reporting Period**: Calendar Month (`YYYY-MM`).
- **Data Freshness**: T+25 days.
- **Source & Provenance**: CEA Power Supply Position Reports.
- **Missing-Data Behavior**: Reported as `0.0%` when supply equals or exceeds peak requirement, or `UNAVAILABLE` when requirement is unrecorded.
- **Applicable Limitations**: Captures capacity adequacy at transmission interconnection; local distribution transformer overloads are not reflected.
