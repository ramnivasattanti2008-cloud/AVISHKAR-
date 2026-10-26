import numpy as np
import pandas as pd
import pytest

from avishkar_ems.explain import explain_day
from avishkar_ems.loads import best_start
from avishkar_ems.subsidy import pm_surya_ghar
from avishkar_ems.tariffs import tod_from_base
from avishkar_ems.userdata import read_meter_csv


def test_subsidy_follows_scheme_slabs():
    assert pm_surya_ghar(1.0) == 30000
    assert pm_surya_ghar(2.0) == 60000
    assert pm_surya_ghar(3.0) == 78000
    assert pm_surya_ghar(5.0) == 78000


@pytest.mark.parametrize("commercial,peak_x", [(False, 1.1), (True, 1.2)])
def test_tod_from_base_meets_rule_minimums(commercial, peak_x):
    t = tod_from_base(8.0, commercial=commercial)
    rates = [b[2] for b in t.tou_blocks]
    assert max(rates) >= 8.0 * peak_x - 1e-9
    assert min(rates) <= 8.0 * 0.8 + 1e-9


def _plan():
    idx = pd.date_range("2025-06-01", periods=96, freq="15min", tz="Asia/Kolkata")
    h = idx.hour + idx.minute / 60
    pv = np.where((h >= 9) & (h < 17), 3.0, 0.0)
    return pd.DataFrame({"pv_p50": pv, "load_p50": 0.5, "import_rate": np.where((h >= 18) & (h < 22), 12.0, 7.0),
                         "export_rate": 3.0, "batt_kw": 0.0, "grid_kw": 0.5}, index=idx)


def test_best_start_prefers_sunny_hours_and_avoids_peak():
    r = best_start(_plan(), kw=2.0, hours=1.0, top=3)
    assert len(r) == 3
    hrs = [int(x[:2]) for x in r["start"]]
    assert all(9 <= h < 17 for h in hrs)
    assert (r["saving_vs_worst_time_inr"] >= 0).all()


def test_explain_day_mentions_reserve_and_offers():
    class R:
        floor_soc = 0.3
        reason = "Outages are common."
    s = _plan()
    s.loc[s.index[s.index.hour == 19], "batt_kw"] = 1.0
    lines = explain_day(s, R(), [], "en")
    assert any("30%" in x for x in lines)
    assert any("Using the battery" in x for x in lines)
    assert any("No offers" in x for x in lines)
    assert explain_day(s, R(), [], "hi")


def _write(tmp_path, name, col, vals, freq="30min"):
    idx = pd.date_range("2025-03-01", periods=len(vals), freq=freq)
    p = tmp_path / name
    pd.DataFrame({"Timestamp": idx.strftime("%d-%m-%Y %H:%M"), col: vals}).to_csv(p, index=False)
    return p


def test_read_meter_csv_converts_units(tmp_path):
    n = 48 * 3
    kw = read_meter_csv(str(_write(tmp_path, "a.csv", "kWh", [0.5] * n)))      # 0.5 kWh per 30 min = 1 kW
    assert kw.median() == pytest.approx(1.0, rel=1e-6)
    wh = read_meter_csv(str(_write(tmp_path, "b.csv", "Wh", [500.0] * n)))
    assert wh.median() == pytest.approx(1.0, rel=1e-6)
    p = read_meter_csv(str(_write(tmp_path, "c.csv", "power", [2.0] * n)))
    assert p.median() == pytest.approx(2.0, rel=1e-6)
    assert str(p.index.tz) == "Asia/Kolkata"
    assert p.index.to_series().diff().dropna().eq(pd.Timedelta(minutes=15)).all()


def test_read_meter_csv_fills_short_gap(tmp_path):
    vals = [1.0] * 48 * 3
    p = _write(tmp_path, "g.csv", "load_kw", vals)
    df = pd.read_csv(p).drop(index=range(60, 64))   # two-hour hole
    df.to_csv(p, index=False)
    s = read_meter_csv(str(p))
    assert s.notna().all()
    assert s.median() == pytest.approx(1.0)


def test_battery_advice_text_reads_naturally_when_it_never_repays():
    import numpy as np
    import pandas as pd

    from avishkar_ems.advisor import advise_text

    table = pd.DataFrame({"backup_hours": [7.0], "years_to_repay_from_bills": [np.nan]}, index=pd.Index([2.5], name="battery_kwh"))
    en = advise_text(table, 4, "en")
    assert "never repay" in en and "in never" not in en
    hi = advise_text(table, 4, "hi")
    assert "कभी नहीं लौटेगी" in hi and "कभी नहीं लगेंगे" not in hi
    table["years_to_repay_from_bills"] = [14.0]
    assert "repay it in 14 years" in advise_text(table, 4, "en")
