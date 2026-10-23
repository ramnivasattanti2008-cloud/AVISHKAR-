"""Bills-only onboarding engine: reconstruct hourly load profiles from monthly utility bills.

Provides an onboarding path for consumers without 15-minute smart meter files.
Takes monthly electricity bills (kWh totals) and expands them into a standard
hourly time series using empirical Indian residential load profiles from the CEEW
household dataset.

Every synthesized interval is labeled strictly with:
    provenance = "ESTIMATED: derived from monthly bills"
Energy conservation identity:
    Sum of hourly kWh in any month == Total monthly bill kWh.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

# Empirical 24-hour residential diurnal load curve (fraction of daily energy per hour).
# Derived from CEEW rural/semi-urban household monitoring dataset.
# Shows morning peak (07:00-09:00), evening peak (19:00-22:00), and late night trough.
CEEW_DIURNAL_WEIGHTS: np.ndarray = np.array(
    [
        0.025,  # 00:00 - 01:00
        0.022,  # 01:00 - 02:00
        0.020,  # 02:00 - 03:00
        0.020,  # 03:00 - 04:00
        0.022,  # 04:00 - 05:00
        0.030,  # 05:00 - 06:00
        0.045,  # 06:00 - 07:00
        0.060,  # 07:00 - 08:00
        0.065,  # 08:00 - 09:00
        0.050,  # 09:00 - 10:00
        0.038,  # 10:00 - 11:00
        0.035,  # 11:00 - 12:00
        0.035,  # 12:00 - 13:00
        0.035,  # 13:00 - 14:00
        0.035,  # 14:00 - 15:00
        0.038,  # 15:00 - 16:00
        0.045,  # 16:00 - 17:00
        0.055,  # 17:00 - 18:00
        0.070,  # 18:00 - 19:00
        0.080,  # 19:00 - 20:00
        0.075,  # 20:00 - 21:00
        0.065,  # 21:00 - 22:00
        0.045,  # 22:00 - 23:00
        0.030,  # 23:00 - 24:00
    ],
    dtype=float,
)
# Ensure weights sum strictly to 1.0
CEEW_DIURNAL_WEIGHTS /= np.sum(CEEW_DIURNAL_WEIGHTS)


@dataclass(frozen=True)
class MonthlyBill:
    """A monthly utility electricity bill record."""

    year: int
    month: int
    kwh: float
    amount_inr: float | None = None

    def __post_init__(self) -> None:
        if not (1 <= self.month <= 12):
            raise ValueError(f"Month must be 1..12, got {self.month}")
        if self.kwh < 0.0:
            raise ValueError(f"kWh must be non-negative, got {self.kwh}")
        if self.amount_inr is not None and self.amount_inr < 0.0:
            raise ValueError(f"Amount must be non-negative, got {self.amount_inr}")


def bills_to_hourly_profile(
    bills: list[MonthlyBill],
    diurnal_weights: np.ndarray | None = None,
    tz: str = "Asia/Kolkata",
) -> pd.DataFrame:
    """Expand monthly bill records into a continuous hourly load time series.

    Guarantees strict energy conservation: the integral of hourly kWh over any
    calendar month equals that month's bill total.
    """
    if not bills:
        raise ValueError("bills list cannot be empty")

    weights = diurnal_weights if diurnal_weights is not None else CEEW_DIURNAL_WEIGHTS
    if len(weights) != 24:
        raise ValueError(f"Diurnal weights must have length 24, got {len(weights)}")
    norm_weights = np.asarray(weights, dtype=float) / np.sum(weights)

    # Sort bills chronologically
    sorted_bills = sorted(bills, key=lambda b: (b.year, b.month))

    frames: list[pd.DataFrame] = []
    for b in sorted_bills:
        _, num_days = calendar.monthrange(b.year, b.month)
        start_ts = pd.Timestamp(year=b.year, month=b.month, day=1, hour=0, tz=tz)
        end_ts = start_ts + pd.DateOffset(days=num_days)
        idx = pd.date_range(start=start_ts, end=end_ts, freq="1h", inclusive="left")

        daily_kwh = b.kwh / float(num_days)
        # Tile diurnal curve across all days in the month
        hourly_kwh_pattern = np.tile(norm_weights * daily_kwh, num_days)

        month_df = pd.DataFrame(
            {
                "usage_kw": hourly_kwh_pattern,  # 1h interval: kW == kWh
                "usage_kwh": hourly_kwh_pattern,
                "provenance": "ESTIMATED: derived from monthly bills",
            },
            index=idx,
        )
        frames.append(month_df)

    return pd.concat(frames)


def summarize_bill_dna(bills: list[MonthlyBill]) -> dict[str, Any]:
    """Derive foundational consumption metrics and seasonal variance from bills."""
    if not bills:
        raise ValueError("bills list cannot be empty")

    sorted_bills = sorted(bills, key=lambda b: (b.year, b.month))
    kwh_values = [b.kwh for b in sorted_bills]
    total_kwh = float(np.sum(kwh_values))
    mean_monthly_kwh = float(np.mean(kwh_values))
    min_kwh = float(np.min(kwh_values))
    max_kwh = float(np.max(kwh_values))

    # Base load estimate: conservative approximation from minimum consumption month
    base_load_kwh = min_kwh
    seasonal_variance_kwh = max_kwh - min_kwh

    total_amount = sum(b.amount_inr for b in sorted_bills if b.amount_inr is not None)
    effective_unit_cost = (
        round(total_amount / total_kwh, 2)
        if total_kwh > 0 and total_amount > 0
        else None
    )

    return {
        "months_covered": len(sorted_bills),
        "total_annual_kwh": round(total_kwh, 2),
        "mean_monthly_kwh": round(mean_monthly_kwh, 2),
        "min_monthly_kwh": round(min_kwh, 2),
        "max_monthly_kwh": round(max_kwh, 2),
        "base_monthly_kwh": round(base_load_kwh, 2),
        "seasonal_spread_kwh": round(seasonal_variance_kwh, 2),
        "effective_rate_inr_per_kwh": effective_unit_cost,
        "provenance": "ESTIMATED: derived from monthly bills",
    }
