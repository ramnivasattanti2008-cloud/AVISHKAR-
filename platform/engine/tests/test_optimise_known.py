"""Optimiser cases whose optimal answers are worked out by hand, not read off the solver."""

from __future__ import annotations

import itertools

import pytest
from conftest import battery, request, run


def approx(x: float, tol: float = 1e-6):
    return pytest.approx(x, abs=tol)


class TestBatteryArbitrage:
    def test_buys_cheap_and_sells_to_itself_at_the_peak(self):
        # 4 hourly steps, price 1,1,10,10, load 0,0,2,2, a lossless battery of 4 kWh. Charge 4 kWh at INR 1 (cost 4),
        # discharge 4 kWh over the two peak hours: net cost 4. Doing nothing buys 4 kWh at INR 10: cost 40.
        r = run(request(4, loadKw=[0, 0, 2, 2], importPrice=[1, 1, 10, 10], battery=battery(capacityKwh=4, maxSocKwh=4)))
        assert r.solver.status == "optimal" and r.validation.valid
        assert r.totals.net_cost_inr == approx(4.0)
        assert r.baseline.net_cost_inr == approx(40.0)
        assert r.savings_inr == approx(36.0)
        assert sum(r.schedule.battery_charge_kw[:2]) == approx(4.0)
        assert r.schedule.grid_import_kw[2] == approx(0.0) and r.schedule.grid_import_kw[3] == approx(0.0)
        assert r.schedule.battery_soc_kwh[1] == approx(4.0)
        assert r.schedule.battery_soc_kwh[3] == approx(0.0)

    def test_losses_make_the_grid_pay_for_more_than_it_delivers(self):
        # With 0.9 charge and 0.9 discharge efficiency, 4 kWh at the load needs 4/0.9 = 4.444 kWh out of the battery, which needs
        # 4.444/0.9 = 4.938 kWh from the grid at INR 1.
        r = run(request(4, loadKw=[0, 0, 2, 2], importPrice=[1, 1, 10, 10], battery=battery(capacityKwh=5, maxSocKwh=5, chargeEfficiency=0.9, dischargeEfficiency=0.9)))
        assert sum(r.schedule.battery_charge_kw) == approx(4 / 0.81, 1e-5)
        assert r.totals.net_cost_inr == approx(4 / 0.81, 1e-4)
        assert r.totals.import_kwh == approx(4 / 0.81, 1e-4)

    def test_wear_cost_stops_cycling_when_the_spread_is_too_small(self):
        # Buying at 1 and avoiding 1.5 gains 0.5 per kWh; wear costs 2 per kWh: not worth it.
        r = run(request(2, loadKw=[0, 1], importPrice=[1, 1.5], battery=battery(wearInrPerKwh=2.0)))
        assert sum(r.schedule.battery_charge_kw) == approx(0.0)
        assert r.totals.net_cost_inr == approx(1.5)
        # and it does cycle when the spread beats the wear: avoid 5 for 1 + 2 wear
        r2 = run(request(2, loadKw=[0, 1], importPrice=[1, 5], battery=battery(wearInrPerKwh=2.0)))
        assert sum(r2.schedule.battery_charge_kw) == approx(1.0)
        assert r2.totals.net_cost_inr == approx(3.0)  # 1 imported at INR 1 plus INR 2 of wear
        assert r2.totals.wear_cost_inr == approx(2.0)

    def test_power_limits_cap_how_much_can_move(self):
        # 2 kW charge limit over two cheap hours moves at most 4 kWh even though 8 would pay.
        r = run(request(4, loadKw=[0, 0, 4, 4], importPrice=[1, 1, 10, 10], battery=battery(maxChargeKw=2)))
        assert max(r.schedule.battery_charge_kw) <= 2 + 1e-9
        assert sum(r.schedule.battery_charge_kw) == approx(4.0)

    def test_the_battery_ends_the_horizon_as_full_as_it_started(self):
        # starting full at INR 10 / 1, an unconstrained plan would drain it for free at the end; the terminal level forbids that
        r = run(request(3, loadKw=[1, 1, 1], importPrice=[10, 10, 10], battery=battery(initialSocKwh=6)))
        assert r.schedule.battery_soc_kwh[-1] >= 6 - 1e-6
        assert r.totals.import_kwh == approx(3.0)

    def test_an_explicit_terminal_level_can_release_the_stored_energy(self):
        r = run(request(3, loadKw=[1, 1, 1], importPrice=[10, 10, 10], battery=battery(initialSocKwh=6, terminalSocKwh=3)))
        assert r.totals.import_kwh == approx(0.0)  # 3 kWh used from the battery, ending at the 3 kWh asked for
        assert r.schedule.battery_soc_kwh[-1] == approx(3.0)


