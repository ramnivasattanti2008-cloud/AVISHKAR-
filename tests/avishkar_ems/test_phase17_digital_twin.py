"""Automated Unit, Security, and End-to-End Tests for Energy Digital Twin & What-If Simulation Engine (Phase 17).

Verifies:
1. TC-1701: Digital Twin creation, metadata validation, and baseline resolution.
2. TC-1702: Deterministic reproduction — identical inputs produce byte-identical simulation outcomes.
3. TC-1703: Unit and range validation (rejection of negative capacities, >100% reductions, malformed units).
4. TC-1704: Consumption reduction simulation model (flat kWh & percentage curtailment) with tariff recalculation.
5. TC-1705: Appliance scheduling / duration change simulation (AC runtime change, duty cycle, kW vs kWh).
6. TC-1706: Solar PV addition simulation with physical PR derating, self-consumption, grid exports, and net-metering credits.
7. TC-1707: Combined multi-intervention scenario (Solar PV + consumption curtailment + peak shifting).
8. TC-1708: Tariff comparison scenario (BESCOM LT-2 vs APEPDCL LT-1 or altered fixed charges/sanctioned load).
9. TC-1709: Scenario comparison engine (multi-scenario ranking, delta calculations, zero baseline handling).
10. TC-1710: Sensitivity sweep engine (deterministic parameter sweep, resource bounding <= 50 points).
11. TC-1711: Server-side authorization & security (cross-user scenario isolation, forged property ID rejection, code injection safety).
12. TC-1712: AI Copilot integration (run_what_if_simulation tool execution through CopilotToolRegistry and evidence grounding).
"""

from __future__ import annotations

import pytest

from avishkar_ems.ai_copilot import (
    AICopilotService,
    CopilotIntent,
    GroundingStatus,
    NumericalGroundingGuard,
    ToolExecutionStatus,
)
from avishkar_ems.citizen_portal import CitizenPortalService
from avishkar_ems.digital_twin import (
    CalibrationStatus,
    DigitalTwinEntity,
    DigitalTwinRegistry,
    DigitalTwinService,
    EnergyScenario,
    ScenarioModelType,
    SimulationEngine,
    TwinScope,
    ValidationStatus,
)
from avishkar_ems.household_module import HouseholdManager
from avishkar_ems.recommendations import RecommendationEngine


@pytest.fixture
def twin_fixture():
    household_mgr = HouseholdManager()
    registry = DigitalTwinRegistry(household_mgr=household_mgr)
    service = DigitalTwinService(household_mgr=household_mgr, registry=registry)
    return service, registry, household_mgr


@pytest.fixture
def copilot_fixture(twin_fixture):
    service, _, household_mgr = twin_fixture
    rec_engine = RecommendationEngine(household_mgr=household_mgr)
    citizen_service = CitizenPortalService()
    copilot = AICopilotService(
        household_mgr=household_mgr,
        rec_engine=rec_engine,
        citizen_service=citizen_service,
        twin_service=service,
    )
    return copilot, service, household_mgr


# -----------------------------------------------------------------------------
# TC-1701: Digital Twin Creation & Metadata Validation
# -----------------------------------------------------------------------------


def test_tc1701_digital_twin_creation_and_metadata(twin_fixture):
    """TC-1701: Verify Digital Twin metadata, baseline resolution, and honest calibration labeling."""
    service, registry, _ = twin_fixture

    # 1. Verify Home A canonical twin
    twin_a = registry.get_twin("twin_blr_bescom_01")
    assert twin_a is not None
    assert twin_a.scope == TwinScope.HOUSEHOLD_PROSUMER
    assert twin_a.city == "Bengaluru"
    assert twin_a.state == "KA"
    assert twin_a.utility == "BESCOM"
    assert twin_a.baseline_consumption_kwh == 460.0
    assert twin_a.baseline_bill_inr == 3540.0
    assert twin_a.sanctioned_load_kw == 5.0
    assert twin_a.calibration_status == CalibrationStatus.CALIBRATED_HISTORICAL
    assert twin_a.validation_status == ValidationStatus.VALIDATED_METER_DATA
    assert len(twin_a.known_limitations) >= 3

    # 2. Verify Home B canonical twin
    twin_b = registry.get_twin("twin_vskp_apepdcl_02")
    assert twin_b is not None
    assert twin_b.city == "Visakhapatnam"
    assert twin_b.state == "AP"
    assert twin_b.utility == "APEPDCL"
    assert twin_b.baseline_consumption_kwh == 390.0
    assert twin_b.baseline_bill_inr == 2890.0

    # 3. Verify Macro State Regional Twin
    twin_macro = registry.get_twin("twin_ka_macro_grid")
    assert twin_macro is not None
    assert twin_macro.scope == TwinScope.REGIONAL_ENERGY_BALANCE
    assert twin_macro.owner_user_id == "SYSTEM_PUBLIC"
    assert "NOT an AC power-flow" in twin_macro.known_limitations[0]


