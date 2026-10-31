"""EVCC Core Integration: EV Smart Solar Charging State Machine.

Adapted from https://github.com/evcc-io/evcc (Apache-2.0 License)
Core Loadpoint & Site Controller (loadpoint.go & site.go).

Provides:
1. 4 Industry-Standard Charging Modes: OFF, NOW, MIN_PV, PV.
2. Contactor protection delays (3-minute anti-cycling).
3. Single-phase (1P) and Three-phase (3P) current modulation.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import StrEnum


class EvccMode(StrEnum):
    OFF = "off"
    NOW = "now"
    MIN_PV = "minpv"
    PV = "pv"


class ChargerPhase(StrEnum):
    SINGLE_PHASE = "1P"
    THREE_PHASE = "3P"


@dataclass
class EvccDispatchResult:
    mode: EvccMode
    charge_power_kw: float
    is_charging: bool
    phases: ChargerPhase
    from_solar_kw: float
    from_grid_kw: float
    reason: str


class EvccChargerController:
    """EV charging state machine adapted from evcc-io/evcc."""

    def __init__(
        self,
        min_current_a: float = 6.0,
        max_current_a: float = 32.0,
        voltage_v: float = 230.0,
        enable_delay_s: float = 60.0,
        disable_delay_s: float = 180.0,
    ):
        self.min_current_a = min_current_a
        self.max_current_a = max_current_a
        self.voltage_v = voltage_v
        self.enable_delay_s = enable_delay_s
        self.disable_delay_s = disable_delay_s

        # Internal state
        self._is_charging: bool = False
        self._surplus_start_ts: float | None = None
        self._deficit_start_ts: float | None = None
        self._last_state_change_ts: float = 0.0

    @property
    def min_power_1p_kw(self) -> float:
        """Minimum 1-phase power: 6A * 230V = 1.38 kW."""
        return round((self.min_current_a * self.voltage_v) / 1000.0, 2)

    @property
    def min_power_3p_kw(self) -> float:
        """Minimum 3-phase power: 3 * 6A * 230V = 4.14 kW."""
        return round((3.0 * self.min_current_a * self.voltage_v) / 1000.0, 2)

    def dispatch(
        self,
        mode: EvccMode,
        available_surplus_kw: float,
        phases: ChargerPhase = ChargerPhase.SINGLE_PHASE,
        car_connected: bool = True,
        car_soc_pct: float = 50.0,
        target_soc_pct: float = 80.0,
        current_time: float | None = None,
    ) -> EvccDispatchResult:
        """Alias for evaluate_charging."""
        return self.evaluate_charging(
            mode=mode,
            available_surplus_kw=available_surplus_kw,
            phases=phases,
            car_connected=car_connected,
            car_soc_pct=car_soc_pct,
            target_soc_pct=target_soc_pct,
            current_time=current_time,
        )

    def evaluate_charging(
        self,
        mode: EvccMode,
        available_surplus_kw: float,
        phases: ChargerPhase = ChargerPhase.SINGLE_PHASE,
        car_connected: bool = True,
        car_soc_pct: float = 50.0,
        target_soc_pct: float = 80.0,
        current_time: float | None = None,
    ) -> EvccDispatchResult:
        """Executes evcc loadpoint decision loop."""
        now = time.time() if current_time is None else current_time
        min_p = self.min_power_1p_kw if phases == ChargerPhase.SINGLE_PHASE else self.min_power_3p_kw
        max_p = round((self.max_current_a * self.voltage_v * (1 if phases == ChargerPhase.SINGLE_PHASE else 3)) / 1000.0, 2)

        if not car_connected or car_soc_pct >= target_soc_pct or mode == EvccMode.OFF:
            self._is_charging = False
            return EvccDispatchResult(mode, 0.0, False, phases, 0.0, 0.0, "Car disconnected, full, or charger turned off")

        if mode == EvccMode.NOW:
            self._is_charging = True
            from_sun = min(available_surplus_kw, max_p)
            from_grid = max_p - from_sun
            return EvccDispatchResult(mode, max_p, True, phases, from_sun, from_grid, "Charging at maximum rated current")

        elif mode == EvccMode.MIN_PV:
            self._is_charging = True
            # Guaranteed minimum baseline
            base_from_sun = min(available_surplus_kw, min_p)
            base_from_grid = min_p - base_from_sun
            # Surplus boost
            rem_surplus = max(0.0, available_surplus_kw - base_from_sun)
            boost = min(rem_surplus, max_p - min_p)
            tot_p = min_p + boost
            tot_sun = base_from_sun + boost
            return EvccDispatchResult(mode, tot_p, True, phases, tot_sun, base_from_grid, "Min+PV charging with solar boost")

        elif mode == EvccMode.PV:
            # Strict surplus charging
            if available_surplus_kw >= min_p:
                if self._surplus_start_ts is None:
                    self._surplus_start_ts = now
                self._deficit_start_ts = None

                sustain_time = now - self._surplus_start_ts
                if not self._is_charging and (sustain_time >= self.enable_delay_s or self.enable_delay_s <= 0.0):
                    self._is_charging = True
                    self._last_state_change_ts = now

            else:
                if self._deficit_start_ts is None:
                    self._deficit_start_ts = now
                self._surplus_start_ts = None

                deficit_time = now - self._deficit_start_ts
                if self._is_charging and deficit_time >= self.disable_delay_s:
                    self._is_charging = False
                    self._last_state_change_ts = now

            if self._is_charging:
                charge_p = min(available_surplus_kw, max_p)
                return EvccDispatchResult(mode, charge_p, True, phases, charge_p, 0.0, "Pure PV surplus charging active")
            else:
                return EvccDispatchResult(mode, 0.0, False, phases, 0.0, 0.0, "Surplus below minimum start threshold")

        return EvccDispatchResult(mode, 0.0, False, phases, 0.0, 0.0, "Unknown mode")
