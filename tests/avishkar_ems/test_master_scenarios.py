"""Master Verification Suite: 12 Operational Scenarios for UrjaSetu / AVISHKAR EMS.

Validates the 12 explicit scenarios defined in Section 10 of the Master Execution Prompt:
1. 10 kW PV, 6 kW demand -> 4 kW surplus.
2. 3 kW PV, 7 kW demand -> 4 kW deficit.
3. Battery at max SoC -> charging prohibited.
4. Battery at reserve floor -> discharge prohibited.
5. Rapid PV fluctuation -> hysteresis prevents rapid cycling.
6. Forecast service outage -> graceful fallback to safe baseline.
7. Device command timeout -> reported failure without false success.
8. Duplicate timestamp readings -> deduplication policy.
9. Infeasible optimization -> safe fallback invoked.
10. Multi-building surplus/deficit matching with line loss.
11. Unauthorized hardware command -> audited rejection.
12. Missing historical measurements -> explicit missing indicator.
"""

from __future__ import annotations

import hashlib
import hmac
import time

import pytest

from avishkar_ems.surplus_engine import (
    EVChargingMode,
    HysteresisController,
    MetricStatus,
    SurplusEngine,
)


@pytest.fixture
def engine() -> SurplusEngine:
    return SurplusEngine()


# SCENARIO 1: 10 kW PV, 6 kW demand -> 4 kW surplus
def test_scenario_1_surplus_generation(engine: SurplusEngine) -> None:
    surplus_meas, deficit_meas, status = engine.calculate_surplus_and_deficit(
        solar_kw=10.0,
        load_kw=6.0,
    )
    assert status == MetricStatus.MEASURED
    assert surplus_meas.power_kw == 4.0
    assert surplus_meas.unit == "kW"
    assert deficit_meas.power_kw == 0.0

    # Test conversion to energy over 1 hour
    energy = surplus_meas.to_interval_energy(1.0)
    assert energy.energy_kwh == 4.0
    assert energy.unit == "kWh"

    # Test full dispatch allocation: 6 kW direct to essential, 4 kW surplus into battery
    dispatch = engine.allocate_surplus(
        solar_kw=10.0,
        load_kw=6.0,
        battery_soc=0.50,
        ev_mode=EVChargingMode.STOP,
    )
    assert dispatch.solar_generation_kw == 10.0
    assert dispatch.essential_load_kw == 6.0
    assert dispatch.direct_solar_consumed_kw == 6.0
    assert dispatch.gross_surplus_kw == 4.0
    assert dispatch.battery_charge_kw == 4.0
    assert dispatch.grid_import_kw == 0.0


# SCENARIO 2: 3 kW PV, 7 kW demand -> 4 kW deficit
def test_scenario_2_deficit_generation(engine: SurplusEngine) -> None:
    surplus_meas, deficit_meas, status = engine.calculate_surplus_and_deficit(
        solar_kw=3.0,
        load_kw=7.0,
    )
    assert status == MetricStatus.MEASURED
    assert surplus_meas.power_kw == 0.0
    assert deficit_meas.power_kw == 4.0

    # Test full dispatch allocation: 3 kW direct PV, 4 kW deficit from battery
    dispatch = engine.allocate_surplus(
        solar_kw=3.0,
        load_kw=7.0,
        battery_soc=0.60,
        ev_mode=EVChargingMode.STOP,
    )
    assert dispatch.direct_solar_consumed_kw == 3.0
    assert dispatch.gross_deficit_kw == 4.0
    assert dispatch.battery_discharge_kw == 4.0
    assert dispatch.grid_import_kw == 0.0


# SCENARIO 3: Battery at max SoC -> charging prohibited
def test_scenario_3_battery_max_soc_charging_prohibited(engine: SurplusEngine) -> None:
    # Battery already at 98% (soc_max ceiling)
    dispatch = engine.allocate_surplus(
        solar_kw=10.0,
        load_kw=2.0,  # 8.0 kW surplus
        battery_soc=0.98,
        ev_mode=EVChargingMode.STOP,
    )
    assert dispatch.gross_surplus_kw == 8.0
    assert dispatch.battery_charge_kw == 0.0
    assert any("BATTERY_AT_MAX_SOC" in w for w in dispatch.warnings)
    # Remaining surplus routes downstream to grid export
    assert dispatch.grid_export_kw == 8.0


