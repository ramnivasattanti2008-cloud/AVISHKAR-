"""Upstream SEM's own tests, run against AVISHKAR's vendored copy of its surplus arithmetic.

This file is how `avishkar_ems.vendor.sem_surplus` is known to be a faithful copy rather than a
paraphrase. The four test classes below are **verbatim** from SEM at commit
067c8615a36fbad2cc912a005f63525038093b07 (MIT, Copyright (c) 2025 belinea4071), extracted with
`ast.get_source_segment` and not retyped. Only the import line differs: they import from
`avishkar_ems.vendor.sem_surplus` instead of
`custom_components.solar_energy_management.coordinator.surplus_controller`, which is the whole point
-- if AVISHKAR's copy had drifted from upstream, these would fail.

Upstream sources:

  tests/test_1112_solar_only_load_never_uses_the_pack.py  TestTheDeficitCountsThePack   lines 186-197
  tests/test_938_night_reclaim_solar_bound.py             TestSolarBoundedReclaim       lines 169-204
  tests/test_953_cheap_hours_finish_window.py             TestSunCanStillFinish         lines  71-117
  tests/test_953_cheap_hours_finish_window.py             TestPriceDampedPool           lines 124-147

Three more classes were added once `coordinator/energy_reclaim.py` was vendored as well
(`avishkar_ems/vendor/sem_reclaim.py`), since they exercise its functions:

  tests/test_1102_import_counts_against_loads.py        TestThePoolKeepsTheImport         lines  71-206
  tests/test_1102_import_counts_against_loads.py        TestOnlyAnImportThatLastedCounts  lines 678-748
  tests/test_1102_import_counts_against_loads.py        TestWhatOpensTheWindow            lines 824-874

One pure class in upstream's suite is still deliberately NOT here:
`TestNothingWaitsForAnHourThatCannotCome` needs SEM's tariff provider and its `EnergyAssistant`,
which AVISHKAR did not vendor, so running it would prove nothing about this copy.

AVISHKAR's own tests for how these functions are *used* -- the wiring into the home balance engine
and the surplus engine -- are in `test_surplus_vendor_wiring.py`. This file only pins the copy.
"""

from __future__ import annotations

import pytest

from avishkar_ems.vendor.sem_reclaim import (
    CAR_START_HOLD_S,
    LOADS_IMPORT_SUSTAIN_S,
    car_may_be_charging,
    reclaimable_battery_w,
    sustained_car_draw,
    sustained_import,
)
from avishkar_ems.vendor.sem_surplus import (
    IMPORT_DEADBAND_W,
    import_absorbed_by_loads_w,
    loads_import_deficit_w,
    price_damped_pool,
    solar_bounded_reclaim,
    solar_bounded_surplus,
    sun_can_still_finish,
)

# Upstream test_1102_import_counts_against_loads.py lines 63-64, verbatim: @lostcontrol's reported
# setup -- a 5.2 kW array and a 3 kW boiler.
SOLAR_W = 5200.0
BOILER_W = 3000.0

# Upstream test_953_cheap_hours_finish_window.py lines 61-64, verbatim.
H = 3600.0
#: The reporter's morning: sunrise 07:52, sunset 20:30, screenshot at 08:24.
DAYLIGHT_AT_0752 = 12.6 * H
DEFICIT_4H = 4 * H


# ---------------------------------------------------------------------------
# Verbatim from SEM tests/test_1112_solar_only_load_never_uses_the_pack.py, lines 186-197.
# ---------------------------------------------------------------------------
class TestTheDeficitCountsThePack:
    def test_discharge_counts_like_import(self):
        assert loads_import_deficit_w(0.0, battery_discharge_w=1300.0) == \
            pytest.approx(1300.0 - IMPORT_DEADBAND_W)

    def test_the_cars_draw_explains_it(self):
        assert loads_import_deficit_w(
            0.0, ev_draw_w=2000.0, battery_discharge_w=1300.0) == 0.0

    def test_no_discharge_is_the_old_answer(self):
        assert loads_import_deficit_w(500.0) == loads_import_deficit_w(
            500.0, battery_discharge_w=0.0)


