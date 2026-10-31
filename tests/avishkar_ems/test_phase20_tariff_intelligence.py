"""Automated Verification Suite for UrjaSetu EMS Phase 20: Tariff Intelligence & Cost Optimization.

Verifies:
- TC-2001: TariffSlab, FixedChargeRule, and TimeOfUseSlot schema constraints and invariants.
- TC-2002: Statutory Tariff Registry pre-seeding, SHA-256 digests, and multi-filter retrieval.
- TC-2003: Effective-date temporal validity resolution and supersession tracking.
- TC-2004: Deterministic slab-wise energy charge calculation against independent arithmetic cases.
- TC-2005: Fixed charge rules, minimum monthly charge enforcement, and zero-consumption handling.
- TC-2006: Time-of-Use (ToU) diurnal surcharges and off-peak rebates.
- TC-2007: Solar net-metering export compensation and net bill calculation.
- TC-2008: Utility-issued bill validation, component comparison, and discrepancy diagnostics.
- TC-2009: Eligible tariff comparison, cost differential analysis, and consumer category constraint enforcement.
- TC-2010: Time-of-Use load-shifting optimization and energy conservation invariant.
- TC-2011: Server-side multi-tenant authorization enforcement (PermissionError on cross-tenant access).
- TC-2012: AI Energy Copilot intent classification, tool execution, and NumericalGroundingGuard verification.
- TC-2013: End-to-end tariff intelligence lifecycle integration.
"""

from __future__ import annotations

import pytest

from avishkar_ems.ai_copilot import (
    AICopilotService,
    CopilotIntent,
    GroundingStatus,
    ToolExecutionStatus,
)
from avishkar_ems.household_module import (
    HouseholdManager,
    UtilityBillRecord,
)
from avishkar_ems.tariff_intelligence import (
    AuthoritativeTariffEngine,
    BillValidationEngine,
    BillValidationStatus,
    ConsumerCategory,
    FixedChargeRule,
    TariffComparisonEngine,
    TariffIntelligenceService,
    TariffRegistry,
    TariffSlab,
    TariffStructureType,
    TariffVerificationStatus,
    TimeOfUseOptimizer,
    TimeOfUseSlot,
)

# -----------------------------------------------------------------------------
# TC-2001: Tariff Data Contracts & Validation Invariants
# -----------------------------------------------------------------------------


def test_tc2001_tariff_contract_validation_and_invariants() -> None:
    # 1. Valid Slab
    slab = TariffSlab(min_kwh=0.0, max_kwh=100.0, rate_inr_per_kwh=4.75)
    assert slab.min_kwh == 0.0
    assert slab.max_kwh == 100.0
    assert slab.rate_inr_per_kwh == 4.75

    # 2. Invalid Slab Invariants
    with pytest.raises(ValueError, match="min_kwh cannot be negative"):
        TariffSlab(min_kwh=-10.0, max_kwh=100.0, rate_inr_per_kwh=4.75)

    with pytest.raises(ValueError, match="must be greater than min_kwh"):
        TariffSlab(min_kwh=100.0, max_kwh=50.0, rate_inr_per_kwh=4.75)

    with pytest.raises(ValueError, match="rate cannot be negative"):
        TariffSlab(min_kwh=0.0, max_kwh=100.0, rate_inr_per_kwh=-2.0)

    # 3. Fixed Charge Rule Invariants
    fc = FixedChargeRule(fixed_rate_per_kw_month_inr=70.0, minimum_monthly_charge_inr=100.0)
    assert fc.fixed_rate_per_kw_month_inr == 70.0

    with pytest.raises(ValueError, match="fixed_rate_per_kw_month_inr cannot be negative"):
        FixedChargeRule(fixed_rate_per_kw_month_inr=-10.0)

    # 4. TimeOfUseSlot Invariants
    slot = TimeOfUseSlot(slot_name="EVENING_PEAK", start_hour=18, end_hour=22, surcharge_pct=15.0)
    assert slot.start_hour == 18
    assert slot.end_hour == 22

    with pytest.raises(ValueError, match="start_hour must be 0..23"):
        TimeOfUseSlot(slot_name="INVALID", start_hour=25, end_hour=26)

    with pytest.raises(ValueError, match="end_hour .* must be > start_hour"):
        TimeOfUseSlot(slot_name="INVALID", start_hour=18, end_hour=18)


