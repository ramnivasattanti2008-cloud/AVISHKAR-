"""Time-Series Trends and Period-over-Period Analytics Engine for UrjaSetu EMS.

Provides mathematically rigorous, source-grounded time-series analysis:
1. Month-over-Month (MoM) and Year-over-Year (YoY) percentage changes with safe denominator checks.
2. Rolling averages (3-month, 12-month trailing windows).
3. Peak and minimum observation tracking across reporting periods.
4. Seasonal pattern and index calculations.
5. Invariant enforcement: Instantaneous power (MW) is NEVER aggregated via SUM over time periods.
6. Partial reporting period detection and explicit labeling.
"""

from __future__ import annotations

from dataclasses import dataclass

from avishkar_ems.metric_semantics import AggregationMethod, MetricCompatibilityError


@dataclass(frozen=True)
class TimeSeriesPoint:
    period: str  # Format: "YYYY-MM"
    value: float
    unit: str
    is_partial: bool = False
    source_ref: str = ""


@dataclass(frozen=True)
class PeriodComparisonResult:
    metric_name: str
    current_period: str
    current_value: float
    reference_period: str
    reference_value: float
    delta: float
    percentage_change: float | None
    comparison_type: str  # "MOM", "YOY", "CUSTOM"
    formula: str
    is_comparable: bool
    notes: str


@dataclass(frozen=True)
class RollingAverageResult:
    metric_name: str
    period: str
    window_size: int
    rolling_average: float
    valid_points_count: int
    evaluated_periods: list[str]


@dataclass(frozen=True)
class PeakMinResult:
    metric_name: str
    unit: str
    peak_period: str
    peak_value: float
    min_period: str
    min_value: float
    total_periods_evaluated: int


@dataclass(frozen=True)
class SeasonalPatternResult:
    metric_name: str
    monthly_indices: dict[int, float]  # Month 1-12 -> index (1.0 = average)
    peak_season_month: int
    trough_season_month: int
    history_years_count: float
    notes: str


