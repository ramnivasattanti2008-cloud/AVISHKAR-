"""Probabilistic forecasts: P10/P50/P90 bands for generation and load at 15-minute resolution.

Each band is a gradient-boosted quantile model. The P10 and P90 are then conformally calibrated on
a held-out slice of the most recent training days, so the 80% band really covers about 80% of
outcomes. Trustworthy bands matter because P2P commitments are sized on the P10 value.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from avishkar_ems.sim import STEPS_PER_DAY

QUANTILES = (0.1, 0.5, 0.9)


def _time_features(index: pd.DatetimeIndex) -> pd.DataFrame:
    hour = np.asarray(index.hour + index.minute / 60.0, dtype=float)
    doy = np.asarray(index.dayofyear, dtype=float)
    return pd.DataFrame(
        {
            "hour_sin": np.sin(2 * np.pi * hour / 24), "hour_cos": np.cos(2 * np.pi * hour / 24),
            "doy_sin": np.sin(2 * np.pi * doy / 365), "doy_cos": np.cos(2 * np.pi * doy / 365),
        },
        index=index,
    )


def pv_features(df: pd.DataFrame) -> pd.DataFrame:
    """Features known the evening before: physics baseline, archived weather forecast, calendar."""
    x = _time_features(df.index)
    x["pv_clear_kw"] = df["pv_clear_kw"].to_numpy()
    x["kt_fcst"] = df["kt_fcst"].to_numpy()
    x["temp_fcst"] = df["temp_fcst"].to_numpy()
    x["pv_phys_fcst"] = x["pv_clear_kw"] * x["kt_fcst"]
    return x


def load_features(df: pd.DataFrame) -> pd.DataFrame:
    """Calendar, temperature forecast and load lags that are fully known at planning time."""
    x = _time_features(df.index)
    x["dow"] = np.asarray(df.index.dayofweek, dtype=float)
    x["is_weekend"] = (x["dow"] >= 5).astype(float)
    x["temp_fcst"] = df["temp_fcst"].to_numpy()
    load = df["load_kw"]
    x["lag_2d"] = load.shift(2 * STEPS_PER_DAY).to_numpy()
    x["lag_7d"] = load.shift(7 * STEPS_PER_DAY).to_numpy()
    x["mean_slot_7d"] = pd.concat(
        [load.shift(k * STEPS_PER_DAY) for k in range(2, 9)], axis=1
    ).mean(axis=1).to_numpy()
    return x


class QuantileBands:
    """P10/P50/P90 predictor with conformal calibration of the outer quantiles.

    For generation pass `scale` (the clear-sky output). The model then learns the clearness ratio
    (output / clear-sky output) on daytime rows only and multiplies back, which keeps the quantiles
    well behaved. Without it, the half of the rows that are night-time zeros drag low quantiles to 0.
    """

    def __init__(self, max_iter: int = 200, calib_days: int = 45, random_state: int = 0):
        self.max_iter = max_iter
        self.calib_steps = calib_days * STEPS_PER_DAY
        self.random_state = random_state
        self.models: dict[float, HistGradientBoostingRegressor] = {}
        self.shift_lo = 0.0
        self.shift_hi = 0.0
        self.columns: list[str] = []
        self.use_scale = False
        self.scale_floor = 0.0

    def _new_model(self, q: float) -> HistGradientBoostingRegressor:
        return HistGradientBoostingRegressor(
            loss="quantile", quantile=q, max_iter=self.max_iter, learning_rate=0.1,
            max_leaf_nodes=15, min_samples_leaf=40, random_state=self.random_state,
        )

    def _raw(self, x: pd.DataFrame) -> pd.DataFrame:
        out = {f"p{int(q * 100)}": self.models[q].predict(x[self.columns]) for q in QUANTILES}
        return pd.DataFrame(out, index=x.index)

    def fit(self, x: pd.DataFrame, y: pd.Series, scale: pd.Series | None = None) -> QuantileBands:
        self.use_scale = scale is not None
        ok = x.notna().all(axis=1) & y.notna()
        if self.use_scale:
            self.scale_floor = 0.02 * float(scale.max())
            ok &= scale > self.scale_floor
            y = y / scale.where(scale > self.scale_floor)  # clearness ratio
        x, y = x[ok], y[ok]
        self.columns = list(x.columns)
        split = max(len(x) - self.calib_steps, int(0.6 * len(x)))
        x_tr, y_tr, x_cal, y_cal = x.iloc[:split], y.iloc[:split], x.iloc[split:], y.iloc[split:]
        for q in QUANTILES:
            self.models[q] = self._new_model(q).fit(x_tr, y_tr)
        raw = self._raw(x_cal)
        # Conformalised quantile regression: shift each tail so it hits its nominal level.
        self.shift_lo = float(np.quantile(raw["p10"] - y_cal.to_numpy(), 0.9))
        self.shift_hi = float(np.quantile(y_cal.to_numpy() - raw["p90"], 0.9))
        # Refit on all data so the final models also see the calibration days.
        for q in QUANTILES:
            self.models[q] = self._new_model(q).fit(x, y)
        return self

    def predict(self, x: pd.DataFrame, scale: pd.Series | None = None) -> pd.DataFrame:
        raw = self._raw(x)
        out = pd.DataFrame(index=x.index)
        out["p10"] = raw["p10"] - self.shift_lo
        out["p50"] = raw["p50"]
        out["p90"] = raw["p90"] + self.shift_hi
        arr = np.sort(out[["p10", "p50", "p90"]].to_numpy(), axis=1)
        arr = np.clip(arr, 0.0, None)
        if self.use_scale:
            sc = np.asarray(scale, dtype=float)
            arr = arr * sc[:, None]
            arr[sc <= self.scale_floor, :] = 0.0
        return pd.DataFrame(arr, index=x.index, columns=["p10", "p50", "p90"])


def pinball_loss(y: np.ndarray, pred: np.ndarray, q: float) -> float:
    d = np.asarray(y) - np.asarray(pred)
    return float(np.mean(np.maximum(q * d, (q - 1) * d)))


def coverage(y: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> float:
    y = np.asarray(y)
    return float(np.mean((y >= np.asarray(lo)) & (y <= np.asarray(hi))))
