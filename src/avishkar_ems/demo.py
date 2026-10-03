"""Shared runner used by the dashboard and the command-line demo.

It prepares a demo site (simulated until the organisers' dataset is plugged in), trains the
P10/P50/P90 models on year one, and exposes a single-day view and a full payback evaluation on year two.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from avishkar_ems.bands import QuantileBands, coverage, load_features, pv_features
from avishkar_ems.dispatch import Offer, offer_mask
from avishkar_ems.engine import plan_and_offer
from avishkar_ems.execute import DayResult, execute_day
from avishkar_ems.payback import Evaluation, evaluate, train_models
from avishkar_ems.planner import DayPlan
from avishkar_ems.realdata import real_site_frame, real_sites
from avishkar_ems.reserve import ReserveDecision, outage_rate_90d, outage_risk, reserve_floor
from avishkar_ems.settle import TradeResult, settle
from avishkar_ems.sim import STEPS_PER_DAY, demo_sites, simulate_site
from avishkar_ems.site import SiteSpec

TRAIN_END = "2026-01-01"
REAL_TRAIN_END = "2023-01-01"
METER_TRAIN_END = "2020-07-01"  # CEEW meters: train Jun 2019 to Jun 2020, test Jul 2020 to Feb 2021


@dataclass
class Prepared:
    site: SiteSpec
    kind: str
    df: pd.DataFrame
    pv_model: QuantileBands
    load_model: QuantileBands
    train_end: str = TRAIN_END
    source: str = "simulated"

    @property
    def test_start(self) -> pd.Timestamp:
        return pd.Timestamp(self.train_end) + pd.Timedelta(days=2)

    @property
    def test_end(self) -> pd.Timestamp:
        return pd.Timestamp(self.df.index[-1]).tz_localize(None).normalize() - pd.Timedelta(days=3)


@dataclass
class DayView:
    day: pd.Timestamp
    plan: DayPlan
    reserve: ReserveDecision
    ems: DayResult
    baseline_idle: DayResult
    baseline_rule: DayResult
    offers: list[Offer]
    trades: list[TradeResult]
    actual: pd.DataFrame


def prepare(site_key: str, seed: int = 7, days: int = 730, source: str = "real") -> Prepared:
    """source='real': PVGIS/ERA5 weather plus measured load; the Mathura home also has measured outages.
    source='sim': fully simulated (used by the unit tests)."""
    if source == "real":
        site, kind, meter = real_sites()[site_key]
        df = real_site_frame(site, seed=seed, meter=meter)
        train_end = METER_TRAIN_END if meter else REAL_TRAIN_END
    else:
        site, kind = demo_sites()[site_key]
        df, train_end = simulate_site(site, "2025-01-01", days, seed=seed, load_kind=kind), TRAIN_END
    pv_model, load_model = train_models(site, df[df.index < train_end])
    return Prepared(site, kind, df, pv_model, load_model, train_end, source)


def day_view(p: Prepared, day: str | pd.Timestamp, soc_init: float = 0.5) -> DayView:
    d0 = pd.Timestamp(day)
    d0 = d0.tz_localize(p.df.index.tz) if d0.tzinfo is None else d0
    sl = (p.df.index >= d0) & (p.df.index < d0 + pd.Timedelta(days=1))
    if sl.sum() != STEPS_PER_DAY:
        raise ValueError(f"{d0.date()} is outside the simulated period")
    actual = p.df.loc[sl]
    pvf, lf = pv_features(p.df), load_features(p.df)
    pv_b = p.pv_model.predict(pvf.loc[sl], scale=actual["pv_clear_kw"])
    ld_b = p.load_model.predict(lf.loc[sl].fillna(lf.loc[sl].mean()))
    risk = outage_risk(planned_notice=bool(actual["planned_notice"].any()),
                       storm_prob=float(actual["storm_prob"].max()),
                       outage_rate_90d=outage_rate_90d(p.df["outage"], d0))
    rsv = reserve_floor(p.site, risk=risk)
    p2p_fcst = actual["p2p_price_fcst"].to_numpy()
    plan, offers = plan_and_offer(p.site, pv_b, ld_b, actual["import_rate"].to_numpy(),
                                  actual["export_rate"].to_numpy(), p2p_fcst, soc_init, rsv)
    ems = execute_day(p.site, actual, soc_init, rsv.floor_soc, "plan", plan.steps["batt_kw"].to_numpy(),
                      export_ok=offer_mask(actual.index, offers))
    trades = settle(p.site, offers, ems.steps)
    base_floor = reserve_floor(p.site, risk=0.0).floor_soc
    idle = execute_day(p.site, actual, soc_init, base_floor, "idle")
    rule = execute_day(p.site, actual, soc_init, base_floor, "greedy")
    return DayView(d0, plan, rsv, ems, idle, rule, offers, trades, actual)


def run_payback(p: Prepared, every_days: int = 7) -> Evaluation:
    days = list(pd.date_range(p.test_start, p.test_end, freq=f"{every_days}D"))
    return evaluate(p.site, p.df, p.pv_model, p.load_model, days)


def forecast_quality(p: Prepared) -> pd.DataFrame:
    """Held-out accuracy of the P50 and calibration of the 80% band, on the year after training."""
    te = p.df[p.df.index >= p.train_end]
    day = (te["pv_clear_kw"] > 0).to_numpy()
    b = p.pv_model.predict(pv_features(te), scale=te["pv_clear_kw"])
    lf = load_features(p.df).loc[te.index]
    ok = lf.notna().all(axis=1).to_numpy()
    lb = p.load_model.predict(lf[ok])
    pv_mae = float((te["pv_kw"].to_numpy()[day] - b["p50"].to_numpy()[day]).__abs__().mean())
    ld_mae = float((te["load_kw"].to_numpy()[ok] - lb["p50"].to_numpy()).__abs__().mean())
    return pd.DataFrame({
        "pv": {"mae_kw_daytime": pv_mae, "mean_kw_daytime": float(te["pv_kw"].to_numpy()[day].mean()),
               "band80_coverage": coverage(te["pv_kw"].to_numpy()[day], b["p10"].to_numpy()[day], b["p90"].to_numpy()[day])},
        "load": {"mae_kw_daytime": ld_mae, "mean_kw_daytime": float(te["load_kw"].to_numpy()[ok].mean()),
                 "band80_coverage": coverage(te["load_kw"].to_numpy()[ok], lb["p10"].to_numpy(), lb["p90"].to_numpy())},
    }).T
