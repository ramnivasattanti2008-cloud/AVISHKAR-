"""Unit, integration, and security tests for Phase 19: Energy Policy Intelligence & Impact Assessment.

Test Suite Catalog:
- TC-1901: PolicyRecord schema validation, constraints, and SHA-256 fingerprinting.
- TC-1902: PolicyRegistry canonical policy seeding, retrieval, and multi-dimensional filtering.
- TC-1903: PolicyTarget schema constraints (positive value, target_year > baseline_year).
- TC-1904: PolicyProgressEngine mathematical run-rate and trajectory evaluation.
- TC-1905: Baseline unavailable handling (truth-in-data refusal to manufacture pseudo-progress).
- TC-1906: PolicyAmendmentComparator side-by-side regulatory diff analysis.
- TC-1907: PM Surya Ghar CFA subsidy calculation across all capacity tiers (up to 2 kW, 3 kW, cap).
- TC-1908: Household rooftop area and sanctioned load capacity constraints.
- TC-1909: Statutory CO2 mitigation calculation using CEA grid emissions factor (0.716 kg CO2/kWh).
- TC-1910: Server-side tenant authorization and cross-tenant access denial.
- TC-1911: AI Copilot policy intent routing, tool execution, and NumericalGroundingGuard verification.
- TC-1912: End-to-end policy intelligence and impact assessment lifecycle.
"""

import pytest

from avishkar_ems.ai_copilot import (
    AICopilotService,
    CopilotIntent,
    GroundingStatus,
    ToolExecutionStatus,
)
from avishkar_ems.household_module import HouseholdManager
from avishkar_ems.policy_intelligence import (
    CEA_GRID_EMISSIONS_FACTOR_KG_CO2_PER_KWH,
    HouseholdPolicyAssessor,
    PolicyAmendmentComparator,
    PolicyClassification,
    PolicyIntelligenceService,
    PolicyJurisdiction,
    PolicyRecord,
    PolicyRegistry,
    PolicySector,
    PolicyStatus,
    PolicyTarget,
    TargetProgressStatus,
)

# -----------------------------------------------------------------------------
# TC-1901: PolicyRecord Validation & Integrity
# -----------------------------------------------------------------------------


def test_tc1901_policy_record_validation_and_integrity() -> None:
    # 1. Valid record
    pol = PolicyRecord(
        policy_id="POL-TEST-01",
        title="Test Policy",
        jurisdiction=PolicyJurisdiction.NATIONAL_INDIA,
        governing_body="MNRE",
        sector=PolicySector.ROOFTOP_SOLAR,
        classification=PolicyClassification.OFFICIAL_STATUTORY,
        status=PolicyStatus.ACTIVE,
        enactment_date="2024-01-01",
        effective_date="2024-01-01",
        sunset_date=None,
        gazette_or_notification_ref="Gazette No. 123",
        official_url="https://mnre.gov.in/test",
        document_sha256="a" * 64,
        summary="Test policy summary",
        key_provisions=("Provision 1", "Provision 2"),
        statutory_limitations=("Limitation 1",),
    )
    assert pol.policy_id == "POL-TEST-01"
    assert len(pol.document_sha256) == 64

    # 2. Empty ID/title rejection
    with pytest.raises(ValueError, match="policy_id and title must be non-empty"):
        PolicyRecord(
            policy_id="",
            title="Test",
            jurisdiction=PolicyJurisdiction.NATIONAL_INDIA,
            governing_body="MNRE",
            sector=PolicySector.ROOFTOP_SOLAR,
            classification=PolicyClassification.OFFICIAL_STATUTORY,
            status=PolicyStatus.ACTIVE,
            enactment_date="2024-01-01",
            effective_date="2024-01-01",
            sunset_date=None,
            gazette_or_notification_ref="Gazette No. 123",
            official_url="https://mnre.gov.in/test",
            document_sha256="a" * 64,
            summary="Test",
            key_provisions=(),
            statutory_limitations=(),
        )

    # 3. Invalid URL rejection
    with pytest.raises(ValueError, match="official_url must be a valid HTTP"):
        PolicyRecord(
            policy_id="POL-TEST-02",
            title="Test",
            jurisdiction=PolicyJurisdiction.NATIONAL_INDIA,
            governing_body="MNRE",
            sector=PolicySector.ROOFTOP_SOLAR,
            classification=PolicyClassification.OFFICIAL_STATUTORY,
            status=PolicyStatus.ACTIVE,
            enactment_date="2024-01-01",
            effective_date="2024-01-01",
            sunset_date=None,
            gazette_or_notification_ref="Gazette No. 123",
            official_url="ftp://invalid-url.com",
            document_sha256="a" * 64,
            summary="Test",
            key_provisions=(),
            statutory_limitations=(),
        )

    # 4. Invalid SHA-256 rejection
    with pytest.raises(ValueError, match="document_sha256 must be a valid 64-character"):
        PolicyRecord(
            policy_id="POL-TEST-03",
            title="Test",
            jurisdiction=PolicyJurisdiction.NATIONAL_INDIA,
            governing_body="MNRE",
            sector=PolicySector.ROOFTOP_SOLAR,
            classification=PolicyClassification.OFFICIAL_STATUTORY,
            status=PolicyStatus.ACTIVE,
            enactment_date="2024-01-01",
            effective_date="2024-01-01",
            sunset_date=None,
            gazette_or_notification_ref="Gazette No. 123",
            official_url="https://mnre.gov.in/test",
            document_sha256="short_hash",
            summary="Test",
            key_provisions=(),
            statutory_limitations=(),
        )


