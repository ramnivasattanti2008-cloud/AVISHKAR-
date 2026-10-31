"""AVISHKAR's own tests for how the vendored SEM surplus arithmetic is *used*.

`test_vendored_sem_surplus.py` runs upstream's tests against the copy, which pins the copy. This
file is the other half: it checks that `HomeEnergyBalanceEngine` actually calls into it when there
is a live grid reading, that it does not when there is not, and that the energy balance and the
honesty rules still hold either way.

The case that matters most is the night one. Before this wiring, a metered home with no sun and a
2 kW load running off the battery had its surplus computed as `generation - demand`, which is 0 only
by accident -- the engine had no way to see the battery at all. With a real meter reading of 0 W
export and 2 kW of battery discharge, a naive `export + own draw` reading would have said 2 kW of
surplus and kept a "solar only" load running on the pack all night. That is the failure upstream
fixed in its issue #620, and it is why the clamp is worth vendoring rather than reimplementing.
"""

from __future__ import annotations

import pytest

from avishkar_ems.home_balance import HomeEnergyBalanceEngine, IntervalTelemetry
from avishkar_ems.home_profile import HomeProfile
from avishkar_ems.vendor import sem_surplus


@pytest.fixture
def engine() -> HomeEnergyBalanceEngine:
    return HomeEnergyBalanceEngine(HomeProfile.create_phase7_demo_home())


def telemetry(**over) -> IntervalTelemetry:
    base = {"solar_generation_kw": 4.0, "home_consumption_kw": 1.5}
    base.update(over)
    return IntervalTelemetry(**base)


class TestWhichComputationIsUsed:
    def test_an_interval_with_no_meter_is_generation_minus_demand(self, engine):
        r = engine.evaluate_interval(telemetry(solar_generation_kw=4.0, home_consumption_kw=1.5))
        assert r.gross_surplus_kw == pytest.approx(2.5)
        basis = " ".join(r.assumptions)
        assert "no live grid reading" in basis
        assert "what-if" in basis

    def test_an_interval_with_a_meter_uses_the_vendored_function(self, engine):
        # 1 kW exporting while this EMS already runs 2 kW of its own loads, on 5 kW of sun: the
        # surplus that would exist with those loads off is 3 kW, not the 1 kW the meter shows.
        r = engine.evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=1.0, grid_import_kw=0.0, controllable_draw_kw=2.0))
        assert r.allocatable_surplus_kw == pytest.approx(3.0)
        assert "solar_bounded_surplus" in " ".join(r.assumptions)

    def test_the_two_paths_are_named_differently_so_a_reader_can_tell(self, engine):
        sim = " ".join(engine.evaluate_interval(telemetry()).assumptions)
        met = " ".join(engine.evaluate_interval(telemetry(grid_export_kw=0.5)).assumptions)
        assert "not a measurement of a meter" in sim
        assert "read from the grid meter" in met

    def test_has_grid_meter_is_what_switches_it(self):
        assert telemetry().has_grid_meter is False
        assert telemetry(grid_export_kw=0.0).has_grid_meter is True  # zero export is still a reading


class TestTheNightCaseThatMattered:
    def test_a_load_running_off_the_battery_is_not_surplus(self, engine):
        """No sun, meter at zero, 2 kW drawn from the pack. The pack is not the sun."""
        r = engine.evaluate_interval(telemetry(
            solar_generation_kw=0.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=0.0,
            battery_discharge_kw=2.0, controllable_draw_kw=2.0))
        assert r.gross_surplus_kw == 0.0

    def test_the_clamp_is_what_does_it_not_the_discharge_term(self, engine):
        """Even with the battery term absent, the solar clamp alone pins the night to zero."""
        r = engine.evaluate_interval(telemetry(
            solar_generation_kw=0.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=0.0, controllable_draw_kw=2.0))
        assert r.gross_surplus_kw == 0.0

    def test_surplus_never_exceeds_the_generation_on_any_meter_reading(self, engine):
        for solar in (0.0, 0.4, 2.0, 6.0):
            for export in (0.0, 1.0, 5.0):
                for draw in (0.0, 2.0):
                    r = engine.evaluate_interval(telemetry(
                        solar_generation_kw=solar, home_consumption_kw=1.0,
                        grid_export_kw=export, grid_import_kw=0.0, controllable_draw_kw=draw))
                    # The inverter rating can clip the generation, so compare against what it passed on.
                    assert r.gross_surplus_kw <= r.solar_generation_kw + 1e-9, (solar, export, draw)


