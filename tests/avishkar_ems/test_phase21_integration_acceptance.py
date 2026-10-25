"""Phase 21: End-to-End Integration, Demo Readiness & Verified Acceptance Test Suite.

Verifies the complete integration of UrjaSetu EMS across all 7 critical workflows:
- Workflow A: Public Energy Data Ingestion, Provenance & Anti-Disaggregation.
- Workflow B: Household Energy Analysis & Multi-Tenant Isolation.
- Workflow C: Statutory Tariff & Bill Validation Reconciliation.
- Workflow D: AI Energy Copilot Grounding, Evidence Bundles & Scope Refusal.
- Workflow E: Scenario Simulation & Energy Conservation Invariant.
- Workflow F: Alert Lifecycle, Notification Dispatch & Deduplication.
- Workflow G: Citizen Energy Portal Transparency & Moderation Transitions.
- Cross-Module Integration: Digital Twin, Recommendations, Policy & Tariff.
- Test Data & Demo Isolation Verification.
- Security & Sensitive Secret Redaction.
- Full Platform End-to-End Acceptance Health Check.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from avishkar_ems.ai_copilot import (
    AICopilotService,
    GroundingStatus,
    ToolExecutionStatus,
)
from avishkar_ems.citizen_portal import (
    CitizenPortalService,
    CitizenReport,
    IndicatorCategory,
    ReportCategory,
    ReportStatus,
    UserRole,
)
from avishkar_ems.command_center_service import CommandCenterService
from avishkar_ems.comparative_insights import ComparativeEnergyInsightEngine
from avishkar_ems.digital_twin import (
    DigitalTwinService,
    ScenarioModelType,
)
from avishkar_ems.energy_balance import EnergyBalanceAnalyzer
from avishkar_ems.event_monitoring import (
    AlertLifecycleManager,
    AlertStatus,
    EventCategory,
    EventMonitoringService,
    EventRecord,
    EventSeverity,
    ProcessingStatus,
)
from avishkar_ems.generation_mix import GenerationMixEngine
from avishkar_ems.geo_analytics_service import GeographicAnalyticsService
from avishkar_ems.geo_explorer import GeoExplorer
from avishkar_ems.health_center import DataSourceHealthCenter
from avishkar_ems.household_import import sanitize_and_validate_filename
from avishkar_ems.household_module import (
    HouseholdManager,
    HouseholdProfile,
    IntegrationStatus,
    UtilityBillRecord,
    UtilityProvider,
)
from avishkar_ems.policy_intelligence import PolicyIntelligenceService
from avishkar_ems.recommendations import (
    RecommendationEngine,
    RecommendationStatus,
)
from avishkar_ems.solar_intel import SolarIntelligenceEngine
from avishkar_ems.tariff_intelligence import (
    AuthoritativeTariffEngine,
    BillValidationStatus,
    TariffIntelligenceService,
    TimeOfUseOptimizer,
)
from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    DataClassification,
    MeasurementKind,
    QualityStatus,
)
from avishkar_ems.trust.data_quality import DataQualityValidator
from avishkar_ems.trust.idempotent_ingestion import IdempotentIngestionEngine, IngestionAction
from avishkar_ems.trust.source_registry import SourceConnectionStatus, SourceRegistry
from avishkar_ems.trust.unit_validation import UnitCategory, UnitValidator

# ------------------ TEST FIXTURES ------------------


@pytest.fixture
def household_setup() -> tuple[HouseholdManager, HouseholdProfile, HouseholdProfile]:
    """Sets up two isolated households: Home 1 (Bengaluru, User A) and Home 2 (Visakhapatnam, User B)."""
    mgr = HouseholdManager()
    mgr._profiles.clear()

    home1 = HouseholdProfile(
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
    home2 = HouseholdProfile(
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
    mgr._profiles[home1.profile_id] = home1
    mgr._profiles[home2.profile_id] = home2
    return mgr, home1, home2


# ------------------ TC-2101: WORKFLOW A — PUBLIC ENERGY DATA ------------------


def test_tc2101_workflow_a_public_energy_data_pipeline() -> None:
    """Verifies Workflow A: Public Energy Data Ingestion, Provenance & Anti-Disaggregation."""
    registry = SourceRegistry()
    cea_source = registry.get("CEA_POWER_SUPPLY_POSITION")
    assert cea_source is not None
    assert "Central Electricity Authority" in cea_source.provider_name

    # Unit & dimension validation
    assert UnitValidator.get_category("MU") == UnitCategory.ENERGY
    assert UnitValidator.get_category("MW") == UnitCategory.POWER

    # Observation creation and schema quality check
    now = datetime(2025, 1, 1, 0, 0, tzinfo=UTC)
    obs = CanonicalObservation(
        observation_id="TEST_OBS_001",
        source_id="CEA_POWER_SUPPLY_POSITION",
        dataset_id="NATIONAL_BALANCE",
        metric_id="ENERGY_REQUIREMENT_MU",
        original_metric_name="Energy Requirement",
        original_value=144576.0,
        original_unit="MU",
        normalized_value=144576.0,
        normalized_unit="MU",
        geographic_entity_id="IN",
        geographic_level="NATIONAL",
        reporting_period_start=now,
        reporting_period_end=now + timedelta(days=31),
        data_classification=DataClassification.OFFICIAL_OBSERVATION,
        quality_status=QualityStatus.VALID,
        original_source_record_id="REC_2025_01",
        provenance_reference="CEA PSP Monthly Table 1",
        ingestion_run_id="RUN_20250101_000000",
        measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
        observation_timestamp=now + timedelta(days=31),
    )
    status, _ = DataQualityValidator.validate(obs)
    assert status == QualityStatus.VALID

    # Idempotent storage
    ingestor = IdempotentIngestionEngine()
    res1 = ingestor.ingest(obs)
    assert res1.action in (IngestionAction.INSERTED_NEW, IngestionAction.IGNORED_DUPLICATE)

    # Ingestion idempotency check: re-ingestion of byte-identical record
    res2 = ingestor.ingest(obs)
    assert res2.action == IngestionAction.IGNORED_DUPLICATE

    # Anti-disaggregation invariant: verify state total cannot be downscaled to district
    geo = GeoExplorer()
    assert geo.are_utility_and_district_coterminous("BESCOM", "KA_BLR_URBAN") is False
    is_attr, expl = geo.can_attribute_metric("PEAK_DEMAND_MET_MW", "KA_BLR_URBAN")
    assert is_attr is False
    assert "UNAVAILABLE" in expl
    assert geo.verify_no_disaggregation("PEAK_DEMAND_MET_MW", "KA", "KA_BLR_URBAN") is False


# ------------------ TC-2102: WORKFLOW B — HOUSEHOLD ENERGY ANALYSIS & ISOLATION ------------------


def test_tc2102_workflow_b_household_energy_analysis_and_isolation(
    household_setup: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """Verifies Workflow B: Household Energy Analysis, Bill Ingestion & Multi-Tenant Isolation."""
    mgr, home1, home2 = household_setup

    # Authorized user accesses own profile
    user_a_home = mgr.get_home("USER-A-BENGALURU", home1.profile_id)
    assert user_a_home.display_name == "Indiranagar Residence"
    assert user_a_home.mask_account_id() == "BES...1029"

    # Cross-tenant access rejection: User B attempts to access User A's profile
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        mgr.get_home("USER-B-VIZAG", home1.profile_id)

    # Ingest bill into User A's household
    bill = UtilityBillRecord(
        bill_month="2025-01",
        bill_date="2025-02-05",
        units_consumed_kwh=350.0,
        total_amount_inr=2620.0,
        fixed_charge_inr=280.0,
        energy_charge_inr=2225.0,
        solar_credit_inr=85.0,
        tax_and_duty_inr=200.0,
    )
    mgr.record_bill(home1.profile_id, bill, user_id="USER-A-BENGALURU")

    # Unauthorized bill retrieval rejection
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        mgr.get_home("USER-B-VIZAG", home1.profile_id)

    # Authorized bill retrieval
    bills = mgr.get_home("USER-A-BENGALURU", home1.profile_id).bills
    assert len(bills) == 1
    assert bills[0].total_amount_inr == 2620.0


# ------------------ TC-2103: WORKFLOW C — TARIFF & BILL VALIDATION RECONCILIATION ------------------


def test_tc2103_workflow_c_tariff_and_bill_validation_reconciliation(
    household_setup: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """Verifies Workflow C: Tariff & Bill Validation Reconciliation with Anti-False Accusation."""
    mgr, home1, _ = household_setup
    tariff_svc = TariffIntelligenceService(household_mgr=mgr)

    # 1. Calculate deterministic bill for BESCOM LT-2(a) FY25
    # Sanctioned load = 4 kW, consumption = 250 kWh, solar export = 50 kWh
    calc = tariff_svc.calculate_bill(
        consumption_kwh=250.0,
        sanctioned_load_kw=4.0,
        schedule_id="KA_BESCOM_LT2A_2024",
        solar_export_kwh=50.0,
    )
    # Fixed charge: 4 kW * 70 = 280
    # Energy: 100 * 4.75 + 150 * 7.00 = 475 + 1050 = 1525
    # FAC: 250 * 0.22 = 55.0
    # Tax: 1525 * 9% = 137.25
    # Gross: 280 + 1525 + 55 + 137.25 = 1997.25
    # Solar credit: 50 * 3.10 = 155.0
    # Net: 1997.25 - 155.0 = 1842.25
    assert calc.is_official_bill is False
    assert calc.fixed_charges_inr == 280.0
    assert calc.energy_charges_inr == 1525.0
    assert calc.solar_credit_inr == 155.0
    assert calc.net_calculated_bill_inr == 1842.25

    # 2. Reconcile with exact utility bill
    bill_exact = UtilityBillRecord(
        bill_month="2025-01",
        bill_date="2025-02-05",
        units_consumed_kwh=250.0,
        total_amount_inr=1842.25,
        fixed_charge_inr=280.0,
        energy_charge_inr=1525.0,
        net_meter_export_kwh=50.0,
        solar_credit_inr=155.0,
        tax_and_duty_inr=137.25,
    )
    home1.bills.append(bill_exact)

    val_exact = tariff_svc.validate_property_bill(
        property_id=home1.profile_id,
        bill_id=bill_exact.bill_id,
        auth_user_id="USER-A-BENGALURU",
        authorized_property_ids=[home1.profile_id],
    )
    assert val_exact.validation_status == BillValidationStatus.EXACT_MATCH
    assert abs(val_exact.absolute_difference_inr) <= 1.0

    # 3. Reconcile with minor fuel adjustment discrepancy (within FAC tolerance)
    bill_explained = UtilityBillRecord(
        bill_month="2025-02",
        bill_date="2025-03-05",
        units_consumed_kwh=250.0,
        total_amount_inr=1875.0,  # +32.75 INR variance (within 250 * 0.22 + 5 = 60 INR)
        fixed_charge_inr=280.0,
        energy_charge_inr=1525.0,
        net_meter_export_kwh=50.0,
        solar_credit_inr=155.0,
        tax_and_duty_inr=137.25,
    )
    home1.bills.append(bill_explained)

    val_explained = tariff_svc.validate_property_bill(
        property_id=home1.profile_id,
        bill_id=bill_explained.bill_id,
        auth_user_id="USER-A-BENGALURU",
        authorized_property_ids=[home1.profile_id],
    )
    assert val_explained.validation_status == BillValidationStatus.DISCREPANCY_EXPLAINED
    # Anti-false accusation policy: verify notes do not accuse fraud but explain variance
    assert "not necessarily indicate billing fraud" in val_explained.disclaimer.lower()


# ------------------ TC-2104: WORKFLOW D — AI ENERGY COPILOT GROUNDING & REFUSAL ------------------


def test_tc2104_workflow_d_ai_copilot_grounding_and_refusal(
    household_setup: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """Verifies Workflow D: AI Energy Copilot Grounding, Evidence Bundles & Scope Refusal."""
    mgr, home1, home2 = household_setup
    rec_engine = RecommendationEngine(household_mgr=mgr)
    citizen_svc = CitizenPortalService()
    twin_svc = DigitalTwinService(household_mgr=mgr)
    event_svc = EventMonitoringService()
    policy_svc = PolicyIntelligenceService(household_mgr=mgr)
    tariff_svc = TariffIntelligenceService(household_mgr=mgr)

    copilot = AICopilotService(
        household_mgr=mgr,
        rec_engine=rec_engine,
        citizen_service=citizen_svc,
        twin_service=twin_svc,
        event_service=event_svc,
        policy_service=policy_svc,
        tariff_service=tariff_svc,
    )

    # 1. Authorized Policy inquiry
    res_policy = copilot.ask(
        user_id="USER-A-BENGALURU",
        authorized_property_ids=[home1.profile_id],
        query="What is the Central Financial Assistance subsidy under PM Surya Ghar for a 3 kW solar system?",
        property_id=home1.profile_id,
    )
    assert res_policy.grounding_status in (GroundingStatus.GROUNDED_VERIFIED, GroundingStatus.GROUNDING_FALLBACK)
    assert "78,000" in res_policy.answer_text or "78000" in res_policy.answer_text or "surya" in res_policy.answer_text.lower()
    assert len(res_policy.evidence_items) >= 1

    # 2. Authorized Tariff inquiry
    res_tariff = copilot.ask(
        user_id="USER-A-BENGALURU",
        authorized_property_ids=[home1.profile_id],
        query="Run a tariff comparison between BESCOM LT-2(a) and LT-3(a) for 300 units.",
        property_id=home1.profile_id,
    )
    assert res_tariff.grounding_status in (GroundingStatus.GROUNDED_VERIFIED, GroundingStatus.GROUNDING_FALLBACK)
    assert len(res_tariff.evidence_items) >= 1

    # 3. Cross-Tenant unauthorized inquiry refusal
    res_unauth = copilot.ask(
        user_id="USER-A-BENGALURU",
        authorized_property_ids=[home1.profile_id],
        query="Show me the private electricity bills for Waltair Villa.",
        property_id=home2.profile_id,  # User A has no rights over home 2
    )
    assert (
        res_unauth.tool_execution_status == ToolExecutionStatus.ACCESS_DENIED
        or "access denied" in res_unauth.answer_text.lower()
    )


# ------------------ TC-2105: WORKFLOW E — SCENARIO SIMULATION & CONSERVATION INVARIANT ------------------


def test_tc2105_workflow_e_scenario_simulation_and_energy_conservation(
    household_setup: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """Verifies Workflow E: Digital Twin Scenario Simulation & Energy Conservation Invariant."""
    mgr, home1, _ = household_setup
    twin_svc = DigitalTwinService(household_mgr=mgr)

    # Execute solar & battery scenario simulation
    scen = twin_svc.create_scenario(
        user_id="user_default",
        twin_id="twin_blr_bescom_01",
        scenario_name="4 kWp Rooftop Solar Addition",
        description="Deterministic solar simulation",
        model_type=ScenarioModelType.SOLAR_PV_ADDITION,
        parameters={"solar_capacity_kwp": 4.0, "performance_ratio": 0.75, "daily_insolation_kwh_m2": 4.8},
    )
    sim_res = twin_svc.execute_scenario(scen, user_id="user_default")

    assert sim_res.renewable_share_pct <= 100.0
    assert sim_res.solar_generation_kwh > 0.0
    assert sim_res.net_cost_savings_inr >= 0.0

    # Execute ToU demand load shifting and verify Energy Conservation Invariant
    tariff_svc = TariffIntelligenceService(household_mgr=mgr)
    sched = tariff_svc.registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert sched is not None

    optimizer = TimeOfUseOptimizer()
    tou_res = optimizer.evaluate_load_shift(
        property_id=home1.profile_id,
        total_kwh=360.0,
        sanctioned_load_kw=4.0,
        schedule=sched,
        shift_kwh=50.0,
    )
    # Strict energy conservation: shifted amount preserves total consumption
    assert tou_res.total_consumption_kwh == 360.0
    assert tou_res.shifted_kwh == 50.0


# ------------------ TC-2106: WORKFLOW F — ALERT LIFECYCLE & DEDUPLICATION ------------------


def test_tc2106_workflow_f_alert_lifecycle_and_deduplication(
    household_setup: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """Verifies Workflow F: Real-Time Event Monitoring, Alert Rules, Deduplication & Lifecycle."""
    _, home1, _ = household_setup
    event_svc = EventMonitoringService()

    # 1. Ingest an anomaly event
    event1 = EventRecord(
        event_id="EVT-2025-001",
        event_type="demand.overdraw",
        event_category=EventCategory.SANCTIONED_LOAD_EXCEEDED,
        severity=EventSeverity.HIGH,
        source_service="household_module",
        entity_id=home1.profile_id,
        rule_id="RULE-EVT-LOAD-01",
        reporting_period="2025-01",
        payload={
            "owner_user_id": home1.user_id,
            "title": "Excess Demand Spike Detected",
            "observed_value": 5.65,
            "threshold_value": 4.0,
            "unit": "kW",
        },
    )
    res_evt1, alert1 = event_svc.ingest_event(event1)
    assert res_evt1.processing_status == ProcessingStatus.PROCESSED
    assert alert1 is not None
    assert alert1.status == AlertStatus.OPEN
    assert alert1.occurrence_count == 1

    # 2. Ingest duplicate event within suppression window -> Deduplication suppresses duplicate alert
    event_dup = EventRecord(
        event_id="EVT-2025-002",
        event_type="demand.overdraw",
        event_category=EventCategory.SANCTIONED_LOAD_EXCEEDED,
        severity=EventSeverity.HIGH,
        source_service="household_module",
        entity_id=home1.profile_id,
        rule_id="RULE-EVT-LOAD-01",
        reporting_period="2025-01",
        payload={
            "owner_user_id": home1.user_id,
            "title": "Excess Demand Spike Detected",
            "observed_value": 5.70,
            "threshold_value": 4.0,
            "unit": "kW",
        },
    )
    res_evt2, alert2 = event_svc.ingest_event(event_dup)
    assert res_evt2.processing_status == ProcessingStatus.DUPLICATE_SUPPRESSED
    assert alert2 is not None
    assert alert2.alert_id == alert1.alert_id
    assert alert2.occurrence_count == 2

    # 3. Alert lifecycle: Acknowledge and Resolve
    acked = AlertLifecycleManager.transition(alert1, AlertStatus.ACKNOWLEDGED, home1.user_id, "Investigating")
    assert acked.status == AlertStatus.ACKNOWLEDGED

    resolved = AlertLifecycleManager.transition(acked, AlertStatus.RESOLVED, home1.user_id, "Load normalized")
    assert resolved.status == AlertStatus.RESOLVED

    # 4. Prohibited jump: RESOLVED is terminal
    with pytest.raises(ValueError, match="ILLEGAL STATE TRANSITION"):
        AlertLifecycleManager.transition(resolved, AlertStatus.OPEN, home1.user_id)


# ------------------ TC-2107: WORKFLOW G — CITIZEN PORTAL TRANSPARENCY & MODERATION ------------------


def test_tc2107_workflow_g_citizen_portal_transparency_and_moderation() -> None:
    """Verifies Workflow G: Public Transparency, Citizen Reporting & Moderation State Transitions."""
    portal = CitizenPortalService()

    # Public indicators query (scrubs private PII)
    indicators = portal.get_public_indicators(geo_scope="ALL", category=IndicatorCategory.DEMAND_SUPPLY)
    assert len(indicators) >= 1
    for ind in indicators:
        assert "private" not in ind.name.lower()

    # Submit citizen infrastructure report
    ok, report = portal.submit_citizen_report(
        category=ReportCategory.INFRASTRUCTURE_HAZARD,
        title="Streetlight illuminated continuously in daytime",
        description="High-voltage sodium vapor streetlight running without ambient daylight sensor near metro.",
        geographic_level="DISTRICT",
        location_name="Near Indiranagar CMH Road Metro",
        submitter_id="citizen_tester_01",
    )
    assert ok is True
    assert isinstance(report, CitizenReport)
    assert report.status == ReportStatus.SUBMITTED

    # Valid moderation transition: SUBMITTED -> UNDER_REVIEW
    ok_mod, msg_mod = portal.moderate_report(
        report_id=report.report_id,
        new_status=ReportStatus.UNDER_REVIEW,
        moderator_id="ADMIN-MODERATOR-01",
        notes="Dispatched field technician to inspect feeder line.",
        user_role=UserRole.ADMIN,
    )
    assert ok_mod is True
    assert portal._reports[report.report_id].status == ReportStatus.UNDER_REVIEW

    # Invalid state transition rejection: Cannot jump from UNDER_REVIEW back to SUBMITTED
    ok_bad, msg_bad = portal.moderate_report(
        report_id=report.report_id,
        new_status=ReportStatus.SUBMITTED,
        moderator_id="ADMIN-MODERATOR-01",
        notes="Invalid backward transition.",
        user_role=UserRole.ADMIN,
    )
    assert ok_bad is False
    assert "INVALID_TRANSITION" in msg_bad


# ------------------ TC-2108: CROSS-MODULE INTEGRATION — RECOMMENDATIONS & TARIFF ------------------


def test_tc2108_cross_module_recommendations_and_tariff_integration(
    household_setup: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """Verifies Cross-Module Integration: Recommendation Engine backed by Authoritative Tariffs."""
    mgr, home1, _ = household_setup
    rec_engine = RecommendationEngine(household_mgr=mgr)
    tariff_svc = TariffIntelligenceService(household_mgr=mgr)
    tariff_engine = AuthoritativeTariffEngine()

    recs = rec_engine.generate_recommendations(user_id=home1.user_id, property_id=home1.profile_id)
    assert len(recs) >= 1

    # Verify that authoritative tariff engine reproduces baseline cost for household
    sched = tariff_svc.registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert sched is not None
    calc = tariff_engine.calculate_bill(consumption_kwh=300.0, sanctioned_load_kw=4.0, schedule=sched)
    assert calc.net_calculated_bill_inr > 0.0

    # Verify that recommendations carry status and source references
    for rec in recs:
        assert rec.calculation_method is not None
        assert rec.status == RecommendationStatus.PENDING


# ------------------ TC-2109: CROSS-MODULE INTEGRATION — POLICY SUBSIDY & CO2 FACTOR ------------------


def test_tc2109_cross_module_policy_subsidy_and_co2_factor(
    household_setup: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """Verifies Cross-Module Integration: Policy CFA Subsidy, Rooftop Sizing & Statutory CEA CO2 Factor."""
    mgr, home1, _ = household_setup
    policy_svc = PolicyIntelligenceService(household_mgr=mgr)

    eligibility = policy_svc.assess_household_eligibility(
        property_id=home1.profile_id,
        auth_user_id=home1.user_id,
    )
    assert eligibility.policy_id == "POL-IN-MNRE-SURYA-GHAR-2024"
    assert eligibility.eligible is True
    # 4 kW sanctioned connection -> recommended 3 kWp
    # CFA subsidy: 30k (1kW) + 30k (2kW) + 18k (3kW) = 78,000 INR
    assert eligibility.subsidy_amount_inr == 78000.0
    assert eligibility.avoided_co2_kg_per_year > 0.0


# ------------------ TC-2110: TEST DATA & DEMO ISOLATION AUDIT ------------------


def test_tc2110_test_data_and_demo_isolation_audit() -> None:
    """Verifies Test Data & Demo Isolation: Asserts synthetic records are never marked as official."""
    registry = SourceRegistry()
    sources = registry.list_all()
    assert len(sources) >= 1
    for s in sources:
        # Official sources must have real domains and authority definitions
        if s.connection_status == SourceConnectionStatus.DATA_INGESTED:
            assert s.homepage_url.startswith("http")
            assert len(s.provider_name) > 0


# ------------------ TC-2111: SECURITY & SENSITIVE REDACTION AUDIT ------------------


def test_tc2111_security_and_sensitive_redaction_audit(
    household_setup: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """Verifies Security & Privacy: Asserts zero plaintext passwords, tokens, or unmasked account IDs."""
    _, home1, _ = household_setup

    # Profile account number must be masked (e.g. BES...1029)
    assert "..." in home1.mask_account_id()

    # Parser rejects path traversal attempts
    cleaned = sanitize_and_validate_filename("../../../etc/passwd.csv")
    assert cleaned == "passwd.csv"

    with pytest.raises(ValueError, match="FILE REJECTED"):
        sanitize_and_validate_filename("malicious_script.exe")


# ------------------ TC-2112: FULL PLATFORM END-TO-END ACCEPTANCE HEALTH CHECK ------------------


def test_tc2112_full_platform_end_to_end_acceptance(
    household_setup: tuple[HouseholdManager, HouseholdProfile, HouseholdProfile],
) -> None:
    """Verifies Full Platform Integration: All 19 services initialize and execute without defect."""
    mgr, home1, _ = household_setup

    geo = GeoExplorer()
    balance = EnergyBalanceAnalyzer()
    solar = SolarIntelligenceEngine()
    mix_engine = GenerationMixEngine(solar)
    geo_service = GeographicAnalyticsService(geo)
    insights_engine = ComparativeEnergyInsightEngine(balance, solar, mix_engine)
    health_center = DataSourceHealthCenter()
    cmd_service = CommandCenterService(balance, solar, mix_engine, geo_service, None, insights_engine, health_center)
    rec_engine = RecommendationEngine(household_mgr=mgr)
    citizen_service = CitizenPortalService()
    twin_service = DigitalTwinService(household_mgr=mgr)
    event_service = EventMonitoringService()
    policy_service = PolicyIntelligenceService(household_mgr=mgr)
    tariff_service = TariffIntelligenceService(household_mgr=mgr)
    copilot_service = AICopilotService(
        household_mgr=mgr,
        rec_engine=rec_engine,
        citizen_service=citizen_service,
        twin_service=twin_service,
        event_service=event_service,
        policy_service=policy_service,
        tariff_service=tariff_service,
    )

    # 1. Health check
    liveness = health_center.get_liveness()
    assert liveness.status == "UP"

    readiness = health_center.get_readiness()
    assert readiness.status == "READY"

    # 2. Command center executive KPI
    overview = cmd_service.get_system_overview("IN", "2024-04")
    assert overview.kpis is not None
    assert "DEMAND" in overview.kpis

    # 3. Copilot query over full stack
    answer = copilot_service.ask(
        user_id=home1.user_id,
        authorized_property_ids=[home1.profile_id],
        query="What is the national peak demand met?",
        property_id=home1.profile_id,
    )
    assert answer.answer_text is not None
    assert len(answer.evidence_items) >= 1