class TestSolar:
    def test_surplus_solar_is_stored_and_used_in_the_evening(self):
        # noon: 4 kW of sun and 1 kW load; evening: no sun and 3 kW load at INR 8. The battery moves 3 kWh across.
        r = run(request(2, loadKw=[1, 3], pvKw=[4, 0], importPrice=[8, 8], battery=battery()))
        assert r.schedule.battery_charge_kw[0] == approx(3.0)
        assert r.totals.import_kwh == approx(0.0)
        assert r.totals.self_consumption_ratio == approx(1.0)
        assert r.totals.self_sufficiency_ratio == approx(1.0)

    def test_surplus_is_exported_when_it_pays(self):
        paid = run(request(2, loadKw=[1, 1], pvKw=[3, 0], importPrice=[8, 8], exportPrice=[3, 3]))
        assert paid.schedule.grid_export_kw[0] == approx(2.0)
        assert paid.totals.export_revenue_inr == approx(6.0)

    def test_surplus_with_no_credit_flows_out_uncredited_and_says_so(self):
        # export is allowed but earns nothing, and there is no battery: the surplus leaves uncredited (it is not "curtailed")
        r = run(request(2, loadKw=[1, 1], pvKw=[3, 0], importPrice=[8, 8], exportPrice=[0, 0]))
        assert r.totals.export_kwh == approx(2.0) and r.totals.export_revenue_inr == approx(0.0)
        assert r.validation.valid
        [d] = [d for d in r.decisions if d.kind == "export"]
        assert "uncredited" in d.reason

    def test_surplus_is_curtailed_when_the_grid_will_not_take_it(self):
        r = run(request(2, loadKw=[1, 1], pvKw=[3, 0], importPrice=[8, 8], exportPrice=[0, 0], grid={"exportLimitKw": 0}))
        assert r.totals.curtailed_kwh == approx(2.0)
        assert r.totals.export_kwh == approx(0.0)
        assert r.validation.valid

    def test_export_limit_is_respected_and_the_rest_wasted(self):
        r = run(request(2, loadKw=[1, 1], pvKw=[6, 0], importPrice=[8, 8], exportPrice=[3, 3], grid={"exportLimitKw": 2.0}))
        assert max(r.schedule.grid_export_kw) <= 2 + 1e-9
        assert r.totals.curtailed_kwh == approx(3.0)  # 6 - 1 (load) - 2 (export)
        assert any(d.kind == "curtail" and "export limit" in d.reason for d in r.decisions)

    def test_the_plan_never_uses_more_solar_than_exists(self):
        r = run(request(3, loadKw=[5, 5, 5], pvKw=[1, 2, 0], importPrice=[8, 8, 8]))
        assert all(u <= p + 1e-9 for u, p in zip(r.schedule.pv_used_kw, [1, 2, 0], strict=True))


