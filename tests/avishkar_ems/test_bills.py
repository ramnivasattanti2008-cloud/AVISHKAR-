"""Tests for the bills-only onboarding profile generator."""

from __future__ import annotations

import numpy as np
import pytest

from avishkar_ems.bills import (
    MonthlyBill,
    bills_to_hourly_profile,
    summarize_bill_dna,
)


def test_monthly_bill_validation():
    with pytest.raises(ValueError, match="Month must be 1..12"):
        MonthlyBill(year=2025, month=13, kwh=200.0)

    with pytest.raises(ValueError, match="Month must be 1..12"):
        MonthlyBill(year=2025, month=0, kwh=200.0)

    with pytest.raises(ValueError, match="kWh must be non-negative"):
        MonthlyBill(year=2025, month=5, kwh=-10.0)

    with pytest.raises(ValueError, match="Amount must be non-negative"):
        MonthlyBill(year=2025, month=5, kwh=100.0, amount_inr=-50.0)


def test_energy_conservation_and_calendar_accuracy():
    bills = [
        MonthlyBill(year=2024, month=2, kwh=290.0),  # Leap year: 29 days -> 10 kWh/day
        MonthlyBill(year=2025, month=2, kwh=280.0),  # Common year: 28 days -> 10 kWh/day
        MonthlyBill(year=2025, month=4, kwh=300.0),  # 30 days -> 10 kWh/day
        MonthlyBill(year=2025, month=5, kwh=310.0),  # 31 days -> 10 kWh/day
    ]

    df = bills_to_hourly_profile(bills)
    assert len(df) == (29 + 28 + 30 + 31) * 24

    # Verify each month's total energy matches the bill exactly
    feb24 = df.loc["2024-02-01":"2024-02-29 23:00:00"]
    assert np.isclose(feb24["usage_kwh"].sum(), 290.0)

    feb25 = df.loc["2025-02-01":"2025-02-28 23:00:00"]
    assert np.isclose(feb25["usage_kwh"].sum(), 280.0)

    apr25 = df.loc["2025-04-01":"2025-04-30 23:00:00"]
    assert np.isclose(apr25["usage_kwh"].sum(), 300.0)

    may25 = df.loc["2025-05-01":"2025-05-31 23:00:00"]
    assert np.isclose(may25["usage_kwh"].sum(), 310.0)

    # All rows must bear honest provenance
    assert (df["provenance"] == "ESTIMATED: derived from monthly bills").all()


def test_diurnal_curve_shape():
    bills = [MonthlyBill(year=2025, month=1, kwh=310.0)]
    df = bills_to_hourly_profile(bills)

    # Check that evening peak (20:00) is strictly greater than 03:00 trough
    day = df.loc["2025-01-15"]
    kw_at_20 = float(day.loc[day.index.hour == 20, "usage_kw"].iloc[0])
    kw_at_03 = float(day.loc[day.index.hour == 3, "usage_kw"].iloc[0])
    assert kw_at_20 > kw_at_03 * 2.5


def test_summarize_bill_dna():
    bills = [
        MonthlyBill(year=2025, month=1, kwh=200.0, amount_inr=1400.0),
        MonthlyBill(year=2025, month=2, kwh=250.0, amount_inr=1750.0),
        MonthlyBill(year=2025, month=3, kwh=300.0, amount_inr=2100.0),
    ]

    dna = summarize_bill_dna(bills)
    assert dna["months_covered"] == 3
    assert dna["total_annual_kwh"] == 750.0
    assert dna["mean_monthly_kwh"] == 250.0
    assert dna["min_monthly_kwh"] == 200.0
    assert dna["max_monthly_kwh"] == 300.0
    assert dna["seasonal_spread_kwh"] == 100.0
    assert dna["effective_rate_inr_per_kwh"] == 7.0
    assert "ESTIMATED" in dna["provenance"]