# -----------------------------------------------------------------------------
# TC-2002: Statutory Tariff Registry Pre-Seeding & Retrieval
# -----------------------------------------------------------------------------


def test_tc2002_statutory_tariff_registry_seeding_and_retrieval() -> None:
    registry = TariffRegistry()
    schedules = registry.list_all_schedules()

    # Must have at least 6 verified statutory schedules pre-seeded
    assert len(schedules) >= 6

    # Verify presence of core state schedules
    sched_ids = {s.schedule_id for s in schedules}
    assert "KA_BESCOM_LT2A_2024" in sched_ids
    assert "KA_BESCOM_LT2A_2023" in sched_ids
    assert "KA_BESCOM_LT3A_2024" in sched_ids
    assert "AP_APCPDCL_LT1_2024" in sched_ids
    assert "TN_TANGEDCO_LT1A_2024" in sched_ids
    assert "GUJ_UGVCL_RGP_2024" in sched_ids

    # Inspect official gazette metadata & SHA-256 digest on active BESCOM schedule
    bescom = registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert bescom is not None
    assert bescom.utility_name == "BESCOM"
    assert bescom.jurisdiction == "Karnataka"
    assert bescom.consumer_category == ConsumerCategory.DOMESTIC
    assert len(bescom.document_sha256) == 64
    assert bescom.verification_status == TariffVerificationStatus.OFFICIAL_VERIFIED

    # Multi-dimensional filtering
    ka_tariffs = registry.query_schedules(jurisdiction="Karnataka")
    assert len(ka_tariffs) == 3  # LT-2a 2024, LT-2a 2023, LT-3a 2024

    comm_tariffs = registry.query_schedules(category=ConsumerCategory.COMMERCIAL)
    assert len(comm_tariffs) == 1
    assert comm_tariffs[0].tariff_code == "LT-3(a)"


# -----------------------------------------------------------------------------
# TC-2003: Effective Date Boundary & Supersession Resolution
# -----------------------------------------------------------------------------


def test_tc2003_effective_date_and_supersession() -> None:
    registry = TariffRegistry()

    # Active BESCOM 2024 tariff (effective from 2024-04-01 with no end date)
    active_sched = registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert active_sched is not None
    assert not active_sched.is_effective_on("2024-03-31")  # Prior to enactment
    assert active_sched.is_effective_on("2024-04-01")  # Enactment day
    assert active_sched.is_effective_on("2026-06-01")  # Future active date

    # Historical BESCOM 2023 tariff (effective 2023-04-01 to 2024-03-31)
    hist_sched = registry.get_schedule("KA_BESCOM_LT2A_2023")
    assert hist_sched is not None
    assert hist_sched.verification_status == TariffVerificationStatus.SUPERSEDED
    assert hist_sched.superseded_by_id == "KA_BESCOM_LT2A_2024"
    assert hist_sched.is_effective_on("2023-06-15")
    assert not hist_sched.is_effective_on("2024-05-01")  # Expired

    # Dynamic temporal lookup for active tariff
    resolved_active = registry.get_active_schedule_for_consumer(
        utility_name="BESCOM",
        category=ConsumerCategory.DOMESTIC,
        on_date="2026-01-15",
    )
    assert resolved_active is not None
    assert resolved_active.schedule_id == "KA_BESCOM_LT2A_2024"


# -----------------------------------------------------------------------------
# TC-2004: Deterministic Slab-Wise Energy Charge Calculation
# -----------------------------------------------------------------------------


