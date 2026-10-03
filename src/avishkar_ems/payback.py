"""End-to-end evaluation: run EMS and baselines day by day on held-out data and report payback.

Payback in years = system cost / annual benefit, where benefit is what the site saves compared with
buying all its energy from the grid, plus trade and export revenue, minus battery wear. Every site is
reported under the EMS and under two baselines: the statement's 'self-consume, export the rest'
with the battery left alone, and a stronger 'fixed rule' battery that charges from surplus and
discharges to load. The gap is the value the EMS creates.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from avishkar_ems.bands import QuantileBands, load_features, pv_features
from avishkar_ems.dispatch import Offer, offer_mask
from avishkar_ems.engine import plan_and_offer
from avishkar_ems.execute import DT, execute_day
from avishkar_ems.intraday import execute_with_replan
from avishkar_ems.reserve import outage_rate_90d, outage_risk, reserve_floor
from avishkar_ems.settle import TradeResult, settle
from avishkar_ems.sim import STEPS_PER_DAY
from avishkar_ems.site import SiteSpec


@dataclass
class Totals:
    days: int = 0
    bill_without_system: float = 0.0  # all load bought from the grid at retail
    import_cost: float = 0.0
    export_revenue: float = 0.0  # all export at the grid rate
    trade_uplift: float = 0.0  # P2P gain over grid export, net of shortfall penalties
    wear_cost: float = 0.0
    inventory_inr: float = 0.0  # value of the change in stored energy over the period
    unserved_critical_kwh: float = 0.0
    outage_critical_kwh: float = 0.0
    traded_kwh: float = 0.0
    committed_kwh: float = 0.0
    shortfall_kwh: float = 0.0

    @property
    def benefit(self) -> float:
        return (self.bill_without_system - self.import_cost + self.export_revenue
                + self.trade_uplift - self.wear_cost + self.inventory_inr)

    def annual_benefit(self) -> float:
        return self.benefit * 365.0 / max(self.days, 1)

    def payback_years(self, system_cost: float) -> float:
        a = self.annual_benefit()
        return system_cost / a if a > 0 else float("inf")


@dataclass
class Evaluation:
    site: SiteSpec
    ems: Totals
    baseline_idle: Totals
    baseline_rule: Totals
    hindsight: Totals | None = None  # same planner with perfect foresight, the upper bound
    replan: Totals | None = None  # EMS with a noon re-plan on the morning's observed error
    trades: list[TradeResult] = field(default_factory=list)
    offers: list[Offer] = field(default_factory=list)
    daily: pd.DataFrame | None = None

    def payback_table(self) -> pd.DataFrame:
        rows = {}
        entries = [("EMS", self.ems), ("Baseline: self-consume + export (battery idle)", self.baseline_idle),
                   ("Baseline: fixed-rule battery", self.baseline_rule)]
        if self.replan is not None:
            entries.insert(1, ("EMS + noon re-plan", self.replan))
        if self.hindsight is not None:
            entries.append(("Reference: EMS with perfect foresight", self.hindsight))
        for name, t in entries:
            rows[name] = {
                "annual_benefit_inr": t.annual_benefit(),
                "payback_years": t.payback_years(self.site.system_cost_inr),
                "unserved_critical_kwh": t.unserved_critical_kwh,
            }
        return pd.DataFrame(rows).T


def _account(t: Totals, site: SiteSpec, res: pd.DataFrame, trades: list[TradeResult],
             delta_soc: float = 0.0) -> None:
    """Add one executed day to the totals.

    delta_soc is end SOC minus start SOC. Stored energy is valued at the day's average retail rate
    (net of conversion loss and wear), so a policy that ends the day with a fuller battery gets
    credit for it and policies that end at different charge levels compare fairly.
    """
    dt = DT
    t.days += 1
    unit_value = float(res["import_rate"].mean()) * site.one_way_eff - site.wear_inr_per_kwh
    t.inventory_inr += delta_soc * site.battery_kwh * max(unit_value, 0.0)
    t.bill_without_system += float((res["load_kw"] * dt * res["import_rate"]).sum())
    t.import_cost += float((res["import_kwh"] * res["import_rate"]).sum())
    t.export_revenue += float((res["export_kwh"] * res["export_rate"]).sum())
    t.trade_uplift += sum(x.uplift_vs_export_inr for x in trades)
    t.wear_cost += float(np.clip(res["batt_kw"], 0, None).sum() * dt * site.wear_inr_per_kwh)
    t.unserved_critical_kwh += float(res["unserved_critical_kwh"].sum())
    t.outage_critical_kwh += float(res["outage"].sum() * dt * site.critical_kw)
    t.traded_kwh += sum(x.delivered_kwh for x in trades)
    t.committed_kwh += sum(x.committed_kwh for x in trades if x.matched)
    t.shortfall_kwh += sum(x.shortfall_kwh for x in trades)


def train_models(site: SiteSpec, train: pd.DataFrame, max_iter: int = 200) -> tuple[QuantileBands, QuantileBands]:
    pv_model = QuantileBands(max_iter=max_iter, calib_days=120).fit(pv_features(train), train["pv_kw"], scale=train["pv_clear_kw"])
    lf = load_features(train)
    ok = lf.notna().all(axis=1)
    load_model = QuantileBands(max_iter=max_iter).fit(lf[ok], train.loc[ok, "load_kw"])
    return pv_model, load_model


def evaluate(
    site: SiteSpec,
    df: pd.DataFrame,
    pv_model: QuantileBands,
    load_model: QuantileBands,
    test_days: list[pd.Timestamp],
    soc_start: float = 0.5,
    use_risk_reserve: bool = True,
    with_hindsight: bool = True,
    with_replan: bool = True,
) -> Evaluation:
    """Run the EMS and both baselines on the given days of `df` (which includes history for lags)."""
    ems, idle, rule, hind, rep = Totals(), Totals(), Totals(), Totals(), Totals()
    soc_e, soc_i, soc_r, soc_h, soc_p = soc_start, soc_start, soc_start, soc_start, soc_start
    all_trades: list[TradeResult] = []
    all_offers: list[Offer] = []
    daily_rows = []
    pvf, lf = pv_features(df), load_features(df)
    for day in test_days:
        d0 = pd.Timestamp(day).tz_localize(df.index.tz) if pd.Timestamp(day).tzinfo is None else pd.Timestamp(day)
        sl = (df.index >= d0) & (df.index < d0 + pd.Timedelta(days=1))
        if sl.sum() != STEPS_PER_DAY:
            continue
        actual = df.loc[sl]
        pv_b = pv_model.predict(pvf.loc[sl], scale=actual["pv_clear_kw"])
        ld_b = load_model.predict(lf.loc[sl].fillna(lf.loc[sl].mean()))
        # --- reserve floor from the signals known the evening before
        risk = 0.0
        if use_risk_reserve:
            risk = outage_risk(planned_notice=bool(actual["planned_notice"].any()),
                               storm_prob=float(actual["storm_prob"].max()),
                               outage_rate_90d=outage_rate_90d(df["outage"], d0))
        rsv = reserve_floor(site, risk=risk)
        # --- EMS
        plan, offers = plan_and_offer(site, pv_b, ld_b, actual["import_rate"].to_numpy(),
                                      actual["export_rate"].to_numpy(), actual["p2p_price_fcst"].to_numpy(),
                                      soc_e, rsv)
        r_e = execute_day(site, actual, soc_e, rsv.floor_soc, "guided", plan.steps["batt_kw"].to_numpy(),
                          export_ok=offer_mask(actual.index, offers))
        trades = settle(site, offers, r_e.steps)
        _account(ems, site, r_e.steps, trades, r_e.end_soc - soc_e)
        soc_e = r_e.end_soc
        all_trades += trades
        all_offers += offers
        if with_replan:
            r_p = execute_with_replan(site, actual, pv_b, ld_b, plan, offers, actual["p2p_price_fcst"].to_numpy(),
                                      soc_p, rsv)
            _account(rep, site, r_p.steps, settle(site, offers, r_p.steps), r_p.end_soc - soc_p)
            soc_p = r_p.end_soc
        # --- reference: the same EMS (reserve, offers, settlement) but with perfect foresight
        if with_hindsight:
            exact = pd.DataFrame({"p10": actual["pv_kw"], "p50": actual["pv_kw"], "p90": actual["pv_kw"]})
            exact_l = pd.DataFrame({"p10": actual["load_kw"], "p50": actual["load_kw"], "p90": actual["load_kw"]})
            plan_h, offers_h = plan_and_offer(site, exact, exact_l, actual["import_rate"].to_numpy(),
                                              actual["export_rate"].to_numpy(),
                                              actual["p2p_price_fcst"].to_numpy(), soc_h, rsv)
            r_h = execute_day(site, actual, soc_h, rsv.floor_soc, "guided", plan_h.steps["batt_kw"].to_numpy(),
                              export_ok=offer_mask(actual.index, offers_h))
            _account(hind, site, r_h.steps, settle(site, offers_h, r_h.steps), r_h.end_soc - soc_h)
            soc_h = r_h.end_soc
        # --- baselines: fixed rules, no forecast, but with the SAME static backup reserve a hybrid
        # inverter would normally be set to (no outage-risk uplift, that is the EMS's job)
        base_floor = reserve_floor(site, risk=0.0).floor_soc
        r_i = execute_day(site, actual, soc_i, base_floor, "idle")
        _account(idle, site, r_i.steps, [], r_i.end_soc - soc_i)
        soc_i = r_i.end_soc
        r_r = execute_day(site, actual, soc_r, base_floor, "greedy")
        _account(rule, site, r_r.steps, [], r_r.end_soc - soc_r)
        soc_r = r_r.end_soc
        daily_rows.append({"day": d0, "reserve_floor": rsv.floor_soc, "risk": risk, "status": plan.status,
                           "offers": len(offers), "ems_unserved_critical_kwh": float(r_e.steps["unserved_critical_kwh"].sum())})
    return Evaluation(site, ems, idle, rule, hind if with_hindsight else None,
                      rep if with_replan else None, all_trades, all_offers, pd.DataFrame(daily_rows))
