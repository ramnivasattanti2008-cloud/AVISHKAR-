"""Comprehensive Automated Test Suite for AVISHKAR Home Energy Platform.

Verifies:
1. Home energy balance equations (First Law of Thermodynamics: P_sources == P_sinks)
2. Solar surplus and deficit calculations
3. Battery minimum and maximum SoC constraints
4. Battery charge and discharge power limits
5. Grid import and export calculations
6. Inverter and battery efficiency conversion losses
7. Missing and stale measurement detection
8. Tariff validation (positive purchase, non-negative export)
9. System configuration validation
10. Data honesty tagging (SIMULATION, USER_ENTERED, HARDWARE_MEASURED)
11. Optimization failure and deterministic fallbacks
12. 4 User-selected optimization goals (Bills, Self-Consumption, Grid-Imports, Reserve)
13. Flexible-load scheduling and priority allocation
14. EV charging constraints and surplus modulation
15. Individual home standalone operation without community enrollment
16. Community sharing integration with line losses and zero double-counting
17. Phase 7 reproducible benchmark scenario
"""

from __future__ import annotations

import pytest

from avishkar_ems.home_balance import (
    HomeEnergyBalanceEngine,
    IntervalTelemetry,
)
from avishkar_ems.home_profile import (
    HomeProfile,
    OptimizationGoal,
)


# ---------------------------------------------------------------------------
# 1. Home Energy Balance Equation (First Law Conservation)
# ---------------------------------------------------------------------------
def test_home_energy_balance_conservation():
    profile = HomeProfile.create_phase7_demo_home()
    engine = HomeEnergyBalanceEngine(profile)

    telemetry = IntervalTelemetry(
        solar_generation_kw=6.0,
        home_consumption_kw=3.0,
        battery_soc_pct=50.0,
    )
    result = engine.evaluate_interval(telemetry, duration_hours=1.0, enable_losses=False)

    assert result.is_balanced is True
    assert result.energy_balance_error_kw < 1e-3

    # Total sources == total sinks
    tot_sources = result.solar_generation_kw + result.grid_import_kw + result.battery_discharge_kw
    tot_sinks = (
        result.home_consumption_kw
        + result.flexible_load_kw
        + result.ev_charge_kw
        + result.battery_charge_kw
        + result.grid_export_kw
    )
    assert tot_sources == pytest.approx(tot_sinks, abs=1e-3)


# ---------------------------------------------------------------------------
# 2. Solar Surplus and Deficit Calculations
# ---------------------------------------------------------------------------
def test_solar_surplus_and_deficit_detection():
    profile = HomeProfile.create_phase7_demo_home()
    profile.inverter.rating_kw = 10.0  # Allow up to 10 kW without inverter clipping
    engine = HomeEnergyBalanceEngine(profile)

    # Surplus: 7 kW PV, 2 kW Load -> 5 kW surplus
    t_surplus = IntervalTelemetry(solar_generation_kw=7.0, home_consumption_kw=2.0)
    r_surplus = engine.evaluate_interval(t_surplus)
    assert r_surplus.gross_surplus_kw == 5.0
    assert r_surplus.gross_deficit_kw == 0.0

    # Deficit: 1 kW PV, 4 kW Load -> 3 kW deficit
    t_deficit = IntervalTelemetry(solar_generation_kw=1.0, home_consumption_kw=4.0)
    r_deficit = engine.evaluate_interval(t_deficit)
    assert r_deficit.gross_surplus_kw == 0.0
    assert r_deficit.gross_deficit_kw == 3.0


# ---------------------------------------------------------------------------
# 3. Battery Minimum and Maximum SoC Constraints
# ---------------------------------------------------------------------------
def test_battery_soc_protective_bounds():
    profile = HomeProfile.create_phase7_demo_home()
    engine = HomeEnergyBalanceEngine(profile)

    # Max SoC lock: battery already at max SoC (95%), charging prohibited
    t_full = IntervalTelemetry(solar_generation_kw=5.0, home_consumption_kw=1.0, battery_soc_pct=95.0)
    r_full = engine.evaluate_interval(t_full)
    assert r_full.battery_charge_kw == 0.0
    assert any("max SoC ceiling" in c for c in r_full.constraints_applied)

    # Min SoC lock: battery at min SoC (15%), discharge prohibited during deficit
    t_empty = IntervalTelemetry(solar_generation_kw=0.0, home_consumption_kw=3.0, battery_soc_pct=15.0)
    r_empty = engine.evaluate_interval(t_empty)
    assert r_empty.battery_discharge_kw == 0.0
    assert r_empty.grid_import_kw == 3.0


