"""Randomised checks: invariants that must hold for any input, an independent solver that must agree on optimality, and a
validator that must catch plans that have been tampered with."""

from __future__ import annotations

import copy

import numpy as np
import pytest
from avishkar_engine.optimise import MODE_WEIGHTS, validate
from avishkar_engine.schemas import OptimiseRequest, Schedule
from conftest import battery, request, run


def random_case(rng: np.random.Generator, *, with_battery=True, with_outage=False, with_ev=False, with_appliance=False, mode="SAVE_MONEY") -> dict:
    n = int(rng.integers(4, 25))
    pi = rng.uniform(2, 12, n).round(2)
    pe = np.minimum(rng.uniform(0, 5, n), pi).round(2)
    payload = request(
        n,
        loadKw=rng.uniform(0, 4, n).round(3).tolist(),
        pvKw=(np.clip(np.sin(np.linspace(0, np.pi, n)) * rng.uniform(0, 6), 0, None)).round(3).tolist(),
        importPrice=pi.tolist(),
        exportPrice=pe.tolist(),
        mode=mode,
    )
    if with_battery:
        cap = float(rng.uniform(2, 12))
        mn = float(rng.uniform(0, 0.15)) * cap
        initial = float(rng.uniform(mn, cap))
        payload["battery"] = battery(
            capacityKwh=cap, maxSocKwh=cap, minSocKwh=mn, maxChargeKw=float(rng.uniform(1, 8)), maxDischargeKw=float(rng.uniform(1, 8)),
            chargeEfficiency=float(rng.uniform(0.85, 1)), dischargeEfficiency=float(rng.uniform(0.85, 1)),
            initialSocKwh=initial, reserveSocKwh=float(rng.uniform(mn, initial)), wearInrPerKwh=float(rng.choice([0, 0, 1.5])),
        )
    if with_outage:
        s = int(rng.integers(1, n - 1))
        payload["criticalKw"] = float(rng.uniform(0.2, 1.5))
        payload["grid"] = {"outages": [{"startStep": s, "endStep": int(rng.integers(s + 1, n + 1))}]}
    if with_ev:
        a = int(rng.integers(0, n - 1))
        payload["ev"] = {"energyNeededKwh": float(rng.uniform(1, 15)), "chargerKw": float(rng.uniform(2, 11)), "chargerEfficiency": float(rng.uniform(0.85, 0.95)), "availableFromStep": a, "departureStep": int(rng.integers(a + 1, n + 1))}
    if with_appliance:
        e = int(rng.integers(0, n - 1))
        f = int(rng.integers(e + 1, n + 1))
        payload["appliances"] = [{"id": "x", "name": "X", "powerKw": float(rng.uniform(0.3, 3)), "durationSteps": int(rng.integers(1, f - e + 1)), "earliestStartStep": e, "latestFinishStep": f, "interruptible": bool(rng.integers(0, 2))}]
    return payload


@pytest.mark.parametrize("seed", range(40))
def test_every_random_plan_balances_and_is_never_worse_than_doing_nothing(seed):
    rng = np.random.default_rng(seed)
    payload = random_case(rng, with_ev=bool(seed % 2), with_appliance=bool(seed % 3 == 0))
    r = run(payload)
    assert r.solver.status == "optimal"
    assert r.validation.valid, r.validation.problems
    assert r.validation.max_balance_error_kw < 1e-6
    # idling is feasible here (reserve at or below the starting charge, no outage), so a cost-minimising plan cannot lose to it
    assert r.savings_inr >= -1e-3, f"plan cost {r.totals.net_cost_inr} against baseline {r.baseline.net_cost_inr}"
    b = payload["battery"]
    soc = np.array(r.schedule.battery_soc_kwh)
    assert soc.min() >= b["minSocKwh"] - 1e-6 and soc.max() <= b["maxSocKwh"] + 1e-6
    assert soc.min() >= b["reserveSocKwh"] - 1e-5 or r.schedule.battery_soc_kwh[0] < b["reserveSocKwh"]  # the reserve is held
    assert soc[-1] >= b["initialSocKwh"] - 1e-5  # ends as full as it began


