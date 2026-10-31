"""Surplus arithmetic vendored from SEM (Solar Energy Management), unmodified.

Upstream:   https://github.com/traktore-org/sem-community
Commit:     067c8615a36fbad2cc912a005f63525038093b07
Licence:    MIT -- Copyright (c) 2025 belinea4071. The full licence text is in
            `LICENSES/sem-community-MIT.txt` beside this file.
Source:     custom_components/solar_energy_management/coordinator/surplus_controller.py
              solar_bounded_surplus          lines 380-445
              loads_import_deficit_w         lines 448-462
              import_absorbed_by_loads_w     lines 465-479
              reclaim_handed_back            lines 489-499
              solar_bounded_reclaim          lines 502-532
              sun_can_still_finish           lines 535-581
              price_damped_pool              lines 612-642
            custom_components/solar_energy_management/coordinator/price_signal.py
              _name                          lines 83-87
            custom_components/solar_energy_management/tariff/tariff_provider.py
              EXPENSIVE_LEVELS (values)      line 307

**Why this is vendored rather than rewritten.** These seven functions encode physical
invariants that were learned from field failures, and the docstrings name them. They are
the part of a surplus controller that is genuinely hard to get right, and a fresh
implementation would start again from the same wrong place:

* a controller that allocates from `grid_export` alone chases its own tail, because its
  own loads suppress the signal it is reading. `solar_bounded_surplus` adds the loads'
  draw back, reconstructing the surplus that would exist with them off;
* surplus must be clamped to what the sun is actually producing. Without that clamp a
  load running off the **battery** at night reads as surplus -- upstream's phantom
  overnight run (`#620`, reported by @onkelfu);
* the same clamp has to apply to the whole pool, not one addend, or a battery charging
  from the grid on an inverter's own time-of-use window funds a "solar only" load at
  01:29 with the sun at 0 W (`#938`, reported by alexmc1510 with timestamps);
* a zero-export inverter holds a small import **on purpose** (Victron ESS, +50 W), so a
  naive "import means no surplus" rule stops every load. Hence `IMPORT_DEADBAND_W`;
* an EV charger's own grid draw must not be charged against the household loads' pool,
  or a 3 kW boiler cycles against a steady import (`#1102`, @lostcontrol);
* a price signal may damp the pool but must never inflate it, or "solar only" silently
  means "grid in every cheap hour" (`#953`).

AVISHKAR's own `surplus_engine.py` and `home_balance.py` computed surplus as
`generation - demand`, which has none of this. They now call into here.

**What was changed, and nothing else.** The function bodies and docstrings are byte-for-byte
upstream, extracted with `ast.get_source_segment` rather than retyped. Added here:
this header, the two constants and the `_name`/`is_expensive_name` helpers that the
functions need (inlined from the two files named above so this module stands alone), and
`from __future__ import annotations` so the quoted `Optional[float]` annotations resolve
without importing `typing.Optional` at runtime. Nothing in any body was edited.

The upstream references in the docstrings (`#620`, `#938`, `#953`, `#1102`, `#1112`) are
SEM's own issue numbers, not AVISHKAR's. Upstream's own tests for these functions are run
against this copy by `tests/avishkar_ems/test_vendored_sem_surplus.py`, which is how the
copy is known to be faithful.

Device-coupled helpers from the same upstream file (`tier1_battery_reserved_w`,
`surplus_reserved_w`, `grid_top_up_defers_to_sun`, `compute_load_intent`, the
`SurplusController` class) are deliberately NOT vendored: they need SEM's
`ControllableDevice` and its Home Assistant lifecycle, which AVISHKAR does not have.
"""

from __future__ import annotations

from typing import Any, Optional  # noqa: F401 -- Optional is referenced by quoted annotations

#: A zero-export inverter holds a small import on purpose (Victron ESS defaults to +50 W),
#: and the LIFO band leaves only 50 W past the export offset. Upstream:
#: `coordinator/surplus_controller.py` line 40.
IMPORT_DEADBAND_W = 100.0

