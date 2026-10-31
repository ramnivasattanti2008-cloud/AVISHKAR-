"""Individual Residential Home Configuration & Profile Engine for AVISHKAR.

Supports standalone residential energy management with or without community participation.
Provides strict validation, serialization, and reproducible demo configurations.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any


class OptimizationGoal(StrEnum):
    """User-selected residential energy optimization objective."""
    MINIMIZE_BILLS = "MINIMIZE_BILLS"
    MAXIMIZE_SELF_CONSUMPTION = "MAXIMIZE_SELF_CONSUMPTION"
    REDUCE_GRID_IMPORTS = "REDUCE_GRID_IMPORTS"
    PRESERVE_BACKUP_RESERVE = "PRESERVE_BACKUP_RESERVE"


class MeasurementMode(StrEnum):
    """Data honesty status indicator for home telemetry and calculations."""
    SIMULATION = "SIMULATION"
    USER_ENTERED = "USER_ENTERED"
    HARDWARE_MEASURED = "HARDWARE_MEASURED"


class EVChargingPreference(StrEnum):
    """EV Charging mode preference."""
    OFF = "OFF"
    SOLAR_ONLY = "SOLAR_ONLY"
    MIN_PLUS_SOLAR = "MIN_PLUS_SOLAR"
    FAST = "FAST"


@dataclass
class FlexibleApplianceConfig:
    """Schedulable household appliance."""
    appliance_id: str
    name: str
    nominal_power_kw: float
    required_runtime_hours: float = 1.5
    window_start_hour: int = 8
    window_end_hour: int = 18
    priority: int = 1  # 1 = highest, 5 = lowest
    is_controllable: bool = True

    def validate(self) -> None:
        if self.nominal_power_kw <= 0.0:
            raise ValueError(f"Appliance {self.name}: power must be positive (> 0 kW)")
        if self.required_runtime_hours <= 0.0 or self.required_runtime_hours > 24.0:
            raise ValueError(f"Appliance {self.name}: runtime must be between 0 and 24 hours")
        if not (0 <= self.window_start_hour <= 23) or not (0 <= self.window_end_hour <= 24):
            raise ValueError(f"Appliance {self.name}: operating window hours must be between 0 and 24")
        if self.window_start_hour >= self.window_end_hour:
            raise ValueError(f"Appliance {self.name}: window_start_hour must precede window_end_hour")


@dataclass
class EVChargerConfig:
    """Residential EV Charger specification."""
    is_connected: bool = False
    battery_capacity_kwh: float = 30.0
    current_soc_pct: float = 40.0
    target_soc_pct: float = 80.0
    max_charge_power_kw: float = 7.4
    departure_hour: int = 18
    charging_preference: EVChargingPreference = EVChargingPreference.SOLAR_ONLY
    is_verified_hardware: bool = False

    def validate(self) -> None:
        if self.is_connected:
            if self.battery_capacity_kwh <= 0.0:
                raise ValueError("EV battery capacity must be positive (> 0 kWh)")
            if not (0.0 <= self.current_soc_pct <= 100.0):
                raise ValueError("EV current SoC must be between 0% and 100%")
            if not (0.0 <= self.target_soc_pct <= 100.0):
                raise ValueError("EV target SoC must be between 0% and 100%")
            if self.max_charge_power_kw <= 0.0:
                raise ValueError("EV max charging power must be positive (> 0 kW)")
            if not (0 <= self.departure_hour <= 24):
                raise ValueError("EV departure hour must be between 0 and 24")


@dataclass
class InverterConfig:
    """Residential solar inverter parameters."""
    brand: str = "GENERIC"
    rating_kw: float = 5.0
    efficiency_fraction: float = 0.97
    is_zero_export_enforced: bool = False
    is_verified_hardware: bool = False

    def validate(self) -> None:
        if self.rating_kw <= 0.0:
            raise ValueError("Inverter rating must be positive (> 0 kW)")
        if not (0.80 <= self.efficiency_fraction <= 1.0):
            raise ValueError("Inverter efficiency must be between 0.80 and 1.00")


@dataclass
class BatteryConfig:
    """Residential battery energy storage parameters."""
    capacity_kwh: float = 10.0
    current_soc_pct: float = 50.0
    min_soc_pct: float = 15.0
    max_soc_pct: float = 95.0
    max_charge_power_kw: float = 3.3
    max_discharge_power_kw: float = 3.3
    charge_efficiency: float = 0.95
    discharge_efficiency: float = 0.95
    preferred_backup_reserve_pct: float = 25.0
    is_verified_hardware: bool = False
    #: What the cells are, as the owner states it from the datasheet: "LFP", "NMC", "Lead-acid".
    #: It defaults to NOT_STATED rather than to a common chemistry, because guessing one would be
    #: claiming something about somebody's battery that nobody has said. Nothing in the engine reads
    #: it: no depth-of-discharge or cycle life is inferred from it. It is shown so the owner can see
    #: what AVISHKAR holds about their equipment.
    chemistry: str = "NOT_STATED"

    def validate(self) -> None:
        if self.capacity_kwh < 0.0:
            raise ValueError("Battery capacity cannot be negative")
        if self.capacity_kwh > 0.0:
            if not (0.0 <= self.min_soc_pct < self.max_soc_pct <= 100.0):
                raise ValueError("Battery SoC limits must satisfy: 0 <= min_soc < max_soc <= 100")
            if not (0.0 <= self.current_soc_pct <= 100.0):
                raise ValueError("Current SoC must be between 0% and 100%")
            if self.max_charge_power_kw <= 0.0 or self.max_discharge_power_kw <= 0.0:
                raise ValueError("Charge and discharge power limits must be positive")
            if not (0.50 <= self.charge_efficiency <= 1.0) or not (0.50 <= self.discharge_efficiency <= 1.0):
                raise ValueError("Battery charge/discharge efficiencies must be between 0.50 and 1.00")
            if not (self.min_soc_pct <= self.preferred_backup_reserve_pct <= self.max_soc_pct):
                raise ValueError("Preferred backup reserve must be between min_soc and max_soc")


@dataclass
class HomeProfile:
    """Comprehensive Individual Residential Home Profile."""
    home_id: str
    home_name: str
    location: str = "New Delhi, India"
    solar_capacity_kw: float = 5.0
    inverter: InverterConfig = field(default_factory=InverterConfig)
    battery: BatteryConfig = field(default_factory=BatteryConfig)
    ev_charger: EVChargerConfig = field(default_factory=EVChargerConfig)
    flexible_appliances: list[FlexibleApplianceConfig] = field(default_factory=list)
    grid_purchase_tariff_inr: float = 7.50
    grid_export_tariff_inr: float = 3.00
    optimization_goal: OptimizationGoal = OptimizationGoal.MINIMIZE_BILLS
    community_opt_in: bool = False  # Individual homes operate standalone by default
    measurement_mode: MeasurementMode = MeasurementMode.SIMULATION

    def validate(self) -> None:
        """Validates all numeric parameters and physical bounds."""
        if not self.home_name.strip():
            raise ValueError("Home name cannot be empty")
        if self.solar_capacity_kw < 0.0:
            raise ValueError("Solar capacity cannot be negative")
        if self.grid_purchase_tariff_inr <= 0.0:
            raise ValueError("Grid purchase tariff must be positive (> 0 INR/kWh)")
        if self.grid_export_tariff_inr < 0.0:
            raise ValueError("Grid export tariff cannot be negative (>= 0 INR/kWh)")

        self.inverter.validate()
        self.battery.validate()
        self.ev_charger.validate()
        for app in self.flexible_appliances:
            app.validate()

    def to_dict(self) -> dict[str, Any]:
        """Serializes configuration to dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HomeProfile:
        """Deserializes configuration from dictionary with type reconstruction."""
        d = data.copy()
        inv_data = d.get("inverter", {})
        batt_data = d.get("battery", {})
        ev_data = d.get("ev_charger", {})
        apps_data = d.get("flexible_appliances", [])

        inverter = InverterConfig(**inv_data) if isinstance(inv_data, dict) else inv_data
        battery = BatteryConfig(**batt_data) if isinstance(batt_data, dict) else batt_data
        ev_charger = EVChargerConfig(**ev_data) if isinstance(ev_data, dict) else ev_data

        appliances = [
            FlexibleApplianceConfig(**a) if isinstance(a, dict) else a
            for a in apps_data
        ]

        d["inverter"] = inverter
        d["battery"] = battery
        d["ev_charger"] = ev_charger
        d["flexible_appliances"] = appliances
        d["optimization_goal"] = OptimizationGoal(d.get("optimization_goal", OptimizationGoal.MINIMIZE_BILLS))
        d["measurement_mode"] = MeasurementMode(d.get("measurement_mode", MeasurementMode.SIMULATION))

        profile = cls(**d)
        profile.validate()
        return profile

    def save_to_file(self, filepath: Path | str) -> None:
        """Persists profile to local JSON file."""
        p = Path(filepath)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load_from_file(cls, filepath: Path | str) -> HomeProfile:
        """Loads profile from local JSON file."""
        with open(filepath, encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)

    @classmethod
    def create_phase7_demo_home(cls) -> HomeProfile:
        """Reproducible individual home configuration matching Phase 7 prompt specifications.

        Specs:
        - Solar capacity: 5 kW
        - Battery capacity: 10 kWh
        - Initial battery SoC: 60%
        - Electricity purchase price: ₹8/kWh
        - Electricity export price: ₹3/kWh
        """
        return cls(
            home_id="phase7_demo_home",
            home_name="Phase 7 Benchmark Home",
            location="Vasant Kunj, New Delhi",
            solar_capacity_kw=5.0,
            inverter=InverterConfig(
                brand="VICTRON",
                rating_kw=5.0,
                efficiency_fraction=0.97,
                is_zero_export_enforced=False,
            ),
            battery=BatteryConfig(
                capacity_kwh=10.0,
                current_soc_pct=60.0,
                min_soc_pct=15.0,
                max_soc_pct=95.0,
                max_charge_power_kw=3.5,
                max_discharge_power_kw=3.5,
                charge_efficiency=0.95,
                discharge_efficiency=0.95,
                preferred_backup_reserve_pct=25.0,
            ),
            ev_charger=EVChargerConfig(
                is_connected=True,
                battery_capacity_kwh=24.0,
                current_soc_pct=50.0,
                target_soc_pct=80.0,
                max_charge_power_kw=3.3,
                departure_hour=19,
                charging_preference=EVChargingPreference.SOLAR_ONLY,
            ),
            flexible_appliances=[
                FlexibleApplianceConfig(
                    appliance_id="washing_machine",
                    name="Smart Washing Machine",
                    nominal_power_kw=1.0,
                    required_runtime_hours=1.5,
                    window_start_hour=10,
                    window_end_hour=16,
                    priority=2,
                ),
                FlexibleApplianceConfig(
                    appliance_id="heat_pump_water",
                    name="Immersion Water Heater",
                    nominal_power_kw=1.5,
                    required_runtime_hours=2.0,
                    window_start_hour=11,
                    window_end_hour=15,
                    priority=1,
                ),
            ],
            grid_purchase_tariff_inr=8.00,
            grid_export_tariff_inr=3.00,
            optimization_goal=OptimizationGoal.MINIMIZE_BILLS,
            community_opt_in=False,
            measurement_mode=MeasurementMode.SIMULATION,
        )
