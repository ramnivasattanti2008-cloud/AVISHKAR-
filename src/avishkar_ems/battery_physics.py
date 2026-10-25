"""Battery physics, non-linear degradation and Rainflow cycle counting (ASTM E1049).

Models battery degradation as a non-linear function of depth-of-discharge (DoD),
cell ambient temperature, and cycling stress. Pure software calculations without
requiring hardware BMS access.
"""

from __future__ import annotations

import math
from collections.abc import Sequence


def rainflow_count_cycles(soc_series: Sequence[float]) -> list[tuple[float, float]]:
    """Extract half and full cycles from an SOC series using ASTM E1049 rainflow algorithm.

    Returns a list of (range, count) tuples where range is depth-of-discharge (0.0 to 1.0)
    and count is 0.5 (half cycle) or 1.0 (full cycle).
    """
    if len(soc_series) < 3:
        return []

    # 1. Filter out consecutive duplicate points and find local extrema (peaks & valleys)
    extrema = [soc_series[0]]
    for i in range(1, len(soc_series) - 1):
        prev_val, curr_val, next_val = soc_series[i - 1], soc_series[i], soc_series[i + 1]
        if (curr_val > prev_val and curr_val >= next_val) or (curr_val < prev_val and curr_val <= next_val):
            if abs(curr_val - extrema[-1]) > 1e-4:
                extrema.append(curr_val)
    if abs(soc_series[-1] - extrema[-1]) > 1e-4:
        extrema.append(soc_series[-1])

    if len(extrema) < 3:
        return []

    # 2. ASTM E1049 Four-point rainflow cycle counting
    cycles: list[tuple[float, float]] = []
    stack = list(extrema)
    i = 0
    while len(stack) >= 3 and i < len(stack) - 2:
        s0, s1, s2 = stack[i], stack[i + 1], stack[i + 2]
        delta_r1 = abs(s1 - s0)
        delta_r2 = abs(s2 - s1)

        if delta_r1 <= delta_r2:
            # Count cycle
            if i == 0:
                cycles.append((delta_r1, 0.5))
                stack.pop(0)
            else:
                cycles.append((delta_r1, 1.0))
                stack.pop(i + 1)
                stack.pop(i)
                i = max(0, i - 1)
        else:
            i += 1

    # Any remaining range in stack counts as half cycles
    while len(stack) >= 2:
        delta_r = abs(stack[1] - stack[0])
        cycles.append((delta_r, 0.5))
        stack.pop(0)

    return cycles


def nonlinear_wear_cost_per_kwh(
    dod: float,
    cell_replacement_cost_inr: float = 25000.0,
    nominal_cycles_at_80dod: float = 4000.0,
    alpha: float = 1.8,
) -> float:
    """Calculate the marginal degradation wear cost (INR/kWh) as a function of depth-of-discharge.

    Higher depths of discharge (>80%) incur non-linear accelerated degradation.
    """
    safe_dod = min(max(dod, 0.05), 1.0)
    # Power-law relationship for battery cycle life vs. DoD
    # Normalized so that at DoD = 0.8, cost equals replacement_cost / (2 * cycles * 0.8)
    base_wear = cell_replacement_cost_inr / (2.0 * nominal_cycles_at_80dod * 0.8)
    dod_multiplier = math.pow(safe_dod / 0.8, alpha - 1.0)
    return round(base_wear * dod_multiplier, 4)


def temperature_c_rate_derating(temp_celsius: float, nominal_c_rate: float = 0.5) -> float:
    """Calculate maximum safe continuous C-rate as a function of ambient cell temperature.

    Derates above 35°C to avoid accelerated lithium plating and capacity fade.
    """
    if temp_celsius <= 10.0:
        # Cold temperature derate: cold battery cannot absorb fast charging
        derate_factor = max(0.2, (temp_celsius + 10.0) / 20.0)
    elif 10.0 < temp_celsius <= 35.0:
        # Optimal operating zone
        derate_factor = 1.0
    elif 35.0 < temp_celsius <= 45.0:
        # High temperature thermal derating
        derate_factor = max(0.4, 1.0 - (temp_celsius - 35.0) * 0.05)
    else:
        # Severe heat protection (>45°C)
        derate_factor = 0.2

    return round(nominal_c_rate * derate_factor, 3)
