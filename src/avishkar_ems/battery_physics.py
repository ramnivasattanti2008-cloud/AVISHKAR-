"""Advanced Non-Linear Battery Physics & Inverter Efficiency Model for UrjaSetu EMS.

Replaces naive linear battery wear with physical Lithium Iron Phosphate (LFP) models:
1. Non-linear Depth-of-Discharge (DoD) stress factor (Wöhler curve).
2. Arrhenius thermal aging acceleration (exponential degradation above 35°C in Indian summers).
3. Dynamic Inverter Efficiency Curve (Sandia / CEC model: drops at light loads <10%).
4. Battery State-of-Health (SOH) and cycle-to-failure lifetime projection.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Thermal activation energy constants for LFP cells
ACTIVATION_ENERGY_J_MOL = 31500.0   # Ea for LFP graphite-LiFePO4
UNIVERSAL_GAS_CONSTANT = 8.314      # R in J/(mol*K)
T_REFERENCE_KELVIN = 298.15         # 25 deg C reference


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
