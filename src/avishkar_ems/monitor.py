"""Live monitoring: actual generation versus the modelled baseline, with deviation flags."""

from __future__ import annotations

import numpy as np
import pandas as pd


def deviation_flags(
    df: pd.DataFrame,
    ratio_threshold: float = 0.85,
    min_poa: float = 200.0,
    min_steps: int = 4,
) -> pd.DataFrame:
    """Flag stretches where actual output sits well below the modelled baseline.

    Only steps with real sunshine (poa_wm2 >= min_poa) are judged, since night and deep cloud make
    the ratio meaningless. A flag needs min_steps consecutive low steps (default one hour) so a
    passing cloud edge does not raise an alarm.
    """
    judged = df["poa_wm2"] >= min_poa
    ratio = pd.Series(np.nan, index=df.index)
    ratio[judged] = df.loc[judged, "pv_kw"] / df.loc[judged, "expected_kw"].clip(lower=1e-6)
    low = (ratio < ratio_threshold).fillna(False)
    run = low.astype(int).groupby((~low).cumsum()).cumsum()  # length of the current low run
    flag = run >= min_steps
    # Once a run reaches min_steps, mark the whole run, including its first steps.
    run_id = (~low).cumsum()
    flag = flag.groupby(run_id).transform("any") & low
    return pd.DataFrame({"ratio": ratio, "deviation_pct": (1 - ratio) * 100, "flag": flag})


def daily_summary(df: pd.DataFrame, flags: pd.DataFrame) -> pd.DataFrame:
    """Per-day actual vs expected energy and the number of flagged steps."""
    g = df.index.normalize()
    out = pd.DataFrame({
        "actual_kwh": df["pv_kw"].groupby(g).sum() * 0.25,
        "expected_kwh": df["expected_kw"].groupby(g).sum() * 0.25,
        "flagged_steps": flags["flag"].groupby(g).sum(),
    })
    out["shortfall_pct"] = (1 - out["actual_kwh"] / out["expected_kwh"].clip(lower=1e-6)) * 100
    return out
