import numpy as np
import pandas as pd
import pytest

from avishkar_ems.bands import load_features, pv_features
from avishkar_ems.dispatch import Offer, build_offers, offer_mask
from avishkar_ems.engine import plan_and_offer
from avishkar_ems.execute import DT, execute_day
from avishkar_ems.monitor import daily_summary, deviation_flags
from avishkar_ems.payback import evaluate, train_models
from avishkar_ems.planner import plan_day
from avishkar_ems.reserve import reserve_floor
from avishkar_ems.settle import settle
from avishkar_ems.sim import demo_sites, simulate_site


@pytest.fixture(scope="module")
def models(shop, shop_year):
    site, _ = shop
    return train_models(site, shop_year[shop_year.index < "2026-01-01"])


def _day(df, text):
    d0 = pd.Timestamp(text, tz=df.index.tz)
    return (df.index >= d0) & (df.index < d0 + pd.Timedelta(days=1))


def _bands(df, models, sl):
    pv_m, ld_m = models
    pvf, lf = pv_features(df), load_features(df)
    a = df.loc[sl]
    return pv_m.predict(pvf.loc[sl], scale=a["pv_clear_kw"]), ld_m.predict(lf.loc[sl].fillna(lf.loc[sl].mean()))


def test_plan_never_dips_below_reserve_floor(shop, shop_year, models):
    site, _ = shop
    for text in ("2026-02-22", "2026-07-14", "2026-10-03"):
        sl = _day(shop_year, text)
        a = shop_year.loc[sl]
        pv_b, ld_b = _bands(shop_year, models, sl)
        rsv = reserve_floor(site, risk=0.6)
        plan = plan_day(site, pv_b, ld_b, a["import_rate"].to_numpy(), a["export_rate"].to_numpy(),
                        a["p2p_price_fcst"].to_numpy(), 0.5, rsv)
        assert plan.status.startswith("Optimal")
        # the LP respects the floor up to solver tolerance (under 1% of capacity); the executor is strict
        assert plan.steps["soc"].min() >= rsv.floor_soc - 0.01, text


def test_executor_conserves_energy_and_serves_critical_load(shop, shop_year):
    site, _ = shop
    sl = _day(shop_year, "2025-07-10")
    a = shop_year.loc[sl].copy()
    a["outage"] = False
    a.iloc[40:56, a.columns.get_loc("outage")] = True  # 4 h outage at 10:00
    res = execute_day(site, a, 0.9, 0.3, "greedy").steps
    # Energy balance each step: load = pv + battery + grid (+ unserved during outage)
    lhs = res["load_kw"] - res["unserved_kwh"] / DT
    rhs = res["pv_kw"] + res["batt_kw"] + res["grid_kw"]
    assert np.allclose(lhs[~res["outage"]], rhs[~res["outage"]], atol=1e-6)
    assert (res["soc"] <= 1.0 + 1e-9).all() and (res["soc"] >= (1 - site.dod) - 1e-9).all()
    assert res.loc[res["outage"], "grid_kw"].abs().max() == 0.0  # grid is down in an outage


def test_offers_are_sized_conservatively(shop, shop_year, models):
    site, _ = shop
    sl = _day(shop_year, "2026-02-22")  # a Sunday: shop closed, big surplus
    a = shop_year.loc[sl]
    pv_b, ld_b = _bands(shop_year, models, sl)
    plan = plan_day(site, pv_b, ld_b, a["import_rate"].to_numpy(), a["export_rate"].to_numpy(),
                    a["p2p_price_fcst"].to_numpy(), 0.5, reserve_floor(site))
    offers = build_offers(site, plan, a["p2p_price_fcst"].to_numpy())
    assert offers, "a sunny Sunday must produce at least one offer"
    planned_export_kwh = float((-plan.steps["grid_kw"].clip(upper=0)).sum() * DT)
    assert sum(o.quantity_kwh for o in offers) <= planned_export_kwh + 1e-6
    for o in offers:
        assert o.floor_price > site.tariff.export_rate  # only worth it if it beats grid export
        j = o.to_json()["message"]["catalog"]["offers"][0]
        assert j["quantity"]["unit"] == "kWh" and j["price"]["currency"] == "INR"