# ---------------------------------------------------------------------------
# Verbatim from SEM tests/test_938_night_reclaim_solar_bound.py, lines 169-204.
# ---------------------------------------------------------------------------
class TestSolarBoundedReclaim:
    def test_night_pins_the_reclaim_to_zero(self):
        # Sun 0 W, export surplus 0 W: whatever the pack is drawing, none of it
        # is surplus. This alone closes the reporter's night even with a dark
        # grid meter (import read as 0 → ceiling 1 is inert).
        assert solar_bounded_reclaim(3000.0, surplus_w=0.0, solar_w=0.0) == 0.0

    def test_day_with_room_passes_through(self):
        assert solar_bounded_reclaim(1800.0, surplus_w=700.0, solar_w=3000.0) == 1800.0

    def test_pool_is_clipped_to_the_sun(self):
        # 400 W export surplus + 3 kW "reclaim" with 1 kW of sun → 600 W is all
        # the sun has left once the export half is counted.
        assert solar_bounded_reclaim(3000.0, surplus_w=400.0, solar_w=1000.0) == 600.0

    def test_surplus_already_at_the_sun_leaves_nothing(self):
        assert solar_bounded_reclaim(500.0, surplus_w=1000.0, solar_w=1000.0) == 0.0

    def test_no_solar_reading_reclaims_nothing(self):
        # Unlike solar_bounded_surplus (export IS evidence of the sun), a
        # charging battery with no sun reading is no evidence at all.
        assert solar_bounded_reclaim(1500.0, surplus_w=0.0, solar_w=None) == 0.0

    def test_negative_or_none_reclaim_is_zero(self):
        assert solar_bounded_reclaim(-200.0, surplus_w=0.0, solar_w=5000.0) == 0.0
        assert solar_bounded_reclaim(None, surplus_w=0.0, solar_w=5000.0) == 0.0

    def test_invariant_holds_across_a_sweep(self):
        # surplus + bounded_reclaim ≤ solar, for every combination.
        for solar in (0.0, 300.0, 1000.0, 5000.0):
            for surplus in (0.0, 200.0, 1000.0):
                s = solar_bounded_surplus(grid_export_w=surplus, active_draw_w=0.0, solar_w=solar)
                for reclaim in (0.0, 500.0, 3000.0):
                    r = solar_bounded_reclaim(reclaim, surplus_w=s, solar_w=solar)
                    assert s + r <= solar + 1e-9, (solar, surplus, reclaim)
                    assert r >= 0.0


# ---------------------------------------------------------------------------
# Verbatim from SEM tests/test_953_cheap_hours_finish_window.py, lines 71-117.
# ---------------------------------------------------------------------------
class TestSunCanStillFinish:
    def test_the_reporters_morning_defers_to_the_sun(self):
        # 12.6 h of daylight ahead, 4 h still owed → the sun has time.
        assert sun_can_still_finish(
            DEFICIT_4H, daylight_remaining_s=DAYLIGHT_AT_0752, is_night=False)

    def test_the_tail_of_the_day_lets_the_meter_pay(self):
        # 17:30, sunset 20:30: 3 h left cannot cover 4 h → grid may finish.
        assert not sun_can_still_finish(
            DEFICIT_4H, daylight_remaining_s=3 * H, is_night=False)

    def test_night_is_never_blocked_whatever_the_sunset_reading_says(self):
        # The picker's promise rides on is_night alone — TimeManager's clock
        # fallback, not the sun entity. Even a nonsense daylight figure at
        # 03:00 must not withhold the overnight top-up.
        assert not sun_can_still_finish(
            DEFICIT_4H, daylight_remaining_s=12 * H, is_night=True)

    def test_no_sun_data_is_not_a_claim_about_the_sun(self):
        assert not sun_can_still_finish(
            DEFICIT_4H, daylight_remaining_s=None, is_night=False)

    def test_nothing_owed_is_not_a_deferral(self):
        assert not sun_can_still_finish(
            0.0, daylight_remaining_s=DAYLIGHT_AT_0752, is_night=False)

    def test_exactly_enough_daylight_still_belongs_to_the_sun(self):
        assert sun_can_still_finish(
            4 * H, daylight_remaining_s=4 * H, is_night=False)

    def test_it_cannot_flap_once_it_opens(self):
        # While the load runs, the deficit and the daylight both shrink one
        # second per second, so their difference is constant; while it is off
        # only the daylight shrinks. Walk a day at 10-minute steps from the
        # moment the gate opens and assert it never closes again.
        deficit, daylight, opened = DEFICIT_4H, 4 * H + 600.0, False
        for _ in range(60):
            blocked = sun_can_still_finish(
                deficit, daylight_remaining_s=daylight, is_night=False)
            if opened:
                assert not blocked, (deficit, daylight)
            elif not blocked:
                opened = True
            daylight = max(0.0, daylight - 600.0)
            if not blocked:                      # running: the deficit closes
                deficit = max(0.0, deficit - 600.0)
        assert opened


