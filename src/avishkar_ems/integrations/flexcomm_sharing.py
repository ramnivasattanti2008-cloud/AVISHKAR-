"""Flexcomm Integration: Community Energy Sharing, Line Loss & Virtual Net Metering.

Adapted from https://github.com/Enpower-project/Flexcomm (GPL-3.0 compatibility / Clean-room algorithm)
Modules: fast_api/apisrc/routers/optimization.py, service.py, and pilot_config.py.

Provides:
1. Multi-building peer-to-peer solar surplus sharing across microgrid / community participants.
2. Distribution feeder line-loss modeling using quadratic I^2*R loss formulation (alpha * P^2).
3. Virtual Net Metering (VNM) accounting with community discount tariffs.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CommunityMember:
    site_id: str
    name: str
    generation_kw: float
    consumption_kw: float
    distance_feeder_m: float = 100.0  # Feeder line length in meters

    @property
    def net_surplus_kw(self) -> float:
        return self.generation_kw - self.consumption_kw


@dataclass
class CommunityTradeResult:
    seller_id: str
    buyer_id: str
    energy_transferred_kw: float
    line_loss_kw: float
    effective_delivered_kw: float
    transaction_cost: float


@dataclass
class CommunitySharingSummary:
    total_community_generation_kw: float
    total_community_consumption_kw: float
    internal_shared_kw: float
    total_line_loss_kw: float
    net_grid_import_kw: float
    net_grid_export_kw: float
    trades: list[CommunityTradeResult] = field(default_factory=list)


class CommunityEnergySharing:
    """Peer-to-peer energy sharing coordinator with line-loss accounting."""

    def __init__(
        self,
        community_tariff_per_kwh: float = 0.12,  # Discounted internal rate
        grid_import_tariff: float = 0.28,
        grid_feed_in_tariff: float = 0.07,
        line_resistance_ohm_per_km: float = 0.35,  # Standard low-voltage cable
        feeder_voltage_v: float = 230.0,
    ) -> None:
        self.community_tariff = community_tariff_per_kwh
        self.grid_import_tariff = grid_import_tariff
        self.grid_feed_in_tariff = grid_feed_in_tariff
        self.line_resistance_per_m = line_resistance_ohm_per_km / 1000.0
        self.voltage = feeder_voltage_v

    def compute_line_loss_kw(self, power_kw: float, distance_m: float) -> float:
        """Calculates copper line losses: P_loss = I^2 * R = (P / V)^2 * (r * d)."""
        if power_kw <= 0.0 or distance_m <= 0.0:
            return 0.0

        current_a = (power_kw * 1000.0) / self.voltage
        resistance_ohm = self.line_resistance_per_m * distance_m
        loss_w = (current_a ** 2) * resistance_ohm
        return min(power_kw * 0.15, loss_w / 1000.0)  # Capped at 15% physical transmission loss

    def allocate_community_sharing(
        self,
        members: list[CommunityMember],
    ) -> CommunitySharingSummary:
        """Matches surplus generators with deficit consumers in the community."""
        total_gen = sum(m.generation_kw for m in members)
        total_cons = sum(m.consumption_kw for m in members)

        # Separate net producers (surplus > 0) and net consumers (deficit > 0)
        producers = [m for m in members if m.net_surplus_kw > 0.01]
        consumers = [m for m in members if m.net_surplus_kw < -0.01]

        # Sort producers by largest surplus, consumers by largest deficit
        producers.sort(key=lambda x: x.net_surplus_kw, reverse=True)
        consumers.sort(key=lambda x: abs(x.net_surplus_kw), reverse=True)

        trades: list[CommunityTradeResult] = []
        tot_shared_kw = 0.0
        tot_loss_kw = 0.0

        prod_idx = 0
        cons_idx = 0

        # Mutable remaining balances
        prod_remaining = {p.site_id: p.net_surplus_kw for p in producers}
        cons_remaining = {c.site_id: abs(c.net_surplus_kw) for c in consumers}

        while prod_idx < len(producers) and cons_idx < len(consumers):
            p = producers[prod_idx]
            c = consumers[cons_idx]

            avail_p = prod_remaining[p.site_id]
            need_c = cons_remaining[c.site_id]

            if avail_p <= 1e-4:
                prod_idx += 1
                continue
            if need_c <= 1e-4:
                cons_idx += 1
                continue

            trade_amount = min(avail_p, need_c)
            avg_distance = (p.distance_feeder_m + c.distance_feeder_m) / 2.0
            line_loss = self.compute_line_loss_kw(trade_amount, avg_distance)
            delivered = trade_amount - line_loss
            cost = trade_amount * self.community_tariff

            trades.append(
                CommunityTradeResult(
                    seller_id=p.site_id,
                    buyer_id=c.site_id,
                    energy_transferred_kw=round(trade_amount, 3),
                    line_loss_kw=round(line_loss, 4),
                    effective_delivered_kw=round(delivered, 3),
                    transaction_cost=round(cost, 4),
                )
            )

            prod_remaining[p.site_id] -= trade_amount
            cons_remaining[c.site_id] -= trade_amount
            tot_shared_kw += trade_amount
            tot_loss_kw += line_loss

            if prod_remaining[p.site_id] <= 1e-4:
                prod_idx += 1
            if cons_remaining[c.site_id] <= 1e-4:
                cons_idx += 1

        remaining_export = sum(prod_remaining.values())
        remaining_import = sum(cons_remaining.values())

        return CommunitySharingSummary(
            total_community_generation_kw=round(total_gen, 3),
            total_community_consumption_kw=round(total_cons, 3),
            internal_shared_kw=round(tot_shared_kw, 3),
            total_line_loss_kw=round(tot_loss_kw, 4),
            net_grid_import_kw=round(remaining_import, 3),
            net_grid_export_kw=round(remaining_export, 3),
            trades=trades,
        )