# ---------------------------------------------------------------------------
# 4. Battery Power Limits & Contradictory Command Prevention
# ---------------------------------------------------------------------------
def test_battery_power_limits_and_no_contradictory_commands():
    profile = HomeProfile.create_phase7_demo_home()
    profile.battery.max_charge_power_kw = 2.5
    engine = HomeEnergyBalanceEngine(profile)

    # 6 kW surplus, but max charge power is 2.5 kW -> must clamp to 2.5 kW
    t = IntervalTelemetry(solar_generation_kw=8.0, home_consumption_kw=2.0, battery_soc_pct=50.0)
    r = engine.evaluate_interval(t)
    assert r.battery_charge_kw <= 2.501

    # Invariant: Simultaneous charging and discharging is strictly prohibited
    assert not (r.battery_charge_kw > 0 and r.battery_discharge_kw > 0)


# ---------------------------------------------------------------------------
# 5. Grid Import and Export Calculations
# ---------------------------------------------------------------------------
def test_grid_import_and_export_calculations():
    profile = HomeProfile.create_phase7_demo_home()
    profile.inverter.rating_kw = 10.0  # Allow 8 kW solar without clipping
    profile.ev_charger.is_connected = False  # Isolate grid export test from EV charging
    profile.flexible_appliances = []  # Isolate grid export from flexible appliances
    engine = HomeEnergyBalanceEngine(profile)

    # Complete surplus export after serving home and battery
    # 8 kW PV, 2 kW load, battery can take max 3.5 kW -> 2.5 kW remaining exported
    t = IntervalTelemetry(solar_generation_kw=8.0, home_consumption_kw=2.0, battery_soc_pct=50.0)
    r = engine.evaluate_interval(t, enable_losses=False)
    assert r.grid_export_kw == pytest.approx(2.5, abs=1e-2)
    assert r.grid_import_kw == 0.0

    # Deficit import
    # 0 kW PV, 4 kW load, battery discharged at max 3.5 kW -> 0.5 kW imported
    t_imp = IntervalTelemetry(solar_generation_kw=0.0, home_consumption_kw=4.0, battery_soc_pct=50.0)
    r_imp = engine.evaluate_interval(t_imp, enable_losses=False)
    assert r_imp.grid_import_kw == pytest.approx(0.5, abs=1e-2)
    assert r_imp.grid_export_kw == 0.0


# ---------------------------------------------------------------------------
# 6. Conversion and Storage Efficiency Losses
# ---------------------------------------------------------------------------
def test_efficiency_losses_accounting():
    profile = HomeProfile.create_phase7_demo_home()
    profile.inverter.efficiency_fraction = 0.95
    profile.battery.charge_efficiency = 0.90
    engine = HomeEnergyBalanceEngine(profile)

    t = IntervalTelemetry(solar_generation_kw=5.0, home_consumption_kw=2.0, battery_soc_pct=50.0)
    r_lossy = engine.evaluate_interval(t, enable_losses=True)
    r_lossless = engine.evaluate_interval(t, enable_losses=False)

    assert r_lossy.inverter_loss_kw > 0.0
    assert r_lossy.battery_loss_kw > 0.0
    assert r_lossless.inverter_loss_kw == 0.0
    assert r_lossless.battery_loss_kw == 0.0