class TimeSeriesTrendsEngine:
    """Computes time-series statistics and period comparisons with data integrity checks."""

    @staticmethod
    def _parse_year_month(period: str) -> tuple[int, int]:
        if len(period) != 7 or period[4] != "-":
            raise ValueError(f"Invalid period format: '{period}'. Expected 'YYYY-MM'.")
        return int(period[:4]), int(period[5:7])

    @staticmethod
    def _format_year_month(year: int, month: int) -> str:
        return f"{year:04d}:{month:02d}".replace(":", "-")

    @classmethod
    def calculate_mom(
        cls,
        series: list[TimeSeriesPoint],
        target_period: str,
        metric_name: str = "Metric",
    ) -> PeriodComparisonResult | None:
        """Calculates Month-over-Month change comparing target_period with immediate predecessor."""
        by_period = {p.period: p for p in series}
        if target_period not in by_period:
            return None

        cur = by_period[target_period]
        year, month = cls._parse_year_month(target_period)
        prev_month = month - 1
        prev_year = year
        if prev_month == 0:
            prev_month = 12
            prev_year -= 1
        prev_period = cls._format_year_month(prev_year, prev_month)

        if prev_period not in by_period:
            return None  # Baseline period missing

        prev = by_period[prev_period]

        # Check partial period comparability
        if cur.is_partial != prev.is_partial:
            notes = (
                f"Comparability caveat: One period is partial ({cur.period if cur.is_partial else prev.period}), "
                "while the other is full. Absolute comparison is skewed."
            )
        else:
            notes = f"Standard MoM comparison across consecutive calendar months ({prev_period} to {target_period})."

        delta = round(cur.value - prev.value, 4)
        if prev.value > 0:
            pct_change: float | None = round((delta / prev.value) * 100.0, 3)
        elif prev.value == 0:
            pct_change = None
            notes += " Percentage change undefined because baseline reference value is zero."
        else:
            pct_change = None
            notes += " Percentage change omitted for negative baseline reference value."

        formula = f"({cur.value} - {prev.value}) / {prev.value} * 100"

        return PeriodComparisonResult(
            metric_name=metric_name,
            current_period=target_period,
            current_value=cur.value,
            reference_period=prev_period,
            reference_value=prev.value,
            delta=delta,
            percentage_change=pct_change,
            comparison_type="MOM",
            formula=formula,
            is_comparable=not (cur.is_partial != prev.is_partial),
            notes=notes,
        )

    @classmethod
    def calculate_yoy(
        cls,
        series: list[TimeSeriesPoint],
        target_period: str,
        metric_name: str = "Metric",
    ) -> PeriodComparisonResult | None:
        """Calculates Year-over-Year change comparing target_period with exact same month 1 year prior."""
        by_period = {p.period: p for p in series}
        if target_period not in by_period:
            return None

        cur = by_period[target_period]
        year, month = cls._parse_year_month(target_period)
        prev_period = cls._format_year_month(year - 1, month)

        if prev_period not in by_period:
            return None  # 12-month baseline period missing

        prev = by_period[prev_period]

        if cur.is_partial != prev.is_partial:
            notes = (
                f"Comparability caveat: Period {cur.period if cur.is_partial else prev.period} is partial. "
                "YoY comparison requires normalized daily averages."
            )
        else:
            notes = f"Verified YoY comparison against identical month in prior year ({prev_period} to {target_period})."

        delta = round(cur.value - prev.value, 4)
        if prev.value > 0:
            pct_change: float | None = round((delta / prev.value) * 100.0, 3)
        elif prev.value == 0:
            pct_change = None
            notes += " Percentage change undefined because baseline reference value is zero."
        else:
            pct_change = None
            notes += " Percentage change omitted for negative baseline."

        formula = f"({cur.value} - {prev.value}) / {prev.value} * 100"

        return PeriodComparisonResult(
            metric_name=metric_name,
            current_period=target_period,
            current_value=cur.value,
            reference_period=prev_period,
            reference_value=prev.value,
            delta=delta,
            percentage_change=pct_change,
            comparison_type="YOY",
            formula=formula,
            is_comparable=not (cur.is_partial != prev.is_partial),
            notes=notes,
        )

    @classmethod
    def calculate_rolling_average(
        cls,
        series: list[TimeSeriesPoint],
        target_period: str,
        window_size: int = 3,
        metric_name: str = "Metric",
    ) -> RollingAverageResult | None:
        """Calculates trailing rolling average ending at target_period."""
        if window_size < 1:
            raise ValueError(f"Window size must be at least 1, got {window_size}")

        sorted_series = sorted(series, key=lambda x: x.period)
        periods = [p.period for p in sorted_series]
        if target_period not in periods:
            return None

        idx = periods.index(target_period)
        start_idx = max(0, idx - window_size + 1)
        sub_series = sorted_series[start_idx : idx + 1]

        if len(sub_series) < window_size:
            # We preserve missing periods: if fewer than window_size observations exist, report valid points
            pass

        avg_val = round(sum(p.value for p in sub_series) / len(sub_series), 4)
        eval_periods = [p.period for p in sub_series]

        return RollingAverageResult(
            metric_name=metric_name,
            period=target_period,
            window_size=window_size,
            rolling_average=avg_val,
            valid_points_count=len(sub_series),
            evaluated_periods=eval_periods,
        )

    @classmethod
    def find_peak_and_min(
        cls,
        series: list[TimeSeriesPoint],
        metric_name: str = "Metric",
    ) -> PeakMinResult | None:
        """Finds peak and minimum observations in the series."""
        if not series:
            return None

        peak_pt = max(series, key=lambda p: p.value)
        min_pt = min(series, key=lambda p: p.value)

        return PeakMinResult(
            metric_name=metric_name,
            unit=series[0].unit,
            peak_period=peak_pt.period,
            peak_value=peak_pt.value,
            min_period=min_pt.period,
            min_value=min_pt.value,
            total_periods_evaluated=len(series),
        )

    @classmethod
    def calculate_seasonal_pattern(
        cls,
        series: list[TimeSeriesPoint],
        metric_name: str = "Metric",
    ) -> SeasonalPatternResult | None:
        """Computes seasonal indices (monthly factor relative to annual baseline mean).

        Requires at least 12 distinct monthly observations.
        """
        if len(series) < 12:
            return None

        month_totals: dict[int, list[float]] = {m: [] for m in range(1, 13)}
        for pt in series:
            _, m = cls._parse_year_month(pt.period)
            month_totals[m].append(pt.value)

        # Average for each month across available years
        month_means: dict[int, float] = {}
        for m, vals in month_totals.items():
            if vals:
                month_means[m] = sum(vals) / len(vals)

        if len(month_means) < 12:
            return None  # Needs full 12-month calendar representation

        overall_mean = sum(month_means.values()) / 12.0
        if overall_mean <= 0:
            return None

        indices = {m: round(month_means[m] / overall_mean, 3) for m in range(1, 13)}
        peak_month = max(indices.keys(), key=lambda m: indices[m])
        trough_month = min(indices.keys(), key=lambda m: indices[m])

        years_coverage = round(len(series) / 12.0, 1)
        notes = (
            f"Seasonal pattern derived from {len(series)} monthly observations over ~{years_coverage} years. "
            f"Peak seasonal demand factor: {indices[peak_month]:.3f} in month {peak_month:02d}; "
            f"trough factor: {indices[trough_month]:.3f} in month {trough_month:02d}."
        )

        return SeasonalPatternResult(
            metric_name=metric_name,
            monthly_indices=indices,
            peak_season_month=peak_month,
            trough_season_month=trough_month,
            history_years_count=years_coverage,
            notes=notes,
        )

    @staticmethod
    def aggregate_interval_data(
        values: list[float],
        method: AggregationMethod,
        unit: str,
        metric_name: str = "Metric",
    ) -> float:
        """Aggregates values with invariant enforcement.

        Strict invariant: Power (MW, kW) cannot be aggregated with SUM.
        Energy totals (MU, kWh) can be aggregated with SUM.
        """
        if not values:
            return 0.0

        is_power = unit.strip().upper() in {"MW", "KW", "GW", "W"}
        if is_power and method == AggregationMethod.SUM:
            raise MetricCompatibilityError(
                metric_a=metric_name,
                metric_b="SUM_AGGREGATION",
                reason=f"Instantaneous power metric with unit '{unit}' cannot be summed across time intervals.",
                guidance="Use AggregationMethod.MAX for peak demand or AggregationMethod.MEAN for average load.",
            )

        if method == AggregationMethod.SUM:
            return round(sum(values), 4)
        elif method == AggregationMethod.MAX:
            return round(max(values), 4)
        elif method == AggregationMethod.MEAN:
            return round(sum(values) / len(values), 4)
        elif method == AggregationMethod.LATEST:
            return round(values[-1], 4)
        elif method == AggregationMethod.WEIGHTED_AVG:
            return round(sum(values) / len(values), 4)
        else:
            raise ValueError(f"Unsupported aggregation method: {method}")
