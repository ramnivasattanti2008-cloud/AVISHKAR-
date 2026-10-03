"""Say in plain words why the plan does what it does, so the owner can check it makes sense."""

from __future__ import annotations

import numpy as np
import pandas as pd


def _windows(mask: np.ndarray, index: pd.DatetimeIndex) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            out.append((index[i], index[j - 1] + pd.Timedelta(minutes=15)))
            i = j
        else:
            i += 1
    return out


def explain_day(plan_steps: pd.DataFrame, reserve, offers, lang: str = "en") -> list[str]:
    s = plan_steps
    idx = s.index
    kw_thr = 0.05
    night_grid = (s["batt_kw"] < -kw_thr) & (s["grid_kw"] > kw_thr) & (s["pv_p50"] < 0.02 * max(s["pv_p50"].max(), 1e-6))
    sun_charge = (s["batt_kw"] < -kw_thr) & (s["pv_p50"] >= 0.02 * max(s["pv_p50"].max(), 1e-6))
    dis = s["batt_kw"] > kw_thr
    en = lang == "en"
    fmt = lambda a, b: f"{a:%H:%M}-{b:%H:%M}"  # noqa: E731
    lines = []
    lines.append(f"Reserve: the battery will not go below {reserve.floor_soc:.0%}. {reserve.reason}" if en else
                  f"रिज़र्व: बैटरी {reserve.floor_soc:.0%} से नीचे नहीं जाएगी। {reserve.reason}")
    for a, b in _windows(night_grid.to_numpy(), idx):
        p = float(s.loc[a:b - pd.Timedelta(minutes=15), "import_rate"].mean())
        lines.append(f"Charging from the grid {fmt(a, b)} at Rs {p:.1f}/kWh, cheaper than the evening rate." if en else
                     f"{fmt(a, b)} ग्रिड से चार्जिंग, ₹{p:.1f}/यूनिट पर, जो शाम के रेट से सस्ता है।")
    for a, b in _windows(sun_charge.to_numpy(), idx):
        lines.append(f"Charging from spare sun {fmt(a, b)}." if en else f"{fmt(a, b)} फ़ालतू धूप से चार्जिंग।")
    for a, b in _windows(dis.to_numpy(), idx):
        p = float(s.loc[a:b - pd.Timedelta(minutes=15), "import_rate"].mean())
        lines.append(f"Using the battery {fmt(a, b)} when grid power costs Rs {p:.1f}/kWh." if en else
                     f"{fmt(a, b)} बैटरी का उपयोग, जब ग्रिड बिजली ₹{p:.1f}/यूनिट है।")
    if offers:
        q = sum(o.quantity_kwh for o in offers)
        lines.append(f"Offering {q:.1f} kWh to neighbours, sized on the safe (low sun, high load) case." if en else
                     f"पड़ोसियों को {q:.1f} kWh का ऑफ़र, सुरक्षित अनुमान (कम धूप, ज़्यादा लोड) पर।")
    else:
        lines.append("No offers: no surplus is safe enough to promise." if en else
                     "कोई ऑफ़र नहीं: वादा करने लायक सुरक्षित अतिरिक्त बिजली नहीं।")
    return lines
