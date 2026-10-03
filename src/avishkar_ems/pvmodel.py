"""Physical PV model from site metadata (location, tilt, azimuth, losses), built on pvlib.

It gives the 'modelled baseline' the statement asks for: what the site SHOULD produce for the
irradiance and temperature it actually sees. The monitor compares actual output against it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from pvlib import irradiance
from pvlib.location import Location

from avishkar_ems.site import SiteSpec


def clearsky_poa(site: SiteSpec, index: pd.DatetimeIndex) -> pd.DataFrame:
    """Clear-sky plane-of-array irradiance (W/m2) for the site's tilt and azimuth."""
    loc = Location(site.lat, site.lon, tz=site.tz, altitude=site.altitude)
    cs = loc.get_clearsky(index, model="simplified_solis")
    sp = loc.get_solarposition(index)
    poa = irradiance.get_total_irradiance(
        site.tilt, site.azimuth, sp["apparent_zenith"], sp["azimuth"],
        cs["dni"], cs["ghi"], cs["dhi"], model="isotropic",
    )
    out = pd.DataFrame({"ghi_clear": cs["ghi"], "poa_clear": poa["poa_global"].fillna(0.0)})
    out.loc[sp["apparent_zenith"] >= 90, "poa_clear"] = 0.0
    return out


def pv_power_kw(site: SiteSpec, poa_wm2: np.ndarray, temp_c: np.ndarray) -> np.ndarray:
    """AC power in kW for given POA irradiance and ambient temperature."""
    poa = np.clip(np.asarray(poa_wm2, dtype=float), 0.0, None)
    cell_temp = np.asarray(temp_c, dtype=float) + 0.03 * poa
    derate = 1.0 + site.temp_coeff * (cell_temp - 25.0)
    dc = site.dc_kwp * poa / 1000.0 * (1.0 - site.loss_frac) * derate
    return np.clip(dc, 0.0, site.ac_kw)
