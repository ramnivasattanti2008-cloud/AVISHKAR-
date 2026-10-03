"""Group several sites' offers into pooled blocks for a buyer, and split the money back pro rata.

A single rooftop rarely has a block big enough to interest a buyer. Offers from different sites that cover the same
window are pooled into one block. The pool's floor price is the highest member floor, so no member sells below its own.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from avishkar_ems.dispatch import Offer


@dataclass
class PooledOffer:
    start: pd.Timestamp
    end: pd.Timestamp
    quantity_kwh: float
    floor_price: float
    members: dict[str, float] = field(default_factory=dict)  # site_id -> committed kWh


def pool(site_offers: dict[str, list[Offer]], min_kwh: float = 0.0) -> list[PooledOffer]:
    by_win: dict[tuple, PooledOffer] = {}
    for site, offers in site_offers.items():
        for o in offers:
            k = (o.start, o.end)
            p = by_win.setdefault(k, PooledOffer(o.start, o.end, 0.0, 0.0))
            p.quantity_kwh += o.quantity_kwh
            p.floor_price = max(p.floor_price, o.floor_price)
            p.members[site] = p.members.get(site, 0.0) + o.quantity_kwh
    return sorted((p for p in by_win.values() if p.quantity_kwh >= min_kwh), key=lambda p: p.start)


def split_money(p: PooledOffer, delivered: dict[str, float], net_inr: float) -> dict[str, float]:
    """Share the pool's net revenue in proportion to the energy each member actually delivered."""
    tot = sum(delivered.values())
    return {s: (net_inr * d / tot if tot > 0 else 0.0) for s, d in delivered.items()}
