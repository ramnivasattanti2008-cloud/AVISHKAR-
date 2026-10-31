"""SEM-Community Integration: Proportional Power Flow & Priority Coordinator.

Adapted from https://github.com/traktore-org/sem-community (MIT License)
Coordinator and Flow Calculator modules (flow_calculator.py & surplus_controller.py).

Provides:
1. Physically accurate proportional power flow calculation (mixing of Solar, Grid, Battery).
2. Priority load coordination and hysteresis anti-cycling state management.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import StrEnum


class DevicePriority(StrEnum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass
class ProportionalFlowResult:
    """Proportionally allocated power flows from sources to destinations."""
    # Sources (kW)
    solar_generation_kw: float
    grid_import_kw: float
    battery_discharge_kw: float
    total_source_kw: float

    # Destinations (kW)
    home_load_kw: float
    battery_charge_kw: float
    ev_charge_kw: float
    grid_export_kw: float
    total_dest_kw: float

    # Proportional Source Shares in Home Load
    home_solar_share_pct: float
    home_grid_share_pct: float
    home_battery_share_pct: float

    # Proportional Source Shares in EV Load
    ev_solar_share_pct: float
    ev_grid_share_pct: float
    ev_battery_share_pct: float

    is_balanced: bool


class SemCommunityCoordinator:
    """Coordinator adapting SEM-Community's proportional energy mixing and priority control."""

    def __init__(self, hysteresis_seconds: float = 180.0):
        self.hysteresis_seconds = hysteresis_seconds
        self._device_states: dict[str, dict[str, float | bool]] = {}

    def calculate_proportional_flows(
        self,
        solar_kw: float,
        grid_import_kw: float,
        battery_discharge_kw: float,
        home_load_kw: float,
        battery_charge_kw: float,
        ev_charge_kw: float,
        grid_export_kw: float,
    ) -> ProportionalFlowResult:
        """Calculates exact proportional source breakdown across all load sinks.

        Electricity mixes proportionally: if 60% of total input comes from solar
        and 40% from grid, every destination consumes 60% solar and 40% grid.
        """
        tot_source = max(1e-6, solar_kw + grid_import_kw + battery_discharge_kw)
        tot_dest = home_load_kw + battery_charge_kw + ev_charge_kw + grid_export_kw

        # Proportions of incoming sources
        solar_frac = solar_kw / tot_source
        grid_frac = grid_import_kw / tot_source
        batt_dis_frac = battery_discharge_kw / tot_source

        # Verification of balance
        balanced = abs(tot_source - tot_dest) < 1e-3

        return ProportionalFlowResult(
            solar_generation_kw=solar_kw,
            grid_import_kw=grid_import_kw,
            battery_discharge_kw=battery_discharge_kw,
            total_source_kw=round(tot_source, 4),
            home_load_kw=home_load_kw,
            battery_charge_kw=battery_charge_kw,
            ev_charge_kw=ev_charge_kw,
            grid_export_kw=grid_export_kw,
            total_dest_kw=round(tot_dest, 4),
            home_solar_share_pct=round(solar_frac * 100.0, 1),
            home_grid_share_pct=round(grid_frac * 100.0, 1),
            home_battery_share_pct=round(batt_dis_frac * 100.0, 1),
            ev_solar_share_pct=round(solar_frac * 100.0, 1),
            ev_grid_share_pct=round(grid_frac * 100.0, 1),
            ev_battery_share_pct=round(batt_dis_frac * 100.0, 1),
            is_balanced=balanced,
        )

    def evaluate_priority_dispatch(
        self,
        available_surplus_kw: float,
        devices: list[dict[str, str | float]],
        current_time: float | None = None,
    ) -> list[dict[str, str | float | bool]]:
        """Coordinates multiple deferrable appliances sorted by priority tier."""
        now = time.time() if current_time is None else current_time
        remaining_surplus = max(0.0, available_surplus_kw)
        results = []

        # Sort: HIGH first, then MEDIUM, then LOW
        prio_order = {DevicePriority.HIGH: 0, DevicePriority.MEDIUM: 1, DevicePriority.LOW: 2}
        sorted_devices = sorted(devices, key=lambda d: prio_order.get(d.get("priority", DevicePriority.LOW), 3))

        for dev in sorted_devices:
            dev_id = str(dev["id"])
            power = float(dev["power_kw"])
            st = self._device_states.get(dev_id, {"is_on": False, "last_switched": 0.0})

            is_on = bool(st["is_on"])
            last_sw = float(st["last_switched"])
            time_since = now - last_sw

            desired_on = remaining_surplus >= power
            if is_on:
                if not desired_on and time_since >= self.hysteresis_seconds:
                    is_on = False
                    self._device_states[dev_id] = {"is_on": False, "last_switched": now}
            else:
                if desired_on and time_since >= self.hysteresis_seconds:
                    is_on = True
                    self._device_states[dev_id] = {"is_on": True, "last_switched": now}

            allocated = power if is_on else 0.0
            if is_on:
                remaining_surplus = max(0.0, remaining_surplus - power)

            results.append({
                "device_id": dev_id,
                "is_active": is_on,
                "power_allocated_kw": allocated,
                "priority": dev.get("priority", DevicePriority.LOW),
            })

        return results