# ---------------------------------------------------------------------------
# Verbatim from SEM tests/test_953_cheap_hours_finish_window.py, lines 124-147.
# ---------------------------------------------------------------------------
class TestPriceDampedPool:
    def test_a_cheap_hour_no_longer_fabricates_three_kilowatts(self):
        assert price_damped_pool(80.0, "cheap") == 80.0

    def test_a_negative_hour_no_longer_fabricates_ten(self):
        assert price_damped_pool(80.0, "negative") == 80.0

    def test_very_cheap_is_not_a_loophole(self):
        assert price_damped_pool(80.0, "very_cheap") == 80.0

    def test_an_expensive_hour_still_damps(self):
        assert price_damped_pool(2000.0, "expensive") == 1500.0

    def test_damping_never_goes_below_zero(self):
        assert price_damped_pool(200.0, "expensive") == 0.0

    def test_normal_passes_through(self):
        assert price_damped_pool(1234.0, "normal") == 1234.0

    def test_no_level_can_raise_the_pool(self):
        for level in ("negative", "very_cheap", "cheap", "normal",
                      "expensive", "very_expensive", "", "nonsense"):
            for pool in (0.0, 78.0, 1500.0, 9000.0):
                assert price_damped_pool(pool, level) <= pool, (level, pool)


