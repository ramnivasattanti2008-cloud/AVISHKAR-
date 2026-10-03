"""PM Surya Ghar: Muft Bijli Yojana central financial assistance for residential rooftop solar.

Rates as published on pmsuryaghar.gov.in (checked through pmsolar.org.in, which cites it): Rs 30,000 per kW for the
first 2 kW, Rs 18,000 for the third kW, capped at Rs 78,000, for residential households. Rules change, so check the
official portal before relying on it. Batteries are not covered.
"""

from __future__ import annotations


def pm_surya_ghar(dc_kwp: float, residential: bool = True) -> float:
    if not residential or dc_kwp <= 0:
        return 0.0
    return min(dc_kwp, 2.0) * 30_000.0 + min(max(dc_kwp - 2.0, 0.0), 1.0) * 18_000.0
