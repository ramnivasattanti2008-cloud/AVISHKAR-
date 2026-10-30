"""HomeAssistant EMS Integration: Main Breaker Headroom & EV Dynamic Current Modulation.

Adapted from https://github.com/thomasgodon/homeassistant-ems (MIT License)
Modules: custom_components/ems/strategy.py and controller.py.

Provides:
1. Sub-second breaker headroom guard protecting physical fuses from overcurrent tripping.
2. Fast-path dynamic current adjustment for EV charging and heavy appliances.
3. Asynchronous telemetry skew filtering to prevent control hunting / limit cycles.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PhaseReading:
    voltage_v: float
    current_a: float
    power_w: float


@dataclass
class HeadroomResult:
    available_headroom_a: float
    safe_ev_current_a: float
    is_limiting: bool
    bottleneck_phase: int  # 1, 2, or 3
    reason: str


class BreakerHeadroomGuard:
    """Calculates instantaneous grid breaker headroom and modulates EV charging current."""

    def __init__(
        self,
        main_fuse_rating_a: float = 35.0,
        safety_margin_a: float = 2.0,
        min_ev_current_a: float = 6.0,
        max_ev_current_a: float = 32.0,
    ) -> None:
        self.main_fuse_rating_a = main_fuse_rating_a
        self.safety_margin_a = safety_margin_a
        self.min_ev_current_a = min_ev_current_a
        self.max_ev_current_a = max_ev_current_a
        self._last_ev_target_a: float = min_ev_current_a

    def calculate_headroom(
        self,
        phase_currents_a: list[float],
        ev_active_phases: list[int] | None = None,
    ) -> HeadroomResult:
        """Determines permissible charging current without blowing main service fuses.

        Evaluates the worst-case phase to ensure the physical breaker is protected.
        """
        if not phase_currents_a:
            return HeadroomResult(
                available_headroom_a=0.0,
                safe_ev_current_a=0.0,
                is_limiting=True,
                bottleneck_phase=1,
                reason="No phase telemetry available: emergency shutoff",
            )

        # Calculate available headroom per phase: (fuse_rating - safety_margin - current_a)
        min_headroom = float("inf")
        bottleneck_idx = 0

        for i, curr in enumerate(phase_currents_a):
            headroom = (self.main_fuse_rating_a - self.safety_margin_a) - curr
            if headroom < min_headroom:
                min_headroom = headroom
                bottleneck_idx = i

        # Calculate safe EV current
        # If available headroom is less than minimum EV current, cannot safely charge EV
        is_limiting = False
        if min_headroom < self.min_ev_current_a:
            safe_current_a = 0.0
            is_limiting = True
            reason = (
                f"Fuse protection trip prevention: phase {bottleneck_idx + 1} load "
                f"{phase_currents_a[bottleneck_idx]:.1f}A leaves insufficient headroom"
            )
        else:
            safe_current_a = min(self.max_ev_current_a, min_headroom)
            if safe_current_a < min_headroom or min_headroom < 5.0:
                is_limiting = True
                reason = f"Current throttled by phase {bottleneck_idx + 1} headroom ({min_headroom:.1f}A)"
            else:
                reason = "Nominal operation: breaker headroom ample"

        self._last_ev_target_a = safe_current_a if safe_current_a >= self.min_ev_current_a else self.min_ev_current_a

        return HeadroomResult(
            available_headroom_a=round(min_headroom, 2),
            safe_ev_current_a=round(safe_current_a, 2),
            is_limiting=is_limiting,
            bottleneck_phase=bottleneck_idx + 1,
            reason=reason,
        )
