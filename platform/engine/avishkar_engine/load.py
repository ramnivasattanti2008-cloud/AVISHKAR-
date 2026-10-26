"""Load forecast engine (spec sections 14 and 15): expected load, an 80% band, and the chance of a peak, from the property's own
meter history alone.

Every feature has a lag of at least a week (168 hours), so the same forecast is valid at any horizon up to seven days: nothing
it uses is newer than a week before the hour being forecast. The price of that is that it does not react to the last few days.

Methods compared on a chronological holdout the model never saw:
  last_week            the value at the same hour a week earlier
  same_hour_of_week    the mean of the same hour of the week over up to the last eight weeks (the spec's baseline)
  same_hour_recent     the mean of the same hour of the day over days 7 to 13 earlier
  gbm_quantile         gradient-boosted quantile models on calendar and lagged features, conformally calibrated

The best on the holdout is used, and a model only displaces a baseline if it beats it by at least 2%. Bands are the 10th and
90th percentile of that method's own holdout errors (conformalised for the model), so they are measured, not assumed.
Gaps in the history stay gaps: they are never filled.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from avishkar_engine.forecast_schemas import LoadForecastRequest, LoadForecastResponse, MethodScore

QUANTILES = (0.1, 0.5, 0.9)
MIN_SPAN_DAYS = 14
MIN_VALID_SHARE = 0.6
MIN_GBM_DAYS = 42  # four weeks of lags plus enough rows to train, calibrate and test
MIN_TEST_DAYS = 7
MAX_TEST_DAYS = 14
GBM_MARGIN = 0.98  # the model must beat the best baseline's error by 2% to be chosen
LAGS_WEEK = tuple(168 * k for k in range(1, 9))
LAGS_RECENT = tuple(24 * j for j in range(7, 14))


def hourly_kw(h, offset_min: int = 330) -> pd.Series:
    """The history as hourly average power (kW) on a gapless hourly grid aligned to LOCAL hours (UTC+5:30 puts them at :30 past each
    UTC hour); hours without enough readings are NaN, never filled. Hourly input is taken as already aligned to local hours."""
    per_hour = 60 // h.interval_minutes
    idx = pd.date_range(pd.Timestamp(h.start_time).tz_convert("UTC"), periods=len(h.kwh), freq=f"{h.interval_minutes}min")
    kwh = pd.Series([np.nan if v is None else v for v in h.kwh], index=idx, dtype=float)
    kw = kwh * 60.0 / h.interval_minutes
    if per_hour == 1:
        out = kw
    else:
        anchor = (-offset_min) % 60
        g = kw.resample("1h", offset=pd.Timedelta(minutes=anchor))
        out = g.mean().where(g.count() >= int(np.ceil(per_hour * 0.5)))
    full = pd.date_range(out.index[0], out.index[-1], freq="1h")
    return out.reindex(full)


def _align(ts: pd.Timestamp, anchor_minute: int) -> pd.Timestamp:
    """Round a time down to the hourly grid whose hours start at `anchor_minute` past the UTC hour."""
    t = ts.floor("min")
    return t - pd.Timedelta(minutes=(t.minute - anchor_minute) % 60)


def _features(s: pd.Series, index: pd.DatetimeIndex, offset_min: int, use_season: bool) -> pd.DataFrame:
    """Calendar and lagged features for the hours in `index`, from `s`, every lag at least a week."""
    local = index + pd.Timedelta(minutes=offset_min)
    hour = np.asarray(local.hour, dtype=float)
    x = pd.DataFrame(
        {"hour_sin": np.sin(2 * np.pi * hour / 24), "hour_cos": np.cos(2 * np.pi * hour / 24),
         "dow": np.asarray(local.dayofweek, dtype=float), "is_weekend": (np.asarray(local.dayofweek) >= 5).astype(float)},
        index=index,
    )
    if use_season:
        doy = np.asarray(local.dayofyear, dtype=float)
        x["doy_sin"], x["doy_cos"] = np.sin(2 * np.pi * doy / 365), np.cos(2 * np.pi * doy / 365)
    ext = s.reindex(s.index.union(index)).sort_index()  # NaN where there is no data, which is what a lag past the end must be

    def lag(h: int) -> np.ndarray:
        return ext.reindex(index - pd.Timedelta(hours=h)).to_numpy(dtype=float)

    week = np.vstack([lag(h) for h in LAGS_WEEK])
    recent = np.vstack([lag(h) for h in LAGS_RECENT])
    x["lag_168"], x["lag_336"] = week[0], week[1]
    x["mean_how"] = _nanmean(week)
    x["mean_recent"] = _nanmean(recent)
    return x


def _nanmean(m: np.ndarray, min_count: int = 2) -> np.ndarray:
    n = np.sum(~np.isnan(m), axis=0)
    with np.errstate(all="ignore"):
        s = np.nansum(m, axis=0) / np.maximum(n, 1)
    return np.where(n >= min_count, s, np.nan)


@dataclass
class _Scored:
    name: str
    description: str
    point: np.ndarray  # on the test hours
    mae: float
    rmse: float
    wape: float | None
    bias: float
    coverage: float | None
    resid: np.ndarray  # calibration and test residuals (actual - prediction), for bands and peak probability
    lo_off: float
    hi_off: float
    model: object = None
    margin: float = 0.0


def _fit_gbm(x: pd.DataFrame, y: pd.Series, q: float) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss="quantile", quantile=q, max_iter=200, learning_rate=0.1, max_leaf_nodes=15,
        min_samples_leaf=40 if len(y) >= 1500 else 20, random_state=0,
    ).fit(x, y)


def _unavailable(reason: str, hist_days: float, gaps: float) -> LoadForecastResponse:
    return LoadForecastResponse(
        status="unavailable", unavailable_reason=reason, times=[], p10_kw=[], p50_kw=[], p90_kw=[], kwh_p50=None, peak_threshold_kw=None,
        peak_probability=[], selected_method=None, methods=[], holdout_days=0, history_days=round(hist_days, 2), gaps_share=round(gaps, 4),
        assumptions=[], notes=[],
    )


def forecast(req: LoadForecastRequest) -> LoadForecastResponse:
    s_all = hourly_kw(req.history, req.timezone_offset_minutes)
    gaps = float(s_all.isna().mean())
    span_days = len(s_all) / 24.0
    anchor = s_all.index[0].minute
    fs = _align(pd.Timestamp(req.forecast_start).tz_convert("UTC"), anchor) if req.forecast_start else s_all.index[-1] + pd.Timedelta(hours=1)
    s = s_all[s_all.index < fs]
    if len(s) == 0:
        return _unavailable("The forecast starts before the first reading.", span_days, gaps)
    span_days = len(s) / 24.0
    valid = s.dropna()
    if span_days < MIN_SPAN_DAYS or len(valid) / len(s) < MIN_VALID_SHARE:
        return _unavailable(
            f"A load forecast needs at least {MIN_SPAN_DAYS} days of readings with at least {int(MIN_VALID_SHARE * 100)}% of the hours present; "
            f"these cover {span_days:.1f} days with {len(valid) / len(s) * 100:.0f}% present.", span_days, gaps,
        )
    off = req.timezone_offset_minutes
    horizon = pd.date_range(fs, periods=req.horizon_hours, freq="1h")
    use_season = span_days >= 300
    notes: list[str] = []

    # chronological split of the hours that have a target and at least one week of lags behind them
    x_all = _features(s, s.index, off, use_season)
    usable = s.notna() & (x_all["lag_168"].notna() | x_all["mean_how"].notna())
    rows = s.index[usable.to_numpy()]
    if len(rows) < 7 * 24:
        return _unavailable("Fewer than a week of hours have both a reading and a week of history behind them.", span_days, gaps)
    test_days = int(np.clip(len(rows) // 24 // 4, MIN_TEST_DAYS, MAX_TEST_DAYS))
    n_test, n_calib = test_days * 24, test_days * 24
    if len(rows) < n_test + n_calib + 7 * 24:
        n_test = n_calib = max(24, (len(rows) // 3 // 24) * 24)
    train_idx, calib_idx, test_idx = rows[: -(n_calib + n_test)], rows[-(n_calib + n_test) : -n_test], rows[-n_test:]
    y = s

    def scored(name: str, desc: str, pred_calib: np.ndarray, pred_test: np.ndarray, **kw) -> _Scored:
        e_c = y.loc[calib_idx].to_numpy() - pred_calib
        e_t = y.loc[test_idx].to_numpy() - pred_test
        ok_c, ok_t = ~np.isnan(e_c), ~np.isnan(e_t)
        if kw.get("lo_off") is None:
            lo, hi = float(np.quantile(e_c[ok_c], 0.1)), float(np.quantile(e_c[ok_c], 0.9))
        else:
            lo, hi = kw["lo_off"], kw["hi_off"]
        actual_t = y.loc[test_idx].to_numpy()[ok_t]
        pt = pred_test[ok_t]
        low, high = np.clip(pt + lo, 0, None), pt + hi
        total = float(np.abs(actual_t).sum())
        return _Scored(
            name=name, description=desc, point=pred_test, mae=float(np.mean(np.abs(e_t[ok_t]))), rmse=float(np.sqrt(np.mean(e_t[ok_t] ** 2))),
            wape=float(np.abs(e_t[ok_t]).sum() / total * 100) if total > 0 else None, bias=float(np.mean(pt - actual_t)),
            coverage=float(np.mean((actual_t >= low) & (actual_t <= high))), resid=np.concatenate([e_c[ok_c], e_t[ok_t]]), lo_off=lo, hi_off=hi,
            model=kw.get("model"), margin=kw.get("margin", 0.0),
        )

    results: list[_Scored] = []
    for name, desc, col in (
        ("last_week", "The value at the same hour a week earlier", "lag_168"),
        ("same_hour_of_week", "Mean of the same hour of the week over up to the last 8 weeks", "mean_how"),
        ("same_hour_recent", "Mean of the same hour of the day over days 7 to 13 earlier", "mean_recent"),
    ):
        # a baseline that has no value for an hour falls back to the next simplest, so every method is scored on the same hours
        fall = x_all["mean_how"].fillna(x_all["mean_recent"]).fillna(x_all["lag_168"])
        pc = x_all[col].fillna(fall).loc[calib_idx].to_numpy()
        pt = x_all[col].fillna(fall).loc[test_idx].to_numpy()
        results.append(scored(name, desc, pc, pt))

    gbm_note: str | None = None
    if span_days >= MIN_GBM_DAYS:
        feats = list(x_all.columns)
        tr = train_idx[y.loc[train_idx].notna().to_numpy()]
        models = {q: _fit_gbm(x_all.loc[tr, feats], y.loc[tr], q) for q in QUANTILES}
        pc = {q: models[q].predict(x_all.loc[calib_idx, feats]) for q in QUANTILES}
        pt = {q: models[q].predict(x_all.loc[test_idx, feats]) for q in QUANTILES}
        yc = y.loc[calib_idx].to_numpy()
        ok = ~np.isnan(yc)
        # conformalised quantile regression: widen the model's own 10-90 band by what it missed on the calibration hours
        score = np.maximum(pc[0.1][ok] - yc[ok], yc[ok] - pc[0.9][ok])
        n = int(ok.sum())
        margin = float(np.quantile(score, min(1.0, 0.8 * (1 + 1.0 / n)))) if n else 0.0
        r = scored("gbm_quantile", "Gradient-boosted quantile models on calendar and lagged features, conformally calibrated", pc[0.5], pt[0.5], lo_off=None, model=models)
        e_t = y.loc[test_idx].to_numpy() - pt[0.5]
        okt = ~np.isnan(e_t)
        actual_t = y.loc[test_idx].to_numpy()[okt]
        cov = float(np.mean((actual_t >= np.clip(pt[0.1][okt] - margin, 0, None)) & (actual_t <= pt[0.9][okt] + margin)))
        r.coverage, r.margin = cov, margin
        results.append(r)
    else:
        gbm_note = f"The model needs at least {MIN_GBM_DAYS} days of history; these cover {span_days:.0f}, so only baselines were compared."

    baselines = [r for r in results if r.name != "gbm_quantile"]
    best_base = min(baselines, key=lambda r: r.mae)
    gbm = next((r for r in results if r.name == "gbm_quantile"), None)
    chosen = gbm if gbm is not None and gbm.mae <= GBM_MARGIN * best_base.mae else best_base
    if gbm is not None and chosen is best_base:
        notes.append(f"The model (MAE {gbm.mae:.3f} kW) did not beat the best baseline, {best_base.name} (MAE {best_base.mae:.3f} kW), by 2%, so the simpler baseline is used.")
    if gbm_note:
        notes.append(gbm_note)

    # ---- the forecast itself, refitting the model on every hour available
    fx = _features(s, horizon, off, use_season)
    if chosen.name == "gbm_quantile":
        feats = list(x_all.columns)
        everything = rows[y.loc[rows].notna().to_numpy()]
        final = {q: _fit_gbm(x_all.loc[everything, feats], y.loc[everything], q) for q in QUANTILES}
        q10, q50, q90 = (final[q].predict(fx[feats]) for q in QUANTILES)
        p50 = np.clip(q50, 0, None)
        p10 = np.clip(np.minimum(q10 - chosen.margin, p50), 0, None)
        p90 = np.maximum(q90 + chosen.margin, p50)
    else:
        col = {"last_week": "lag_168", "same_hour_of_week": "mean_how", "same_hour_recent": "mean_recent"}[chosen.name]
        fall = fx["mean_how"].fillna(fx["mean_recent"]).fillna(fx["lag_168"])
        point = fx[col].fillna(fall)
        if point.isna().any():
            point = point.fillna(float(valid.mean()))
            notes.append("Some hours had no history a week or more earlier; the overall mean was used for them.")
        p50 = np.clip(point.to_numpy(dtype=float), 0, None)
        p10 = np.clip(np.minimum(p50 + chosen.lo_off, p50), 0, None)
        p90 = np.maximum(p50 + chosen.hi_off, p50)

    threshold = float(np.quantile(valid.to_numpy(), 0.95))
    resid = chosen.resid
    if len(resid) >= 50:
        prob = np.array([float(np.mean(p + resid > threshold)) for p in p50])
    else:
        prob = np.zeros(len(p50))
        notes.append("Too few holdout hours to estimate the chance of a peak.")

    def score(r: _Scored) -> MethodScore:
        return MethodScore(method=r.name, description=r.description, mae_kw=round(r.mae, 5), rmse_kw=round(r.rmse, 5), wape_pct=None if r.wape is None else round(r.wape, 3),
                           bias_kw=round(r.bias, 5), coverage_80=None if r.coverage is None else round(r.coverage, 4))

    return LoadForecastResponse(
        status="ok",
        unavailable_reason=None,
        times=[t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in horizon],
        p10_kw=[round(float(v), 5) for v in p10],
        p50_kw=[round(float(v), 5) for v in p50],
        p90_kw=[round(float(v), 5) for v in p90],
        kwh_p50=round(float(p50.sum()), 4),
        peak_threshold_kw=round(threshold, 5),
        peak_probability=[round(float(v), 4) for v in prob],
        selected_method=chosen.name,
        methods=[score(r) for r in sorted(results, key=lambda r: r.mae)],
        holdout_days=len(test_idx) // 24,
        history_days=round(span_days, 2),
        gaps_share=round(gaps, 4),
        assumptions=[
            "Every feature is at least a week old, so the forecast is equally valid at any horizon up to 7 days and does not react to the last few days.",
            "Hours are local (the stated UTC offset); no daylight saving is modelled.",
            "Gaps in the history are left as gaps. An hour needs at least half of its readings to count.",
            f"The band is the 10th to 90th percentile of the chosen method's errors on a {len(test_idx) // 24}-day holdout (conformalised for the model): about 80% of hours should fall inside it.",
            "Peak probability is the share of holdout errors that would push the forecast above the property's own 95th-percentile hourly power.",
            *( ["Seasonality is learned only because the history covers most of a year."] if use_season else ["Seasonality is not modelled: the history is shorter than about ten months."] ),
        ],
        notes=notes,
    )