@pytest.mark.parametrize("seed", range(30))
def test_a_cyclic_battery_is_valid_ends_where_it_began_and_is_never_worse_than_any_fixed_start(seed):
    rng = np.random.default_rng(4000 + seed)
    payload = random_case(rng, with_ev=False, with_appliance=bool(seed % 3 == 0))
    fixed = run(payload)
    payload["battery"] = {**payload["battery"], "cyclic": True}
    r = run(payload)
    assert r.solver.status == "optimal" and r.validation.valid, r.validation.problems
    b = payload["battery"]
    soc = np.array(r.schedule.battery_soc_kwh)
    start = r.schedule.battery_initial_soc_kwh
    assert start is not None and b["minSocKwh"] - 1e-6 <= start <= b["maxSocKwh"] + 1e-6
    assert soc[-1] >= start - 1e-5  # ends at least where it began
    assert soc.min() >= b["minSocKwh"] - 1e-6 and soc.max() <= b["maxSocKwh"] + 1e-6
    # choosing the start can only help against the start the other case was given (its start and end are the same value)
    assert r.totals.net_cost_inr <= fixed.totals.net_cost_inr + 1e-5


@pytest.mark.parametrize("seed", range(25))
@pytest.mark.parametrize("mode", sorted(MODE_WEIGHTS))
def test_every_mode_returns_a_physically_valid_plan(seed, mode):
    rng = np.random.default_rng(1000 + seed)
    payload = random_case(rng, with_ev=bool(seed % 2), with_appliance=True, mode=mode)
    payload["criticalKw"], payload["backupHours"] = 0.5, 2
    r = run(payload)
    assert r.solver.status == "optimal"
    assert r.validation.valid, (mode, r.validation.problems)


@pytest.mark.parametrize("seed", range(20))
def test_an_outage_never_loses_more_load_than_doing_nothing(seed):
    rng = np.random.default_rng(2000 + seed)
    payload = random_case(rng, with_outage=True)
    r = run(payload)
    assert r.validation.valid, r.validation.problems
    assert r.totals.unserved_kwh <= r.baseline.unserved_kwh + 1e-6
    o = payload["grid"]["outages"][0]
    assert all(r.schedule.grid_import_kw[t] < 1e-7 and r.schedule.grid_export_kw[t] < 1e-7 for t in range(o["startStep"], o["endStep"]))


# ------------------------------------------------- an independent solver agrees on optimality


def dp_cost(payload: dict, grid_kwh: float = 0.05) -> float:
    """Minimum net cost of a battery-only problem by dynamic programming over a discretised state of charge.

    Written separately from the LP, from the same physical model: net grid power = load - pv + charge - discharge, import costs,
    export earns (surplus may also be wasted if export earns nothing), wear on energy drawn from the battery, and the battery ends
    where it began. It only knows the discretised states, so its answer can only be at or above the LP's, and close to it."""
    n = len(payload["loadKw"])
    b = payload["battery"]
    ce, de = b["chargeEfficiency"], b["dischargeEfficiency"]
    lo = int(np.ceil((max(b["minSocKwh"], b.get("reserveSocKwh") or 0)) / grid_kwh - 1e-9))
    hi = int(np.floor(b["maxSocKwh"] / grid_kwh + 1e-9))
    start = int(round(b["initialSocKwh"] / grid_kwh))
    states = np.arange(0, hi + 1)
    inf = float("inf")
    cost = np.full(hi + 1, inf)
    cost[start] = 0.0
    for t in range(n):
        new = np.full(hi + 1, inf)
        load, pv, pi, pe = payload["loadKw"][t], payload["pvKw"][t], payload["importPrice"][t], payload["exportPrice"][t]
        for s in states[np.isfinite(cost)]:
            for s2 in range(max(lo, 0), hi + 1):
                d = (s2 - s) * grid_kwh
                chg = d / ce if d > 0 else 0.0
                dis = -d * de if d < 0 else 0.0
                if chg > b["maxChargeKw"] + 1e-9 or dis > b["maxDischargeKw"] + 1e-9:
                    continue
                net = load - pv + chg - dis
                step = pi * net if net > 0 else -pe * (-net)
                step += b["wearInrPerKwh"] * (-d if d < 0 else 0.0)
                if cost[s] + step < new[s2]:
                    new[s2] = cost[s] + step
        cost = new
    return float(cost[start:].min())  # may end at or above where it started


@pytest.mark.parametrize("seed", range(15))
def test_the_lp_matches_an_independent_dynamic_programme(seed):
    rng = np.random.default_rng(3000 + seed)
    payload = random_case(rng)
    payload["stepHours"] = 1.0
    b = payload["battery"]
    b.update(capacityKwh=3.0, maxSocKwh=3.0, minSocKwh=0.0, initialSocKwh=1.0, reserveSocKwh=0.0, maxChargeKw=2.0, maxDischargeKw=2.0)
    n = len(payload["loadKw"])
    payload["loadKw"], payload["pvKw"] = payload["loadKw"][: min(n, 10)], payload["pvKw"][: min(n, 10)]
    payload["importPrice"], payload["exportPrice"] = payload["importPrice"][: len(payload["loadKw"])], payload["exportPrice"][: len(payload["loadKw"])]
    r = run(payload)
    lp = r.totals.net_cost_inr
    dp = dp_cost(payload)
    spread = max(payload["importPrice"])
    assert lp <= dp + 1e-3, f"the LP ({lp}) is worse than a grid search ({dp}): it is not optimal"
    # measured over these seeds the grid search sits 0.02 to 0.33 INR above the LP (a 0.05 kWh grid); 5% of the highest price bounds it
    assert dp - lp <= 0.05 * spread + 1e-3, f"the LP ({lp}) is implausibly far below the grid search ({dp}); the models disagree"


