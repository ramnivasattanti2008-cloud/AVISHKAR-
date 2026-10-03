"""Column contract between a data source and the EMS, plus a validator.

The organisers' dataset is supplied separately. Write a small adapter that returns one DataFrame per
site with exactly these columns (15-minute, timezone-aware index) and call `validate_site_frame` on it.
The simulator in `sim.py` already produces this shape.
"""

from __future__ import annotations

import pandas as pd

# column: (meaning, unit)
REQUIRED_COLUMNS = {
    "pv_kw": ("actual AC generation", "kW"),
    "load_kw": ("actual site load", "kW"),
    "poa_wm2": ("actual plane-of-array irradiance, for the monitor", "W/m2"),
    "expected_kw": ("modelled generation for the actual weather (see pvmodel.pv_power_kw)", "kW"),
    "pv_clear_kw": ("modelled clear-sky generation from site metadata (see pvmodel)", "kW"),
    "kt_fcst": ("archived day-ahead clear-sky transmittance forecast, 0..1", "-"),
    "temp_fcst": ("archived day-ahead ambient temperature forecast", "C"),
    "storm_prob": ("day-ahead storm or heavy-rain probability, 0..1", "-"),
    "outage": ("grid outage in this step", "bool"),
    "planned_notice": ("a planned-outage notice exists for this day", "bool"),
    "import_rate": ("retail time-of-day tariff", "INR/kWh"),
    "export_rate": ("net-metering or feed-in rate", "INR/kWh"),
    "p2p_price": ("realised P2P buyer clearing price", "INR/kWh"),
    "p2p_price_fcst": ("day-ahead expected P2P price used for planning", "INR/kWh"),
}
STEP = pd.Timedelta(minutes=15)


def validate_site_frame(df: pd.DataFrame) -> list[str]:
    """Return a list of problems; an empty list means the frame is usable."""
    problems = []
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        problems.append(f"missing columns: {missing}")
    if not isinstance(df.index, pd.DatetimeIndex) or df.index.tz is None:
        problems.append("index must be a timezone-aware DatetimeIndex")
        return problems
    if not (df.index.to_series().diff().dropna() == STEP).all():
        problems.append("index must be strictly regular at 15 minutes (fill or drop gaps first)")
    if len(df) < 8 * 96 + 1:
        problems.append("need more than 8 days of history for the load lag features")
    for c in ("pv_kw", "load_kw", "import_rate", "export_rate"):
        if c in df.columns and df[c].isna().any():
            problems.append(f"{c} has missing values")
    return problems