#: Always keep a small export to the grid rather than regulating to exactly zero.
#: Upstream: `consts/core.py` line 348 (`DEFAULT_REGULATION_OFFSET`).
DEFAULT_REGULATION_OFFSET = 50  # Watts

#: The price-level names upstream treats as dear. From `tariff/tariff_provider.py` line 307,
#: `EXPENSIVE_LEVELS = (PriceLevel.EXPENSIVE, PriceLevel.VERY_EXPENSIVE)`, by their values.
_EXPENSIVE_NAMES = frozenset({"expensive", "very_expensive"})


def _name(level: Any) -> str:
    """A level's wire string, whatever shape it arrives in (enum, str, None)."""
    if level is None:
        return ""
    return str(getattr(level, "value", level) or "").strip().lower()


def is_expensive_name(level: Any) -> bool:
    return _name(level) in _EXPENSIVE_NAMES


def loads_import_deficit_w(
    grid_import_w: "Optional[float]", *, ev_draw_w: float = 0.0,
    battery_discharge_w: "Optional[float]" = 0.0,
) -> float:
    """(#1102) The import the loads' pool carries: the meter's import less
    what the chargers' draw explains and less ``IMPORT_DEADBAND_W``.
    ``None`` (no live reading) is no evidence — nothing.

    (#1112) Plus the pack's discharge: power the sun did not make. A dark
    battery reading (``None``) adds nothing."""
    if grid_import_w is None:
        return 0.0
    not_sun = float(grid_import_w) + max(0.0, float(battery_discharge_w or 0.0))
    return max(0.0, not_sun
               - max(0.0, float(ev_draw_w or 0.0)) - IMPORT_DEADBAND_W)


def solar_bounded_surplus(
    grid_export_w: float,
    active_draw_w: float,
    solar_w: "Optional[float]" = None,
    *,
    grid_import_w: "Optional[float]" = 0.0,
    ev_draw_w: float = 0.0,
    battery_discharge_w: "Optional[float]" = 0.0,
) -> float:
    """The feedback-free SOLAR surplus, physically bounded by production (#620).

    ``grid_export + active_draw`` reconstructs "the surplus that would exist if
    the controller's own loads were off" — the stable quantity to allocate from
    (without the add-back the signal chases its own tail as loads switch on).

    (#1102) The add-back is only that if the grid side is SIGNED: export is
    the clamped half (``max(0, grid)``), so an import read as 0 W and the loads'
    own draw came back whole. @lostcontrol's 3 kW boiler (no battery) ran on
    with 2 kW imported — the pool said 3 kW, not 1 kW, and after its own debit
    the walk sat at −50 W, inside the −100 W LIFO band, while the sun stayed
    above 3 kW. So the import comes off, with two exceptions:

    * the share the chargers' draw explains (``ev_draw_w``, fleet). A charger
      is decided before the loads and already leaves a running load above it
      its sun (#885); what it draws past that — a Min floor, Now, a cheap-hour
      plan — is the charger's own grid, and must not stop that load.
    * the first ``IMPORT_DEADBAND_W``: a zero-export inverter holds a small
      import on purpose (Victron ESS: +50 W by default), and the LIFO band
      leaves only 50 W past the export offset.

    The import comes off here first; the reclaim (``reclaimable_battery_w``,
    #938) takes off only what this side could not (``import_absorbed_by_loads_w``).
    So a load BELOW the battery pays the whole import — a pack charging from
    the grid does not yield to it — and the two addends together are the whole
    balance, ``draw + export + charge − import``, whether a load runs or not.
    The coordinator hands in a SUSTAINED import (``sustained_import``: the
    mean of the last two minutes, or while a car may charge the lowest
    reading of them, ``None`` on a dark meter) and, as ``ev_draw_w``, the
    car's highest draw of the same two minutes (``sustained_car_draw``): a
    charger's power sensor can trail the meter by a minute at a start, a
    ramp or a stop, and that import is the car's. ``grid_import_w=None`` takes nothing
    off: the running loads hold, and nothing new can start on a dark meter.

    (#1112) The home battery is the other source that is not the sun. In a
    battery home the pack covers a load the sun no longer funds, the meter
    reads 0 W, and a Solar-only load ran on the pack. So the pack's
    discharge (``battery_discharge_w``, sustained like the import) comes
    off the same way, and the chargers' draw explains it as it explains
    the import. A "Solar + battery" load gets its pack share back through
    the Tier-1 headroom, which now sees the shortfall it pays for.

    The result is then clamped to ``[0, solar]``: **you cannot have more SOLAR
    surplus than the sun is producing.** This one physical invariant is the whole
    guard — between sunset and sunrise ``solar_w`` is ~0, so the surplus is
    pinned to 0 no matter what the add-back, a noisy grid sensor, or a battery→
    grid discharge tries to fabricate (the phantom overnight "surplus" @onkelfu
    hit when a load ran off the battery at night). ``solar_w=None`` (sensor
    unavailable) skips the cap and falls back to the raw add-back.
    """
    deficit = loads_import_deficit_w(
        grid_import_w, ev_draw_w=ev_draw_w,
        battery_discharge_w=battery_discharge_w)
    surplus = float(grid_export_w) - deficit + float(active_draw_w)
    if solar_w is not None:
        surplus = min(surplus, float(solar_w))
    return max(0.0, surplus)


