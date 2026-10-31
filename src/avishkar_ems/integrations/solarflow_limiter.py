"""SolarFlow Integration: Zero-Export Feedback Limiter & Smart Relay Coordinator.

Adapted from https://github.com/lbsanto/SolarFlow (Apache-2.0 License)
Operating logic: Closed-loop active power limitation & Shelly device prioritization.

Provides:
1. Closed-loop PI (Proportional-Integral) controller for zero-export or target-export grid limiting.
2. Abstract device relay coordinator matching available surplus to prioritized loads.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import StrEnum


class RelayAction(StrEnum):
    NO_CHANGE = "NO_CHANGE"
    TURN_ON = "TURN_ON"
    TURN_OFF = "TURN_OFF"


@dataclass
class ControllableLoad:
    device_id: str
    name: str
    nominal_power_kw: float
    priority: int  # 1 = highest priority, 10 = lowest
    is_on: bool = False
    min_on_seconds: float = 120.0
    min_off_seconds: float = 60.0
    last_switched_timestamp: float = field(default_factory=time.time)


@dataclass
class InverterLimitDecision:
    target_grid_export_kw: float
    current_grid_export_kw: float
    error_kw: float
    suggested_inverter_power_kw: float
    is_throttled: bool
    reason: str


class SolarFlowLimiter:
    """Closed-loop zero-export limiter and Shelly-compatible relay coordinator."""

    def __init__(
        self,
        target_export_kw: float = 0.0,
        kp: float = 0.8,
        ki: float = 0.1,
        max_inverter_power_kw: float = 10.0,
        min_inverter_power_kw: float = 0.0,
    ) -> None:
        self.target_export_kw = target_export_kw
        self.kp = kp
        self.ki = ki
        self.max_inverter_power_kw = max_inverter_power_kw
        self.min_inverter_power_kw = min_inverter_power_kw
        self._integral_error: float = 0.0
        self._last_update: float = time.time()
        self._loads: dict[str, ControllableLoad] = {}

    def register_load(self, load: ControllableLoad) -> None:
        """Register a controllable relay load."""
        self._loads[load.device_id] = load

    def calculate_inverter_setpoint(
        self,
        current_solar_kw: float,
        current_grid_export_kw: float,
        current_time: float | None = None,
    ) -> InverterLimitDecision:
        """Computes adjusted inverter generation setpoint to enforce grid export ceiling.

        If current_grid_export_kw > target_export_kw, error is positive, throttles inverter.
        If current_grid_export_kw < target_export_kw, error is negative, allows more generation.
        """
        now = current_time if current_time is not None else time.time()
        dt = max(0.1, min(60.0, now - self._last_update))
        self._last_update = now

        # Error is positive if we are exporting more than permitted
        error = current_grid_export_kw - self.target_export_kw
        self._integral_error = max(-10.0, min(10.0, self._integral_error + error * dt))

        adjustment = (self.kp * error) + (self.ki * self._integral_error)

        # Inverter setpoint is reduced if error > 0
        target_power = current_solar_kw - adjustment
        clamped_power = max(
            self.min_inverter_power_kw,
            min(self.max_inverter_power_kw, target_power),
        )

        throttled = clamped_power < (current_solar_kw - 0.05)
        reason = (
            f"Zero-export throttle: current export {current_grid_export_kw:.2f}kW "
            f"exceeds target {self.target_export_kw:.2f}kW"
            if throttled
            else "Inverter unconstrained: export within permissible limits"
        )

        return InverterLimitDecision(
            target_grid_export_kw=self.target_export_kw,
            current_grid_export_kw=current_grid_export_kw,
            error_kw=round(error, 4),
            suggested_inverter_power_kw=round(clamped_power, 4),
            is_throttled=throttled,
            reason=reason,
        )

    def evaluate_relays(
        self,
        surplus_kw: float,
        current_time: float | None = None,
    ) -> list[tuple[str, RelayAction]]:
        """Determines relay switching actions based on available surplus and device priority."""
        now = current_time if current_time is not None else time.time()
        actions: list[tuple[str, RelayAction]] = []

        # Sort loads by priority (1 = highest priority first)
        sorted_loads = sorted(
            self._loads.values(),
            key=lambda item: (item.priority, item.nominal_power_kw),
        )
        remaining_surplus = max(0.0, surplus_kw)

        # 1. Turn ON candidate loads if surplus suffices and min_off time satisfied
        for load in sorted_loads:
            if not load.is_on:
                time_off = now - load.last_switched_timestamp
                if remaining_surplus >= load.nominal_power_kw and time_off >= load.min_off_seconds:
                    actions.append((load.device_id, RelayAction.TURN_ON))
                    load.is_on = True
                    load.last_switched_timestamp = now
                    remaining_surplus -= load.nominal_power_kw

        # 2. Shed loads (in reverse priority order: lowest priority first) if deficit occurs
        deficit = max(0.0, -surplus_kw)
        if deficit > 0.05:
            for load in reversed(sorted_loads):
                if load.is_on:
                    time_on = now - load.last_switched_timestamp
                    if time_on >= load.min_on_seconds:
                        actions.append((load.device_id, RelayAction.TURN_OFF))
                        load.is_on = False
                        load.last_switched_timestamp = now
                        deficit -= load.nominal_power_kw
                        if deficit <= 0.0:
                            break

        return actions
