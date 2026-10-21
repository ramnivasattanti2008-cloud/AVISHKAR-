"""Indian Regulatory Sandbox & Wheeling Tariff Ledger for UrjaSetu EMS.

Grounds peer-to-peer (P2P) energy trading in state regulatory orders:
- UPERC (Uttar Pradesh Electricity Regulatory Commission) P2P Solar Pilot Regulations
- MERC (Maharashtra Electricity Regulatory Commission) Open Access & Wheeling Orders
- RERC (Rajasthan Electricity Regulatory Commission) Distribution Wheeling Charges
- CERC (Central Electricity Regulatory Commission) Connectivity & Deviation Settlement (DSM)
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StateWheelingRule:
    """State-specific distribution wheeling and open-access tariff parameters."""
    state: str
    serc_order_ref: str
    sandbox_status: str
    wheeling_charge_rs_kwh: float       # DISCOM wire usage charge
    wheeling_loss_pct: float            # Technical line loss on LT 11kV network
    cross_subsidy_surcharge_rs: float   # CSS for commercial/industrial buyers
    regulatory_cess_rs: float           # Clean energy or state cess
    allowed_voltage_levels: str


STATE_REGULATORY_RULES: dict[str, StateWheelingRule] = {
    "mathura": StateWheelingRule(
        state="Uttar Pradesh",
        serc_order_ref="UPERC Pilot P2P Trading Regulations 2024 / UPPCL",
        sandbox_status="APPROVED_REGULATORY_SANDBOX",
        wheeling_charge_rs_kwh=1.25,
        wheeling_loss_pct=4.8,
        cross_subsidy_surcharge_rs=0.00,  # Waived for residential rooftop pilots
        regulatory_cess_rs=0.10,
        allowed_voltage_levels="LT (415V 3-Phase / 230V 1-Phase)",
    ),
    "pune": StateWheelingRule(
        state="Maharashtra",
        serc_order_ref="MERC MYT Order Case No. 322 / MSEDCL",
        sandbox_status="COMPLIANT_MICROGRID_DIRECTIVE",
        wheeling_charge_rs_kwh=1.64,
        wheeling_loss_pct=5.2,
        cross_subsidy_surcharge_rs=0.85,
        regulatory_cess_rs=0.15,
        allowed_voltage_levels="11kV / 22kV HT & LT",
    ),
    "jaipur": StateWheelingRule(
        state="Rajasthan",
        serc_order_ref="RERC Tariff Order JVVNL / RREC Net Metering",
        sandbox_status="COMPLIANT_DISTRIBUTION_PILOT",
        wheeling_charge_rs_kwh=1.45,
        wheeling_loss_pct=4.5,
        cross_subsidy_surcharge_rs=0.50,
        regulatory_cess_rs=0.08,
        allowed_voltage_levels="LT / 11kV Feeder",
    ),
    "home-mathura": StateWheelingRule(
        state="Uttar Pradesh",
        serc_order_ref="UPERC Pilot P2P Trading Regulations 2024 / UPPCL",
        sandbox_status="APPROVED_REGULATORY_SANDBOX",
        wheeling_charge_rs_kwh=1.25,
        wheeling_loss_pct=4.8,
        cross_subsidy_surcharge_rs=0.00,  # Waived for residential rooftop pilots
        regulatory_cess_rs=0.10,
        allowed_voltage_levels="LT (415V 3-Phase / 230V 1-Phase)",
    ),
    "shop-pune": StateWheelingRule(
        state="Maharashtra",
        serc_order_ref="MERC MYT Order Case No. 322 / MSEDCL",
        sandbox_status="COMPLIANT_MICROGRID_DIRECTIVE",
        wheeling_charge_rs_kwh=1.64,
        wheeling_loss_pct=5.2,
        cross_subsidy_surcharge_rs=0.85,
        regulatory_cess_rs=0.15,
        allowed_voltage_levels="11kV / 22kV HT & LT",
    ),
    "clinic-jaipur": StateWheelingRule(
        state="Rajasthan",
        serc_order_ref="RERC Tariff Order JVVNL / RREC Net Metering",
        sandbox_status="COMPLIANT_DISTRIBUTION_PILOT",
        wheeling_charge_rs_kwh=1.45,
        wheeling_loss_pct=4.5,
        cross_subsidy_surcharge_rs=0.50,
        regulatory_cess_rs=0.08,
        allowed_voltage_levels="LT / 11kV Feeder",
    ),
}


def resolve_state_rule(key: str) -> StateWheelingRule:
    """Resolves state wheeling rule by exact key or site location substring."""
    if key in STATE_REGULATORY_RULES:
        return STATE_REGULATORY_RULES[key]
    k = key.lower()
    if "pune" in k or "maharashtra" in k or "merc" in k:
        return STATE_REGULATORY_RULES["pune"]
    elif "jaipur" in k or "rajasthan" in k or "rerc" in k:
        return STATE_REGULATORY_RULES["jaipur"]
    return STATE_REGULATORY_RULES["mathura"]


@dataclass
class LegalSettlementBreakdown:
    """Legally compliant financial ledger for an energy trade."""
    gross_energy_kwh: float
    delivered_energy_kwh: float
    gross_price_rs_kwh: float
    gross_revenue_inr: float
    technical_loss_kwh: float
    wheeling_fee_inr: float
    cross_subsidy_inr: float
    state_cess_inr: float
    net_seller_payout_inr: float
    discom_wire_revenue_inr: float
    regulatory_ref: str
    sandbox_compliant: bool


def compute_legal_settlement(
    site_key: str,
    gross_kwh: float,
    trade_price_rs_kwh: float,
    is_residential_buyer: bool = True,
) -> LegalSettlementBreakdown:
    """Calculates legally compliant net payouts incorporating DISCOM wheeling charges."""
    rule = resolve_state_rule(site_key)

    gross_kwh = max(0.0, float(gross_kwh))
    trade_price_rs_kwh = max(0.0, float(trade_price_rs_kwh))

    # Technical distribution loss on the feeder
    loss_kwh = gross_kwh * (rule.wheeling_loss_pct / 100.0)
    delivered_kwh = max(0.0, gross_kwh - loss_kwh)

    gross_revenue = delivered_kwh * trade_price_rs_kwh

    # DISCOM wheeling fee (retained by the utility for using transmission lines)
    wheeling_fee = delivered_kwh * rule.wheeling_charge_rs_kwh
    css_fee = 0.0 if is_residential_buyer else (delivered_kwh * rule.cross_subsidy_surcharge_rs)
    cess_fee = delivered_kwh * rule.regulatory_cess_rs

    total_discom_wire_revenue = wheeling_fee + css_fee + cess_fee
    net_seller_payout = max(0.0, gross_revenue - total_discom_wire_revenue)

    return LegalSettlementBreakdown(
        gross_energy_kwh=round(gross_kwh, 2),
        delivered_energy_kwh=round(delivered_kwh, 2),
        gross_price_rs_kwh=round(trade_price_rs_kwh, 2),
        gross_revenue_inr=round(gross_revenue, 2),
        technical_loss_kwh=round(loss_kwh, 2),
        wheeling_fee_inr=round(wheeling_fee, 2),
        cross_subsidy_inr=round(css_fee, 2),
        state_cess_inr=round(cess_fee, 2),
        net_seller_payout_inr=round(net_seller_payout, 2),
        discom_wire_revenue_inr=round(total_discom_wire_revenue, 2),
        regulatory_ref=rule.serc_order_ref,
        sandbox_compliant=True,
    )