# -----------------------------------------------------------------------------
# TC-1702: Deterministic Reproduction
# -----------------------------------------------------------------------------


def test_tc1702_deterministic_reproducibility(twin_fixture):
    """TC-1702: Verify that identical scenario parameters produce byte-identical results."""
    service, registry, _ = twin_fixture
    twin = registry.get_twin("twin_blr_bescom_01")

    scen1 = EnergyScenario(
        scenario_id="scen_det_1",
        scenario_name="3 kWp Solar Test 1",
        description="Deterministic reproduction verification",
        user_id="user_default",
        twin_id=twin.twin_id,
        entity_reference=twin.entity_reference,
        model_type=ScenarioModelType.SOLAR_PV_ADDITION,
        parameters={"solar_capacity_kwp": 3.0, "performance_ratio": 0.75, "daily_insolation_kwh_m2": 4.8},
        parameter_units={"solar_capacity_kwp": "kWp"},
        assumptions=["Standard 75% PR."],
    )

    scen2 = EnergyScenario(
        scenario_id="scen_det_2",
        scenario_name="3 kWp Solar Test 2",
        description="Deterministic reproduction verification",
        user_id="user_default",
        twin_id=twin.twin_id,
        entity_reference=twin.entity_reference,
        model_type=ScenarioModelType.SOLAR_PV_ADDITION,
        parameters={"solar_capacity_kwp": 3.0, "performance_ratio": 0.75, "daily_insolation_kwh_m2": 4.8},
        parameter_units={"solar_capacity_kwp": "kWp"},
        assumptions=["Standard 75% PR."],
    )

    res1 = SimulationEngine.simulate(scen1, twin)
    res2 = SimulationEngine.simulate(scen2, twin)

    # Assert exact byte and float equivalence
    assert res1.simulated_consumption_kwh == res2.simulated_consumption_kwh
    assert res1.solar_generation_kwh == res2.solar_generation_kwh
    assert res1.grid_import_kwh == res2.grid_import_kwh
    assert res1.grid_export_kwh == res2.grid_export_kwh
    assert res1.simulated_bill_inr == res2.simulated_bill_inr
    assert res1.net_cost_savings_inr == res2.net_cost_savings_inr
    assert res1.co2_avoided_kg == res2.co2_avoided_kg


# -----------------------------------------------------------------------------
# TC-1703: Unit and Range Validation
# -----------------------------------------------------------------------------


def test_tc1703_unit_and_range_validation():
    """TC-1703: Verify rejection of invalid parameters, negative values, and out-of-range units."""
    # 1. Negative solar capacity rejected
    with pytest.raises(ValueError, match="must be between 0.0 and 100.0 kWp"):
        SimulationEngine.validate_parameters(
            ScenarioModelType.SOLAR_PV_ADDITION,
            {"solar_capacity_kwp": -5.0},
        )

    # 2. Impossible performance ratio rejected
    with pytest.raises(ValueError, match="performance ratio must be in range"):
        SimulationEngine.validate_parameters(
            ScenarioModelType.SOLAR_PV_ADDITION,
            {"solar_capacity_kwp": 4.0, "performance_ratio": 1.50},
        )

    # 3. Reduction percentage exceeding 100% rejected
    with pytest.raises(ValueError, match="must be between 0.0% and 100.0%"):
        SimulationEngine.validate_parameters(
            ScenarioModelType.CONSUMPTION_REDUCTION,
            {"reduction_pct": 125.0},
        )

    # 4. Negative reduction rejected
    with pytest.raises(ValueError, match="must be between 0.0% and 100.0%"):
        SimulationEngine.validate_parameters(
            ScenarioModelType.CONSUMPTION_REDUCTION,
            {"reduction_pct": -10.0},
        )

    # 5. Impossible operating hours (>24h) rejected
    with pytest.raises(ValueError, match="Daily operating hours must be between 0 and 24"):
        SimulationEngine.validate_parameters(
            ScenarioModelType.APPLIANCE_SCHEDULE_SHIFT,
            {
                "appliance_power_w": 1500.0,
                "original_daily_hours": 8.0,
                "simulated_daily_hours": 28.0,
            },
        )


