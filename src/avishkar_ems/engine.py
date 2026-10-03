"""Two-pass day planning: plan, commit offers on a conservative surplus, then re-plan.

Pass 1 plans with grid-export prices only and sizes offers on the P10/P90 surplus. Pass 2 re-plans
knowing that exports inside those committed windows earn the P2P price. The LP is never told it can
sell energy at a P2P price in a window where no offer could safely be committed.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from avishkar_ems.dispatch import Offer, build_offers, offer_mask
from avishkar_ems.planner import DayPlan, plan_day
from avishkar_ems.reserve import ReserveDecision
from avishkar_ems.site import SiteSpec


def plan_and_offer(
    site: SiteSpec,
    pv_bands: pd.DataFrame,
    load_bands: pd.DataFrame,
    import_rate: np.ndarray,
    export_rate: np.ndarray,
    p2p_fcst: np.ndarray,
    soc_init: float,
    reserve: ReserveDecision,
) -> tuple[DayPlan, list[Offer]]:
    first = plan_day(site, pv_bands, load_bands, import_rate, export_rate, p2p_fcst, soc_init, reserve)
    mask = offer_mask(first.steps.index, build_offers(site, first, p2p_fcst))
    if not mask.any():
        return first, []
    second = plan_day(site, pv_bands, load_bands, import_rate, export_rate, p2p_fcst, soc_init, reserve,
                      p2p_mask=mask)
    return second, build_offers(site, second, p2p_fcst)
