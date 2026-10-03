"""Indian electricity tariff model (rupees per kWh).

The presets are ILLUSTRATIVE. Real tariffs differ by DISCOM and consumer category, so replace
them with the rates in the organisers' dataset or the site's actual bill.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

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

def tod_from_base(base_rate: float, commercial: bool, solar: tuple[float, float] = (9.0, 17.0),
                  peak: tuple[float, float] = (18.0, 22.0), export_rate: float = 3.0, p2p_charges: float = 0.7,
                  shortfall_penalty: float = 5.0) -> Tariff:
    """Time-of-Day tariff built from a normal rate using the national minimums in the Electricity (Rights of Consumers)
    Amendment Rules 2023 (PIB release 1945236): solar hours at least 20% below normal, peak hours at least 1.2x normal
    for commercial and industrial users and 1.1x for others. The solar and peak hours are set by each state regulator;
    the defaults here are placeholders to replace with your state's hours. The rule gives minimums, so real tariffs may
    differ."""
    (s0, s1), (p0, p1) = solar, peak
    blocks = ((0.0, s0, base_rate), (s0, s1, base_rate * 0.8), (s1, p0, base_rate),
              (p0, p1, base_rate * (1.2 if commercial else 1.1)), (p1, 24.0, base_rate))
    blocks = tuple(b for b in blocks if b[1] > b[0])
    return Tariff(blocks, export_rate, p2p_charges, shortfall_penalty,
                  f"tod_rule_{'commercial' if commercial else 'domestic'}_base{base_rate:g}")


def load_tariff(path: str | Path) -> Tariff:
    """Read a tariff from JSON (see data/tariffs/template.json)."""
    d = json.loads(Path(path).read_text())
    blocks = tuple((float(a), float(b), float(r)) for a, b, r in d["tou_blocks"])
    return Tariff(blocks, float(d["export_rate"]), float(d["p2p_charges"]), float(d["shortfall_penalty"]),
                  d.get("name", "custom"))


PRESETS = {t.name: t for t in (COMMERCIAL_TOD, DOMESTIC_FLAT)}
