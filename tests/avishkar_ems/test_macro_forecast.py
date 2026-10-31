"""Tests for Macro Forecasting Pipeline and Error Metrics."""

from __future__ import annotations

import pytest

from avishkar_ems.macro_forecast import MacroForecastPipeline, compute_metrics


def test_metric_computations():
    actual = [100.0, 120.0, 110.0, 130.0]
    preds = [95.0, 125.0, 105.0, 135.0]  # all errors +/- 5.0
    metrics = compute_metrics(actual, preds, "TestModel")
    assert metrics.mae == 5.0
    assert metrics.rmse == 5.0
    assert metrics.holdout_samples == 4
    assert metrics.wape_pct == pytest.approx(4.35, abs=0.05)


def test_macro_forecast_pipeline_execution():
    pipeline = MacroForecastPipeline(season_length=12)
    # 24 months of synthetic historical demand
    periods = [f"2024-{m:02d}" for m in range(1, 13)] + [f"2025-{m:02d}" for m in range(1, 13)]
    values = [7000.0 + 500.0 * (i % 6) + 50.0 * i for i in range(24)]

    output = pipeline.run(periods, values, "Electricity Requirement", "KA", horizon_steps=6)
    assert len(output.forecast_periods) == 6
    assert len(output.forecast_p50) == 6
    assert len(output.forecast_p10) == 6
    assert len(output.forecast_p90) == 6
    assert output.metrics.mae >= 0.0

    # Verify P10 <= P50 <= P90
    for p10, p50, p90 in zip(output.forecast_p10, output.forecast_p50, output.forecast_p90, strict=True):
        assert p10 <= p50 <= p90


def test_insufficient_history_warning():
    pipeline = MacroForecastPipeline(season_length=12)
    # Only 10 months (less than 24)
    periods = [f"2024-{m:02d}" for m in range(1, 11)]
    values = [7000.0 + 100.0 * i for i in range(10)]

    output = pipeline.run(periods, values, "Electricity Requirement", "KA", horizon_steps=3)
    assert output.warning is not None
    assert "less than 24 months" in output.warning