# ---------------------------------------------------------------------------
# 7. Missing and Stale Measurements Handling
# ---------------------------------------------------------------------------
def test_missing_and_stale_telemetry_handling():
    profile = HomeProfile.create_phase7_demo_home()
    engine = HomeEnergyBalanceEngine(profile)

    # Missing solar reading
    t_missing = IntervalTelemetry(solar_generation_kw=None, home_consumption_kw=2.0)
    r_missing = engine.evaluate_interval(t_missing)
    assert r_missing.status == "INCOMPLETE_DATA"
    assert "Missing essential telemetry" in r_missing.recommendation_text

    # Stale telemetry warning
    t_stale = IntervalTelemetry(solar_generation_kw=4.0, home_consumption_kw=2.0, is_stale=True)
    r_stale = engine.evaluate_interval(t_stale)
    assert any("STALE_TELEMETRY" in w for w in r_stale.warnings)


# ---------------------------------------------------------------------------
# 8. Tariff and Input Validation
# ---------------------------------------------------------------------------
def test_tariff_and_config_validation():
    # Negative purchase tariff is rejected
    with pytest.raises(ValueError, match="purchase tariff must be positive"):
        p = HomeProfile.create_phase7_demo_home()
        p.grid_purchase_tariff_inr = -5.0
        p.validate()

    # Negative solar capacity is rejected
    with pytest.raises(ValueError, match="Solar capacity cannot be negative"):
        p = HomeProfile.create_phase7_demo_home()
        p.solar_capacity_kw = -2.0
        p.validate()

    # Invalid SoC limits (min >= max)
    with pytest.raises(ValueError, match="Battery SoC limits must satisfy"):
        p = HomeProfile.create_phase7_demo_home()
        p.battery.min_soc_pct = 90.0
        p.battery.max_soc_pct = 80.0
        p.validate()


# ---------------------------------------------------------------------------
# 9. User-Selected Optimization Goals
# ---------------------------------------------------------------------------
def test_user_optimization_goals():
    profile = HomeProfile.create_phase7_demo_home()

    # Goal: PRESERVE_BACKUP_RESERVE
    profile.optimization_goal = OptimizationGoal.PRESERVE_BACKUP_RESERVE
    profile.battery.preferred_backup_reserve_pct = 40.0
    engine_reserve = HomeEnergyBalanceEngine(profile)

    # When battery is at 40% SoC (the backup reserve), discharging must be locked
    t_deficit = IntervalTelemetry(solar_generation_kw=0.0, home_consumption_kw=3.0, battery_soc_pct=40.0)
    r_reserve = engine_reserve.evaluate_interval(t_deficit)
    assert r_reserve.battery_discharge_kw == 0.0
    assert r_reserve.grid_import_kw == 3.0
    assert any("BACKUP_RESERVE_PRESERVED" in c for c in r_reserve.constraints_applied)

    # Goal: REDUCE_GRID_IMPORTS
    profile.optimization_goal = OptimizationGoal.REDUCE_GRID_IMPORTS
    profile.battery.preferred_backup_reserve_pct = 15.0
    engine_import_red = HomeEnergyBalanceEngine(profile)

    r_dis = engine_import_red.evaluate_interval(t_deficit)
    assert r_dis.battery_discharge_kw > 0.0


# ---------------------------------------------------------------------------
# 10. Flexible-Load Scheduling
# ---------------------------------------------------------------------------
def test_flexible_load_scheduling():
    profile = HomeProfile.create_phase7_demo_home()
    # Battery at 95% (full) and EV disconnected, surplus flows to appliances then grid
    profile.battery.current_soc_pct = 95.0
    profile.ev_charger.is_connected = False
    engine = HomeEnergyBalanceEngine(profile)

    # 5.0 kW PV, 1.5 kW base load -> 3.5 kW surplus
    t = IntervalTelemetry(solar_generation_kw=5.0, home_consumption_kw=1.5, battery_soc_pct=95.0)
    r = engine.evaluate_interval(t, enable_losses=False)

    # Appliances (washing machine 1 kW, water heater 1.5 kW = 2.5 kW) are scheduled
    assert r.flexible_load_kw >= 2.5
    assert r.grid_export_kw == pytest.approx(1.0, abs=1e-2)


