"""Peer-to-peer exchange between two homes: the physics, the caps, the money and the refusals.

`route_community_exchange` is what `app/home_setup_view.py` calls to show a trade between one home and a
neighbour. It was imported by the dashboard before it existed, which left the dashboard unable to start at
all; these tests hold it to what that page shows.
"""

from __future__ import annotations

import math

import pytest

from avishkar_ems.home_balance import route_community_exchange

# The prices the dashboard passes: a community clearing price between the DISCOM's export and retail rates.
PRICES = {
    "community_clearing_price_inr": 5.50,
    "discom_retail_tariff_inr": 8.00,
    "discom_export_tariff_inr": 3.00,
}
# The feeder the dashboard models.
FEEDER = {"feeder_resistance_ohms": 0.08, "feeder_voltage_v": 230.0}


def exchange(**over):
    kwargs = {
        "seller_home_id": "my_home",
        "surplus_kw": 1.5,
        "seller_opted_in": True,
        "buyer_home_id": "neighbour",
        "buyer_opted_in": True,
        "buyer_deficit_kw": 2.0,
        **FEEDER,
        **PRICES,
    }
    kwargs.update(over)
    return route_community_exchange(**kwargs)


class TestTheTransfer:
    def test_sends_the_smaller_of_what_is_spare_and_what_is_needed(self):
        # 1.5 kW spare against a 2 kW shortfall: the seller's surplus is what binds.
        limited_by_seller = exchange(surplus_kw=1.5, buyer_deficit_kw=2.0)
        assert limited_by_seller["transferred_kw"] == pytest.approx(1.5)
        assert limited_by_seller["binding_constraint"] == "SELLER_SURPLUS"

        # 5 kW spare against a 2 kW shortfall: now the buyer's need binds, and nothing more is sent.
        limited_by_buyer = exchange(surplus_kw=5.0, buyer_deficit_kw=2.0)
        assert limited_by_buyer["transferred_kw"] == pytest.approx(2.0)
        assert limited_by_buyer["binding_constraint"] == "BUYER_DEFICIT"

    def test_a_transfer_limit_caps_it_and_is_named(self):
        res = exchange(surplus_kw=5.0, buyer_deficit_kw=4.0, transfer_limit_kw=1.0)
        assert res["transferred_kw"] == pytest.approx(1.0)
        assert res["binding_constraint"] == "TRANSFER_LIMIT"
        assert "transfer limit of 1.0 kW" in res["reason"]

    def test_never_counts_the_same_energy_twice(self):
        res = exchange(surplus_kw=5.0, buyer_deficit_kw=2.0)
        # What arrived is taken off the buyer's shortfall; what it still buys is the rest, and no less.
        assert res["buyer_residual_grid_import_kw"] == pytest.approx(2.0 - res["delivered_to_buyer_kw"], abs=1e-6)
        # What the seller could not place is what it still exports.
        assert res["seller_residual_grid_export_kw"] == pytest.approx(5.0 - res["transferred_kw"], abs=1e-6)
        assert res["buyer_residual_grid_import_kw"] >= 0
        assert res["seller_residual_grid_export_kw"] >= 0

    def test_energy_is_conserved_across_the_feeder(self):
        res = exchange(surplus_kw=3.0, buyer_deficit_kw=3.0)
        assert res["transferred_kw"] == pytest.approx(res["delivered_to_buyer_kw"] + res["line_loss_kw"], abs=1e-6)


