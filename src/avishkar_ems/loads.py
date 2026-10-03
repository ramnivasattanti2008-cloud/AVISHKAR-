"""When to run a flexible load (geyser, washing machine, pump, EV charger) so it uses the cheapest or the sunniest hours.

Cost of each step: energy the load needs beyond the forecast spare sun is bought from the grid at the import rate;
energy covered by spare sun costs the export income it displaces. Uses the P50 forecast of the day plan, so it is a
good guide, not a guarantee.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def best_start(plan_steps: pd.DataFrame, kw: float, hours: float, earliest: float = 0.0, latest: float = 24.0,
               top: int = 3) -> pd.DataFrame:
    s = plan_steps
    n = int(round(hours * 4))
    spare = np.clip(s["pv_p50"].to_numpy() - s["load_p50"].to_numpy(), 0, None)
    grid_kw = np.clip(kw - spare, 0, None)
    cost = (grid_kw * s["import_rate"].to_numpy() + (kw - grid_kw) * s["export_rate"].to_numpy()) * 0.25
    c = np.convolve(cost, np.ones(n), mode="valid")
    solar_share = 1 - np.convolve(grid_kw, np.ones(n), mode="valid") / (kw * n)
    starts = s.index[: len(c)]
    hr = np.asarray(starts.hour + starts.minute / 60.0)
    ok = (hr >= earliest) & (hr + hours <= latest)
    df = pd.DataFrame({"start": starts, "cost_inr": c, "share_from_sun": solar_share})[ok]
    if df.empty:
        return df
    worst = float(df["cost_inr"].max())
    df = df.sort_values("cost_inr").head(top).copy()
    df["saving_vs_worst_time_inr"] = worst - df["cost_inr"]
    df["start"] = df["start"].dt.strftime("%H:%M")
    return df.round(2).reset_index(drop=True)
