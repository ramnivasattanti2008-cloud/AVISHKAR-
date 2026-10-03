"""Read a household's or shop's own meter file (CSV) into a 15-minute kW series.

The file needs a timestamp column and one usage column. The usage column can be power (kW or W) or energy per interval
(kWh or Wh). Column names are matched loosely, so a smart-meter download or a utility export usually works as it is.
Gaps up to two hours are filled from the same time on neighbouring days. Anything longer is left out.
"""

from __future__ import annotations

import pandas as pd

_TS = ("timestamp", "datetime", "date_time", "time", "date", "x_timestamp", "reading_time")
_USE = ("load_kw", "kw", "power", "consumption", "usage", "kwh", "wh", "load", "energy", "t_kwh", "active_power")


def read_meter_csv(path: str, tz: str = "Asia/Kolkata", sep: str | None = None, decimal: str = ".") -> pd.Series:
    raw = pd.read_csv(path, sep=sep, engine="python", decimal=decimal)
    low = {c.lower().strip(): c for c in raw.columns}
    ts_col = next((low[c] for c in _TS if c in low), raw.columns[0])
    use_col = next((low[c] for c in _USE if c in low), None)
    if use_col is None:
        num = [c for c in raw.columns if c != ts_col and pd.api.types.is_numeric_dtype(raw[c])]
        if not num:
            raise ValueError("no numeric usage column found; name it load_kw, kwh, power or consumption")
        use_col = num[0]
    t = pd.to_datetime(raw[ts_col], dayfirst=True, errors="coerce")
    ok = t.notna()
    s = pd.Series(pd.to_numeric(raw.loc[ok, use_col], errors="coerce").to_numpy(), index=pd.DatetimeIndex(t[ok]))
    s = s[~s.index.duplicated()].sort_index().dropna()
    s.index = s.index.tz_localize(tz, nonexistent="shift_forward", ambiguous="NaT") if s.index.tz is None else s.index.tz_convert(tz)
    s = s[s.index.notna()]
    step = s.index.to_series().diff().median()
    hours = max(step.total_seconds() / 3600.0, 1e-6)
    name = use_col.lower()
    energy = name in ("kwh", "wh", "t_kwh", "energy") or "kwh" in name
    kw = s / hours if energy else s
    if name == "wh" or name.endswith("(wh)") or (not energy and name.endswith("(w)")):
        kw = kw / 1000.0
    out = kw.resample("15min").mean()
    day_slot = out.groupby([out.index.hour, out.index.minute])
    typical = day_slot.transform("median")
    gap = out.isna()
    run = gap.ne(gap.shift()).cumsum()
    run_len = gap.groupby(run).transform("sum")
    fill = gap & (run_len <= 8)
    out = out.where(~fill, typical)
    out = out[~out.isna()]
    full = pd.date_range(out.index[0].floor("D"), out.index[-1].ceil("D") - pd.Timedelta(minutes=15), freq="15min", tz=out.index.tz)
    out = out.reindex(full)
    typ = out.groupby([out.index.hour, out.index.minute]).transform("median")
    return out.fillna(typ).fillna(float(out.mean())).astype(float).clip(lower=0.0)
