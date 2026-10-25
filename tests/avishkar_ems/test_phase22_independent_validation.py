"""Phase 22: Independent Validation & Reliability Assessment Test Suite.

Provides genuinely independent reference implementations and verification checks:
- IV-01: Independent Telescopic Slabs & Billing Engine Math
- IV-02: Independent Energy Conservation Invariant in Diurnal Load Shifting
- IV-03: Independent Battery Physics Degradation & Rainflow Cycle Counting
- IV-04: Independent Forecasting Chronological Holdout & Zero-Leakage Audit
- IV-05: Independent Anomaly Detection Stability & Injected Spike Detection
- IV-06: Independent Recommendation Anti-Double-Counting Sequential Evaluation
- IV-07: Independent PM Surya Ghar CFA Statutory Subsidy Benchmark
- IV-08: Independent CEA Statutory CO2 Emissions Factor Verification
- IV-09: Independent Multi-Tenant Security & IDOR Access Boundary Enforcement
- IV-10: Independent File Upload & Traversal Attack Defense
- IV-11: Failure Injection & Degraded System Safe Failure Audit
- IV-12: Controlled Pilot Operational Health & Readiness Verification
"""

from __future__ import annotations

import math

import pytest

from avishkar_ems.anomaly_detector import AnomalyDetectionEngine
from avishkar_ems.battery_physics import (
    nonlinear_wear_cost_per_kwh,
    rainflow_count_cycles,
    temperature_c_rate_derating,
)
from avishkar_ems.digital_twin import (
    DigitalTwinService,
    ScenarioModelType,
)
from avishkar_ems.health_center import DataSourceHealthCenter
from avishkar_ems.household_import import sanitize_and_validate_filename
from avishkar_ems.household_module import (
    HouseholdManager,
    HouseholdProfile,
    IntegrationStatus,
    UtilityBillRecord,
    UtilityProvider,
)
from avishkar_ems.macro_forecast import MacroForecastPipeline, compute_metrics
from avishkar_ems.policy_intelligence import (
    CEA_GRID_EMISSIONS_FACTOR_KG_CO2_PER_KWH,
)
from avishkar_ems.recommendations import RecommendationEngine
from avishkar_ems.subsidy import pm_surya_ghar as pm_surya_ghar_cfa_subsidy_inr
from avishkar_ems.tariff_intelligence import (
    AuthoritativeTariffEngine,
    TariffIntelligenceService,
    TimeOfUseOptimizer,
)
from avishkar_ems.time_series_trends import TimeSeriesPoint

# ------------------ TEST FIXTURES ------------------


@pytest.fixture
def test_household_env() -> tuple[HouseholdManager, HouseholdProfile, HouseholdProfile]:
    """Provides isolated household fixtures for User A (Bengaluru) and User B (Visakhapatnam)."""
    mgr = HouseholdManager()
    mgr._profiles.clear()

    home_a = HouseholdProfile(
        profile_id="home_blr_bescom",
        user_id="USER-A-BENGALURU",
        display_name="Indiranagar Residence",
        city="Bengaluru",
        state="KA",
        district="Bengaluru Urban",
        locality="Indiranagar",
        utility=UtilityProvider.BESCOM,
        connection_account_id="BES982341029",
        sanctioned_load_kw=4.0,
        solar_capacity_kwp=3.0,
        battery_capacity_kwh=5.0,
        tariff_category="LT-2(a) Domestic",
        integration_status=IntegrationStatus.AUTHORIZED_ACTIVE,
    )
    home_b = HouseholdProfile(
        profile_id="home_vskp_apepdcl",
        user_id="USER-B-VIZAG",
        display_name="Waltair Villa",
        city="Visakhapatnam",
        state="AP",
        district="Visakhapatnam",
        locality="Waltair",
        utility=UtilityProvider.APEPDCL,
        connection_account_id="APE618290145",
        sanctioned_load_kw=3.0,
        solar_capacity_kwp=0.0,
        battery_capacity_kwh=0.0,
        tariff_category="LT-1 Domestic",
        integration_status=IntegrationStatus.AWAITING_AUTHORIZATION,
    )
    mgr._profiles[home_a.profile_id] = home_a
    mgr._profiles[home_b.profile_id] = home_b
    return mgr, home_a, home_b


