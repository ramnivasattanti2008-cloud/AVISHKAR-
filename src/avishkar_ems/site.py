"""Site description: the metadata the organisers' dataset provides for each site."""

from __future__ import annotations

from dataclasses import dataclass, field

from avishkar_ems.tariffs import COMMERCIAL_TOD, Tariff


@dataclass(frozen=True)
class SiteSpec:
    site_id: str
    lat: float
    lon: float
    dc_kwp: float  # DC capacity
    ac_kw: float  # inverter AC limit
    tilt: float  # degrees from horizontal
    azimuth: float  # degrees clockwise from north (180 = south)
    battery_kwh: float  # nominal capacity
    battery_kw: float  # charge/discharge power rating
    critical_kw: float  # load that must keep running in an outage
    backup_hours: float  # required backup duration for the critical load
    system_cost_inr: float
    loss_frac: float = 0.14  # wiring, mismatch, soiling and other fixed losses
    temp_coeff: float = -0.004  # power change per degree C above 25 C
    dod: float = 0.90  # usable depth of discharge
    round_trip_eff: float = 0.90
    wear_inr_per_kwh: float = 2.0  # battery wear cost per kWh cycled
    tz: str = "Asia/Kolkata"
    altitude: float = 0.0
    tariff: Tariff = field(default=COMMERCIAL_TOD)

    @property
    def one_way_eff(self) -> float:
        return self.round_trip_eff**0.5
