"""Battery degradation and health physics engine (spec sections 25 & 84).

Implements:
1. ASTM E1049 Rainflow cycle counting on battery state-of-charge trajectories.
2. Non-linear Depth-of-Discharge (DoD) degradation power-law modeling.
3. Ambient temperature thermal derating curves (Arrhenius kinetics).
4. Remaining useful life (RUL) and State-of-Health (SOH) estimation.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from pydantic import Field

from avishkar_engine.schemas import Wire


class DegradationRequest(Wire):
    soc_kwh: list[float] = Field(min_length=3, description="SOC trajectory in kWh")
    capacity_kwh: float = Field(gt=0, description="Nominal battery storage capacity in kWh")
    nominal_cycle_life: float = Field(default=4000.0, gt=0, description="Cycle life at 80% DoD to 80% SOH")
    replacement_cost_inr: float = Field(default=30000.0, ge=0, description="Cell replacement cost in INR per unit")
    cell_temperature_celsius: float | None = Field(default=25.0, ge=-20, le=70, description="Ambient cell temperature")
    max_charge_kw: float = Field(default=5.0, gt=0, description="Rated peak charge power")
    max_discharge_kw: float = Field(default=5.0, gt=0, description="Rated peak discharge power")
    operational_days: float = Field(default=1.0, gt=0, description="Time span represented by the SOC profile in days")


class DegradationResponse(Wire):
    equivalent_full_cycles: float
    rainflow_cycle_count: int
    dod_distribution: dict[str, int]
    cycle_capacity_loss_percent: float
    calendar_capacity_loss_percent: float
    total_capacity_loss_percent: float
    state_of_health_percent: float
    wear_cost_inr: float
    estimated_remaining_cycles: float
    thermal_derate_factor: float
    derated_max_charge_kw: float
    derated_max_discharge_kw: float
    summary_verdict: str


def rainflow_count(soc_normalized: Sequence[float]) -> list[tuple[float, float]]:
    """ASTM E1049 four-point cycle counting algorithm.
    Returns list of (range_dod, count) where count is 0.5 (half-cycle) or 1.0 (full cycle).
    """
    if len(soc_normalized) < 3:
        return []

    # 1. Eliminate adjacent duplicates and find local reversal peaks/valleys
    extrema = [soc_normalized[0]]
    for i in range(1, len(soc_normalized) - 1):
        prev_val, curr_val, next_val = soc_normalized[i - 1], soc_normalized[i], soc_normalized[i + 1]
        if (curr_val > prev_val and curr_val >= next_val) or (curr_val < prev_val and curr_val <= next_val):
            if abs(curr_val - extrema[-1]) > 1e-5:
                extrema.append(curr_val)
    if abs(soc_normalized[-1] - extrema[-1]) > 1e-5:
        extrema.append(soc_normalized[-1])

    if len(extrema) < 3:
        return []

    # 2. Four-point rainflow processing
    cycles: list[tuple[float, float]] = []
    stack = list(extrema)
    idx = 0
    while len(stack) >= 3 and idx < len(stack) - 2:
        s0, s1, s2 = stack[idx], stack[idx + 1], stack[idx + 2]
        r1 = abs(s1 - s0)
        r2 = abs(s2 - s1)

        if r1 <= r2:
            if idx == 0:
                cycles.append((r1, 0.5))
                stack.pop(0)
            else:
                cycles.append((r1, 1.0))
                stack.pop(idx + 1)
                stack.pop(idx)
                idx = max(0, idx - 1)
        else:
            idx += 1

    while len(stack) >= 2:
        r = abs(stack[1] - stack[0])
        cycles.append((r, 0.5))
        stack.pop(0)

    return cycles


def compute_thermal_derating(temp_celsius: float) -> float:
    """Calculate thermal C-rate derating factor for LFP/NMC cells.
    Safe zone is 15°C to 35°C. Derates sub-linear in cold, linear derate in heat.
    """
    if temp_celsius <= 0.0:
        return 0.2
    if 0.0 < temp_celsius < 15.0:
        return max(0.25, round(0.25 + (temp_celsius / 15.0) * 0.75, 3))
    if 15.0 <= temp_celsius <= 35.0:
        return 1.0
    if 35.0 < temp_celsius <= 45.0:
        return max(0.4, round(1.0 - (temp_celsius - 35.0) * 0.05, 3))
    return 0.2


def analyze_degradation(req: DegradationRequest) -> DegradationResponse:
    cap = req.capacity_kwh
    soc_norm = [min(max(v / cap, 0.0), 1.0) for v in req.soc_kwh]
    cycles = rainflow_count(soc_norm)

    dod_dist = {"shallow_under_20pct": 0, "moderate_20_to_50pct": 0, "standard_50_to_80pct": 0, "deep_over_80pct": 0}
    efc = 0.0
    wear_cost = 0.0
    cycle_loss_pct = 0.0

    # Non-linear power law: exponent alpha = 1.8 for LFP chemistry
    alpha = 1.8
    ref_dod = 0.8
    base_wear_per_cycle = req.replacement_cost_inr / max(req.nominal_cycle_life, 1.0)

    for dod, count in cycles:
        if dod < 0.20:
            dod_dist["shallow_under_20pct"] += 1
        elif dod < 0.50:
            dod_dist["moderate_20_to_50pct"] += 1
        elif dod <= 0.80:
            dod_dist["standard_50_to_80pct"] += 1
        else:
            dod_dist["deep_over_80pct"] += 1

        efc += (dod * count)
        severity = math.pow(max(dod, 0.02) / ref_dod, alpha)
        wear_cost += count * base_wear_per_cycle * severity
        # At nominal cycle life (e.g. 4000 cycles at 80% DoD), capacity drops by 20%
        cycle_loss_pct += count * (20.0 / req.nominal_cycle_life) * severity

    # Calendar aging: Arrhenius temperature dependence (baseline 25°C = 298.15K)
    temp = req.cell_temperature_celsius if req.cell_temperature_celsius is not None else 25.0
    t_kelvin = temp + 273.15
    # Cal aging rate: ~1.5% per year at 25°C, scaling with sqrt(days)
    temp_factor = math.exp((45000.0 / 8.314) * (1.0 / 298.15 - 1.0 / t_kelvin)) if t_kelvin > 200 else 1.0
    cal_loss_pct = (1.5 / 365.0) * math.sqrt(req.operational_days) * temp_factor

    total_loss_pct = round(cycle_loss_pct + cal_loss_pct, 4)
    soh_pct = round(max(0.0, 100.0 - total_loss_pct), 2)
    derate = compute_thermal_derating(temp)

    remaining_cycles = max(0.0, round((soh_pct - 80.0) / (20.0 / max(req.nominal_cycle_life, 1.0)), 1)) if soh_pct > 80.0 else 0.0

    if soh_pct >= 95.0:
        verdict = "EXCELLENT_HEALTH"
    elif soh_pct >= 85.0:
        verdict = "NORMAL_OPERATING_HEALTH"
    elif soh_pct >= 80.0:
        verdict = "ELEVATED_AGING"
    else:
        verdict = "END_OF_LIFE_REPLACEMENT_ADVISED"

    return DegradationResponse(
        equivalent_full_cycles=round(efc, 4),
        rainflow_cycle_count=len(cycles),
        dod_distribution=dod_dist,
        cycle_capacity_loss_percent=round(cycle_loss_pct, 4),
        calendar_capacity_loss_percent=round(cal_loss_pct, 4),
        total_capacity_loss_percent=total_loss_pct,
        state_of_health_percent=soh_pct,
        wear_cost_inr=round(wear_cost, 2),
        estimated_remaining_cycles=remaining_cycles,
        thermal_derate_factor=derate,
        derated_max_charge_kw=round(req.max_charge_kw * derate, 3),
        derated_max_discharge_kw=round(req.max_discharge_kw * derate, 3),
        summary_verdict=verdict,
    )
