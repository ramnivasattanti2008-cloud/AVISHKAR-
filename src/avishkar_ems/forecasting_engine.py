"""Modular Time-Series Forecasting Engine and Model Tournament for UrjaSetu EMS.

Implements transparent baselines and candidate statistical/ML models:
1. Baselines:
   - LastObservationForecaster (Persistence Naive)
   - SeasonalNaiveForecaster (Annual Seasonality Naive, s=12)
   - MovingAverageForecaster (Trailing Window Mean)
   - LinearTrendForecaster (Linear Drift)
2. Candidates:
   - HoltWintersForecaster (Triple Exponential Smoothing with Seasonality)
   - LaggedRidgeForecaster (Regularized Autoregressive Lags & Rolling Features)
3. Model Tournament:
   - Rigorous chronological backtest comparing all models on out-of-sample holdout.
   - Champion selection rule: Candidate model is selected ONLY if it outperforms
     the best baseline on out-of-sample MAE by >= 1%. Otherwise, the baseline is retained.
4. Uncertainty Intervals:
   - Empirical residual quantile bounds (P10, P50, P90) based on validated holdout residuals.
"""

from __future__ import annotations

import abc
import datetime
import math
from dataclasses import dataclass, field

from sklearn.linear_model import Ridge

from avishkar_ems.temporal_validation import (
    ForecastEvaluationMetrics,
    TemporalValidationEngine,
)


class BaseForecaster(abc.ABC):
    """Abstract interface for time-series forecasting models."""

    @property
    @abc.abstractmethod
    def model_name(self) -> str:
        pass

    @property
    @abc.abstractmethod
    def model_version(self) -> str:
        pass

    @property
    @abc.abstractmethod
    def is_baseline(self) -> bool:
        pass

    @abc.abstractmethod
    def fit(self, train_periods: list[str], train_values: list[float]) -> None:
        pass

    @abc.abstractmethod
    def predict(self, horizon_steps: int) -> list[float]:
        pass


# ==============================================================================
# BASELINE MODELS
# ==============================================================================


class LastObservationForecaster(BaseForecaster):
    """Persistence Naive Baseline: forecasts the most recent observed value."""

    def __init__(self) -> None:
        self._last_val: float = 0.0

    @property
    def model_name(self) -> str:
        return "Last Observation Baseline"

    @property
    def model_version(self) -> str:
        return "1.0.0"

    @property
    def is_baseline(self) -> bool:
        return True

    def fit(self, train_periods: list[str], train_values: list[float]) -> None:
        if not train_values:
            raise ValueError("Training values cannot be empty.")
        self._last_val = train_values[-1]

    def predict(self, horizon_steps: int) -> list[float]:
        return [round(self._last_val, 2) for _ in range(horizon_steps)]


class SeasonalNaiveForecaster(BaseForecaster):
    """Seasonal Naive Baseline: repeats the observation from the exact same season last year."""

    def __init__(self, season_length: int = 12) -> None:
        self.season_length = season_length
        self._history: list[float] = []

    @property
    def model_name(self) -> str:
        return f"Seasonal Naive (s={self.season_length}) Baseline"

    @property
    def model_version(self) -> str:
        return "1.0.0"

    @property
    def is_baseline(self) -> bool:
        return True

    def fit(self, train_periods: list[str], train_values: list[float]) -> None:
        if not train_values:
            raise ValueError("Training values cannot be empty.")
        self._history = list(train_values)

    def predict(self, horizon_steps: int) -> list[float]:
        n = len(self._history)
        preds: list[float] = []
        for step in range(horizon_steps):
            if n >= self.season_length:
                ref_idx = n - self.season_length + (step % self.season_length)
                preds.append(round(self._history[ref_idx], 2))
            else:
                # Fallback to last observation if insufficient seasonal history
                preds.append(round(self._history[-1], 2))
        return preds


class MovingAverageForecaster(BaseForecaster):
    """Trailing Moving Average Baseline: predicts the mean of the trailing k observations."""

    def __init__(self, window_size: int = 3) -> None:
        self.window_size = window_size
        self._mean_val: float = 0.0

    @property
    def model_name(self) -> str:
        return f"Moving Average (k={self.window_size}) Baseline"

    @property
    def model_version(self) -> str:
        return "1.0.0"

    @property
    def is_baseline(self) -> bool:
        return True

    def fit(self, train_periods: list[str], train_values: list[float]) -> None:
        if not train_values:
            raise ValueError("Training values cannot be empty.")
        sub = train_values[-self.window_size :]
        self._mean_val = sum(sub) / len(sub)

    def predict(self, horizon_steps: int) -> list[float]:
        return [round(self._mean_val, 2) for _ in range(horizon_steps)]


