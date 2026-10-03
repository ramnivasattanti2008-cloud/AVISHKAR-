"""Replay a day against what really happened: actual PV, actual load, real outages.

The same battery physics is used for the EMS plan and for the baselines, so comparisons are fair.
The plan's battery setpoints are followed, but they are bounded by the battery's real state, so
forecast errors show up as real money and real shortfalls rather than being hidden.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from avishkar_ems.site import SiteSpec

DT = 0.25  # hours per step


@dataclass
class DayResult:
    steps: pd.DataFrame
    end_soc: float


def execute_day(
    site: SiteSpec,
    actual: pd.DataFrame,
    soc_init: float,
    floor_soc: float,
    policy: str,
    plan_batt_kw: np.ndarray | None = None,
    export_ok: np.ndarray | None = None,
    guard: bool = True,
) -> DayResult:
    """policy: 'plan' follows plan_batt_kw, 'guided' follows the plan's price signal but reacts to real load and sun,
    'greedy' is the fixed rule (charge from surplus,
    discharge to load), 'idle' leaves the battery alone except to ride through outages.

    With guard=True the plan is tracked against reality: the battery is never discharged into the
    grid outside the committed P2P windows (export_ok), and is not charged from the grid in daylight.
    Without it, a forecast that over-estimates the evening load would dump stored energy to the grid
    at the low export rate while still paying battery wear."""
    cap, eff = site.battery_kwh, site.one_way_eff
    abs_min = 1.0 - site.dod  # deepest the battery may go, only allowed during an outage
    energy = soc_init * cap  # stored energy, kWh
    n = len(actual)
    pv = actual["pv_kw"].to_numpy()
    load = actual["load_kw"].to_numpy()
    outage = actual["outage"].to_numpy()
    daylight = actual["pv_kw"].to_numpy() > 0.02 * site.dc_kwp
    if export_ok is None:
        export_ok = np.zeros(n, dtype=bool)
    theta = np.inf  # guided policy: discharge to the load only when the grid price is at least this
    if policy == "guided":
        hi = np.asarray(plan_batt_kw) > 0.05
        theta = float(actual["import_rate"].to_numpy()[hi].min()) if hi.any() else np.inf
    out = {k: np.zeros(n) for k in ("batt_kw", "grid_kw", "soc", "unserved_kwh", "unserved_critical_kwh")}
    for t in range(n):
        if outage[t]:
            want = load[t] - pv[t]  # + battery must supply, - surplus to charge
            lo_soc = abs_min
        else:
            lo_soc = floor_soc
            if policy == "plan":
                want = float(plan_batt_kw[t])
                if guard and want > 0 and not export_ok[t]:
                    want = min(want, max(load[t] - pv[t], 0.0))  # serve own load only
                if guard and want < 0 and daylight[t]:
                    want = -min(-want, max(pv[t] - load[t], 0.0))  # charge from surplus sun only
            elif policy == "guided":
                if export_ok[t]:
                    want = float(plan_batt_kw[t])  # a committed P2P window: do what was promised
                elif actual["import_rate"].iat[t] >= theta:
                    want = load[t] - pv[t]  # price is high enough to be worth using stored energy
                else:
                    want = min(load[t] - pv[t], 0.0)  # cheap hours: soak up real surplus...
                    if not daylight[t] and plan_batt_kw[t] < want:
                        want = float(plan_batt_kw[t])  # ...and charge from the grid at night when the plan says so
            elif policy == "greedy":
                want = load[t] - pv[t]
            else:
                want = 0.0
        if want > 0:  # discharge, AC kW delivered
            avail = max(0.0, (energy - lo_soc * cap) * eff / DT)
            batt = min(want, site.battery_kw, avail)
            energy -= batt * DT / eff
        else:  # charge, AC kW drawn
            room = max(0.0, (cap - energy) / eff / DT)
            batt = -min(-want, site.battery_kw, room)
            energy += -batt * DT * eff
        if outage[t]:
            grid = 0.0
            shortfall = max(0.0, load[t] - pv[t] - batt)
            out["unserved_kwh"][t] = shortfall * DT
            out["unserved_critical_kwh"][t] = max(0.0, site.critical_kw - (pv[t] + batt)) * DT
        else:
            grid = load[t] - pv[t] - batt  # + import, - export
        out["batt_kw"][t], out["grid_kw"][t], out["soc"][t] = batt, grid, energy / cap
    res = actual[["pv_kw", "load_kw", "import_rate", "export_rate", "p2p_price", "outage"]].copy()
    for k, v in out.items():
        res[k] = v
    res["import_kwh"] = np.clip(res["grid_kw"], 0, None) * DT
    res["export_kwh"] = np.clip(-res["grid_kw"], 0, None) * DT
    return DayResult(res, float(energy / cap))
