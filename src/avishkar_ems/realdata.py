"""Real-data adapter: measured weather and a measured load profile instead of simulated ones.

What is real here:
  * Weather: hourly plane-of-array irradiance and air temperature at the site's own tilt/azimuth from
    PVGIS (EU JRC, ERA5 reanalysis), fetched with pvlib's `get_pvgis_hourly` and cached under data/real/.
  * Load: a measured 15-minute commercial load profile (Tjaden, Zenodo 4683455, CC-BY 4.0), scaled to
    the site's average load. It is a German factory, not an Indian site: replace it with a real meter.
  * Day-ahead forecast inputs are persistence (yesterday's clearness and temperature), which only uses
    information that exists the evening before. No archived NWP forecast was reachable.
What is still an assumption (no public source reachable): outage log (`sim.simulate_outages`), P2P prices.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from pvlib.iotools import get_pvgis_hourly

from avishkar_ems.pvmodel import clearsky_poa, pv_power_kw
from avishkar_ems.sim import STEPS_PER_DAY, simulate_outages
from avishkar_ems.site import SiteSpec

DATA = Path(__file__).resolve().parents[2] / "data" / "real"
LOAD_CSV = DATA / "load_tool.csv"  # Tjaden, Zenodo 4683455, CC-BY 4.0, measured, 2018, 15-minute


def pvgis_weather(site: SiteSpec, start: int, end: int) -> pd.DataFrame:
    """Hourly poa_global (W/m2) and temp_air (C) in site-local time, cached on disk."""
    f = DATA / f"pvgis_{site.site_id}_{site.tilt:.0f}_{site.azimuth:.0f}_{start}_{end}.csv"
    if f.exists():
        return pd.read_csv(f, index_col=0, parse_dates=True)
    d, _ = get_pvgis_hourly(site.lat, site.lon, start=start, end=end, surface_tilt=site.tilt,
                            surface_azimuth=site.azimuth - 180, pvcalculation=False, components=False, usehorizon=True,
                            map_variables=True)
    d = d[["poa_global", "temp_air"]].tz_convert(site.tz)
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
                    seed: int = 0) -> pd.DataFrame:
    """15-minute frame in the `schema.py` contract, built from measured weather and load."""
    w = pvgis_weather(site, start, end)
    index = pd.date_range(f"{start}-01-01", f"{end}-12-31 23:45", freq="15min", tz=site.tz)
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

    avg = avg_load_kw if avg_load_kw is not None else 0.22 * site.dc_kwp
    load = np.maximum(measured_load(index, avg), site.critical_kw)
    rng = np.random.default_rng(seed)
    outage, planned = simulate_outages(index, rng)
    imp, exp = site.tariff.import_rates(index), site.tariff.export_rates(index)
    p2p = exp + (imp - exp) * 0.55  # no market data reachable: midpoint between export and retail
    return pd.DataFrame({
        "pv_kw": pv_kw, "load_kw": load, "expected_kw": pv_kw, "pv_clear_kw": pv_clear_kw, "poa_wm2": poa,
        "temp_c": temp, "kt_actual": kt, "kt_fcst": kt_fcst, "temp_fcst": temp_fcst, "storm_prob": storm_prob,
        "outage": outage, "planned_notice": planned, "import_rate": imp, "export_rate": exp,
        "p2p_price": p2p, "p2p_price_fcst": p2p}, index=index)
