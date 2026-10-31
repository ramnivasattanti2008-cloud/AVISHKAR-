"""Temporal Validation, Chronological Splitting, and Data Leakage Prevention for UrjaSetu EMS.

Strict Invariants:
1. Never randomly split time-series observations.
2. Chronological train/test splits ensure future observations are never visible during training.
3. Feature engineering (lagging, rolling windows, scaling) is fit ONLY on the training split.
4. Future values are strictly prohibited from entering lag features or rolling statistics.
5. Evaluates model performance using MAE, RMSE, WAPE, MASE, and Bias with zero-denominator safeguards.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class ForecastEvaluationMetrics:
    mae: float
    rmse: float
    wape_pct: float
    mase: float | None
    bias: float
    evaluated_samples_count: int
    baseline_model_name: str
    relative_improvement_pct: float | None = None
    notes: str = ""


@dataclass(frozen=True)
class ChronologicalSplit:
    train_periods: list[str]
    train_values: list[float]
    test_periods: list[str]
    test_values: list[float]


class TemporalValidationEngine:
    """Manages leak-free train/test splits, walk-forward cross-validation, and metrics."""

    @staticmethod
    def chronological_split(
        periods: list[str],
        values: list[float],
        test_size: int,
    ) -> ChronologicalSplit:
        """Splits time series chronologically without shuffling or future lookahead."""
        n = len(values)
        if test_size <= 0:
            raise ValueError(f"test_size must be positive, got {test_size}")
        if test_size >= n:
            raise ValueError(f"test_size ({test_size}) must be strictly less than total series length ({n})")

        train_size = n - test_size
        return ChronologicalSplit(
            train_periods=periods[:train_size],
            train_values=values[:train_size],
            test_periods=periods[train_size:],
            test_values=values[train_size:],
        )

    @staticmethod
    def walk_forward_splits(
        periods: list[str],
        values: list[float],
        min_train_size: int,
        horizon: int = 1,
        step: int = 1,
    ) -> list[ChronologicalSplit]:
        """Generates expanding-window walk-forward cross-validation splits."""
        n = len(values)
        splits: list[ChronologicalSplit] = []
        for end_train in range(min_train_size, n - horizon + 1, step):
            splits.append(
                ChronologicalSplit(
                    train_periods=periods[:end_train],
                    train_values=values[:end_train],
                    test_periods=periods[end_train : end_train + horizon],
                    test_values=values[end_train : end_train + horizon],
                )
            )
        return splits

    @staticmethod
    def assert_no_temporal_leakage(
        train_periods: list[str],
        test_periods: list[str],
        feature_matrix: list[list[float]] | None = None,
    ) -> None:
        """Asserts that test timestamps strictly succeed training timestamps and no overlap exists."""
        if not train_periods or not test_periods:
            raise ValueError("Training and testing periods must not be empty.")

        max_train = max(train_periods)
        min_test = min(test_periods)

        if max_train >= min_test:
            raise ValueError(
                f"TEMPORAL LEAKAGE DETECTED: Latest training period '{max_train}' is not strictly before "
                f"earliest testing period '{min_test}'. Shuffling or future lookahead detected."
            )

        train_set = set(train_periods)
        test_set = set(test_periods)
        intersection = train_set.intersection(test_set)
        if intersection:
            raise ValueError(
                f"TEMPORAL LEAKAGE DETECTED: Periods {intersection} appear in both training and test sets."
            )

    @classmethod
    def compute_evaluation_metrics(
        cls,
        actual: Sequence[float],
        predicted: Sequence[float],
        baseline_actual: Sequence[float] | None = None,
        baseline_predicted: Sequence[float] | None = None,
        season_length: int = 12,
        baseline_name: str = "Seasonal Naive Baseline",
    ) -> ForecastEvaluationMetrics:
        """Computes comprehensive error metrics: MAE, RMSE, WAPE, MASE, and Bias."""
        n = len(actual)
        if n == 0 or len(predicted) != n:
            raise ValueError(
                f"Actual and predicted sequences must be non-empty and of equal length (got {n} vs {len(predicted)})."
            )

        errors = [p - a for a, p in zip(actual, predicted, strict=True)]  # Predicted - Actual
        abs_errors = [abs(e) for e in errors]
        sq_errors = [e * e for e in errors]

        mae = sum(abs_errors) / n
        rmse = math.sqrt(sum(sq_errors) / n)
        bias = sum(errors) / n  # Mean error: positive means over-forecasting, negative means under-forecasting

        sum_actual = sum(actual)
        wape = (sum(abs_errors) / sum_actual * 100.0) if sum_actual > 0 else 0.0

        # Mean Absolute Scaled Error (MASE)
        # Scaled against in-sample seasonal naive errors if available
        mase: float | None = None
        if baseline_actual and len(baseline_actual) > season_length:
            # Baseline scale is mean absolute error of seasonal naive on training history
            scale_errors = [
                abs(baseline_actual[i] - baseline_actual[i - season_length])
                for i in range(season_length, len(baseline_actual))
            ]
            scale = sum(scale_errors) / len(scale_errors) if scale_errors else 0.0
            if scale > 0:
                mase = round(mae / scale, 3)

        # Baseline comparison
        rel_improvement: float | None = None
        if baseline_predicted and len(baseline_predicted) == n:
            baseline_abs_err = [abs(a - bp) for a, bp in zip(actual, baseline_predicted, strict=True)]
            base_mae = sum(baseline_abs_err) / n
            if base_mae > 0:
                rel_improvement = round(((base_mae - mae) / base_mae) * 100.0, 2)

        notes = f"Chronological holdout evaluation across {n} sample(s)."
        if rel_improvement is not None:
            if rel_improvement > 0:
                notes += f" Model outperformed {baseline_name} by {rel_improvement:.1f}% lower MAE."
            else:
                notes += f" Model degraded by {abs(rel_improvement):.1f}% compared to {baseline_name}."

        return ForecastEvaluationMetrics(
            mae=round(mae, 2),
            rmse=round(rmse, 2),
            wape_pct=round(wape, 2),
            mase=mase,
            bias=round(bias, 2),
            evaluated_samples_count=n,
            baseline_model_name=baseline_name,
            relative_improvement_pct=rel_improvement,
            notes=notes,
        )

    @staticmethod
    def construct_lag_features(
        series_values: list[float],
        lags: list[int],
        include_rolling_mean: bool = True,
        rolling_window: int = 3,
    ) -> tuple[list[list[float]], list[float]]:
        """Constructs strictly backward-looking lag feature matrix X and target y.

        Invariant: For sample t, features ONLY depend on indices < t. Future values never leak.
        """
        max_lag = max(lags)
        if include_rolling_mean:
            max_lag = max(max_lag, rolling_window)

        n = len(series_values)
        if n <= max_lag:
            raise ValueError(f"Series length ({n}) must be strictly greater than maximum lag ({max_lag})")

        X: list[list[float]] = []
        y: list[float] = []

        for t in range(max_lag, n):
            row: list[float] = []
            # Pure backward lags: t - lag
            for lag in lags:
                row.append(series_values[t - lag])

            # Rolling mean of historical window strictly before t: [t - rolling_window, t)
            if include_rolling_mean:
                window_vals = series_values[t - rolling_window : t]
                row.append(sum(window_vals) / len(window_vals))

            X.append(row)
            y.append(series_values[t])

        return X, y