def import_absorbed_by_loads_w(
    *,
    grid_export_w: float,
    active_draw_w: float,
    grid_import_w: "Optional[float]",
    ev_draw_w: float = 0.0,
) -> float:
    """(#1102) How much of the import the loads' pool has already taken off
    — at most down to 0, so at most their own credited draw. The reclaim
    (#938) takes off only the rest. Without this a load above a charging
    pack paid the same import twice once it ran (pool AND reclaim) but once
    at its start, and cycled on a steady import (a single-phase hybrid on a
    summed meter, a Victron setpoint above 100 W)."""
    deficit = loads_import_deficit_w(grid_import_w, ev_draw_w=ev_draw_w)
    return min(deficit, max(0.0, float(grid_export_w) + float(active_draw_w)))


def reclaim_handed_back(remaining_w: float, reclaim_w: float) -> float:
    """(#576, #1102) The walk's pool after it crosses the battery's slot.

    The battery takes back what is left of the reclaim, never more than the
    loads above it left: ``remaining − min(reclaim, max(0, remaining))``.
    The old form, ``max(0, remaining − reclaim)``, gives the same answer
    while ``remaining ≥ 0`` — and wipes a deficit the loads above the
    battery made, so the stop pass never saw it (class 137).
    """
    remaining = float(remaining_w)
    return remaining - min(max(0.0, float(reclaim_w or 0.0)), max(0.0, remaining))


def solar_bounded_reclaim(
    reclaim_w: float,
    *,
    surplus_w: float,
    solar_w: "Optional[float]" = None,
) -> float:
    """(#938) The #620 invariant on the WHOLE load pool, not on one addend.

    ``update()`` allocates from ``surplus + reclaim``: the feedback-free
    export surplus (already ``≤ solar`` via ``solar_bounded_surplus``) PLUS
    the battery-charge power a load above the battery may reclaim (#576).
    The bound sat on the first addend only; the reclaim joined the pool
    below it. So a battery charging from the grid at night — an inverter TOU
    window, nothing SEM commanded — put kilowatts of "surplus" in front of a
    Solar-only pump with the sun at 0 W, and the pump ran until the charge
    ended (alexmc1510, 09.09.2026: on 01:29, on again 01:45 after a manual
    off, off 06:03, "4.3/4 h on solar today").

    You cannot reclaim more sun than there is: ``surplus_w + result ≤
    solar_w``. ``solar_w=None`` (no reading) reclaims NOTHING — deliberately
    unlike ``solar_bounded_surplus``, which lets a raw export figure through
    on a missing reading because export IS physical evidence of the sun; a
    charging battery is not. In production the reader never yields None (a
    dark solar sensor reads 0.0 and pins the pool that way), so this is the
    contract for callers, not a live branch. ``reclaimable_battery_w``'s
    grid-import term is the independent second ceiling.
    """
    reclaim = max(0.0, float(reclaim_w or 0.0))
    if solar_w is None:
        return 0.0
    return max(0.0, min(reclaim, float(solar_w) - float(surplus_w or 0.0)))


