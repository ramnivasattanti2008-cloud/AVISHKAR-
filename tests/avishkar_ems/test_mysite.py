import pandas as pd
import pytest

from avishkar_ems import mysite, realdata
from avishkar_ems.sim import demo_sites, simulate_site
from avishkar_ems.tariffs import Tariff


def test_markdown_table_needs_no_optional_dependency():
    df = pd.DataFrame({"kwh": [0.0, 5.0], "years": [float("nan"), 12.5]}, index=pd.Index([0.0, 5.0], name="battery_kwh"))
    text = mysite.markdown_table(df)
    lines = text.splitlines()
    assert lines[0].startswith("| battery_kwh |") and set(lines[1]) <= set("|- ")
    assert "12.5" in lines[3] and "nan" not in text.lower()  # missing values print as a dash


def test_build_tariff_variants():
    flat = mysite.build_tariff(base_rate=7.0, export_rate=3.0)
    assert flat.import_rates(pd.date_range("2025-01-01", periods=96, freq="15min")).tolist() == [7.0] * 96
    tod = mysite.build_tariff(base_rate=7.0, tod=True, commercial=True)
    assert len(set(tod.import_rates(pd.date_range("2025-01-01", periods=96, freq="15min")))) > 1
    assert isinstance(flat, Tariff)


def test_too_little_data_is_refused_with_a_plain_message(monkeypatch):
    load = pd.Series(1.0, index=pd.date_range("2025-01-01", periods=96 * 30, freq="15min", tz="Asia/Kolkata"))
    with pytest.raises(ValueError, match="at least about 150 days"):
        mysite.analyse(load, lat=18.5, lon=73.8, kwp=5, cost=400_000, tariff=mysite.build_tariff())


def test_analyse_runs_end_to_end_on_a_meter_series(monkeypatch):
    # Reuse the committed Pune weather so the test needs no network; the real code path is otherwise unchanged.
    pune = demo_sites()["shop-pune"][0]
    base = realdata.pvgis_weather(pune, 2021, 2023)
    monkeypatch.setattr(realdata, "pvgis_weather", lambda site, start, end: base[base.index.year == start])
    home, kind = demo_sites()["home-bengaluru"]
    load = simulate_site(home, "2025-01-01", 200, seed=2, load_kind=kind)["load_kw"]

    rep = mysite.analyse(load, lat=18.52, lon=73.86, kwp=5, battery_kwh=5, cost=450_000, backup_hours=4,
                         critical_kw=0.5, tariff=mysite.build_tariff(base_rate=7.0), subsidy=True,
                         every_days=21, advice_sizes=(0.0, 5.0))
    assert rep.days >= 150 and rep.table.loc["EMS", "annual_benefit_inr"] > 0
    assert rep.site.subsidy_inr > 0 and "payback_years_after_subsidy" in rep.table
    assert list(rep.advice.index) == [0.0, 5.0]
    text = mysite.report_markdown(rep)
    assert "Your site report" in text and "Payback:" in text and "| battery_kwh |" in text
    assert "आपके" in mysite.report_markdown(rep, lang="hi") or "बैटरी" in mysite.report_markdown(rep, lang="hi")


def test_bundled_weather_is_found_for_a_demo_site_and_only_for_it():
    # Mathura's coordinates and angles match the bundled 2019-2021 file: reuse its middle year offline.
    assert mysite.bundled_weather(27.49, 77.67, 20, 180) == ("home-mathura", 2020)
    assert mysite.bundled_weather(27.49, 77.67, 15, 180) is None  # different tilt: different weather
    assert mysite.bundled_weather(10.0, 76.0, 20, 180) is None  # somewhere else entirely