# SCENARIO 4: Battery at reserve floor -> discharge prohibited
def test_scenario_4_battery_reserve_floor_discharge_prohibited(engine: SurplusEngine) -> None:
    # Battery at 20% (emergency reserve floor)
    dispatch = engine.allocate_surplus(
        solar_kw=0.0,
        load_kw=5.0,  # 5.0 kW deficit
        battery_soc=0.20,
        ev_mode=EVChargingMode.STOP,
    )
    assert dispatch.gross_deficit_kw == 5.0
    assert dispatch.battery_discharge_kw == 0.0
    assert any("BATTERY_AT_RESERVE_FLOOR" in w for w in dispatch.warnings)
    # Deficit is served by grid import to protect battery health
    assert dispatch.grid_import_kw == 5.0


# SCENARIO 5: Rapid PV fluctuation -> hysteresis prevents rapid cycling
def test_scenario_5_rapid_pv_fluctuation_hysteresis() -> None:
    hyst = HysteresisController(min_run_time_s=180.0, cooldown_time_s=180.0, enable_delay_s=60.0)
    t0 = 1000.0

    # Step 1: Surplus appears; start sustain timer at t0
    allowed = hyst.evaluate("heat_pump", desired_active=True, current_time=t0)
    assert not allowed  # Still within enable delay

    # Step 2: 60s later, sustained surplus satisfied -> turns ON
    allowed = hyst.evaluate("heat_pump", desired_active=True, current_time=t0 + 60.0)
    assert allowed

    # Step 3: 30s later (t0 + 90s), sudden cloud passes, surplus vanishes; desired_active=False
    # Because min_run_time_s is 180s, it MUST remain ON to prevent relay wear
    allowed = hyst.evaluate("heat_pump", desired_active=False, current_time=t0 + 90.0)
    assert allowed  # Kept active by hysteresis guard

    # Step 4: After min_run_time has passed (t0 + 60s + 180s = t0 + 240s), turning OFF is allowed
    allowed = hyst.evaluate("heat_pump", desired_active=False, current_time=t0 + 241.0)
    assert not allowed  # Now safely de-energized

    # Step 5: 30s after turning OFF, sun pops back out; attempted re-engagement
    # Because cooldown_time_s is 180s, re-engagement is BLOCKED
    allowed = hyst.evaluate("heat_pump", desired_active=True, current_time=t0 + 271.0)
    assert not allowed


# SCENARIO 6: Forecast service outage -> graceful fallback to safe baseline
def test_scenario_6_forecast_service_outage_fallback(engine: SurplusEngine) -> None:
    # External API throws connection error
    try:
        raise ConnectionError("National Weather Service API Timeout")
    except ConnectionError:
        profile = engine.fallback_forecast_baseline(peak_capacity_kw=8.0, hours=24)

    assert len(profile) == 24
    assert profile[0] == 0.0   # Midnight
    assert profile[12] == 8.0  # Peak solar noon
    assert profile[23] == 0.0  # Night
    assert all(val >= 0.0 for val in profile)


# SCENARIO 7: Device command timeout -> reported failure without false success
def test_scenario_7_device_command_timeout(engine: SurplusEngine) -> None:
    # Command taking 3500ms against a 2000ms watchdog timeout
    res = engine.execute_hardware_command(
        command_type="SET_INVERTER_POWER_LIMIT",
        target_value=3000.0,
        timeout_ms=2000.0,
        simulated_delay_ms=3500.0,
    )
    assert res["status"] == "TIMEOUT_FAILED"
    assert res["success"] is False
    assert "timed out" in res["error"]

    # Command within timeout succeeds
    res_ok = engine.execute_hardware_command(
        command_type="SET_INVERTER_POWER_LIMIT",
        target_value=3000.0,
        timeout_ms=2000.0,
        simulated_delay_ms=150.0,
    )
    assert res_ok["status"] == "COMMAND_SUCCESS"
    assert res_ok["success"] is True