def sun_can_still_finish(
    deficit_s: float,
    *,
    daylight_remaining_s: "Optional[float]",
    is_night: bool,
) -> bool:
    """(#953) Is there still enough daylight left today to close this deficit?

    "Finish overnight from: **Grid**" is a FINISH source — the picker's own
    word. Its battery twin has been window-gated since #633 ("must not fire
    in daytime", caught live at 09:10 in full sun); the grid half of the
    same picker had no window at all, only the tariff level. So the first
    cheap slot after the meter day rolls at sunrise bought the whole daily
    target from the meter before the sun had produced a watt, and the day's
    solar went to export (alexmc1510, Huawei, 13.09.2026: Solar-only pool
    pump, 4 h/day, ON at 07:52:39 — sunrise, to the second — and still
    running at 08:24 on 78 W of sun with the pack discharging 857 W).

    The gate is the honest reading of "finish": while today's remaining
    daylight is at least as long as the outstanding deficit, the sun can
    still deliver it, so the grid waits. Deliberately about the free
    window's LENGTH, not about cloud — a dark day is exactly what the
    overnight top-up exists for, and #559's contract is that free comes
    first ("solar_only devices accept missing the target on a dark day").

    Monotone, so it cannot flap: while the load runs, the deficit and the
    remaining daylight shrink at the same one second per second, so their
    difference is constant; while it is off only the daylight shrinks. The
    gate opens once per day and never closes again.

    Returns ``False`` — the top-up may proceed — in every case where we
    cannot claim the sun still has time:

    * ``is_night`` — the overnight window the picker promises. Read from
      ``TimeManager.is_night_mode()``, which has its own clock fallback, so
      the promised behaviour never depends on a sunset reading.
    * no ``daylight_remaining_s`` (no sun data) — unknown is not a claim.
    * no deficit — nothing to finish.
    """
    if is_night:
        return False
    if daylight_remaining_s is None:
        return False
    deficit = float(deficit_s or 0.0)
    if deficit <= 0.0:
        return False
    return float(daylight_remaining_s) >= deficit


def price_damped_pool(distributable: float, price_level: str) -> float:
    """(#953) A price signal may DAMP the solar pool; it may never inflate it.

    This used to add a *virtual* +3 kW (cheap) / +10 kW (negative) to
    ``distributable`` "to encourage consumption". That number is not a
    measurement of anything: it entered the pool after the coordinator had
    bounded the real surplus by the sun (#620) and the reclaim by the sun
    and the meter (#938), and it was handed to the ordinary SOLAR activation
    pass. The consequences were all of a piece — a load in mode "Solar only"
    ("SEM runs it on solar surplus — never imports from grid") ran from the
    grid in every cheap hour of a dynamic tariff; the run was labelled
    ``source="solar"`` and booked to the "h on solar today" bar; it carried
    no force marker, so neither the force-expiry pass nor the deficit LIFO
    could end it; and it applied to every device at once, with none of the
    per-device opt-in, deficit bound, peak-slot guard (#864) or day-rollover
    expiry that the real cheap-hours top-up pass carries. #559's
    "Finish overnight from: Grid" IS the sanctioned way to buy a cheap hour,
    per device and per target.

    So the invariant is the #620 one, now true of the whole pool at its last
    writer: **you cannot distribute more solar surplus than the sun is
    producing.** The expensive-hour damping stays — lowering the pool can
    only ever make SEM spend less — and the final ``min`` makes the
    direction structural rather than a property of the branches.
    """
    damped = distributable
    # (#994) was ``== "expensive"`` — very_expensive silently did not damp
    # the pool, the one drift the six hand-typed copies had already produced.
    if is_expensive_name(price_level):
        damped = max(0.0, distributable - 500)
    return min(damped, distributable)
