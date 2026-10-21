"""Distribution Transformer (DT) Thermal & Reverse Power Protection Shield.

Protects Indian 11kV / 415V neighborhood distribution transformers from thermal burnout
and high-voltage tripping caused by simultaneous midday solar export.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class TransformerRating:
    """Distribution transformer electrical and thermal nameplate limits."""
    dt_id: str
    rated_kva: float
    voltage_primary_v: float       # 11,000 V
    voltage_secondary_v: float     # 415 V (3-Phase) / 230 V (1-Phase)
    max_continuous_reverse_kw: float
    safe_thermal_threshold_pct: float  # e.g. 80.0%


STANDARD_DISTRIBUTION_TRANSFORMERS: Dict[str, TransformerRating] = {
    "dt_100kva": TransformerRating(
        dt_id="DT-100KVA-RESIDENTIAL",
        rated_kva=100.0,
        voltage_primary_v=11000.0,
        voltage_secondary_v=415.0,
        max_continuous_reverse_kw=80.0,
        safe_thermal_threshold_pct=80.0,
    ),
    "dt_250kva": TransformerRating(
        dt_id="DT-250KVA-COMMUNITY",
        rated_kva=250.0,
        voltage_primary_v=11000.0,
        voltage_secondary_v=415.0,
        max_continuous_reverse_kw=200.0,
        safe_thermal_threshold_pct=80.0,
    ),
    "dt_500kva": TransformerRating(
        dt_id="DT-500KVA-COMMERCIAL",
        rated_kva=500.0,
        voltage_primary_v=11000.0,
        voltage_secondary_v=415.0,
        max_continuous_reverse_kw=400.0,
        safe_thermal_threshold_pct=80.0,
    ),
}


@dataclass
class FeederGuardStatus:
    """Real-time feeder health and coordinated microgrid curtailment advisory."""
    transformer_id: str
    rated_capacity_kva: float
    total_rooftop_generation_kw: float
    local_base_load_kw: float
    net_feeder_flow_kw: float
    feeder_direction: str       # "FORWARD_IMPORT" or "REVERSE_EXPORT"
    transformer_loading_pct: float
    thermal_status: str         # "SAFE_GREEN", "WARNING_AMBER", "CRITICAL_RED"
    curtailment_required_kw: float
    battery_absorption_target_kw: float
    feeder_voltage_estimated_v: float
    recommendation: str


def evaluate_feeder_transformer_health(
    transformer_type: str,
    total_rooftop_pv_kw: float,
    local_load_kw: float,
    community_bess_available_kw: float = 25.0,
) -> FeederGuardStatus:
    """Evaluates neighborhood transformer loading and coordinates battery soaking."""
    dt = STANDARD_DISTRIBUTION_TRANSFORMERS.get(transformer_type, STANDARD_DISTRIBUTION_TRANSFORMERS["dt_100kva"])

    net_flow = total_rooftop_pv_kw - local_load_kw
    direction = "REVERSE_EXPORT" if net_flow > 0 else "FORWARD_IMPORT"
    abs_flow = abs(net_flow)

    loading_pct = (abs_flow / dt.rated_kva) * 100.0

    # Over-voltage voltage rise approximation: V_rise ~ P * R / V
    nominal_v = 230.0
    v_rise = (net_flow / dt.rated_kva) * 14.0 if direction == "REVERSE_EXPORT" else 0.0
    est_voltage = round(nominal_v + v_rise, 1)

    curtailment = 0.0
    battery_absorption = 0.0

    if loading_pct > dt.safe_thermal_threshold_pct and direction == "REVERSE_EXPORT":
        excess_kw = abs_flow - (dt.rated_kva * dt.safe_thermal_threshold_pct / 100.0)
        battery_absorption = min(excess_kw, community_bess_available_kw)
        curtailment = max(0.0, excess_kw - battery_absorption)
        thermal_status = "CRITICAL_RED" if loading_pct > 95.0 else "WARNING_AMBER"
        rec = f"Divert {battery_absorption:.1f} kW into local batteries to prevent transformer thermal trip."
    else:
        thermal_status = "SAFE_GREEN"
        rec = "Feeder operating within safe CEA thermal limits. No curtailment required."

    return FeederGuardStatus(
        transformer_id=dt.dt_id,
        rated_capacity_kva=dt.rated_kva,
        total_rooftop_generation_kw=round(total_rooftop_pv_kw, 1),
        local_base_load_kw=round(local_load_kw, 1),
        net_feeder_flow_kw=round(net_flow, 1),
        feeder_direction=direction,
        transformer_loading_pct=round(loading_pct, 1),
        thermal_status=thermal_status,
        curtailment_required_kw=round(curtailment, 1),
        battery_absorption_target_kw=round(battery_absorption, 1),
        feeder_voltage_estimated_v=est_voltage,
        recommendation=rec,
    )