class TestReserve:
    def test_the_backup_reserve_is_never_spent_even_when_the_peak_pays_for_it(self):
        r = run(request(3, loadKw=[0, 0, 5], importPrice=[1, 1, 50], battery=battery(initialSocKwh=0, reserveSocKwh=4)))
        assert min(r.schedule.battery_soc_kwh) >= 4 - 1e-6
        assert r.totals.import_kwh > 0
        # without a reserve the same battery is drained at the peak
        free = run(request(3, loadKw=[0, 0, 5], importPrice=[1, 1, 50], battery=battery(initialSocKwh=0)))
        assert min(free.schedule.battery_soc_kwh) < 4

    def test_a_reserve_the_battery_cannot_reach_is_reported_not_hidden(self):
        r = run(request(2, loadKw=[1, 1], battery=battery(initialSocKwh=0, reserveSocKwh=9, maxChargeKw=1)))
        assert r.validation.valid
        assert any("reserve could not be fully held" in n for n in r.notes)

    def test_resilience_mode_holds_enough_for_the_critical_load_for_the_hours_asked(self):
        # 1 kW critical for 3 hours at 0.9 discharge efficiency needs 3/0.9 = 3.333 kWh above the minimum
        r = run(request(4, loadKw=[2, 2, 2, 2], importPrice=[1, 1, 10, 10], criticalKw=1, backupHours=3, mode="RESILIENCE",
                        battery=battery(dischargeEfficiency=0.9, initialSocKwh=0)))
        assert min(r.schedule.battery_soc_kwh) >= 3 / 0.9 - 1e-6
        plain = run(request(4, loadKw=[2, 2, 2, 2], importPrice=[1, 1, 10, 10], criticalKw=1, backupHours=3, mode="SAVE_MONEY",
                            battery=battery(dischargeEfficiency=0.9, initialSocKwh=0)))
        assert min(plain.schedule.battery_soc_kwh) < 3 / 0.9 - 1e-6  # the mode, not luck, held the reserve


class TestOutage:
    def test_only_the_critical_load_is_kept_on_and_the_battery_carries_it(self):
        # grid down in steps 2 and 3; critical 1 kW of a 3 kW load. The battery must hold 2 kWh when the outage starts.
        r = run(request(4, loadKw=[3, 3, 3, 3], criticalKw=1, grid={"outages": [{"startStep": 2, "endStep": 4}]}, battery=battery(initialSocKwh=0)))
        assert r.validation.valid
        assert r.schedule.battery_soc_kwh[1] >= 2 - 1e-6
        assert r.schedule.grid_import_kw[2] == approx(0.0) and r.schedule.grid_import_kw[3] == approx(0.0)
        assert r.totals.unserved_kwh == approx(0.0)
        assert r.schedule.served_load_kw[2] == approx(1.0)  # non-critical load shed
        assert any(d.kind == "shed" for d in r.decisions)

    def test_an_outage_the_battery_cannot_cover_reports_the_unserved_energy(self):
        r = run(request(4, loadKw=[3, 3, 3, 3], criticalKw=1, grid={"outages": [{"startStep": 1, "endStep": 4}]}, battery=battery(capacityKwh=1, maxSocKwh=1)))
        assert r.totals.unserved_kwh == approx(2.0, 1e-5)  # 3 kWh needed, 1 kWh stored
        assert any("cannot be supplied" in n for n in r.notes)

    def test_solar_carries_the_critical_load_through_an_outage(self):
        r = run(request(2, loadKw=[3, 3], pvKw=[0, 2], criticalKw=1, grid={"outages": [{"startStep": 1, "endStep": 2}]}))
        assert r.totals.unserved_kwh == approx(0.0)

    def test_the_do_nothing_baseline_leaves_the_critical_load_dark_without_storage(self):
        r = run(request(2, loadKw=[3, 3], criticalKw=1, grid={"outages": [{"startStep": 1, "endStep": 2}]}))
        assert r.baseline.unserved_kwh == approx(1.0)


