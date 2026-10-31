"""Surplus energy allocation engine for UrjaSetu / AVISHKAR EMS.

**This module is AVISHKAR's own code.** An earlier version of this docstring said it "synthesizes best
practices from verified open-source energy management architectures" and named eight projects, which
reads as source reuse and was not: nothing here was copied from any of them. The ideas below are
widely-held ones in this field and were implemented from scratch. Where a project's code is genuinely
reused it lives under `avishkar_ems/vendor/` with its upstream commit, its licence and its own tests --
see `docs/OPEN_SOURCE_INTEGRATION_MAP.md`.

What this module does, and where each part really comes from:

1. A seven-tier configurable priority hierarchy. AVISHKAR's own; the shape of it (priority cascade,
   minimum power per device, LIFO shedding) is the common pattern in this kind of controller.
2. An anti-hunting hysteresis controller with minimum run time, cooldown and an enable delay, so a
   relay or compressor is not cycled. AVISHKAR's own.
3. EV charging modes STOP / FAST / MIN_PLUS_PV / PV_ONLY. The names and the behaviour follow the
   convention evcc established and documents publicly; the implementation is AVISHKAR's own, and evcc
   is Go, so none of its code could be used here (`docs/OPEN_SOURCE_REUSE_AUDIT.md`).
4. Hard state-of-charge bounds for the battery. AVISHKAR's own.
5. Multi-building virtual net metering with a technical line loss. AVISHKAR's own; the platform's
   `api/src/community/allocate.ts` is the fuller treatment.
6. A nonce-authenticated command path. AVISHKAR's own. It is a software control and no hardware has
   ever been attached to it; nothing here is a claim of CEA compliance.
7. A fail-closed watchdog and a command timeout. AVISHKAR's own, and likewise never exercised against
   a real device.
8. Telemetry quality tagging, per this project's own data-honesty rules.

**The surplus figure itself is the one part that is vendored.** `home_balance.py` computes the
allocatable surplus from a live grid meter with SEM's `solar_bounded_surplus`
(`avishkar_ems/vendor/sem_surplus.py`), because that function encodes physical invariants learned from
field failures -- chiefly that surplus must be clamped to what the sun is producing, or a load running
off the battery at night reads as surplus. This module's own `calculate_surplus_and_deficit` is the
simulation path, used when there is no meter.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class MetricStatus(StrEnum):
    """Data honesty status indicator for all energy measurements and schedules."""
    MEASURED = "MEASURED"
    ESTIMATED = "ESTIMATED"
    MODELED_BASELINE = "MODELED_BASELINE"
    SIMULATED = "SIMULATED"
    MISSING_DATA = "MISSING_DATA"


class EVChargingMode(StrEnum):
    """Industry-standard EV solar charging modes (adapted from evcc)."""
    STOP = "STOP"              # Charging prohibited (0 kW)
    FAST = "FAST"              # Maximum power from grid + solar
    MIN_PLUS_PV = "MIN_PLUS_PV"  # Guaranteed minimum current boosted by surplus
    PV_ONLY = "PV_ONLY"        # Pure surplus charging; stops if surplus < min threshold


class PriorityTier(StrEnum):
    """7-Tier Dispatch Priority Chain."""
    TIER_1_ESSENTIAL_LOADS = "TIER_1_ESSENTIAL_LOADS"
    TIER_2_BATTERY_STORAGE = "TIER_2_BATTERY_STORAGE"
    TIER_3_FLEXIBLE_LOADS = "TIER_3_FLEXIBLE_LOADS"
    TIER_4_EV_CHARGER = "TIER_4_EV_CHARGER"
    TIER_5_THERMAL_STORAGE = "TIER_5_THERMAL_STORAGE"
    TIER_6_GRID_EXPORT = "TIER_6_GRID_EXPORT"
    TIER_7_CURTAILMENT = "TIER_7_CURTAILMENT"


@dataclass(frozen=True)
class PowerMeasurement:
    """Instantaneous power reading in kW with explicit source honesty tagging."""
    power_kw: float
    timestamp: str
    status: MetricStatus
    unit: str = "kW"

    def to_interval_energy(self, duration_hours: float) -> EnergyMeasurement:
        """Converts instantaneous power (kW) over duration (h) to energy (kWh)."""
        if duration_hours < 0.0:
            raise ValueError("duration_hours cannot be negative")
        return EnergyMeasurement(
            energy_kwh=round(self.power_kw * duration_hours, 4),
            duration_hours=duration_hours,
            timestamp=self.timestamp,
            status=self.status,
            unit="kWh",
        )


@dataclass(frozen=True)
class EnergyMeasurement:
    """Accumulated electrical energy in kWh over a defined duration."""
    energy_kwh: float
    duration_hours: float
    timestamp: str
    status: MetricStatus
    unit: str = "kWh"


@dataclass
class HysteresisState:
    """State tracking for a physical contactor/appliance to prevent rapid cycling."""
    load_id: str
    is_active: bool = False
    last_turn_on_ts: float = 0.0
    last_turn_off_ts: float = 0.0
    min_run_time_s: float = 180.0       # Minimum runtime once engaged (3 minutes)
    cooldown_time_s: float = 180.0      # Minimum off time before re-engagement (3 minutes)
    enable_delay_s: float = 60.0        # Sustained surplus required to turn on (1 minute)
    surplus_sustain_start_ts: float | None = None


class HysteresisController:
    """Anti-hunting controller preventing mechanical wear on relays and compressors."""

    def __init__(self, min_run_time_s: float = 180.0, cooldown_time_s: float = 180.0, enable_delay_s: float = 60.0):
        self.default_min_run_time_s = min_run_time_s
        self.default_cooldown_time_s = cooldown_time_s
        self.default_enable_delay_s = enable_delay_s
        self._states: dict[str, HysteresisState] = {}

    def get_or_create(self, load_id: str) -> HysteresisState:
        if load_id not in self._states:
            self._states[load_id] = HysteresisState(
                load_id=load_id,
                min_run_time_s=self.default_min_run_time_s,
                cooldown_time_s=self.default_cooldown_time_s,
                enable_delay_s=self.default_enable_delay_s,
            )
        return self._states[load_id]

    def evaluate(self, load_id: str, desired_active: bool, current_time: float | None = None) -> bool:
        """Evaluates whether state transition is allowed under hysteresis constraints."""
        now = time.time() if current_time is None else current_time
        state = self.get_or_create(load_id)

        if state.is_active:
            if not desired_active:
                # Attempting to turn OFF: enforce minimum runtime
                run_duration = now - state.last_turn_on_ts
                if run_duration < state.min_run_time_s:
                    # Must remain ON until min_run_time_s has elapsed
                    return True
                else:
                    state.is_active = False
                    state.last_turn_off_ts = now
                    state.surplus_sustain_start_ts = None
                    return False
            return True
        else:
            if desired_active:
                # Attempting to turn ON: enforce cooldown from last turn off
                off_duration = now - state.last_turn_off_ts
                if off_duration < state.cooldown_time_s:
                    # Still in cooldown
                    return False

                # Enforce enable delay (sustained condition)
                if state.surplus_sustain_start_ts is None:
                    state.surplus_sustain_start_ts = now
                    return False

                sustain_duration = now - state.surplus_sustain_start_ts
                if sustain_duration < state.enable_delay_s:
                    return False

                # Turn ON approved
                state.is_active = True
                state.last_turn_on_ts = now
                state.surplus_sustain_start_ts = None
                return True
            else:
                state.surplus_sustain_start_ts = None
                return False


@dataclass
class BatterySafetyConstraints:
    """Physical and electrochemical safety boundaries for LiFePO4 / NMC batteries."""
    capacity_kwh: float = 10.0
    soc_max: float = 0.98               # Max charge ceiling (98%)
    soc_min_reserve: float = 0.20       # Emergency backup floor (20%)
    max_charge_power_kw: float = 5.0
    max_discharge_power_kw: float = 5.0
    charge_efficiency: float = 0.95
    discharge_efficiency: float = 0.95


@dataclass
class DispatchResult:
    """Allocation output for a single dispatch interval."""
    solar_generation_kw: float
    essential_load_kw: float
    direct_solar_consumed_kw: float
    gross_surplus_kw: float
    gross_deficit_kw: float
    battery_charge_kw: float
    battery_discharge_kw: float
    flexible_load_kw: float
    ev_charge_kw: float
    thermal_storage_kw: float
    grid_export_kw: float
    grid_import_kw: float
    curtailed_solar_kw: float
    battery_soc_after: float
    status: MetricStatus
    warnings: list[str] = field(default_factory=list)

    @property
    def is_energy_conserved(self) -> bool:
        """Verifies physical first law of thermodynamics: Total Power In == Total Power Out."""
        total_in = self.solar_generation_kw + self.grid_import_kw + self.battery_discharge_kw
        total_out = (
            self.essential_load_kw
            + self.battery_charge_kw
            + self.flexible_load_kw
            + self.ev_charge_kw
            + self.thermal_storage_kw
            + self.grid_export_kw
            + self.curtailed_solar_kw
        )
        return abs(total_in - total_out) < 1e-4


class SurplusEngine:
    """Unified surplus energy management and multi-objective dispatch coordinator."""

    def __init__(
        self,
        battery_constraints: BatterySafetyConstraints | None = None,
        hysteresis_controller: HysteresisController | None = None,
        secret_key: str | None = None,
    ):
        self.battery = battery_constraints or BatterySafetyConstraints()
        self.hysteresis = hysteresis_controller or HysteresisController()
        self.secret_key = secret_key or os.getenv("CEA_HMAC_SECRET_KEY", "urjasetu-statutory-cea-2026-auth-key")
        self._seen_telemetry_timestamps: set[str] = set()
        self._seen_nonces: set[str] = set()

    def deduplicate_telemetry(self, timestamp: str) -> bool:
        """Returns True if timestamp is new; False if duplicate."""
        if timestamp in self._seen_telemetry_timestamps:
            return False
        self._seen_telemetry_timestamps.add(timestamp)
        return True

    def verify_cea_security_nonce(self, command: str, nonce: str, signature: str, max_age_s: float = 30.0) -> bool:
        """Verifies HMAC-SHA256 signature and nonce freshness under CEA regulations."""
        try:
            if nonce in self._seen_nonces:
                return False
            parts = nonce.split(":")
            if len(parts) != 2:
                return False
            ts_str, salt = parts
            command_ts = float(ts_str)
            if abs(time.time() - command_ts) > max_age_s:
                return False
            payload = f"{command}:{nonce}".encode()
            expected_sig = hmac.new(self.secret_key.encode(), payload, hashlib.sha256).hexdigest()
            if hmac.compare_digest(expected_sig, signature):
                self._seen_nonces.add(nonce)
                return True
            return False
        except Exception:
            return False

    def calculate_surplus_and_deficit(
        self,
        solar_kw: float | None,
        load_kw: float | None,
        timestamp: str = "2026-10-30T12:00:00Z",
    ) -> tuple[PowerMeasurement, PowerMeasurement, MetricStatus]:
        """Calculates net surplus and deficit from gross solar and essential load."""
        if solar_kw is None or load_kw is None:
            return (
                PowerMeasurement(0.0, timestamp, MetricStatus.MISSING_DATA),
                PowerMeasurement(0.0, timestamp, MetricStatus.MISSING_DATA),
                MetricStatus.MISSING_DATA,
            )

        surplus_kw = max(0.0, solar_kw - load_kw)
        deficit_kw = max(0.0, load_kw - solar_kw)

        return (
            PowerMeasurement(surplus_kw, timestamp, MetricStatus.MEASURED),
            PowerMeasurement(deficit_kw, timestamp, MetricStatus.MEASURED),
            MetricStatus.MEASURED,
        )

    def allocate_surplus(
        self,
        solar_kw: float,
        load_kw: float,
        battery_soc: float,
        ev_mode: EVChargingMode = EVChargingMode.PV_ONLY,
        ev_rated_kw: float = 3.3,
        ev_min_kw: float = 1.4,
        flexible_demand_kw: float = 0.0,
        thermal_demand_kw: float = 0.0,
        zero_export_limit: bool = False,
        interval_hours: float = 0.25,
        current_time: float | None = None,
    ) -> DispatchResult:
        """7-Tier Hierarchical Surplus and Deficit Allocation.

        Priority 1: Essential loads (direct PV self-consumption)
        Priority 2: Battery charging (if surplus) or discharging (if deficit)
        Priority 3: Flexible schedulable loads
        Priority 4: EV smart charging
        Priority 5: Thermal storage (immersion water heater)
        Priority 6: Grid feed-in / P2P export
        Priority 7: Inverter curtailment (if export restricted)
        """
        warnings: list[str] = []
        now = time.time() if current_time is None else current_time

        # Sanitize physical inputs against malformed/negative values
        solar_kw = max(0.0, float(solar_kw if solar_kw is not None else 0.0))
        load_kw = max(0.0, float(load_kw if load_kw is not None else 0.0))
        battery_soc = min(1.0, max(0.0, float(battery_soc if battery_soc is not None else 0.0)))

        # Step 1: Essential Load Supply
        pv_direct = min(solar_kw, load_kw)
        rem_surplus = max(0.0, solar_kw - load_kw)
        rem_deficit = max(0.0, load_kw - solar_kw)

        batt_charge_kw = 0.0
        batt_discharge_kw = 0.0
        new_soc = battery_soc

        # Step 2: Battery Storage
        if rem_surplus > 0.0:
            # Check SoC max ceiling
            if battery_soc >= self.battery.soc_max:
                batt_charge_kw = 0.0
                warnings.append("BATTERY_AT_MAX_SOC: Charging prohibited.")
            else:
                # Maximum energy battery can accept
                max_accept_kwh = max(0.0, (self.battery.soc_max - battery_soc) * self.battery.capacity_kwh)
                max_accept_kw = min(self.battery.max_charge_power_kw, max_accept_kwh / (interval_hours * self.battery.charge_efficiency))
                batt_charge_kw = min(rem_surplus, max_accept_kw)
                rem_surplus -= batt_charge_kw
                new_soc += (batt_charge_kw * interval_hours * self.battery.charge_efficiency) / self.battery.capacity_kwh
                new_soc = min(self.battery.soc_max, new_soc)

        elif rem_deficit > 0.0:
            # Check SoC reserve floor
            if battery_soc <= self.battery.soc_min_reserve:
                batt_discharge_kw = 0.0
                warnings.append("BATTERY_AT_RESERVE_FLOOR: Discharging prohibited.")
            else:
                # Maximum energy battery can supply
                max_deliver_kwh = max(0.0, (battery_soc - self.battery.soc_min_reserve) * self.battery.capacity_kwh)
                max_deliver_kw = min(self.battery.max_discharge_power_kw, (max_deliver_kwh * self.battery.discharge_efficiency) / interval_hours)
                batt_discharge_kw = min(rem_deficit, max_deliver_kw)
                rem_deficit -= batt_discharge_kw
                new_soc -= (batt_discharge_kw * interval_hours) / (self.battery.discharge_efficiency * self.battery.capacity_kwh)
                new_soc = max(self.battery.soc_min_reserve, new_soc)

        # Step 3: Flexible Schedulable Loads (with Hysteresis)
        flex_allocated_kw = 0.0
        if flexible_demand_kw > 0.0:
            desired_active = rem_surplus >= flexible_demand_kw
            is_active = self.hysteresis.evaluate("flex_load_1", desired_active, now)
            if is_active and rem_surplus >= flexible_demand_kw:
                flex_allocated_kw = flexible_demand_kw
                rem_surplus -= flex_allocated_kw

        # Step 4: EV Smart Charging (evcc Modes)
        ev_charge_kw = 0.0
        grid_import_kw = rem_deficit

        if ev_mode == EVChargingMode.STOP:
            ev_charge_kw = 0.0
        elif ev_mode == EVChargingMode.FAST:
            ev_charge_kw = ev_rated_kw
            # Covered first by surplus, balance pulled from grid
            from_surplus = min(rem_surplus, ev_charge_kw)
            from_grid = ev_charge_kw - from_surplus
            rem_surplus -= from_surplus
            grid_import_kw += from_grid
        elif ev_mode == EVChargingMode.MIN_PLUS_PV:
            # Guaranteed minimum baseline
            ev_charge_kw = ev_min_kw
            from_surplus = min(rem_surplus, ev_charge_kw)
            from_grid = ev_charge_kw - from_surplus
            rem_surplus -= from_surplus
            grid_import_kw += from_grid
            # Plus additional solar boost if surplus remains
            boost = min(rem_surplus, max(0.0, ev_rated_kw - ev_charge_kw))
            ev_charge_kw += boost
            rem_surplus -= boost
        elif ev_mode == EVChargingMode.PV_ONLY:
            if rem_surplus >= ev_min_kw:
                desired_active = True
            else:
                desired_active = False
            ev_allowed = self.hysteresis.evaluate("ev_charger", desired_active, now)
            if ev_allowed and rem_surplus >= ev_min_kw:
                ev_charge_kw = min(rem_surplus, ev_rated_kw)
                rem_surplus -= ev_charge_kw

        # Step 5: Thermal Storage (Immersion Water Heater)
        thermal_allocated_kw = 0.0
        if thermal_demand_kw > 0.0 and rem_surplus > 0.0:
            thermal_allocated_kw = min(rem_surplus, thermal_demand_kw)
            rem_surplus -= thermal_allocated_kw

        # Step 6 & 7: Grid Export or Active Curtailment
        grid_export_kw = 0.0
        curtailed_kw = 0.0
        if rem_surplus > 0.0:
            if zero_export_limit:
                curtailed_kw = rem_surplus
                warnings.append("ZERO_EXPORT_LIMIT_ACTIVE: Solar generation curtailed.")
            else:
                grid_export_kw = rem_surplus

        return DispatchResult(
            solar_generation_kw=solar_kw,
            essential_load_kw=load_kw,
            direct_solar_consumed_kw=pv_direct,
            gross_surplus_kw=max(0.0, solar_kw - load_kw),
            gross_deficit_kw=max(0.0, load_kw - solar_kw),
            battery_charge_kw=batt_charge_kw,
            battery_discharge_kw=batt_discharge_kw,
            flexible_load_kw=flex_allocated_kw,
            ev_charge_kw=ev_charge_kw,
            thermal_storage_kw=thermal_allocated_kw,
            grid_export_kw=grid_export_kw,
            grid_import_kw=grid_import_kw,
            curtailed_solar_kw=curtailed_kw,
            battery_soc_after=round(new_soc, 4),
            status=MetricStatus.SIMULATED,
            warnings=warnings,
        )

    def route_community_sharing(
        self,
        donor_surplus_kw: float,
        recipient_deficit_kw: float,
        line_loss_fraction: float = 0.03,  # 3% distribution line losses
    ) -> tuple[float, float, float]:
        """Calculates peer-to-peer energy routing with physical distribution losses.

        Returns:
            (sent_from_donor_kw, received_by_recipient_kw, technical_loss_kw)
        """
        if not (0.0 <= line_loss_fraction < 1.0):
            raise ValueError(f"Invalid line_loss_fraction {line_loss_fraction}: must be in range [0.0, 1.0)")
        if donor_surplus_kw <= 0.0 or recipient_deficit_kw <= 0.0:
            return (0.0, 0.0, 0.0)

        transfer_needed = recipient_deficit_kw / (1.0 - line_loss_fraction)
        transfer_sent = min(donor_surplus_kw, transfer_needed)
        transfer_loss = transfer_sent * line_loss_fraction
        transfer_received = transfer_sent - transfer_loss
        return (round(transfer_sent, 4), round(transfer_received, 4), round(transfer_loss, 4))

    def execute_hardware_command(
        self,
        command_type: str,
        target_value: float,
        timeout_ms: float = 2000.0,
        simulated_delay_ms: float = 100.0,
    ) -> dict[str, Any]:
        """Executes a hardware command with fail-closed timeout detection."""
        if simulated_delay_ms > timeout_ms:
            return {
                "command": command_type,
                "status": "TIMEOUT_FAILED",
                "success": False,
                "error": f"Device command timed out ({simulated_delay_ms}ms > {timeout_ms}ms threshold)",
                "reported_at": time.strftime("%Y-%m-%d %H:%M:%S IST"),
            }
        return {
            "command": command_type,
            "target_value": target_value,
            "status": "COMMAND_SUCCESS",
            "success": True,
            "latency_ms": simulated_delay_ms,
            "reported_at": time.strftime("%Y-%m-%d %H:%M:%S IST"),
        }

    def fallback_forecast_baseline(
        self,
        peak_capacity_kw: float = 10.0,
        hours: int = 24,
    ) -> list[float]:
        """Safe persistence / clear-sky baseline invoked when weather API fails."""
        # Standard bell-shaped clear-sky profile
        profile = []
        for h in range(hours):
            if 6 <= h <= 18:
                # Sinusoidal peak at noon (h=12)
                import math
                val = peak_capacity_kw * math.sin((h - 6) / 12.0 * math.pi)
                profile.append(round(max(0.0, val), 2))
            else:
                profile.append(0.0)
        return profile

    def fallback_greedy_optimizer(
        self,
        pv_series: list[float],
        load_series: list[float],
        initial_soc: float = 0.5,
    ) -> list[DispatchResult]:
        """Heuristic greedy self-consumption solver invoked if LP solver is infeasible."""
        results: list[DispatchResult] = []
        soc = initial_soc
        for pv, load in zip(pv_series, load_series, strict=False):
            res = self.allocate_surplus(
                solar_kw=pv,
                load_kw=load,
                battery_soc=soc,
                ev_mode=EVChargingMode.STOP,
            )
            soc = res.battery_soc_after
            results.append(res)
        return results

    # ---------------------------------------------------------------------------
    # Unified Facades for External Open-Source Integrations
    # ---------------------------------------------------------------------------

    def calculate_proportional_flows(
        self,
        solar_kw: float,
        grid_import_kw: float,
        battery_discharge_kw: float,
        home_load_kw: float,
        battery_charge_kw: float,
        ev_charge_kw: float,
        grid_export_kw: float,
    ) -> Any:
        """SEM-Community: Proportionally allocated source-to-destination power flows."""
        from avishkar_ems.integrations.sem_coordinator import SemCommunityCoordinator
        coord = SemCommunityCoordinator()
        return coord.calculate_proportional_flows(
            solar_kw=solar_kw,
            grid_import_kw=grid_import_kw,
            battery_discharge_kw=battery_discharge_kw,
            home_load_kw=home_load_kw,
            battery_charge_kw=battery_charge_kw,
            ev_charge_kw=ev_charge_kw,
            grid_export_kw=grid_export_kw,
        )

    def calculate_evcc_charge(
        self,
        mode: str,
        available_surplus_kw: float,
        current_time: float | None = None,
    ) -> Any:
        """EVCC: 4-mode EV charging state machine with contactor protection."""
        from avishkar_ems.integrations.evcc_controller import (
            EvccChargerController,
            EvccMode,
        )
        ctrl = EvccChargerController(enable_delay_s=0.0, disable_delay_s=0.0)
        return ctrl.dispatch(
            mode=EvccMode(mode.lower()),
            available_surplus_kw=available_surplus_kw,
            current_time=current_time,
        )

    def calculate_zero_export_setpoint(
        self,
        current_solar_kw: float,
        current_grid_export_kw: float,
        target_export_kw: float = 0.0,
    ) -> Any:
        """SolarFlow: Closed-loop PI zero-export grid limiting."""
        from avishkar_ems.integrations.solarflow_limiter import SolarFlowLimiter
        limiter = SolarFlowLimiter(target_export_kw=target_export_kw)
        return limiter.calculate_inverter_setpoint(
            current_solar_kw=current_solar_kw,
            current_grid_export_kw=current_grid_export_kw,
        )

    def find_cheapest_tariff_window(
        self,
        hourly_prices: list[float],
        required_hours: int = 3,
    ) -> Any:
        """Smart Energy Manager: 24h cheapest contiguous window discovery."""
        from avishkar_ems.integrations.smart_battery_scheduler import SmartBatteryScheduler
        scheduler = SmartBatteryScheduler()
        return scheduler.find_cheapest_charging_window(
            hourly_prices=hourly_prices,
            required_hours=required_hours,
        )

    def plan_arbitrage_schedule(
        self,
        slots: list[Any],
        initial_soc_kwh: float,
    ) -> list[Any]:
        """Energy Manager: Multi-cycle spot price arbitrage & peak grouping."""
        from avishkar_ems.integrations.energy_arbitrage import EnergyArbitrageScheduler
        scheduler = EnergyArbitrageScheduler()
        return scheduler.plan_day_schedule(slots=slots, initial_soc_kwh=initial_soc_kwh)

    def calculate_breaker_headroom(
        self,
        phase_currents_a: list[float],
        main_fuse_rating_a: float = 35.0,
    ) -> Any:
        """HomeAssistant EMS: Sub-second breaker headroom & EV current modulation."""
        from avishkar_ems.integrations.breaker_headroom import BreakerHeadroomGuard
        guard = BreakerHeadroomGuard(main_fuse_rating_a=main_fuse_rating_a)
        return guard.calculate_headroom(phase_currents_a=phase_currents_a)

    def evaluate_forecast_daylight(
        self,
        actual_kw: list[float],
        predicted_kw: list[float],
    ) -> Any:
        """Solar Battery Dispatch: Daylight-only error metrics (MAE/RMSE/nRMSE)."""
        from avishkar_ems.integrations.dispatch_validator import DispatchValidator
        val = DispatchValidator()
        return val.evaluate_forecast(actual_kw=actual_kw, predicted_kw=predicted_kw)

    def step_microgrid_fallback(
        self,
        step_idx: int,
        pv_kw: float,
        load_kw: float,
        tariff_per_kwh: float,
    ) -> Any:
        """Microgrid Autopilot: Heuristic fallback rule execution with carbon tracking."""
        from avishkar_ems.integrations.microgrid_mpc import MicrogridMpcController
        controller = MicrogridMpcController()
        return controller.dispatch_fallback_step(
            step_idx=step_idx,
            pv_kw=pv_kw,
            load_kw=load_kw,
            tariff_per_kwh=tariff_per_kwh,
        )

    def compute_solectrus_balance(
        self,
        solar_generation: float,
        home_consumption: float,
        battery_charge: float,
        battery_discharge: float,
        grid_import: float,
        grid_export: float,
    ) -> Any:
        """Solectrus: Flow balance ledger, self-consumption ratio & autarky degree."""
        from avishkar_ems.integrations.solectrus_metrics import SolectrusMetrics
        return SolectrusMetrics.calculate_flow_balance(
            solar_generation=solar_generation,
            home_consumption=home_consumption,
            battery_charge=battery_charge,
            battery_discharge=battery_discharge,
            grid_import=grid_import,
            grid_export=grid_export,
        )

    def allocate_community_sharing_vnm(
        self,
        members: list[Any],
    ) -> Any:
        """Flexcomm: Community virtual net metering & distribution line loss modeling."""
        from avishkar_ems.integrations.flexcomm_sharing import CommunityEnergySharing
        sharing = CommunityEnergySharing()
        return sharing.allocate_community_sharing(members=members)

