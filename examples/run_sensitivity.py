"""How payback moves with battery size and with the export (net-metering) rate, on real data.

    python examples/run_sensitivity.py   ->   results/sensitivity.csv
"""

import logging
import pathlib
from dataclasses import replace

import pandas as pd

from avishkar_ems.demo import prepare
from avishkar_ems.payback import evaluate
from avishkar_ems.realdata import real_sites

logging.disable(logging.WARNING)
OUT = pathlib.Path(__file__).resolve().parents[1] / "results"


def main() -> None:
    rows = []
    for key in real_sites():
        p = prepare(key)
        days = list(pd.date_range(p.test_start, p.test_end, freq="28D"))
        for bat in (0.0, 0.5, 1.0, 2.0):
            for exp in (p.site.tariff.export_rate, p.site.tariff.export_rate + 2.0):
                site = replace(p.site, battery_kwh=max(p.site.battery_kwh * bat, 0.01),
                               battery_kw=max(p.site.battery_kw * bat, 0.01),
                               tariff=replace(p.site.tariff, export_rate=exp))
                df = p.df.copy()  # prices are columns of the frame, so rebuild them for the changed tariff
                df["export_rate"] = site.tariff.export_rates(df.index)
                df["p2p_price"] = df["p2p_price_fcst"] = df["export_rate"] + (df["import_rate"] - df["export_rate"]) * 0.55
                ev = evaluate(site, df, p.pv_model, p.load_model, days, with_hindsight=False, with_replan=False)
                t = ev.payback_table()
                rows.append({"site": key, "battery_x": bat, "export_rate": exp,
                             "ems_benefit_inr": t.loc["EMS", "annual_benefit_inr"],
                             "idle_benefit_inr": t.loc["Baseline: self-consume + export (battery idle)", "annual_benefit_inr"],
                             "ems_unserved_kwh": t.loc["EMS", "unserved_critical_kwh"]})
                print(rows[-1])
    pd.DataFrame(rows).to_csv(OUT / "sensitivity.csv", index=False)


if __name__ == "__main__":
    main()
