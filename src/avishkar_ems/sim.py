"""Synthetic multi-site data generator for Indian conditions.

The organisers provide the real dataset separately. Until then (and for tests) this produces data
with the same shape: 15-minute resolution, generation, load, weather with archived day-ahead
forecast errors, grid outages with planned notices, tariffs and P2P clearing prices. The monsoon
months are cloudy and outage-prone. It is a development aid, not a claim about real sites.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from avishkar_ems.pvmodel import clearsky_poa, pv_power_kw
from avishkar_ems.site import SiteSpec

STEPS_PER_DAY = 96
# Typical clear-sky transmittance by calendar month for central/southern India.
_KT_MONTH = [0.85, 0.85, 0.82, 0.78, 0.72, 0.45, 0.38, 0.40, 0.50, 0.70, 0.80, 0.85]
_TEMP_MONTH = [20, 23, 27, 30, 31, 28, 26, 26, 26, 25, 22, 20]


def _load_shape(hour: np.ndarray, kind: str, weekend: np.ndarray) -> np.ndarray:
    if kind == "home":
        shape = 0.5 + 0.6 * np.exp(-(((hour - 7.5) / 1.5) ** 2)) + 1.1 * np.exp(-(((hour - 20) / 2.0) ** 2))
    else:  # commercial: business-hours hump
        shape = 0.45 + 1.0 * np.exp(-(((hour - 13) / 3.8) ** 2))
        shape = np.where(weekend, 0.45 + 0.25 * (shape - 0.45), shape)
    return shape


def simulate_outages(index: pd.DatetimeIndex, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Grid outages (more in the monsoon), some announced the day before. ASSUMPTION, not measured data:
    no public per-site Indian outage log was available. Replace with the DISCOM's outage record."""
    days = len(index) // STEPS_PER_DAY
    n = len(index)
    outage = np.zeros(n, dtype=bool)
    planned = np.zeros(n, dtype=bool)
    for d in range(days):
        m = index[d * STEPS_PER_DAY].month - 1
        rate = 0.04 + (0.10 if 5 <= m <= 8 else 0.0)
        if rng.random() < rate:
            start_step = d * STEPS_PER_DAY + int(rng.uniform(8, 22) * 4)
            length = int(rng.uniform(1, 4) * 4)
            outage[start_step : start_step + length] = True
            if rng.random() < 0.5:
                planned[d * STEPS_PER_DAY : (d + 1) * STEPS_PER_DAY] = True
    return outage, planned