def test_tc2004_deterministic_slab_calculation_reference_cases() -> None:
    registry = TariffRegistry()
    bescom = registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert bescom is not None

    # Reference Case 1: 50 kWh (Entirely within Tier 1: 0-100 kWh @ ₹4.75)
    # Energy: 50 * 4.75 = 237.50
    # Fixed: 3 kW * 70 = 210.00
    # FAC: 50 * 0.22 = 11.00
    # Tax: 9% of 237.50 = 21.38
    # Gross: 210.00 + 237.50 + 11.00 + 21.38 = ₹479.88
    calc1 = AuthoritativeTariffEngine.calculate_bill(
        consumption_kwh=50.0,
        sanctioned_load_kw=3.0,
        schedule=bescom,
    )
    assert calc1.energy_charges_inr == 237.50
    assert calc1.fixed_charges_inr == 210.00
    assert calc1.fac_charges_inr == 11.00
    assert calc1.tax_and_duty_inr == 21.38
    assert calc1.gross_bill_inr == 479.88
    assert calc1.net_calculated_bill_inr == 479.88
    assert calc1.is_official_bill is False  # Invariant

    # Reference Case 2: 250 kWh (Telescopic: 100 kWh @ ₹4.75 + 150 kWh @ ₹7.00)
    # Tier 1: 100 * 4.75 = 475.00
    # Tier 2: 150 * 7.00 = 1050.00
    # Total Energy: 1525.00
    # Fixed: 3 kW * 70 = 210.00
    # FAC: 250 * 0.22 = 55.00
    # Tax: 9% of 1525.00 = 137.25
    # Gross: 210.00 + 1525.00 + 55.00 + 137.25 = ₹1927.25
    calc2 = AuthoritativeTariffEngine.calculate_bill(
        consumption_kwh=250.0,
        sanctioned_load_kw=3.0,
        schedule=bescom,
    )
    assert calc2.energy_charges_inr == 1525.00
    assert calc2.fixed_charges_inr == 210.00
    assert calc2.fac_charges_inr == 55.00
    assert calc2.tax_and_duty_inr == 137.25
    assert calc2.gross_bill_inr == 1927.25
    assert calc2.net_calculated_bill_inr == 1927.25
    assert len(calc2.breakdown_slabs) == 2
    assert calc2.breakdown_slabs[0]["units_in_slab"] == 100.0
    assert calc2.breakdown_slabs[1]["units_in_slab"] == 150.0


# -----------------------------------------------------------------------------
# TC-2005: Fixed Charges & Minimum Bill Floors
# -----------------------------------------------------------------------------


def test_tc2005_fixed_charges_and_minimum_bill_floor() -> None:
    registry = TariffRegistry()
    bescom = registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert bescom is not None

    # Zero consumption test: should pay fixed charge (or minimum floor)
    # 1 kW load: 1 * 70 = 70. But minimum_monthly_charge_inr = 100.00
    calc_zero = AuthoritativeTariffEngine.calculate_bill(
        consumption_kwh=0.0,
        sanctioned_load_kw=1.0,
        schedule=bescom,
    )
    assert calc_zero.energy_charges_inr == 0.0
    assert calc_zero.fixed_charges_inr == 100.00  # Floor applied
    assert calc_zero.net_calculated_bill_inr == 100.00
    assert calc_zero.effective_rate_per_kwh == 0.0

    # Negative consumption must raise ValueError
    with pytest.raises(ValueError, match="Consumption cannot be negative"):
        AuthoritativeTariffEngine.calculate_bill(
            consumption_kwh=-15.0,
            sanctioned_load_kw=3.0,
            schedule=bescom,
        )

    # Sanctioned load <= 0 must raise ValueError
    with pytest.raises(ValueError, match="Sanctioned load must be positive"):
        AuthoritativeTariffEngine.calculate_bill(
            consumption_kwh=100.0,
            sanctioned_load_kw=0.0,
            schedule=bescom,
        )


# -----------------------------------------------------------------------------
# TC-2006: Time-of-Use Surcharges & Diurnal Rebates
# -----------------------------------------------------------------------------


def test_tc2006_time_of_use_adjustments() -> None:
    registry = TariffRegistry()
    comm_sched = registry.get_schedule("KA_BESCOM_LT3A_2024")
    assert comm_sched is not None
    assert comm_sched.structure_type == TariffStructureType.TIME_OF_DAY

    # Commercial 500 kWh, 10 kW load:
    # Energy: 500 * 8.50 = 4250.00
    # Fixed: 10 * 150 = 1500.00
    # Peak: 100 kWh during EVENING_PEAK (15% surcharge on base 8.50 = 1.275 + 1.00 rate adder = +2.275/kWh -> ₹227.50)
    # Off-peak: 100 kWh during SOLAR_OFF_PEAK (10% rebate on 8.50 = 0.85 + 0.50 rate adder = -1.35/kWh -> -₹135.00)
    # Net ToU adjustment = 227.50 - 135.00 = +₹92.50
    calc = AuthoritativeTariffEngine.calculate_bill(
        consumption_kwh=500.0,
        sanctioned_load_kw=10.0,
        schedule=comm_sched,
        peak_consumption_kwh=100.0,
        off_peak_consumption_kwh=100.0,
    )
    assert calc.energy_charges_inr == 4250.00
    assert calc.fixed_charges_inr == 1500.00
    assert calc.tou_adjustment_inr == 92.50
    assert calc.gross_bill_inr > 5800.00