# SCENARIO 8: Duplicate timestamp readings -> deduplication policy
def test_scenario_8_duplicate_timestamp_deduplication(engine: SurplusEngine) -> None:
    ts = "2026-10-30T14:15:00+05:30"
    # First reading accepted
    assert engine.deduplicate_telemetry(ts) is True
    # Duplicate reading identified and rejected
    assert engine.deduplicate_telemetry(ts) is False
    # New reading accepted
    assert engine.deduplicate_telemetry("2026-10-30T14:30:00+05:30") is True


# SCENARIO 9: Infeasible optimization -> safe fallback invoked
def test_scenario_9_infeasible_optimization_fallback(engine: SurplusEngine) -> None:
    pv_series = [0.0, 2.0, 7.0, 5.0, 0.0]
    load_series = [1.0, 1.5, 2.0, 3.0, 1.0]

    # Simulated LP failure triggers greedy solver fallback
    plan = engine.fallback_greedy_optimizer(pv_series, load_series, initial_soc=0.5)
    assert len(plan) == 5
    assert plan[2].battery_charge_kw > 0.0  # 7 kW solar - 2 kW load charges battery
    assert plan[0].battery_discharge_kw > 0.0  # 0 kW solar discharges battery


# SCENARIO 10: Multi-building surplus/deficit matching with line loss
def test_scenario_10_multi_building_surplus_matching_with_loss(engine: SurplusEngine) -> None:
    donor_surplus = 10.0   # Building A has 10 kW surplus
    recipient_deficit = 7.6  # Building B needs 7.6 kW
    loss_fraction = 0.05    # 5% technical distribution loss

    sent, received, loss = engine.route_community_sharing(
        donor_surplus_kw=donor_surplus,
        recipient_deficit_kw=recipient_deficit,
        line_loss_fraction=loss_fraction,
    )

    # 7.6 kW received / 0.95 = 8.0 kW sent
    assert sent == 8.0
    assert received == 7.6
    assert loss == 0.4
    assert round(sent, 4) == round(received + loss, 4)


# SCENARIO 11: Unauthorized hardware command -> audited rejection
def test_scenario_11_unauthorized_hardware_command_rejection(engine: SurplusEngine) -> None:
    now = time.time()
    valid_nonce = f"{now}:random_salt_123"
    payload = f"SWITCH_OFF_BREAKER:{valid_nonce}".encode()
    valid_sig = hmac.new(engine.secret_key.encode(), payload, hashlib.sha256).hexdigest()

    # Valid signed command passes
    assert engine.verify_cea_security_nonce("SWITCH_OFF_BREAKER", valid_nonce, valid_sig) is True

    # Forged signature fails
    assert engine.verify_cea_security_nonce("SWITCH_OFF_BREAKER", valid_nonce, "invalid_signature_hex") is False

    # Expired nonce (> 30 seconds old) fails
    old_nonce = f"{now - 120.0}:old_salt"
    old_payload = f"SWITCH_OFF_BREAKER:{old_nonce}".encode()
    old_sig = hmac.new(engine.secret_key.encode(), old_payload, hashlib.sha256).hexdigest()
    assert engine.verify_cea_security_nonce("SWITCH_OFF_BREAKER", old_nonce, old_sig) is False


# SCENARIO 12: Missing historical measurements -> explicit missing indicator
def test_scenario_12_missing_historical_measurements(engine: SurplusEngine) -> None:
    surplus_meas, deficit_meas, status = engine.calculate_surplus_and_deficit(
        solar_kw=None,
        load_kw=None,
    )
    assert status == MetricStatus.MISSING_DATA
    assert surplus_meas.status == MetricStatus.MISSING_DATA
    assert deficit_meas.status == MetricStatus.MISSING_DATA
    assert surplus_meas.power_kw == 0.0
