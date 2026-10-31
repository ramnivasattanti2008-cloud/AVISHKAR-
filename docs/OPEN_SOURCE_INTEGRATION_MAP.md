# Open-source integration map

Every component of somebody else's code that is in AVISHKAR, where it came from, and what holds it
honest. The decisions behind the table, including what was deliberately *not* reused and why, are in
[OPEN_SOURCE_REUSE_AUDIT.md](OPEN_SOURCE_REUSE_AUDIT.md).

Status labels: `VERIFIED` means a command run in this repository exercises the component and passes,
and the row names it.

---

## 1. EMHASS — the planner (predates this session)

| | |
|---|---|
| **Upstream** | https://github.com/davidusb-geek/emhass |
| **Commit** | `237d0fe4089f76ff5f8bbcae24876e64008e60ad` (2026-09-29) |
| **Licence** | MIT, David Hernandez Torres. Kept as the repository's own `LICENSE`; recorded in `NOTICE.md` |
| **Method** | Option A, direct source reuse: the whole package |
| **Source** | the whole of `src/emhass/` |
| **Destination** | `src/emhass/`, unmodified. Only `pyproject.toml` was edited, to package `avishkar_ems` and add a Streamlit extra |
| **Dependencies** | scipy/HiGHS, pvlib, pandas, numpy, cvxpy, skforecast — all in `requirements-lock.txt` |
| **Adaptation** | None to upstream. `src/avishkar_ems/planner.py` builds an EMHASS configuration and calls it; `planner._base_params` applies overrides to whichever config section holds each key, and raises `KeyError` on a key EMHASS has renamed, which is how a version mismatch announces itself |
| **Replaces** | Nothing — AVISHKAR was built on it |
| **Improves** | It *is* the optimiser: a mixed-integer linear programme per day, with the reserve floor applied as EMHASS's battery minimum SoC so the reserve is a hard constraint inside the solve rather than a clamp afterwards |
| **Tests** | `tests/avishkar_ems/test_pipeline.py` (including `test_plan_never_dips_below_reserve_floor`); the whole 688-test EMS suite runs through it. Upstream's own suite is in `tests/test_*.py` and needs a separate environment |
| **Status** | `VERIFIED` |
| **Limitations** | The clone taken for this audit is at `f1e99c5`, so upstream has moved. Re-vendoring is a deliberate exercise: `results/*.csv`, the README's numbers and the dashboard cache are fingerprinted against the vendored code and all have to be regenerated with it. Listed in next actions, not done here |

## 2. SEM — surplus arithmetic

