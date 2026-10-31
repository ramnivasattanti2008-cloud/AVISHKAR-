"""Smart Energy Manager Integration: Dynamic Price Window Analyzer & Inverter Register Dispatch.

Adapted from https://github.com/jirihelmich/smart-energy-manager (MIT License)
Modules: price_analyzer.py, charging_controller.py, and inverter register models.

Provides:
1. Pure Python 24h dynamic price slot parsing, percentile categorization, and cheapest window discovery.
2. Inverter register map translation (Victron, GoodWe, Solax, Sungrow) for direct hardware setpoints.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class InverterBrand(StrEnum):
    GENERIC = "GENERIC"
    VICTRON = "VICTRON"
    GOODWE = "GOODWE"
    SOLAX = "SOLAX"
    SUNGROW = "SUNGROW"


@dataclass(frozen=True)
class PriceSlot:
    hour: int
    price: float


@dataclass
class CheapestWindow:
    start_hour: int
    end_hour: int
    duration_hours: int
    avg_price: float
    slots: list[PriceSlot]


@dataclass
class InverterRegisterCommand:
    brand: InverterBrand
    register_address: int
    value: int | float
    description: str


class SmartBatteryScheduler:
    """Dynamic tariff analyzer and multi-brand inverter register translator."""

    def __init__(
        self,
        night_window_start: int = 22,
        night_window_end: int = 6,
    ) -> None:
        self.night_window_start = night_window_start
        self.night_window_end = night_window_end

    def find_cheapest_charging_window(
        self,
        hourly_prices: list[float],
        required_hours: int = 3,
    ) -> CheapestWindow:
        """Finds the contiguous block of hours with the lowest average price."""
        if not hourly_prices:
            raise ValueError("hourly_prices list cannot be empty")

        n = len(hourly_prices)
        req = max(1, min(required_hours, n))

        slots = [PriceSlot(hour=i, price=p) for i, p in enumerate(hourly_prices)]
        best_avg = float("inf")
        best_start = 0

        for start in range(n - req + 1):
            window = slots[start : start + req]
            avg = sum(s.price for s in window) / req
            if avg < best_avg:
                best_avg = avg
                best_start = start

        selected_slots = slots[best_start : best_start + req]
        return CheapestWindow(
            start_hour=best_start,
            end_hour=(best_start + req) % 24,
            duration_hours=req,
            avg_price=round(best_avg, 4),
            slots=selected_slots,
        )

    def classify_price_percentiles(
        self,
        hourly_prices: list[float],
        low_pct: float = 25.0,
        high_pct: float = 75.0,
    ) -> dict[str, float]:
        """Calculates dynamic price thresholds using quantiles."""
        if not hourly_prices:
            return {"low_threshold": 0.0, "high_threshold": 0.0, "median": 0.0}

        sorted_p = sorted(hourly_prices)
        n = len(sorted_p)

        def _quantile(q: float) -> float:
            idx = (n - 1) * (q / 100.0)
            floor_idx = int(idx)
            ceil_idx = min(n - 1, floor_idx + 1)
            frac = idx - floor_idx
            return sorted_p[floor_idx] + frac * (sorted_p[ceil_idx] - sorted_p[floor_idx])

        return {
            "low_threshold": round(_quantile(low_pct), 4),
            "median": round(_quantile(50.0), 4),
            "high_threshold": round(_quantile(high_pct), 4),
        }

    def generate_inverter_commands(
        self,
        brand: InverterBrand,
        target_charge_power_w: float,
        target_discharge_power_w: float,
        force_charge: bool = False,
    ) -> list[InverterRegisterCommand]:
        """Translates high-level charge/discharge targets into standard Modbus registers."""
        commands: list[InverterRegisterCommand] = []

        if brand == InverterBrand.VICTRON:
            # Victron ESS Modbus TCP registers (unit ID 100, com.victronenergy.settings)
            # Register 2700: ESS max charge power (W)
            # Register 2701: ESS max discharge power (W)
            commands.append(
                InverterRegisterCommand(
                    brand=brand,
                    register_address=2700,
                    value=round(target_charge_power_w),
                    description="Victron ESS Max Charge Power Limit (W)",
                )
            )
            commands.append(
                InverterRegisterCommand(
                    brand=brand,
                    register_address=2701,
                    value=round(target_discharge_power_w),
                    description="Victron ESS Max Discharge Power Limit (W)",
                )
            )
        elif brand == InverterBrand.GOODWE:
            # GoodWe register 47511: Storage charge power limit (W)
            # Register 47512: Storage discharge power limit (W)
            # Register 47531: Force charge mode switch
            commands.append(
                InverterRegisterCommand(
                    brand=brand,
                    register_address=47511,
                    value=round(target_charge_power_w),
                    description="GoodWe Battery Charge Power Limit (W)",
                )
            )
            commands.append(
                InverterRegisterCommand(
                    brand=brand,
                    register_address=47531,
                    value=1 if force_charge else 0,
                    description="GoodWe Force Charge Mode Enable",
                )
            )
        elif brand == InverterBrand.SOLAX:
            # SolaX Gen4 register 0x008A: Forced charge power
            commands.append(
                InverterRegisterCommand(
                    brand=brand,
                    register_address=138,
                    value=round(target_charge_power_w),
                    description="SolaX Forced Charge Power Setpoint (W)",
                )
            )
        elif brand == InverterBrand.SUNGROW:
            # Sungrow register 13050: Battery charge/discharge power limit
            commands.append(
                InverterRegisterCommand(
                    brand=brand,
                    register_address=13050,
                    value=round(target_charge_power_w if force_charge else -target_discharge_power_w),
                    description="Sungrow Signed Active Power Setpoint (W, positive=charge)",
                )
            )
        else:
            commands.append(
                InverterRegisterCommand(
                    brand=InverterBrand.GENERIC,
                    register_address=1000,
                    value=round(target_charge_power_w),
                    description="Generic Inverter Charge Target (W)",
                )
            )

        return commands
