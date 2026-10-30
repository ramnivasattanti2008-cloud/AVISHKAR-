"""Unit tests for Hardware Modbus Inverter Gateway, Regulatory Sandbox, and UPI settlements."""

from avishkar_ems.hardware_modbus import InverterHardwareGateway, SunSpecModbusFrame
from avishkar_ems.regulatory import compute_legal_settlement
from avishkar_ems.settlement_upi import generate_upi_payment


def test_inverter_hardware_gateway_telemetry():
    gw = InverterHardwareGateway(emulate=True)
    assert gw.connect() is True
    t = gw.read_telemetry()
    assert t.connected is True
    assert 200.0 < t.grid_voltage_v < 260.0
    assert 48.0 < t.grid_frequency_hz < 52.0
    assert t.active_limit_pct == 100.0
    gw.close()


def test_inverter_hardware_gateway_write_setpoints():
    gw = InverterHardwareGateway(emulate=True)
    ok, msg = gw.write_dispatch_setpoint(
        active_power_limit_pct=75.5,
        battery_charge_kw=3.2,
        battery_discharge_kw=0.0,
        island_backup_relay=False,
    )
    assert ok is True
    assert "WMaxLimPct=75.5%" in msg

    t = gw.read_telemetry()
    assert t.active_limit_pct == 75.5

    # Test safety clamp (>100% clamped to 100%)
    ok, _ = gw.write_dispatch_setpoint(active_power_limit_pct=150.0)
    assert ok is True
    assert gw.read_telemetry().active_limit_pct == 100.0


def test_sunspec_modbus_frame_encoding():
    frame = SunSpecModbusFrame.build_read_holding(trans_id=1, unit_id=1, start_reg=40070, count=10)
    assert len(frame) == 12
    write_frame = SunSpecModbusFrame.build_write_single(trans_id=2, unit_id=1, reg=40200, val=8000)
    assert len(write_frame) == 12


def test_compute_legal_settlement():
    settlement = compute_legal_settlement(
        site_key="home-mathura",
        gross_kwh=10.0,
        trade_price_rs_kwh=6.50,
        is_residential_buyer=True,
    )
    assert settlement.gross_energy_kwh == 10.0
    assert settlement.delivered_energy_kwh < 10.0  # technical loss deducted
    assert settlement.wheeling_fee_inr > 0.0
    assert settlement.net_seller_payout_inr > 0.0
    assert settlement.sandbox_compliant is True
    assert "UPERC" in settlement.regulatory_ref

    pune_settle = compute_legal_settlement("shop-pune", 20.0, 7.0, is_residential_buyer=False)
    assert "MERC" in pune_settle.regulatory_ref
    assert pune_settle.cross_subsidy_inr > 0.0  # CSS applied for commercial buyer

    jaipur_settle = compute_legal_settlement("clinic-jaipur", 15.0, 6.0)
    assert "RERC" in jaipur_settle.regulatory_ref


def test_generate_upi_payment():
    pay = generate_upi_payment(
        payee_vpa="solar.mathura@oksbi",
        payee_name="Ram Nivas Solar Hub",
        amount_inr=54.25,
        trade_id="TRD-998811",
    )
    assert "upi://pay?" in pay.upi_intent_uri
    assert "am=54.25" in pay.upi_intent_uri
    assert "solar.mathura%40oksbi" in pay.upi_intent_uri or "solar.mathura@oksbi" in pay.upi_intent_uri
    assert "TXN-US" in pay.transaction_ref
    assert "<svg" in pay.qr_svg_html
