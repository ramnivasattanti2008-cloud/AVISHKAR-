"""Emergency reserve: enough stored energy to run critical loads for the required backup hours.

The reserve is a hard constraint, not a price. It is turned into a minimum state-of-charge
(SOC) floor that the planner may never go below. The floor rises ahead of storms, planned
outages, or on days when outages are historically common.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from avishkar_ems.site import SiteSpec


@dataclass(frozen=True)
class ReserveDecision:
    floor_soc: float  # fraction of nominal battery capacity the plan must never go below
    required_kwh: float  # stored energy needed to carry the critical load
    risk: float  # 0..1 outage risk used for the uplift
    feasible: bool  # False if the battery is too small to hold the required reserve
    reason: str


def outage_risk(
    *,
    planned_notice: bool = False,
    storm_prob: float = 0.0,
    outage_rate_90d: float = 0.0,
) -> float:
    """Combine independent risk signals into one 0..1 number (noisy-OR).

    planned_notice: a planned-outage notice exists for the day.
    storm_prob: 0..1 chance of storm or heavy rain, from the weather forecast.
    outage_rate_90d: share of the last 90 days that had at least one outage.
    The weights are heuristic and meant to be tuned on the organisers' outage logs.
    """
    components = (
        0.9 if planned_notice else 0.0,
        0.6 * min(max(storm_prob, 0.0), 1.0),
        0.4 * min(1.0, 4.0 * max(outage_rate_90d, 0.0)),
    )
    survive = 1.0
    for c in components:
        survive *= 1.0 - c
    return 1.0 - survive


def outage_rate_90d(outage_flags: pd.Series, day: pd.Timestamp) -> float:
    """Share of the 90 days before `day` that had at least one outage step."""
    daily = outage_flags.astype(bool).groupby(outage_flags.index.normalize()).any()
    window = daily[(daily.index < day.normalize()) & (daily.index >= day.normalize() - pd.Timedelta(days=90))]
    return float(window.mean()) if len(window) else 0.0


def reserve_floor(
    site: SiteSpec,
    *,
    risk: float = 0.0,
    risk_uplift: float = 0.5,
    max_floor: float = 0.95,
) -> ReserveDecision:
    """SOC floor needed to run the critical load for the backup hours, raised by outage risk."""
    required_kwh = site.critical_kw * site.backup_hours * (1.0 + risk_uplift * risk)
    stored_needed = required_kwh / site.one_way_eff  # battery must hold a bit more than it delivers
    min_by_dod = 1.0 - site.dod
    raw_floor = max(min_by_dod, stored_needed / site.battery_kwh) if site.battery_kwh > 0 else 1.0
    feasible = raw_floor <= max_floor
    floor = min(raw_floor, max_floor)
    reason = (
        f"critical {site.critical_kw:.1f} kW x {site.backup_hours:.1f} h"
        f" with outage risk {risk:.2f}"
    )
    if not feasible:
        reason += f"; battery too small, reserve needs {raw_floor:.0%} of capacity"
    return ReserveDecision(floor, required_kwh, risk, feasible, reason)
