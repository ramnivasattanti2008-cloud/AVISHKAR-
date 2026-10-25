# Electricity Balance & Demand Intelligence — UrjaSetu EMS

## 1. Energy Balance Analysis Framework

The Electricity Balance Analysis module (`src/avishkar_ems/energy_balance.py`) processes verified monthly power supply position observations published by the Central Electricity Authority (CEA).

### 1.1 Mathematical Formulation

$$\text{Energy Gap (MU)} = \text{Energy Requirement (MU)} - \text{Energy Supplied (MU)}$$

$$\text{Gap Percentage (\%)} = \frac{\text{Energy Requirement} - \text{Energy Supplied}}{\text{Energy Requirement}} \times 100$$

### 1.2 Interpretation Standards

- **Positive Gap ($\text{Gap} > 0$)**: Reported requirement exceeds reported supply. The system flags this as `DEFICIT`.
- **Zero Gap ($\text{Gap} \approx 0$)**: Supply matches requirement within $\pm 0.01\text{ MU}$. The system flags this as `BALANCED`.
- **Negative Gap ($\text{Gap} < 0$)**: Supply exceeds requirement. The system flags this as `SURPLUS`.

### 1.3 Strict Invariant: Non-Outage Interpretation Caveat

> [!IMPORTANT]
> The energy gap is a **reporting-period accounting difference** between aggregate utility requirement and contracted dispatch reported to the CEA. It is **NOT** a direct measurement of localized feeder trips, 11kV/415V transformer failures, or frequency excursions.

### 1.4 Cumulative Fiscal Year Balance (April to March)

The fiscal year cumulative balance (`calculate_fiscal_year_balance`) aggregates 12 consecutive calendar months from April ($M_{04}$) to March ($M_{03}$):
- Cumulative Energy Requirement ($\text{MU}$): $\sum_{m=1}^{12} \text{Requirement}_m$ (`AggregationMethod.SUM`)
- Cumulative Energy Supplied ($\text{MU}$): $\sum_{m=1}^{12} \text{Supplied}_m$ (`AggregationMethod.SUM`)
- Annual Peak Demand ($\text{MW}$): $\max_{m=1}^{12} (\text{PeakDemand}_m)$ (`AggregationMethod.MAX`)

---

## 2. Time-Series Trends Engine

The `TimeSeriesTrendsEngine` (`src/avishkar_ems/time_series_trends.py`) provides mathematically verified trend analytics:

### 2.1 Month-over-Month (MoM) Growth
$$\Delta_{\text{MoM}} = V_t - V_{t-1}, \quad \%_{\text{MoM}} = \frac{V_t - V_{t-1}}{V_{t-1}} \times 100$$
- If baseline $V_{t-1} = 0$, percentage change is reported as `None` with an explicit mathematical note.
- If $V_{t-1} < 0$, percentage change is omitted to prevent sign ambiguity.

### 2.2 Year-over-Year (YoY) Growth
$$\Delta_{\text{YoY}} = V_{y, m} - V_{y-1, m}, \quad \%_{\text{YoY}} = \frac{V_{y, m} - V_{y-1, m}}{V_{y-1, m}} \times 100$$
- Compares identical calendar months across consecutive years, neutralizing annual seasonal variations.

### 2.3 Partial Period Comparability
If one period is marked `is_partial = True` (e.g. mid-month report), the comparison is flagged with `is_comparable = False` and an advisory note requiring daily average normalization.

### 2.4 Trailing Rolling Averages
$$\bar{V}_{t, k} = \frac{1}{k} \sum_{i=0}^{k-1} V_{t-i}$$
- Preserves missing periods rather than fabricating synthetic zeroes.

### 2.5 12-Month Seasonal Pattern Index
$$\text{Index}_m = \frac{\bar{V}_m}{\bar{V}_{\text{annual}}}$$
- Evaluates monthly factors relative to the baseline annual mean ($1.0$).
- Identifies summer peak demand months (March–May in Southern regional grids) and monsoon troughs (July–August).
