"""Risk-aware planning: one battery schedule for several possible days, expected cost blended with CVaR.

Hand-solved: two hours, INR 5 then INR 10, a lossless 1 kWh battery starting empty, nothing earned for export. The central day has
no demand; the "busy evening" day needs 1 kWh in hour two. Charging q kWh in hour one is decided once for both days:

  central day      costs 5q (the charge is bought and nothing needs it)
  busy evening     costs 5q + 10(1 - q) = 10 - 5q

With weights 0.7 and 0.3 the average is 3 + 2q, best at q = 0; the worst 20% of weight is the busy evening alone, 10 - 5q, best
at q = 1. So aversion 0 must leave the battery empty, aversion 1 must fill it, and both answers are known to the rupee.
"""

from __future__ import annotations

import pytest
from avishkar_engine.optimise import cvar
from avishkar_engine.schemas import OptimiseRequest
from conftest import battery, request, run
from pydantic import ValidationError

BUSY = {"label": "busy evening", "loadKw": [0.0, 1.0], "pvKw": [0.0, 0.0], "weight": 0.3}


def two_hours(aversion: float | None, **risk_over):
    risk = None if aversion is None else {"scenarios": [BUSY], "centralWeight": 0.7, "alpha": 0.8, "aversion": aversion, **risk_over}
    return request(2, loadKw=[0.0, 0.0], importPrice=[5.0, 10.0], battery=battery(capacityKwh=1, maxSocKwh=1, maxChargeKw=1, maxDischargeKw=1), risk=risk)


class TestRiskAwarePlanning:
    def test_without_risk_the_plan_and_response_are_as_before(self):
        r = run(two_hours(None))
        assert r.risk is None
        assert r.totals.net_cost_inr == pytest.approx(0.0, abs=1e-6)

    def test_average_cost_only_keeps_the_battery_empty(self):
        r = run(two_hours(0.0))
        assert r.solver.status == "optimal" and r.validation.valid
        assert r.schedule.battery_charge_kw[0] == pytest.approx(0.0, abs=1e-6)
        central, busy = r.risk.scenarios
        assert (central.label, central.weight, busy.label, busy.weight) == ("central forecast", 0.7, "busy evening", 0.3)
        assert central.net_cost_inr == pytest.approx(0.0, abs=1e-6)
        assert busy.net_cost_inr == pytest.approx(10.0, abs=1e-6)
        assert r.risk.expected_net_cost_inr == pytest.approx(3.0, abs=1e-6)
        assert r.risk.cvar_net_cost_inr == pytest.approx(10.0, abs=1e-6)

    def test_tail_cost_only_fills_the_battery_for_the_bad_day(self):
        r = run(two_hours(1.0))
        assert r.solver.status == "optimal" and r.validation.valid
        assert r.schedule.battery_charge_kw[0] == pytest.approx(1.0, abs=1e-6)
        central, busy = r.risk.scenarios
        assert central.net_cost_inr == pytest.approx(5.0, abs=1e-6)
        assert busy.net_cost_inr == pytest.approx(5.0, abs=1e-6)
        assert busy.import_kwh == pytest.approx(1.0, abs=1e-6)  # the charge, and nothing at INR 10
        assert r.risk.expected_net_cost_inr == pytest.approx(5.0, abs=1e-6)
        assert r.risk.cvar_net_cost_inr == pytest.approx(5.0, abs=1e-6)
        # the schedule shown is the central day's, and its totals are at the true prices
        assert r.totals.net_cost_inr == pytest.approx(5.0, abs=1e-6)
        assert any("Risk-aware" in n for n in r.notes)

    def test_each_day_carries_the_shared_battery_wear_so_the_central_day_is_the_plans_cost(self):
        # wear INR 1 per kWh drawn: filling and emptying the battery costs 5 + 1 on both days
        payload = two_hours(1.0)
        payload["battery"]["wearInrPerKwh"] = 1.0
        r = run(payload)
        central, busy = r.risk.scenarios
        assert r.totals.wear_cost_inr == pytest.approx(1.0, abs=1e-6)
        assert central.net_cost_inr == pytest.approx(r.totals.net_cost_inr, abs=1e-6)
        assert (central.net_cost_inr, busy.net_cost_inr) == (pytest.approx(6.0, abs=1e-6), pytest.approx(6.0, abs=1e-6))

    def test_a_tail_wider_than_the_bad_day_softens_the_choice(self):
        # alpha 0.5: the worst half of weight is the busy evening (0.3) and 0.2 of the central day, so CVaR = (0.3(10 - 5q) + 0.2 x 5q) / 0.5
        # = 6 - q, still best at q = 1, and the expected cost (3 + 2q) pulls the other way: with aversion 0.5 the blend is 4.5 + q/2, best at q = 0
        r = run(two_hours(0.5, alpha=0.5))
        assert r.schedule.battery_charge_kw[0] == pytest.approx(0.0, abs=1e-6)
        assert r.risk.cvar_net_cost_inr == pytest.approx(6.0, abs=1e-6)

    def test_unserved_load_on_a_scenario_day_is_reported(self):
        # an import limit of 0.5 kW: on the busy evening half its demand cannot be met without the battery
        payload = two_hours(0.0)
        payload["grid"] = {"importLimitKw": 0.5}
        r = run(payload)
        busy = r.risk.scenarios[1]
        assert busy.unserved_kwh == pytest.approx(0.0, abs=1e-6)  # the unserved penalty makes even the average plan charge for it
        assert r.schedule.battery_charge_kw[0] == pytest.approx(0.5, abs=1e-6)


class TestCvar:
    def test_is_the_weighted_average_of_the_worst_tail(self):
        assert cvar([0.0, 10.0], [0.7, 0.3], 0.8) == pytest.approx(10.0)
        assert cvar([0.0, 10.0], [0.7, 0.3], 0.5) == pytest.approx(6.0)
        assert cvar([1.0, 2.0, 3.0, 4.0], [0.25] * 4, 0.5) == pytest.approx(3.5)

    def test_never_below_the_average(self):
        costs, w = [3.0, -1.0, 7.0], [0.2, 0.5, 0.3]
        assert cvar(costs, w, 0.6) >= sum(c * x for c, x in zip(costs, w, strict=True)) - 1e-9


class TestValidation:
    def test_a_scenario_must_cover_the_same_steps(self):
        bad = two_hours(0.5)
        bad["risk"]["scenarios"] = [{**BUSY, "loadKw": [1.0]}]
        with pytest.raises(ValidationError, match="must have 2 values"):
            OptimiseRequest.model_validate(bad)

    def test_weights_and_levels_are_bounded(self):
        for over in ({"alpha": 1.0}, {"aversion": 1.5}, {"centralWeight": 0}):
            bad = two_hours(0.5)
            bad["risk"].update(over)
            with pytest.raises(ValidationError):
                OptimiseRequest.model_validate(bad)
        too_many = two_hours(0.5)
        too_many["risk"]["scenarios"] = [BUSY] * 9
        with pytest.raises(ValidationError):
            OptimiseRequest.model_validate(too_many)