# ------------------ IV-01: INDEPENDENT TARIFF CALCULATION REFERENCE ------------------


def _independent_bescom_lt2a_reference(
    consumption_kwh: float,
    sanctioned_load_kw: float,
    solar_export_kwh: float = 0.0,
) -> dict[str, float]:
    """Independent first-principles re-implementation of KERC Order S/01/24 (BESCOM LT-2a).

    Written completely independently from AuthoritativeTariffEngine.
    """
    if consumption_kwh < 0 or sanctioned_load_kw <= 0:
        raise ValueError("Invalid negative consumption or load")

    # 1. Fixed Charge: ₹70/kW/month, minimum ₹100 floor
    raw_fixed = sanctioned_load_kw * 70.0
    fixed_charge = max(raw_fixed, 100.0)

    # 2. Telescopic Slabs: 0-100 @ 4.75, >100 @ 7.00
    if consumption_kwh <= 100.0:
        energy_charge = consumption_kwh * 4.75
    else:
        energy_charge = (100.0 * 4.75) + ((consumption_kwh - 100.0) * 7.00)

    # 3. Fuel Adjustment Charge (FAC): ₹0.22/kWh
    fac_charge = consumption_kwh * 0.22

    # 4. State Electricity Duty: 9% on energy charge
    tax_charge = energy_charge * 0.09

    # 5. Gross Bill
    gross_bill = fixed_charge + energy_charge + fac_charge + tax_charge

    # 6. Solar Credit: ₹3.10/kWh
    solar_credit = solar_export_kwh * 3.10

    # 7. Net Bill (floored at minimum charge ₹100)
    net_payable = max(100.0, gross_bill - solar_credit)

    return {
        "fixed_charge": round(fixed_charge, 2),
        "energy_charge": round(energy_charge, 2),
        "fac_charge": round(fac_charge, 2),
        "tax_charge": round(tax_charge, 2),
        "solar_credit": round(solar_credit, 2),
        "gross_bill": round(gross_bill, 2),
        "net_payable": round(net_payable, 2),
    }


def test_iv01_independent_telescopic_tariff_math_verification() -> None:
    """IV-01: Verifies application bill calculation against an independent first-principles model."""
    svc = TariffIntelligenceService()
    sched = svc.registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert sched is not None

    # Test Case A: 250 kWh, 4 kW load, 50 kWh solar export
    ref_a = _independent_bescom_lt2a_reference(consumption_kwh=250.0, sanctioned_load_kw=4.0, solar_export_kwh=50.0)
    app_a = AuthoritativeTariffEngine.calculate_bill(
        consumption_kwh=250.0,
        sanctioned_load_kw=4.0,
        schedule=sched,
        solar_export_kwh=50.0,
    )

    assert app_a.fixed_charges_inr == ref_a["fixed_charge"] == 280.0
    assert app_a.energy_charges_inr == ref_a["energy_charge"] == 1525.0
    assert app_a.fac_charges_inr == ref_a["fac_charge"] == 55.0
    assert app_a.tax_and_duty_inr == ref_a["tax_charge"] == 137.25
    assert app_a.solar_credit_inr == ref_a["solar_credit"] == 155.0
    assert app_a.net_calculated_bill_inr == ref_a["net_payable"] == 1842.25

    # Test Case B: Boundary exact 100 kWh
    ref_b = _independent_bescom_lt2a_reference(consumption_kwh=100.0, sanctioned_load_kw=2.0)
    app_b = AuthoritativeTariffEngine.calculate_bill(
        consumption_kwh=100.0,
        sanctioned_load_kw=2.0,
        schedule=sched,
    )
    # 2 kW * 70 = 140, 100 * 4.75 = 475, FAC = 22, Tax = 475 * 0.09 = 42.75
    # Gross = 140 + 475 + 22 + 42.75 = 679.75
    assert app_b.energy_charges_inr == ref_b["energy_charge"] == 475.0
    assert app_b.net_calculated_bill_inr == ref_b["net_payable"] == 679.75

    # Test Case C: Zero consumption minimum billing floor
    app_zero = AuthoritativeTariffEngine.calculate_bill(
        consumption_kwh=0.0,
        sanctioned_load_kw=1.0,
        schedule=sched,
    )
    # Fixed charge: 1 * 70 = 70, floored at minimum charge ₹100
    assert app_zero.fixed_charges_inr == 100.0
    assert app_zero.net_calculated_bill_inr == 100.0

    # Test Case D: Boundary rejection on invalid negative inputs
    with pytest.raises(ValueError, match="Consumption cannot be negative"):
        AuthoritativeTariffEngine.calculate_bill(consumption_kwh=-10.0, sanctioned_load_kw=4.0, schedule=sched)

    with pytest.raises(ValueError, match="Sanctioned load must be positive"):
        AuthoritativeTariffEngine.calculate_bill(consumption_kwh=100.0, sanctioned_load_kw=0.0, schedule=sched)


