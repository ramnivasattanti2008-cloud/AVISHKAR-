"""Analyse your own site from a meter CSV. Prints a plain-language report and writes it to my_site_report.md.

    python examples/analyze_my_site.py --load my_meter.csv --lat 27.49 --lon 77.67 --kwp 3 --battery-kwh 5 \
        --cost 305000 --base-rate 7.0 --backup-hours 4 --critical-kw 0.4

Needs about six months of data or more (a year is better). Weather is real (PVGIS, a typical year laid over your dates).
Your DISCOM's real rates go in a JSON file passed with --tariff (see data/tariffs/template.json).
"""

import argparse
import logging
import pathlib

from avishkar_ems.advisor import BATTERY_INR_PER_KWH
from avishkar_ems.mysite import AnalysisError, analyse, build_tariff, report_markdown
from avishkar_ems.userdata import read_meter_csv

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")


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
    a.add_argument("--weather-year", type=int, help="PVGIS year laid over your dates (default: 2023, or a bundled site's middle year)")
    a.add_argument("--site-id", help="weather cache name (default: my-site, or the bundled demo site at the same place)")
    a.add_argument("--critical-kw", type=float, default=0.3)
    a.add_argument("--backup-hours", type=float, default=4)
    a.add_argument("--tariff", help="JSON file with your DISCOM rates")
    a.add_argument("--base-rate", type=float, default=7.0, help="used if no tariff file: a flat rate, or a ToD built from it")
    a.add_argument("--tod", action="store_true", help="build a Time-of-Day tariff from the base rate using the national rules")
    a.add_argument("--commercial", action="store_true")
    a.add_argument("--export-rate", type=float, default=3.0)
    a.add_argument("--battery-inr-per-kwh", type=float, default=BATTERY_INR_PER_KWH)
    a.add_argument("--subsidy", choices=["none", "pm-surya-ghar"], default="none")
    a.add_argument("--lang", choices=["en", "hi"], default="en")
    a.add_argument("--sep", default=None)
    a.add_argument("--decimal", default=".")
    a.add_argument("--out", default="my_site_report.md")
    x = a.parse_args()

    load = read_meter_csv(x.load, sep=x.sep, decimal=x.decimal)
    tariff = build_tariff(tariff_file=x.tariff, base_rate=x.base_rate, tod=x.tod, commercial=x.commercial,
                          export_rate=x.export_rate)
    try:
        report = analyse(load, lat=x.lat, lon=x.lon, kwp=x.kwp, cost=x.cost, tariff=tariff, battery_kwh=x.battery_kwh,
                         tilt=x.tilt, azimuth=x.azimuth, critical_kw=x.critical_kw, backup_hours=x.backup_hours,
                         commercial=x.commercial, subsidy=x.subsidy == "pm-surya-ghar",
                         battery_inr_per_kwh=x.battery_inr_per_kwh, site_id=x.site_id,
                         weather_year=x.weather_year)
    except (AnalysisError, RuntimeError) as e:  # plain-language problems; anything else is a bug and keeps its traceback
        raise SystemExit(str(e)) from e
    text = report_markdown(report, x.lang)
    pathlib.Path(x.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