class LinearTrendForecaster(BaseForecaster):
    """Linear Drift Baseline: fits ordinary linear regression on the time index."""

    def __init__(self) -> None:
        self._slope: float = 0.0
        self._intercept: float = 0.0
        self._n_train: int = 0

    @property
    def model_name(self) -> str:
        return "Linear Trend Drift Baseline"

    @property
    def model_version(self) -> str:
        return "1.0.0"

    @property
    def is_baseline(self) -> bool:
        return True

    def fit(self, train_periods: list[str], train_values: list[float]) -> None:
        n = len(train_values)
        if n < 2:
            raise ValueError("At least 2 points required for linear trend.")
        self._n_train = n
        x = list(range(n))
        x_mean = (n - 1) / 2.0
        y_mean = sum(train_values) / n

        num = sum((xi - x_mean) * (yi - y_mean) for xi, yi in zip(x, train_values, strict=True))
        den = sum((xi - x_mean) ** 2 for xi in x)
        self._slope = num / den if den != 0 else 0.0
        self._intercept = y_mean - self._slope * x_mean

    def predict(self, horizon_steps: int) -> list[float]:
        preds: list[float] = []
        for step in range(horizon_steps):
            t = self._n_train + step
            pred = max(0.0, self._intercept + self._slope * t)
            preds.append(round(pred, 2))
        return preds


# ==============================================================================
# CANDIDATE STATISTICAL & ML MODELS
# ==============================================================================


class HoltWintersForecaster(BaseForecaster):
    """Holt-Winters Triple Exponential Smoothing (Additive Trend and Multiplicative Seasonality)."""

    def __init__(
        self,
        season_length: int = 12,
        alpha: float = 0.3,
        beta: float = 0.1,
        gamma: float = 0.3,
    ) -> None:
        self.season_length = season_length
        self.alpha = alpha
        self.beta = beta
        self.gamma = gamma
        self._level: float = 0.0
        self._trend: float = 0.0
        self._seasonals: list[float] = []

    @property
    def model_name(self) -> str:
        return f"Holt-Winters Exponential Smoothing (s={self.season_length})"

    @property
    def model_version(self) -> str:
        return "1.2.0"

    @property
    def is_baseline(self) -> bool:
        return False

    def fit(self, train_periods: list[str], train_values: list[float]) -> None:
        n = len(train_values)
        s = self.season_length
        if n < 2 * s:
            raise ValueError(f"Holt-Winters requires at least 2 full seasonal cycles ({2 * s} samples, got {n})")

        # Initial level and trend
        self._level = sum(train_values[:s]) / s
        self._trend = (sum(train_values[s : 2 * s]) - sum(train_values[:s])) / (s * s)

        # Initial seasonal indices (multiplicative factors around 1.0)
        self._seasonals = [train_values[i] / max(self._level, 1e-6) for i in range(s)]

        # Sequential online updates
        for i in range(s, n):
            val = train_values[i]
            prev_level = self._level
            prev_trend = self._trend
            seas_idx = i % s
            prev_season = self._seasonals[seas_idx]

            # Level update
            self._level = self.alpha * (val / max(prev_season, 1e-6)) + (1.0 - self.alpha) * (prev_level + prev_trend)
            # Trend update
            self._trend = self.beta * (self._level - prev_level) + (1.0 - self.beta) * prev_trend
            # Seasonal update
            self._seasonals[seas_idx] = self.gamma * (val / max(self._level, 1e-6)) + (1.0 - self.gamma) * prev_season

    def predict(self, horizon_steps: int) -> list[float]:
        preds: list[float] = []
        for step in range(1, horizon_steps + 1):
            seas_idx = (len(self._seasonals) + step - 1) % self.season_length
            seas_factor = self._seasonals[seas_idx]
            pred = (self._level + step * self._trend) * seas_factor
            preds.append(max(0.0, round(pred, 2)))
        return preds


