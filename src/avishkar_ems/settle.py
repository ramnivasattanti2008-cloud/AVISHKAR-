"""Settlement: compare delivered energy with what was committed, and book revenue and shortfall."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from avishkar_ems.dispatch import Offer
from avishkar_ems.site import SiteSpec


@dataclass
class TradeResult:
    offer_id: str
    committed_kwh: float
    delivered_kwh: float
    shortfall_kwh: float
    clearing_price: float
    matched: bool  # the buyer's clearing price met the floor price
    revenue_inr: float  # net of network and platform charges
    penalty_inr: float
    uplift_vs_export_inr: float  # extra money compared with sending the same energy to the grid


def settle(site: SiteSpec, offers: list[Offer], executed: pd.DataFrame) -> list[TradeResult]:
    """Settle each offer on actual export.

    Delivered energy is paid at the buyer's clearing price minus charges, instead of the grid
    export rate. `uplift_vs_export_inr` is that gain net of any shortfall penalty.
    """
    results: list[TradeResult] = []
    for o in offers:
        win = executed[(executed.index >= o.start) & (executed.index < o.end)]
        actual_export = float(win["export_kwh"].sum())
        price = float(win["p2p_price"].mean())
        matched = price >= o.floor_price
        delivered = min(o.quantity_kwh, actual_export) if matched else 0.0
        shortfall = (o.quantity_kwh - delivered) if matched else 0.0  # unmatched offers carry no penalty
        revenue = delivered * (price - site.tariff.p2p_charges)
        penalty = shortfall * site.tariff.shortfall_penalty
        export_alt = delivered * float(win["export_rate"].mean())
        results.append(TradeResult(o.offer_id, o.quantity_kwh, delivered, shortfall, price, matched,
                                   revenue, penalty, revenue - export_alt - penalty))
    return results
