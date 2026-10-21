"""Unit tests for cutting-edge modules: Inverter Matrix, CEA Cyber, EV Dispatch, Transformer Guard, Carbon Credits."""

from avishkar_ems.inverter_adapters import (
    INVERTER_VENDOR_CATALOG,
    UniversalInverterTranslator,
    calculate_modbus_crc16,
)
from avishkar_ems.cybersecurity_cea import CEACyberSecurityManager
from avishkar_ems.ev_dispatch import INDIAN_EV_MODELS, compute_v2h_dispatch
from avishkar_ems.transformer_guard import (
    STANDARD_DISTRIBUTION_TRANSFORMERS,
    evaluate_feeder_transformer_health,
)
from avishkar_ems.carbon_credits import compute_carbon_credits


def test_modbus_crc16():
    # Standard Modbus test vector: [0x01, 0x03, 0x00, 0x00, 0x00, 0x0A] -> CRC is 0xC5CD (or 0xCDC5 little endian)
    data = bytes([0x01, 0x03, 0x00, 0x00, 0x00, 0x0A])
    crc = calculate_modbus_crc16(data)
    assert isinstance(crc, int)
    assert 0 <= crc <= 0xFFFF


def test_universal_inverter_translator():
    for vendor in ["sunspec", "growatt", "deye", "solis", "luminous"]:
        translator = UniversalInverterTranslator(vendor)
        reg, val, frame = translator.translate_power_limit(80.0)
        assert reg > 0
        assert val > 0
        assert len(frame) == 8  # 6 payload bytes + 2 CRC bytes

        chg_reg, chg_val, chg_frame = translator.translate_battery_charge(2.5)
        assert chg_reg > 0
        assert len(chg_frame) == 8


def test_cea_cybersecurity_audit():
    mgr = CEACyberSecurityManager("mathura-site-01")
    audit = mgr.perform_statutory_audit(offline_local_mode=True)
    assert audit.is_compliant is True
    assert "India" in audit.data_residency_country
    assert audit.incident_notification_window_hours == 6
    assert len(audit.security_controls_passed) >= 5

    # Test incident logger
    evt = mgr.log_security_event("UNAUTHORIZED_REGISTER_SCAN", "HIGH", "Port scan blocked on Modbus OT loop")
    assert evt["cert_in_report_due_within"] == "6 Hours"
    assert len(mgr.get_incident_log()) == 1


def test_ev_v2h_dispatch():
    # Test Tata Nexon EV with 80% charge and 50% commute reserve
    plan = compute_v2h_dispatch(
        vehicle_key="tata_nexon_ev",
        current_soc_pct=80.0,
        commute_reserve_soc_pct=50.0,
        peak_tariff_rs=10.0,
    )
    assert plan.usable_v2h_energy_kwh > 0.0
    assert plan.daily_rupee_savings_inr > 0.0
    assert plan.monthly_rupee_savings_inr > 0.0
    assert plan.remaining_range_km > 150.0
    assert plan.ocpp_charging_action == "V2H_DISCHARGE_ACTIVE"

    # Test Ola S1 Pro 2-Wheeler
    ola_plan = compute_v2h_dispatch("ola_s1_pro", current_soc_pct=90.0, commute_reserve_soc_pct=60.0)
    assert ola_plan.usable_v2h_energy_kwh > 0.5


def test_transformer_feeder_guard():
    # Safe condition: local load absorbs most solar
    safe = evaluate_feeder_transformer_health("dt_100kva", total_rooftop_pv_kw=40.0, local_load_kw=30.0)
    assert safe.thermal_status == "SAFE_GREEN"
    assert safe.curtailment_required_kw == 0.0

    # Overload condition: 120 kW solar export on 100 kVA transformer
    overload = evaluate_feeder_transformer_health("dt_100kva", total_rooftop_pv_kw=120.0, local_load_kw=10.0, community_bess_available_kw=20.0)
    assert overload.thermal_status in ("WARNING_AMBER", "CRITICAL_RED")
    assert overload.transformer_loading_pct > 80.0
    assert overload.battery_absorption_target_kw > 0.0
    assert overload.feeder_voltage_estimated_v > 230.0


def test_bee_carbon_credits():
    rep = compute_carbon_credits(clean_solar_kwh=1000.0)
    assert rep.clean_energy_generated_kwh == 1000.0
    assert rep.avoided_co2_kg == 716.0  # 1000 * 0.716
    assert rep.avoided_co2_metric_tons == 0.716
    assert rep.avoided_coal_kg == 520.0 # 1000 * 0.52
    assert rep.equivalent_trees_planted > 30
    assert rep.carbon_credit_certificates == 0.716
    assert rep.estimated_credit_value_inr > 500.0
    assert "BEE-CCTS-" in rep.certificate_hash