class TestTheLoss:
    def test_is_i_squared_r_at_the_stated_voltage(self):
        res = exchange(surplus_kw=1.5, buyer_deficit_kw=2.0)
        current = 1.5 * 1000.0 / 230.0
        assert res["line_current_a"] == pytest.approx(current, abs=0.01)
        assert res["line_loss_kw"] == pytest.approx(current**2 * 0.08 / 1000.0, abs=1e-5)

    def test_grows_with_the_square_of_the_power(self):
        one = exchange(surplus_kw=1.0, buyer_deficit_kw=9.0)["line_loss_kw"]
        two = exchange(surplus_kw=2.0, buyer_deficit_kw=9.0)["line_loss_kw"]
        # Doubling the power quadruples the loss: that is what makes it resistive rather than a flat fraction.
        assert two == pytest.approx(4 * one, abs=2e-6)  # the reported figures are rounded to six places

    def test_falls_with_the_square_of_the_voltage(self):
        low = exchange(surplus_kw=2.0, buyer_deficit_kw=9.0, feeder_voltage_v=230.0)["line_loss_kw"]
        high = exchange(surplus_kw=2.0, buyer_deficit_kw=9.0, feeder_voltage_v=460.0)["line_loss_kw"]
        assert high == pytest.approx(low / 4, abs=2e-6)  # the reported figures are rounded to six places

    def test_a_lossless_feeder_delivers_everything(self):
        res = exchange(surplus_kw=2.0, buyer_deficit_kw=2.0, feeder_resistance_ohms=0.0)
        assert res["line_loss_kw"] == 0.0
        assert res["delivered_to_buyer_kw"] == pytest.approx(2.0)

    def test_refuses_the_transfer_when_the_feeder_would_eat_all_of_it(self):
        # A long thin line at low voltage: the loss exceeds what was sent, so nothing can arrive.
        res = exchange(surplus_kw=20.0, buyer_deficit_kw=20.0, feeder_resistance_ohms=40.0, feeder_voltage_v=230.0)
        assert res["eligible"] is False
        assert res["transferred_kw"] == 0.0
        assert res["delivered_to_buyer_kw"] == 0.0
        assert "cannot carry this transfer" in res["reason"]
        # And the buyer is left buying its whole shortfall, not a negative amount.
        assert res["buyer_residual_grid_import_kw"] == pytest.approx(20.0)

    def test_never_reports_a_negative_delivery_over_a_sweep(self):
        for kw in (0.5, 1, 3, 7.5, 15):
            for ohms in (0.0, 0.05, 0.5, 2.0, 10.0):
                for volts in (230.0, 415.0):
                    res = exchange(surplus_kw=kw, buyer_deficit_kw=kw, feeder_resistance_ohms=ohms, feeder_voltage_v=volts)
                    assert res["delivered_to_buyer_kw"] >= 0, (kw, ohms, volts)
                    assert res["line_loss_kw"] >= 0, (kw, ohms, volts)
                    assert math.isfinite(res["delivered_to_buyer_kw"])
                    if res["eligible"]:
                        assert res["transferred_kw"] == pytest.approx(res["delivered_to_buyer_kw"] + res["line_loss_kw"], abs=1e-6)


class TestTheMoney:
    def test_pays_the_seller_the_difference_over_exporting(self):
        res = exchange(surplus_kw=2.0, buyer_deficit_kw=2.0, feeder_resistance_ohms=0.0, duration_hours=1.0)
        # 2 kWh at INR 5.50 instead of INR 3.00.
        assert res["seller_benefit_inr"] == pytest.approx(2.0 * (5.50 - 3.00), abs=0.01)

    def test_charges_the_buyer_less_than_the_retail_tariff(self):
        res = exchange(surplus_kw=2.0, buyer_deficit_kw=2.0, feeder_resistance_ohms=0.0, duration_hours=1.0)
        assert res["buyer_benefit_inr"] == pytest.approx(2.0 * (8.00 - 5.50), abs=0.01)
        assert res["combined_social_benefit_inr"] == pytest.approx(res["seller_benefit_inr"] + res["buyer_benefit_inr"], abs=0.01)

    def test_scales_with_the_length_of_the_interval(self):
        hour = exchange(surplus_kw=2.0, buyer_deficit_kw=2.0, feeder_resistance_ohms=0.0, duration_hours=1.0)
        quarter = exchange(surplus_kw=2.0, buyer_deficit_kw=2.0, feeder_resistance_ohms=0.0, duration_hours=0.25)
        assert quarter["combined_social_benefit_inr"] == pytest.approx(hour["combined_social_benefit_inr"] / 4, abs=0.01)

    def test_reports_the_loss_nobody_pays_for_on_its_own_line(self):
        res = exchange(surplus_kw=5.0, buyer_deficit_kw=5.0)
        # The seller is paid for what left; the buyer pays for what arrived; the difference is the network's.
        assert res["network_absorbed_loss_inr"] == pytest.approx(res["line_loss_kw"] * 5.50, abs=0.01)
        assert res["network_absorbed_loss_inr"] > 0

    def test_says_so_when_the_clearing_price_makes_a_side_worse_off(self):
        bad_for_seller = exchange(community_clearing_price_inr=2.0)
        assert bad_for_seller["seller_benefit_inr"] < 0
        assert any("below the DISCOM export tariff" in a for a in bad_for_seller["assumptions"])

        bad_for_buyer = exchange(community_clearing_price_inr=9.0)
        assert bad_for_buyer["buyer_benefit_inr"] < 0
        assert any("above the retail tariff" in a for a in bad_for_buyer["assumptions"])

    def test_uses_only_the_prices_it_was_given(self):
        res = exchange(community_clearing_price_inr=4.0, discom_retail_tariff_inr=10.0, discom_export_tariff_inr=1.0, feeder_resistance_ohms=0.0, surplus_kw=1.0, buyer_deficit_kw=1.0)
        assert res["seller_benefit_inr"] == pytest.approx(1.0 * (4.0 - 1.0), abs=0.01)
        assert res["buyer_benefit_inr"] == pytest.approx(1.0 * (10.0 - 4.0), abs=0.01)


