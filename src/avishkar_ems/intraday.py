"""Noon re-plan: correct the rest of the day's forecast with what actually happened this morning.

Offers already published stay fixed. The remaining battery path is re-optimised from the real state of
charge, with generation and load forecasts nudged by the morning's observed error, fading with a 4-hour half-life.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from avishkar_ems.dispatch import Offer, offer_mask
from avishkar_ems.execute import DayResult, execute_day
from avishkar_ems.planner import DayPlan, plan_day
from avishkar_ems.reserve import ReserveDecision
from avishkar_ems.site import SiteSpec


def execute_with_replan(site: SiteSpec, actual: pd.DataFrame, pv_b: pd.DataFrame, ld_b: pd.DataFrame,
                        plan: DayPlan, offers: list[Offer], p2p_fcst: np.ndarray, soc0: float,
                        rsv: ReserveDecision, at: int = 48, lookback: int = 8) -> DayResult:
    mask = offer_mask(actual.index, offers)
    first = execute_day(site, actual.iloc[:at], soc0, rsv.floor_soc, "guided",
                        plan.steps["batt_kw"].to_numpy()[:at], export_ok=mask[:at])
    n = len(actual) - at
    w = slice(at - lookback, at)
    fc_pv = float(pv_b["p50"].iloc[w].sum())
    k = float(np.clip(actual["pv_kw"].iloc[w].sum() / fc_pv, 0.5, 1.5)) if fc_pv > 0.2 * lookback * 0.1 * site.dc_kwp else 1.0
    d_load = float((actual["load_kw"].iloc[w] - ld_b["p50"].iloc[w]).mean())
    fade = 0.5 ** (np.arange(n) / 16.0)
    pv2 = pv_b.iloc[at:].mul(1.0 + (k - 1.0) * fade, axis=0)
    ld2 = (ld_b.iloc[at:].add(d_load * fade, axis=0)).clip(lower=0.0)
    plan2 = plan_day(site, pv2, ld2, actual["import_rate"].to_numpy()[at:], actual["export_rate"].to_numpy()[at:],
                     p2p_fcst[at:], first.end_soc, rsv, p2p_mask=mask[at:])
    second = execute_day(site, actual.iloc[at:], first.end_soc, rsv.floor_soc, "guided",
                         plan2.steps["batt_kw"].to_numpy(), export_ok=mask[at:])
    return DayResult(pd.concat([first.steps, second.steps]), second.end_soc)