# -----------------------------------------------------------------------------
# TC-1902: PolicyRegistry Seeding & Filtering
# -----------------------------------------------------------------------------


def test_tc1902_statutory_policy_registry_seeding_and_retrieval() -> None:
    registry = PolicyRegistry()

    # Verify canonical policies exist
    surya_ghar = registry.get_policy("POL-IN-MNRE-SURYA-GHAR-2024")
    assert surya_ghar is not None
    assert "PM Surya Ghar" in surya_ghar.title
    assert surya_ghar.sector == PolicySector.ROOFTOP_SOLAR
    assert len(surya_ghar.targets) >= 2

    ndc = registry.get_policy("POL-IN-MOP-NDC-2022")
    assert ndc is not None
    assert ndc.sector == PolicySector.RENEWABLE_ENERGY_TARGET

    kerc = registry.get_policy("POL-KA-KERC-SOLAR-2023")
    assert kerc is not None
    assert kerc.jurisdiction == PolicyJurisdiction.STATE_KARNATAKA

    aperc = registry.get_policy("POL-AP-APERC-SOLAR-2024")
    assert aperc is not None
    assert aperc.jurisdiction == PolicyJurisdiction.STATE_ANDHRA_PRADESH

    # Test multi-dimensional filtering
    ka_policies = registry.list_policies(jurisdiction=PolicyJurisdiction.STATE_KARNATAKA)
    assert len(ka_policies) == 1
    assert ka_policies[0].policy_id == "POL-KA-KERC-SOLAR-2023"

    eff_policies = registry.list_policies(sector=PolicySector.ENERGY_EFFICIENCY)
    assert len(eff_policies) == 1
    assert eff_policies[0].policy_id == "POL-IN-BEE-SL-2023"


# -----------------------------------------------------------------------------
# TC-1903: PolicyTarget Validation & Invariants
# -----------------------------------------------------------------------------


