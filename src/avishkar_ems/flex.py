"""Find shiftable loads in a meter series: bursts above the site's base load that happen outside the sun hours.

Works on any 15-minute load series (a smart meter, or the organisers' data). It reports candidate appliances (water
heater, AC, pump) by time of day, size and length, and an upper bound on what moving them into the solar window saves.
"""

from __future__ import annotations

import pandas as pd

SOLAR = (10.0, 16.0)


def find_bursts(load_kw: pd.Series, min_kw: float | None = None, min_steps: int = 2, max_steps: int = 16) -> pd.DataFrame:
    day = load_kw.index.normalize()
    base = load_kw.groupby(day).transform(lambda x: x.quantile(0.2))
    ex = (load_kw - base).clip(lower=0)
    thr = min_kw if min_kw is not None else max(0.3, 0.5 * float(load_kw.mean()))
    on = (ex > thr).to_numpy()
    rows, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            if min_steps <= j - i <= max_steps:
                seg = ex.iloc[i:j]
                rows.append({"start": load_kw.index[i], "hours": (j - i) * 0.25, "kw": float(seg.mean()),
                             "kwh": float(seg.sum() * 0.25)})
            i = j
        else:
            i += 1
    return pd.DataFrame(rows)


def summarise(load_kw: pd.Series, import_rate: pd.Series, export_rate: float) -> pd.DataFrame:
    """One row per time-of-day group of bursts, with the yearly energy and the most it could save if moved to 10:00-16:00."""
    b = find_bursts(load_kw)
    if b.empty:
        return b
    b["hour"] = b["start"].dt.hour
    b["group"] = pd.cut(b["hour"], [-1, 5, 9, 15, 19, 23], labels=["night", "morning", "midday", "evening", "late"])
    b["outside_sun"] = ~((b["hour"] >= SOLAR[0]) & (b["hour"] < SOLAR[1]))
    b["gain"] = b["kwh"] * (import_rate.reindex(b["start"]).to_numpy() - export_rate).clip(min=0) * b["outside_sun"]
    days = max((load_kw.index[-1] - load_kw.index[0]).days, 1)
    g = b.groupby("group", observed=True).agg(events=("kwh", "size"), typical_kw=("kw", "median"),
                                              typical_hours=("hours", "median"), kwh=("kwh", "sum"), gain=("gain", "sum"))
    g["kwh_per_year"] = g["kwh"] * 365 / days
    g["max_saving_inr_per_year"] = g["gain"] * 365 / days
    return g.drop(columns=["kwh", "gain"]).round(2)
