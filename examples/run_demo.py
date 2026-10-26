"""Headless demo: run the EMS on all demo sites and write the results to ./results.

    python examples/run_demo.py            # about 3 minutes
    python examples/run_demo.py --quick    # fewer days, about 1 minute
"""

import argparse
import json
import logging
import pathlib

import pandas as pd

from avishkar_ems.demo import day_view, forecast_quality, prepare, run_payback
from avishkar_ems.ies import catalog_publish
from avishkar_ems.realdata import real_sites
from avishkar_ems.report import write_provenance

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
OUT = pathlib.Path(__file__).resolve().parent.parent / "results"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    every = 21 if args.quick else 7
    rows, fq_rows, sampled, p2p = [], [], {}, {}
    for key in real_sites():
        p = prepare(key)
        ev = run_payback(p, every_days=every)
        t = ev.payback_table()
        t.insert(0, "site", key)
        rows.append(t.reset_index(names="scenario"))
        fq = forecast_quality(p)
        fq.insert(0, "site", key)
        fq_rows.append(fq.reset_index(names="series"))
        e = ev.ems
        sampled[key] = e.days
        p2p[key] = {"offers": len(ev.offers), "committed_kwh": e.committed_kwh, "delivered_kwh": e.traded_kwh,
                    "shortfall_kwh": e.shortfall_kwh}
        if len(ev.non_optimal_days()):
            print(f"WARNING: {len(ev.non_optimal_days())} sampled days at {key} had a non-optimal plan:")
            print(ev.non_optimal_days().to_string())
        print(f"\n== {key}  ({e.days} sampled days of the held-out year, annualised)")
        print(t.drop(columns="site").round(2).to_string())
        print(f"   P2P: {len(ev.offers)} offers, {e.committed_kwh:.0f} kWh committed, "
              f"{e.traded_kwh:.0f} delivered, {e.shortfall_kwh:.1f} kWh shortfall")
    pd.concat(rows).to_csv(OUT / "payback.csv", index=False)
    pd.concat(fq_rows).to_csv(OUT / "forecast_quality.csv", index=False)
    write_provenance(OUT, "run_demo", every_days=every, quick=args.quick, sampled_days=sampled, p2p=p2p)
    # One example offer message from a clear Sunday at the shop.
    p = prepare("shop-pune")
    for d in pd.date_range(p.test_start, p.test_end, freq="3D"):  # first day with a reliable surplus
        dv = day_view(p, d)
        if dv.offers:
            break
    (OUT / "example_offers.json").write_text(json.dumps(catalog_publish(p.site, dv.offers, now=dv.day - pd.Timedelta(hours=6)), indent=2))
    print(f"\nWrote {OUT}/payback.csv, forecast_quality.csv, example_offers.json")


if __name__ == "__main__":
    main()