def test_tc1903_policy_target_validation_and_invariants() -> None:
    # 1. Valid target
    tgt = PolicyTarget(
        target_id="TGT-TEST-01",
        policy_id="POL-TEST-01",
        target_name="Solar Capacity",
        metric_name="capacity_gw",
        unit="GW",
        target_value=50.0,
        target_year=2030,
        baseline_year=2020,
        baseline_value=10.0,
        official_source_citation="Statutory Gazette Vol 1",
    )
    assert tgt.target_value == 50.0

    # 2. Non-positive target value rejection
    with pytest.raises(ValueError, match="target_value must be positive"):
        PolicyTarget(
            target_id="TGT-TEST-02",
            policy_id="POL-TEST-01",
            target_name="Solar Capacity",
            metric_name="capacity_gw",
            unit="GW",
            target_value=0.0,
            target_year=2030,
            baseline_year=2020,
            baseline_value=10.0,
            official_source_citation="Statutory Gazette Vol 1",
        )

    # 3. Target year <= baseline year rejection
    with pytest.raises(ValueError, match="target_year .* must be strictly after baseline_year"):
        PolicyTarget(
            target_id="TGT-TEST-03",
            policy_id="POL-TEST-01",
            target_name="Solar Capacity",
            metric_name="capacity_gw",
            unit="GW",
            target_value=50.0,
            target_year=2020,
            baseline_year=2025,
            baseline_value=10.0,
            official_source_citation="Statutory Gazette Vol 1",
        )


# -----------------------------------------------------------------------------
# TC-1904: Target Progress Run-Rate Evaluation
# -----------------------------------------------------------------------------


def test_tc1904_target_progress_runrate_evaluation() -> None:
    service = PolicyIntelligenceService()

    # 1. Evaluate PM Surya Ghar capacity target
    # Baseline: 2.65 GW (2023), Target: 30.0 GW (2027), Observed: 5.80 GW (2026)
    asm = service.evaluate_target_progress("TGT-SURYA-GHAR-CAPACITY", current_year=2026)

    assert asm.target_id == "TGT-SURYA-GHAR-CAPACITY"
    assert asm.baseline_value == 2.65
    assert asm.current_achieved_value == 5.80
    assert asm.target_value == 30.0
    assert asm.unit == "GW"

    # Hand calculation:
    # achievement_pct = ((5.80 - 2.65) / (30.0 - 2.65)) * 100 = (3.15 / 27.35) * 100 = 11.52%
    # expected_runrate = (3 / 4) * 100 = 75.0%
    assert asm.achievement_pct == pytest.approx(11.52, rel=1e-2)
    assert asm.expected_runrate_pct == 75.0
    assert asm.progress_status in [TargetProgressStatus.AT_RISK, TargetProgressStatus.CRITICALLY_LAGGING]

    # 2. Evaluate India NDC Non-Fossil Capacity target
    # Baseline: 30.5% (2015), Target: 50.0% (2030), Observed: 45.4% (2026)
    ndc_asm = service.evaluate_target_progress("TGT-NDC-NON-FOSSIL-CAPACITY", current_year=2026)
    # Hand calculation:
    # achievement_pct = ((45.4 - 30.5) / (50.0 - 30.5)) * 100 = (14.9 / 19.5) * 100 = 76.41%
    # expected_runrate = (11 / 15) * 100 = 73.33%
    # Since 76.41% >= 0.90 * 73.33% (66.0%), status should be ON_TRACK
    assert ndc_asm.achievement_pct == pytest.approx(76.41, rel=1e-2)
    assert ndc_asm.expected_runrate_pct == pytest.approx(73.33, rel=1e-2)
    assert ndc_asm.progress_status == TargetProgressStatus.ON_TRACK


# -----------------------------------------------------------------------------
# TC-1905: Baseline Unavailable & Data Quality Defense
# -----------------------------------------------------------------------------


