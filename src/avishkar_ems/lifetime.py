"""Lifetime view of a payback figure: discounting, rising tariffs, degradation, running costs, battery replacement.

`payback.py` reports the simple payback (system cost / annual benefit). That ignores that money later is worth less,
that tariffs rise, that panels and batteries wear, and that a system costs something to run. This module adds those as
explicit, adjustable assumptions. Every default below is an ILLUSTRATIVE ASSUMPTION, not data: set your own.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class Lifetime:
    years: int = 25  # analysis horizon
    discount: float = 0.08  # yearly discount rate
    escalation: float = 0.03  # yearly rise in the value of each kWh saved (tariff escalation)
    pv_degradation: float = 0.005  # yearly loss of benefit from wear (applied to the whole benefit)
    om_frac: float = 0.01  # yearly operation and maintenance, as a fraction of the system cost
    battery_replace_year: int = 0  # 0 means no replacement within the horizon
    battery_replace_inr: float = 0.0


@dataclass
class LifetimeResult:
    simple_payback_years: float
    discounted_payback_years: float
    npv_inr: float
    cashflows: pd.DataFrame  # indexed by year (0 = purchase); columns cashflow_inr, discounted_inr, cumulative_inr


def _payback(cumulative: list[float]) -> float:
    """Years until the cumulative cash flow first turns non-negative, interpolated within the year; inf if never."""
    for year in range(1, len(cumulative)):
        if cumulative[year] >= 0:
            prev, step = cumulative[year - 1], cumulative[year] - cumulative[year - 1]
            return (year - 1) + (-prev / step if step > 0 else 0.0)
    return math.inf


def lifetime_view(annual_benefit_inr: float, system_cost_inr: float, subsidy_inr: float = 0.0,
                  params: Lifetime = Lifetime()) -> LifetimeResult:
    """Cash flows and payback of a system that saves `annual_benefit_inr` a year in year-one money."""
    upfront = system_cost_inr - subsidy_inr
    rows = [{"year": 0, "cashflow_inr": -upfront}]
    for t in range(1, params.years + 1):
        benefit = annual_benefit_inr * (1 + params.escalation) ** (t - 1) * (1 - params.pv_degradation) ** (t - 1)
        cash = benefit - params.om_frac * system_cost_inr
        if params.battery_replace_year and t == params.battery_replace_year:
            cash -= params.battery_replace_inr
        rows.append({"year": t, "cashflow_inr": cash})
    cf = pd.DataFrame(rows).set_index("year")
    cf["discounted_inr"] = [c / (1 + params.discount) ** t for t, c in zip(cf.index, cf["cashflow_inr"], strict=True)]
    cf["cumulative_inr"] = cf["discounted_inr"].cumsum()
    simple = upfront / annual_benefit_inr if annual_benefit_inr > 0 else math.inf
    return LifetimeResult(simple, _payback(cf["cumulative_inr"].tolist()), float(cf["discounted_inr"].sum()), cf)