# -----------------------------------------------------------------------------
# TC-1704: Consumption Reduction Simulation
# -----------------------------------------------------------------------------


def test_tc1704_consumption_reduction_simulation(twin_fixture):
    """TC-1704: Verify flat kWh and percentage curtailment models and authoritative bill recalculation."""
    service, registry, _ = twin_fixture
    twin = registry.get_twin("twin_blr_bescom_01")

    # 20% consumption reduction
    scen = service.create_scenario(
        user_id="user_default",
        twin_id=twin.twin_id,
        scenario_name="20% Efficiency Setback",
        description="Comprehensive household curtailment",
        model_type=ScenarioModelType.CONSUMPTION_REDUCTION,
        parameters={"reduction_pct": 20.0},
    )
    res = service.execute_scenario(scen, "user_default")

    # Baseline 460 kWh - 20% (92 kWh) = 368 kWh
    assert res.baseline_consumption_kwh == 460.0
    assert res.simulated_consumption_kwh == 368.0
    assert res.consumption_delta_kwh == -92.0
    assert res.consumption_delta_pct == -20.0
    assert res.grid_import_kwh == 368.0
    assert res.grid_export_kwh == 0.0
    assert res.solar_generation_kwh == 0.0

    # Bill under BESCOM LT-2: 368 kWh bill must be less than baseline bill (₹3540)
    assert res.simulated_bill_inr < res.baseline_bill_inr
    assert res.net_cost_savings_inr > 0.0
    assert res.co2_avoided_kg == pytest.approx(92.0 * 0.716, rel=1e-2)


# -----------------------------------------------------------------------------
# TC-1705: Appliance Scheduling / Runtime Shift
# -----------------------------------------------------------------------------


def test_tc1705_appliance_scheduling_simulation(twin_fixture):
    """TC-1705: Verify appliance duration change (AC runtime curtailment) and duty cycle modeling."""
    service, registry, _ = twin_fixture
    twin = registry.get_twin("twin_blr_bescom_01")

    # 1.5 Ton AC (1500 W, duty cycle 0.70) shifted from 8 hours/day to 5 hours/day
    scen = service.create_scenario(
        user_id="user_default",
        twin_id=twin.twin_id,
        scenario_name="AC Runtime Curtailment",
        description="Reducing AC runtime from 8h to 5h daily",
        model_type=ScenarioModelType.APPLIANCE_SCHEDULE_SHIFT,
        parameters={
            "appliance_power_w": 1500.0,
            "original_daily_hours": 8.0,
            "simulated_daily_hours": 5.0,
            "duty_cycle": 0.70,
        },
    )
    res = service.execute_scenario(scen, "user_default")

    # Delta daily = 1.5 kW * (5 - 8) * 0.70 = -3.15 kWh/day * 30 days = -94.5 kWh/month
    # Simulated = 460.0 - 94.5 = 365.5 kWh
    assert res.consumption_delta_kwh == pytest.approx(-94.5, rel=1e-2)
    assert res.simulated_consumption_kwh == pytest.approx(365.5, rel=1e-2)
    assert res.net_cost_savings_inr > 0.0


# -----------------------------------------------------------------------------
# TC-1706: Solar PV Addition Simulation
# -----------------------------------------------------------------------------


