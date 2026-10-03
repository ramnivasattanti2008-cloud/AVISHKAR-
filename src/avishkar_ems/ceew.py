"""Real Indian household load and grid-outage data from the CEEW smart-meter dataset (CC0).

Source: Agrawal, Mani, Jain, Ganesan, "High frequency smart meter data from two districts in India (Mathura and
Bareilly)", Harvard Dataverse, doi:10.7910/DVN/GOCHJH. Three-minute kWh, voltage and current per meter, May 2019 to
Oct 2021. A reading with voltage near zero means the grid was down, so outages here are measured, not generated.

`build_meter_csv` turns raw files into one small 15-minute CSV per meter (committed under data/real/).
`household_series` loads that CSV.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[2] / "data" / "real"
DOI = "doi:10.7910/DVN/GOCHJH"
OUTAGE_VOLT = 50.0  # a bin whose mean voltage is below this is a grid outage


def build_meter_csv(raw_files: list[str], meter: str, out: Path | None = None) -> Path:
    parts = []
    for f in raw_files:
        for ch in pd.read_csv(f, parse_dates=["x_Timestamp"], chunksize=500_000):
            parts.append(ch[ch["meter"] == meter])
    d = pd.concat(parts).drop_duplicates("x_Timestamp").set_index("x_Timestamp").sort_index()
    b = pd.DataFrame({"kwh": d["t_kWh"].resample("15min").sum(min_count=1),
                      "volt": d["z_Avg Voltage (Volt)"].resample("15min").mean()})
    b["load_kw"] = b["kwh"] / 0.25
    b["outage"] = b["volt"] < OUTAGE_VOLT
    b.loc[b["outage"], "load_kw"] = np.nan  # consumption is not metered while the grid is down
    out = out or DATA / f"ceew_{meter}_15min.csv"
    b[["load_kw", "volt", "outage"]].to_csv(out)
    return out


def household_series(meter: str) -> pd.DataFrame:
    """15-minute load_kw (outage steps filled with the meter's typical load for that time of day), outage flag."""
    b = pd.read_csv(DATA / f"ceew_{meter}_15min.csv", index_col=0, parse_dates=True)
    b["outage"] = b["outage"].astype(bool)
    slot = b.index.hour * 4 + b.index.minute // 15
    typical = b["load_kw"].groupby(slot).transform("median")
    b["load_kw"] = b["load_kw"].fillna(typical).interpolate(limit=8).fillna(typical)
    return b[["load_kw", "outage"]]
