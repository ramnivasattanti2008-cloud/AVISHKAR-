# Integration test results, 2026-10-31

What was run against the imported code and the application around it, and what it printed. The
provenance of each imported component is in
[OPEN_SOURCE_INTEGRATION_MAP.md](OPEN_SOURCE_INTEGRATION_MAP.md); the decisions behind what was and
was not imported are in [OPEN_SOURCE_REUSE_AUDIT.md](OPEN_SOURCE_REUSE_AUDIT.md).

The distinction that matters here: **upstream's tests prove the copy is faithful; AVISHKAR's tests
prove the wiring works.** Both are needed and they are kept apart.

## Upstream's own tests, run against AVISHKAR's copies

`tests/avishkar_ems/test_vendored_sem_surplus.py` — **49 passed**

Seven test classes taken verbatim from SEM at commit `067c8615` with `ast.get_source_segment`, not
retyped. The only change is the import: they import from `avishkar_ems.vendor.*` instead of
`custom_components.solar_energy_management.*`. If AVISHKAR's copy had drifted, they would fail.

| Upstream file | Class | Tests | Covers |
|---|---|---|---|
| `test_1112_solar_only_load_never_uses_the_pack.py` | `TestTheDeficitCountsThePack` | 3 | the battery's discharge counts against the pool like an import |
| `test_938_night_reclaim_solar_bound.py` | `TestSolarBoundedReclaim` | 7 | the reclaim bound, including a sweep asserting `surplus + reclaim ≤ solar` |
| `test_953_cheap_hours_finish_window.py` | `TestSunCanStillFinish` | 7 | whether today's remaining daylight can still close a deficit |
| `test_953_cheap_hours_finish_window.py` | `TestPriceDampedPool` | 7 | a price signal may damp the pool, never inflate it |
| `test_1102_import_counts_against_loads.py` | `TestThePoolKeepsTheImport` | 11 | the import deficit, the deadband, the charger's own draw |
| `test_1102_import_counts_against_loads.py` | `TestOnlyAnImportThatLastedCounts` | 9 | a reading must last two minutes before it is acted on |
| `test_1102_import_counts_against_loads.py` | `TestWhatOpensTheWindow` | 5 | when a charger's reading is a car rather than standby |

One pure upstream class is deliberately absent: `TestNothingWaitsForAnHourThatCannotCome` needs SEM's
tariff provider and `EnergyAssistant`, which were not vendored, so running it would prove nothing about
this copy.

**The check was shown to be meaningful**, not merely green. Removing the single most important line of
the vendored code — the `min(surplus, solar_w)` clamp in `solar_bounded_surplus` — makes upstream's own
sweep test fail:

```
FAILED TestSolarBoundedReclaim::test_invariant_holds_across_a_sweep
1 failed, 23 passed
```

and restoring it returns all 49 to passing. The byte-identity of the whole-file copy is asserted
separately:

```
reclaim byte-identical after the comment block: True
```

## AVISHKAR's own tests for the wiring

`tests/avishkar_ems/test_surplus_vendor_wiring.py` — **26 passed**

| Class | Tests | What it holds |
|---|---|---|
| `TestWhichComputationIsUsed` | 4 | a metered interval uses the vendored function, an unmetered one does not, and the result names which |
| `TestTheNightCaseThatMattered` | 3 | a load running off the battery at night is not surplus; surplus never exceeds generation across a sweep of meter readings |
| `TestTheImportAndTheCharger` | 4 | an import the sun did not fund reduces what is switched on; a 100 W import is left alone; the car's own draw is not charged to the household loads; a dark meter takes nothing off |
| `TestNothingElseChanged` | 4 | energy still conserved, measurement mode still carried, missing telemetry still refused, and the unmetered path gives the same answer as before the wiring to the last digit |
| `TestCurtailmentClosesTheBooks` | 4 | the defect found while wiring (below) |
| `TestTheBatteryReclaimIsWiredIn` | 7 | power going into the pack is offered to loads first, but not from a grid charge, not below the reserve, not under a command, and never past the sun |

## A defect the integration exposed, and the one I made

**Found in AVISHKAR, pre-existing.** `DispatchStepResult` had no curtailment term and the first-law
check had none either, so a zero-export home with a full battery simply lost the unusable generation.
Reproduced before any of this work, by stashing the changes:

```
zero-export home, battery full, 5 kW sun, 2 kW load
  surplus     : 3.0 kW
  grid export : 0.0 kW
  balanced    : False   error: 3.0 kW
```

`curtailed_solar_kw` now exists, is in the balance, and the inverter throttling back is stated as a
constraint. `TestCurtailmentClosesTheBooks` pins it.

**Made by me, caught by my own first test.** I initially replaced `gross_surplus_kw` with SEM's value.
That breaks energy conservation: AVISHKAR's figure is an accounting quantity the books balance on,
SEM's is a control signal that deliberately subtracts an import, and they are not the same thing. The
test failed with a 3 kW imbalance. The fix was to keep both — `gross_surplus_kw` for the accounting,
`allocatable_surplus_kw` for the control — and to let whatever the control signal withholds leave as
export or curtailment so the books still close. This is the hazard the brief names as "duplicate energy
engines producing inconsistent results", and it was one test away from shipping.

## The application around it

| Check | Result |
|---|---|
| Python EMS suite | **687 passed, 1 skipped** (655 before this work, 554 at the start of yesterday) |
| `ruff` on `src/avishkar_ems app scripts examples tests/avishkar_ems` | clean (the vendor directory is excluded, by design) |
| Platform API, on a real PostGIS | **994 passed** |
| Platform web | **399 passed** |
| Platform engine | **448 passed** |
| The dashboard in Chromium | 0 Streamlit exceptions; the three new metrics, the meter panel and all seven of its inputs render; the page states whether the surplus came from the meter or the sliders |

The browser check matters because the imported code would otherwise have had no caller reachable from
the application: `home_balance.py` accepted grid readings that no screen supplied. That is the failure
mode of "leaving imported modules unused", and the only way to know it is fixed is to open the page.

## The specified three-building scenario

Unchanged by this work and still passing, from yesterday's community allocation engine
(`platform/api/src/community/allocate.ts`): A generates 8 kW and uses 3, B generates 2 and uses 4, C
generates nothing and uses 3; lossless, no battery charging. B receives 2 kW, C receives 3 kW, the
community imports nothing. Verified as a unit test, over HTTP against a real database, and in Chromium.
The deficit scenario and the constrained-feeder scenario are verified alongside it. Details in
[TESTING_AND_VERIFICATION.md](TESTING_AND_VERIFICATION.md).

## Not run

- **Upstream SEM's full suite.** It is a Home Assistant integration: its own tests need `hass`,
  `pytest-homeassistant-custom-component` and the device fixtures, none of which this repository has.
  The 49 tests above are the subset that exercises the vendored pure functions, which is the subset
  that says anything about the copy.
- **evcc's suite.** Nothing from evcc was imported, so there is nothing of its to test here.
- **Hardware.** No inverter, meter, charger or vehicle exists anywhere in this project's reach. The
  live-meter path is driven by figures a person types, labelled `USER_ENTERED`. Nothing here is
  evidence that it reads a real meter correctly.
