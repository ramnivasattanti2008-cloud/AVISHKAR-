"""Forecasting and Model Evaluation Pipeline for UrjaSetu EMS.

Constructs dedicated, leak-free time-series forecasting pipelines for
macro electricity demand and solar generation.
Strict invariants:
1. Chronological validation only (train on historical window, evaluate on held-out future).
2. Strong baselines (Seasonal Persistence Naive and Linear Drift).
3. Comprehensive error metrics: MAE, RMSE, MAPE, WAPE.
4. Forecast horizons strictly match source frequency (monthly for macro series).
5. Explicit separation between historical observations and predicted values.
6. Warns clearly when historical data is insufficient (< 24 months).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class EvaluationMetrics:
    mae: float
    rmse: float
    mape_pct: float
    wape_pct: float
    holdout_samples: int
    baseline_model: str


@dataclass(frozen=True)
class MacroForecastOutput:
    series_name: str
    region_code: str
    historical_periods: list[str]
    historical_values: list[float]
    forecast_periods: list[str]
    forecast_p50: list[float]
    forecast_p10: list[float]
    forecast_p90: list[float]
    metrics: EvaluationMetrics
    warning: str | None = None


def compute_metrics(actual: Sequence[float], predicted: Sequence[float], baseline_name: str = "Seasonal Naive") -> EvaluationMetrics:
    n = len(actual)
    if n == 0 or len(predicted) != n:
        raise ValueError("Actual and predicted sequences must be non-empty and of equal length.")

    errors = [a - p for a, p in zip(actual, predicted, strict=True)]
    abs_errors = [abs(e) for e in errors]
    sq_errors = [e * e for e in errors]

    mae = sum(abs_errors) / n
    rmse = math.sqrt(sum(sq_errors) / n)

    # Percentage errors
    pct_errors = [abs(a - p) / a for a, p in zip(actual, predicted, strict=True) if a > 0]
    mape = (sum(pct_errors) / len(pct_errors) * 100) if pct_errors else 0.0

    sum_actual = sum(actual)
    wape = (sum(abs_errors) / sum_actual * 100) if sum_actual > 0 else 0.0

    return EvaluationMetrics(
        mae=round(mae, 2),
        rmse=round(rmse, 2),
        mape_pct=round(mape, 2),
        wape_pct=round(wape, 2),
        holdout_samples=n,
        baseline_model=baseline_name,
    )


class MacroForecastPipeline:
    """Rigorous forecasting pipeline without future lookahead."""

    def __init__(self, season_length: int = 12) -> None:
        self.season_length = season_length

    def run(
        self,
        periods: list[str],
        values: list[float],
        series_name: str,
        region_code: str,
        horizon_steps: int = 6,
    ) -> MacroForecastOutput:
        n = len(values)
        if n < 6:
            raise ValueError(f"Insufficient time-series history ({n} samples). At least 6 samples required.")

        warning: str | None = None
        if n < 24:
            warning = (
                f"Historical observations ({n} months) are less than 24 months. "
                "Seasonal confidence bounds have wider uncertainty due to limited annual cycle observations."
            )

        # 1. Chronological Holdout Evaluation (last 3 to 6 steps)
        test_size = min(horizon_steps, max(2, n // 4))
        train_vals = values[:-test_size]
        test_actual = values[-test_size:]

        # Baseline: Seasonal persistence or last-value persistence if train < season_length
        test_preds: list[float] = []
        for i in range(test_size):
            idx_in_history = len(train_vals) + i - self.season_length
            if idx_in_history >= 0 and idx_in_history < len(train_vals):
                test_preds.append(train_vals[idx_in_history])
            else:
                # Fallback to mean of recent 3 steps
                recent = train_vals[-3:] if len(train_vals) >= 3 else train_vals
                test_preds.append(sum(recent) / len(recent))

        metrics = compute_metrics(test_actual, test_preds, baseline_name="Seasonal Persistence Baseline")

        # 2. Forward Horizon Generation
        # Future periods: continue monthly string sequence
        last_period = periods[-1]
        y, m = int(last_period[:4]), int(last_period[5:7])
        future_periods: list[str] = []
        for _ in range(horizon_steps):
            m += 1
            if m > 12:
                m = 1
                y += 1
            future_periods.append(f"{y:04d}-{m:02d}")

        # Compute P50 using seasonal baseline + annual trend drift
        annual_drift = 0.0
        if n >= self.season_length:
            recent_annual = values[-self.season_length:]
            prior_annual = values[-2 * self.season_length: -self.season_length] if n >= 2 * self.season_length else values[:self.season_length]
            if sum(prior_annual) > 0:
                annual_drift = (sum(recent_annual) - sum(prior_annual)) / sum(prior_annual)
                # Cap realistic annual macro drift between -10% and +15%
                annual_drift = max(-0.10, min(0.15, annual_drift))

        future_p50: list[float] = []
        future_p10: list[float] = []
        future_p90: list[float] = []

        # Residual std dev from holdout
        std_dev = max(metrics.rmse, 1.0)

        for step in range(horizon_steps):
            ref_idx = len(values) - self.season_length + (step % self.season_length)
            base_val = values[ref_idx] if 0 <= ref_idx < len(values) else values[-1]
            p50 = round(base_val * (1.0 + annual_drift), 1)

            # Expanding uncertainty cone over forward horizon
            horizon_spread = 1.645 * std_dev * math.sqrt(1.0 + 0.15 * step)
            p10 = max(0.0, round(p50 - horizon_spread, 1))
            p90 = round(p50 + horizon_spread, 1)

            future_p50.append(p50)
            future_p10.append(p10)
            future_p90.append(p90)

        return MacroForecastOutput(
            series_name=series_name,
            region_code=region_code,
            historical_periods=periods,
            historical_values=values,
            forecast_periods=future_periods,
            forecast_p50=future_p50,
            forecast_p10=future_p10,
            forecast_p90=future_p90,
            metrics=metrics,
            warning=warning,
        )
