# Metric Semantics Layer Specification — UrjaSetu EMS

## 1. Executive Overview

The Metric Semantics Layer (`src/avishkar_ems/metric_semantics.py`) establishes the exact physical, geographic, temporal, and authority semantics for every electricity and solar metric in UrjaSetu EMS.

### Core Invariants

1. **Semantic Distinctness**: Two similarly named metrics are never automatically treated as equivalent.
2. **Physical Dimension Rigor**:
   - **Instantaneous Power (MW)**: Concurrent grid electrical rate at an instant.
   - **Cumulative Energy (MU, kWh)**: Total electrical work over a defined reporting interval ($1\text{ MU} = 1\text{ GWh} = 1,000,000\text{ kWh}$).
   - **Nameplate Installed Capacity (MW)**: Rated nominal power output of generation assets.
3. **Temporal Aggregation Invariant**:
   - Power readings (MW) **CANNOT** be aggregated using `SUM` over time periods. Attempting to sum power raises `MetricCompatibilityError`. Valid aggregation methods for power are `MAX` (peak demand) or `MEAN` (average load).
   - Energy readings (MU, kWh) use `SUM` for cumulative reporting periods (e.g. monthly to fiscal year totals).
   - Installed capacity (MW) uses `LATEST` (end-of-period active nameplate rating).
4. **Ratio & Share Invariant**:
   - Solar share is computed strictly as $\frac{\text{Solar Generation (MU)}}{\text{Total Generation (MU)}} \times 100$.
   - Capacity (MW) cannot be used as the denominator for generation share.

---

## 2. Canonical Metric Registry

| Metric ID | Display Name | Unit | Category | Cadence | Allowed Geo Levels | Aggregation Method | Source Authority |
|---|---|---|---|---|---|---|---|
| `ENERGY_REQUIREMENT` | Energy Requirement | MU | Energy | Monthly, Annual | National, State | `SUM` | CEA Power Supply Position |
| `ENERGY_SUPPLIED` | Energy Supplied | MU | Energy | Monthly, Annual | National, State | `SUM` | CEA Power Supply Position |
| `ENERGY_GAP` | Energy Balance Gap | MU | Energy | Monthly, Annual | National, State | `SUM` | UrjaSetu Analytics Engine |
| `GAP_PERCENTAGE` | Energy Gap Percentage | % | Percentage | Monthly, Annual | National, State | `WEIGHTED_AVG` | UrjaSetu Analytics Engine |
| `PEAK_DEMAND` | Maximum Peak Demand | MW | Power | Real-time, Monthly | National, State, Utility | `MAX` | CEA & State SLDCs |
| `PEAK_MET` | Peak Demand Met | MW | Power | Real-time, Monthly | National, State, Utility | `MAX` | CEA & State SLDCs |
| `INSTALLED_SOLAR_CAPACITY` | Installed Solar Capacity | MW | Capacity | Monthly, Annual | National, State, District | `LATEST` | MNRE & State Nodal Agencies |
| `SOLAR_GENERATION` | Solar Energy Generation | MU | Energy | Monthly, Annual | National, State | `SUM` | CEA Monthly RES Reports |
| `TOTAL_GENERATION` | Total Electricity Generation | MU | Energy | Monthly, Annual | National, State | `SUM` | CEA Executive Summary |
| `TOTAL_RENEWABLE_GENERATION` | Total Renewable Generation | MU | Energy | Monthly, Annual | National, State | `SUM` | CEA Monthly RES Reports |
| `SOLAR_SHARE_PERCENT` | Solar Generation Share | % | Percentage | Monthly, Annual | National, State | `WEIGHTED_AVG` | UrjaSetu Analytics Engine |
| `HOUSEHOLD_CONSUMPTION` | Household Billed Energy | kWh | Energy | 15-min, Daily, Monthly | Household | `SUM` | DISCOM Smart Meter / Bill |

---

## 3. Mathematical Compatibility Rules

### A. Subtraction Rule
$$\text{Difference} = M_A - M_B$$
- **Condition 1 (Dimension Matching)**: $\text{Category}(M_A) == \text{Category}(M_B)$
- **Condition 2 (Domain Matching)**: Both metrics must originate from compatible accounting boundaries (e.g. `CEA_GRID_BALANCE`).
- Subtraction across unrelated datasets (e.g. subtracting household smart meter imports from state grid requirement) is rejected by `MetricSemanticsRegistry.assert_compatible_for_subtraction`.

### B. Ratio Rule
$$\text{Ratio} = \frac{M_{\text{num}}}{M_{\text{den}}} \times 100$$
- **Condition 1**: Numerator and denominator must share physical dimension (both Energy in MU).
- **Condition 2**: The numerator must represent a physical subset of the denominator.
- Validated via `MetricSemanticsRegistry.assert_compatible_for_ratio`.

---

## 4. Error Handling and Diagnostics

When incompatible operations are attempted, the system raises `MetricCompatibilityError` with structured diagnostic attributes:
- `metric_a`: The first metric identifier.
- `metric_b`: The second metric identifier.
- `reason`: Precise physical or mathematical reason for incompatibility.
- `guidance`: Actionable remediation instructions for the caller.