def test_tc1905_target_progress_baseline_unavailable() -> None:
    registry = PolicyRegistry()
    # Register synthetic policy with unobserved target
    unobs_target = PolicyTarget(
        target_id="TGT-UNOBSERVED-01",
        policy_id="POL-TEST-UNOBS",
        target_name="Unobserved Biomass Target",
        metric_name="biomass_mw",
        unit="MW",
        target_value=500.0,
        target_year=2028,
        baseline_year=2022,
        baseline_value=50.0,
        official_source_citation="Draft Notification",
    )
    pol = PolicyRecord(
        policy_id="POL-TEST-UNOBS",
        title="Unobserved Policy",
        jurisdiction=PolicyJurisdiction.NATIONAL_INDIA,
        governing_body="MNRE",
        sector=PolicySector.RENEWABLE_ENERGY_TARGET,
        classification=PolicyClassification.OFFICIAL_STATUTORY,
        status=PolicyStatus.ACTIVE,
        enactment_date="2022-01-01",
        effective_date="2022-01-01",
        sunset_date=None,
        gazette_or_notification_ref="Ref 001",
        official_url="https://mnre.gov.in",
        document_sha256="b" * 64,
        summary="Unobserved policy",
        key_provisions=(),
        statutory_limitations=(),
        targets=(unobs_target,),
    )
    registry.register_policy(pol)

    service = PolicyIntelligenceService()
    service._registry.register_policy(pol)

    asm = service.evaluate_target_progress("TGT-UNOBSERVED-01")
    assert asm.progress_status == TargetProgressStatus.BASELINE_UNAVAILABLE
    assert asm.current_achieved_value == 0.0
    assert "No official progress observation" in asm.authoritative_source_reference


# -----------------------------------------------------------------------------
# TC-1906: Policy Amendment Comparator
# -----------------------------------------------------------------------------


def test_tc1906_policy_amendment_comparator() -> None:
    comparator = PolicyAmendmentComparator()
    diff = comparator.compare_pm_surya_ghar_vs_phase2()

    assert diff["comparison_id"] == "CMP-SURYA-GHAR-VS-PHASE2"
    assert len(diff["dimension_comparisons"]) == 4

    dims = {d["dimension"]: d for d in diff["dimension_comparisons"]}
    assert "Subsidy Model" in dims
    assert "Disbursement Channel" in dims
    assert "Direct Benefit Transfer (DBT)" in dims["Disbursement Channel"]["current_version"]
    assert "Rs 30,000/kW" in dims["Subsidy Model"]["current_version"]
    assert len(diff["statutory_citations"]) >= 2


# -----------------------------------------------------------------------------
# TC-1907: PM Surya Ghar CFA Subsidy Tiers
# -----------------------------------------------------------------------------


def test_tc1907_household_pm_surya_ghar_cfa_subsidy_tiers() -> None:
    assessor = HouseholdPolicyAssessor(PolicyRegistry())

    # Tier 1: Up to 2 kW @ Rs 30,000/kW
    # 1.5 kW system
    res_1_5 = assessor.evaluate_eligibility(
        household_id="h1",
        sanctioned_load_kw=1.5,
        monthly_kwh=180.0,
        rooftop_area_sqm=20.0,
        state_code="KA",
    )
    assert res_1_5.eligible is True
    assert res_1_5.subsidy_amount_inr == 45000.0  # 1.5 * 30,000

    # 2.0 kW system
    res_2_0 = assessor.evaluate_eligibility(
        household_id="h2",
        sanctioned_load_kw=2.0,
        monthly_kwh=220.0,
        rooftop_area_sqm=25.0,
        state_code="KA",
    )
    assert res_2_0.eligible is True
    assert res_2_0.subsidy_amount_inr == 60000.0  # 2.0 * 30,000

    # Tier 2: Additional capacity up to 3 kW @ Rs 18,000/kW
    # 2.5 kW system: 60,000 + (0.5 * 18,000) = 69,000
    res_2_5 = assessor.evaluate_eligibility(
        household_id="h3",
        sanctioned_load_kw=2.5,
        monthly_kwh=280.0,
        rooftop_area_sqm=30.0,
        state_code="KA",
    )
    assert res_2_5.eligible is True
    assert res_2_5.subsidy_amount_inr == 69000.0

    # 3.0 kW system: 60,000 + 18,000 = 78,000
    res_3_0 = assessor.evaluate_eligibility(
        household_id="h4",
        sanctioned_load_kw=3.0,
        monthly_kwh=350.0,
        rooftop_area_sqm=35.0,
        state_code="KA",
    )
    assert res_3_0.eligible is True
    assert res_3_0.subsidy_amount_inr == 78000.0

    # Tier 3: Above 3 kW capped at Rs 78,000
    # 5.0 kW system
    res_5_0 = assessor.evaluate_eligibility(
        household_id="h5",
        sanctioned_load_kw=5.0,
        monthly_kwh=550.0,
        rooftop_area_sqm=60.0,
        state_code="KA",
    )
    assert res_5_0.eligible is True
    assert res_5_0.subsidy_amount_inr == 78000.0


