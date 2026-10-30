"""Energy Manager Integration: Spot Price Spread Arbitrage & Peak Scheduler.

Adapted from https://github.com/jyourstone/energy_manager (Apache-2.0 License)
Module: custom_components/energy_manager/battery_scheduler.py (BATT-15 & BATT-17 algorithms).

Provides:
1. Spread-based candidate classification: profitable discharge when (price - min_price > discharge_threshold).
2. Peak grouping and virtual battery energy state simulation.
3. Round-trip efficiency accounting and export arbitrage opportunity identification.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ArbitrageAction(StrEnum):
    CHARGE = "CHARGE"
    DISCHARGE = "DISCHARGE"
    HOLD = "HOLD"
    EXPORT = "EXPORT"


@dataclass(frozen=True)
class TimeSlot:
    slot_index: int
    price: float
    expected_pv_kw: float = 0.0
    expected_load_kw: float = 1.0


@dataclass
class ArbitragePlanSlot:
    slot_index: int
    price: float
    action: ArbitrageAction
    battery_flow_kw: float  # Positive = charge, Negative = discharge
    simulated_soc_kwh: float
    expected_profit_margin: float


class EnergyArbitrageScheduler:
    """Spot-price battery arbitrage and multi-cycle peak scheduling."""

    def __init__(
        self,
        battery_capacity_kwh: float = 10.0,
        max_charge_power_kw: float = 3.0,
        max_discharge_power_kw: float = 3.0,
        roundtrip_efficiency: float = 0.90,
        min_soc_pct: float = 10.0,
        max_soc_pct: float = 95.0,
        discharge_spread_threshold: float = 0.08,  # €/kWh or $/kWh minimum margin
    ) -> None:
        self.battery_capacity_kwh = battery_capacity_kwh
        self.max_charge_power_kw = max_charge_power_kw
        self.max_discharge_power_kw = max_discharge_power_kw
        self.roundtrip_efficiency = roundtrip_efficiency
        self.min_soc_kwh = (min_soc_pct / 100.0) * battery_capacity_kwh
        self.max_soc_kwh = (max_soc_pct / 100.0) * battery_capacity_kwh
        self.discharge_spread_threshold = discharge_spread_threshold

    def plan_day_schedule(
        self,
        slots: list[TimeSlot],
        initial_soc_kwh: float,
        slot_duration_hours: float = 1.0,
    ) -> list[ArbitragePlanSlot]:
        """Plans optimal 24h arbitrage schedule using peak grouping and virtual battery tracking."""
        if not slots:
            return []

        prices = [s.price for s in slots]
        min_price = min(prices)
        max_price = max(prices)
        spread = max_price - min_price

        # If price volatility is less than round-trip losses + threshold, hold
        loss_penalty = min_price * (1.0 - self.roundtrip_efficiency)
        effective_threshold = self.discharge_spread_threshold + loss_penalty

        curr_soc = max(self.min_soc_kwh, min(self.max_soc_kwh, initial_soc_kwh))
        plan: list[ArbitragePlanSlot] = []

        # Find charging threshold (lowest 25%) and discharging threshold (highest 25%)
        sorted_prices = sorted(prices)
        n = len(sorted_prices)
        low_cutoff = sorted_prices[max(0, int(n * 0.25))]
        high_cutoff = sorted_prices[min(n - 1, int(n * 0.75))]

        for slot in slots:
            action = ArbitrageAction.HOLD
            flow_kw = 0.0
            margin = 0.0

            # Profitable charge condition: low price and room in battery
            if slot.price <= low_cutoff and spread > effective_threshold:
                headroom = self.max_soc_kwh - curr_soc
                if headroom > 0.1:
                    max_charge = min(self.max_charge_power_kw, headroom / slot_duration_hours)
                    flow_kw = max_charge
                    action = ArbitrageAction.CHARGE
                    curr_soc += (flow_kw * slot_duration_hours) * self.roundtrip_efficiency
                    margin = round(high_cutoff - slot.price, 4)

            # Profitable discharge condition: high price and energy in battery
            elif slot.price >= high_cutoff and (slot.price - min_price) >= effective_threshold:
                usable_energy = curr_soc - self.min_soc_kwh
                if usable_energy > 0.1:
                    max_dis = min(self.max_discharge_power_kw, usable_energy / slot_duration_hours)
                    # Discharge covers house load, extra can export if price very high
                    flow_kw = -max_dis
                    action = ArbitrageAction.EXPORT if slot.price > high_cutoff * 1.2 else ArbitrageAction.DISCHARGE
                    curr_soc -= (max_dis * slot_duration_hours)
                    margin = round(slot.price - min_price - loss_penalty, 4)

            plan.append(
                ArbitragePlanSlot(
                    slot_index=slot.slot_index,
                    price=slot.price,
                    action=action,
                    battery_flow_kw=round(flow_kw, 3),
                    simulated_soc_kwh=round(curr_soc, 3),
                    expected_profit_margin=margin,
                )
            )

        return plan
