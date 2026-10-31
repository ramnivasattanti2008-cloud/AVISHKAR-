"""Tests for risk-aware robust optimisation and replanning trigger."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from avishkar_ems.planner import DayPlan
from avishkar_ems.reserve import ReserveDecision
from avishkar_ems.risk_optim import (
    STANDARD_SCENARIOS,
    ReplanningTrigger,
    build_scenarios,
    evaluate_scenarios,
    plan_risk_aware,
)
from avishkar_ems.site import SiteSpec
from avishkar_ems.tariffs import Tariff


@pytest.fixture
def mock_site() -> SiteSpec:
    tariff = Tariff(
        tou_blocks=((0.0, 24.0, 7.0),),
        export_rate=3.0,
        p2p_charges=0.5,
        shortfall_penalty=10.0,
    )
    return SiteSpec(
        site_id="test_site",
        lat=12.97,
        lon=77.59,
        dc_kwp=10.0,
        ac_kw=10.0,
        tilt=15.0,
        azimuth=180.0,
        battery_kwh=15.0,
        battery_kw=5.0,
        critical_kw=1.0,
        backup_hours=4.0,
        system_cost_inr=500_000.0,
        wear_inr_per_kwh=0.5,
        tariff=tariff,
        dod=0.90,
        round_trip_eff=0.90,
    )


@pytest.fixture
def mock_bands() -> tuple[pd.DataFrame, pd.DataFrame]:
    idx = pd.date_range("2026-06-01 00:00", periods=96, freq="15min")
    pv_df = pd.DataFrame(
        {
            "p10": np.full(96, 2.0),
            "p50": np.full(96, 5.0),
            "p90": np.full(96, 8.0),
        },
        index=idx,
    )
    load_df = pd.DataFrame(
        {
            "p10": np.full(96, 1.0),
            "p50": np.full(96, 3.0),
            "p90": np.full(96, 6.0),
        },
        index=idx,
    )
    return pv_df, load_df


@pytest.fixture
def mock_plan(mock_bands: tuple[pd.DataFrame, pd.DataFrame]) -> DayPlan:
    pv_df, _ = mock_bands
    idx = pv_df.index
    steps = pd.DataFrame(index=idx)
    steps["pv_p10"] = 2.0
    steps["pv_p50"] = 5.0
    steps["pv_p90"] = 8.0
    steps["load_p10"] = 1.0
    steps["load_p50"] = 3.0
    steps["load_p90"] = 6.0
    steps["batt_kw"] = 1.0  # gentle discharge
    steps["grid_kw"] = 0.0
    steps["soc"] = 0.5
    steps["import_rate"] = 7.0
    steps["export_rate"] = 3.0
    steps["prod_price_used"] = 3.0
    rsv = ReserveDecision(floor_soc=0.2, required_kwh=3.0, risk=0.5, feasible=True, reason="test")
    return DayPlan(steps=steps, floor_soc=0.2, reserve=rsv, status="Optimal")


def test_build_scenarios(mock_bands):
    pv_df, load_df = mock_bands
    scenarios = build_scenarios(pv_df, load_df)
    assert len(scenarios) == len(STANDARD_SCENARIOS)
    assert "baseline" in scenarios
    assert "combined_adverse" in scenarios

    base_pv, base_ld = scenarios["baseline"]
    assert float(base_pv.iloc[0]) == 5.0
    assert float(base_ld.iloc[0]) == 3.0

    adv_pv, adv_ld = scenarios["combined_adverse"]
    assert float(adv_pv.iloc[0]) == 2.0
    assert float(adv_ld.iloc[0]) == 6.0


def test_evaluate_scenarios_ranking(mock_plan, mock_site, mock_bands):
    pv_df, load_df = mock_bands
    import_rate = np.full(96, 7.0)
    export_rate = np.full(96, 3.0)

    assessment = evaluate_scenarios(
        plan=mock_plan,
        site=mock_site,
        pv_bands=pv_df,
        load_bands=load_df,
        import_rate=import_rate,
        export_rate=export_rate,
        shortfall_penalty_rate=10.0,
    )

    assert assessment.regret_inr >= 0.0
    assert assessment.worst_case_cost >= assessment.baseline_cost
    assert assessment.worst_scenario_name in ("combined_adverse", "demand_surge")
    assert len(assessment.scenario_outcomes) == 4
    for sc_name, outcome in assessment.scenario_outcomes.items():
        assert outcome.scenario_name == sc_name
        assert outcome.total_cost_inr >= -1000.0


def test_plan_risk_aware_alpha_validation(mock_site, mock_bands):
    pv_df, load_df = mock_bands
    import_rate = np.full(96, 7.0)
    export_rate = np.full(96, 3.0)
    p2p_fcst = np.full(96, 3.5)
    rsv = ReserveDecision(floor_soc=0.2, required_kwh=3.0, risk=0.5, feasible=True, reason="test")

    with pytest.raises(ValueError, match="alpha must be in"):
        plan_risk_aware(
            site=mock_site,
            pv_bands=pv_df,
            load_bands=load_df,
            import_rate=import_rate,
            export_rate=export_rate,
            p2p_fcst=p2p_fcst,
            soc_init=0.6,
            reserve=rsv,
            alpha=1.5,
        )

    with pytest.raises(ValueError, match="alpha must be in"):
        plan_risk_aware(
            site=mock_site,
            pv_bands=pv_df,
            load_bands=load_df,
            import_rate=import_rate,
            export_rate=export_rate,
            p2p_fcst=p2p_fcst,
            soc_init=0.6,
            reserve=rsv,
            alpha=-0.1,
        )


def test_plan_risk_aware_execution(mock_site, mock_bands):
    pv_df, load_df = mock_bands
    import_rate = np.full(96, 7.0)
    export_rate = np.full(96, 3.0)
    p2p_fcst = np.full(96, 3.5)
    rsv = ReserveDecision(floor_soc=0.2, required_kwh=3.0, risk=0.5, feasible=True, reason="test")

    res = plan_risk_aware(
        site=mock_site,
        pv_bands=pv_df,
        load_bands=load_df,
        import_rate=import_rate,
        export_rate=export_rate,
        p2p_fcst=p2p_fcst,
        soc_init=0.6,
        reserve=rsv,
        alpha=0.5,
    )

    assert res.plan.status.startswith("Optimal")
    # alpha=0.5 should interpolate halfway between p50 (5.0) and p10 (2.0) -> 3.5
    assert np.isclose(res.effective_pv.iloc[0], 3.5)
    # alpha=0.5 should interpolate halfway between p50 (3.0) and p90 (6.0) -> 4.5
    assert np.isclose(res.effective_load.iloc[0], 4.5)
    assert res.assessment.baseline_cost is not None
    assert res.assessment.worst_case_cost >= res.assessment.baseline_cost


def test_replanning_trigger_lifecycle():
    trigger = ReplanningTrigger(deviation_threshold=0.15)
    pv = np.full(96, 5.0)
    load = np.full(96, 3.0)
    soc = 0.6

    # 1. First run: should trigger replanning
    assert trigger.should_replan(pv, load, soc) is True

    # 2. Record plan
    trigger.record_plan(pv, load, soc)

    # 3. Stable inputs: should not trigger replanning
    assert trigger.should_replan(pv, load, soc) is False

    # 4. Small change below threshold (5% change)
    pv_minor = pv * 1.05
    assert trigger.should_replan(pv_minor, load, soc) is False

    # 5. Significant change exceeding threshold (25% change)
    pv_major = pv * 1.25
    assert trigger.should_replan(pv_major, load, soc) is True

    # 6. Reset
    trigger.reset()
    assert trigger.should_replan(pv, load, soc) is True