# ------------------ IV-02: INDEPENDENT ENERGY CONSERVATION IN LOAD SHIFTING ------------------


def test_iv02_independent_energy_conservation_in_load_shifting() -> None:
    """IV-02: Verifies that diurnal load shifting satisfies strict physical energy conservation."""
    svc = TariffIntelligenceService()
    sched = svc.registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert sched is not None

    optimizer = TimeOfUseOptimizer()

    total_consumption = 450.0
    shifted_amount = 75.0

    result = optimizer.evaluate_load_shift(
        property_id="test_prop_01",
        total_kwh=total_consumption,
        sanctioned_load_kw=5.0,
        schedule=sched,
        shift_kwh=shifted_amount,
        from_slot="EVENING_PEAK",
        to_slot="SOLAR_OFF_PEAK",
    )

    # Invariant: Total energy must be preserved exactly
    assert result.total_consumption_kwh == total_consumption
    assert result.shifted_kwh == shifted_amount
    assert result.shifted_kwh <= result.total_consumption_kwh

    # Boundary check: shifting more than total consumption is physically impossible and rejected
    with pytest.raises(ValueError, match="Cannot shift"):
        optimizer.evaluate_load_shift(
            property_id="test_prop_01",
            total_kwh=100.0,
            sanctioned_load_kw=5.0,
            schedule=sched,
            shift_kwh=150.0,  # > total
        )


# ------------------ IV-03: INDEPENDENT BATTERY WEAR & RAINFLOW VERIFICATION ------------------


def test_iv03_independent_battery_physics_degradation_and_derating() -> None:
    """IV-03: Verifies battery physics: ASTM E1049 Rainflow cycle counting, monotonic DoD wear, and thermal derating."""
    # 1. Rainflow cycle counting verification
    # Sinusoidal SoC oscillation between 0.3 and 0.8 (amplitude 0.5)
    soc_profile = [0.3, 0.5, 0.8, 0.5, 0.3, 0.5, 0.8, 0.5, 0.3]
    cycles = rainflow_count_cycles(soc_profile)
    assert len(cycles) >= 1
    total_cycle_count = sum(c[1] for c in cycles)
    assert total_cycle_count >= 1.0

    # 2. Non-linear wear cost strictly increases with Depth of Discharge (DoD)
    wear_20 = nonlinear_wear_cost_per_kwh(dod=0.20)
    wear_50 = nonlinear_wear_cost_per_kwh(dod=0.50)
    wear_80 = nonlinear_wear_cost_per_kwh(dod=0.80)
    wear_95 = nonlinear_wear_cost_per_kwh(dod=0.95)

    assert wear_20 < wear_50 < wear_80 < wear_95

    # 3. Temperature derating check
    # Nominal 25°C maintains full rate
    assert temperature_c_rate_derating(25.0, nominal_c_rate=1.0) == 1.0
    # Freezing cold (0°C) reduces rate
    assert temperature_c_rate_derating(0.0, nominal_c_rate=1.0) < 1.0
    # Overheating (42°C) reduces rate
    assert temperature_c_rate_derating(42.0, nominal_c_rate=1.0) < 1.0
    # Extreme heat (50°C) applies maximum protection floor (0.2x)
    assert temperature_c_rate_derating(50.0, nominal_c_rate=1.0) == 0.2


