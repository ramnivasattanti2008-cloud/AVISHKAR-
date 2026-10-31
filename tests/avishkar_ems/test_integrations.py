"""Unit tests for External Open-Source Energy Management System Integrations.

Verifies algorithms imported and adapted from:
1. SEM-Community (traktore-org/sem-community)
2. EVCC (evcc-io/evcc)
3. SolarFlow (lbsanto/SolarFlow)
4. Smart Energy Manager (jirihelmich/smart-energy-manager)
5. SunCore (PXLJAKE/SunCore)
6. Energy Manager (jyourstone/energy_manager)
7. HomeAssistant EMS (thomasgodon/homeassistant-ems)
8. Solar Battery Dispatch (Quentinluoqz/solar-battery-dispatch)
9. Microgrid Autopilot (isahan78/microgrid-autopilot)
10. Solectrus (solectrus/solectrus)
11. Flexcomm (Enpower-project/Flexcomm)
"""

from __future__ import annotations

import pytest

from avishkar_ems.integrations import (
    ArbitrageAction,
    BreakerHeadroomGuard,
    CommunityEnergySharing,
    CommunityMember,
    ControllableLoad,
    DispatchValidator,
    EnergyArbitrageScheduler,
    EvccChargerController,
    EvccMode,
    FreshnessStatus,
    InverterBrand,
    MicrogridMpcController,
    SemCommunityCoordinator,
    SmartBatteryScheduler,
    SolarFlowLimiter,
    SolectrusMetrics,
    SunCoreThermalBuffer,
    ThermalDevice,
    ThermalDeviceType,
    TimeSlot,
)
from avishkar_ems.surplus_engine import SurplusEngine


# ---------------------------------------------------------------------------
# 1. SEM-Community Proportional Flow & Priority Coordinator
# ---------------------------------------------------------------------------
def test_sem_community_proportional_flows():
    coord = SemCommunityCoordinator()
    # 6 kW solar, 4 kW grid import, 0 kW battery discharge -> 10 kW total source (60% solar, 40% grid)
    # Destinations: 5 kW home load, 3 kW battery charge, 2 kW EV charge -> 10 kW total dest
    res = coord.calculate_proportional_flows(
        solar_kw=6.0,
        grid_import_kw=4.0,
        battery_discharge_kw=0.0,
        home_load_kw=5.0,
        battery_charge_kw=3.0,
        ev_charge_kw=2.0,
        grid_export_kw=0.0,
    )
    assert res.is_balanced is True
    assert res.home_solar_share_pct == 60.0
    assert res.home_grid_share_pct == 40.0
    assert res.ev_solar_share_pct == 60.0
    assert res.ev_grid_share_pct == 40.0


# ---------------------------------------------------------------------------
# 2. EVCC 4-Mode Solar EV Charger Controller
# ---------------------------------------------------------------------------
def test_evcc_charger_modes():
    ctrl = EvccChargerController(enable_delay_s=0.0, disable_delay_s=0.0)

    # Mode OFF
    res_off = ctrl.dispatch(EvccMode.OFF, available_surplus_kw=5.0)
    assert res_off.is_charging is False
    assert res_off.charge_power_kw == 0.0

    # Mode NOW (fast full power, e.g. 7.36 kW on 1P @ 32A)
    res_now = ctrl.dispatch(EvccMode.NOW, available_surplus_kw=2.0)
    assert res_now.is_charging is True
    assert res_now.charge_power_kw == pytest.approx(7.36, rel=1e-2)
    assert res_now.from_solar_kw == 2.0
    assert res_now.from_grid_kw == pytest.approx(5.36, rel=1e-2)

    # Mode PV with insufficient surplus (< 1.38 kW)
    res_pv_low = ctrl.dispatch(EvccMode.PV, available_surplus_kw=0.8)
    assert res_pv_low.is_charging is False

    # Mode PV with ample surplus (4.0 kW)
    res_pv_high = ctrl.dispatch(EvccMode.PV, available_surplus_kw=4.0)
    assert res_pv_high.is_charging is True
    assert res_pv_high.charge_power_kw == pytest.approx(4.0, rel=1e-2)
    assert res_pv_high.from_grid_kw == 0.0


# ---------------------------------------------------------------------------
# 3. SolarFlow PI Zero-Export Limiter & Relay Coordinator
# ---------------------------------------------------------------------------
def test_solarflow_zero_export_limiter():
    limiter = SolarFlowLimiter(target_export_kw=0.0, kp=0.8, ki=0.1)

    # When exporting 2.5 kW with 5 kW solar, PI should throttle inverter
    decision = limiter.calculate_inverter_setpoint(
        current_solar_kw=5.0,
        current_grid_export_kw=2.5,
        current_time=100.0,
    )
    assert decision.is_throttled is True
    assert decision.suggested_inverter_power_kw < 5.0
    assert decision.error_kw == 2.5

    # Register loads and test relay dispatch
    water_heater = ControllableLoad(
        device_id="wh_01",
        name="Water Heater",
        nominal_power_kw=1.5,
        priority=1,
        min_off_seconds=10.0,
        min_on_seconds=10.0,
        last_switched_timestamp=0.0,
    )
    limiter.register_load(water_heater)

    # Turn on load when surplus is 2.0 kW
    actions = limiter.evaluate_relays(surplus_kw=2.0, current_time=50.0)
    assert ("wh_01", "TURN_ON") in actions
    assert water_heater.is_on is True


