# =============================================================================================
# A MINIMAL STAND-IN for one module of SEM (Solar Energy Management), holding only the single
# constant that the vendored `sem_reclaim.py` imports from it.
#
#   Upstream: https://github.com/traktore-org/sem-community
#   Commit:   067c8615a36fbad2cc912a005f63525038093b07
#   Licence:  MIT -- Copyright (c) 2025 belinea4071. Full text in LICENSES/sem-community-MIT.txt.
#   Source:   custom_components/solar_energy_management/coordinator/sensor_reader.py, line 142.
#
# Why a stand-in rather than the module. `sem_reclaim.py` is vendored byte for byte, and inside
# `car_may_be_charging` it does `from .sensor_reader import EV_ACTIVE_CHARGE_FLOOR_W` -- a
# function-local import, which is why it does not show up when you grep a file's imports. Upstream's
# `sensor_reader.py` is 6,988 lines of Home Assistant entity plumbing (8 `homeassistant` imports, an
# adapter per inverter vendor) and AVISHKAR uses none of it. Vendoring all of that to satisfy one
# float would bring in a large module with no caller.
#
# So this file exists to make that one import resolve, with the constant copied at the value and the
# line it has upstream. The alternative -- editing the import out of `sem_reclaim.py` -- would have
# made that file no longer byte-identical, and the whole point of vendoring it verbatim is that
# upstream's own tests can be run against it unchanged.
#
# If more of upstream's `sensor_reader` is ever needed, vendor it properly and delete this file.
# =============================================================================================

#: The power below which a charger's reading is standby rather than a car taking charge. Upstream
#: calls it "the same rule every adapter's" reader applies, at `sensor_reader.py:142`.
EV_ACTIVE_CHARGE_FLOOR_W = 500.0