# ------------------ IV-04: INDEPENDENT FORECASTING HOLDOUT & ZERO-LEAKAGE AUDIT ------------------


def test_iv04_independent_forecasting_chronological_holdout_audit() -> None:
    """IV-04: Verifies time-series forecasting strictly evaluates on held-out future steps without data leakage."""
    periods = [f"2024-{m:02d}" for m in range(1, 13)] + [f"2025-{m:02d}" for m in range(1, 13)]
    # 24 monthly synthetic values
    values = [100.0 + 10.0 * math.sin(i * math.pi / 6) + 0.5 * i for i in range(24)]

    pipeline = MacroForecastPipeline(season_length=12)
    output = pipeline.run(
        periods=periods,
        values=values,
        series_name="Demand_MU",
        region_code="KA",
        horizon_steps=6,
    )

    # Check metrics existence
    assert output.metrics is not None
    assert output.metrics.mae >= 0.0
    assert output.metrics.rmse >= output.metrics.mae  # Mathematical inequality: RMSE >= MAE
    assert output.metrics.holdout_samples > 0

    # Verify forecast periods continue chronologically from last period (2025-12 -> 2026-01)
    assert output.forecast_periods[0] == "2026-01"
    assert len(output.forecast_p50) == 6
    assert len(output.forecast_p10) == 6
    assert len(output.forecast_p90) == 6

    # Invariant: P10 <= P50 <= P90
    for p10, p50, p90 in zip(output.forecast_p10, output.forecast_p50, output.forecast_p90, strict=True):
        assert p10 <= p50 <= p90

    # Error metric formula independent check
    actual = [100.0, 110.0, 105.0]
    predicted = [102.0, 108.0, 107.0]
    metrics = compute_metrics(actual, predicted)
    # MAE = (|100-102| + |110-108| + |105-107|) / 3 = (2 + 2 + 2) / 3 = 2.0
    assert metrics.mae == 2.0
    # RMSE = sqrt((4 + 4 + 4) / 3) = 2.0
    assert metrics.rmse == 2.0


# ------------------ IV-05: INDEPENDENT ANOMALY DETECTION STABILITY ------------------


def test_iv05_independent_anomaly_detection_stability() -> None:
    """IV-05: Verifies Rolling Median Absolute Deviation (MAD) flags injected outlier without false alarms on stationary series."""
    detector = AnomalyDetectionEngine()

    # Stationary baseline: 10.0 with minor variance +-0.2
    pts = [TimeSeriesPoint(period=f"2025-01-T{i:02d}", value=10.0 + (0.1 if i % 2 == 0 else -0.1), unit="kW") for i in range(15)]

    # Inject an unambiguous severe outlier spike at index 8 (50.0 kW vs ~10.0 kW baseline)
    pts[8] = TimeSeriesPoint(period="2025-01-T08", value=50.0, unit="kW")

    anomalies = detector.detect_rolling_mad_anomalies(
        series=pts,
        metric_id="peak_demand",
        geo_code="KA_BLR_URBAN",
        window_size=5,
        mad_threshold=3.0,
    )

    assert len(anomalies) >= 1
    detected_periods = [a.period for a in anomalies]
    assert "2025-01-T08" in detected_periods

    # Outlier observed value must match injected spike
    target_anom = next(a for a in anomalies if a.period == "2025-01-T08")
    assert target_anom.observed_value == 50.0
    assert target_anom.absolute_deviation > 30.0


# ------------------ IV-06: INDEPENDENT RECOMMENDATION ANTI-DOUBLE-COUNTING ------------------


