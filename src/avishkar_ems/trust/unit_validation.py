"""Strict Unit Validation and Conversion Engine for UrjaSetu EMS.

Enforces physical dimension rigor across power, energy, capacity, and ratios.
Strict invariants:
1. Distinguish Power (kW, MW, GW) from Energy (kWh, MWh, GWh, MU).
2. Distinguish Installed Capacity (kWp, MW) from Generated Energy (kWh, MU).
3. Never convert power to energy without a valid duration interval.
4. Never compute a solar share % using capacity as numerator and energy as denominator.
5. Reject incompatible units with informative, traceable exceptions.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class UnitDimension(StrEnum):
    POWER = "POWER"  # Rate of energy transfer: W, kW, MW, GW
    ENERGY = "ENERGY"  # Quantity of energy: Wh, kWh, MWh, GWh, MU
    CAPACITY = "CAPACITY"  # Installed rating: kWp, MWp, MW
    PERCENTAGE = "PERCENTAGE"  # Dimensionless ratio: %, fraction
    CURRENCY = "CURRENCY"  # INR (₹)
    TIME = "TIME"  # Minutes, Hours, Days


# Canonical conversion factors to base units:
# Base for ENERGY: kWh (1 MU = 1,000,000 kWh; 1 GWh = 1,000,000 kWh; 1 MWh = 1,000 kWh)
# Base for POWER: kW (1 GW = 1,000,000 kW; 1 MW = 1,000 kW; 1 W = 0.001 kW)
# Base for CAPACITY: MW (1 kWp = 0.001 MW; 1 GW = 1,000 MW)
ENERGY_TO_KWH: dict[str, float] = {
    "WH": 0.001,
    "KWH": 1.0,
    "MWH": 1_000.0,
    "GWH": 1_000_000.0,
    "MU": 1_000_000.0,  # Million Units in India = 1 GWh
}

POWER_TO_KW: dict[str, float] = {
    "W": 0.001,
    "KW": 1.0,
    "MW": 1_000.0,
    "GW": 1_000_000.0,
}

CAPACITY_TO_MW: dict[str, float] = {
    "KWP": 0.001,
    "KW": 0.001,
    "MW": 1.0,
    "MWP": 1.0,
    "GW": 1_000.0,
}


def get_dimension(unit: str) -> UnitDimension:
    u = unit.strip().upper()
    if u in ENERGY_TO_KWH:
        return UnitDimension.ENERGY
    if u in POWER_TO_KW:
        return UnitDimension.POWER
    if u in {"KWP", "MWP"}:
        return UnitDimension.CAPACITY
    if u in {"%", "PCT", "PERCENT", "FRACTION"}:
        return UnitDimension.PERCENTAGE
    if u in {"INR", "RS", "RUPEES"}:
        return UnitDimension.CURRENCY
    raise ValueError(f"Unknown or unsupported measurement unit: '{unit}'")


def convert_energy(value: float, from_unit: str, to_unit: str) -> float:
    """Converts energy between Wh, kWh, MWh, GWh, and MU."""
    f = from_unit.strip().upper()
    t = to_unit.strip().upper()
    if f not in ENERGY_TO_KWH:
        raise ValueError(f"'{from_unit}' is not a recognized energy unit. Cannot convert to {to_unit}.")
    if t not in ENERGY_TO_KWH:
        raise ValueError(f"'{to_unit}' is not a recognized energy unit. Cannot convert from {from_unit}.")

    kwh_val = value * ENERGY_TO_KWH[f]
    return kwh_val / ENERGY_TO_KWH[t]


def convert_power(value: float, from_unit: str, to_unit: str) -> float:
    """Converts power between W, kW, MW, and GW."""
    f = from_unit.strip().upper()
    t = to_unit.strip().upper()
    if f not in POWER_TO_KW:
        raise ValueError(f"'{from_unit}' is not a recognized power unit. Cannot convert to {to_unit}.")
    if t not in POWER_TO_KW:
        raise ValueError(f"'{to_unit}' is not a recognized power unit. Cannot convert from {from_unit}.")

    kw_val = value * POWER_TO_KW[f]
    return kw_val / POWER_TO_KW[t]


def power_to_energy(power_value: float, power_unit: str, interval_minutes: float, target_energy_unit: str = "kWh") -> float:
    """Converts power to energy over an explicit time interval.

    Strict invariant: Never convert power to energy without valid interval_minutes.
    """
    if interval_minutes <= 0:
        raise ValueError(f"Interval duration must be positive (received {interval_minutes} minutes).")

    dim = get_dimension(power_unit)
    if dim != UnitDimension.POWER and dim != UnitDimension.CAPACITY:
        raise ValueError(f"Input '{power_unit}' is not a power/capacity dimension (detected {dim.value}).")

    kw = convert_power(power_value, power_unit, "kW")
    kwh = kw * (interval_minutes / 60.0)
    return convert_energy(kwh, "kWh", target_energy_unit)


def compute_solar_share_percentage(
    solar_generation: float,
    solar_unit: str,
    total_generation: float,
    total_unit: str,
) -> float:
    """Computes Solar Share = (Solar Gen / Total Gen) * 100.

    Strict invariant: Rejects using installed capacity as numerator or denominator.
    """
    dim_num = get_dimension(solar_unit)
    dim_den = get_dimension(total_unit)

    if dim_num != UnitDimension.ENERGY:
        raise TypeError(
            f"UNIT VIOLATION: Solar share numerator must be generated ENERGY, but received unit '{solar_unit}' "
            f"of dimension '{dim_num.value}'. Installed capacity (MW/kWp) cannot be used as a generation figure."
        )

    if dim_den != UnitDimension.ENERGY:
        raise TypeError(
            f"UNIT VIOLATION: Solar share denominator must be total generated ENERGY, but received unit '{total_unit}' "
            f"of dimension '{dim_den.value}'. Installed capacity (MW) cannot be used as total generation."
        )

    if total_generation <= 0:
        return 0.0

    # Normalize both to kWh for exact comparison
    num_kwh = convert_energy(solar_generation, solar_unit, "kWh")
    den_kwh = convert_energy(total_generation, total_unit, "kWh")

    if num_kwh > den_kwh * 1.05:  # Allow 5% tolerance for rounding/reporting artifacts
        raise ValueError(
            f"PHYSICAL IMPOSSIBILITY: Solar generation ({solar_generation} {solar_unit}) exceeds total generation ({total_generation} {total_unit})."
        )

    return round((num_kwh / den_kwh) * 100, 2)


# Alias
UnitCategory = UnitDimension


@dataclass(frozen=True)
class UnitDefinition:
    symbol: str
    category: UnitDimension
    description: str


UNIT_REGISTRY: dict[str, UnitDefinition] = {
    "W": UnitDefinition("W", UnitDimension.POWER, "Watt"),
    "KW": UnitDefinition("kW", UnitDimension.POWER, "Kilowatt"),
    "MW": UnitDefinition("MW", UnitDimension.POWER, "Megawatt"),
    "GW": UnitDefinition("GW", UnitDimension.POWER, "Gigawatt"),
    "WH": UnitDefinition("Wh", UnitDimension.ENERGY, "Watt-hour"),
    "KWH": UnitDefinition("kWh", UnitDimension.ENERGY, "Kilowatt-hour"),
    "MWH": UnitDefinition("MWh", UnitDimension.ENERGY, "Megawatt-hour"),
    "GWH": UnitDefinition("GWh", UnitDimension.ENERGY, "Gigawatt-hour"),
    "MU": UnitDefinition("MU", UnitDimension.ENERGY, "Million Units (1 GWh)"),
    "KWP": UnitDefinition("kWp", UnitDimension.CAPACITY, "Kilowatt-peak"),
    "MWP": UnitDefinition("MWp", UnitDimension.CAPACITY, "Megawatt-peak"),
    "%": UnitDefinition("%", UnitDimension.PERCENTAGE, "Percentage"),
    "INR": UnitDefinition("INR", UnitDimension.CURRENCY, "Indian Rupee"),
}


class UnitValidator:
    """Validates measurement units and queries physical categories."""

    @staticmethod
    def is_valid_unit(unit: str) -> bool:
        try:
            get_dimension(unit)
            return True
        except ValueError:
            return False

    @staticmethod
    def get_category(unit: str) -> UnitDimension:
        return get_dimension(unit)


def convert_units(value: float, from_unit: str, to_unit: str) -> float:
    """Converts value between compatible units within the same dimension."""
    dim_from = get_dimension(from_unit)
    dim_to = get_dimension(to_unit)
    if dim_from != dim_to:
        raise TypeError(
            f"Cannot convert between incompatible unit categories: '{from_unit}' ({dim_from.value}) and '{to_unit}' ({dim_to.value})."
        )
    if dim_from == UnitDimension.POWER:
        return convert_power(value, from_unit, to_unit)
    if dim_from == UnitDimension.ENERGY:
        return convert_energy(value, from_unit, to_unit)
    if dim_from == UnitDimension.CAPACITY:
        f = from_unit.strip().upper()
        t = to_unit.strip().upper()
        mw = value * CAPACITY_TO_MW[f]
        return mw / CAPACITY_TO_MW[t]
    return value


def convert_power_to_energy(
    power_value: float,
    power_unit: str,
    duration_hours: float,
    target_energy_unit: str = "kWh",
) -> float:
    """Explicitly converts power flow to accumulated energy over duration_hours."""
    if duration_hours <= 0:
        raise ValueError("Duration in hours must be strictly positive.")
    dim = get_dimension(power_unit)
    if dim != UnitDimension.POWER:
        raise TypeError(f"Power value must be in POWER category (received {power_unit} of dimension {dim.value}).")
    kw = convert_power(power_value, power_unit, "kW")
    kwh = kw * duration_hours
    return convert_energy(kwh, "kWh", target_energy_unit)


def validate_solar_share_denominator(num_unit: str, den_unit: str) -> bool:
    """Verifies that the denominator for solar share is in the ENERGY category."""
    dim_den = get_dimension(den_unit)
    if dim_den != UnitDimension.ENERGY:
        raise TypeError(
            f"Solar share denominator must be in ENERGY category (received {den_unit} of dimension {dim_den.value})."
        )
    return True
