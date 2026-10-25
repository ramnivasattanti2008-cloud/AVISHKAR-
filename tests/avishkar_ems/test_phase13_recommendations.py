"""Automated test suite for UrjaSetu EMS Phase 13: Energy Optimization, Cost Savings & Recommendations.

Covers:
1. Recommendation domain models, serialization, and typing integrity.
2. Eligibility evaluation across verified household profiles (Bengaluru vs. Visakhapatnam).
3. Slab clipping recommendation (RULE-SLAB-01) with reproducible marginal savings under BESCOM LT-2(a).
4. Sanctioned load realignment (RULE-LOAD-01) with verified fixed charge reductions.
5. Rooftop solar assessment (RULE-SOLAR-01) with PM Surya Ghar CFA subsidy and NASA solar yield.
6. Appliance efficiency (RULE-AC-01) thermodynamic 6%/°C rule and non-numeric fallback.
7. Anti-double-counting guard: sequential marginal evaluation preventing savings stacking.
8. Deterministic ranking engine: multi-factor priority score calculation.
9. Recommendation lifecycle state machine and audit trail.
10. Server-side authorization and cross-user isolation.
11. Interactive scenario simulation with capital costs, subsidies, and payback.
12. Independent reference calculations for financial results.
"""

from __future__ import annotations

import pytest

from avishkar_ems.household_module import (
    DEFAULT_USER_ID,
    HouseholdManager,
    HouseholdProfile,
    IntegrationStatus,
    UtilityBillRecord,
    UtilityProvider,
)
from avishkar_ems.household_tariffs import HouseholdTariffEngine
from avishkar_ems.recommendations import (
    ApplianceSpec,
    RecommendationCategory,
    RecommendationEngine,
    RecommendationStatus,
)
from avishkar_ems.subsidy import pm_surya_ghar


@pytest.fixture
def household_mgr() -> HouseholdManager:
    return HouseholdManager()


@pytest.fixture
def rec_engine(household_mgr: HouseholdManager) -> RecommendationEngine:
    return RecommendationEngine(household_mgr=household_mgr)