# ---------------------------------------------------------------------------
# 4. Smart Energy Manager Dynamic Price Analyzer & Register Map
# ---------------------------------------------------------------------------
def test_smart_energy_manager_scheduler():
    scheduler = SmartBatteryScheduler()
    prices = [0.25, 0.22, 0.18, 0.12, 0.10, 0.11, 0.19, 0.30, 0.35, 0.28]

    # Cheapest 3-hour window should be hours 3, 4, 5 (prices 0.12, 0.10, 0.11 -> avg 0.11)
    window = scheduler.find_cheapest_charging_window(prices, required_hours=3)
    assert window.start_hour == 3
    assert window.duration_hours == 3
    assert window.avg_price == pytest.approx(0.11, abs=1e-3)

    # Percentiles
    pcts = scheduler.classify_price_percentiles(prices)
    assert pcts["low_threshold"] < pcts["median"] < pcts["high_threshold"]

    # Register mapping for Victron
    victron_cmds = scheduler.generate_inverter_commands(
        InverterBrand.VICTRON,
        target_charge_power_w=3000.0,
        target_discharge_power_w=0.0,
    )
    assert len(victron_cmds) == 2
    assert victron_cmds[0].register_address == 2700
    assert victron_cmds[0].value == 3000


# ---------------------------------------------------------------------------
# 5. SunCore Stepped Thermal Allocator & Hysteresis
# ---------------------------------------------------------------------------
def test_suncore_thermal_buffer():
    buffer = SunCoreThermalBuffer(hysteresis_w=200.0, deficit_delay_s=60.0)
    boiler = ThermalDevice(
        device_id="boiler_1",
        device_type=ThermalDeviceType.IMMERSION_HEATER,
        power_steps_kw=[0.0, 1.0, 2.0, 3.0],
        current_step_idx=0,
        settle_s=5.0,
        min_run_s=10.0,
        last_transition_ts=0.0,
    )
    buffer.register_device(boiler)

    # 1.5 kW surplus covers step 1 (1.0 kW) + 0.2 kW hysteresis
    res_up = buffer.allocate("boiler_1", available_surplus_kw=1.5, current_time=20.0)
    assert res_up.transition_occurred is True
    assert res_up.allocated_step_idx == 1
    assert res_up.allocated_power_kw == 1.0

    # Deficit occurs: surplus drops to 0.5 kW while boiler draws 1.0 kW.
    # Battery at 80% SoC buffers deficit without dropping level immediately.
    res_buffer = buffer.allocate(
        "boiler_1",
        available_surplus_kw=0.5,
        battery_reserve_pct=50.0,
        battery_current_soc=80.0,
        current_time=30.0,
    )
    assert res_buffer.transition_occurred is False
    assert res_buffer.allocated_step_idx == 1


# ---------------------------------------------------------------------------
# 6. Energy Manager Spread Arbitrage & Peak Scheduler
# ---------------------------------------------------------------------------
def test_energy_arbitrage_scheduler():
    scheduler = EnergyArbitrageScheduler(battery_capacity_kwh=10.0, discharge_spread_threshold=0.05)
    slots = [
        TimeSlot(slot_index=0, price=0.08),  # Cheap -> charge
        TimeSlot(slot_index=1, price=0.10),
        TimeSlot(slot_index=2, price=0.15),
        TimeSlot(slot_index=3, price=0.35),  # Expensive -> discharge
    ]
    plan = scheduler.plan_day_schedule(slots, initial_soc_kwh=3.0)
    assert len(plan) == 4
    assert plan[0].action == ArbitrageAction.CHARGE
    assert plan[0].battery_flow_kw > 0.0
    assert plan[3].action in (ArbitrageAction.DISCHARGE, ArbitrageAction.EXPORT)
    assert plan[3].battery_flow_kw < 0.0


# ---------------------------------------------------------------------------
# 7. HomeAssistant EMS Breaker Headroom Guard
# ---------------------------------------------------------------------------
def test_breaker_headroom_guard():
    # 35A main fuse, 2A safety margin -> 33A limit
    guard = BreakerHeadroomGuard(main_fuse_rating_a=35.0, safety_margin_a=2.0)

    # Normal load: 15A, 18A, 12A -> bottleneck phase 2 (18A), headroom = 15A
    res_normal = guard.calculate_headroom([15.0, 18.0, 12.0])
    assert res_normal.is_limiting is False
    assert res_normal.bottleneck_phase == 2
    assert res_normal.available_headroom_a == 15.0

    # Overload risk: 31A, 20A, 15A -> phase 1 leaves only 2A headroom (< 6A min EV current)
    res_tight = guard.calculate_headroom([31.0, 20.0, 15.0])
    assert res_tight.is_limiting is True
    assert res_tight.safe_ev_current_a == 0.0


