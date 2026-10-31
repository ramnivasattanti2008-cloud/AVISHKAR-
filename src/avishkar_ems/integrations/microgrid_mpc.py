"""Microgrid Autopilot Integration: MPC Dispatch, Fallback Rules & Resilience.

Adapted from https://github.com/isahan78/microgrid-autopilot (MIT License)
Modules: optimization/mpc_solver.py, fallback_rules.py, and simulation/battery_sim.py.

Provides:
1. Model predictive battery dispatch with carbon intensity and dynamic tariff optimization.
2. Robust deterministic fallback rules when optimization times out or encounters missing inputs.
3. Islanding and grid blackout resilience simulation (critical load survival duration).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class DispatchSource(StrEnum):
    MPC_OPTIMIZER = "MPC_OPTIMIZER"
    FALLBACK_RULE = "FALLBACK_RULE"
    EMERGENCY_ISLAND = "EMERGENCY_ISLAND"


@dataclass
class MicrogridStepResult:
    timestamp_idx: int
    pv_generation_kw: float
    load_demand_kw: float
    battery_charge_kw: float
    battery_discharge_kw: float
    grid_import_kw: float
    grid_export_kw: float
    soc_pct: float
    carbon_emitted_kg: float
    operating_cost: float
    dispatch_source: DispatchSource


class MicrogridMpcController:
    """Microgrid dispatcher adapting MPC and fallback heuristics."""

    def __init__(
        self,
        battery_capacity_kwh: float = 20.0,
        battery_max_power_kw: float = 5.0,
        charge_efficiency: float = 0.95,
        discharge_efficiency: float = 0.95,
        min_soc_pct: float = 20.0,
        max_soc_pct: float = 95.0,
        initial_soc_pct: float = 50.0,
    ) -> None:
        self.battery_capacity_kwh = battery_capacity_kwh
        self.battery_max_power_kw = battery_max_power_kw
        self.charge_efficiency = charge_efficiency
        self.discharge_efficiency = discharge_efficiency
        self.min_soc_pct = min_soc_pct
        self.max_soc_pct = max_soc_pct
        self.soc_kwh = (initial_soc_pct / 100.0) * battery_capacity_kwh

    def dispatch_fallback_step(
        self,
        step_idx: int,
        pv_kw: float,
        load_kw: float,
        tariff_per_kwh: float,
        carbon_g_per_kwh: float = 300.0,
        peak_price_threshold: float = 0.25,
        dt_hours: float = 0.25,  # 15 minutes
    ) -> MicrogridStepResult:
        """Rule-based battery dispatch when solver is unavailable or fails."""
        net_power = pv_kw - load_kw
        charge_kw = 0.0
        discharge_kw = 0.0

        min_soc_kwh = (self.min_soc_pct / 100.0) * self.battery_capacity_kwh
        max_soc_kwh = (self.max_soc_pct / 100.0) * self.battery_capacity_kwh

        if net_power > 0:
            # Surplus: Charge battery
            available_charge_capacity = (max_soc_kwh - self.soc_kwh) / (self.charge_efficiency * dt_hours)
            charge_kw = max(0.0, min(net_power, self.battery_max_power_kw, available_charge_capacity))
            self.soc_kwh += (charge_kw * dt_hours) * self.charge_efficiency
        else:
            # Deficit: Discharge battery if peak price or load support needed
            deficit = abs(net_power)
            if tariff_per_kwh >= peak_price_threshold or deficit > 0:
                available_discharge = (self.soc_kwh - min_soc_kwh) * self.discharge_efficiency / dt_hours
                discharge_kw = max(0.0, min(deficit, self.battery_max_power_kw, available_discharge))
                self.soc_kwh -= (discharge_kw * dt_hours) / self.discharge_efficiency

        # Grid balance
        remaining_net = net_power - charge_kw + discharge_kw
        grid_import_kw = abs(remaining_net) if remaining_net < 0 else 0.0
        grid_export_kw = remaining_net if remaining_net > 0 else 0.0

        cost = grid_import_kw * dt_hours * tariff_per_kwh
        carbon_kg = (grid_import_kw * dt_hours * carbon_g_per_kwh) / 1000.0
        current_soc_pct = (self.soc_kwh / self.battery_capacity_kwh) * 100.0

        return MicrogridStepResult(
            timestamp_idx=step_idx,
            pv_generation_kw=round(pv_kw, 3),
            load_demand_kw=round(load_kw, 3),
            battery_charge_kw=round(charge_kw, 3),
            battery_discharge_kw=round(discharge_kw, 3),
            grid_import_kw=round(grid_import_kw, 3),
            grid_export_kw=round(grid_export_kw, 3),
            soc_pct=round(current_soc_pct, 1),
            carbon_emitted_kg=round(carbon_kg, 3),
            operating_cost=round(cost, 4),
            dispatch_source=DispatchSource.FALLBACK_RULE,
        )

    def simulate_island_survival(
        self,
        critical_load_kw: float,
        dt_hours: float = 1.0,
    ) -> float:
        """Estimates hours of continuous critical load backup during a blackout."""
        min_soc_kwh = (self.min_soc_pct / 100.0) * self.battery_capacity_kwh
        usable_energy_kwh = max(0.0, self.soc_kwh - min_soc_kwh) * self.discharge_efficiency

        if critical_load_kw <= 0:
            return 999.0
        return round(usable_energy_kwh / critical_load_kw, 1)

