# Optimisation

How the planner decides when to charge, discharge, import, export and run flexible loads. The code is
`platform/engine/avishkar_engine/optimise.py` (the programme and its independent check) and `platform/api/src/plan` (the
inputs, the horizon, the storage of results). This is a description of what exists on 2026-10-08.

## The problem

One explicit linear programme (mixed-integer only when an appliance must run in one unbroken block, or when export is valued above the import it needs and the two must be kept apart within a step), solved over a horizon of
24 or 48 hours with SciPy's HiGHS (`scipy.optimize.milp`). It is deterministic: the same inputs give the same plan. There is no
learning, no heuristic search and no neural network in it. The solver has a time limit (20 s by default, at most 120 s); if it stops there the best plan found is returned with a note
saying it is not a proven optimum.

**Decision variables, per step:** grid import and export, solar used, solar curtailed, battery charge and discharge, battery
state of charge, EV charging power, and for each flexible appliance either its power or a binary choice of start step.

**Constraints**

- Energy balance at every step: solar used + import + discharge + unserved = served load + charge + EV + appliances + export.
- Battery: state of charge follows `soc[t] = soc[t-1] + charge_eff * charge * dt - discharge * dt / discharge_eff`, stays between
  its minimum and maximum, respects charge and discharge power limits, keeps a reserve outside an outage, and ends the horizon
  at least where it began (or at the level given). A battery that is `cyclic` starts and ends at the same charge, which the
  planner chooses; this is how a typical day is planned so that it can repeat.
- Grid: import and export limits. During an outage both are zero and only the critical load is served.
- EV: the energy needed is delivered between arrival and departure, or the shortfall is reported.
- Appliances: each runs for its duration inside its allowed window; a non-interruptible one is one unbroken run.

**Objective:** minimise the mode-weighted cost: import cost minus export revenue, plus battery wear (the owner's cost per kWh
drawn out), plus soft penalties for the things the constraints cannot always meet (unserved load INR 10,000 per kWh, EV shortfall
and skipped appliances INR 1,000, a reserve shortfall INR 100). A tiny tie-break (1e-6) prefers using solar to wasting it, and
not charging and discharging in the same step.

## Modes

Six modes change only the weights, and the weights are returned with every plan so they can be inspected.

| Mode | What changes |
|---|---|
| `SAVE_MONEY` | Import cost and export revenue at their true prices |
| `INDEPENDENCE` | Each imported kWh is penalised by INR 3 on top of its price |
| `GREEN` | Each imported kWh is penalised by INR 2. There is no carbon-intensity table, so this weighs imports, not emissions, unless the owner supplies a carbon intensity, which is then weighted at a stated INR 5 per kg CO2 (a preference, not a market price) |
| `REVENUE` | Import cost counts at half weight |
| `RESILIENCE` | Keeps enough in the battery to carry the critical load for the backup hours asked, allowing for discharge losses |
| `BALANCED` | Each imported kWh is penalised by INR 1 |

The weights are preferences, not prices: **the cost reported is always at the true prices**, whatever the mode weighted.

## Never trusted on its own account

`validate` recomputes the physics from the returned schedule and nothing else: energy balance at every step, no negative flow,
no more solar used than generated, import and export limits, no grid during an outage, the battery's state of charge following
its own charge and discharge and staying in range, no simultaneous charge and discharge, the vehicle charging only while it is
present, and each appliance inside its window, within its rating and in one unbroken run. A plan that fails is returned flagged
**SIMULATION INVALID**, and the API turns that into `PLAN_INVALID` and shows no plan. The reported cost is also recomputed from
the schedule.

## Against doing nothing

Every plan comes with a baseline: solar serves the load directly, the surplus is exported, the battery sits idle, the vehicle
charges on arrival and appliances start as early as they may. The saving shown is the difference of the two costs **as
displayed** (rounded), so what the page says always adds up (`costsShown` in `api/src/plan/service.ts`).

## Inputs and what they are

| Input | From | Label |
|---|---|---|
| Solar output | The solar forecast: pvlib driven by the Open-Meteo irradiance forecast | `FORECAST` |
| Load | The load forecast built from the owner's meter readings | `FORECAST`, or `ESTIMATED` when the data is older than two days |
| Prices | The property's tariff (time-of-day blocks and slabs, from a sourced order or the owner's own) and the export credit | `REFERENCE` / owner-entered; the export basis is stated on every plan |
| Equipment | The owner's battery, solar, vehicle and appliance records | Owner-entered; a blank parameter stays blank and the default used is shown |

Plan steps are whole hours in IST. Forecast hours are resampled to the plan grid by overlap, not by index.

## Yearly what-if

A yearly result is not a year-long programme. It is 24 typical days (a weekday and a weekend day for each month), each planned
with a cyclic battery, weighted by the next 365 days' calendar. Load comes from the owner's Energy DNA, solar from the monthly
climatology scaled to a clear-sky day. This ignores cloudy-day variability, which is stated with every result.

## Not done

- No risk-aware objective: the plan uses the median forecast and does not hedge against the band.
- No outage data, so `RESILIENCE` holds a reserve for the hours asked; it does not predict outages.
- No carbon weighting from a sourced table (none exists in the platform); only an intensity the owner supplies is used.
- One battery (several are summed), one vehicle, one run per appliance per plan.
- Plans are not rolling: nothing re-plans when a forecast changes.
- No net-metering settlement and no demand charge.
- No battery degradation model beyond the owner's wear cost per kWh; no cycle limit.