# ---------------------------------------------------------------------------
# Verbatim from SEM tests/test_1102_import_counts_against_loads.py lines 71-206
class TestThePoolKeepsTheImport:
    def test_reporters_numbers(self):
        # 2 kW imported with the 3 kW boiler on → about 1 kW would be left
        # if it were off (less the 100 W deadband). The old pool said 3 kW.
        assert solar_bounded_surplus(
            grid_export_w=0.0, active_draw_w=BOILER_W, solar_w=SOLAR_W,
            grid_import_w=2000.0,
        ) == pytest.approx(BOILER_W - 2000.0 + IMPORT_DEADBAND_W)

    def test_the_old_call_lost_it(self):
        # The pre-fix call shape — no import — is the 3 kW the boiler rode on.
        assert solar_bounded_surplus(
            grid_export_w=0.0, active_draw_w=BOILER_W, solar_w=SOLAR_W,
        ) == pytest.approx(BOILER_W)

    def test_import_larger_than_the_draw_floors_at_zero(self):
        assert solar_bounded_surplus(
            grid_export_w=0.0, active_draw_w=BOILER_W, solar_w=SOLAR_W,
            grid_import_w=3500.0,
        ) == 0.0

    def test_a_zero_export_setpoint_is_not_a_deficit(self):
        # Victron ESS holds +50 W of import by default: the pool must not
        # read that as the loads running on the grid.
        assert solar_bounded_surplus(
            grid_export_w=0.0, active_draw_w=BOILER_W, solar_w=SOLAR_W,
            grid_import_w=50.0,
        ) == pytest.approx(BOILER_W)
        assert IMPORT_DEADBAND_W == 100.0

    def test_the_chargers_own_grid_draw_is_not_the_loads(self):
        # A Min+Solar car at its 6 A floor (4.14 kW) imports 2.1 kW; a
        # running boiler ranked above the charger keeps its sun (#885).
        assert solar_bounded_surplus(
            grid_export_w=0.0, active_draw_w=BOILER_W, solar_w=6000.0,
            grid_import_w=2140.0, ev_draw_w=4140.0,
        ) == pytest.approx(BOILER_W)

    def test_import_past_the_chargers_draw_is_the_houses(self):
        assert solar_bounded_surplus(
            grid_export_w=0.0, active_draw_w=BOILER_W, solar_w=SOLAR_W,
            grid_import_w=3000.0, ev_draw_w=1000.0,
        ) == pytest.approx(BOILER_W - 2000.0 + IMPORT_DEADBAND_W)

    @staticmethod
    def _addends(*, solar, draw, charge, imp, export=0.0):
        surplus = solar_bounded_surplus(
            grid_export_w=export, active_draw_w=draw, solar_w=solar,
            grid_import_w=imp)
        absorbed = import_absorbed_by_loads_w(
            grid_export_w=export, active_draw_w=draw, grid_import_w=imp)
        reclaim = solar_bounded_reclaim(
            reclaimable_battery_w(
                battery_charge_power=charge, soc=60.0, priority_soc=30.0,
                battery_commanded=False, grid_import_w=imp,
                absorbed_w=absorbed),
            surplus_w=surplus, solar_w=solar)
        return surplus, reclaim

    def test_a_load_below_a_grid_charging_battery_pays_the_import(self):
        # An inverter's own daytime grid charge (5 kW): sun 4 kW, house
        # 0.5 kW, boiler 3 kW → 4.5 kW imported. The pack does not yield,
        # so a boiler BELOW the battery (export side only) is on the grid.
        surplus, _ = self._addends(solar=4000.0, draw=BOILER_W,
                                   charge=5000.0, imp=4500.0)
        assert surplus == 0.0

    def test_a_load_above_a_charging_pack_pays_the_import_once(self):
        # A single-phase hybrid on a summed meter: sun 4.3 kW, house 1.5 kW,
        # and the meter shows 300 W of import while the pack charges from
        # the sun. A 1 kW pump above the battery takes its watts from the
        # pack's charge. The pool must read the same with the pump off and
        # on — paying the 300 W twice once running made it cycle.
        imp = 300.0
        off_s, off_r = self._addends(solar=4300.0, draw=0.0, charge=3100.0, imp=imp)
        on_s, on_r = self._addends(solar=4300.0, draw=1000.0, charge=2100.0, imp=imp)
        assert on_s + on_r == pytest.approx(off_s + off_r)
        assert off_s + off_r == pytest.approx(3100.0 - imp)

    def test_meter_never_read_takes_nothing_off(self):
        # None = no readable meter yet this lifetime: the running loads keep
        # what they hold (the export side reads 0 too), nothing new starts.
        assert solar_bounded_surplus(
            grid_export_w=0.0, active_draw_w=BOILER_W, solar_w=SOLAR_W,
            grid_import_w=None,
        ) == pytest.approx(BOILER_W)

    def test_export_and_sun_cap_unchanged(self):
        assert solar_bounded_surplus(
            grid_export_w=500.0, active_draw_w=1000.0, solar_w=5000.0,
            grid_import_w=0.0,
        ) == pytest.approx(1500.0)
        assert solar_bounded_surplus(
            grid_export_w=0.0, active_draw_w=1600.0, solar_w=800.0,
            grid_import_w=0.0,
        ) == pytest.approx(800.0)

    def test_the_two_addends_are_the_whole_balance(self):
        """Over a grid of meter / pack / load states: export surplus plus
        the reclaim is ``draw + export + charge − import``, bounded by 0 and
        the sun (the 100 W deadband excused only where no charge stands
        beside the import). Before the fix the sum lost the import whenever
        no charge stood beside it."""
        exact = overlap = 0
        for solar in (0.0, 800.0, 5200.0):
            for draw in (0.0, 1000.0, 3000.0):
                for charge in (0.0, 1000.0, 3000.0):
                    for grid in (-4000.0, -2000.0, -500.0, -60.0, 0.0, 700.0, 2500.0):
                        export, imp = max(0.0, grid), max(0.0, -grid)
                        s = solar_bounded_surplus(
                            grid_export_w=export, active_draw_w=draw,
                            solar_w=solar, grid_import_w=imp)
                        r = solar_bounded_reclaim(
                            reclaimable_battery_w(
                                battery_charge_power=charge, soc=60.0,
                                priority_soc=30.0, battery_commanded=False,
                                grid_import_w=imp,
                                absorbed_w=import_absorbed_by_loads_w(
                                    grid_export_w=export, active_draw_w=draw,
                                    grid_import_w=imp)),
                            surplus_w=s, solar_w=solar)
                        counted = max(0.0, imp - IMPORT_DEADBAND_W)
                        want = min(solar, max(0.0, draw + export + charge - counted))
                        if charge > 0.0 and imp > 0.0:
                            # the reclaim keeps #938's raw import: the
                            # deadband is not excused on the pack's side
                            raw = min(solar, max(0.0, draw + export + charge - imp))
                            assert s + r == pytest.approx(raw), (
                                solar, draw, charge, grid)
                            overlap += 1
                        else:
                            assert s + r == pytest.approx(want), (
                                solar, draw, charge, grid)
                            exact += 1
        assert exact == 3 * 3 * 1 * 7 + 3 * 3 * 2 * 3
        assert overlap == 3 * 3 * 2 * 4