def test_tc1706_solar_pv_addition_simulation(twin_fixture):
    """TC-1706: Verify rooftop solar PV sizing, insolation math, self-consumption vs export, and net billing."""
    service, registry, _ = twin_fixture
    twin = registry.get_twin("twin_blr_bescom_01")

    # 4 kWp Solar PV addition in Bengaluru
    # Insolation: 4.8 kWh/m2/day, PR: 0.75, 30 days -> 4.0 * 4.8 * 30 * 0.75 = 432.0 kWh/month
    # Self-consumption 65% = 280.8 kWh, Grid export = 151.2 kWh
    # Grid import = 460 - 280.8 = 179.2 kWh
    scen = service.create_scenario(
        user_id="user_default",
        twin_id=twin.twin_id,
        scenario_name="4 kWp Rooftop Solar Installation",
        description="Grid-tied solar with net metering",
        model_type=ScenarioModelType.SOLAR_PV_ADDITION,
        parameters={
            "solar_capacity_kwp": 4.0,
            "daily_insolation_kwh_m2": 4.8,
            "performance_ratio": 0.75,
            "self_consumption_pct": 65.0,
        },
    )
    res = service.execute_scenario(scen, "user_default")

    assert res.solar_generation_kwh == pytest.approx(432.0, rel=1e-2)
    assert res.self_consumed_solar_kwh == pytest.approx(280.8, rel=1e-2)
    assert res.grid_export_kwh == pytest.approx(151.2, rel=1e-2)
    assert res.grid_import_kwh == pytest.approx(179.2, rel=1e-2)
    assert res.renewable_share_pct == pytest.approx((280.8 / 460.0) * 100.0, rel=1e-1)
    assert res.net_cost_savings_inr > 1500.0
    assert res.co2_avoided_kg > 200.0


# -----------------------------------------------------------------------------
# TC-1707: Combined Multi-Intervention Scenario
# -----------------------------------------------------------------------------


def test_tc1707_combined_hybrid_scenario(twin_fixture):
    """TC-1707: Verify multi-intervention scenario combining solar PV with efficiency curtailment."""
    service, registry, _ = twin_fixture
    twin = registry.get_twin("twin_blr_bescom_01")

    scen = service.create_scenario(
        user_id="user_default",
        twin_id=twin.twin_id,
        scenario_name="Hybrid Solar & Efficiency",
        description="3 kWp Solar + 10% Curtailment",
        model_type=ScenarioModelType.COMBINED_HYBRID,
        parameters={
            "reduction_pct": 10.0,
            "solar_capacity_kwp": 3.0,
            "daily_insolation_kwh_m2": 4.8,
            "performance_ratio": 0.75,
            "self_consumption_pct": 70.0,
        },
    )
    res = service.execute_scenario(scen, "user_default")

    # Baseline 460 - 10% = 414 kWh gross consumption
    assert res.simulated_consumption_kwh == 414.0
    assert res.solar_generation_kwh == pytest.approx(324.0, rel=1e-2)
    assert res.grid_import_kwh < 250.0
    assert res.net_cost_savings_inr > 1800.0


# -----------------------------------------------------------------------------
# TC-1708: Tariff Comparison Scenario
# -----------------------------------------------------------------------------


def test_tc1708_tariff_comparison_scenario(twin_fixture):
    """TC-1708: Verify tariff migration scenario and sanctioned load adjustments."""
    service, registry, _ = twin_fixture
    twin = registry.get_twin("twin_blr_bescom_01")

    scen = service.create_scenario(
        user_id="user_default",
        twin_id=twin.twin_id,
        scenario_name="Tariff Comparison: APEPDCL Schedule",
        description="Evaluate bill if billed under APEPDCL LT-1 telescopic schedule",
        model_type=ScenarioModelType.TARIFF_SWITCH,
        parameters={
            "target_tariff_schedule_id": "AP_APEPDCL_LT1_2024",
            "sanctioned_load_kw": 4.0,
        },
    )
    res = service.execute_scenario(scen, "user_default")

    assert res.simulated_consumption_kwh == 460.0
    assert res.simulated_bill_inr > 0.0
    assert "Tariff Switch: Migrated from KA_BESCOM_LT2A_2024 to AP_APEPDCL_LT1_2024" in res.calculation_lineage[2]


# -----------------------------------------------------------------------------
# TC-1709: Scenario Comparison Engine
# -----------------------------------------------------------------------------


