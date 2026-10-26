"""Multi-Vendor Inverter Adapter Matrix for UrjaSetu EMS.

Translates unified EMS setpoints into proprietary register maps for the top 5
inverter brands deployed across India:
1. SunSpec Standard (SolarEdge, Fronius, SMA, Delta)
2. Growatt Hybrid (SPF / MIN series) - Modbus RTU over RS-485
3. Deye / Sol-Ark Hybrid (SUN series) - Holding registers 0x003B-0x006E
4. Solis Inverter (Ginlong Solis 4G/5G) - Registers 3000-3100
5. Luminous Solar Hybrid (NXG / Solarverter) - Domestic Indian protocol

Includes native Modbus RTU CRC-16 checksum calculation for serial RS-485 dongles.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass


def calculate_modbus_crc16(data: bytes) -> int:
    """Calculates Modbus RTU CRC-16 using polynomial 0xA001."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x0001:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    # Returns 16-bit integer (low byte, high byte in transmission)
    return crc & 0xFFFF


@dataclass(frozen=True)
class InverterVendorProfile:
    """Register specifications and communication parameters for an inverter brand."""
    vendor_id: str
    display_name: str
    baud_rate: int
    parity: str
    default_slave_id: int
    reg_voltage: int
    reg_frequency: int
    reg_active_power: int
    reg_battery_soc: int
    reg_power_limit_setpoint: int
    reg_battery_charge_setpoint: int
    reg_island_relay: int
    scale_factor_voltage: float
    scale_factor_frequency: float
    scale_factor_power: float
    protocol_type: str  # "MODBUS_RTU_SERIAL" or "MODBUS_TCP"


INVERTER_VENDOR_CATALOG: dict[str, InverterVendorProfile] = {
    "sunspec": InverterVendorProfile(
        vendor_id="sunspec",
        display_name="SunSpec Standard (SolarEdge / SMA / Fronius)",
        baud_rate=19200,
        parity="N",
        default_slave_id=1,
        reg_voltage=40079,
        reg_frequency=40085,
        reg_active_power=40083,
        reg_battery_soc=40205,
        reg_power_limit_setpoint=40200,
        reg_battery_charge_setpoint=40201,
        reg_island_relay=40203,
        scale_factor_voltage=0.1,
        scale_factor_frequency=0.01,
        scale_factor_power=10.0,
        protocol_type="MODBUS_TCP",
    ),
    "growatt": InverterVendorProfile(
        vendor_id="growatt",
        display_name="Growatt Hybrid (SPF / MIN / SPH Series)",
        baud_rate=9600,
        parity="N",
        default_slave_id=1,
        reg_voltage=38,         # 0x26 Input Reg: Vgrid
        reg_frequency=39,       # 0x27 Input Reg: Freq
        reg_active_power=35,     # 0x23 Input Reg: Pac
        reg_battery_soc=101,    # Battery SoC %
        reg_power_limit_setpoint=122, # Active power rate %
        reg_battery_charge_setpoint=123,
        reg_island_relay=124,
        scale_factor_voltage=0.1,
        scale_factor_frequency=0.01,
        scale_factor_power=0.1,
        protocol_type="MODBUS_RTU_SERIAL",
    ),
    "deye": InverterVendorProfile(
        vendor_id="deye",
        display_name="Deye / Sol-Ark Hybrid (SUN-SG04 Series)",
        baud_rate=9600,
        parity="N",
        default_slave_id=1,
        reg_voltage=598,        # Grid Voltage L1
        reg_frequency=603,      # Grid Frequency
        reg_active_power=599,    # Inverter Output Power
        reg_battery_soc=588,    # Battery SoC %
        reg_power_limit_setpoint=600, # Max Solar Sell Power
        reg_battery_charge_setpoint=601,
        reg_island_relay=602,
        scale_factor_voltage=0.1,
        scale_factor_frequency=0.01,
        scale_factor_power=1.0,
        protocol_type="MODBUS_RTU_SERIAL",
    ),
    "solis": InverterVendorProfile(
        vendor_id="solis",
        display_name="Ginlong Solis (3-Phase / Hybrid Series)",
        baud_rate=9600,
        parity="N",
        default_slave_id=1,
        reg_voltage=3035,
        reg_frequency=3042,
        reg_active_power=3004,
        reg_battery_soc=3139,
        reg_power_limit_setpoint=3120,
        reg_battery_charge_setpoint=3121,
        reg_island_relay=3122,
        scale_factor_voltage=0.1,
        scale_factor_frequency=0.01,
        scale_factor_power=1.0,
        protocol_type="MODBUS_RTU_SERIAL",
    ),
    "luminous": InverterVendorProfile(
        vendor_id="luminous",
        display_name="Luminous Solarverter / NXG (Made in India)",
        baud_rate=9600,
        parity="N",
        default_slave_id=2,
        reg_voltage=1002,
        reg_frequency=1004,
        reg_active_power=1010,
        reg_battery_soc=1020,
        reg_power_limit_setpoint=1030,
        reg_battery_charge_setpoint=1032,
        reg_island_relay=1034,
        scale_factor_voltage=1.0,
        scale_factor_frequency=0.1,
        scale_factor_power=1.0,
        protocol_type="MODBUS_RTU_SERIAL",
    ),
}


class UniversalInverterTranslator:
    """Translates generic EMS commands into brand-specific Modbus RTU/TCP frames."""

    def __init__(self, vendor_id: str = "sunspec"):
        self.profile = INVERTER_VENDOR_CATALOG.get(vendor_id, INVERTER_VENDOR_CATALOG["sunspec"])

    def build_rtu_write_frame(self, reg_address: int, value: int) -> bytes:
        """Builds a Modbus RTU frame with CRC-16 for physical RS-485 serial dongles."""
        # Slave(1) + FC06(1) + RegAddr(2) + RegVal(2) = 6 bytes + CRC(2) = 8 bytes
        payload = struct.pack(">BBHH", self.profile.default_slave_id, 0x06, reg_address, value)
        crc = calculate_modbus_crc16(payload)
        # CRC is sent little-endian in Modbus RTU standard
        crc_bytes = struct.pack("<H", crc)
        return payload + crc_bytes

    def translate_power_limit(self, limit_pct: float) -> tuple[int, int, bytes]:
        """Translates active power limit % into vendor register address, raw value, and RTU frame."""
        clamped_pct = max(0.0, min(100.0, float(limit_pct)))
        reg = self.profile.reg_power_limit_setpoint
        raw_val = int(clamped_pct * 100) if self.profile.vendor_id == "sunspec" else int(clamped_pct)
        frame = self.build_rtu_write_frame(reg, raw_val)
        return reg, raw_val, frame

    def translate_battery_charge(self, charge_kw: float) -> tuple[int, int, bytes]:
        """Translates battery charge setpoint into vendor register address, value, and frame."""
        safe_kw = max(0.0, float(charge_kw))
        reg = self.profile.reg_battery_charge_setpoint
        raw_val = int(safe_kw * 100) if self.profile.vendor_id == "sunspec" else int(safe_kw * 10)
        frame = self.build_rtu_write_frame(reg, raw_val)
        return reg, raw_val, frame