# ---------------------------------------------------------------------------
# Verbatim from SEM tests/test_1102_import_counts_against_loads.py lines 678-748
class TestOnlyAnImportThatLastedCounts:
    @staticmethod
    def _feed(state, readings, *, car):
        out = None
        for t, w in readings:
            out = sustained_import(state, t, grid_import_w=w,
                                   grid_import_known=True, car_active=car)
        return out

    def test_no_car_is_the_mean_of_two_minutes(self):
        st = {}
        assert self._feed(st, [(0.0, 0.0), (10.0, 2500.0)], car=False) == 1250.0
        steady = [(10.0 + t * 10.0, 2500.0) for t in range(1, 13)]
        assert self._feed(st, steady, car=False) == 2500.0

    def test_a_charging_car_counts_the_lowest_of_two_minutes(self):
        st = {}
        quiet = [(t * 10.0, 0.0) for t in range(15)]       # 0–140 s
        assert self._feed(st, quiet, car=False) == 0.0
        assert self._feed(st, [(150.0, 8000.0)], car=True) == 0.0
        lasting = [(150.0 + t * 10.0, 8000.0) for t in range(1, 14)]
        assert self._feed(st, lasting, car=True) == 8000.0

    def test_after_a_restart_a_charging_cars_import_waits(self):
        st = {}
        assert self._feed(st, [(0.0, 3000.0), (60.0, 3000.0)], car=True) == 0.0
        assert self._feed(st, [(130.0, 3000.0)], car=True) == 3000.0

    def test_a_dark_meter_is_no_evidence(self):
        st = {}
        self._feed(st, [(t * 10.0, 0.0) for t in range(20)], car=False)
        assert sustained_import(st, 200.0, grid_import_w=0.0,
                                grid_import_known=False, car_active=True) is None

    def test_a_blink_keeps_the_history(self):
        # Two minutes of a steady 4 kW house import while a car is plugged
        # in, then one dark cycle: the import still counts on the next one.
        # Clearing the history on a blink gave the house two more minutes
        # of uncounted import every time (class 58).
        st = {}
        lasting = [(t * 10.0, 4000.0) for t in range(14)]
        assert self._feed(st, lasting, car=True) == 4000.0
        assert sustained_import(st, 140.0, grid_import_w=0.0,
                                grid_import_known=False, car_active=True) is None
        assert self._feed(st, [(150.0, 4000.0)], car=True) == 4000.0

    def test_a_gap_longer_than_the_window_starts_over(self):
        st = {}
        self._feed(st, [(t * 10.0, 0.0) for t in range(5)], car=True)
        for t in range(5, 20):   # 150 s dark
            sustained_import(st, t * 10.0, grid_import_w=0.0,
                             grid_import_known=False, car_active=True)
        assert self._feed(st, [(200.0, 4000.0)], car=True) == 0.0
        lasting = [(200.0 + t * 10.0, 4000.0) for t in range(1, 13)]
        assert self._feed(st, lasting, car=True) == 4000.0

    def test_negative_reads_as_zero(self):
        assert self._feed({}, [(0.0, -300.0)], car=False) == 0.0

    def test_the_cars_share_is_its_highest_draw_while_it_may_charge(self):
        st = {}
        for t, w in [(0.0, 11000.0), (60.0, 11000.0), (70.0, 4100.0)]:
            got = sustained_car_draw(st, t, ev_draw_w=w, car_active=True)
        assert got == 11000.0
        assert sustained_car_draw(st, 200.0, ev_draw_w=4100.0,
                                  car_active=True) == 4100.0
        assert sustained_car_draw(st, 210.0, ev_draw_w=300.0,
                                  car_active=False) == 300.0

    def test_the_window_is_two_minutes(self):
        assert LOADS_IMPORT_SUSTAIN_S == 120.0


