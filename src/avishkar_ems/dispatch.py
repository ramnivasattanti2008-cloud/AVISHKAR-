"""Surplus dispatch: turn the day plan into P2P/UEI-style offers, sized so they can be kept.

An offer is sized on a conservative (P10 generation, P90 load) surplus, never on the P50 value, so
the site rarely commits more than it can deliver. `ies.catalog_publish` turns offers into the India
Energy Stack (Beckn DEG v2.0) catalog/publish message.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from avishkar_ems.planner import STEP_H, DayPlan
from avishkar_ems.site import SiteSpec


@dataclass
class Offer:
    offer_id: str
    site_id: str
    start: pd.Timestamp
    end: pd.Timestamp
    quantity_kwh: float  # committed quantity
    planned_export_kwh: float  # what the P50 plan expects to export in the window
    floor_price: float  # INR/kWh, below this the energy goes to the grid instead
    commit_ratio: float  # committed / planned export; below 1 means a safety margin was kept
    meta: dict = field(default_factory=dict)


def build_offers(site: SiteSpec, plan: DayPlan, p2p_fcst: np.ndarray, window_hours: float = 1.0,
                 min_kwh: float = 0.5) -> list[Offer]:
    """One offer per window with a reliable surplus."""
    s = plan.steps
    per_win = int(window_hours / STEP_H)
    planned_export = np.clip(-s["grid_kw"].to_numpy(), 0, None)
    # Conservative export: low generation, high load, plus whatever the plan discharges.
    safe_export = np.clip(s["pv_p10"].to_numpy() + s["batt_kw"].to_numpy() - s["load_p90"].to_numpy(), 0, None)
    commit_kw = np.minimum(planned_export, safe_export)
    offers: list[Offer] = []
    for w0 in range(0, len(s), per_win):
        sl = slice(w0, w0 + per_win)
        qty = float(commit_kw[sl].sum() * STEP_H)
        if qty < min_kwh:
            continue
        exp_rate = float(s["export_rate"].iloc[sl].mean())
        p2p = float(np.mean(p2p_fcst[sl]))
        floor = exp_rate + site.tariff.p2p_charges + 0.25 * max(0.0, p2p - site.tariff.p2p_charges - exp_rate)
        planned_kwh = float(planned_export[sl].sum() * STEP_H)
        offers.append(Offer(
            offer_id=f"{site.site_id}-{s.index[w0]:%Y%m%dT%H%M}-{uuid.uuid4().hex[:6]}",
            site_id=site.site_id, start=s.index[w0], end=s.index[min(w0 + per_win, len(s)) - 1] + pd.Timedelta(minutes=15),
            quantity_kwh=qty, planned_export_kwh=planned_kwh,
            floor_price=floor, commit_ratio=qty / planned_kwh if planned_kwh > 0 else 0.0))
    return offers


def offer_mask(index: pd.DatetimeIndex, offers: list[Offer]) -> np.ndarray:
    """True for every step that falls inside a committed offer window."""
    mask = np.zeros(len(index), dtype=bool)
    for o in offers:
        mask |= (index >= o.start) & (index < o.end)
    return mask