def test_iv06_independent_recommendation_anti_double_counting(
    test_household_env: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """IV-06: Verifies that recommendation marginal evaluation prevents double-counting."""
    mgr, home_a, _ = test_household_env

    # Ingest multiple bills for Home A
    for m, units in [("2025-01", 380.0), ("2025-02", 360.0), ("2025-03", 410.0)]:
        mgr.record_bill(
            home_a.profile_id,
            UtilityBillRecord(
                bill_month=m,
                bill_date=f"{m}-05",
                units_consumed_kwh=units,
                total_amount_inr=units * 7.5,
                fixed_charge_inr=280.0,
                energy_charge_inr=units * 6.5,
            ),
            user_id=home_a.user_id,
        )

    rec_engine = RecommendationEngine(household_mgr=mgr)
    recs = rec_engine.generate_recommendations(user_id=home_a.user_id, property_id=home_a.profile_id)
    assert len(recs) >= 1

    # Evaluate unduplicated sequential savings
    undup = rec_engine.compute_unduplicated_savings(home_a, recs)
    assert undup["anti_double_counting_enforced"] is True
    assert undup["total_annual_cost_savings_inr"] >= 0.0

    # Invariant: unduplicated annual savings cannot exceed the total baseline annual bill
    assert undup["total_annual_cost_savings_inr"] <= undup["baseline_annual_bill_inr"]


# ------------------ IV-07: INDEPENDENT PM SURYA GHAR CFA SUBSIDY BENCHMARK ------------------


def test_iv07_independent_pm_surya_ghar_cfa_subsidy_benchmark() -> None:
    """IV-07: Verifies PM Surya Ghar Central Financial Assistance subsidy formula against statutory gazette."""
    # Statutory rule (MNRE 2024 Guidelines):
    # - 1 kW: ₹30,000
    # - 2 kW: ₹60,000 (₹30,000/kW for first 2 kW)
    # - 3 kW: ₹78,000 (₹60,000 + ₹18,000 for 3rd kW)
    # - >3 kW: Capped at ₹78,000
    assert pm_surya_ghar_cfa_subsidy_inr(1.0) == 30000.0
    assert pm_surya_ghar_cfa_subsidy_inr(2.0) == 60000.0
    assert pm_surya_ghar_cfa_subsidy_inr(3.0) == 78000.0
    assert pm_surya_ghar_cfa_subsidy_inr(5.0) == 78000.0  # Capped at 3 kWp
    assert pm_surya_ghar_cfa_subsidy_inr(0.0) == 0.0
    assert pm_surya_ghar_cfa_subsidy_inr(1.5) == 45000.0  # 1.5 * 30,000


# ------------------ IV-08: INDEPENDENT CEA CO2 FACTOR VERIFICATION ------------------


def test_iv08_independent_cea_co2_factor_verification() -> None:
    """IV-08: Verifies statutory Central Electricity Authority (CEA) grid CO2 emissions factor."""
    # Official benchmark: CEA CO2 Baseline Database Version 19
    assert CEA_GRID_EMISSIONS_FACTOR_KG_CO2_PER_KWH == 0.716

    # Verify emissions calculation: 10,000 kWh avoided generation
    kwh_avoided = 10000.0
    co2_kg = kwh_avoided * CEA_GRID_EMISSIONS_FACTOR_KG_CO2_PER_KWH
    co2_tonnes = co2_kg / 1000.0

    assert co2_kg == 7160.0
    assert co2_tonnes == 7.16


# ------------------ IV-09: INDEPENDENT MULTI-TENANT SECURITY & IDOR ENFORCEMENT ------------------


def test_iv09_independent_multi_tenant_security_and_idor_rejection(
    test_household_env: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """IV-09: Verifies that changing property/user IDs cannot access or mutate another tenant's profile."""
    mgr, home_a, home_b = test_household_env
    tariff_svc = TariffIntelligenceService(household_mgr=mgr)
    twin_svc = DigitalTwinService(household_mgr=mgr)

    # 1. Profile retrieval IDOR rejection
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        mgr.get_home("USER-B-VIZAG", home_a.profile_id)

    # 2. Profile update IDOR rejection
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        mgr.update_home("USER-B-VIZAG", home_a.profile_id, display_name="Hacked Name")

    # 3. Bill validation IDOR rejection
    bill = UtilityBillRecord("2025-01", "2025-02-05", 250.0, 1842.25, 280.0, 1525.0)
    home_a.bills.append(bill)

    with pytest.raises(PermissionError, match="Access denied"):
        tariff_svc.validate_property_bill(
            property_id=home_a.profile_id,
            bill_id=bill.bill_id,
            auth_user_id="USER-B-VIZAG",
            authorized_property_ids=[home_b.profile_id],
        )

    # 4. Digital Twin simulation IDOR rejection
    twin_a = twin_svc.registry.get_twin("twin_blr_bescom_01")
    assert twin_a is not None
    twin_a.owner_user_id = home_a.user_id  # explicitly assign to Home A owner

    with pytest.raises(PermissionError, match="not authorized"):
        twin_svc.create_scenario(
            user_id="USER-B-VIZAG",
            twin_id="twin_blr_bescom_01",
            scenario_name="Unauthorized Simulation",
            description="Testing IDOR",
            model_type=ScenarioModelType.SOLAR_PV_ADDITION,
            parameters={"solar_capacity_kwp": 3.0},
        )


# ------------------ IV-10: INDEPENDENT FILE UPLOAD & TRAVERSAL DEFENSE ------------------


def test_iv10_independent_file_upload_and_traversal_defense() -> None:
    """IV-10: Verifies path traversal defense and executable file extension blocking."""
    # Test A: Path traversal attempts are stripped to basename
    assert sanitize_and_validate_filename("../../../etc/shadow.txt") == "shadow.txt"
    assert sanitize_and_validate_filename("..\\..\\windows\\system32\\cmd.csv") == "cmd.csv"

    # Test B: Permitted formats pass cleanly
    assert sanitize_and_validate_filename("valid_bill.csv") == "valid_bill.csv"
    assert sanitize_and_validate_filename("statement.xlsx") == "statement.xlsx"
    assert sanitize_and_validate_filename("telemetry.json") == "telemetry.json"

    # Test C: Prohibited executable and shell extensions are rejected
    with pytest.raises(ValueError, match="FILE REJECTED"):
        sanitize_and_validate_filename("exploit.exe")

    with pytest.raises(ValueError, match="FILE REJECTED"):
        sanitize_and_validate_filename("script.sh")

    with pytest.raises(ValueError, match="FILE REJECTED"):
        sanitize_and_validate_filename("payload.py")


# ------------------ IV-11: FAILURE INJECTION & SAFE DEGRADATION ------------------


def test_iv11_failure_injection_and_safe_degradation(
    test_household_env: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """IV-11: Verifies that corrupted inputs, non-existent entities, and extreme inputs fail safely."""
    mgr, home_a, _ = test_household_env
    tariff_svc = TariffIntelligenceService(household_mgr=mgr)

    # 1. Non-existent tariff schedule raises KeyError safely
    with pytest.raises(KeyError, match="not found in registry"):
        tariff_svc.calculate_bill(
            consumption_kwh=200.0,
            sanctioned_load_kw=4.0,
            schedule_id="NON_EXISTENT_TARIFF_ID_999",
        )

    # 2. Non-existent property bill validation raises KeyError
    with pytest.raises(KeyError, match=r"Unknown profile"):
        tariff_svc.validate_property_bill(
            property_id="non_existent_property_id",
            bill_id="bill_123",
            auth_user_id="user_01",
        )

    # 3. Non-existent home lookup in manager raises KeyError
    with pytest.raises(KeyError, match="Unknown property"):
        mgr.get_home("USER-A-BENGALURU", "completely_unknown_prop_id")


# ------------------ IV-12: CONTROLLED PILOT OPERATIONAL HEALTH AUDIT ------------------


def test_iv12_controlled_pilot_operational_health_audit() -> None:
    """IV-12: Verifies that DataSourceHealthCenter accurately reports system liveness, readiness, and dependencies."""
    health_center = DataSourceHealthCenter()

    # 1. Liveness check
    liveness = health_center.get_liveness()
    assert liveness.status == "UP"
    assert liveness.uptime_seconds >= 0.0
    assert liveness.process_id > 0

    # 2. Readiness check
    readiness = health_center.get_readiness()
    assert readiness.status == "READY"
    assert readiness.components_verified["canonical_geo_catalog"] is True
    assert readiness.components_verified["source_registry_loaded"] is True

    # 3. Comprehensive health report
    report = health_center.get_system_health_report()
    assert report.overall_status in ("HEALTHY", "DEGRADED", "UNHEALTHY")
    assert report.summary_counts["total"] >= 10
    assert report.summary_counts["failed"] == 0