class TestEv:
    def test_charges_in_the_cheapest_hours_before_departure(self):
        # needs 7 kWh with a 7 kW charger, window steps 0..3, cheapest step is 2
        r = run(request(4, importPrice=[6, 6, 2, 6], ev={"energyNeededKwh": 7, "chargerKw": 7, "chargerEfficiency": 1.0, "availableFromStep": 0, "departureStep": 4}))
        assert r.schedule.ev_charge_kw[2] == approx(7.0)
        assert r.totals.ev_delivered_kwh == approx(7.0)
        assert r.totals.ev_shortfall_kwh == approx(0.0)

    def test_never_charges_outside_the_time_it_is_home(self):
        r = run(request(6, importPrice=[1, 1, 9, 9, 1, 1], ev={"energyNeededKwh": 6, "chargerKw": 3, "chargerEfficiency": 1.0, "availableFromStep": 2, "departureStep": 4}))
        assert r.schedule.ev_charge_kw[0] == approx(0.0) and r.schedule.ev_charge_kw[1] == approx(0.0)
        assert r.schedule.ev_charge_kw[4] == approx(0.0) and r.schedule.ev_charge_kw[5] == approx(0.0)
        assert r.totals.ev_delivered_kwh == approx(6.0)

    def test_charger_efficiency_means_more_energy_from_the_wall(self):
        r = run(request(2, ev={"energyNeededKwh": 9, "chargerKw": 10, "chargerEfficiency": 0.9, "availableFromStep": 0, "departureStep": 2}))
        assert sum(r.schedule.ev_charge_kw) == approx(10.0)  # 9 / 0.9 kWh drawn

    def test_an_impossible_deadline_is_reported_with_the_shortfall(self):
        r = run(request(3, ev={"energyNeededKwh": 30, "chargerKw": 7, "chargerEfficiency": 1.0, "availableFromStep": 0, "departureStep": 3}))
        assert r.validation.valid
        assert r.totals.ev_delivered_kwh == approx(21.0)
        assert r.totals.ev_shortfall_kwh == approx(9.0)
        assert any("cannot receive all the energy" in n for n in r.notes)

    def test_prefers_midday_sun_over_a_cheap_grid_hour_when_export_is_worth_less(self):
        # solar 5 kW at step 1 is free to use (export worth 1) while the grid at step 0 costs 3: charge from the sun
        r = run(request(2, loadKw=[0, 0], pvKw=[0, 5], importPrice=[3, 3], exportPrice=[1, 1], ev={"energyNeededKwh": 4, "chargerKw": 5, "chargerEfficiency": 1.0, "availableFromStep": 0, "departureStep": 2}))
        assert r.schedule.ev_charge_kw[1] == approx(4.0)
        assert r.totals.import_kwh == approx(0.0)


class TestAppliances:
    def washer(self, **over):
        a = {"id": "w", "name": "Washer", "powerKw": 2.0, "durationSteps": 2, "earliestStartStep": 0, "latestFinishStep": 6, "interruptible": False}
        a.update(over)
        return a

    def test_runs_in_the_cheapest_consecutive_steps(self):
        r = run(request(6, loadKw=[0] * 6, importPrice=[9, 9, 3, 3, 9, 9], appliances=[self.washer()]))
        assert r.appliances[0].start_step == 2 and r.appliances[0].run_steps == [2, 3]
        assert r.totals.net_cost_inr == approx(12.0)  # 4 kWh at INR 3
        assert r.solver.integer_variables > 0

    def test_matches_brute_force_over_every_start_time(self):
        prices = [7, 4, 6, 2, 9, 3, 8, 5]
        d = 3
        best = min(sum(prices[s + k] * 1.5 for k in range(d)) for s in range(len(prices) - d + 1))
        r = run(request(8, loadKw=[0] * 8, importPrice=prices, appliances=[self.washer(powerKw=1.5, durationSteps=d, latestFinishStep=8)]))
        assert r.totals.net_cost_inr == approx(best)
        starts = [s for s in range(len(prices) - d + 1) if sum(prices[s + k] for k in range(d)) == min(sum(prices[q + k] for k in range(d)) for q in range(len(prices) - d + 1))]
        assert r.appliances[0].start_step in starts

    def test_stays_inside_its_window(self):
        r = run(request(6, loadKw=[0] * 6, importPrice=[1, 1, 9, 9, 9, 9], appliances=[self.washer(earliestStartStep=2, latestFinishStep=5)]))
        assert r.appliances[0].start_step in (2, 3)
        assert all(r.schedule.appliance_kw["w"][t] == 0 for t in (0, 1, 5))

    def test_an_interruptible_appliance_can_split_across_the_cheap_hours(self):
        r = run(request(6, loadKw=[0] * 6, importPrice=[9, 3, 9, 9, 3, 9], appliances=[self.washer(interruptible=True)]))
        assert r.appliances[0].run_steps == [1, 4]
        assert r.totals.net_cost_inr == approx(12.0)

    def test_uses_solar_that_would_otherwise_be_wasted(self):
        r = run(request(4, loadKw=[0] * 4, pvKw=[0, 0, 3, 3], importPrice=[5] * 4, appliances=[self.washer(latestFinishStep=4)]))
        assert r.appliances[0].run_steps == [2, 3]
        assert r.totals.import_kwh == approx(0.0)

    def test_two_appliances_do_not_overload_a_small_grid_connection(self):
        a1, a2 = self.washer(latestFinishStep=4), self.washer(id="d", name="Dryer", powerKw=2.0, latestFinishStep=4)
        r = run(request(4, loadKw=[0] * 4, importPrice=[1] * 4, grid={"importLimitKw": 2.5}, appliances=[a1, a2]))
        assert max(r.schedule.grid_import_kw) <= 2.5 + 1e-9
        assert set(r.appliances[0].run_steps).isdisjoint(r.appliances[1].run_steps)

    def test_an_appliance_that_cannot_run_in_an_outage_free_window_is_reported_unscheduled(self):
        r = run(request(4, loadKw=[0] * 4, grid={"outages": [{"startStep": 0, "endStep": 4}]}, appliances=[self.washer(latestFinishStep=4)]))
        assert r.appliances[0].start_step is None
        assert any("could not be fitted" in n for n in r.notes)


