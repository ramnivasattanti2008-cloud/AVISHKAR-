"""Real-data adapter: measured weather and a measured load profile instead of simulated ones.

What is real here (see also ceew.py: measured Indian household load and outages, CC0):
  * Weather: hourly plane-of-array irradiance and air temperature at the site's own tilt/azimuth from
    PVGIS (EU JRC, ERA5 reanalysis), fetched with pvlib's `get_pvgis_hourly` and cached under data/real/.
  * Load: a measured 15-minute commercial load profile (Tjaden, Zenodo 4683455, CC-BY 4.0), scaled to
    the site's average load. It is a German factory, not an Indian site: replace it with a real meter.
  * Day-ahead forecast inputs are persistence (yesterday's clearness and temperature), which only uses
    information that exists the evening before. No archived NWP forecast was reachable.
What is still an assumption (no public source reachable): outage log (`sim.simulate_outages`), P2P prices.
"""

from __future__ import annotations

import calendar
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from pvlib.iotools import get_pvgis_hourly

from avishkar_ems.ceew import household_series
from avishkar_ems.pvmodel import clearsky_poa, pv_power_kw
from avishkar_ems.sim import STEPS_PER_DAY, simulate_outages
from avishkar_ems.site import SiteSpec
from avishkar_ems.subsidy import pm_surya_ghar
from avishkar_ems.tariffs import load_tariff

DATA = Path(__file__).resolve().parents[2] / "data" / "real"
LOAD_CSV = DATA / "load_tool.csv"  # Tjaden, Zenodo 4683455, CC-BY 4.0, measured, 2018, 15-minute


def _weather_stem(site: SiteSpec) -> str:
    # the location is part of the key: two sites that share a name but not a place must not share weather
    return f"pvgis_{site.site_id}_{site.lat:.2f}_{site.lon:.2f}_{site.tilt:.0f}_{site.azimuth:.0f}"


def _cached_files(site: SiteSpec) -> list[tuple[int, int, Path]]:
    """(first year, last year, file) for every cached weather file of exactly this site, place and angles."""
    stem = _weather_stem(site)
    out = []
    for f in sorted(DATA.glob(f"{stem}_*_*.csv")):
        try:
            first, last = (int(x) for x in f.stem[len(stem) + 1:].split("_"))
        except ValueError:
            continue
        out.append((first, last, f))
    return out


def cached_weather_years(site: SiteSpec) -> tuple[int, int] | None:
    """The first and last year of a cached weather file for this site, or None if nothing is cached."""
    files = _cached_files(site)
    return (files[0][0], files[0][1]) if files else None


def _covering_cache(site: SiteSpec, start: int, end: int) -> pd.DataFrame | None:
    """Rows for start..end from any cached file of this site whose year range covers them (else None)."""
    for first, last, f in _cached_files(site):
        if first <= start and end <= last:
            d = pd.read_csv(f, index_col=0, parse_dates=True)
            return d[(d.index.year >= start) & (d.index.year <= end)]
    return None


def pvgis_weather(site: SiteSpec, start: int, end: int) -> pd.DataFrame:
    """Hourly poa_global (W/m2) and temp_air (C) in site-local time, cached on disk.

    A cached file covering the requested years is reused; otherwise the weather is downloaded from PVGIS."""
    cached = _covering_cache(site, start, end)
    if cached is not None:
        return cached
    try:
        d, _ = get_pvgis_hourly(site.lat, site.lon, start=start, end=end, surface_tilt=site.tilt,
                                surface_azimuth=site.azimuth - 180, pvcalculation=False, components=False,
                                usehorizon=True, map_variables=True)
    except requests.exceptions.RequestException as e:
        raise RuntimeError(
            f"Could not download weather for ({site.lat:.2f}, {site.lon:.2f}) from PVGIS ({type(e).__name__}). "
            "Check the internet connection and try again; weather for the three demo sites is bundled and works offline."
        ) from e
    d = d[["poa_global", "temp_air"]].tz_convert(site.tz)
    f = DATA / f"{_weather_stem(site)}_{start}_{end}.csv"
    f.parent.mkdir(parents=True, exist_ok=True)
    d.to_csv(f)
    return d


