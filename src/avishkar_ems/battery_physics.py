"""Battery physics, non-linear degradation and Rainflow cycle counting (ASTM E1049).

Models physical Lithium Iron Phosphate (LFP) battery wear:
1. ASTM E1049 Rainflow cycle counting and non-linear depth-of-discharge (DoD) power-law aging.
2. Arrhenius thermal aging acceleration (exponential degradation above 35°C in Indian summers).
3. Dynamic Inverter Efficiency Curve (Sandia / CEC model: drops at light loads <10%).
4. Ambient cell temperature C-rate derating and cycle-to-failure lifetime projections.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

# Thermal activation energy constants for LFP cells
ACTIVATION_ENERGY_J_MOL = 31500.0   # Ea for LFP graphite-LiFePO4 in J/mol
UNIVERSAL_GAS_CONSTANT = 8.314      # R in J/(mol*K)
T_REFERENCE_KELVIN = 298.15         # 25 deg C reference


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


@dataclass
class BatteryPhysicsResult:
    """Non-linear battery degradation and dynamic efficiency report."""
    base_wear_cost_inr: float
    dod_stress_multiplier: float
    temperature_celsius: float
    thermal_acceleration_factor: float
    effective_degradation_cost_inr: float
    inverter_loading_pct: float
    dynamic_inverter_efficiency_pct: float
    cycle_life_at_operating_point: int
    projected_calendar_lifespan_years: float


def calculate_arrhenius_thermal_factor(ambient_temp_c: float) -> float:
    """Calculates Arrhenius thermal degradation acceleration relative to 25°C."""
    t_kelvin = max(263.15, min(333.15, ambient_temp_c + 273.15))
    exponent = (ACTIVATION_ENERGY_J_MOL / UNIVERSAL_GAS_CONSTANT) * (
        (1.0 / T_REFERENCE_KELVIN) - (1.0 / t_kelvin)
    )
    # Clamp factor to realistic bounds [0.5, 4.5]
    return max(0.5, min(4.5, math.exp(exponent)))


def calculate_dod_stress_factor(depth_of_discharge_pct: float) -> float:
    """Calculates non-linear mechanical fatigue stress multiplier from cycle depth."""
    dod_ratio = max(0.05, min(1.0, depth_of_discharge_pct / 100.0))
    # Shallow cycles (20% DoD) have low stress; deep cycles (>80% DoD) accelerate micro-cracking
    return 0.4 + 2.2 * (dod_ratio ** 1.7)


def calculate_dynamic_inverter_efficiency(
    actual_power_kw: float,
    rated_inverter_kw: float,
    peak_efficiency: float = 0.965,
) -> float:
    """Calculates dynamic inverter conversion efficiency based on part-load curve."""
    if rated_inverter_kw <= 0:
        return 0.90
    load_ratio = max(0.01, min(1.2, actual_power_kw / rated_inverter_kw))

    # Sandia / CEC part-load polynomial: drops sharply under 10% load due to tare loss
    if load_ratio < 0.10:
        eff = 0.72 + (load_ratio / 0.10) * 0.18  # 72% at idle up to 90% at 10%
    else:
        # Near rated peak
        eff = peak_efficiency - 0.015 * ((load_ratio - 0.5) ** 2)
    return max(0.65, min(peak_efficiency, eff))


def evaluate_lfp_battery_physics(
    throughput_kwh: float,
    depth_of_discharge_pct: float = 75.0,
    ambient_temp_c: float = 38.0,
    actual_power_kw: float = 2.0,
    rated_inverter_kw: float = 3.0,
    base_wear_per_kwh_inr: float = 1.50,
) -> BatteryPhysicsResult:
    """Evaluates comprehensive physical LFP battery degradation and dynamic efficiency."""
    dod_factor = calculate_dod_stress_factor(depth_of_discharge_pct)
    thermal_factor = calculate_arrhenius_thermal_factor(ambient_temp_c)

    base_cost = throughput_kwh * base_wear_per_kwh_inr
    effective_cost = base_cost * dod_factor * thermal_factor

    inverter_loading = (actual_power_kw / rated_inverter_kw) * 100.0 if rated_inverter_kw > 0 else 50.0
    dynamic_eff = calculate_dynamic_inverter_efficiency(actual_power_kw, rated_inverter_kw)

    # LFP cycle life projection: nominal 5,000 cycles at 25C / 80% DoD
    base_cycles = 5000.0
    effective_cycles = int(base_cycles / (dod_factor * thermal_factor))
    projected_years = round(effective_cycles / 365.0, 1)

    return BatteryPhysicsResult(
        base_wear_cost_inr=round(base_cost, 2),
        dod_stress_multiplier=round(dod_factor, 2),
        temperature_celsius=round(ambient_temp_c, 1),
        thermal_acceleration_factor=round(thermal_factor, 2),
        effective_degradation_cost_inr=round(effective_cost, 2),
        inverter_loading_pct=round(inverter_loading, 1),
        dynamic_inverter_efficiency_pct=round(dynamic_eff * 100.0, 1),
        cycle_life_at_operating_point=effective_cycles,
        projected_calendar_lifespan_years=projected_years,
    )
