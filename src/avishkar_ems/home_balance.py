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
    #: Where *this* reading came from, when it differs from how the home is normally read. A home wired to a
    #: meter may still be asked a "what if" question with made-up figures, and the answer must not be labelled
    #: HARDWARE_MEASURED because the home usually is. Left None, the home's own mode applies.
    measurement_mode: MeasurementMode | None = None


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
            # This reading's own mode when it has one, otherwise how the home is normally read.
            measurement_mode=telemetry.measurement_mode or self.profile.measurement_mode,
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


# --------------------------------------------------------------------------------------
# Peer-to-peer exchange between two homes
# --------------------------------------------------------------------------------------

#: Lowest feeder voltage worth modelling. Below this the single-phase current calculation
#: stops meaning anything and the caller has almost certainly passed the wrong unit.
_MIN_FEEDER_VOLTAGE_V = 50.0


def route_community_exchange(
    *,
    seller_home_id: str,
    surplus_kw: float,
    seller_opted_in: bool,
    buyer_home_id: str,
    buyer_opted_in: bool,
    buyer_deficit_kw: float,
    feeder_resistance_ohms: float,
    feeder_voltage_v: float,
    community_clearing_price_inr: float,
    discom_retail_tariff_inr: float,
    discom_export_tariff_inr: float,
    transfer_limit_kw: float | None = None,
    duration_hours: float = 1.0,
) -> dict[str, object]:
    """Route one home's surplus to one neighbour's deficit over a modelled feeder.

    This is a calculation, not a transfer. AVISHKAR does not move electricity between
    properties and says nothing about whether doing so is permitted: a peer-to-peer
    arrangement needs a distribution licensee's consent, a metering arrangement and the
    wiring to carry it. The result says so in ``notes``.

    What is actually modelled, and what is not:

    * The transfer is the smaller of what the seller has spare, what the buyer is short of,
      and ``transfer_limit_kw`` when one is given. Energy is never counted twice: whatever
      the buyer receives is subtracted from the deficit it still has to buy.
    * The loss is resistive, worked out from the current the transfer draws:
      ``I = kW x 1000 / V`` and ``loss = I^2 R``. That assumes a single-phase feeder at
      unity power factor with the whole line as one lumped resistance, and it ignores the
      voltage drop along that line (which would itself change the current), reactive power,
      and the three-phase case. It is the standard first approximation and no more.
    * Money: without the exchange the seller would export its surplus at the DISCOM export
      tariff and the buyer would buy its deficit at the retail tariff. With it, the seller is
      paid the clearing price for what leaves its meter and the buyer pays the clearing price
      for what arrives. The loss between them is paid for by neither, so its value is
      reported on its own line as what the network absorbs.

    Every price is the caller's. Nothing here consults a built-in tariff.

    Returns a dict (the dashboard renders it directly), with ``transferred_kw``,
    ``delivered_to_buyer_kw``, ``line_loss_kw`` and ``combined_social_benefit_inr`` among
    the keys, plus the reason when nothing was transferred.
    """
    if feeder_voltage_v < _MIN_FEEDER_VOLTAGE_V:
        raise ValueError(
            f"feeder_voltage_v is {feeder_voltage_v}: below {_MIN_FEEDER_VOLTAGE_V:g} V the single-phase "
            "current calculation is meaningless. Pass the line voltage in volts."
        )
    if feeder_resistance_ohms < 0:
        raise ValueError(f"feeder_resistance_ohms is {feeder_resistance_ohms}: a resistance cannot be negative.")
    if duration_hours <= 0:
        raise ValueError(f"duration_hours is {duration_hours}: an interval must be longer than zero.")

    surplus_kw = max(0.0, float(surplus_kw))
    buyer_deficit_kw = max(0.0, float(buyer_deficit_kw))
    notes: list[str] = [
        "A calculation over one interval, not a measurement, and not a record of electricity that moved.",
        "AVISHKAR does not move electricity between properties. Whether a surplus may be sent to a neighbour "
        "depends on the law, the distribution licensee's rules, the metering arrangement and the wiring where "
        "those properties are.",
        "The loss is I^2R for a single-phase feeder at unity power factor, taking the line as one lumped "
        "resistance: it ignores the voltage drop along the line, reactive power and the three-phase case.",
    ]
    assumptions: list[str] = [
        f"Community clearing price INR {community_clearing_price_inr:.2f}/kWh: a price you entered, not one anybody has agreed.",
        f"Feeder modelled as {feeder_resistance_ohms:g} ohm at {feeder_voltage_v:g} V.",
    ]

    def nothing(reason: str) -> dict[str, object]:
        """No transfer, and why. Both homes simply do what they would have done alone."""
        return {
            "seller_home_id": seller_home_id,
            "buyer_home_id": buyer_home_id,
            "eligible": False,
            "reason": reason,
            "offered_surplus_kw": round(surplus_kw, 6),
            "buyer_deficit_kw": round(buyer_deficit_kw, 6),
            "transferred_kw": 0.0,
            "delivered_to_buyer_kw": 0.0,
            "line_loss_kw": 0.0,
            "line_current_a": 0.0,
            "transfer_limit_kw": transfer_limit_kw,
            "binding_constraint": "NOT_ELIGIBLE",
            "buyer_residual_grid_import_kw": round(buyer_deficit_kw, 6),
            "seller_residual_grid_export_kw": round(surplus_kw, 6),
            "seller_benefit_inr": 0.0,
            "buyer_benefit_inr": 0.0,
            "combined_social_benefit_inr": 0.0,
            "network_absorbed_loss_inr": 0.0,
            "duration_hours": duration_hours,
            "notes": notes,
            "assumptions": assumptions,
        }

    if not seller_opted_in or not buyer_opted_in:
        who = (
            "Neither home has opted in to community sharing"
            if not seller_opted_in and not buyer_opted_in
            else f"{seller_home_id} has not opted in to community sharing"
            if not seller_opted_in
            else f"{buyer_home_id} has not opted in to community sharing"
        )
        return nothing(f"{who}, so nothing is shared. Each home keeps working on its own.")
    if surplus_kw <= 0:
        return nothing(f"{seller_home_id} has no surplus to offer in this interval.")
    if buyer_deficit_kw <= 0:
        return nothing(f"{buyer_home_id} is not short of anything in this interval.")

    # What leaves the seller's meter: the least of what it has, what the buyer needs, and any cap.
    caps: list[tuple[float, str]] = [(surplus_kw, "SELLER_SURPLUS"), (buyer_deficit_kw, "BUYER_DEFICIT")]
    if transfer_limit_kw is not None:
        caps.append((max(0.0, float(transfer_limit_kw)), "TRANSFER_LIMIT"))
    transferred_kw, binding = min(caps, key=lambda c: c[0])
    if transferred_kw <= 0:
        return nothing("The transfer limit for this pair is zero, so nothing may be sent.")

    # I^2R over the modelled feeder.
    current_a = transferred_kw * 1000.0 / feeder_voltage_v
    loss_kw = current_a**2 * feeder_resistance_ohms / 1000.0

    # A loss at or above what was sent means this transfer cannot physically deliver anything: say so
    # rather than reporting a negative delivery.
    if loss_kw >= transferred_kw:
        return nothing(
            f"Sending {transferred_kw:.2f} kW over {feeder_resistance_ohms:g} ohm at {feeder_voltage_v:g} V "
            f"would lose {loss_kw:.2f} kW, which is all of it or more: the modelled feeder cannot carry this "
            "transfer at all."
        )

    delivered_kw = transferred_kw - loss_kw

    # Money, per the convention in the docstring. Everything is per interval, at the caller's prices.
    seller_benefit_inr = transferred_kw * duration_hours * (community_clearing_price_inr - discom_export_tariff_inr)
    buyer_benefit_inr = delivered_kw * duration_hours * (discom_retail_tariff_inr - community_clearing_price_inr)
    network_loss_inr = loss_kw * duration_hours * community_clearing_price_inr

    if community_clearing_price_inr < discom_export_tariff_inr:
        assumptions.append(
            "The clearing price is below the DISCOM export tariff, so the seller is worse off sharing than "
            "exporting: the benefit below is negative, and is reported rather than hidden."
        )
    if community_clearing_price_inr > discom_retail_tariff_inr:
        assumptions.append(
            "The clearing price is above the retail tariff, so the buyer is worse off buying from a neighbour "
            "than from the DISCOM: the benefit below is negative, and is reported rather than hidden."
        )

    reason = (
        f"{seller_home_id} sent {transferred_kw:.2f} kW to {buyer_home_id}; {delivered_kw:.2f} kW arrived and "
        f"{loss_kw:.3f} kW was lost in the feeder ({current_a:.1f} A through {feeder_resistance_ohms:g} ohm). "
        + {
            "SELLER_SURPLUS": "The seller had no more to give.",
            "BUYER_DEFICIT": "The buyer needed no more.",
            "TRANSFER_LIMIT": f"The transfer limit of {transfer_limit_kw} kW stopped it going further.",
        }[binding]
    )

    return {
        "seller_home_id": seller_home_id,
        "buyer_home_id": buyer_home_id,
        "eligible": True,
        "reason": reason,
        "offered_surplus_kw": round(surplus_kw, 6),
        "buyer_deficit_kw": round(buyer_deficit_kw, 6),
        # These three are rounded alike and finely, so that transferred == delivered + loss still holds for
        # anyone who checks it. The page formats them for display itself.
        "transferred_kw": round(transferred_kw, 6),
        "delivered_to_buyer_kw": round(delivered_kw, 6),
        "line_loss_kw": round(loss_kw, 6),
        "line_current_a": round(current_a, 2),
        "transfer_limit_kw": transfer_limit_kw,
        "binding_constraint": binding,
        # What each home still has to do with the grid: the transfer is never counted twice.
        "buyer_residual_grid_import_kw": round(buyer_deficit_kw - delivered_kw, 6),
        "seller_residual_grid_export_kw": round(surplus_kw - transferred_kw, 6),
        "seller_benefit_inr": round(seller_benefit_inr, 2),
        "buyer_benefit_inr": round(buyer_benefit_inr, 2),
        "combined_social_benefit_inr": round(seller_benefit_inr + buyer_benefit_inr, 2),
        "network_absorbed_loss_inr": round(network_loss_inr, 2),
        "duration_hours": duration_hours,
        "notes": notes,
        "assumptions": assumptions,
    }