def measured_load(index: pd.DatetimeIndex, avg_kw: float) -> np.ndarray:
    """Map each timestamp onto the measured year 52 weeks at a time so weekday patterns line up."""
    raw = pd.read_csv(LOAD_CSV, sep=";", decimal=",", parse_dates=[0])
    prof = pd.Series(raw.iloc[:, 1].to_numpy(float), index=raw.iloc[:, 0] - pd.Timedelta(minutes=15))
    prof = prof.reindex(pd.date_range(prof.index[0], periods=364 * STEPS_PER_DAY, freq="15min")).ffill()
    local = index.tz_localize(None)
    days = np.asarray((local.normalize() - pd.Timestamp("2018-01-01")).days)
    slot = np.asarray(local.hour * 4 + local.minute // 15)
    vals = prof.to_numpy()[(days % 364) * STEPS_PER_DAY + slot]
    return vals * avg_kw / prof.mean()


def real_site_frame(site: SiteSpec, start: int = 2021, end: int = 2023, avg_load_kw: float | None = None,
                    seed: int = 0, meter: str | None = None, load_kw: pd.Series | None = None,
                    outage: pd.Series | None = None, weather_year: int = 2023) -> pd.DataFrame:
    """15-minute frame in the `schema.py` contract, built from measured weather and load.

    With `meter` (a CEEW household id such as 'MH43') the load AND the grid outages are measured, and the
    period is that meter's own span; otherwise the German profile is used with assumed outages.
    With `load_kw` (your own meter, 15-minute kW with a tz-aware index) the weather is the real `weather_year`
    (a typical year) laid over your dates, and `outage` (bool, optional) is your own record of cuts."""
    hh = None
    w_override = None
    if load_kw is not None:
        index = load_kw.index
        base = pvgis_weather(site, weather_year, weather_year)
        parts = []
        for y in sorted(set(index.year)):
            b = base if calendar.isleap(y) else base[~((base.index.month == 2) & (base.index.day == 29))]
            parts.append(b.set_axis(pd.DatetimeIndex([t.replace(year=y) for t in b.index])))  # a missing 29 Feb is interpolated
        w_override = pd.concat(parts).sort_index()
        start, end = index[0].year, index[-1].year
    elif meter:
        hh = household_series(meter)
        hh.index = hh.index.tz_localize(site.tz, nonexistent="shift_forward", ambiguous="NaT")
        hh = hh[hh.index.notna()]
        start, end = hh.index[0].year, hh.index[-1].year
        index = hh.index
    else:
        index = pd.date_range(f"{start}-01-01", f"{end}-12-31 23:45", freq="15min", tz=site.tz)
    w = w_override if w_override is not None else pvgis_weather(site, start, end)
    cs_h = clearsky_poa(site, w.index)
    kt_h = (w["poa_global"].to_numpy() / cs_h["poa_clear"].replace(0, np.nan).to_numpy())
    kt_h = pd.Series(kt_h, index=w.index).clip(0, 1.2)
    kt = kt_h.reindex(kt_h.index.union(index)).interpolate(limit_area="inside").reindex(index).ffill().bfill()
    kt = kt.fillna(0.0).clip(0, 1.2).to_numpy()
    cs = clearsky_poa(site, index)
    poa = cs["poa_clear"].to_numpy() * kt
    temp = w["temp_air"].reindex(w.index.union(index)).interpolate().reindex(index).ffill().bfill().to_numpy()

    pv_clear_kw = pv_power_kw(site, cs["poa_clear"].to_numpy(), temp)
    pv_kw = pv_power_kw(site, poa, temp)
    day = np.repeat(np.arange(len(index) // STEPS_PER_DAY), STEPS_PER_DAY)
    sun = cs["poa_clear"].to_numpy() > 50
    kt_day = pd.Series(np.where(sun, kt, np.nan)).groupby(day).mean()
    kt_fcst = kt_day.shift(1).bfill().to_numpy()[day]  # persistence: yesterday's clearness
    temp_fcst = pd.Series(temp, index=index).shift(STEPS_PER_DAY).bfill().to_numpy()
    storm_prob = 1.0 / (1.0 + np.exp(-8.0 * (0.45 - kt_fcst)))

    if load_kw is not None:
        load = load_kw.to_numpy()
        out_arr = (outage.reindex(index).fillna(False).to_numpy(bool) if outage is not None
                   else np.zeros(len(index), dtype=bool))
        outage_arr, planned = out_arr, np.zeros(len(index), dtype=bool)
    elif hh is not None:
        load, outage_arr = hh["load_kw"].to_numpy(), hh["outage"].to_numpy()
        planned = np.zeros(len(index), dtype=bool)  # the dataset does not record outage notices
    else:
        avg = avg_load_kw if avg_load_kw is not None else 0.22 * site.dc_kwp
        load = np.maximum(measured_load(index, avg), site.critical_kw)
        outage_arr, planned = simulate_outages(index, np.random.default_rng(seed))
    imp, exp = site.tariff.import_rates(index), site.tariff.export_rates(index)
    p2p = exp + (imp - exp) * site.tariff.p2p_share  # no market data reachable: an assumed share of the retail premium
    return pd.DataFrame({
        "pv_kw": pv_kw, "load_kw": load, "expected_kw": pv_kw, "pv_clear_kw": pv_clear_kw, "poa_wm2": poa,
        "temp_c": temp, "kt_actual": kt, "kt_fcst": kt_fcst, "temp_fcst": temp_fcst, "storm_prob": storm_prob,
        "outage": outage_arr, "planned_notice": planned, "import_rate": imp, "export_rate": exp,
        "p2p_price": p2p, "p2p_price_fcst": p2p}, index=index)


def real_sites() -> dict[str, tuple[SiteSpec, str, str | None]]:
    """Real-data sites: (spec, load kind, CEEW meter id or None for the German commercial profile)."""
    from avishkar_ems.sim import demo_sites
    from avishkar_ems.tariffs import DOMESTIC_FLAT

    ds = demo_sites()
    home = SiteSpec("home-mathura", 27.49, 77.67, 3.0, 3.0, 20, 180, 5.0, 3.0, 0.3, 4.0, 305_000,
                    tariff=DOMESTIC_FLAT, subsidy_inr=pm_surya_ghar(3.0))
    out = {"home-mathura": (home, "home", "MH43"),
           "shop-pune": (*ds["shop-pune"], None), "clinic-jaipur": (*ds["clinic-jaipur"], None)}
    for key, (site, kind, meter) in out.items():  # a real tariff file, if provided, replaces the illustrative preset
        f = DATA.parent / "tariffs" / f"{key}.json"
        if f.exists():
            out[key] = (replace(site, tariff=load_tariff(f)), kind, meter)
    return out
