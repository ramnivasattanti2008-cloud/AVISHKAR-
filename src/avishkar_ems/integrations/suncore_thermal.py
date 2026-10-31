"""SunCore Integration: Thermal Immersion & Heat Pump Buffer Allocator.

Adapted from https://github.com/PXLJAKE/SunCore (Apache-2.0 License)
Modules: suncore/controller/allocation.py, hysteresis.py, and surplus.py.

Provides:
1. Headroom-based stepped thermal load allocation (immersion heaters, heat pumps).
2. Anti-flicker hysteresis bands and attributable deficit battery buffering.
3. Anti-wear minimum run time and settling delays.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import StrEnum


class ThermalDeviceType(StrEnum):
    IMMERSION_HEATER = "IMMERSION_HEATER"
    HEAT_PUMP = "HEAT_PUMP"
    WATER_HEATER = "WATER_HEATER"


@dataclass
class ThermalDevice:
    device_id: str
    device_type: ThermalDeviceType
    power_steps_kw: list[float]  # e.g. [0.0, 1.0, 2.0, 3.0] kW
    current_step_idx: int = 0
    min_run_s: float = 180.0
    settle_s: float = 30.0
    last_transition_ts: float = field(default_factory=time.time)

    @property
    def current_power_kw(self) -> float:
        if 0 <= self.current_step_idx < len(self.power_steps_kw):
            return self.power_steps_kw[self.current_step_idx]
        return 0.0


@dataclass
class ThermalAllocationResult:
    device_id: str
    allocated_step_idx: int
    allocated_power_kw: float
    transition_occurred: bool
    reason: str


class SunCoreThermalBuffer:
    """Stepped thermal allocator with hysteresis and battery deficit buffering."""

    def __init__(
        self,
        hysteresis_w: float = 200.0,
        deficit_delay_s: float = 60.0,
        deficit_budget_kwh: float = 0.5,
    ) -> None:
        self.hysteresis_w = hysteresis_w
        self.deficit_delay_s = deficit_delay_s
        self.deficit_budget_kwh = deficit_budget_kwh
        self._deficit_consumed_kwh: float = 0.0
        self._deficit_start_ts: float | None = None
        self._devices: dict[str, ThermalDevice] = {}

    def register_device(self, device: ThermalDevice) -> None:
        self._devices[device.device_id] = device

    def allocate(
        self,
        device_id: str,
        available_surplus_kw: float,
        battery_reserve_pct: float = 50.0,
        battery_current_soc: float = 80.0,
        current_time: float | None = None,
    ) -> ThermalAllocationResult:
        """Evaluates whether to ramp thermal power up or back off."""
        now = current_time if current_time is not None else time.time()
        dev = self._devices.get(device_id)
        if not dev:
            raise KeyError(f"Unknown device: {device_id}")

        curr_power = dev.current_power_kw
        headroom_kw = available_surplus_kw - curr_power
        time_since_last = now - dev.last_transition_ts

        # Check for stepping up
        hysteresis_kw = self.hysteresis_w / 1000.0
        next_step_idx = dev.current_step_idx + 1

        if next_step_idx < len(dev.power_steps_kw):
            next_power = dev.power_steps_kw[next_step_idx]
            additional_needed = next_power - curr_power

            # Rise condition: available headroom covers additional need + hysteresis
            if headroom_kw >= (additional_needed + hysteresis_kw) and time_since_last >= dev.settle_s:
                dev.current_step_idx = next_step_idx
                dev.last_transition_ts = now
                self._deficit_start_ts = None
                return ThermalAllocationResult(
                    device_id=dev.device_id,
                    allocated_step_idx=next_step_idx,
                    allocated_power_kw=next_power,
                    transition_occurred=True,
                    reason=f"Stepped up: surplus {available_surplus_kw:.2f}kW covers need",
                )

        # Check for deficit / stepping down
        if headroom_kw < -hysteresis_kw and dev.current_step_idx > 0:
            # Check if battery can buffer the deficit
            can_buffer = (
                battery_current_soc > battery_reserve_pct
                and self._deficit_consumed_kwh < self.deficit_budget_kwh
            )

            if can_buffer:
                if self._deficit_start_ts is None:
                    self._deficit_start_ts = now
                dt_hours = (now - self._deficit_start_ts) / 3600.0
                deficit_kw = abs(headroom_kw)
                self._deficit_consumed_kwh += deficit_kw * dt_hours

                # If still within deficit delay tolerance, hold level
                if (now - self._deficit_start_ts) < self.deficit_delay_s:
                    return ThermalAllocationResult(
                        device_id=dev.device_id,
                        allocated_step_idx=dev.current_step_idx,
                        allocated_power_kw=curr_power,
                        transition_occurred=False,
                        reason="Deficit buffered by battery storage",
                    )

            # Deficit buffering expired or unavailable -> back off
            if time_since_last >= dev.min_run_s:
                dev.current_step_idx = max(0, dev.current_step_idx - 1)
                dev.last_transition_ts = now
                self._deficit_start_ts = None
                return ThermalAllocationResult(
                    device_id=dev.device_id,
                    allocated_step_idx=dev.current_step_idx,
                    allocated_power_kw=dev.current_power_kw,
                    transition_occurred=True,
                    reason="Backed off to protect battery and grid import limits",
                )

        return ThermalAllocationResult(
            device_id=dev.device_id,
            allocated_step_idx=dev.current_step_idx,
            allocated_power_kw=curr_power,
            transition_occurred=False,
            reason="Maintained stable operating level",
        )
