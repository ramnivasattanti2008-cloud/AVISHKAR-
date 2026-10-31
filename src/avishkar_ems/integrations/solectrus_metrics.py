"""Solectrus Integration: Power Flow Balance, Autarky & Telemetry Freshness.

Adapted from https://github.com/solectrus/solectrus (MIT License)
Modules: app/models/summary.rb, place.rb, and amortization calculations.

Provides:
1. Physics-consistent power flow balance calculation and flow diagram accounting.
2. Self-consumption ratio (Eigenverbrauch) and autarky degree (Autarkiegrad).
3. Telemetry freshness scoring with grace period tolerances (REQUIRED_DISTANCE, CURRENT_TOLERANCE).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import StrEnum


class FreshnessStatus(StrEnum):
    FRESH = "FRESH"
    STALE = "STALE"
    EXPIRED = "EXPIRED"


@dataclass
class FlowBalanceResult:
    # Production breakdown (kWh or kW)
    solar_production: float
    direct_consumption: float
    battery_charge: float
    grid_feed_in: float

    # Consumption breakdown (kWh or kW)
    total_consumption: float
    covered_by_solar: float
    covered_by_battery: float
    covered_by_grid: float

    # KPIs
    self_consumption_pct: float  # (Solar consumed locally / Total Solar) * 100
    autarky_pct: float           # (Consumption from solar+battery / Total Consumption) * 100
    balance_discrepancy: float


@dataclass
class FreshnessScore:
    age_seconds: float
    status: FreshnessStatus
    is_acceptable: bool
    description: str


class SolectrusMetrics:
    """Power flow accounting, autarky metrics, and telemetry freshness tracking."""

    # Solectrus constants (in seconds)
    CURRENT_TOLERANCE_S = 300.0       # 5 minutes base tolerance for live sensors
    MAX_CURRENT_TOLERANCE_S = 21600.0 # 6 hours max tolerance for background aggregations

    @staticmethod
    def calculate_flow_balance(
        solar_generation: float,
        home_consumption: float,
        battery_charge: float,
        battery_discharge: float,
        grid_import: float,
        grid_export: float,
    ) -> FlowBalanceResult:
        """Computes comprehensive flow breakdown, autarky degree, and self-consumption ratio."""
        # Direct solar self-consumption is solar minus what went to battery or exported
        direct_solar = max(0.0, solar_generation - battery_charge - grid_export)

        # Autarky (self-sufficiency): fraction of house consumption not bought from grid
        local_covered = direct_solar + battery_discharge
        autarky = (
            (local_covered / home_consumption * 100.0)
            if home_consumption > 1e-4
            else 100.0
        )
        autarky = max(0.0, min(100.0, autarky))

        # Self-consumption ratio: fraction of PV generated that was consumed locally (direct + battery)
        total_local_used = direct_solar + battery_charge
        self_cons = (
            (total_local_used / solar_generation * 100.0)
            if solar_generation > 1e-4
            else 0.0
        )
        self_cons = max(0.0, min(100.0, self_cons))

        # Discrepancy check: (Production + Import + Battery Discharge) - (Consumption + Battery Charge + Export)
        total_in = solar_generation + grid_import + battery_discharge
        total_out = home_consumption + battery_charge + grid_export
        discrepancy = round(abs(total_in - total_out), 4)

        return FlowBalanceResult(
            solar_production=round(solar_generation, 3),
            direct_consumption=round(direct_solar, 3),
            battery_charge=round(battery_charge, 3),
            grid_feed_in=round(grid_export, 3),
            total_consumption=round(home_consumption, 3),
            covered_by_solar=round(direct_solar, 3),
            covered_by_battery=round(battery_discharge, 3),
            covered_by_grid=round(grid_import, 3),
            self_consumption_pct=round(self_cons, 1),
            autarky_pct=round(autarky, 1),
            balance_discrepancy=discrepancy,
        )

    @classmethod
    def evaluate_freshness(
        cls,
        last_updated_timestamp: float,
        current_time: float | None = None,
        tolerance_seconds: float | None = None,
    ) -> FreshnessScore:
        """Determines if incoming telemetry satisfies live-dashboard freshness guarantees."""
        now = current_time if current_time is not None else time.time()
        age = max(0.0, now - last_updated_timestamp)
        tol = tolerance_seconds if tolerance_seconds is not None else cls.CURRENT_TOLERANCE_S

        if age <= tol:
            status = FreshnessStatus.FRESH
            acceptable = True
            desc = f"Telemetry is fresh ({age:.1f}s ago <= {tol:.0f}s tolerance)"
        elif age <= cls.MAX_CURRENT_TOLERANCE_S:
            status = FreshnessStatus.STALE
            acceptable = False
            desc = f"Telemetry is stale ({age:.1f}s ago > {tol:.0f}s tolerance)"
        else:
            status = FreshnessStatus.EXPIRED
            acceptable = False
            desc = f"Telemetry has expired ({age:.1f}s ago > max tolerance)"

        return FreshnessScore(
            age_seconds=round(age, 1),
            status=status,
            is_acceptable=acceptable,
            description=desc,
        )