class TestTheImportAndTheCharger:
    def test_an_import_the_sun_did_not_fund_comes_off_the_pool(self, engine):
        """2 kW imported past the deadband reduces what the EMS will switch on.

        The accounting surplus is unchanged -- the generation is still there -- so the difference
        shows in `allocatable_surplus_kw` and in what the battery is actually given.
        """
        with_import = engine.evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=2.0, controllable_draw_kw=3.0))
        without = engine.evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=0.0, controllable_draw_kw=3.0))
        assert with_import.allocatable_surplus_kw < without.allocatable_surplus_kw
        assert with_import.battery_charge_kw < without.battery_charge_kw
        # and the generation it would not switch on is still accounted for
        assert with_import.gross_surplus_kw == pytest.approx(without.gross_surplus_kw)

    def test_a_small_import_is_left_alone_because_zero_export_inverters_hold_one(self, engine):
        """Upstream's IMPORT_DEADBAND_W: a Victron ESS holds about +50 W on purpose."""
        assert sem_surplus.IMPORT_DEADBAND_W == 100.0
        inside = engine.evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=0.05, controllable_draw_kw=3.0))
        none_at_all = engine.evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=0.0, controllable_draw_kw=3.0))
        assert inside.gross_surplus_kw == pytest.approx(none_at_all.gross_surplus_kw)

    def test_the_cars_own_grid_draw_is_not_charged_to_the_household_loads(self, engine):
        """A charger is decided first; what it draws past its sun is its own grid, not the loads'."""
        charged = engine.evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=2.0, controllable_draw_kw=3.0, ev_draw_kw=0.0))
        explained = engine.evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=2.0, controllable_draw_kw=3.0, ev_draw_kw=2.0))
        assert explained.allocatable_surplus_kw > charged.allocatable_surplus_kw

    def test_a_dark_meter_takes_nothing_off(self, engine):
        """`grid_import_kw=None` is no reading, which upstream treats as no evidence."""
        dark = engine.evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=None, controllable_draw_kw=3.0))
        assert dark.allocatable_surplus_kw == pytest.approx(3.0)


class TestNothingElseChanged:
    def test_energy_is_still_conserved_with_a_meter_reading(self, engine):
        for kwargs in (
            {"grid_export_kw": 1.0, "grid_import_kw": 0.0, "controllable_draw_kw": 2.0},
            {"grid_export_kw": 0.0, "grid_import_kw": 2.0, "controllable_draw_kw": 1.0},
            {"grid_export_kw": 0.0, "battery_discharge_kw": 1.0},
        ):
            r = engine.evaluate_interval(telemetry(solar_generation_kw=5.0, home_consumption_kw=2.0, **kwargs))
            assert r.is_balanced, (kwargs, r.energy_balance_error_kw)
            assert r.energy_balance_error_kw < 1e-4

    def test_the_result_still_carries_its_measurement_mode(self, engine):
        from avishkar_ems.home_profile import MeasurementMode

        r = engine.evaluate_interval(telemetry(
            grid_export_kw=1.0, measurement_mode=MeasurementMode.HARDWARE_MEASURED))
        assert r.measurement_mode == MeasurementMode.HARDWARE_MEASURED

    def test_missing_essential_telemetry_is_still_refused(self, engine):
        r = engine.evaluate_interval(IntervalTelemetry(
            solar_generation_kw=None, home_consumption_kw=2.0, grid_export_kw=1.0))
        assert r.status != "OPTIMAL"

    def test_a_simulated_interval_gives_the_same_answer_as_before_the_wiring(self, engine):
        """The what-if path is untouched: generation minus demand, to the last digit."""
        for pv, load in ((4.0, 1.5), (0.0, 2.0), (2.0, 2.0), (7.0, 0.5)):
            r = engine.evaluate_interval(telemetry(solar_generation_kw=pv, home_consumption_kw=load))
            expected = max(0.0, min(pv, engine.profile.inverter.rating_kw) - load)
            assert r.gross_surplus_kw == pytest.approx(expected), (pv, load)


class TestCurtailmentClosesTheBooks:
    """A defect found while wiring the above, and fixed with it.

    `DispatchStepResult` had no curtailment term and the first-law check had no term for it either, so
    a zero-export home whose battery was full simply lost the unusable generation: 5 kW of sun, 2 kW of
    load, nothing able to take the other 3 kW, and `is_balanced` went False with a 3 kW error and
    nothing in the result to point at. The physical answer is that the inverter throttles back.
    """

    @staticmethod
    def _zero_export_full_battery() -> HomeEnergyBalanceEngine:
        p = HomeProfile.create_phase7_demo_home()
        p.inverter.is_zero_export_enforced = True
        p.battery.current_soc_pct = p.battery.max_soc_pct  # nothing left to charge
        p.flexible_appliances = []
        p.ev_charger.is_connected = False
        return HomeEnergyBalanceEngine(p)

    def test_unusable_generation_is_curtailed_rather_than_lost(self):
        r = self._zero_export_full_battery().evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0))
        assert r.grid_export_kw == 0.0
        assert r.curtailed_solar_kw == pytest.approx(3.0)
        assert r.is_balanced, r.energy_balance_error_kw
        assert r.energy_balance_error_kw < 1e-3

    def test_it_says_so_rather_than_silently_dropping_it(self):
        r = self._zero_export_full_battery().evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0))
        said = " ".join(r.constraints_applied)
        assert "CURTAILED" in said
        assert "nowhere to go" in said

    def test_a_home_that_may_export_curtails_nothing(self):
        p = HomeProfile.create_phase7_demo_home()
        p.inverter.is_zero_export_enforced = False
        p.battery.current_soc_pct = p.battery.max_soc_pct
        p.flexible_appliances = []
        p.ev_charger.is_connected = False
        r = HomeEnergyBalanceEngine(p).evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0))
        assert r.curtailed_solar_kw == 0.0
        assert r.grid_export_kw == pytest.approx(3.0)
        assert r.is_balanced

    def test_the_meter_bounded_withholding_also_closes_the_books(self):
        """What the control signal refuses to switch on must still be accounted for."""
        r = self._zero_export_full_battery().evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=2.0, controllable_draw_kw=0.0))
        assert r.allocatable_surplus_kw < r.gross_surplus_kw
        assert r.is_balanced, r.energy_balance_error_kw
        assert r.curtailed_solar_kw == pytest.approx(r.gross_surplus_kw)


