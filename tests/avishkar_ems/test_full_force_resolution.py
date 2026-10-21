"""Automated test suite for physical battery models, double-sided auction, anti-islanding watchdog, and Beckn REST API."""

from avishkar_ems.battery_physics import (
    calculate_arrhenius_thermal_factor,
    calculate_dod_stress_factor,
    calculate_dynamic_inverter_efficiency,
    evaluate_lfp_battery_physics,
)
from avishkar_ems.market_auction import MarketOrder, MicrogridAuctionEngine
from avishkar_ems.anti_islanding import AntiIslandingWatchdog
from avishkar_ems.api_service import UrjaSetuApiService


def test_battery_physics_lfp():
    # 1. Thermal Arrhenius factor: 45°C should accelerate aging > 25°C
    t_25 = calculate_arrhenius_thermal_factor(25.0)
    t_45 = calculate_arrhenius_thermal_factor(45.0)
    assert t_25 == 1.0
    assert t_45 > 1.8

    # 2. DoD stress factor: 90% DoD is significantly harsher than 20% DoD
    dod_20 = calculate_dod_stress_factor(20.0)
    dod_90 = calculate_dod_stress_factor(90.0)
    assert dod_90 > dod_20 * 3.0

    # 3. Dynamic inverter efficiency: light load (<10%) has lower efficiency than 50% load
    eff_light = calculate_dynamic_inverter_efficiency(0.15, 3.0) # 5% load
    eff_mid = calculate_dynamic_inverter_efficiency(1.50, 3.0)   # 50% load
    assert eff_light < 0.85
    assert eff_mid > 0.95

    # 4. Full evaluation
    res = evaluate_lfp_battery_physics(throughput_kwh=10.0, ambient_temp_c=40.0)
    assert res.effective_degradation_cost_inr > res.base_wear_cost_inr
    assert res.cycle_life_at_operating_point > 1000
    assert res.projected_calendar_lifespan_years > 3.0


def test_market_auction_engine():
    engine = MicrogridAuctionEngine()

    # Submit 2 Sellers (Asks)
    engine.submit_order(MarketOrder("ASK-1", "seller_rooftop_a", "ASK", quantity_kwh=10.0, price_rs_kwh=5.50))
    engine.submit_order(MarketOrder("ASK-2", "seller_rooftop_b", "ASK", quantity_kwh=15.0, price_rs_kwh=6.00))

    # Submit 2 Buyers (Bids)
    engine.submit_order(MarketOrder("BID-1", "buyer_clinic", "BID", quantity_kwh=12.0, price_rs_kwh=7.50))
    engine.submit_order(MarketOrder("BID-2", "buyer_shop", "BID", quantity_kwh=8.0, price_rs_kwh=6.20))

    result = engine.clear_market("12:00-12:15")
    assert result.cleared_volume_kwh > 15.0
    assert 5.50 <= result.uniform_clearing_price_rs_kwh <= 7.50
    assert len(result.matched_trades) >= 2
    assert result.total_social_welfare_inr > 0.0


def test_anti_islanding_watchdog():
    watchdog = AntiIslandingWatchdog()
    watchdog.feed_heartbeat()

    # Normal conditions
    normal = watchdog.evaluate_grid_safety(230.0, 50.0)
    assert normal.grid_connected is True
    assert normal.shunt_trip_relay_state == "ENERGIZED_CLOSED"

    # Over-voltage fault trip (>253V)
    fault = watchdog.evaluate_grid_safety(260.0, 50.0)
    assert fault.grid_connected is False
    assert fault.shunt_trip_relay_state == "TRIPPED_OPEN_SAFE"
    assert "OVER_VOLTAGE" in fault.trip_reason
    assert fault.trip_latency_ms < 2000.0  # Mandatory IEEE/CEA < 2000ms

    # Reset
    watchdog.reset_trip()
    watchdog.feed_heartbeat()
    reset_st = watchdog.evaluate_grid_safety(230.0, 50.0)
    assert reset_st.grid_connected is True


def test_api_service_endpoints():
    service = UrjaSetuApiService(site_id="mathura-01")

    # /beckn/search
    search_res = service.handle_beckn_search({"context": {"transaction_id": "TXN-TEST-101"}})
    assert search_res["context"]["action"] == "on_search"
    assert "catalog" in search_res["message"]

    # /beckn/confirm
    confirm_res = service.handle_beckn_confirm({
        "context": {"transaction_id": "TXN-TEST-101"},
        "message": {"order": {"quantity": {"value": 10.0}, "price": {"value": 6.50}}}
    })
    assert confirm_res["message"]["order"]["status"] == "ACCEPTED_ESCROW_LOCKED"
    assert confirm_res["message"]["order"]["delivered_kwh"] < 10.0

    # /api/health
    health = service.handle_health()
    assert health["status"] == "HEALTHY_ONLINE"
    assert health["cea_cybersecurity_status"] == "COMPLIANT"