def simulate_site(
    site: SiteSpec,
    start: str = "2025-01-01",
    days: int = 365,
    seed: int = 0,
    load_kind: str = "commercial",
    avg_load_kw: float | None = None,
    faults: dict[str, float] | None = None,
) -> pd.DataFrame:
    """Return a 15-minute DataFrame for one site.

    faults maps 'YYYY-MM-DD' to a multiplier on actual PV output (for example 0.7 for a day with a
    string fault). It affects `pv_kw` only, so `expected_kw` stays the healthy baseline.
    """
    rng = np.random.default_rng(seed)
    index = pd.date_range(start, periods=days * STEPS_PER_DAY, freq="15min", tz=site.tz)
    n = len(index)
    hour = np.asarray(index.hour + index.minute / 60.0, dtype=float)
    month0 = np.asarray(index.month - 1)
    day_pos = np.repeat(np.arange(days), STEPS_PER_DAY)
    weekend = np.asarray(index.dayofweek >= 5)

    # ---- weather: day-level transmittance with persistence, plus fast intraday cloud noise
    kt_day = np.empty(days)
    prev = 0.0
    for d in range(days):
        m = index[d * STEPS_PER_DAY].month - 1
        shock = rng.normal(0.0, 0.16)
        prev = 0.5 * prev + shock
        kt_day[d] = np.clip(_KT_MONTH[m] + prev, 0.12, 0.98)
    noise = pd.Series(rng.normal(size=n)).rolling(6, min_periods=1, center=True).mean().to_numpy()
    kt = np.clip(kt_day[day_pos] * (1.0 + 0.45 * noise), 0.08, 1.0)
    kt_fcst_day = np.clip(kt_day + rng.normal(0.0, 0.10, days), 0.10, 0.98)
    kt_fcst = kt_fcst_day[day_pos]
    storm_prob = 1.0 / (1.0 + np.exp(-8.0 * (0.45 - kt_fcst)))

    day_temp_shift = rng.normal(0.0, 1.5, days)[day_pos]
    temp = (np.array(_TEMP_MONTH)[month0] + 7.0 * np.clip(np.sin(np.pi * (hour - 8.0) / 14.0), 0, None)
            + day_temp_shift)
    temp_fcst = temp + rng.normal(0.0, 1.0, n)

    # ---- generation
    cs = clearsky_poa(site, index)
    poa = cs["poa_clear"].to_numpy() * kt
    pv_clear_kw = pv_power_kw(site, cs["poa_clear"].to_numpy(), temp)
    expected_kw = pv_power_kw(site, poa, temp)
    pv_kw = expected_kw * (1.0 + rng.normal(0.0, 0.01, n))
    for day, factor in (faults or {}).items():
        mask = np.asarray(index.strftime("%Y-%m-%d") == day)
        pv_kw[mask] = pv_kw[mask] * factor
    pv_kw = np.clip(pv_kw, 0.0, site.ac_kw)

    # ---- load
    if avg_load_kw is None:  # typical rooftop sizing: array covers most but not all of the load
        avg_load_kw = (0.18 if load_kind == "home" else 0.22) * site.dc_kwp
    shape = _load_shape(hour, load_kind, weekend)
    cooling = 1.0 + 0.04 * np.clip(temp - 28.0, 0.0, None)
    ar = pd.Series(rng.normal(0.0, 0.08, n)).ewm(alpha=0.15).mean().to_numpy() * 3.0
    load_kw = np.clip(avg_load_kw * shape / shape.mean() * cooling * (1.0 + ar), 0.15 * avg_load_kw, None)
    load_kw = np.maximum(load_kw, site.critical_kw)

    outage, planned = simulate_outages(index, rng)

    # ---- economics
    import_rate = site.tariff.import_rates(index)
    export_rate = site.tariff.export_rates(index)
    frac_day = rng.uniform(0.35, 0.75, days)[day_pos]
    p2p_price = np.clip(export_rate + (import_rate - export_rate) * (frac_day + rng.normal(0, 0.03, n)),
                        export_rate, import_rate)
    p2p_price_fcst = export_rate + (import_rate - export_rate) * site.tariff.p2p_share

    return pd.DataFrame(
        {
            "pv_kw": pv_kw, "load_kw": load_kw, "expected_kw": expected_kw, "pv_clear_kw": pv_clear_kw,
            "poa_wm2": poa, "temp_c": temp, "kt_actual": kt, "kt_fcst": kt_fcst,
            "temp_fcst": temp_fcst, "storm_prob": storm_prob, "outage": outage,
            "planned_notice": planned, "import_rate": import_rate, "export_rate": export_rate,
            "p2p_price": p2p_price, "p2p_price_fcst": p2p_price_fcst,
        },
        index=index,
    )


def demo_sites() -> dict[str, tuple[SiteSpec, str]]:
    """Three representative Indian sites: rooftop home, small shop, clinic with critical load."""
    from avishkar_ems.tariffs import COMMERCIAL_TOD, DOMESTIC_FLAT

    return {
        "home-bengaluru": (
            SiteSpec("home-bengaluru", 12.97, 77.59, 5.0, 5.0, 12, 180, 10.0, 5.0, 0.8, 4.0, 450_000,
                     tariff=DOMESTIC_FLAT), "home"),
        "shop-pune": (
            SiteSpec("shop-pune", 18.52, 73.86, 15.0, 15.0, 15, 180, 20.0, 10.0, 1.5, 4.0, 1_150_000,
                     tariff=COMMERCIAL_TOD), "commercial"),
        "clinic-jaipur": (
            SiteSpec("clinic-jaipur", 26.91, 75.79, 30.0, 30.0, 20, 180, 40.0, 20.0, 4.0, 6.0, 2_300_000,
                     tariff=COMMERCIAL_TOD), "commercial"),
    }