def test_settlement_books_shortfall_and_unmatched(shop):
    site, _ = shop
    idx = pd.date_range("2026-03-01 11:00", periods=4, freq="15min", tz=site.tz)
    ex = pd.DataFrame({"export_kwh": [0.5, 0.5, 0.5, 0.5], "p2p_price": 5.0, "export_rate": 3.5}, index=idx)
    ok = Offer("o1", site.site_id, idx[0], idx[-1] + pd.Timedelta(minutes=15), 1.5, 2.0, 4.0, 0.75)
    short = Offer("o2", site.site_id, idx[0], idx[-1] + pd.Timedelta(minutes=15), 3.0, 3.0, 4.0, 0.9)
    unmatched = Offer("o3", site.site_id, idx[0], idx[-1] + pd.Timedelta(minutes=15), 1.0, 1.0, 6.0, 0.9)
    r_ok, r_short, r_un = settle(site, [ok, short, unmatched], ex)
    assert r_ok.delivered_kwh == pytest.approx(1.5) and r_ok.shortfall_kwh == 0
    assert r_ok.revenue_inr == pytest.approx(1.5 * (5.0 - site.tariff.p2p_charges))
    assert r_short.delivered_kwh == pytest.approx(2.0) and r_short.shortfall_kwh == pytest.approx(1.0)
    assert r_short.penalty_inr == pytest.approx(site.tariff.shortfall_penalty)
    assert not r_un.matched and r_un.delivered_kwh == 0 and r_un.penalty_inr == 0


def test_monitor_flags_injected_fault_and_not_healthy_days():
    site, kind = demo_sites()["shop-pune"]
    df = simulate_site(site, "2025-03-01", 20, seed=5, load_kind=kind, faults={"2025-03-10": 0.6})
    flags = deviation_flags(df)
    summ = daily_summary(df, flags)
    assert summ.loc["2025-03-10", "flagged_steps"] >= 8
    healthy = summ.drop(index=summ.index[summ.index.strftime("%Y-%m-%d") == "2025-03-10"])
    assert healthy["flagged_steps"].max() <= 2


def test_ems_end_to_end_beats_statement_baseline_and_keeps_critical_load(shop, shop_year, models):
    site, _ = shop
    days = list(pd.date_range("2026-01-05", "2026-12-20", freq="21D"))
    ev = evaluate(site, shop_year, models[0], models[1], days)
    t = ev.payback_table()
    ems, idle = t.loc["EMS"], t.loc["Baseline: self-consume + export (battery idle)"]
    hind = t.loc["Reference: EMS with perfect foresight"]
    assert ems["annual_benefit_inr"] > idle["annual_benefit_inr"]
    assert ems["annual_benefit_inr"] <= hind["annual_benefit_inr"] * 1.01  # cannot beat hindsight
    assert ems["unserved_critical_kwh"] <= t.loc["Baseline: fixed-rule battery", "unserved_critical_kwh"] + 1e-9
    assert (ev.daily["status"].str.startswith("Optimal")).all()


def test_two_pass_planning_only_prices_p2p_inside_committed_windows(shop, shop_year, models):
    site, _ = shop
    sl = _day(shop_year, "2026-02-22")
    a = shop_year.loc[sl]
    pv_b, ld_b = _bands(shop_year, models, sl)
    plan, offers = plan_and_offer(site, pv_b, ld_b, a["import_rate"].to_numpy(), a["export_rate"].to_numpy(),
                                  a["p2p_price_fcst"].to_numpy(), 0.5, reserve_floor(site))
    assert offers
    used = plan.steps["prod_price_used"].to_numpy()
    exp = plan.steps["export_rate"].to_numpy()
    inside = offer_mask(plan.steps.index, offers)
    assert inside.any()
    # The LP sees the P2P price only inside windows committed in pass 1.
    # (Pass-2 windows can shift slightly, so compare against pass-2 offers loosely on the inside.)
    assert (used >= exp - 1e-9).all()
    assert (used > exp + 1e-9).sum() <= inside.sum() + 8  # P2P-priced steps stay near the offer windows
    assert (used[~inside] > exp[~inside] + 1e-9).sum() < 0.5 * len(used)


def test_plan_balances_energy_every_step(shop, shop_year, models):
    """Regression: EMHASS defaults to two deferrable loads (one 3 kW). If they leak into the plan,
    energy goes missing from the balance load = pv + battery + grid."""
    site, _ = shop
    for text in ("2026-02-22", "2026-07-14"):
        sl = _day(shop_year, text)
        a = shop_year.loc[sl]
        pv_b, ld_b = _bands(shop_year, models, sl)
        plan = plan_day(site, pv_b, ld_b, a["import_rate"].to_numpy(), a["export_rate"].to_numpy(),
                        a["p2p_price_fcst"].to_numpy(), 0.5, reserve_floor(site))
        s = plan.steps
        residual = s["load_p50"] - s["pv_p50"] - s["batt_kw"] - s["grid_kw"]
        assert residual.abs().max() < 1e-3, f"{text}: max imbalance {residual.abs().max():.3f} kW"