# -----------------------------------------------------------------------------
# TC-2007: Solar Net-Metering Export Compensation
# -----------------------------------------------------------------------------


def test_tc2007_solar_net_metering_export_offset() -> None:
    registry = TariffRegistry()
    bescom = registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert bescom is not None

    # 250 kWh consumption, 3 kW load, 100 kWh exported solar
    # Gross without solar: ₹1927.25 (from TC-2004)
    # Solar Credit: 100 kWh * ₹3.10/kWh = ₹310.00
    # Net Bill: 1927.25 - 310.00 = ₹1617.25
    calc_solar = AuthoritativeTariffEngine.calculate_bill(
        consumption_kwh=250.0,
        sanctioned_load_kw=3.0,
        schedule=bescom,
        solar_export_kwh=100.0,
    )
    assert calc_solar.solar_export_kwh == 100.0
    assert calc_solar.solar_credit_inr == 310.00
    assert calc_solar.net_calculated_bill_inr == 1617.25


# -----------------------------------------------------------------------------
# TC-2008: Utility Bill Validation & Reconciliation Diagnostics
# -----------------------------------------------------------------------------


def test_tc2008_utility_bill_validation() -> None:
    registry = TariffRegistry()
    bescom = registry.get_schedule("KA_BESCOM_LT2A_2024")
    assert bescom is not None

    # 1. Exact Match Bill
    # Create bill record matching 250 kWh calculation (₹1927.25)
    exact_bill = UtilityBillRecord(
        bill_month="2026-03",
        bill_date="2026-03-15",
        units_consumed_kwh=250.0,
        total_amount_inr=1927.25,
        fixed_charge_inr=210.0,
        energy_charge_inr=1525.0,
        tax_and_duty_inr=137.25,
        bill_id="bill_test_exact",
    )
    res_exact = BillValidationEngine.validate_bill(
        bill=exact_bill,
        sanctioned_load_kw=3.0,
        schedule=bescom,
    )
    assert res_exact.validation_status == BillValidationStatus.EXACT_MATCH
    assert res_exact.absolute_difference_inr == 0.0

    # 2. Explained Discrepancy (e.g. minor ₹30 variance from FAC or rounding)
    explained_bill = UtilityBillRecord(
        bill_month="2026-03",
        bill_date="2026-03-15",
        units_consumed_kwh=250.0,
        total_amount_inr=1950.00,  # ₹22.75 higher
        fixed_charge_inr=210.0,
        energy_charge_inr=1525.0,
        tax_and_duty_inr=137.25,
        bill_id="bill_test_explained",
    )
    res_expl = BillValidationEngine.validate_bill(
        bill=explained_bill,
        sanctioned_load_kw=3.0,
        schedule=bescom,
    )
    assert res_expl.validation_status == BillValidationStatus.DISCREPANCY_EXPLAINED

    # 3. Unresolved Discrepancy (large unexplained variance e.g. ₹500)
    unresolved_bill = UtilityBillRecord(
        bill_month="2026-03",
        bill_date="2026-03-15",
        units_consumed_kwh=250.0,
        total_amount_inr=2500.00,
        fixed_charge_inr=210.0,
        energy_charge_inr=1525.0,
        tax_and_duty_inr=137.25,
        bill_id="bill_test_unresolved",
    )
    res_unres = BillValidationEngine.validate_bill(
        bill=unresolved_bill,
        sanctioned_load_kw=3.0,
        schedule=bescom,
    )
    assert res_unres.validation_status == BillValidationStatus.UNRESOLVED_DISCREPANCY
    assert res_unres.absolute_difference_inr > 500.0