class TestModes:
    def scenario(self, mode):
        # export pays as much as import costs, so money is indifferent about storing the surplus; the modes decide
        return run(request(4, loadKw=[1, 1, 2, 2], pvKw=[3, 0, 0, 0], importPrice=[5] * 4, exportPrice=[5] * 4, mode=mode,
                           battery=battery(capacityKwh=3, maxSocKwh=3, initialSocKwh=0, terminalSocKwh=0)))

    def test_independence_imports_less_than_saving_money(self):
        money, indep = self.scenario("SAVE_MONEY"), self.scenario("INDEPENDENCE")
        assert indep.totals.import_kwh < money.totals.import_kwh - 1e-6
        assert indep.totals.self_sufficiency_ratio > money.totals.self_sufficiency_ratio

    def test_every_mode_returns_its_weights_and_a_valid_plan(self):
        for mode in ("SAVE_MONEY", "INDEPENDENCE", "RESILIENCE", "GREEN", "REVENUE", "BALANCED"):
            r = self.scenario(mode)
            assert r.mode == mode and r.validation.valid and r.solver.status == "optimal"
            assert set(r.mode_weights) == {"importCost", "exportRevenue", "importEnergyPenalty", "backupReserve"}

    def test_costs_are_reported_at_true_prices_whatever_the_weights(self):
        r = self.scenario("INDEPENDENCE")
        t = r.totals
        assert t.net_cost_inr == approx(t.import_cost_inr - t.export_revenue_inr + t.wear_cost_inr)
        assert t.import_cost_inr == approx(t.import_kwh * 5.0)

    def test_revenue_mode_keeps_import_and_export_apart_when_export_is_overvalued(self):
        r = run(request(3, loadKw=[1, 1, 1], pvKw=[0, 0, 0], importPrice=[6, 6, 6], exportPrice=[5, 5, 5], mode="REVENUE", battery=battery(initialSocKwh=5, terminalSocKwh=0)))
        assert r.validation.valid
        assert any("kept apart" in n for n in r.notes)
        assert all(not (i > 1e-6 and e > 1e-6) for i, e in zip(r.schedule.grid_import_kw, r.schedule.grid_export_kw, strict=True))

    def test_green_mode_weights_carbon_when_supplied_and_says_so(self):
        r = run(request(2, loadKw=[1, 1], importPrice=[5, 5], mode="GREEN", carbonKgPerKwh=[0.9, 0.3]))
        assert any("carbon intensity you supplied" in n for n in r.notes)


