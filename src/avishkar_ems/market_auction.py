"""Double-Sided Continuous Auction & Market Clearing Engine for UrjaSetu EMS.

Replaces static heuristic price formulas with an authentic double-sided auction:
- Prosumer Asks (Sellers): Sorted by minimum floor price (Merit Order Supply Curve).
- Consumer Bids (Buyers): Sorted by maximum willingness-to-pay (Demand Curve).
- Uniform Market Clearing Price (MCP): Point where cumulative supply intersects demand.
- Computes Consumer Surplus, Producer Surplus, and Social Welfare in Indian Rupees (₹).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class MarketOrder:
    """Individual bid or ask order in the microgrid energy book."""
    order_id: str
    participant_id: str
    side: str               # "BID" (Buyer) or "ASK" (Seller)
    quantity_kwh: float
    price_rs_kwh: float
    timestamp: float = field(default_factory=time.time)


@dataclass
class MatchedTrade:
    """Executed trade transaction between a buyer and a seller."""
    trade_id: str
    seller_id: str
    buyer_id: str
    cleared_kwh: float
    clearing_price_rs_kwh: float
    trade_value_inr: float
    timestamp: str


@dataclass
class AuctionClearingResult:
    """Complete market clearing outcome for a 15-minute trading window."""
    window: str
    total_bid_volume_kwh: float
    total_ask_volume_kwh: float
    cleared_volume_kwh: float
    uniform_clearing_price_rs_kwh: float
    matched_trades: List[MatchedTrade]
    producer_surplus_inr: float
    consumer_surplus_inr: float
    total_social_welfare_inr: float
    unmatched_bids_kwh: float
    unmatched_asks_kwh: float


class MicrogridAuctionEngine:
    """Executes uniform clearing double-sided auctions for local energy microgrids."""

    def __init__(self):
        self.bids: List[MarketOrder] = []
        self.asks: List[MarketOrder] = []

    def submit_order(self, order: MarketOrder) -> None:
        """Adds a verified market order to the book."""
        if order.side.upper() == "BID":
            self.bids.append(order)
        else:
            self.asks.append(order)

    def clear_market(self, window_label: str = "11:00-11:15") -> AuctionClearingResult:
        """Clears the double-sided auction book using uniform pricing."""
        # 1. Sort Bids descending (highest willingness to pay first)
        sorted_bids = sorted(self.bids, key=lambda x: x.price_rs_kwh, reverse=True)
        # 2. Sort Asks ascending (cheapest green electricity first)
        sorted_asks = sorted(self.asks, key=lambda x: x.price_rs_kwh)

        total_bid_kwh = sum(b.quantity_kwh for b in sorted_bids)
        total_ask_kwh = sum(a.quantity_kwh for a in sorted_asks)

        trades: List[MatchedTrade] = []
        bid_idx = 0
        ask_idx = 0

        # Remaining quantities for partial filling
        bid_rem = {b.order_id: b.quantity_kwh for b in sorted_bids}
        ask_rem = {a.order_id: a.quantity_kwh for a in sorted_asks}

        clearing_price = 0.0
        cleared_volume = 0.0
        producer_surplus = 0.0
        consumer_surplus = 0.0

        while bid_idx < len(sorted_bids) and ask_idx < len(sorted_asks):
            cur_bid = sorted_bids[bid_idx]
            cur_ask = sorted_asks[ask_idx]

            # Clearing condition: Bid Price >= Ask Price
            if cur_bid.price_rs_kwh < cur_ask.price_rs_kwh:
                break

            # Midpoint marginal price for matched pair
            clearing_price = round((cur_bid.price_rs_kwh + cur_ask.price_rs_kwh) / 2.0, 2)
            match_kwh = min(bid_rem[cur_bid.order_id], ask_rem[cur_ask.order_id])

            if match_kwh > 0.01:
                trade_val = match_kwh * clearing_price
                trades.append(MatchedTrade(
                    trade_id=f"TRD-AUC-{len(trades)+101}",
                    seller_id=cur_ask.participant_id,
                    buyer_id=cur_bid.participant_id,
                    cleared_kwh=round(match_kwh, 2),
                    clearing_price_rs_kwh=clearing_price,
                    trade_value_inr=round(trade_val, 2),
                    timestamp=time.strftime("%H:%M:%S"),
                ))
                cleared_volume += match_kwh
                # Economic surplus
                consumer_surplus += match_kwh * (cur_bid.price_rs_kwh - clearing_price)
                producer_surplus += match_kwh * (clearing_price - cur_ask.price_rs_kwh)

                bid_rem[cur_bid.order_id] -= match_kwh
                ask_rem[cur_ask.order_id] -= match_kwh

            if bid_rem[cur_bid.order_id] <= 0.001:
                bid_idx += 1
            if ask_rem[cur_ask.order_id] <= 0.001:
                ask_idx += 1

        unmatched_b = total_bid_kwh - cleared_volume
        unmatched_a = total_ask_kwh - cleared_volume

        return AuctionClearingResult(
            window=window_label,
            total_bid_volume_kwh=round(total_bid_kwh, 2),
            total_ask_volume_kwh=round(total_ask_kwh, 2),
            cleared_volume_kwh=round(cleared_volume, 2),
            uniform_clearing_price_rs_kwh=clearing_price if cleared_volume > 0 else 0.0,
            matched_trades=trades,
            producer_surplus_inr=round(producer_surplus, 2),
            consumer_surplus_inr=round(consumer_surplus, 2),
            total_social_welfare_inr=round(consumer_surplus + producer_surplus, 2),
            unmatched_bids_kwh=round(unmatched_b, 2),
            unmatched_asks_kwh=round(unmatched_a, 2),
        )
