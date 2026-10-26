"""Live monitoring: actual generation versus the modelled baseline, with deviation flags."""

from __future__ import annotations

from enum import Enum

import numpy as np
import pandas as pd


class DEVIATION_MODES(Enum):
    UNDERPERFORMANCE = "underperformance"
    SENSOR_STUCK = "sensor_stuck"
    INVERTER_OFF = "inverter_off"
    DEGRADATION = "degradation"


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


def detect_sensor_stuck(df: pd.DataFrame, min_poa: float = 200.0, min_steps: int = 16) -> pd.Series:
    """Flag steps where pv_kw is completely constant despite varying irradiance."""
    judged = df["poa_wm2"] >= min_poa
    pv_diff = df["pv_kw"].diff().abs() < 1e-3
    stuck_run = (pv_diff & judged).astype(int).groupby((~(pv_diff & judged)).cumsum()).cumsum()
    flag = stuck_run >= min_steps
    run_id = (~(pv_diff & judged)).cumsum()
    return flag.groupby(run_id).transform("any") & pv_diff & judged


def detect_inverter_off(df: pd.DataFrame, min_poa: float = 200.0, min_steps: int = 4) -> pd.Series:
    """Flag steps where irradiance is high but PV generation is exactly zero."""
    off = (df["poa_wm2"] >= min_poa) & (df["pv_kw"] <= 1e-3)
    run = off.astype(int).groupby((~off).cumsum()).cumsum()
    flag = run >= min_steps
    run_id = (~off).cumsum()
    return flag.groupby(run_id).transform("any") & off


def enhanced_monitor(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate all deviation flags into a diagnostic DataFrame."""
    base = deviation_flags(df)
    stuck = detect_sensor_stuck(df)
    off = detect_inverter_off(df)

    # Determine primary fault mode per row
    mode = pd.Series("NORMAL", index=df.index)
    mode[base["flag"]] = DEVIATION_MODES.UNDERPERFORMANCE.value
    mode[stuck] = DEVIATION_MODES.SENSOR_STUCK.value
    mode[off] = DEVIATION_MODES.INVERTER_OFF.value

    res = base.copy()
    res["sensor_stuck"] = stuck
    res["inverter_off"] = off
    res["fault_mode"] = mode
    return res


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