# -----------------------------------------------------------------------------
# TC-1908: Sizing Constraints & Ineligibility Handling
# -----------------------------------------------------------------------------


def test_tc1908_household_sizing_caps_and_net_metering() -> None:
    assessor = HouseholdPolicyAssessor(PolicyRegistry())

    # Case 1: Rooftop area bottleneck (only 15 sqm shadow-free -> max 1.5 kWp despite 5 kW load)
    res_area_bound = assessor.evaluate_eligibility(
        household_id="h_small_roof",
        sanctioned_load_kw=5.0,
        monthly_kwh=400.0,
        rooftop_area_sqm=15.0,
        state_code="KA",
    )
    assert res_area_bound.eligible is True
    assert res_area_bound.max_subsidized_capacity_kw == 1.50
    assert res_area_bound.subsidy_amount_inr == 45000.0

    # Case 2: Sanctioned load bottleneck (only 2 kW sanctioned load despite 100 sqm roof)
    res_load_bound = assessor.evaluate_eligibility(
        household_id="h_low_load",
        sanctioned_load_kw=2.0,
        monthly_kwh=220.0,
        rooftop_area_sqm=100.0,
        state_code="KA",
    )
    assert res_load_bound.eligible is True
    assert res_load_bound.max_subsidized_capacity_kw == 2.00
    assert res_load_bound.subsidy_amount_inr == 60000.0

    # Case 3: Commercial connection ineligibility
    res_comm = assessor.evaluate_eligibility(
        household_id="comm_shop",
        sanctioned_load_kw=5.0,
        monthly_kwh=600.0,
        rooftop_area_sqm=50.0,
        state_code="KA",
        is_residential=False,
    )
    assert res_comm.eligible is False
    assert res_comm.subsidy_amount_inr == 0.0
    assert "domestic residential" in res_comm.conditions_unmet[0].lower()


# -----------------------------------------------------------------------------
# TC-1909: Sourced Environmental Impact (CEA Emission Factor)
# -----------------------------------------------------------------------------


def test_tc1909_statutory_co2_mitigation_calculation() -> None:
    assessor = HouseholdPolicyAssessor(PolicyRegistry())

    # 3 kW system:
    # Annual solar generation: 3.0 kW * 1450 kWh/kWp = 4,350 kWh
    # Avoided CO2: 4,350 kWh * 0.716 kg CO2/kWh = 3,114.60 kg CO2/year
    res = assessor.evaluate_eligibility(
        household_id="h_green",
        sanctioned_load_kw=3.0,
        monthly_kwh=350.0,
        rooftop_area_sqm=35.0,
        state_code="KA",
    )
    assert res.avoided_co2_kg_per_year == pytest.approx(3114.60, rel=1e-2)
    assert CEA_GRID_EMISSIONS_FACTOR_KG_CO2_PER_KWH == 0.716


# -----------------------------------------------------------------------------
# TC-1910: Server-Side Tenant Authorization
# -----------------------------------------------------------------------------