class TestTheBatteryReclaimIsWiredIn:
    """`sem_reclaim.reclaimable_battery_w` paired with `sem_surplus.solar_bounded_reclaim`.

    Upstream's pipeline allocates from `surplus + reclaim`: above the reserve floor, power going into
    the pack is power a higher-priority load may take instead. Only the sun-funded share counts, and
    the whole pool is bounded by the sun again -- the bound has to sit on the pool rather than on one
    addend, or an inverter filling its pack from the grid on its own time-of-use window funds a
    "solar only" load at one in the morning (upstream's #938).
    """

    @staticmethod
    def _engine() -> HomeEnergyBalanceEngine:
        p = HomeProfile.create_phase7_demo_home()
        p.battery.current_soc_pct = 60.0  # comfortably above the backup reserve
        return HomeEnergyBalanceEngine(p)

    #: A 0.5 kW import holds the meter-read pool below the accounting surplus, which is the only
    #: situation in which a reclaim can change anything: otherwise the `gross_surplus` cap binds first.
    _METERED = {
        "solar_generation_kw": 5.0, "home_consumption_kw": 2.0,
        "grid_export_kw": 0.0, "grid_import_kw": 0.5, "controllable_draw_kw": 1.0,
    }

    def test_power_going_into_the_pack_is_offered_to_loads_first(self):
        e = self._engine()
        without = e.evaluate_interval(telemetry(**self._METERED))
        with_pack = e.evaluate_interval(telemetry(**self._METERED, battery_charge_kw=1.5))
        assert with_pack.allocatable_surplus_kw > without.allocatable_surplus_kw
        assert "BATTERY_RECLAIM" in " ".join(with_pack.constraints_applied)

    def test_a_pack_charging_from_the_grid_yields_nothing(self):
        """The same positive charge power, but the meter shows the grid is paying for it."""
        e = self._engine()
        r = e.evaluate_interval(telemetry(
            solar_generation_kw=5.0, home_consumption_kw=2.0,
            grid_export_kw=0.0, grid_import_kw=3.4, controllable_draw_kw=3.0,
            battery_charge_kw=1.5))
        assert "BATTERY_RECLAIM" not in " ".join(r.constraints_applied)
        assert r.allocatable_surplus_kw == 0.0

    def test_below_the_backup_reserve_the_pack_keeps_its_charge(self):
        p = HomeProfile.create_phase7_demo_home()
        p.battery.current_soc_pct = p.battery.preferred_backup_reserve_pct - 5.0
        r = HomeEnergyBalanceEngine(p).evaluate_interval(telemetry(**self._METERED, battery_charge_kw=1.5))
        assert "BATTERY_RECLAIM" not in " ".join(r.constraints_applied)

    def test_a_commanded_pack_is_honoured(self):
        """A force charge or an arbitrage window is a command; upstream reclaims nothing from it."""
        r = self._engine().evaluate_interval(telemetry(
            **self._METERED, battery_charge_kw=1.5, battery_commanded=True))
        assert "BATTERY_RECLAIM" not in " ".join(r.constraints_applied)

    def test_the_reclaim_never_takes_the_pool_past_the_sun(self):
        e = self._engine()
        for solar in (0.5, 2.0, 5.0):
            for charge in (0.0, 1.0, 4.0):
                r = e.evaluate_interval(telemetry(
                    solar_generation_kw=solar, home_consumption_kw=0.2,
                    grid_export_kw=0.0, grid_import_kw=0.3, controllable_draw_kw=0.5,
                    battery_charge_kw=charge))
                assert r.allocatable_surplus_kw <= r.solar_generation_kw + 1e-9, (solar, charge)

    def test_the_books_still_close_with_a_reclaim(self):
        e = self._engine()
        for charge in (0.0, 0.8, 1.5, 3.0):
            r = e.evaluate_interval(telemetry(**self._METERED, battery_charge_kw=charge))
            assert r.is_balanced, (charge, r.energy_balance_error_kw)

    def test_no_battery_reading_means_no_reclaim_and_no_claim_about_one(self):
        r = self._engine().evaluate_interval(telemetry(**self._METERED))
        assert "BATTERY_RECLAIM" not in " ".join(r.constraints_applied)