class LaggedRidgeForecaster(BaseForecaster):
    """Autoregressive Ridge Regression with strict backward-looking lags and rolling statistics.

    Fit strictly on training set; zero future leakage.
    """

    def __init__(self, lags: list[int] | None = None, alpha: float = 1.0) -> None:
        self.lags = lags or [1, 2, 12]
        self.alpha = alpha
        self._model = Ridge(alpha=self.alpha)
        self._last_window: list[float] = []
        self._is_fit = False

    @property
    def model_name(self) -> str:
        return "Lagged Autoregressive Ridge Regression"

    @property
    def model_version(self) -> str:
        return "2.1.0"

    @property
    def is_baseline(self) -> bool:
        return False

    def fit(self, train_periods: list[str], train_values: list[float]) -> None:
        max_lag = max(self.lags)
        if len(train_values) <= max_lag + 2:
            raise ValueError(f"Lagged Ridge requires at least {max_lag + 3} samples (got {len(train_values)})")

        X, y = TemporalValidationEngine.construct_lag_features(
            train_values, lags=self.lags, include_rolling_mean=True, rolling_window=3
        )
        self._model.fit(X, y)
        self._last_window = list(train_values)
        self._is_fit = True

    def predict(self, horizon_steps: int) -> list[float]:
        if not self._is_fit:
            raise RuntimeError("Model must be fit before calling predict.")

        current_window = list(self._last_window)
        preds: list[float] = []

        for _ in range(horizon_steps):
            # Construct row from end of current_window
            row: list[float] = []
            for lag in self.lags:
                row.append(current_window[-lag])
            # 3-step rolling mean
            window_3 = current_window[-3:]
            row.append(sum(window_3) / len(window_3))

            pred_val = float(self._model.predict([row])[0])
            pred_val = max(0.0, round(pred_val, 2))
            preds.append(pred_val)
            current_window.append(pred_val)

        return preds


# ==============================================================================
# MODEL TOURNAMENT & CHAMPION SELECTION
# ==============================================================================


@dataclass(frozen=True)
class ModelTournamentResult:
    target_metric: str
    geo_code: str
    horizon_steps: int
    champion_model_name: str
    champion_model_version: str
    is_baseline_champion: bool
    selection_reason: str
    all_model_evaluations: dict[str, ForecastEvaluationMetrics]
    forecast_periods: list[str]
    forecast_p50: list[float]
    forecast_p10: list[float]
    forecast_p90: list[float]
    uncertainty_method: str
    training_date_range: tuple[str, str]
    generated_timestamp: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.UTC).isoformat()
    )
    limitations: list[str] = field(default_factory=list)


