# UrjaSetu EMS — Phase 13 Eligibility Rules & Deterministic Ranking Matrix

> **Standard**: Recommendation Preconditions, Eligibility Criteria & Prioritization  
> **Status**: Verified & Enforced  
> **Author**: UrjaSetu Systems Architecture & Engineering  
> **Audit Date**: 2026-10-24  

---

## 1. Eligibility Architecture & Pre-Flight Validation

A recommendation is never displayed merely because the UI has screen real estate for it. Every candidate rule must pass strict eligibility tests before generation:

```
[ Candidate Rule Trigger ] 
          │
          ▼
[ Property Authorization Check ] ──── Verifies user_id owns property_id
          │
          ▼
[ Data Sufficiency Check ] ────────── Validates minimum bills, interval data, specs
          │
          ▼
[ Parameter Boundary Check ] ──────── Tests physical and economic viability
          │
          ▼
[ Rule Evaluation ] ──────────────── Evaluates formula and generates Recommendation
```

---

## 2. Rule Eligibility Catalog

| Rule ID | Category | Title | Eligibility Preconditions & Thresholds | Required Input Fields |
| :--- | :--- | :--- | :--- | :--- |
| **`RULE-SLAB-01`** | `CONSUMPTION_OPTIMIZATION` | Telescopic Slab Threshold Clipping | 1. Property has $\ge 1$ billing statement.<br>2. Latest consumption $C$ exceeds a slab ceiling $S_{\text{threshold}}$.<br>3. Excess units $5\text{ kWh} \le (C - S_{\text{threshold}}) \le 45\text{ kWh}$. | `bills.units_consumed_kwh`, `sanctioned_load_kw`, verified tariff schedule. |
| **`RULE-LOAD-01`** | `DEMAND_REDUCTION` | Sanctioned Load Realignment | 1. Current sanctioned load $P \ge 4.0\text{ kW}$.<br>2. Peak monthly consumption across all bills $< 220\text{ kWh}$.<br>3. Minimum optimized load $\ge 2.0\text{ kW}$. | `sanctioned_load_kw`, `bills.units_consumed_kwh`, tariff fixed charge rate. |
| **`RULE-SOLAR-01`** | `SOLAR_RENEWABLE` | Rooftop Solar PV with PM Surya Ghar | 1. Property solar capacity $P_{\text{solar}} < 2.0\text{ kWp}$.<br>2. Average monthly consumption $\ge 120\text{ kWh}$.<br>3. Sanctioned load $\ge 1.0\text{ kW}$.<br>4. State net-metering regulations permit installation. | `bills.units_consumed_kwh`, `sanctioned_load_kw`, state net metering rules. |
| **`RULE-AC-01`** | `APPLIANCE_EFFICIENCY` | AC Setpoint Tuning ($20^\circ\text{C} \rightarrow 24^\circ\text{C}$) | 1. User provides AC appliance specification.<br>2. Current operating setpoint $\le 23^\circ\text{C}$.<br>3. Daily run hours $> 0.0$. | `appliance_type`, `rated_power_w`, `estimated_daily_hours`, `current_setpoint`. |
| **`RULE-BATT-01`** | `SOLAR_RENEWABLE` | Solar Battery Dispatch Arbitrage | 1. Installed solar $P_{\text{solar}} > 0\text{ kWp}$.<br>2. Installed battery $P_{\text{battery}} > 0\text{ kWh}$.<br>3. Net export $> 10\text{ kWh/month}$ and import $> 20\text{ kWh/month}$.<br>4. Tariff spread $(R_{\text{import}} - R_{\text{export}}) \ge ₹0.50/\text{kWh}$. | `solar_capacity_kwp`, `battery_capacity_kwh`, `bills.net_meter_export_kwh`. |
| **`RULE-PEER-01`** | `CONSUMPTION_OPTIMIZATION` | 10% Household Conservation Plan | 1. Property has verified billing history.<br>2. Average monthly consumption $\ge 300\text{ kWh}$ (high-consumption tier above peer benchmark). | `bills.units_consumed_kwh`, tariff energy charge slabs. |
| **`RULE-SPIKE-01`** | `DATA_QUALITY` | Consumption Spike Anomaly Audit | 1. Property has $\ge 3$ consecutive billing statements.<br>2. Latest bill $> 1.25 \times \text{Historical Median}$.<br>3. Absolute spike excess $\ge 50\text{ kWh}$. | Historical consecutive `UtilityBillRecord` list. |
| **`RULE-APP-GAP`** | `APPLIANCE_EFFICIENCY` | Configure Major Appliances | Triggered when user has not entered appliance specifications. Delivers honest, non-numeric guidance without fabricating savings. | None (fallback when appliance telemetry is absent). |
| **`RULE-DATA-01`** | `DATA_QUALITY` | Import Additional Utility Statements | Triggered when property has $< 3$ billing statements on file. Advises user to upload additional statements. | Bill statement count. |

---

## 3. Deterministic Prioritization & Ranking Matrix

Recommendations are prioritized using an open, multi-factor scoring algorithm. No opaque or uninterpretable scores are permitted:

$$\text{PriorityScore} = 0.40 \times S_{\text{financial}} + 0.25 \times S_{\text{evidence}} + 0.20 \times S_{\text{effort}} + 0.15 \times S_{\text{urgency}}$$

### Factor Sub-Scores:
1. **Financial Impact Sub-Score ($S_{\text{financial}} \in [0, 100]$)**:
   $$S_{\text{financial}} = \min\left(100.0, \frac{\text{AnnualCostSavingsINR}}{5000.0} \times 100.0\right)$$
   (A savings of ₹5,000/year or higher achieves maximum 100 points).
2. **Evidence Confidence Sub-Score ($S_{\text{evidence}} \in [0, 100]$)**:
   $$S_{\text{evidence}} = \text{confidence\_score} \times 100.0$$
   - Statutory tariff order + verified bill: $95.0\%$.
   - Solar model + NASA insolation: $88.0\%$.
   - User-reported appliance estimate: $82.0\%$.
3. **Implementation Effort Sub-Score ($S_{\text{effort}} \in [0, 100]$)**:
   - `LOW` (Zero-cost behavioral or setting change): **100.0 points**
   - `MEDIUM` (Discom paperwork or operational scheduling): **60.0 points**
   - `HIGH` (Capital expense, rooftop installation): **30.0 points**
4. **Urgency Sub-Score ($S_{\text{urgency}} \in [0, 100]$)**:
   - `CRITICAL` (Safety, unverified spike): **100.0 points**
   - `HIGH` (Active recurring financial waste): **75.0 points**
   - `MEDIUM` (Longer-term optimization): **50.0 points**
   - `LOW` (Advisory data completeness): **25.0 points**
