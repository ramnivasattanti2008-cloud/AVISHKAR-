# UrjaSetu EMS Phase 19: Quantitative Policy Targets & Run-Rate Progress Engine

## 1. Mathematical Formulation & Run-Rate Principles

Public policy declarations frequently cite ambitious long-term goals without transparent, empirical evaluation of interim progress. The UrjaSetu **PolicyProgressEngine** implements a closed-form, deterministic run-rate tracking methodology that compares real-world achievements against expected linear trajectory baselines.

### Variables & Inputs
- $V_{\text{base}}$: Baseline metric value recorded at baseline date $T_{\text{base}}$.
- $V_{\text{target}}$: Target metric value mandated to be reached by target date $T_{\text{target}}$.
- $V_{\text{achieved}}$: Real-world empirical progress recorded at observation date $T_{\text{obs}}$.
- $T_{\text{obs}}$: Current timestamp of assessment (defaults to UTC now).

### 1. Cumulative Required Delta
$$\Delta_{\text{total}} = V_{\text{target}} - V_{\text{base}}$$

### 2. Actual Achieved Delta
$$\Delta_{\text{achieved}} = V_{\text{achieved}} - V_{\text{base}}$$

### 3. Cumulative Achievement Percentage
$$\text{Pct}_{\text{achieved}} = \left( \frac{\Delta_{\text{achieved}}}{\Delta_{\text{total}}} \right) \times 100\%$$

### 4. Linear Expected Run-Rate Percentage
Assuming an idealized uniform adoption path across the policy horizon:
$$\text{Horizon}_{\text{total}} = T_{\text{target}} - T_{\text{base}}$$
$$\text{Horizon}_{\text{elapsed}} = T_{\text{obs}} - T_{\text{base}}$$
$$\text{Pct}_{\text{expected}} = \left( \frac{\text{Horizon}_{\text{elapsed}}}{\text{Horizon}_{\text{total}}} \right) \times 100\%$$

Where elapsed time is bounded:
- If $T_{\text{obs}} \le T_{\text{base}}$, then $\text{Pct}_{\text{expected}} = 0.0\%$.
- If $T_{\text{obs}} \ge T_{\text{target}}$, then $\text{Pct}_{\text{expected}} = 100.0\%$.

### 5. Run-Rate Performance Ratio
$$\text{Ratio}_{\text{performance}} = \frac{\text{Pct}_{\text{achieved}}}{\text{Pct}_{\text{expected}}}$$

---

## 2. Trajectory Classification Criteria

The engine applies strict, deterministic thresholding to classify target trajectory into one of five statuses:

| Status | Condition | Meaning |
| :--- | :--- | :--- |
| `TARGET_EXCEEDED` | $V_{\text{achieved}} \ge V_{\text{target}}$ | Target has been completely achieved or surpassed. |
| `ON_TRACK` | $\text{Ratio} \ge 0.90$ or $\text{Pct}_{\text{achieved}} \ge \text{Pct}_{\text{expected}} - 5.0\%$ | Real-world progress matches or exceeds 90% of expected linear run-rate. |
| `AT_RISK` | $0.65 \le \text{Ratio} < 0.90$ | Moderate implementation lag; accelerated deployment required to avoid missing deadline. |
| `CRITICALLY_LAGGING` | $\text{Ratio} < 0.65$ | Severe implementation deficit; deployment rate is less than two-thirds of required run-rate. |
| `BASELINE_UNAVAILABLE` | $V_{\text{base}}$ is undefined or $V_{\text{target}} \le V_{\text{base}}$ | Target lacks an empirical starting baseline, preventing mathematically honest run-rate tracking. |

---

## 3. Real-World Indicator Ingestion & Data Sources

Targets are grounded in actual statutory reports published by primary energy agencies:

| Target ID | Indicator Description | Target Value | Baseline Value | Current Real-World Value | Primary Data Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TGT-SURYA-GHAR-CAPACITY` | Rooftop Solar Capacity (GW) | 30.00 GW | 1.80 GW | 5.80 GW | MNRE National Portal Monthly Report (Aug 2024) |
| `TGT-SURYA-GHAR-HOMES` | Solarized Residential Households | 10.00 M | 0.65 M | 1.95 M | MNRE PM Surya Ghar MIS Dashboard (Aug 2024) |
| `TGT-NDC-NON-FOSSIL-SHARE` | Non-Fossil Power Capacity Share | 50.00 % | 40.20 % | 46.30 % | CEA All-India Installed Capacity Report (Aug 2024) |
| `TGT-NDC-EMISSION-INTENSITY` | GDP Emission Intensity Reduction vs 2005 | 45.00 % | 33.00 % | 36.50 % | MoEFCC Third National Communication / UNFCCC BUR |
| `TGT-BEE-ELEC-SAVINGS` | Annual Energy Savings (BU/TWh) | 60.00 BU | 24.50 BU | 41.20 BU | BEE National Energy Conservation Report 2023 |
| `TGT-KERC-ROOFTOP-CAPACITY` | Karnataka Domestic Rooftop Solar (GW) | 1.50 GW | 0.42 GW | 0.88 GW | KERC / BESCOM Solar Cell Progress Review 2024 |
| `TGT-APERC-ROOFTOP-CAPACITY` | Andhra Pradesh Consumer Solar (GW) | 1.20 GW | 0.31 GW | 0.62 GW | APERC / NREDCAP Solar Monitoring Portal 2024 |
| `TGT-KUSUM-SOLAR-CAPACITY` | Agricultural Feeder/Pump Solar (GW) | 34.80 GW | 0.00 GW | 8.40 GW | MNRE State-wise PM-KUSUM Progress (Jun 2024) |

---

## 4. Edge-Case Invariants

1. **Division by Zero Protection**: If $V_{\text{target}} == V_{\text{base}}$, $\Delta_{\text{total}} = 0$, the engine explicitly flags `BASELINE_UNAVAILABLE` rather than raising a mathematical exception.
2. **Pre-Baseline Observation**: If $T_{\text{obs}} < T_{\text{base}}$, elapsed horizon is pinned to 0, returning $0.0\%$ expected run-rate.
3. **Overachieved Milestones**: If achieved capacity exceeds target value, performance ratio is capped at descriptive metrics and assigned `TARGET_EXCEEDED`.
4. **Historical Backtesting**: An explicit `observation_date` parameter can be passed to assess what the run-rate status was at any historical point in time.