class ModelTournamentEngine:
    """Orchestrates model competition, chronological backtesting, and champion selection."""

    def __init__(self, season_length: int = 12) -> None:
        self.season_length = season_length

    def run_tournament(
        self,
        periods: list[str],
        values: list[float],
        target_metric: str,
        geo_code: str,
        horizon_steps: int = 6,
        holdout_steps: int = 3,
    ) -> ModelTournamentResult:
        n = len(values)
        if n < 6:
            raise ValueError(f"Insufficient historical samples ({n}). Minimum 6 required.")

        # Ensure holdout size is valid
        test_size = min(holdout_steps, max(1, n // 4))
        split = TemporalValidationEngine.chronological_split(periods, values, test_size=test_size)

        # Build candidate models suite
        baselines: list[BaseForecaster] = [
            LastObservationForecaster(),
            MovingAverageForecaster(window_size=3),
            LinearTrendForecaster(),
        ]
        if len(split.train_values) >= self.season_length:
            baselines.append(SeasonalNaiveForecaster(season_length=self.season_length))

        candidates: list[BaseForecaster] = []
        if len(split.train_values) >= 2 * self.season_length:
            candidates.append(HoltWintersForecaster(season_length=self.season_length))
            candidates.append(LaggedRidgeForecaster(lags=[1, 2, self.season_length]))

        # Fit and evaluate all models on chronological holdout
        evaluations: dict[str, ForecastEvaluationMetrics] = {}
        predictions: dict[str, list[float]] = {}

        # 1. Evaluate default baseline (Seasonal Naive if available, else Last Obs)
        primary_baseline = baselines[-1]  # Seasonal Naive or Last Obs
        primary_baseline.fit(split.train_periods, split.train_values)
        base_preds = primary_baseline.predict(test_size)
        predictions[primary_baseline.model_name] = base_preds
        evaluations[primary_baseline.model_name] = TemporalValidationEngine.compute_evaluation_metrics(
            actual=split.test_values,
            predicted=base_preds,
            baseline_name=primary_baseline.model_name,
        )

        # 2. Evaluate remaining baselines and candidates
        for m in baselines[:-1] + candidates:
            try:
                m.fit(split.train_periods, split.train_values)
                preds = m.predict(test_size)
                predictions[m.model_name] = preds
                evaluations[m.model_name] = TemporalValidationEngine.compute_evaluation_metrics(
                    actual=split.test_values,
                    predicted=preds,
                    baseline_predicted=base_preds,
                    baseline_name=primary_baseline.model_name,
                )
            except Exception:
                # Omit model if evaluation fails due to sample size
                continue

        # 3. Champion Selection
        # Separate best baseline from best candidate
        best_baseline = min(
            [m for m in baselines if m.model_name in evaluations],
            key=lambda m: evaluations[m.model_name].mae,
        )
        best_baseline_mae = evaluations[best_baseline.model_name].mae

        evaluated_candidates = [m for m in candidates if m.model_name in evaluations]
        if evaluated_candidates:
            best_candidate = min(evaluated_candidates, key=lambda m: evaluations[m.model_name].mae)
            best_cand_mae = evaluations[best_candidate.model_name].mae
            # Candidate must beat baseline by at least 1% lower MAE
            improvement_margin = (best_baseline_mae - best_cand_mae) / max(best_baseline_mae, 1e-6)
            if improvement_margin >= 0.01:
                champion = best_candidate
                is_baseline = False
                reason = (
                    f"Candidate model '{champion.model_name}' selected: outperformed best baseline "
                    f"'{best_baseline.model_name}' by {improvement_margin * 100:.1f}% lower MAE "
                    f"({best_cand_mae:.2f} vs {best_baseline_mae:.2f} MU) on out-of-sample holdout."
                )
            else:
                champion = best_baseline
                is_baseline = True
                reason = (
                    f"Baseline '{champion.model_name}' retained: candidate models failed to beat the baseline "
                    f"by the required 1% margin (best candidate MAE: {best_cand_mae:.2f} vs baseline: {best_baseline_mae:.2f} MU)."
                )
        else:
            champion = best_baseline
            is_baseline = True
            reason = (
                f"Baseline '{champion.model_name}' selected: insufficient sample history for higher-order statistical models "
                f"({len(split.train_values)} training months < 24 months)."
            )

        # 4. Generate Production Forward Forecast
        # Refit champion model on 100% of available observations
        champion.fit(periods, values)
        future_p50 = champion.predict(horizon_steps)

        # Future period labels
        last_p = periods[-1]
        y, m = int(last_p[:4]), int(last_p[5:7])
        future_periods: list[str] = []
        for _ in range(horizon_steps):
            m += 1
            if m > 12:
                m = 1
                y += 1
            future_periods.append(f"{y:04d}-{m:02d}")

        # Compute empirical uncertainty intervals (P10 and P90)
        # Using holdout RMSE as base standard deviation
        holdout_rmse = max(evaluations[champion.model_name].rmse, 1.0)
        future_p10: list[float] = []
        future_p90: list[float] = []
        for step in range(horizon_steps):
            # Expanding uncertainty cone across forecast steps
            expansion = math.sqrt(1.0 + 0.15 * step)
            spread = round(1.282 * holdout_rmse * expansion, 2)  # 80% confidence interval (z=1.282)
            p10 = max(0.0, round(future_p50[step] - spread, 2))
            p90 = round(future_p50[step] + spread, 2)
            future_p10.append(p10)
            future_p90.append(p90)

        limitations = [
            "Evaluated on chronological holdout without data leakage.",
            "Uncertainty bounds represent 80% empirical residual intervals (P10-P90); not guaranteed physical bounds.",
            "Macro electricity projections assume normal weather distributions and contracted grid availability.",
        ]

        return ModelTournamentResult(
            target_metric=target_metric,
            geo_code=geo_code,
            horizon_steps=horizon_steps,
            champion_model_name=champion.model_name,
            champion_model_version=champion.model_version,
            is_baseline_champion=is_baseline,
            selection_reason=reason,
            all_model_evaluations=evaluations,
            forecast_periods=future_periods,
            forecast_p50=future_p50,
            forecast_p10=future_p10,
            forecast_p90=future_p90,
            uncertainty_method="Empirical holdout residual variance (80% confidence, P10/P90)",
            training_date_range=(periods[0], periods[-1]),
            limitations=limitations,
        )
