"""The battery's cycle allowance: the energy drawn out of it over a horizon is capped at maxCyclesPerDay capacities a day.

Hand-solved: a lossless battery of 10 kWh, INR 1 power in the cheap hours and INR 10 in the dear ones. A kWh drawn in a dear hour
replaces a kWh bought at INR 10 with one bought at INR 1, so every kWh the allowance permits is worth INR 9.
"""

from __future__ import annotations

import random

import pytest
from avishkar_engine.optimise import validate
from avishkar_engine.schemas import OptimiseRequest
from conftest import battery, request, run

# four 6-hour blocks: cheap, dear, cheap, dear. Each dear block needs 12 kWh (2 kW for 6 hours).
PRICE = [1.0] * 6 + [10.0] * 6 + [1.0] * 6 + [10.0] * 6
LOAD = [0.0] * 6 + [2.0] * 6 + [0.0] * 6 + [2.0] * 6


def two_cycle_day(**over):
    return request(24, loadKw=LOAD, importPrice=PRICE, battery=battery(capacityKwh=10, maxSocKwh=10, **over))


class TestCycleAllowance:
    def test_without_a_limit_the_battery_cycles_twice_a_day(self):
        # charge 10 at INR 1 in each cheap block and draw it back in the dear one: 20 kWh drawn, 2 cycles. Each dear block
        # then imports 2 kWh at INR 10: net cost 2 x (10 + 20) = 60. With no control the same day costs 240.
        r = run(two_cycle_day())
        assert r.solver.status == "optimal" and r.validation.valid
        assert r.totals.battery_throughput_kwh == pytest.approx(20.0, abs=1e-4)
        assert r.totals.battery_cycles == pytest.approx(2.0, abs=1e-4)
        assert r.totals.net_cost_inr == pytest.approx(60.0, abs=1e-3)
        assert r.baseline.net_cost_inr == pytest.approx(240.0, abs=1e-3)

    def test_a_one_cycle_allowance_caps_the_energy_drawn_at_one_capacity(self):
        # 10 kWh drawn in all: charge 10 at INR 1 and draw it in one dear block (10 + 2 x 10 = 30 there); the other dear
        # block imports its whole 12 kWh at INR 10 (120). Net cost 150.
        r = run(two_cycle_day(maxCyclesPerDay=1.0))
        assert r.solver.status == "optimal" and r.validation.valid
        assert r.totals.battery_throughput_kwh == pytest.approx(10.0, abs=1e-4)
        assert r.totals.battery_cycles <= 1.0 + 1e-6
        assert r.totals.net_cost_inr == pytest.approx(150.0, abs=1e-3)

    def test_a_generous_allowance_leaves_the_plan_as_it_was(self):
        free = run(two_cycle_day())
        generous = run(two_cycle_day(maxCyclesPerDay=10.0))
        assert generous.totals.net_cost_inr == pytest.approx(free.totals.net_cost_inr, abs=1e-4)
        assert generous.totals.battery_throughput_kwh == pytest.approx(free.totals.battery_throughput_kwh, abs=1e-4)

    def test_the_allowance_scales_with_the_horizon(self):
        # half a day: one capacity a day is half a capacity, 5 kWh. Charge 5 at INR 1 and draw it in the dear block:
        # 5 + 7 x 10 = 75 (no control: 120).
        r = run(request(12, loadKw=LOAD[:12], importPrice=PRICE[:12], battery=battery(capacityKwh=10, maxSocKwh=10, maxCyclesPerDay=1.0)))
        assert r.solver.status == "optimal" and r.validation.valid
        assert r.totals.battery_throughput_kwh == pytest.approx(5.0, abs=1e-4)
        assert r.totals.net_cost_inr == pytest.approx(75.0, abs=1e-3)

    def test_the_validator_refuses_a_plan_that_cycles_past_its_allowance(self):
        # the unlimited plan cycles twice a day; checked against a one-cycle allowance it is not a plan
        free = run(two_cycle_day())
        v = validate(OptimiseRequest.model_validate(two_cycle_day(maxCyclesPerDay=1.0)), free.schedule)
        assert not v.valid
        assert any("maxCyclesPerDay" in p for p in v.problems)

    @pytest.mark.parametrize("seed", range(12))
    def test_random_days_never_exceed_the_allowance(self, seed):
        rng = random.Random(seed)
        n = rng.choice([6, 12, 24, 36])
        prices = [round(rng.uniform(0.5, 12.0), 2) for _ in range(n)]
        loads = [round(rng.uniform(0.0, 3.0), 2) for _ in range(n)]
        allowance = round(rng.uniform(0.2, 3.0), 2)
        r = run(request(n, loadKw=loads, importPrice=prices, battery=battery(capacityKwh=8, maxSocKwh=8, maxCyclesPerDay=allowance)))
        assert r.solver.status == "optimal" and r.validation.valid
        assert r.totals.battery_throughput_kwh <= allowance * 8 * n / 24 + 1e-4