# ---------------------------------------------------------------------------
# Verbatim from SEM tests/test_1102_import_counts_against_loads.py lines 824-874
class TestWhatOpensTheWindow:
    @staticmethod
    def _at(st, t, *, plugged=False, amps=0, draw=0.0):
        return car_may_be_charging(st, t, plugged=plugged,
                                   commanded_amps=amps, ev_draw_w=draw)

    def test_a_plug_in_opens_it_for_a_while_then_it_closes(self):
        st = {}
        assert not self._at(st, 0.0)
        assert self._at(st, 10.0, plugged=True)                # plugged in
        assert self._at(st, 10.0 + CAR_START_HOLD_S, plugged=True)
        # still plugged, full, drawing nothing: the window closes
        assert not self._at(st, 20.0 + CAR_START_HOLD_S, plugged=True)

    def test_a_rising_offer_opens_it_a_steady_one_does_not_keep_it(self):
        st = {}
        assert self._at(st, 0.0, plugged=True, amps=6)
        assert not self._at(st, 10.0 + CAR_START_HOLD_S, plugged=True, amps=6)
        assert self._at(st, 20.0 + CAR_START_HOLD_S, plugged=True, amps=10)

    def test_a_stop_opens_it_too(self):
        # The meter still shows the car's import after the charger reads
        # 0 W: a falling draw, a falling offer and an unplug each open it,
        # and it closes again once nothing changes.
        h = CAR_START_HOLD_S
        for before, after in (
                ({"plugged": True, "amps": 16, "draw": 11000.0},
                 {"plugged": True, "amps": 16, "draw": 0.0}),
                ({"plugged": True, "amps": 16, "draw": 0.0},
                 {"plugged": True, "amps": 0, "draw": 0.0}),
                ({"plugged": True, "amps": 0, "draw": 0.0},
                 {"plugged": False, "amps": 0, "draw": 0.0})):
            st = {}
            self._at(st, 0.0, **before)
            self._at(st, 10.0 + h, **before)
            if before["draw"] == 0.0:
                assert not self._at(st, 20.0 + h, **before)
            assert self._at(st, 30.0 + h, **after)
            assert self._at(st, 30.0 + 2 * h, **after)
            assert not self._at(st, 40.0 + 2 * h, **after)

    def test_a_real_draw_keeps_it_open(self):
        st = {}
        self._at(st, 0.0, plugged=True, amps=16)
        assert self._at(st, 3600.0, plugged=True, amps=16, draw=11000.0)

    def test_a_chargers_standby_is_not_a_car(self):
        # KEBA idles at 110-140 W (#739): that must not hold the window
        # open all day.
        for standby in (0.0, 90.0, 140.0, 500.0):
            assert not self._at({}, 0.0, draw=standby)
