"""Analyse your own site from a meter CSV. Prints a plain-language report and writes it to my_site_report.md.

    python examples/analyze_my_site.py --load my_meter.csv --lat 27.49 --lon 77.67 --kwp 3 --battery-kwh 5 \
        --cost 305000 --base-rate 7.0 --backup-hours 4 --critical-kw 0.4

Needs about six months of data or more (a year is better). Weather is real (PVGIS, a typical year laid over your dates).
Your DISCOM's real rates go in a JSON file passed with --tariff (see data/tariffs/template.json).
"""

import argparse
import logging
import pathlib

import pandas as pd

from avishkar_ems.advisor import advise_text, battery_advice
from avishkar_ems.payback import evaluate, train_models
from avishkar_ems.realdata import real_site_frame
from avishkar_ems.site import SiteSpec
from avishkar_ems.subsidy import pm_surya_ghar
from avishkar_ems.tariffs import Tariff, load_tariff, tod_from_base
from avishkar_ems.userdata import read_meter_csv

logging.disable(logging.WARNING)


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("--load", required=True)
    a.add_argument("--lat", type=float, required=True)
    a.add_argument("--lon", type=float, required=True)
    a.add_argument("--kwp", type=float, required=True)
    a.add_argument("--battery-kwh", type=float, default=0.0)
    a.add_argument("--cost", type=float, required=True, help="system cost in rupees")
    a.add_argument("--tilt", type=float, default=15)
    a.add_argument("--azimuth", type=float, default=180)
    a.add_argument("--critical-kw", type=float, default=0.3)
    a.add_argument("--backup-hours", type=float, default=4)
    a.add_argument("--tariff", help="JSON file with your DISCOM rates")
    a.add_argument("--base-rate", type=float, default=7.0, help="used if no tariff file: a flat rate, or a ToD built from it")
    a.add_argument("--tod", action="store_true", help="build a Time-of-Day tariff from the base rate using the national rules")
    a.add_argument("--commercial", action="store_true")
    a.add_argument("--export-rate", type=float, default=3.0)
    a.add_argument("--battery-inr-per-kwh", type=float, default=25_000.0)
    a.add_argument("--subsidy", choices=["none", "pm-surya-ghar"], default="none")
    a.add_argument("--lang", choices=["en", "hi"], default="en")
    a.add_argument("--sep", default=None)
    a.add_argument("--decimal", default=".")
    a.add_argument("--out", default="my_site_report.md")
    x = a.parse_args()

    load = read_meter_csv(x.load, sep=x.sep, decimal=x.decimal)
    days = (load.index[-1] - load.index[0]).days + 1
    if days < 150:
        raise SystemExit(f"Only {days} days of data. Please provide at least about 150 days (a year is better).")
    tariff = (load_tariff(x.tariff) if x.tariff else
              tod_from_base(x.base_rate, x.commercial, export_rate=x.export_rate) if x.tod else
              Tariff(((0.0, 24.0, x.base_rate),), x.export_rate, 0.6, 5.0, f"flat_{x.base_rate:g}"))
    site = SiteSpec("my-site", x.lat, x.lon, x.kwp, x.kwp, x.tilt, x.azimuth, max(x.battery_kwh, 0.01),
                    max(x.battery_kwh / 2, 0.01), x.critical_kw, x.backup_hours, x.cost, tariff=tariff,
                    subsidy_inr=pm_surya_ghar(x.kwp, residential=not x.commercial) if x.subsidy == "pm-surya-ghar" else 0.0)
    df = real_site_frame(site, load_kw=load)
    cut = df.index[int(len(df) * 0.6) // 96 * 96]
    pv_m, ld_m = train_models(site, df[df.index < cut])
    test_days = list(pd.date_range(cut.tz_localize(None).normalize() + pd.Timedelta(days=2), df.index[-1].tz_localize(None).normalize() - pd.Timedelta(days=3), freq="14D"))
    ev = evaluate(site, df, pv_m, ld_m, test_days, with_hindsight=False, with_replan=False)
    t = ev.payback_table()
    ems, idle = t.loc["EMS"], t.loc["Baseline: self-consume + export (battery idle)"]
    adv = battery_advice(site, df, pv_m, ld_m, test_days[::2], sizes_kwh=(0.0, 2.5, 5.0, 10.0), battery_inr_per_kwh=x.battery_inr_per_kwh)
    lines = [f"# Your site report ({days} days of meter data, {len(test_days)} test days)", "",
             f"- Average use: {load.mean() * 24:.1f} kWh a day. Solar: {x.kwp:g} kWp. Battery: {x.battery_kwh:g} kWh. Tariff: {tariff.name}.",
             f"- With smart control the site earns about Rs {ems['annual_benefit_inr']:,.0f} a year; with the battery left idle, Rs {idle['annual_benefit_inr']:,.0f}.",
             f"- Payback: {ems['payback_years']:.1f} years" + (f" ({ems['payback_years_after_subsidy']:.1f} after the subsidy)." if site.subsidy_inr else "."),
             f"- Power cuts: critical load left unserved on the test days was {ems['unserved_critical_kwh']:.2f} kWh with smart control and {idle['unserved_critical_kwh']:.2f} kWh with an idle battery.",
             "", f"## Battery size advice (battery price is an assumption: Rs {x.battery_inr_per_kwh:.0f} per kWh)", "",
             adv.to_markdown(), "", advise_text(adv, x.backup_hours, x.lang), "",
             "_Weather is a real typical year laid over your dates. Outages are not in your file, so none were assumed. Check every rate against your bill._"]
    text = "\n".join(lines)
    pathlib.Path(x.out).write_text(text)
    print(text)


if __name__ == "__main__":
    main()
