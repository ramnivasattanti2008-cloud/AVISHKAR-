"""Indian electricity tariff model (rupees per kWh).

The presets are ILLUSTRATIVE. Real tariffs differ by DISCOM and consumer category, so replace
them with the rates in the organisers' dataset or the site's actual bill.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Tariff:
    """Time-of-day import tariff plus the money terms of exporting and trading surplus."""

    # (start_hour, end_hour, INR/kWh). Hours are local time, end exclusive. A block may wrap
    # midnight (start > end). Blocks must cover all 24 hours between them.
    tou_blocks: tuple[tuple[float, float, float], ...]
    export_rate: float  # grid export at net-metering or feed-in rate, INR/kWh
    p2p_charges: float  # network + platform charges on a P2P/UEI sale, INR/kWh
    shortfall_penalty: float  # INR per kWh committed but not delivered
    name: str = "custom"

    def import_rates(self, index: pd.DatetimeIndex) -> np.ndarray:
        """Retail import rate for every timestamp, in INR/kWh."""
        hour = np.asarray(index.hour + index.minute / 60.0, dtype=float)
        rates = np.full(len(index), np.nan)
        for start, end, rate in self.tou_blocks:
            if start < end:
                mask = (hour >= start) & (hour < end)
            else:  # wraps midnight
                mask = (hour >= start) | (hour < end)
            rates[mask] = rate
        if np.isnan(rates).any():
            raise ValueError(f"Tariff '{self.name}' tou_blocks do not cover all 24 hours")
        return rates

    def export_rates(self, index: pd.DatetimeIndex) -> np.ndarray:
        return np.full(len(index), self.export_rate, dtype=float)


# Illustrative commercial time-of-day tariff: evening peak, night off-peak, solar-hour rebate.
COMMERCIAL_TOD = Tariff(
    tou_blocks=((22.0, 6.0, 6.0), (6.0, 10.0, 7.5), (10.0, 16.0, 6.5), (16.0, 18.0, 7.5),
                (18.0, 22.0, 10.0)),
    export_rate=3.5,
    p2p_charges=0.8,
    shortfall_penalty=6.0,
    name="commercial_tod_illustrative",
)

# Illustrative domestic tariff with a flat rate and net-metering style export.
DOMESTIC_FLAT = Tariff(
    tou_blocks=((0.0, 24.0, 7.0),),
    export_rate=3.0,
    p2p_charges=0.6,
    shortfall_penalty=5.0,
    name="domestic_flat_illustrative",
)

PRESETS = {t.name: t for t in (COMMERCIAL_TOD, DOMESTIC_FLAT)}
