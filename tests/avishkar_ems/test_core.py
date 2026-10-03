import numpy as np
import pandas as pd
import pytest

from avishkar_ems.bands import QuantileBands, coverage, load_features, pv_features
from avishkar_ems.reserve import outage_risk, reserve_floor
from avishkar_ems.sim import STEPS_PER_DAY
from avishkar_ems.tariffs import COMMERCIAL_TOD, Tariff


def test_tariff_covers_day_and_wraps_midnight():
    idx = pd.date_range("2026-01-01", periods=96, freq="15min", tz="Asia/Kolkata")
    rates = COMMERCIAL_TOD.import_rates(idx)
    assert not np.isnan(rates).any()
    assert rates[idx.hour == 2].max() == 6.0  # night off-peak (wraps midnight)
    assert rates[idx.hour == 19].min() == 10.0  # evening peak


def test_tariff_gap_is_rejected():
    t = Tariff(((6.0, 12.0, 5.0),), 3.0, 0.5, 5.0)
    idx = pd.date_range("2026-01-01", periods=96, freq="15min", tz="Asia/Kolkata")
    with pytest.raises(ValueError):
        t.import_rates(idx)


def test_outage_risk_is_noisy_or():
    assert outage_risk() == 0.0
    assert outage_risk(planned_notice=True) == pytest.approx(0.9)
    both = outage_risk(planned_notice=True, storm_prob=1.0)
    assert 0.9 < both < 1.0


def test_reserve_covers_critical_load_and_rises_with_risk(shop):
    site, _ = shop
    base = reserve_floor(site, risk=0.0)
    stormy = reserve_floor(site, risk=0.9)
    assert base.floor_soc * site.battery_kwh * site.one_way_eff >= site.critical_kw * site.backup_hours - 1e-9
    assert stormy.floor_soc > base.floor_soc
    assert base.feasible


def test_reserve_flags_undersized_battery(shop):
    from dataclasses import replace

    site, _ = shop
    tiny = replace(site, battery_kwh=3.0)
    d = reserve_floor(tiny, risk=0.0)
    assert not d.feasible and "too small" in d.reason


def test_simulation_shape_and_physics(shop_year):
    df = shop_year
    assert len(df) == 730 * STEPS_PER_DAY
    assert (df["pv_kw"] >= 0).all() and df.loc[df.index.hour == 0, "pv_kw"].max() == 0.0
    assert df["pv_kw"].max() <= 15.0 + 1e-9
    monsoon = df[df.index.month.isin([7, 8])]["pv_kw"].sum()
    dry = df[df.index.month.isin([2, 3])]["pv_kw"].sum()
    assert monsoon < dry  # cloudy monsoon produces less than dry season
    assert df["outage"].any() and df["planned_notice"].any()


def test_pv_bands_are_ordered_and_calibrated(shop_year):
    df = shop_year
    split = 365 * STEPS_PER_DAY
    train, test = df.iloc[:split], df.iloc[split:]
    model = QuantileBands(max_iter=120).fit(pv_features(train), train["pv_kw"], scale=train["pv_clear_kw"])
    night = (test["pv_clear_kw"] <= 0).to_numpy()
    bands = model.predict(pv_features(test), scale=test["pv_clear_kw"])
    assert (bands["p10"] <= bands["p50"]).all() and (bands["p50"] <= bands["p90"]).all()
    assert (bands.loc[night] == 0).all().all()
    day = ~night
    cov = coverage(test["pv_kw"].to_numpy()[day], bands["p10"].to_numpy()[day], bands["p90"].to_numpy()[day])
    assert 0.72 <= cov <= 0.86, f"80% band covered {cov:.0%}"


def test_p10_is_not_collapsed_on_clear_days(shop_year):
    """Regression: a naive quantile model returned P10 = 0 all day. A clear forecast day must keep a
    meaningful P10, otherwise no surplus could ever be committed to a P2P trade."""
    df = shop_year
    split = 365 * STEPS_PER_DAY
    train, test = df.iloc[:split], df.iloc[split:]
    model = QuantileBands(max_iter=120).fit(pv_features(train), train["pv_kw"], scale=train["pv_clear_kw"])
    bands = model.predict(pv_features(test), scale=test["pv_clear_kw"])
    clear = ((test["kt_fcst"] > 0.9) & (test["pv_clear_kw"] > 0.5 * test["pv_clear_kw"].max())).to_numpy()
    assert clear.sum() > 20
    assert (bands.loc[clear, "p10"] / bands.loc[clear, "p50"]).median() > 0.55


def test_load_bands_are_ordered_and_reasonable(shop_year):
    df = shop_year
    feats = load_features(df)
    split = 365 * STEPS_PER_DAY
    ok = feats.notna().all(axis=1)
    tr, te = ok & (np.arange(len(df)) < split), ok & (np.arange(len(df)) >= split)
    model = QuantileBands(max_iter=80).fit(feats[tr], df.loc[tr, "load_kw"])
    bands = model.predict(feats[te])
    cov = coverage(df.loc[te, "load_kw"].to_numpy(), bands["p10"].to_numpy(), bands["p90"].to_numpy())
    assert (bands["p10"] <= bands["p90"]).all()
    assert 0.65 <= cov <= 0.95, f"load 80% band covered {cov:.0%}"


def test_schema_accepts_simulated_frame_and_rejects_bad_ones(shop_year):
    from avishkar_ems.schema import validate_site_frame

    assert validate_site_frame(shop_year) == []
    assert "missing columns" in validate_site_frame(shop_year.drop(columns=["storm_prob"]))[0]
    gappy = shop_year.drop(shop_year.index[100:104])
    assert any("regular" in p for p in validate_site_frame(gappy))
    assert any("timezone" in p for p in validate_site_frame(shop_year.tz_localize(None)))
