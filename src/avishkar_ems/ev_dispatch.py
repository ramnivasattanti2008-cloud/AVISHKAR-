"""Vehicle-to-Home (V2H) & Bidirectional EV Smart Dispatch for UrjaSetu EMS.

Leverages India's booming Electric 2-Wheeler (Ola, Ather) and 4-Wheeler (Tata Nexon EV)
fleets as flexible distributed battery storage systems.
- Midday Solar Soaking: Charges EV battery at zero grid cost during 11:00-15:00.
- Evening V2H Peak Shaving: Discharges stored energy into the home during 18:00-22:00 (avoiding ₹10/unit peak tariffs).
- Commute Protection: Never discharges below the owner's configured morning driving reserve.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EVVehicleSpec:
    """EV battery and charging specifications."""
    model_name: str
    category: str               # "2-Wheeler" or "4-Wheeler"
    battery_capacity_kwh: float
    max_charge_kw: float
    max_v2h_discharge_kw: float
    round_trip_efficiency: float
    typical_range_km: float


INDIAN_EV_MODELS: dict[str, EVVehicleSpec] = {
    "tata_nexon_ev": EVVehicleSpec(
        model_name="Tata Nexon EV (Long Range)",
        category="4-Wheeler",
        battery_capacity_kwh=40.5,
        max_charge_kw=7.2,
        max_v2h_discharge_kw=3.3,
        round_trip_efficiency=0.88,
        typical_range_km=325.0,
    ),
    "ola_s1_pro": EVVehicleSpec(
        model_name="Ola S1 Pro (Gen 2)",
        category="2-Wheeler",
        battery_capacity_kwh=4.0,
        max_charge_kw=1.2,
        max_v2h_discharge_kw=0.8,
        round_trip_efficiency=0.90,
        typical_range_km=140.0,
    ),
    "ather_450x": EVVehicleSpec(
        model_name="Ather 450X (Apex)",
        category="2-Wheeler",
        battery_capacity_kwh=3.7,
        max_charge_kw=1.0,
        max_v2h_discharge_kw=0.7,
        round_trip_efficiency=0.90,
        typical_range_km=110.0,
    ),
    "tata_tiago_ev": EVVehicleSpec(
        model_name="Tata Tiago EV",
        category="4-Wheeler",
        battery_capacity_kwh=24.0,
        max_charge_kw=3.3,
        max_v2h_discharge_kw=2.0,
        round_trip_efficiency=0.88,
        typical_range_km=210.0,
    ),
}


@dataclass
class V2HDispatchPlan:
    """Optimized EV bidirectional charging and peak-shaving dispatch result."""
    vehicle_name: str
    current_soc_pct: float
    commute_reserve_soc_pct: float
    usable_v2h_energy_kwh: float
    peak_hours_duration: float
    discharge_power_kw: float
    peak_tariff_avoided_rs_kwh: float
    daily_rupee_savings_inr: float
    monthly_rupee_savings_inr: float
    remaining_range_km: float
    ocpp_charging_action: str


def compute_v2h_dispatch(
    vehicle_key: str,
    current_soc_pct: float,
    commute_reserve_soc_pct: float = 50.0,
    peak_tariff_rs: float = 10.0,
    solar_opportunity_cost_rs: float = 3.0,
    home_evening_load_kw: float = 1.5,
) -> V2HDispatchPlan:
    """Computes optimal V2H discharge and rupee savings for an Indian household."""
    ev = INDIAN_EV_MODELS.get(vehicle_key, INDIAN_EV_MODELS["tata_nexon_ev"])

    current_soc = max(10.0, min(100.0, float(current_soc_pct)))
    reserve_soc = max(20.0, min(80.0, float(commute_reserve_soc_pct)))

    # Usable energy above commute reserve
    surplus_soc_pct = max(0.0, current_soc - reserve_soc)
    usable_kwh = (surplus_soc_pct / 100.0) * ev.battery_capacity_kwh * ev.round_trip_efficiency

    # 4-hour evening peak window (18:00 - 22:00)
    peak_hours = 4.0
    desired_power_kw = min(home_evening_load_kw, ev.max_v2h_discharge_kw)
    actual_discharged_kwh = min(usable_kwh, desired_power_kw * peak_hours)

    net_margin_per_kwh = max(1.0, peak_tariff_rs - solar_opportunity_cost_rs)
    daily_savings = actual_discharged_kwh * net_margin_per_kwh
    monthly_savings = daily_savings * 30.0

    # Remaining range after V2H discharge
    final_soc = current_soc - (actual_discharged_kwh / ev.battery_capacity_kwh / ev.round_trip_efficiency * 100.0)
    remaining_range = (final_soc / 100.0) * ev.typical_range_km

    action = "V2H_DISCHARGE_ACTIVE" if actual_discharged_kwh > 0.5 else "IDLE_PRESERVE_COMMUTE"

    return V2HDispatchPlan(
        vehicle_name=ev.model_name,
        current_soc_pct=round(current_soc, 1),
        commute_reserve_soc_pct=round(reserve_soc, 1),
        usable_v2h_energy_kwh=round(actual_discharged_kwh, 2),
        peak_hours_duration=peak_hours,
        discharge_power_kw=round(min(desired_power_kw, actual_discharged_kwh / peak_hours), 2) if actual_discharged_kwh > 0 else 0.0,
        peak_tariff_avoided_rs_kwh=round(peak_tariff_rs, 2),
        daily_rupee_savings_inr=round(daily_savings, 1),
        monthly_rupee_savings_inr=round(monthly_savings, 0),
        remaining_range_km=round(remaining_range, 1),
        ocpp_charging_action=action,
    )