# -----------------------------------------------------------------------------
# TC-2009: Eligible Tariff Comparison & Economics Matrix
# -----------------------------------------------------------------------------


def test_tc2009_tariff_comparison_and_category_eligibility() -> None:
    registry = TariffRegistry()
    bescom_24 = registry.get_schedule("KA_BESCOM_LT2A_2024")
    bescom_23 = registry.get_schedule("KA_BESCOM_LT2A_2023")
    bescom_comm = registry.get_schedule("KA_BESCOM_LT3A_2024")
    assert bescom_24 is not None and bescom_23 is not None and bescom_comm is not None

    # 1. Comparison of 2024 vs 2023 historical for 300 kWh
    comp_hist = TariffComparisonEngine.compare_tariffs(
        base_schedule=bescom_24,
        comparison_schedule=bescom_23,
        consumption_kwh=300.0,
        sanctioned_load_kw=3.0,
        consumer_actual_category=ConsumerCategory.DOMESTIC,
    )
    assert comp_hist.base_tariff_id == "KA_BESCOM_LT2A_2024"
    assert comp_hist.comparison_tariff_id == "KA_BESCOM_LT2A_2023"
    # 2023 tariff is superseded, so eligibility should be flagged
    assert not comp_hist.eligibility_verified
    assert any("superseded" in r.lower() for r in comp_hist.ineligible_reasons)

    # 2. Comparison with Commercial tariff for Domestic consumer
    comp_comm = TariffComparisonEngine.compare_tariffs(
        base_schedule=bescom_24,
        comparison_schedule=bescom_comm,
        consumption_kwh=300.0,
        sanctioned_load_kw=3.0,
        consumer_actual_category=ConsumerCategory.DOMESTIC,
    )
    assert not comp_comm.eligibility_verified
    assert any("category mismatch" in r.lower() for r in comp_comm.ineligible_reasons)
    # Commercial tariff is significantly more expensive
    assert comp_comm.cost_difference_inr > 0


# -----------------------------------------------------------------------------
# TC-2010: Time-of-Use Demand Optimization & Energy Conservation
# -----------------------------------------------------------------------------


def test_tc2010_time_of_use_demand_optimization() -> None:
    registry = TariffRegistry()
    comm_sched = registry.get_schedule("KA_BESCOM_LT3A_2024")
    assert comm_sched is not None

    # Shift 80 kWh from evening peak to solar off-peak on 500 kWh total
    opt_res = TimeOfUseOptimizer.evaluate_load_shift(
        property_id="home_blr_bescom",
        total_kwh=500.0,
        sanctioned_load_kw=5.0,
        schedule=comm_sched,
        shift_kwh=80.0,
    )
    assert opt_res.is_feasible is True
    assert opt_res.total_consumption_kwh == 500.0  # Invariant: energy conserved
    assert opt_res.shifted_kwh == 80.0
    assert opt_res.net_savings_inr > 0  # Peak avoidance + off-peak rebate saves money
    assert opt_res.percentage_savings > 0


# -----------------------------------------------------------------------------
# TC-2011: Server-Side Multi-Tenant Authorization Enforcement
# -----------------------------------------------------------------------------


def test_tc2011_server_side_tenant_authorization() -> None:
    mgr = HouseholdManager()
    service = TariffIntelligenceService(household_mgr=mgr)

    # Add a bill to home_blr_bescom (owned by "user_default")
    profile = mgr.get_profile("home_blr_bescom")
    assert profile is not None
    test_bill = UtilityBillRecord(
        bill_month="2026-03",
        bill_date="2026-03-15",
        units_consumed_kwh=250.0,
        total_amount_inr=1927.25,
        fixed_charge_inr=210.0,
        energy_charge_inr=1525.0,
        bill_id="bill_auth_test_1",
    )
    profile.bills.append(test_bill)

    # 1. Authorized owner query
    val_ok = service.validate_property_bill(
        property_id="home_blr_bescom",
        bill_id="bill_auth_test_1",
        auth_user_id="user_default",
        authorized_property_ids=["home_blr_bescom"],
    )
    assert val_ok.bill_id == "bill_auth_test_1"

    # 2. Unauthorized cross-tenant query must raise PermissionError
    with pytest.raises(PermissionError, match="Access denied: User 'user_intruder_99'"):
        service.validate_property_bill(
            property_id="home_blr_bescom",
            bill_id="bill_auth_test_1",
            auth_user_id="user_intruder_99",
            authorized_property_ids=["home_intruder_prop"],
        )