def test_tc1709_scenario_comparison_engine(twin_fixture):
    """TC-1709: Verify multi-scenario comparison, ranking, and zero-baseline resilience."""
    service, registry, _ = twin_fixture
    twin = registry.get_twin("twin_blr_bescom_01")

    # Create and execute 2 scenarios
    s1 = service.create_scenario(
        user_id="user_default",
        twin_id=twin.twin_id,
        scenario_name="Option A: 2 kWp Solar",
        description="Option A",
        model_type=ScenarioModelType.SOLAR_PV_ADDITION,
        parameters={"solar_capacity_kwp": 2.0},
    )
    service.execute_scenario(s1, "user_default")

    s2 = service.create_scenario(
        user_id="user_default",
        twin_id=twin.twin_id,
        scenario_name="Option B: 5 kWp Solar",
        description="Option B",
        model_type=ScenarioModelType.SOLAR_PV_ADDITION,
        parameters={"solar_capacity_kwp": 5.0},
    )
    service.execute_scenario(s2, "user_default")

    report = service.compare_twin_scenarios(twin.twin_id, [s1.scenario_id, s2.scenario_id], "user_default")

    assert report.baseline_twin_id == twin.twin_id
    assert len(report.scenarios) == 2
    assert report.best_scenario_by_savings == "Option B: 5 kWp Solar"
    assert report.best_scenario_by_co2 == "Option B: 5 kWp Solar"

    # Verify zero-baseline safety
    zero_twin = DigitalTwinEntity(
        twin_id="twin_zero_test",
        name="Zero Baseline Twin",
        scope=TwinScope.HOUSEHOLD_PROSUMER,
        owner_user_id="user_default",
        entity_reference="home_zero",
        city="Bengaluru",
        state="KA",
        utility="BESCOM",
        baseline_source="TEST",
        baseline_period="2026-03",
        baseline_consumption_kwh=0.0,
        baseline_peak_demand_kw=0.0,
        sanctioned_load_kw=3.0,
        baseline_bill_inr=0.0,
        tariff_schedule_id="KA_BESCOM_LT2A_2024",
        calibration_status=CalibrationStatus.UNCALIBRATED_SCENARIO_MODEL,
        validation_status=ValidationStatus.UNVALIDATED,
    )
    registry.register_custom_twin(zero_twin)

    scen_zero = service.create_scenario(
        user_id="user_default",
        twin_id=zero_twin.twin_id,
        scenario_name="Zero Test",
        description="Zero test",
        model_type=ScenarioModelType.CONSUMPTION_REDUCTION,
        parameters={"reduction_pct": 10.0},
    )
    res_zero = service.execute_scenario(scen_zero, "user_default")
    assert res_zero.consumption_delta_pct == 0.0
    assert res_zero.cost_delta_pct == 0.0


# -----------------------------------------------------------------------------
# TC-1710: Sensitivity Sweep Engine
# -----------------------------------------------------------------------------


def test_tc1710_sensitivity_sweep_engine(twin_fixture):
    """TC-1710: Verify deterministic parameter sweep and resource limit enforcement (<= 50 steps)."""
    service, registry, _ = twin_fixture
    twin = registry.get_twin("twin_blr_bescom_01")

    # 1. Successful sweep: solar capacity from 1.0 kWp to 5.0 kWp with step 1.0 kWp (5 points)
    sweep_res = service.run_sensitivity_sweep(
        twin_id=twin.twin_id,
        model_type=ScenarioModelType.SOLAR_PV_ADDITION,
        parameter_name="solar_capacity_kwp",
        start_value=1.0,
        end_value=5.0,
        step_size=1.0,
        fixed_parameters={"daily_insolation_kwh_m2": 4.8, "performance_ratio": 0.75},
        user_id="user_default",
    )

    assert sweep_res.num_points == 5
    assert sweep_res.points[0].parameter_value == 1.0
    assert sweep_res.points[-1].parameter_value == 5.0
    # Cost savings must monotonically increase with solar capacity
    savings = [p.net_cost_savings_inr for p in sweep_res.points]
    assert sorted(savings) == savings

    # 2. Oversized sweep rejection (>50 steps)
    with pytest.raises(ValueError, match="exceeding resource safety limit of 50 steps"):
        service.run_sensitivity_sweep(
            twin_id=twin.twin_id,
            model_type=ScenarioModelType.SOLAR_PV_ADDITION,
            parameter_name="solar_capacity_kwp",
            start_value=0.0,
            end_value=100.0,
            step_size=1.0,  # 101 steps
            fixed_parameters={},
            user_id="user_default",
        )