| | |
|---|---|
| **Upstream** | https://github.com/traktore-org/sem-community |
| **Commit** | `067c8615a36fbad2cc912a005f63525038093b07` |
| **Licence** | MIT, Copyright (c) 2025 belinea4071. Text at `src/avishkar_ems/vendor/LICENSES/sem-community-MIT.txt` |
| **Method** | Option A, direct source reuse: seven functions, verbatim |
| **Source** | `coordinator/surplus_controller.py` — `solar_bounded_surplus` (380-445), `loads_import_deficit_w` (448-462), `import_absorbed_by_loads_w` (465-479), `reclaim_handed_back` (489-499), `solar_bounded_reclaim` (502-532), `sun_can_still_finish` (535-581), `price_damped_pool` (612-642); `coordinator/price_signal.py` — `_name` (83-87); `tariff/tariff_provider.py` — the values of `EXPENSIVE_LEVELS` (307) |
| **Destination** | `src/avishkar_ems/vendor/sem_surplus.py` |
| **Dependencies** | None. Pure float arithmetic, standard library only |
| **Adaptation** | Bodies and docstrings extracted with `ast.get_source_segment`, not retyped, and unedited. Added around them: the module header, `IMPORT_DEADBAND_W` and `DEFAULT_REGULATION_OFFSET`, the `_name`/`is_expensive_name` helpers inlined so the module stands alone, and `from __future__ import annotations` so the quoted `Optional[float]` annotations resolve. Excluded from ruff (`pyproject.toml`) so our formatting rules cannot rewrite it |
| **Replaces** | The `generation - demand` surplus in `home_balance.py`, for the case where a live grid meter exists |
| **Improves** | Surplus is now feedback-free (the EMS's own load draw is added back, so the controller does not chase its own tail), clamped to the generation (so a load running off the battery at night is not read as surplus), and aware of an import the sun did not fund, of a zero-export inverter's deliberate 100 W import, and of a charger's own grid draw |
| **Tests** | **49 of upstream's own tests, verbatim**, run against this copy: `tests/avishkar_ems/test_vendored_sem_surplus.py`. Plus 26 of AVISHKAR's own for the wiring: `tests/avishkar_ems/test_surplus_vendor_wiring.py` |
| **Status** | `VERIFIED` |
| **Limitations** | Only the pure arithmetic is here. SEM's device walk (`SurplusController`, `compute_load_intent`, `tier1_battery_reserved_w`, `surplus_reserved_w`) needs its `ControllableDevice` and Home Assistant lifecycle and is not vendored, so AVISHKAR's own priority cascade still does the allocating |

## 3. SEM — battery-charge reclaim

| | |
|---|---|
| **Upstream / commit / licence** | As row 2 |
| **Method** | Option A, direct source reuse: a whole file, byte for byte |
| **Source** | `coordinator/energy_reclaim.py`, all 299 lines |
| **Destination** | `src/avishkar_ems/vendor/sem_reclaim.py` |
| **Dependencies** | None at module level. One function-local `from .sensor_reader import EV_ACTIVE_CHARGE_FLOOR_W` inside `car_may_be_charging` |
| **Adaptation** | **None.** A comment block is prepended; everything after it is upstream's file unchanged, and a `assert written[len(note):] == src` check at vendoring time proved it. The one relative import is satisfied by `src/avishkar_ems/vendor/sensor_reader.py`, a stand-in holding only that constant at its upstream value — written rather than vendoring 6,988 lines of Home Assistant entity plumbing for one float, and chosen over editing the import out so that the file stays byte-identical and upstream's tests still apply |
| **Replaces** | Nothing. This is a capability AVISHKAR did not have |
| **Improves** | "Loads charge before the battery": above the backup reserve, power going into the pack is offered to higher-priority loads first, and only the share the sun is funding — an inverter filling its pack from the grid on its own time-of-use window shows the same positive charge power with nothing behind it but the meter. Also brings the sustained-reading helpers, which require a meter or charger reading to *last* before it is acted on |
| **Tests** | Included in the 49 upstream tests above (`TestThePoolKeepsTheImport`, `TestOnlyAnImportThatLastedCounts`, `TestWhatOpensTheWindow` exercise this file). AVISHKAR's wiring tests: `TestTheBatteryReclaimIsWiredIn`, 7 tests |
| **Status** | `VERIFIED` |
| **Limitations** | `held_grid_import`, `ev_reclaims_battery_charge` and `redirect_strikes` are vendored but not yet called by AVISHKAR — they belong to SEM's charger arbitration, which AVISHKAR has no equivalent of. They are tested by upstream's suite and are there because the file was taken whole rather than cherry-picked |

## 4. evcc — not imported

| | |
|---|---|
| **Upstream / commit** | https://github.com/evcc-io/evcc, `e2240501caa2c3aae1ce021528cde75997427ca1` |
| **Licence** | MIT — so copying would have been permitted |
| **Method** | **None.** 1,373 Go files and a Vue front end; AVISHKAR is Python and TypeScript, so there is no in-process reuse |
| **Why not a service** | evcc exists to drive real chargers. No charger, inverter or vehicle is reachable from this project, so running it here would add a daemon that could only talk to simulated devices — implying a hardware integration that has never been tested. Recommended as the path for whoever first attaches real hardware |
| **What was done instead** | A correction. `surplus_engine.py` claimed to synthesise evcc (among seven others) when it was written from scratch; its docstring now says which parts are AVISHKAR's own, that the charging-mode names follow evcc's published convention, and that none of its code is present. `NOTICE.md` says the same |
| **Status** | `NOT_APPLICABLE` (language and hardware, not licence) |

## 5. SolarFlow — not imported

| | |
|---|---|
| **Upstream / commit** | https://github.com/lbsanto/SolarFlow, `cde543e5d3013c79c997259f600de5d9ff7cbfc4` |
| **Licence** | Apache-2.0 — usable, with notice |
| **Method** | **None.** A Node-RED flow bundle for driving Zendure SolarFlow hardware over MQTT: 18 JavaScript files, most of it in `dist`, plus per-platform deploy scripts. There is no library to call and no algorithm separable from the Node-RED runtime and that hardware |
| **Status** | `NOT_APPLICABLE` |

## 6. smart-energy-manager — inspected, nothing imported

| | |
|---|---|
| **Upstream / commit** | https://github.com/jirihelmich/smart-energy-manager, `56ff9cea865a3d556150fd73e779315ce0f81da1` |
| **Licence** | MIT — usable |
| **Method** | **None**, after inspecting the two modules worth considering. Both are Home-Assistant-free and would have imported cleanly; neither earns its place |
| **`forecast_corrector.py` (84 lines)** | A sliding-window multiplicative bias correction on a day's solar forecast total. Declined because it is the wrong shape for where AVISHKAR would use it: `platform/engine/avishkar_engine/solar.py` already learns from the place's own past day-ahead errors, binned by sky condition, and already reports the bias it measures (`bias_kw`, `median_residual_kt`). A second correction on a daily total would double-count against that calibration, and the natural correction in that model is in clearness space, which it already computes. The Python EMS fits its own gradient-boosted model to the site, so it is unbiased on its training distribution by construction |
| **`price_analyzer.py` (232 lines)** | Cheapest contiguous window selection. Declined because AVISHKAR's `src/avishkar_ems/loads.py::best_start` is better for the job: it works at the pipeline's 15-minute resolution rather than hourly, and it prices the opportunity cost of using spare solar (energy the sun covers costs the export income it displaces) rather than looking at price alone. Importing it would have been a regression |
| **Status** | `NOT_IMPLEMENTED`, deliberately |

---

## How to reproduce the provenance claims

```bash
mkdir -p /tmp/oss-research && cd /tmp/oss-research
git clone https://github.com/traktore-org/sem-community.git sem
git -C sem checkout 067c8615a36fbad2cc912a005f63525038093b07
```

```bash
# the vendored reclaim file is byte-identical to upstream's after its comment block
python - <<'EOF'
import pathlib
ours = pathlib.Path("src/avishkar_ems/vendor/sem_reclaim.py").read_text()
theirs = pathlib.Path("/tmp/oss-research/sem/coordinator/energy_reclaim.py").read_text()
print("byte-identical:", ours.endswith(theirs))
EOF
```

```bash
# upstream's own tests, against our copies
.venv/bin/python -m pytest tests/avishkar_ems/test_vendored_sem_surplus.py -q
```

```bash
# AVISHKAR's tests for the wiring
.venv/bin/python -m pytest tests/avishkar_ems/test_surplus_vendor_wiring.py -q
```