# -----------------------------------------------------------------------------
# TC-2012: AI Copilot Tariff Tool Integration & Grounding Guard
# -----------------------------------------------------------------------------


def test_tc2012_ai_copilot_tariff_comparison_and_grounding() -> None:
    mgr = HouseholdManager()
    service = TariffIntelligenceService(household_mgr=mgr)
    copilot = AICopilotService(household_mgr=mgr, tariff_service=service)

    # 1. Intent Classification
    intent = copilot.classify_intent("Can you compare tariffs between BESCOM 2024 and 2023?")
    assert intent == CopilotIntent.TARIFF_COMPARISON

    # 2. Tool Execution: get_verified_tariffs
    tool_res_list = copilot.tool_registry.execute(
        "get_verified_tariffs",
        {"jurisdiction": "Karnataka"},
        auth_user_id="user_default",
        authorized_property_ids=["home_blr_bescom"],
    )
    assert tool_res_list.status == ToolExecutionStatus.SUCCESS
    assert tool_res_list.data["schedule_count"] >= 3
    assert len(tool_res_list.evidence_bundle.evidence_items) >= 1

    # 3. Tool Execution: compare_eligible_tariffs
    tool_res_comp = copilot.tool_registry.execute(
        "compare_eligible_tariffs",
        {
            "base_tariff_id": "KA_BESCOM_LT2A_2024",
            "comparison_tariff_id": "KA_BESCOM_LT2A_2023",
            "consumption_kwh": 250.0,
            "sanctioned_load_kw": 3.0,
        },
        auth_user_id="user_default",
        authorized_property_ids=["home_blr_bescom"],
    )
    assert tool_res_comp.status == ToolExecutionStatus.SUCCESS
    assert "cost_difference_inr" in tool_res_comp.data
    assert len(tool_res_comp.evidence_bundle.evidence_items) >= 1

    # 4. End-to-End Copilot Query Execution with Grounding Guard
    resp = copilot.answer_query(
        "Compare tariff options for 250 units consumption",
        auth_user_id="user_default",
        property_id="home_blr_bescom",
        authorized_property_ids=["home_blr_bescom"],
    )
    assert resp.intent == CopilotIntent.TARIFF_COMPARISON
    assert "Tariff Comparison" in resp.answer_text
    assert resp.grounding_status == GroundingStatus.GROUNDED_VERIFIED
    assert len(resp.evidence_items) >= 1


# -----------------------------------------------------------------------------
# TC-2013: End-to-End Tariff Intelligence Lifecycle
# -----------------------------------------------------------------------------


def test_tc2013_end_to_end_tariff_lifecycle() -> None:
    mgr = HouseholdManager()
    service = TariffIntelligenceService(household_mgr=mgr)

    # 1. Query Registry
    tariffs = service.list_tariffs(jurisdiction="Karnataka")
    assert len(tariffs) >= 3

    # 2. Calculate Bill
    calc = service.calculate_bill(
        consumption_kwh=320.0,
        sanctioned_load_kw=4.0,
        schedule_id="KA_BESCOM_LT2A_2024",
        solar_export_kwh=50.0,
    )
    assert calc.net_calculated_bill_inr > 0
    assert calc.solar_credit_inr == 155.0  # 50 * 3.10

    # 3. Compare Tariffs
    comp = service.compare_tariffs(
        base_tariff_id="KA_BESCOM_LT2A_2024",
        comparison_tariff_id="AP_APCPDCL_LT1_2024",
        consumption_kwh=320.0,
        sanctioned_load_kw=4.0,
    )
    assert comp.base_cost_inr > 0
    assert comp.comparison_cost_inr > 0

    # 4. Optimize ToU
    tou = service.optimize_tou(
        property_id="home_blr_bescom",
        total_kwh=500.0,
        sanctioned_load_kw=5.0,
        schedule_id="KA_BESCOM_LT3A_2024",
        shift_kwh=60.0,
    )
    assert tou.net_savings_inr > 0
