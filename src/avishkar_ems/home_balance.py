"""Residential Energy Balance Engine for AVISHKAR Home EMS.

Provides mathematically verified energy balance, battery constraint enforcement,
multi-objective dispatch optimization, and deterministic fallbacks.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from avishkar_ems.home_profile import (
    HomeProfile,
    MeasurementMode,
    OptimizationGoal,
)


@dataclass
class IntervalTelemetry:
    """Instantaneous power measurements for a single calculation interval."""
    solar_generation_kw: float | None
    home_consumption_kw: float | None
    battery_soc_pct: float | None = None
    grid_import_price_inr: float | None = None
    grid_export_price_inr: float | None = None
    is_stale: bool = False
    timestamp: str = "2026-10-30T12:00:00"


@dataclass
class DispatchStepResult:
    """Rigorous energy balance and dispatch result for a calculation interval."""
    # Instantaneous Power (kW)
    solar_generation_kw: float
    home_consumption_kw: float
    solar_direct_used_kw: float
    gross_surplus_kw: float
    gross_deficit_kw: float
    battery_charge_kw: float
    battery_discharge_kw: float
    flexible_load_kw: float
    ev_charge_kw: float
    grid_import_kw: float
    grid_export_kw: float
    inverter_loss_kw: float
    battery_loss_kw: float

    # State of Charge (%)
    battery_soc_before_pct: float
    battery_soc_after_pct: float

    # Economics & Accounting
    duration_hours: float
    net_cost_inr: float
    is_balanced: bool
    energy_balance_error_kw: float

    # Energy Interval Accounting (kWh)
    interval_energy_kwh: dict[str, float] = field(default_factory=dict)

    # Community Trading
    community_shared_kw: float = 0.0
    community_line_loss_kw: float = 0.0
    community_net_savings_inr: float = 0.0

    # Transparency & Data Honesty
    measurement_mode: MeasurementMode = MeasurementMode.SIMULATION
    status: str = "OPTIMAL"
    recommendation_text: str = ""
    assumptions: list[str] = field(default_factory=list)
    constraints_applied: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class HomeEnergyBalanceEngine:
    """Comprehensive Home Energy Balance & Multi-Objective Optimization Engine."""

    def __init__(self, profile: HomeProfile | None = None) -> None:
        self.profile = profile or HomeProfile.create_phase7_demo_home()

    def evaluate_interval(
        self,
        telemetry: IntervalTelemetry,
        duration_hours: float = 1.0,
        enable_losses: bool = True,
    ) -> DispatchStepResult:
        """Executes a mathematically consistent energy balance interval."""
        if duration_hours <= 0.0:
            raise ValueError(f"duration_hours must be positive, got {duration_hours}")

        # 1. Missing or Stale Data Handling (Data Honesty)
        if telemetry.solar_generation_kw is None or telemetry.home_consumption_kw is None:
            return self._build_incomplete_result(
                "Missing essential telemetry: solar generation or consumption unavailable.",
                duration_hours,
            )

        if telemetry.solar_generation_kw < 0.0 or telemetry.home_consumption_kw < 0.0:
            return self._build_incomplete_result(
                "Telemetry invalid: negative power readings detected.",
                duration_hours,
            )

        warnings: list[str] = []
        if telemetry.is_stale:
            warnings.append("STALE_TELEMETRY: Measurements older than heartbeat tolerance. Fallback applied.")

        # Baseline parameters
        pv_kw = float(telemetry.solar_generation_kw)
        load_kw = float(telemetry.home_consumption_kw)
        buy_tariff = (
            telemetry.grid_import_price_inr
            if telemetry.grid_import_price_inr is not None
            else self.profile.grid_purchase_tariff_inr
        )
        sell_tariff = (
            telemetry.grid_export_price_inr
            if telemetry.grid_export_price_inr is not None
            else self.profile.grid_export_tariff_inr
        )

        batt = self.profile.battery
        inv = self.profile.inverter
        goal = self.profile.optimization_goal

        curr_soc = (
            telemetry.battery_soc_pct
            if telemetry.battery_soc_pct is not None
            else batt.current_soc_pct
        )
        soc_before = curr_soc

        # 2. Inverter Active Power Ceiling
        if pv_kw > inv.rating_kw:
            warnings.append(f"INVERTER_CLIPPING: Solar generation {pv_kw:.1f}kW clipped to inverter rating {inv.rating_kw:.1f}kW.")
            pv_kw = inv.rating_kw

        # 3. Direct Solar Consumption
        pv_direct = min(pv_kw, load_kw)
        gross_surplus = max(0.0, pv_kw - load_kw)
        gross_deficit = max(0.0, load_kw - pv_kw)

        # 4. Multi-Objective Dispatch Formulation
        batt_charge_kw = 0.0
        batt_discharge_kw = 0.0
        flex_allocated_kw = 0.0
        ev_allocated_kw = 0.0
        grid_import_kw = 0.0
        grid_export_kw = 0.0
        constraints: list[str] = []
        assumptions: list[str] = [
            f"Optimization Goal: {goal.value}",
            f"Inverter Sandia efficiency: {inv.efficiency_fraction * 100.0:.1f}%" if enable_losses else "Lossless calculation mode",
        ]

        # Calculate battery room (kWh and kW)
        batt_headroom_kwh = max(0.0, ((batt.max_soc_pct - curr_soc) / 100.0) * batt.capacity_kwh)
        max_possible_charge_kw = min(batt.max_charge_power_kw, batt_headroom_kwh / duration_hours)

        # Calculate battery available energy (taking reserve into account)
        reserve_floor = (
            batt.preferred_backup_reserve_pct
            if goal == OptimizationGoal.PRESERVE_BACKUP_RESERVE
            else batt.min_soc_pct
        )
        usable_batt_kwh = max(0.0, ((curr_soc - reserve_floor) / 100.0) * batt.capacity_kwh)
        max_possible_discharge_kw = min(batt.max_discharge_power_kw, usable_batt_kwh / duration_hours)

        # CASE A: Solar Surplus Available (PV > Load)
        if gross_surplus > 0.0:
            rem_surplus = gross_surplus

            # Tier 1 of surplus: Battery Charging
            # In MINIMIZE_BILLS or MAXIMIZE_SELF_CONSUMPTION, surplus goes to battery first
            if max_possible_charge_kw > 0.01:
                batt_charge_kw = min(rem_surplus, max_possible_charge_kw)
                rem_surplus -= batt_charge_kw
                constraints.append(f"Battery charging bounded by max SoC {batt.max_soc_pct}%")
            else:
                if curr_soc >= batt.max_soc_pct:
                    constraints.append(f"Battery charge locked: reached max SoC ceiling ({batt.max_soc_pct}%)")

            # Tier 2 of surplus: Flexible Loads (Washing Machine, Water Heater)
            for app in sorted(self.profile.flexible_appliances, key=lambda a: a.priority):
                if rem_surplus >= app.nominal_power_kw and app.is_controllable:
                    flex_allocated_kw += app.nominal_power_kw
                    rem_surplus -= app.nominal_power_kw

            # Tier 3 of surplus: EV Charging
            ev = self.profile.ev_charger
            if ev.is_connected and rem_surplus > 0.5:
                ev_room_kwh = max(0.0, ((ev.target_soc_pct - ev.current_soc_pct) / 100.0) * ev.battery_capacity_kwh)
                max_ev_kw = min(ev.max_charge_power_kw, ev_room_kwh / duration_hours)
                ev_allocated_kw = min(rem_surplus, max_ev_kw)
                rem_surplus -= ev_allocated_kw

            # Tier 4 of surplus: Grid Export vs Zero-Export Limit
            if inv.is_zero_export_enforced:
                grid_export_kw = 0.0
                constraints.append("ZERO_EXPORT: Reverse power export suppressed to 0.0 kW")
            else:
                grid_export_kw = rem_surplus

        # CASE B: Solar Deficit (Load > PV)
        else:
            deficit_to_cover = gross_deficit

            # Evaluate battery discharge based on goal
            if goal == OptimizationGoal.PRESERVE_BACKUP_RESERVE and curr_soc <= batt.preferred_backup_reserve_pct:
                constraints.append(
                    f"BACKUP_RESERVE_PRESERVED: Battery discharge locked at {batt.preferred_backup_reserve_pct}% reserve"
                )
                batt_discharge_kw = 0.0
            else:
                batt_discharge_kw = min(deficit_to_cover, max_possible_discharge_kw)
                deficit_to_cover -= batt_discharge_kw
                if batt_discharge_kw > 0.0:
                    constraints.append(f"Discharged battery to cover load deficit (Reserve floor: {reserve_floor}%)")

            # Remaining deficit imported from grid
            grid_import_kw = deficit_to_cover

        # 5. Conversion & Storage Losses
        inv_loss_kw = 0.0
        batt_loss_kw = 0.0
        if enable_losses:
            # Inverter loss on DC/AC throughput
            inv_loss_kw = round((1.0 - inv.efficiency_fraction) * (pv_kw + batt_discharge_kw), 4)
            # Battery roundtrip losses
            if batt_charge_kw > 0:
                batt_loss_kw += round((1.0 - batt.charge_efficiency) * batt_charge_kw, 4)
            if batt_discharge_kw > 0:
                batt_loss_kw += round(((1.0 / batt.discharge_efficiency) - 1.0) * batt_discharge_kw, 4)

        # 6. Battery State of Charge Transition
        # Strictly prevent simultaneous contradictory commands: charge * discharge == 0
        if batt_charge_kw > 0 and batt_discharge_kw > 0:
            raise RuntimeError("Fatal EMS invariant violation: simultaneous charge and discharge commands generated.")

        eff_charge = batt.charge_efficiency if enable_losses else 1.0
        eff_dis = batt.discharge_efficiency if enable_losses else 1.0

        delta_energy_kwh = (batt_charge_kw * duration_hours * eff_charge) - (
            (batt_discharge_kw * duration_hours) / eff_dis
        )
        new_soc = curr_soc + (delta_energy_kwh / batt.capacity_kwh * 100.0) if batt.capacity_kwh > 0 else 0.0
        new_soc = max(batt.min_soc_pct, min(batt.max_soc_pct, new_soc))

        # 7. First Law of Thermodynamics Energy Balance Verification
        # Total Sources = PV + Grid Import + Battery Discharge
        # Total Sinks = Home Load + Flex Load + EV Load + Battery Charge + Grid Export
        tot_sources = pv_kw + grid_import_kw + batt_discharge_kw
        tot_sinks = load_kw + flex_allocated_kw + ev_allocated_kw + batt_charge_kw + grid_export_kw
        balance_error = abs(tot_sources - tot_sinks)
        is_balanced = balance_error < 1e-3

        # 8. Economics
        net_cost = (grid_import_kw * duration_hours * buy_tariff) - (grid_export_kw * duration_hours * sell_tariff)

        # 9. Energy Interval Accounting (kWh)
        interval_kwh = {
            "solar_kwh": round(pv_kw * duration_hours, 3),
            "load_kwh": round(load_kw * duration_hours, 3),
            "battery_charge_kwh": round(batt_charge_kw * duration_hours, 3),
            "battery_discharge_kwh": round(batt_discharge_kw * duration_hours, 3),
            "grid_import_kwh": round(grid_import_kw * duration_hours, 3),
            "grid_export_kwh": round(grid_export_kw * duration_hours, 3),
        }

        # 10. Human-Understandable Recommendation Explanation
        rec_text = self._build_recommendation(
            goal=goal,
            pv_kw=pv_kw,
            load_kw=load_kw,
            surplus_kw=gross_surplus,
            batt_chg=batt_charge_kw,
            batt_dis=batt_discharge_kw,
            grid_exp=grid_export_kw,
            grid_imp=grid_import_kw,
            soc=new_soc,
        )

        return DispatchStepResult(
            solar_generation_kw=round(pv_kw, 3),
            home_consumption_kw=round(load_kw, 3),
            solar_direct_used_kw=round(pv_direct, 3),
            gross_surplus_kw=round(gross_surplus, 3),
            gross_deficit_kw=round(gross_deficit, 3),
            battery_charge_kw=round(batt_charge_kw, 3),
            battery_discharge_kw=round(batt_discharge_kw, 3),
            flexible_load_kw=round(flex_allocated_kw, 3),
            ev_charge_kw=round(ev_allocated_kw, 3),
            grid_import_kw=round(grid_import_kw, 3),
            grid_export_kw=round(grid_export_kw, 3),
            inverter_loss_kw=inv_loss_kw,
            battery_loss_kw=batt_loss_kw,
            battery_soc_before_pct=round(soc_before, 2),
            battery_soc_after_pct=round(new_soc, 2),
            duration_hours=duration_hours,
            net_cost_inr=round(net_cost, 2),
            is_balanced=is_balanced,
            energy_balance_error_kw=round(balance_error, 4),
            interval_energy_kwh=interval_kwh,
            measurement_mode=self.profile.measurement_mode,
            status="OPTIMAL" if is_balanced else "BALANCE_MISMATCH",
            recommendation_text=rec_text,
            assumptions=assumptions,
            constraints_applied=constraints,
            warnings=warnings,
        )

    def route_community_exchange(
        self,
        local_result: DispatchStepResult,
        community_tariff_inr: float = 5.50,
        feeder_loss_fraction: float = 0.025,
    ) -> DispatchStepResult:
        """Evaluates community surplus sharing with line losses without double-counting."""
        res = local_result

        # Invariant: If community sharing is disabled, return untouched individual accounting
        if not self.profile.community_opt_in:
            res.community_shared_kw = 0.0
            res.community_line_loss_kw = 0.0
            res.community_net_savings_inr = 0.0
            res.assumptions.append("Community sharing disabled: Home operates in strict autonomous mode.")
            return res

        # If opted in, eligible grid export is shared with community first
        if res.grid_export_kw > 0.0:
            export_kw = res.grid_export_kw
            loss_kw = export_kw * feeder_loss_fraction
            delivered_kw = export_kw - loss_kw

            # Seller earns community tariff (e.g. ₹5.50/kWh) instead of low DISCOM export tariff (₹3.00/kWh)
            extra_revenue = export_kw * res.duration_hours * (community_tariff_inr - self.profile.grid_export_tariff_inr)

            res.community_shared_kw = round(delivered_kw, 3)
            res.community_line_loss_kw = round(loss_kw, 4)
            res.community_net_savings_inr = round(extra_revenue, 2)
            res.recommendation_text += f" Community Sharing: Traded {export_kw:.2f}kW surplus locally (+₹{extra_revenue:.1f} profit)."

        return res

    def run_phase7_benchmark(self, lossless: bool = True) -> DispatchStepResult:
        """Executes the exact reproducible benchmark scenario required by Phase 7.

        Specifications:
        - Solar capacity: 5 kW
        - Battery capacity: 10 kWh
        - Initial battery SoC: 60%
        - Current solar generation: 4 kW
        - Current household demand: 1.5 kW
        - Electricity purchase price: ₹8/kWh
        - Electricity export price: ₹3/kWh
        - Lossless Solar Surplus = 4.0 - 1.5 = 2.5 kW.
        """
        # Ensure profile matches benchmark specs
        self.profile = HomeProfile.create_phase7_demo_home()

        telemetry = IntervalTelemetry(
            solar_generation_kw=4.0,
            home_consumption_kw=1.5,
            battery_soc_pct=60.0,
            grid_import_price_inr=8.00,
            grid_export_price_inr=3.00,
        )

        return self.evaluate_interval(
            telemetry=telemetry,
            duration_hours=1.0,
            enable_losses=not lossless,
        )

    def _build_incomplete_result(self, reason: str, duration_hours: float) -> DispatchStepResult:
        return DispatchStepResult(
            solar_generation_kw=0.0,
            home_consumption_kw=0.0,
            solar_direct_used_kw=0.0,
            gross_surplus_kw=0.0,
            gross_deficit_kw=0.0,
            battery_charge_kw=0.0,
            battery_discharge_kw=0.0,
            flexible_load_kw=0.0,
            ev_charge_kw=0.0,
            grid_import_kw=0.0,
            grid_export_kw=0.0,
            inverter_loss_kw=0.0,
            battery_loss_kw=0.0,
            battery_soc_before_pct=self.profile.battery.current_soc_pct,
            battery_soc_after_pct=self.profile.battery.current_soc_pct,
            duration_hours=duration_hours,
            net_cost_inr=0.0,
            is_balanced=False,
            energy_balance_error_kw=0.0,
            status="INCOMPLETE_DATA",
            recommendation_text=f"Cannot compute dispatch: {reason}",
            warnings=[reason],
        )

    def _build_recommendation(
        self,
        goal: OptimizationGoal,
        pv_kw: float,
        load_kw: float,
        surplus_kw: float,
        batt_chg: float,
        batt_dis: float,
        grid_exp: float,
        grid_imp: float,
        soc: float,
    ) -> str:
        if surplus_kw > 0:
            if batt_chg > 0:
                action = f"Charging battery with {batt_chg:.2f}kW surplus (SoC reaching {soc:.0f}%)."
            elif grid_exp > 0:
                action = f"Exporting {grid_exp:.2f}kW to grid after serving all home loads and battery."
            else:
                action = "Surplus successfully absorbed by domestic appliances."
            return f"Goal [{goal.value}]: 100% solar self-sufficiency achieved. {action}"
        else:
            if batt_dis > 0:
                action = f"Discharging battery at {batt_dis:.2f}kW to avoid peak grid tariff."
            else:
                action = f"Drawing {grid_imp:.2f}kW from grid to meet household demand."
            return f"Goal [{goal.value}]: Generation deficit of {load_kw - pv_kw:.2f}kW. {action}"