def test_tc1910_server_side_tenant_authorization() -> None:
    mgr = HouseholdManager()
    service = PolicyIntelligenceService(household_mgr=mgr)

    # 1. Authorized access
    # home_blr_bescom is owned by "user_default"
    res_auth = service.assess_household_eligibility("home_blr_bescom", "user_default")
    assert res_auth.household_id == "home_blr_bescom"
    assert res_auth.eligible is True
    assert res_auth.subsidy_amount_inr == 78000.0

    # 2. Unauthorized access attempt (user_intruder trying to access user_default's property)
    with pytest.raises(PermissionError, match="Access denied: User 'user_intruder' cannot evaluate"):
        service.assess_household_eligibility("home_blr_bescom", "user_intruder")


# -----------------------------------------------------------------------------
# TC-1911: AI Copilot Policy Inquiry & Grounding
# -----------------------------------------------------------------------------


def test_tc1911_ai_copilot_policy_inquiry_and_grounding() -> None:
    mgr = HouseholdManager()
    service = PolicyIntelligenceService(household_mgr=mgr)
    copilot = AICopilotService(household_mgr=mgr, policy_service=service)

    # 1. Intent Classification
    intent = copilot.classify_intent("What is the PM Surya Ghar solar subsidy for my property?")
    assert intent == CopilotIntent.POLICY_INQUIRY

    intent_tgt = copilot.classify_intent("What is the progress on the national NDC non-fossil capacity target?")
    assert intent_tgt == CopilotIntent.POLICY_INQUIRY

    # 2. Direct Tool Execution: check_household_policy_eligibility
    tool_res = copilot.tool_registry.execute(
        "check_household_policy_eligibility",
        {"property_id": "home_blr_bescom"},
        auth_user_id="user_default",
        authorized_property_ids=["home_blr_bescom"],
    )
    assert tool_res.status == ToolExecutionStatus.SUCCESS
    assert tool_res.data["subsidy_amount_inr"] == 78000.0
    assert len(tool_res.evidence_bundle.evidence_items) >= 1

    # 3. Direct Tool Execution: evaluate_policy_progress
    tool_res_prog = copilot.tool_registry.execute(
        "evaluate_policy_progress",
        {"target_id": "TGT-SURYA-GHAR-CAPACITY"},
        auth_user_id="user_default",
        authorized_property_ids=["home_blr_bescom"],
    )
    assert tool_res_prog.status == ToolExecutionStatus.SUCCESS
    assert tool_res_prog.data["current_achieved_value"] == 5.80

    # 4. End-to-End Copilot Query Execution with Grounding Guard
    resp = copilot.answer_query(
        "What is the PM Surya Ghar subsidy for my property?",
        auth_user_id="user_default",
        property_id="home_blr_bescom",
        authorized_property_ids=["home_blr_bescom"],
    )
    assert resp.intent == CopilotIntent.POLICY_INQUIRY
    assert "PM Surya Ghar" in resp.answer_text
    assert "₹78000" in resp.answer_text or "78000" in resp.answer_text
    assert resp.grounding_status == GroundingStatus.GROUNDED_VERIFIED
    assert len(resp.evidence_items) >= 1


# -----------------------------------------------------------------------------
# TC-1912: End-to-End Policy Intelligence Lifecycle
# -----------------------------------------------------------------------------


def test_tc1912_end_to_end_lifecycle() -> None:
    service = PolicyIntelligenceService()

    # Step 1: Policy Catalogue Discovery
    policies = service.list_policies()
    assert len(policies) >= 6

    # Step 2: Target Evaluation
    assessments = service.evaluate_all_targets()
    assert len(assessments) >= 8

    # Step 3: Regulatory Diff Inspection
    diff = service.comparator.compare_pm_surya_ghar_vs_phase2()
    assert len(diff["dimension_comparisons"]) >= 4

    # Step 4: Household Eligibility
    elig = service.assessor.evaluate_eligibility(
        household_id="blr_demo",
        sanctioned_load_kw=4.0,
        monthly_kwh=350.0,
        rooftop_area_sqm=40.0,
        state_code="KA",
    )
    assert elig.eligible is True
    assert elig.subsidy_amount_inr == 78000.0
    assert elig.avoided_co2_kg_per_year > 0.0