# -----------------------------------------------------------------------------
# TC-1711: Server-Side Authorization & Anti-Tampering
# -----------------------------------------------------------------------------


def test_tc1711_server_side_authorization_and_security(twin_fixture):
    """TC-1711: Verify cross-user digital twin isolation, forged property ID rejection, and code injection defense."""
    service, registry, _ = twin_fixture

    # 1. Cross-user scenario creation denied
    private_twin = DigitalTwinEntity(
        twin_id="twin_victim_private",
        name="Victim Private Household Twin",
        scope=TwinScope.HOUSEHOLD_PROSUMER,
        owner_user_id="user_victim_999",
        entity_reference="home_victim",
        city="Bengaluru",
        state="KA",
        utility="BESCOM",
        baseline_source="PRIVATE_METER",
        baseline_period="2026-03",
        baseline_consumption_kwh=500.0,
        baseline_peak_demand_kw=4.0,
        sanctioned_load_kw=5.0,
        baseline_bill_inr=3900.0,
        tariff_schedule_id="KA_BESCOM_LT2A_2024",
        calibration_status=CalibrationStatus.CALIBRATED_HISTORICAL,
        validation_status=ValidationStatus.VALIDATED_METER_DATA,
    )
    registry.register_custom_twin(private_twin)

    with pytest.raises(PermissionError, match="is not authorized to simulate private digital twin"):
        service.create_scenario(
            user_id="attacker_user_404",
            twin_id=private_twin.twin_id,
            scenario_name="Malicious Scenario",
            description="Unauthorized access attempt",
            model_type=ScenarioModelType.SOLAR_PV_ADDITION,
            parameters={"solar_capacity_kwp": 5.0},
        )

    # 2. Malicious arbitrary code execution injection in parameter payload
    twin_blr = registry.get_twin("twin_blr_bescom_01")
    with pytest.raises(ValueError, match="executable code prohibited"):
        service.create_scenario(
            user_id="user_default",
            twin_id=twin_blr.twin_id,
            scenario_name="Injection Attack",
            description="Testing code injection",
            model_type=ScenarioModelType.SOLAR_PV_ADDITION,
            parameters={"solar_capacity_kwp": 3.0, "payload": "__import__('os').system('dir')"},
        )


# -----------------------------------------------------------------------------
# TC-1712: AI Copilot Integration & Evidence Grounding
# -----------------------------------------------------------------------------


def test_tc1712_ai_copilot_simulation_integration(copilot_fixture):
    """TC-1712: Verify What-If simulation execution through AI Copilot, evidence citations, and numerical grounding."""
    copilot, twin_svc, _ = copilot_fixture

    # 1. Ask What-If query
    query = "What if I install 3 kW rooftop solar on my property?"
    response = copilot.ask(
        user_id="user_default",
        authorized_property_ids=["home_blr_bescom", "prop-ka-blr-01"],
        query=query,
        property_id="home_blr_bescom",
    )

    # 2. Verify response contract
    assert response.intent == CopilotIntent.SCENARIO_SIMULATION
    assert response.tool_name == "run_what_if_simulation"
    assert response.tool_execution_status == ToolExecutionStatus.SUCCESS
    assert response.grounding_status == GroundingStatus.GROUNDED_VERIFIED
    assert len(response.evidence_items) >= 1

    ev = response.evidence_items[0]
    assert ev.source_organization == "UrjaSetu Digital Twin Engine"
    assert ev.data_classification == "SIMULATED_SCENARIO"
    assert "[EVID-007]" in response.answer_text

    # 3. Verify all numbers in answer are grounded in evidence
    is_grounded, ungrounded = NumericalGroundingGuard.audit_grounding(
        response.answer_text,
        response.evidence,
    )
    assert is_grounded is True
    assert len(ungrounded) == 0

    # 4. Verify cross-user denial in Copilot
    denied_response = copilot.ask(
        user_id="unauthorized_user_123",
        authorized_property_ids=["other_prop"],
        query="Simulate 5 kW solar on home_blr_bescom",
        property_id="home_blr_bescom",
    )
    assert denied_response.tool_execution_status == ToolExecutionStatus.ACCESS_DENIED
    assert "not authorized" in denied_response.answer_text.lower()