class TestOptingIn:
    def test_a_home_that_has_not_opted_in_shares_nothing_and_still_works(self):
        res = exchange(seller_opted_in=False)
        assert res["eligible"] is False
        assert res["transferred_kw"] == 0.0
        assert "my_home has not opted in" in res["reason"]
        # It simply exports as it would have alone: community membership is optional, not required.
        assert res["seller_residual_grid_export_kw"] == pytest.approx(1.5)
        assert res["buyer_residual_grid_import_kw"] == pytest.approx(2.0)

    def test_names_whichever_side_has_not_opted_in(self):
        assert "neighbour has not opted in" in exchange(buyer_opted_in=False)["reason"]
        assert "Neither home has opted in" in exchange(seller_opted_in=False, buyer_opted_in=False)["reason"]

    def test_nothing_to_share_and_nothing_needed_are_both_said_plainly(self):
        assert "no surplus to offer" in exchange(surplus_kw=0.0)["reason"]
        assert "not short of anything" in exchange(buyer_deficit_kw=0.0)["reason"]

    def test_negative_figures_are_treated_as_nothing_rather_than_reversing_the_trade(self):
        assert exchange(surplus_kw=-5.0)["transferred_kw"] == 0.0
        assert exchange(buyer_deficit_kw=-5.0)["transferred_kw"] == 0.0


class TestHonesty:
    def test_says_it_moves_no_electricity_and_claims_nothing_about_what_is_allowed(self):
        notes = " ".join(exchange()["notes"])
        assert "does not move electricity" in notes
        assert "depends on the law" in notes
        assert "not a measurement" in notes

    def test_states_the_limits_of_the_loss_model(self):
        notes = " ".join(exchange()["notes"])
        assert "unity power factor" in notes
        assert "lumped" in notes
        assert "three-phase" in notes

    def test_calls_the_clearing_price_an_assumption(self):
        assert any("not one anybody has agreed" in a for a in exchange()["assumptions"])

    def test_every_refusal_carries_the_same_notes_as_a_trade(self):
        for res in (exchange(seller_opted_in=False), exchange(surplus_kw=0.0), exchange()):
            assert "does not move electricity" in " ".join(res["notes"])
            assert res["duration_hours"] == 1.0

    def test_refuses_input_that_is_not_a_feeder(self):
        with pytest.raises(ValueError, match="feeder_voltage_v"):
            exchange(feeder_voltage_v=0.23)  # kV mistaken for V
        with pytest.raises(ValueError, match="resistance cannot be negative"):
            exchange(feeder_resistance_ohms=-1.0)
        with pytest.raises(ValueError, match="duration_hours"):
            exchange(duration_hours=0.0)

    def test_is_deterministic(self):
        assert exchange() == exchange()


class TestWhatTheDashboardReads:
    """The keys app/home_setup_view.py puts straight on the page."""

    def test_has_every_key_the_page_shows(self):
        for res in (exchange(), exchange(seller_opted_in=False)):
            for key in ("transferred_kw", "delivered_to_buyer_kw", "line_loss_kw", "combined_social_benefit_inr"):
                assert key in res, key
                assert isinstance(res[key], (int, float)), key

    def test_the_whole_result_is_json_serialisable_because_the_page_dumps_it(self):
        import json

        json.dumps(exchange())
        json.dumps(exchange(buyer_opted_in=False))