# ---------------------------------------------------------------------------
# 8. Solar Battery Dispatch Daylight Error Metrics
# ---------------------------------------------------------------------------
def test_dispatch_validator_daylight_metrics():
    validator = DispatchValidator(daylight_threshold_kw=0.1)
    actuals = [0.0, 0.0, 0.5, 2.0, 4.0, 0.0]
    preds = [0.05, 0.02, 0.6, 1.8, 4.2, 0.01]

    metrics = validator.evaluate_forecast(actuals, preds)
    assert metrics.total_hours_count == 6
    assert metrics.daylight_hours_count == 3  # hours 2, 3, 4
    assert metrics.daylight_mae > 0.0
    assert metrics.daylight_rmse > 0.0


# ---------------------------------------------------------------------------
# 9. Microgrid Autopilot MPC Fallback Rules & Island Survival
# ---------------------------------------------------------------------------
def test_microgrid_autopilot_mpc_fallback():
    controller = MicrogridMpcController(battery_capacity_kwh=20.0, initial_soc_pct=50.0)

    # Surplus step: 8 kW PV, 3 kW Load -> 5 kW net surplus charges battery
    res_charge = controller.dispatch_fallback_step(
        step_idx=0,
        pv_kw=8.0,
        load_kw=3.0,
        tariff_per_kwh=0.15,
    )
    assert res_charge.battery_charge_kw > 0.0
    assert res_charge.soc_pct > 50.0

    # Island blackout survival duration: 10 kWh usable energy / 2 kW critical load = 4.7h (with 95% eff)
    survival_hours = controller.simulate_island_survival(critical_load_kw=2.0)
    assert survival_hours > 2.0


# ---------------------------------------------------------------------------
# 10. Solectrus Flow Balance & Freshness Scoring
# ---------------------------------------------------------------------------
def test_solectrus_metrics_and_freshness():
    # 5 kW PV, 3 kW load, 1 kW battery charge, 1 kW export
    flow = SolectrusMetrics.calculate_flow_balance(
        solar_generation=5.0,
        home_consumption=3.0,
        battery_charge=1.0,
        battery_discharge=0.0,
        grid_import=0.0,
        grid_export=1.0,
    )
    assert flow.self_consumption_pct == 80.0  # (3 kW direct + 1 kW batt) / 5 kW PV
    assert flow.autarky_pct == 100.0         # 100% covered locally
    assert flow.balance_discrepancy < 1e-3

    # Freshness
    fresh_score = SolectrusMetrics.evaluate_freshness(last_updated_timestamp=100.0, current_time=150.0)
    assert fresh_score.status == FreshnessStatus.FRESH
    assert fresh_score.is_acceptable is True

    stale_score = SolectrusMetrics.evaluate_freshness(last_updated_timestamp=100.0, current_time=800.0)
    assert stale_score.status == FreshnessStatus.STALE
    assert stale_score.is_acceptable is False


# ---------------------------------------------------------------------------
# 11. Flexcomm Community Energy Sharing & Line Loss
# ---------------------------------------------------------------------------
def test_flexcomm_community_energy_sharing():
    sharing = CommunityEnergySharing()
    members = [
        CommunityMember(site_id="site_A", name="Solar Villa", generation_kw=8.0, consumption_kw=2.0), # +6 kW surplus
        CommunityMember(site_id="site_B", name="Townhouse", generation_kw=1.0, consumption_kw=4.0),   # -3 kW deficit
        CommunityMember(site_id="site_C", name="Workshop", generation_kw=0.0, consumption_kw=2.0),    # -2 kW deficit
    ]
    summary = sharing.allocate_community_sharing(members)
    assert summary.internal_shared_kw == pytest.approx(5.0, abs=1e-2)
    assert summary.net_grid_export_kw == pytest.approx(1.0, abs=1e-2)
    assert summary.total_line_loss_kw > 0.0
    assert len(summary.trades) == 2


# ---------------------------------------------------------------------------
# 12. SurplusEngine Facade Methods
# ---------------------------------------------------------------------------
def test_surplus_engine_integration_facades():
    engine = SurplusEngine()
    proportional = engine.calculate_proportional_flows(
        solar_kw=4.0,
        grid_import_kw=2.0,
        battery_discharge_kw=0.0,
        home_load_kw=4.0,
        battery_charge_kw=1.0,
        ev_charge_kw=1.0,
        grid_export_kw=0.0,
    )
    assert proportional.is_balanced is True

    evcc_res = engine.calculate_evcc_charge(mode="pv", available_surplus_kw=3.5)
    assert evcc_res.is_charging is True

    breaker_res = engine.calculate_breaker_headroom([10.0, 12.0, 11.0])
    assert breaker_res.is_limiting is False