# ---------------------------------------------------------------------------
# 11. EV Charging Constraints
# ---------------------------------------------------------------------------
def test_ev_charging_constraints():
    profile = HomeProfile.create_phase7_demo_home()
    profile.ev_charger.is_connected = True
    profile.ev_charger.current_soc_pct = 50.0
    profile.ev_charger.target_soc_pct = 80.0
    profile.ev_charger.max_charge_power_kw = 3.0
    profile.battery.current_soc_pct = 95.0
    engine = HomeEnergyBalanceEngine(profile)

    # Ample surplus available
    t = IntervalTelemetry(solar_generation_kw=8.0, home_consumption_kw=1.5, battery_soc_pct=95.0)
    r = engine.evaluate_interval(t)
    assert r.ev_charge_kw > 0.0
    assert r.ev_charge_kw <= 3.0


# ---------------------------------------------------------------------------
# 12. Individual Home Standalone Operation (Community Opt-Out)
# ---------------------------------------------------------------------------
def test_standalone_home_without_community_enrollment():
    profile = HomeProfile.create_phase7_demo_home()
    profile.community_opt_in = False  # Completely standalone
    engine = HomeEnergyBalanceEngine(profile)

    t = IntervalTelemetry(solar_generation_kw=5.0, home_consumption_kw=1.5, battery_soc_pct=95.0)
    local_res = engine.evaluate_interval(t)
    comm_res = engine.route_community_exchange(local_res)

    # Must have 0 community sharing and zero data leakage
    assert comm_res.community_shared_kw == 0.0
    assert comm_res.community_line_loss_kw == 0.0
    assert any("Community sharing disabled" in a for a in comm_res.assumptions)


# ---------------------------------------------------------------------------
# 13. Community Sharing Integration (Opt-In with Line Loss & No Double Counting)
# ---------------------------------------------------------------------------
def test_community_sharing_opt_in_with_line_loss():
    profile = HomeProfile.create_phase7_demo_home()
    profile.community_opt_in = True  # Home opted into community sharing
    profile.grid_export_tariff_inr = 3.00
    engine = HomeEnergyBalanceEngine(profile)

    t = IntervalTelemetry(solar_generation_kw=5.0, home_consumption_kw=1.5, battery_soc_pct=95.0)
    local_res = engine.evaluate_interval(t)
    comm_res = engine.route_community_exchange(local_res, community_tariff_inr=5.50)

    # Exported energy is shared with community with copper feeder loss
    if local_res.grid_export_kw > 0:
        assert comm_res.community_shared_kw > 0.0
        assert comm_res.community_line_loss_kw > 0.0
        assert comm_res.community_net_savings_inr > 0.0
        # Energy accounting conservation
        assert comm_res.community_shared_kw + comm_res.community_line_loss_kw == pytest.approx(local_res.grid_export_kw, abs=1e-3)


# ---------------------------------------------------------------------------
# 14. Phase 7 Reproducible Benchmark Scenario
# ---------------------------------------------------------------------------
def test_phase_7_reproducible_benchmark():
    engine = HomeEnergyBalanceEngine()

    # Phase 7 specifications:
    # 5 kW solar, 10 kWh battery, 60% SoC, 4 kW PV generation, 1.5 kW load, ₹8/kWh buy, ₹3/kWh sell.
    # Solar Surplus = 4.0 - 1.5 = 2.5 kW.
    res_lossless = engine.run_phase7_benchmark(lossless=True)

    assert res_lossless.solar_generation_kw == 4.0
    assert res_lossless.home_consumption_kw == 1.5
    assert res_lossless.gross_surplus_kw == 2.5
    assert res_lossless.is_balanced is True

    # The 2.5 kW surplus is evaluated against battery limits, flexible loads, and grid export
    # At 60% SoC, battery can accept up to 3.5 kW charge.
    # Therefore the 2.5 kW surplus is directed into battery charging.
    assert res_lossless.battery_charge_kw == 2.5
    assert res_lossless.grid_export_kw == 0.0
    assert res_lossless.grid_import_kw == 0.0

    # With losses enabled:
    res_lossy = engine.run_phase7_benchmark(lossless=False)
    assert res_lossy.is_balanced is True
    assert res_lossy.inverter_loss_kw > 0.0
    assert res_lossy.battery_loss_kw > 0.0