class TestDecisions:
    def test_reasons_name_the_prices_that_explain_them(self):
        r = run(request(4, loadKw=[0, 0, 2, 2], importPrice=[1, 1, 10, 10], startTime="2026-10-08T00:00:00+05:30", battery=battery(capacityKwh=4, maxSocKwh=4)))
        charge = [d for d in r.decisions if d.kind == "charge_battery"]
        assert charge and "INR 1.00 per kWh" in charge[0].reason and "INR 10.00" in charge[0].reason
        discharge = [d for d in r.decisions if d.kind == "discharge_battery"]
        assert discharge and "02:00" in discharge[0].reason

    def test_a_flat_day_has_no_invented_story(self):
        r = run(request(4, loadKw=[1] * 4, importPrice=[5] * 4))
        assert [d for d in r.decisions if d.kind in ("charge_battery", "discharge_battery", "export")] == []


class TestInputRefusals:
    @pytest.mark.parametrize(
        ("patch", "fragment"),
        [
            ({"pvKw": [0, 0, 0]}, "every series must cover the same steps"),
            ({"stepHours": 2.0}, "stepHours must be one of"),
            ({"loadKw": [1, -1, 1, 1]}, "cannot be negative"),
            ({"importPrice": [5, 5, 5, -1]}, "prices cannot be negative"),
            ({"exportPrice": [9, 0, 0, 0]}, "traded with itself"),
            ({"loadKw": [1, 1, 1, float("nan")]}, "not a finite number"),
            ({"loadKw": [1]}, "between 2 and 400 steps"),
            ({"mode": "TURBO"}, "Input should be"),
            ({"unknown": 1}, "Extra inputs are not permitted"),
            ({"grid": {"outages": [{"startStep": 2, "endStep": 9}]}}, "ends after the horizon"),
            ({"battery": battery(minSocKwh=5, maxSocKwh=4)}, "minSocKwh must be below maxSocKwh"),
            ({"battery": battery(initialSocKwh=99)}, "initialSocKwh must lie between"),
            ({"battery": battery(chargeEfficiency=0.2)}, "greater than or equal to 0.5"),
            ({"ev": {"energyNeededKwh": 5, "chargerKw": 7, "chargerEfficiency": 0.9, "availableFromStep": 3, "departureStep": 2}}, "must depart after it arrives"),
            ({"appliances": [{"id": "a", "name": "A", "powerKw": 1, "durationSteps": 5, "earliestStartStep": 0, "latestFinishStep": 3}]}, "needs 5 steps but its window is only 3"),
        ],
    )
    def test_refuses(self, patch, fragment):
        from avishkar_engine.schemas import OptimiseRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError) as e:
            OptimiseRequest.model_validate(request(4, **patch))
        assert fragment in str(e.value)

    def test_duplicate_appliance_ids_are_refused(self):
        from avishkar_engine.schemas import OptimiseRequest
        from pydantic import ValidationError

        a = {"id": "x", "name": "X", "powerKw": 1, "durationSteps": 1, "earliestStartStep": 0, "latestFinishStep": 2}
        with pytest.raises(ValidationError, match="unique"):
            OptimiseRequest.model_validate(request(4, appliances=[a, dict(a, name="Y")]))


def test_the_solver_is_deterministic():
    payload = request(8, loadKw=[1, 2, 1, 3, 2, 1, 4, 2], pvKw=[0, 0, 2, 4, 4, 2, 0, 0], importPrice=[4, 4, 5, 6, 6, 8, 9, 7], exportPrice=[2] * 8, battery=battery(capacityKwh=6, maxSocKwh=6, chargeEfficiency=0.95, dischargeEfficiency=0.95))
    a, b = run(payload), run(payload)
    assert a.schedule.model_dump() == b.schedule.model_dump()
    assert a.totals.net_cost_inr == b.totals.net_cost_inr
    assert list(itertools.chain.from_iterable([a.schedule.grid_import_kw])) == b.schedule.grid_import_kw