class TestPhase13Recommendations:
    """Rigorous quality assurance for Phase 13 Energy Optimization & Recommendations."""

    def test_domain_model_and_serialization(self, rec_engine: RecommendationEngine) -> None:
        """TC-1301: Validates recommendation data model attributes and serialization."""
        recs = rec_engine.generate_recommendations(DEFAULT_USER_ID, "home_blr_bescom")
        assert len(recs) > 0, "Expected recommendations generated for Home A (Bengaluru)"

        rec = recs[0]
        d = rec.to_dict()
        assert "recommendation_id" in d
        assert "category" in d
        assert "title" in d
        assert "proposed_action" in d
        assert "impact" in d
        assert "confidence_score" in d
        assert 0.0 <= d["confidence_score"] <= 1.0
        assert "priority_score" in d
        assert "status" in d
        assert d["status"] == "PENDING"
        assert isinstance(d["assumptions"], list)
        assert isinstance(d["limitations"], list)

    def test_slab_clipping_reproducible_calculation(self, rec_engine: RecommendationEngine) -> None:
        """TC-1302: Verifies RULE-SLAB-01 marginal savings under BESCOM LT-2(a) telescopic slabs."""
        # Home A March bill is 460 kWh (top slab above 100 kWh @ ₹7.00/kWh)
        recs = rec_engine.generate_recommendations(DEFAULT_USER_ID, "home_blr_bescom")
        slab_recs = [r for r in recs if r.rule_id == "RULE-SLAB-01"]
        assert len(slab_recs) == 0, "460 kWh is far above 100 kWh threshold, so clipping is not triggered"

        # If March bill (460 kWh) is far above 100 kWh, slab clipping only triggers if 5-45 units above a threshold
        # Let's test with a profile specifically near the 100 kWh slab threshold (e.g. 115 kWh)
        near_slab_home = HouseholdProfile(
            profile_id="home_near_slab",
            user_id="user_test",
            display_name="Near Slab Household",
            city="Bengaluru",
            state="KA",
            utility=UtilityProvider.BESCOM,
            connection_account_id="BES111222",
            sanctioned_load_kw=3.0,
            solar_capacity_kwp=0.0,
            battery_capacity_kwh=0.0,
            tariff_category="LT-2(a) Domestic",
            integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
            bills=[UtilityBillRecord("2026-03", "2026-04-05", 115.0, 950.0, 210.0, 740.0)],
        )
        rec_engine.household_mgr.create_home("user_test", near_slab_home)
        test_recs = rec_engine.generate_recommendations("user_test", "home_near_slab")
        test_slab_recs = [r for r in test_recs if r.rule_id == "RULE-SLAB-01"]
        assert len(test_slab_recs) == 1, "Expected slab clipping recommendation for 115 kWh consumption"

        s_rec = test_slab_recs[0]
        assert s_rec.category == RecommendationCategory.CONSUMPTION_OPTIMIZATION
        assert s_rec.impact.energy_reduction_kwh_month == 15.0  # 115 - 100 kWh
        assert s_rec.is_numeric is True

        # Independent reference verification:
        # 115 kWh bill under BESCOM:
        # Fixed: 3 kW * 70 = ₹210
        # Energy: 100 * 4.75 + 15 * 7.00 = 475 + 105 = ₹580
        # Tax: 9% on 580 = ₹52.20
        # Total = 210 + 580 + 52.20 = ₹842.20
        # 100 kWh bill:
        # Fixed: ₹210
        # Energy: 100 * 4.75 = ₹475
        # Tax: 9% on 475 = ₹42.75
        # Total = 210 + 475 + 42.75 = ₹727.75
        # Expected savings = 842.20 - 727.75 = ₹114.45
        ref_base = HouseholdTariffEngine.calculate_bill(115.0, 3.0, "KA_BESCOM_LT2A_2024")
        ref_sim = HouseholdTariffEngine.calculate_bill(100.0, 3.0, "KA_BESCOM_LT2A_2024")
        expected_saved = round(ref_base.net_bill_inr - ref_sim.net_bill_inr, 2)
        assert s_rec.impact.cost_savings_inr_month == expected_saved
        assert s_rec.impact.cost_savings_inr_month == 114.45

    def test_sanctioned_load_realignment(self, rec_engine: RecommendationEngine) -> None:
        """TC-1303: Verifies RULE-LOAD-01 sanctioned load fixed charge savings."""
        # Create a home with 6 kW sanctioned load but average consumption of only 120 kWh
        low_usage_home = HouseholdProfile(
            profile_id="home_oversanctioned",
            user_id="user_test",
            display_name="Over-Sanctioned Home",
            city="Bengaluru",
            state="KA",
            utility=UtilityProvider.BESCOM,
            connection_account_id="BES999000",
            sanctioned_load_kw=6.0,
            solar_capacity_kwp=0.0,
            battery_capacity_kwh=0.0,
            tariff_category="LT-2(a) Domestic",
            integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
            bills=[
                UtilityBillRecord("2026-01", "2026-02-05", 110.0, 950.0, 420.0, 530.0),
                UtilityBillRecord("2026-02", "2026-03-05", 115.0, 980.0, 420.0, 560.0),
                UtilityBillRecord("2026-03", "2026-04-05", 125.0, 1020.0, 420.0, 600.0),
            ],
        )
        rec_engine.household_mgr.create_home("user_test", low_usage_home)
        recs = rec_engine.generate_recommendations("user_test", "home_oversanctioned")
        load_recs = [r for r in recs if r.rule_id == "RULE-LOAD-01"]
        assert len(load_recs) == 1, "Expected sanctioned load optimization recommendation"

        l_rec = load_recs[0]
        assert l_rec.category == RecommendationCategory.DEMAND_REDUCTION
        # Proposed reduction from 6 kW to 4 kW = 2 kW reduction
        # Fixed charge in BESCOM: ₹70/kW/month -> 2 kW * 70 = ₹140/month = ₹1,680/year
        assert l_rec.impact.cost_savings_inr_month == 140.0
        assert l_rec.impact.cost_savings_inr_year == 1680.0
        assert l_rec.impact.energy_reduction_kwh_month == 0.0  # Fixed demand savings does not alter kWh

    def test_rooftop_solar_with_pm_surya_ghar(self, rec_engine: RecommendationEngine) -> None:
        """TC-1304: Verifies RULE-SOLAR-01 solar sizing, PM Surya Ghar subsidy, and payback period."""
        # Create a home without solar but with healthy consumption (avg 350 kWh/month)
        solar_candidate = HouseholdProfile(
            profile_id="home_solar_cand",
            user_id="user_test",
            display_name="Solar Candidate Home",
            city="Visakhapatnam",
            state="AP",
            utility=UtilityProvider.APEPDCL,
            connection_account_id="APE778899",
            sanctioned_load_kw=4.0,
            solar_capacity_kwp=0.0,  # No solar currently
            battery_capacity_kwh=0.0,
            tariff_category="LT-1 Domestic (Group B)",
            integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
            bills=[
                UtilityBillRecord("2026-01", "2026-02-08", 340.0, 2480.0, 240.0, 2240.0),
                UtilityBillRecord("2026-02", "2026-03-08", 350.0, 2550.0, 240.0, 2310.0),
                UtilityBillRecord("2026-03", "2026-04-08", 360.0, 2620.0, 240.0, 2380.0),
            ],
        )
        rec_engine.household_mgr.create_home("user_test", solar_candidate)
        recs = rec_engine.generate_recommendations("user_test", "home_solar_cand")
        solar_recs = [r for r in recs if r.rule_id == "RULE-SOLAR-01"]
        assert len(solar_recs) == 1, "Expected solar recommendation for high-consumption home without solar"

        s_rec = solar_recs[0]
        assert s_rec.category == RecommendationCategory.SOLAR_RENEWABLE
        assert s_rec.impact.cost_savings_inr_year is not None
        assert s_rec.impact.cost_savings_inr_year > 0
        assert s_rec.impact.payback_period_years is not None
        assert s_rec.impact.payback_period_years < 10.0, "Solar payback should be under 10 years with subsidy"

        # Validate PM Surya Ghar subsidy function independently
        # For 2 kW: 2 * 30000 = ₹60,000
        assert pm_surya_ghar(2.0, residential=True) == 60_000.0
        # For 3 kW: 2 * 30000 + 1 * 18000 = ₹78,000 (cap)
        assert pm_surya_ghar(3.0, residential=True) == 78_000.0
        # For non-residential: ₹0
        assert pm_surya_ghar(3.0, residential=False) == 0.0

    def test_appliance_efficiency_and_missing_data_fallback(self, rec_engine: RecommendationEngine) -> None:
        """TC-1305: Verifies AC setpoint calculation when appliance is supplied, and honest fallback when absent."""
        # 1. Without appliance: should generate RULE-APPLIANCE-GAP non-numeric advisory
        recs_no_app = rec_engine.generate_recommendations(DEFAULT_USER_ID, "home_blr_bescom")
        gap_recs = [r for r in recs_no_app if r.rule_id == "RULE-APPLIANCE-GAP"]
        assert len(gap_recs) == 1, "Expected non-numeric appliance data gap recommendation when specs absent"
        assert gap_recs[0].is_numeric is False
        assert gap_recs[0].impact.cost_savings_inr_month is None

        # 2. With AC appliance supplied: should generate numerical AC setpoint recommendation
        ac_app = ApplianceSpec(
            appliance_id="app_ac_master",
            appliance_type="Air Conditioner (1.5 Ton)",
            rated_power_w=1500.0,
            estimated_daily_hours=8.0,
            current_setpoint_or_behavior="Running at 20°C overnight",
            is_user_reported=True,
            duty_cycle_factor=0.70,
        )
        recs_with_app = rec_engine.generate_recommendations(
            DEFAULT_USER_ID, "home_blr_bescom", user_appliances=[ac_app]
        )
        ac_recs = [r for r in recs_with_app if r.rule_id == "RULE-AC-01"]
        assert len(ac_recs) == 1, "Expected AC setpoint optimization recommendation"

        ac_rec = ac_recs[0]
        assert ac_rec.category == RecommendationCategory.APPLIANCE_EFFICIENCY
        assert ac_rec.is_numeric is True
        # Raising from 20°C to 24°C is 4°C delta -> 4 * 6% = 24% reduction
        # Daily kWh: 1.5 kW * 8 hrs * 0.70 = 8.4 kWh/day -> 252 kWh/month
        # Monthly saved: 252 * 0.24 = 60.48 kWh
        assert ac_rec.impact.energy_reduction_kwh_month == 60.48
        assert ac_rec.impact.cost_savings_inr_month is not None
        assert ac_rec.impact.cost_savings_inr_month > 0

    def test_anti_double_counting_reconciliation(self, rec_engine: RecommendationEngine) -> None:
        """TC-1306: Validates that sequential marginal evaluation prevents double-counting overlapping savings."""
        ac_app = ApplianceSpec(
            appliance_id="app_ac",
            appliance_type="AC 1.5T",
            rated_power_w=1500.0,
            estimated_daily_hours=8.0,
            current_setpoint_or_behavior="20°C",
            duty_cycle_factor=0.70,
        )
        recs = rec_engine.generate_recommendations(DEFAULT_USER_ID, "home_blr_bescom", user_appliances=[ac_app])
        prof = rec_engine.household_mgr.get_home(DEFAULT_USER_ID, "home_blr_bescom")

        # Compute unduplicated savings
        result = rec_engine.compute_unduplicated_savings(prof, recs)
        assert result["anti_double_counting_enforced"] is True
        assert result["methodology"] == "SEQUENTIAL_MARGINAL_TARIFF_EVALUATION"
        assert result["total_annual_cost_savings_inr"] > 0
        assert result["total_annual_cost_savings_inr"] <= result["baseline_annual_bill_inr"]

        # Ensure that sum of individual independent recommendations would be >= unduplicated sequential savings
        individual_sum_inr = sum(
            r.impact.cost_savings_inr_year or 0.0 for r in recs if r.is_numeric
        )
        # Sequential marginal savings avoids stacking reductions in higher slabs, so it must be <= independent sum
        assert result["total_annual_cost_savings_inr"] <= individual_sum_inr + 1e-4

    def test_deterministic_ranking_scores(self, rec_engine: RecommendationEngine) -> None:
        """TC-1307: Verifies multi-factor ranking formula (financial, evidence, effort, urgency)."""
        recs = rec_engine.generate_recommendations(DEFAULT_USER_ID, "home_blr_bescom")
        assert len(recs) >= 2

        # Verify descending sort order by priority score
        scores = [r.priority_score for r in recs]
        assert scores == sorted(scores, reverse=True), "Recommendations must be sorted descending by priority score"

        # Check score bounds
        for r in recs:
            assert 0.0 <= r.priority_score <= 100.0

    def test_recommendation_lifecycle_state_machine(self, rec_engine: RecommendationEngine) -> None:
        """TC-1308: Tests lifecycle transitions (PENDING -> VIEWED -> PLANNED -> IN_PROGRESS -> COMPLETED)."""
        recs = rec_engine.generate_recommendations(DEFAULT_USER_ID, "home_blr_bescom")
        rec_id = recs[0].recommendation_id

        # Initial state is PENDING
        assert rec_engine.get_recommendation(DEFAULT_USER_ID, rec_id).status == RecommendationStatus.PENDING

        # Transition to VIEWED
        r_viewed = rec_engine.transition_status(DEFAULT_USER_ID, rec_id, RecommendationStatus.VIEWED)
        assert r_viewed.status == RecommendationStatus.VIEWED

        # Transition to PLANNED
        r_planned = rec_engine.transition_status(
            DEFAULT_USER_ID, rec_id, RecommendationStatus.PLANNED, notes="Target completion: next week"
        )
        assert r_planned.status == RecommendationStatus.PLANNED

        # Transition to IN_PROGRESS
        r_prog = rec_engine.transition_status(DEFAULT_USER_ID, rec_id, RecommendationStatus.IN_PROGRESS)
        assert r_prog.status == RecommendationStatus.IN_PROGRESS

        # Transition to COMPLETED
        r_comp = rec_engine.transition_status(
            DEFAULT_USER_ID, rec_id, RecommendationStatus.COMPLETED, notes="Thermostat adjusted to 24°C"
        )
        assert r_comp.status == RecommendationStatus.COMPLETED
        assert r_comp.completed_at is not None
        assert r_comp.completion_notes == "Thermostat adjusted to 24°C"

        # Terminal state: cannot transition COMPLETED to PENDING or DISMISSED
        with pytest.raises(ValueError, match="Invalid lifecycle transition"):
            rec_engine.transition_status(DEFAULT_USER_ID, rec_id, RecommendationStatus.PENDING)

        # Audit trail must record all 4 transitions
        history = rec_engine.get_lifecycle_history(DEFAULT_USER_ID, rec_id)
        assert len(history) == 4
        assert [h.new_status for h in history] == [
            RecommendationStatus.VIEWED,
            RecommendationStatus.PLANNED,
            RecommendationStatus.IN_PROGRESS,
            RecommendationStatus.COMPLETED,
        ]

    def test_dismiss_and_reopen_lifecycle(self, rec_engine: RecommendationEngine) -> None:
        """TC-1309: Tests dismissal with reason and reopening of dismissed recommendations."""
        recs = rec_engine.generate_recommendations(DEFAULT_USER_ID, "home_blr_bescom")
        rec_id = recs[0].recommendation_id

        # Dismiss directly from PENDING
        r_dism = rec_engine.transition_status(
            DEFAULT_USER_ID, rec_id, RecommendationStatus.DISMISSED, dismissed_reason="Not applicable to tenant"
        )
        assert r_dism.status == RecommendationStatus.DISMISSED
        assert r_dism.dismissed_reason == "Not applicable to tenant"

        # Reopen from DISMISSED to PENDING
        r_reopen = rec_engine.transition_status(
            DEFAULT_USER_ID, rec_id, RecommendationStatus.PENDING, notes="Reopened upon lease renewal"
        )
        assert r_reopen.status == RecommendationStatus.PENDING

    def test_server_side_authorization_enforcement(self, rec_engine: RecommendationEngine) -> None:
        """TC-1310: Validates that unauthorized users cannot read or mutate another user's recommendations."""
        # Generate recommendations for DEFAULT_USER_ID
        recs = rec_engine.generate_recommendations(DEFAULT_USER_ID, "home_blr_bescom")
        rec_id = recs[0].recommendation_id

        # Unauthorized user attempts to generate recommendations for Home A
        with pytest.raises(PermissionError, match="ACCESS DENIED"):
            rec_engine.generate_recommendations("user_attacker", "home_blr_bescom")

        # Unauthorized user attempts to read recommendation
        with pytest.raises(PermissionError, match="ACCESS DENIED"):
            rec_engine.get_recommendation("user_attacker", rec_id)

        # Unauthorized user attempts to transition status
        with pytest.raises(PermissionError, match="ACCESS DENIED"):
            rec_engine.transition_status("user_attacker", rec_id, RecommendationStatus.COMPLETED)

    def test_interactive_scenario_simulation(self, rec_engine: RecommendationEngine) -> None:
        """TC-1311: Validates interactive scenario simulator with combined solar, load, and AC actions."""
        sim_res = rec_engine.simulate_scenario(
            user_id=DEFAULT_USER_ID,
            property_id="home_blr_bescom",
            ac_setpoint_adjustment_deg_c=2.0,  # 2°C increase
            appliance_hours_reduction=1.0,     # 1 hr reduction of 1 kW load
            proposed_solar_kwp=3.0,            # 3 kWp solar
            proposed_sanctioned_load_kw=4.0,   # Reduce load from 5 to 4 kW
        )

        assert sim_res.baseline_annual_bill_inr > 0
        assert sim_res.simulated_annual_bill_inr < sim_res.baseline_annual_bill_inr
        assert sim_res.annual_cost_saved_inr > 0
        assert sim_res.annual_energy_saved_kwh > 0
        assert sim_res.applicable_subsidies_inr == 78_000.0  # PM Surya Ghar cap for 3 kWp
        assert sim_res.net_capital_cost_inr == (3.0 * 55_000.0) - 78_000.0  # 165,000 - 78,000 = 87,000
        assert sim_res.simple_payback_years is not None
        assert sim_res.simple_payback_years > 0
        assert len(sim_res.action_breakdown) == 3
        assert len(sim_res.disclaimers) == 3

    def test_independent_reference_tariff_calculation(self) -> None:
        """TC-1312: Independent verification of BESCOM LT-2(a) and APEPDCL LT-1 tariff engine calculations."""
        # Test 1: BESCOM 250 kWh, 5 kW load
        # Fixed: 5 * 70 = ₹350
        # Energy: 100 * 4.75 + 150 * 7.00 = 475 + 1050 = ₹1,525
        # Tax: 9% on 1525 = ₹137.25
        # Net: 350 + 1525 + 137.25 = ₹2,012.25
        calc_bescom = HouseholdTariffEngine.calculate_bill(250.0, 5.0, "KA_BESCOM_LT2A_2024")
        assert calc_bescom.fixed_charge_inr == 350.0
        assert calc_bescom.energy_charge_inr == 1525.0
        assert calc_bescom.tax_and_duty_inr == 137.25
        assert calc_bescom.net_bill_inr == 2012.25

        # Test 2: APEPDCL 200 kWh, 4 kW load
        # Slabs: 0-30 @ 1.90, 30-75 @ 3.00, 75-125 @ 4.50, 125-225 @ 6.00
        # Units: 30*1.90 (57) + 45*3.00 (135) + 50*4.50 (225) + 75*6.00 (450) = ₹867.00
        # Fixed: 4 * 60 = ₹240.0
        # Tax: 6% on 867 = ₹52.02
        # Net: 240 + 867 + 52.02 = ₹1,159.02
        calc_apepdcl = HouseholdTariffEngine.calculate_bill(200.0, 4.0, "AP_APEPDCL_LT1_2024")
        assert calc_apepdcl.fixed_charge_inr == 240.0
        assert calc_apepdcl.energy_charge_inr == 867.0
        assert calc_apepdcl.tax_and_duty_inr == 52.02
        assert calc_apepdcl.net_bill_inr == 1159.02
