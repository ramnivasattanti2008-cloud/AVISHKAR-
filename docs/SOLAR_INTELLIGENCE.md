# Solar Intelligence & Generation Mix Specification — UrjaSetu EMS

## 1. Solar Intelligence Engine Overview

The Solar Intelligence Engine (`src/avishkar_ems/solar_intel.py`) processes official monthly renewable energy observations published by the Ministry of New and Renewable Energy (MNRE) and the Central Electricity Authority (CEA).

### 1.1 Strict Separation of Capacity and Generation

> [!CRITICAL]
> **Installed Capacity (MW)** represents the instantaneous nameplate power rating of connected solar PV installations. **Solar Generation (MU)** represents the actual cumulative energy delivered over the calendar month.
> Capacity and Generation must never be plotted on a single combined y-axis or subtracted from one another.

### 1.2 Solar Generation Share
$$\text{Solar Share (\%)} = \frac{\text{Solar Generation (MU)}}{\text{Total Generation (MU)}} \times 100$$
- Validated via `MetricSemanticsRegistry.assert_compatible_for_ratio`.
- If total generation is zero or missing, the calculation returns `None` and an explicit note.

### 1.3 Monthly Capacity Utilization Factor (CUF)
$$\text{CUF (\%)} = \frac{\text{Solar Generation (MU)} \times 1,000\text{ MWh/MU}}{\text{Installed Capacity (MW)} \times \text{Hours in Month}} \times 100$$
- **Calendar Hours**: Computed dynamically using the exact number of calendar days in the month ($28, 29, 30, \text{or } 31 \times 24\text{ hours}$).
- For example, April (30 days = 720 hours) for a $9,450\text{ MW}$ installation producing $1,380\text{ MU}$ yields:
  $$\text{CUF} = \frac{1,380,000}{9,450 \times 720} \times 100 \approx 20.28\%$$

### 1.4 Central Electricity Authority (CEA) Hydro Classification

The engine implements official Indian grid reporting standards:
- **Small Hydro ($\le 25\text{ MW}$)**: Classified under **Renewable Energy Sources (RES)** alongside Solar, Wind, and Biomass.
- **Large Hydro ($> 25\text{ MW}$)**: Reported separately under conventional utility generation in CEA monthly power summaries.

### 1.5 Prohibition of Synthetic Hourly Disaggregation

```python
solar_engine.refuse_hourly_synthesis(requested_frequency="HOURLY", observation_frequency="MONTHLY")
```
Disaggregating monthly energy totals into synthetic 24-hour diurnal solar curves is strictly prohibited by our data-honesty invariant.

---

## 2. Multi-Fuel Generation Mix Engine

The `GenerationMixEngine` (`src/avishkar_ems/generation_mix.py`) evaluates generation shares across categories:
1. **Solar PV**: Grid-connected utility and registered rooftop installations.
2. **Other Renewables (RES)**: Wind, Biomass, Bagasse, and Small Hydro ($\le 25\text{ MW}$).
3. **Conventional**: Baseload Thermal (Coal, Lignite, Gas), Nuclear, and Large Hydro ($> 25\text{ MW}$).

### Generation Share vs. Capacity Share
Capacity shares do not equal generation shares due to fuel-specific availability and capacity factors (e.g. thermal base-load vs solar daytime-only generation). UrjaSetu displays capacity mix and generation mix in separate components.
