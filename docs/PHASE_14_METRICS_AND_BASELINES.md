# UrjaSetu EMS — Phase 14: Metrics, Formulas & Forecasting Baselines

## 1. Forecasting Metrics Specification

All evaluation metrics are computed out-of-sample over the held-out test partition ($y_t$ is actual, $\hat{y}_t$ is predicted, $n$ is sample size).

### A. Mean Absolute Error (MAE)
$$\text{MAE} = \frac{1}{n} \sum_{t=1}^n |y_t - \hat{y}_t|$$
- *Unit*: Identical to target variable (`kWh` or `MU`).
- *Interpretation*: Average magnitude of forecast error. Robust against extreme outliers compared to squared metrics.

### B. Root Mean Squared Error (RMSE)
$$\text{RMSE} = \sqrt{\frac{1}{n} \sum_{t=1}^n (y_t - \hat{y}_t)^2}$$
- *Unit*: Identical to target variable (`kWh` or `MU`).
- *Interpretation*: Penalizes large individual forecast errors quadratically. By mathematical invariant, $\text{RMSE} \ge \text{MAE}$.

### C. Weighted Absolute Percentage Error (WAPE %)
$$\text{WAPE} = \frac{\sum_{t=1}^n |y_t - \hat{y}_t|}{\sum_{t=1}^n |y_t|} \times 100\%$$
- *Unit*: Percentage (`%`).
- *Why WAPE over MAPE*: Standard Mean Absolute Percentage Error (MAPE) divides each error by individual actual observations ($|y_t - \hat{y}_t| / y_t$). In energy systems, night-time solar generation, zero consumption, or near-zero observations trigger division-by-zero errors or asymptotic explosions. WAPE aggregates total error over total volume, guaranteeing numerical stability whenever aggregate consumption is non-zero.

### D. Mean Absolute Scaled Error (MASE)
$$\text{MASE} = \frac{\text{MAE}}{\frac{1}{N - s} \sum_{t=s+1}^N |y_t - y_{t-s}|}$$
- *Denominator*: In-sample mean absolute error of a naive seasonal forecast (seasonality $s=12$ for monthly series, $s=1$ for non-seasonal).
- *Interpretation*:
  - $\text{MASE} < 1.0$: The model performs **better** than the simple in-sample naive persistence baseline.
  - $\text{MASE} = 1.0$: The model performs **identically** to the naive baseline.
  - $\text{MASE} > 1.0$: The model performs **worse** than naive persistence; deploying it degrades forecasting quality.

### E. Forecast Bias (Mean Error)
$$\text{Bias} = \frac{1}{n} \sum_{t=1}^n (\hat{y}_t - y_t)$$
- *Interpretation*: Indicates systemic over-forecasting ($\text{Bias} > 0$) or systemic under-forecasting ($\text{Bias} < 0$). Unbiased models have $\text{Bias} \approx 0.0$.

---

## 2. Transparent Forecasting Baselines

The tournament includes four deterministic baseline models:

1. **Last Observation Persistence (`LastObservationForecaster`)**:
   $$\hat{y}_{T+h} = y_T \quad \forall h \ge 1$$
   Predicts that future demand will exactly equal the most recently observed value.
2. **Moving Average ($k=3$) (`MovingAverageForecaster`)**:
   $$\hat{y}_{T+h} = \frac{1}{3} (y_T + y_{T-1} + y_{T-2}) \quad \forall h \ge 1$$
   Dampens short-term volatility by projecting the trailing three-month mean.
3. **Linear Trend Drift (`LinearTrendForecaster`)**:
   $$\hat{y}_{T+h} = \hat{\beta}_0 + \hat{\beta}_1 (T + h)$$
   Fits linear regression on historical time indices to project linear growth or decline.
4. **Seasonal Naive ($s=12$) (`SeasonalNaiveForecaster`)**:
   $$\hat{y}_{T+h} = y_{T+h - 12}$$
   Repeats the observation from the exact corresponding month of the preceding year (e.g., April 2024 forecast = April 2023 actual).

---

## 3. Candidate Statistical & Machine-Learning Models

1. **Holt-Winters Triple Exponential Smoothing (`HoltWintersForecaster`)**:
   - Model version `1.2.0`.
   - Incorporates additive level, additive trend, and multiplicative seasonal indices:
     $$\ell_t = \alpha \frac{y_t}{s_{t-m}} + (1 - \alpha)(\ell_{t-1} + b_{t-1})$$
     $$b_t = \beta (\ell_t - \ell_{t-1}) + (1 - \beta) b_{t-1}$$
     $$s_t = \gamma \frac{y_t}{\ell_t} + (1 - \gamma) s_{t-m}$$
     $$\hat{y}_{t+h} = (\ell_t + h b_t) s_{t-m+h_m^+}$$
   - Requires at least two full seasonal cycles ($2 \times 12 = 24$ samples) for initialization.
2. **Lagged Autoregressive Ridge Regression (`LaggedRidgeForecaster`)**:
   - Model version `2.1.0`.
   - Features constructed strictly using backward-looking lags ($y_{t-1}, y_{t-2}, y_{t-12}$) and rolling 3-period mean.
   - $L_2$ regularization penalty ($\alpha=1.0$) prevents overfitting on short macroeconomic series.
