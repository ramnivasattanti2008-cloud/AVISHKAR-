import math

import pytest

from avishkar_ems.lifetime import Lifetime, lifetime_view

PLAIN = Lifetime(years=25, discount=0.0, escalation=0.0, pv_degradation=0.0, om_frac=0.0)


def test_with_every_extra_switched_off_it_matches_simple_payback():
    r = lifetime_view(annual_benefit_inr=100_000, system_cost_inr=400_000, params=PLAIN)
    assert r.simple_payback_years == pytest.approx(4.0)
    assert r.discounted_payback_years == pytest.approx(4.0)
    assert r.npv_inr == pytest.approx(100_000 * 25 - 400_000)


def test_subsidy_lowers_the_up_front_cost():
    r = lifetime_view(100_000, 400_000, subsidy_inr=100_000, params=PLAIN)
    assert r.simple_payback_years == pytest.approx(3.0)
    assert r.cashflows.loc[0, "cashflow_inr"] == pytest.approx(-300_000)


def test_discounting_and_running_costs_lengthen_payback_and_escalation_shortens_it():
    base = lifetime_view(100_000, 400_000, params=PLAIN)
    discounted = lifetime_view(100_000, 400_000, params=Lifetime(discount=0.08, escalation=0, pv_degradation=0, om_frac=0))
    om = lifetime_view(100_000, 400_000, params=Lifetime(discount=0, escalation=0, pv_degradation=0, om_frac=0.01))
    rising = lifetime_view(100_000, 400_000, params=Lifetime(discount=0, escalation=0.05, pv_degradation=0, om_frac=0))
    assert discounted.discounted_payback_years > base.discounted_payback_years
    assert om.discounted_payback_years > base.discounted_payback_years
    assert rising.discounted_payback_years < base.discounted_payback_years
    assert discounted.npv_inr < base.npv_inr


def test_battery_replacement_is_a_cash_outflow_in_its_year():
    p = Lifetime(discount=0, escalation=0, pv_degradation=0, om_frac=0, battery_replace_year=12, battery_replace_inr=50_000)
    cf = lifetime_view(100_000, 400_000, params=p).cashflows
    assert cf.loc[12, "cashflow_inr"] == pytest.approx(100_000 - 50_000)


def test_a_system_that_never_repays_says_so():
    r = lifetime_view(annual_benefit_inr=5_000, system_cost_inr=400_000, params=PLAIN)
    assert r.simple_payback_years == pytest.approx(80.0)  # a finite but absurd figure...
    assert math.isinf(r.discounted_payback_years)  # ...that does not repay within the 25-year horizon
    assert r.npv_inr < 0
    assert math.isinf(lifetime_view(0.0, 400_000, params=PLAIN).simple_payback_years)
