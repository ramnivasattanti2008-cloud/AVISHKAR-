"""BEE Carbon Credit Trading Scheme (CCTS) & Green Energy Certification for UrjaSetu EMS.

Grounds clean energy carbon accounting in the official Central Electricity Authority (CEA)
CO2 Baseline Database for the Indian Power Sector (Version 19 / 2024-2026):
- National Grid Weighted Average Emission Factor: 0.716 kg CO2 / kWh
- Avoided Indian Thermal Coal Combustion: ~0.52 kg Coal / kWh
- Tree Absorption Equivalence: 1 mature tree absorbs ~21.77 kg CO2 / year
- Carbon Credit Unit (CCC): 1 Metric Ton CO2 equivalent under BEE CCTS
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

# Central Electricity Authority (CEA) National Grid Baseline
CEA_GRID_EMISSION_FACTOR_KG_PER_KWH = 0.716
COAL_DISPLACED_KG_PER_KWH = 0.52
TREE_ABSORPTION_KG_CO2_YEAR = 21.77
DEFAULT_CARBON_CREDIT_PRICE_INR = 1200.0  # Approx. ₹1,200 per 1 ton CO2 in Indian Carbon Market (CCTS)


@dataclass
class CarbonCreditReport:
    """Verifiable environmental impact and monetized carbon credit report."""
    clean_energy_generated_kwh: float
    avoided_co2_kg: float
    avoided_co2_metric_tons: float
    avoided_coal_kg: float
    equivalent_trees_planted: int
    carbon_credit_certificates: float   # 1 CCC = 1 Ton CO2
    estimated_credit_value_inr: float
    verification_standard: str
    certificate_hash: str
    issuance_date: str


def compute_carbon_credits(
    clean_solar_kwh: float,
    carbon_price_per_ton_inr: float = DEFAULT_CARBON_CREDIT_PRICE_INR,
    site_id: str = "urjasetu-site-01",
) -> CarbonCreditReport:
    """Calculates official avoided carbon emissions and carbon credit value."""
    kwh = max(0.0, float(clean_solar_kwh))
    co2_kg = kwh * CEA_GRID_EMISSION_FACTOR_KG_PER_KWH
    co2_tons = co2_kg / 1000.0
    coal_kg = kwh * COAL_DISPLACED_KG_PER_KWH
    trees = int(co2_kg / TREE_ABSORPTION_KG_CO2_YEAR)
    credits = round(co2_tons, 3)
    val_inr = round(credits * float(carbon_price_per_ton_inr), 2)

    hasher = hashlib.sha256()
    hasher.update(f"{site_id}-{kwh}-{time.time()}".encode())
    cert_hash = f"BEE-CCTS-{hasher.hexdigest()[:18].upper()}"

    return CarbonCreditReport(
        clean_energy_generated_kwh=round(kwh, 1),
        avoided_co2_kg=round(co2_kg, 1),
        avoided_co2_metric_tons=round(co2_tons, 3),
        avoided_coal_kg=round(coal_kg, 1),
        equivalent_trees_planted=trees,
        carbon_credit_certificates=credits,
        estimated_credit_value_inr=val_inr,
        verification_standard="BEE Carbon Credit Trading Scheme (CCTS) / CEA Baseline Database",
        certificate_hash=cert_hash,
        issuance_date=time.strftime("%Y-%m-%d"),
    )