# ------------------------------------------------------------------ the validator catches tampering


def tampered(**edits):
    """A valid plan for a busy scenario, then edited behind the solver's back."""
    payload = request(
        4, loadKw=[1, 1, 3, 3], pvKw=[3, 0, 0, 0], importPrice=[2, 2, 9, 9], exportPrice=[1, 1, 1, 1], startTime=None,
        battery=battery(capacityKwh=6, maxSocKwh=6, initialSocKwh=0, terminalSocKwh=0),
        grid={"exportLimitKw": 2.0, "outages": [{"startStep": 3, "endStep": 4}]}, criticalKw=1.0,
        ev={"energyNeededKwh": 2, "chargerKw": 2, "chargerEfficiency": 1.0, "availableFromStep": 0, "departureStep": 2},
        appliances=[{"id": "w", "name": "Washer", "powerKw": 1, "durationSteps": 2, "earliestStartStep": 0, "latestFinishStep": 3}],
    )
    req = OptimiseRequest.model_validate(payload)
    base = run(payload)
    assert base.validation.valid, base.validation.problems
    data = copy.deepcopy(base.schedule.model_dump(by_alias=False))
    for path, fn in edits.items():
        key, idx = path.split("@")
        if key == "appliance":
            fn(data["appliance_kw"]["w"], int(idx))
        else:
            fn(data[key], int(idx))
    return validate(req, Schedule.model_validate(data))


class TestValidatorCatchesTampering:
    def test_the_untouched_plan_passes(self):
        assert tampered().valid

    def test_extra_energy_from_nowhere(self):
        v = tampered(**{"grid_import_kw@0": lambda a, i: a.__setitem__(i, a[i] + 1.0)})
        assert not v.valid and any("does not balance at step 0" in p for p in v.problems)
        assert v.max_balance_error_kw == pytest.approx(1.0, abs=1e-6)

    def test_a_battery_whose_state_of_charge_ignores_its_flows(self):
        v = tampered(**{"battery_soc_kwh@1": lambda a, i: a.__setitem__(i, a[i] + 0.5)})
        assert not v.valid and any("state of charge does not follow" in p for p in v.problems)

    def test_more_solar_than_the_sun_gave(self):
        v = tampered(**{"pv_used_kw@1": lambda a, i: a.__setitem__(i, 4.0)})
        assert not v.valid and any("more solar is used than is generated" in p for p in v.problems)

    def test_export_over_the_limit(self):
        v = tampered(**{"grid_export_kw@0": lambda a, i: a.__setitem__(i, 3.0)})
        assert not v.valid and any("export limit" in p for p in v.problems)

    def test_the_grid_used_while_it_is_down(self):
        v = tampered(**{"grid_import_kw@3": lambda a, i: a.__setitem__(i, 0.5)})
        assert not v.valid and any("during an outage" in p for p in v.problems)

    def test_a_vehicle_charged_while_it_is_away(self):
        v = tampered(**{"ev_charge_kw@2": lambda a, i: a.__setitem__(i, 1.0)})
        assert not v.valid and any("while it is away" in p for p in v.problems)

    def test_an_appliance_outside_its_window_or_broken_into_pieces(self):
        v = tampered(**{"appliance@3": lambda a, i: a.__setitem__(i, 1.0)})
        assert not v.valid and any("outside its window" in p or "unbroken run" in p or "during an outage" in p for p in v.problems)

    def test_negative_flows(self):
        v = tampered(**{"battery_charge_kw@0": lambda a, i: a.__setitem__(i, -1.0)})
        assert not v.valid and any("negative" in p for p in v.problems)

    def test_charging_and_discharging_at_once(self):
        v = tampered(**{"battery_charge_kw@2": lambda a, i: a.__setitem__(i, 0.5), "battery_discharge_kw@2": lambda a, i: a.__setitem__(i, 0.5)})
        assert not v.valid and any("same step" in p for p in v.problems)
