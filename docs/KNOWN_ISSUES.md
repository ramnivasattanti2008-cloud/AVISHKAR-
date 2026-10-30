# Known issues and drawbacks (Python EMS and dashboard)

Audit of 2026-10-07, re-checked after the fix pass the same day. Prioritised with
`Priority = (Impact + Risk) x (6 - Effort)`, each scored 1 to 5 (effort inverted). "Verified" means checked against the code
or by running it. `CLAUDE.md` refers to items here by number, so keep the numbers stable and update **Status** in place.
The chronological record of what was done and not done is [WORKLOG.md](WORKLOG.md). The platform effort (the new
specification) is tracked separately in [../platform/STATUS.md](../platform/STATUS.md).

| # | Issue | I | R | E | Priority | Status after the fix pass |
|---|---|---|---|---|---|---|
| 1 | Results did not reproduce; README, `results/` and dashboard disagreed | 5 | 5 | 3 | 30 | **Fixed** (see below) |
| 2 | Silent failure handling hid solver and data problems | 3 | 3 | 1 | 30 | **Fixed** |
| 3 | A self-written protocol check was shown as "Beckn validation" | 3 | 4 | 2 | 28 | **Fixed** (wording); official check still opt-in |
| 4 | No CI; ruff config rewrote files; ruff absent from the venv | 3 | 3 | 2 | 24 | **Fixed** (CI green on GitHub, run 37612815661) |
| 5 | Packaging and deploy leftovers from upstream | 2 | 3 | 2 | 26 | Partly fixed |
| 6 | Payback is a simple, extrapolated figure | 3 | 3 | 3 | 24 | Mitigated; headline stays simple |
| 7 | Test coverage stopped at the library | 3 | 3 | 3 | 18 | **Fixed** (34 to 68 project tests) |
| 8 | Upload tab promised more than it did | 3 | 2 | 3 | 15 | **Fixed** |
| 9 | Dependency pins conflicted | 2 | 3 | 3 | 15 | Resolved except upstream pins |
| 10 | Pickle cache could serve stale results | 2 | 3 | 3 | 15 | **Fixed** |
| 11 | Fault monitor cannot detect real faults on this data | 3 | 4 | 4 | 14 | Labels fixed; limit remains |
| 12 | Fleet pooling is illustrative only | 3 | 3 | 4 | 12 | Disclosed in the UI |
| 13 | `data/` mixes upstream fixtures, inputs and runtime output | 2 | 2 | 3 | 12 | Documented (`data/README.md`) |
| 14 | Cold start and replay are slow | 2 | 2 | 3 | 12 | Mitigated by the cache |
| 15 | Windows-only launcher | 1 | 1 | 1 | 10 | **Fixed** |
| 16 | Many inputs are assumptions, not data | 5 | 4 | 5 | 9 | Open (needs real data); now visible and configurable |
| 17 | The optimiser's edge over a simple rule is small | 4 | 3 | 5 | 7 | Open (a finding, stated in the README) |
| 24 | Streamlit dashboard crashed on import: it could not start at all | 5 | 5 | 1 | 50 | **Fixed** (2026-10-30) |
| 25 | HTML blocks were printed as literal text by Markdown's code-block rule | 4 | 3 | 1 | 35 | **Fixed** (2026-10-30) |
| 26 | Both map builders invented P2P trades, prices and equipment sizes | 4 | 5 | 1 | 45 | **Fixed** (2026-10-30) |
| 27 | Plotly puts a text label at -Infinity on one chart (console warning only) | 1 | 1 | 4 | 4 | Open (2026-10-30) |
| 28 | The documented EMS test runtime assumes a warm cache | 1 | 2 | 1 | 15 | Documented (2026-10-30) |
| 29 | A fresh install resolves pandas 3, not the environment `results/` came from | 2 | 3 | 2 | 20 | Documented (2026-10-30) |
| 30 | Determinism needs an identical interpreter too; the lock file pins only packages | 2 | 2 | 5 | 4 | Documented (2026-10-30); claim corrected |

## Details

**1. Reproducibility and three sets of numbers: fixed.** Before the fix, the committed README (Mathura EMS payback 19.93
years) could not be reproduced: re-running the unchanged code gave 19.38, and the dashboard showed 19.67 because it sampled
every 28 days. One behaviour change moves the numbers back to near the committed ones: sampled days that are not
consecutive no longer inherit each other's battery charge (`payback.evaluate`; each starts from the same state). Now:
`examples/run_demo.py` and `run_sensitivity.py` record their environment in `results/provenance.json`; the README's
result block is generated from `results/` by `scripts/update_readme.py` (CI runs `--check`); the dashboard defaults to
the same 7-day sampling and was verified equal to `results/payback.csv` for all three sites (max difference 1e-11 INR);
`requirements-lock.txt` pins the environment. Current figures: see the README. Why the old committed numbers differed
from a run of the old code is not isolated (the old code was not kept running to bisect it).

**2. Silent failures: fixed.** `logging.disable` is gone from all five entry points. It was hiding a real bug: EMHASS's
`get_logger` adds a stream handler on every call and `plan_day` called it for every plan, so handlers accumulated
over a replay (regression test `test_planning_does_not_leak_log_handlers`). Non-optimal solver status is now logged
(`planner.plan_day`), returned (`Evaluation.non_optimal_days`), printed by `run_demo.py`, and shown as warnings in the
dashboard. A replay of 9 Mathura days with warnings enabled printed none and had no non-optimal day.
`data/last_run.json` with `"status": "error"` is written by the upstream test suite, not by this pipeline.

**3. Beckn badge: fixed in wording.** The UI now says "Passes the project's structural check" and states that it is the
project's own validator (`ies.validate_publish`), modelled on the public devkit, not an official conformance test, with
nothing sent to a live network. The one check against the official example (`test_real.py`) still skips unless
`DEG_PUBLISH_EXAMPLE` points at the devkit's `publish-catalog.json` (the devkit is CC BY-NC-SA, so it is not vendored).

**4. Tooling: fixed.** `.github/workflows/ci.yml` runs lint (`--no-fix`), the project tests and the README check. It has
now run on GitHub (it triggers on every push and pull request); the first run caught a missing platform dependency, fixed. `pyproject.toml` now sets ruff
`fix = false`. ruff is installed in `.venv`. Project code is lint-clean.

**5. Packaging: partly fixed.** Removed the dead `asyncio` PyPI dependency (the venv had `asyncio 4.0.0` installed; stdlib
asyncio is unaffected) and the dead `MANIFEST.in`. Verified harmless and left: `[tool.uv.workspace] members = ["emhass"]`
names a missing directory but `uv sync --dry-run` works. Left on purpose: the distribution is named `emhass` because the
vendored code reads its version from package metadata, so it would replace the real package on `pip install`. The
`Dockerfile` is upstream's add-on image: it copies `src/emhass` only, so the image has no EMS or dashboard (a wheel
builds fine without `src/avishkar_ems`, verified). It was not changed because the Docker engine was not available to test
a change.

**6. Payback model: mitigated.** Added: independent sampled days; the dashboard states how many sampled days and calendar
months a replay covers and warns when months are missing (Mathura: 8 of 12); a lifetime view
(`lifetime.py`: discount rate, tariff rise, wear, running cost, battery replacement, NPV, discounted payback) with
adjustable illustrative assumptions. Fixed charges cancel in a with-versus-without-system comparison, so leaving them out
does not change payback (demand charges would). The headline payback stays the simple one.

**7. Tests: fixed.** Project suite 34 to 68 passed, 1 skipped (the official-Beckn check). New: cache, dashboard smoke,
assumptions and weather cache, own-meter analysis, lifetime, report generation, evaluation independence and coverage, log
handler leak. The vendored upstream suite, run in a clean copy with `.[app,test]` installed, gave 1233 passed,
32 xfailed, 1 failed (`test_web_server` needs the unvendored `docs/api/healthz.schema.json`); `tests/test_openapi.py`
cannot be collected (needs the unvendored `generate_openapi`). It takes about 11 minutes and is not part of the project loop.

**8. Upload tab: fixed.** The tab now runs a real analysis (`mysite.analyse`, shared with
`examples/analyze_my_site.py`): payback with and without smart control, subsidy, battery-size advice, downloadable
report. Bugs found and fixed while building it: the CLI crashed at the last step on a normal install (`to_markdown` needs
`tabulate`, which was only in the test extra); weather from a leap year crashed when laid over ordinary years; and the
PVGIS weather cache key ignored latitude and longitude, so any custom site silently reused another place's weather.
A bundled demo site's weather is reused offline when place and panel angles match; an unreachable PVGIS now gives a plain
message instead of a traceback. Verified end to end on the CEEW MH21 meter (1,063 days, offline, about 90 s).

**9. Dependencies: resolved except upstream pins.** `pip install -e ".[app,test]"` resolves (verified). `aiohttp<3.13` is
pinned only in the `test` extra and does not affect the project. Left: upstream's exact `uvicorn==0.30.6` pin.

**10. Cache: fixed.** `avishkar_ems/cache.py`: atomic writes, recompute on a corrupt or incompatible file, a fingerprint of
code, tariffs, data and library versions, a dashboard warning when it no longer matches, pruning of old day views.
Modules that only format results (`report`, `mysite`, `lifetime`, `explain`, `summary`) are excluded from the fingerprint so
editing text does not invalidate results.

**11. Fault monitor.** Verified on all three sites: `expected_kw == pv_kw` because generation is modelled from real
irradiance, so the monitor compares a series with itself and only the injected fault can trigger it. The chart now plots
`pv_clear_kw` and the tab says what it compares. Real use needs real inverter telemetry.

**12. Fleet pooling.** Sites are in different cities and periods (Mathura 2020-21, Pune and Jaipur 2023), so only Pune and
Jaipur ever pool, on 2023 dates. A hidden branch that added two synthetic "peer rooftop" sites is removed; the tab uses
the offers it displays and names the sites it pooled.

**13. `data/` layout.** Not moved (upstream tests and image expect it); explained in `data/README.md`. Runtime files are
git-ignored.

**14. Performance.** A warm single-day plan takes about 0.5 s (measured). A cold cache takes several minutes
(`prepare` trains the PV and load quantile models; a replay solves several LPs per sampled day).
`scripts/precompute_cache.py` is the mitigation; replays were not parallelised.

**15. Portability.** `run-dashboard.sh` added next to `run-dashboard.cmd` (syntax-checked; not run on Linux or macOS).

**16. Assumed inputs** (README "Limitations"): generation is modelled; the P2P price is `p2p_share` (default 0.55, set in
the tariff JSON) of the way from export to retail; export rates, battery price (Rs 25,000/kWh, one constant in
`advisor.py`) and system costs are assumptions; shop and clinic load is a German factory profile with generated
outages; day-ahead forecast inputs are persistence of yesterday; outage-risk weights are heuristics. The dashboard
sidebar lists what is real and what is assumed. These cannot be fixed without real data.

**17. Small optimiser edge.** Against a fixed-rule battery the EMS is within about +/-1% on benefit at all three sites
and at Mathura the simple rule is marginally ahead. Its clearer value is the reserve, offers and settlement. This is a
result, stated in the README and the demo guide, not a defect.

## Phase 3 additions (2026-10-22)

**18. Monitoring validation.** `src/avishkar_ems/monitor.py` now runs `validate_readings()` before any deviation
analysis.  The validator refuses missing columns, NaN values, negative powers and timestamp gaps larger than
90 minutes.  This is a data-quality gate, not a fault detector: it prevents downstream logic from operating on
malformed telemetry.  See `tests/avishkar_ems/test_monitoring.py`.

**19. Forecast model-fit cache.** `src/avishkar_ems/forecast_cache.py` provides an in-memory LRU cache for fitted
forecasting models, keyed by a SHA-256 of the training data and the model configuration.  In addition,
`platform/engine/avishkar_engine/load.py` contains an LRU model-fit cache keyed on input data and parameter hashes,
speeding up repeated API solver calls. Tests: `tests/avishkar_ems/test_forecast_cache.py`, `platform/engine/tests/test_load.py`.

**20. Risk-aware optimisation and replanning trigger.** `src/avishkar_ems/risk_optim.py`
implements deterministic worst-case (maximin) evaluation across four explicit scenarios
(baseline, solar shortfall, demand surge, combined adverse) with an adjustable risk-aversion
parameter `alpha` and a shortfall penalty on unmet demand. No probability calibration is assumed.
Includes `ReplanningTrigger` to detect forecast and telemetry drift based on data hashes and
numerical deviation thresholds. Tests: `tests/avishkar_ems/test_risk_optim.py` (5 tests, passing).

## Phase 4 additions (2026-10-22)

**21. Tariff catalogue audit.** `src/avishkar_ems/tariff_catalog.py` loads every tariff JSON in
`data/tariffs/`, reads its `meta` block, and reports a status: `CURRENT`, `EXPIRED`,
`NOT_YET_EFFECTIVE` or `UNVERIFIED` (no source or effective dates).  `select_current` and
`select_for_consumer` pick the right record for a date and consumer type.  No prices are invented:
a record whose source is missing or whose effective period has passed is reported, not used.
Tests: `tests/avishkar_ems/test_tariff_catalog.py` (7 tests, passing).

**22. Meter CSV validation.** `src/avishkar_ems/userdata.py` now detects empty files, missing usage
columns, non-numeric readings, negative readings and duplicate timestamps.  Rows that cannot be
parsed are dropped; nothing is silently filled in.  Wh columns are converted to kW correctly.
Tests: `tests/avishkar_ems/test_meter_validation.py` (7 tests, passing).

**23. Account export now carries the meter readings.** `platform/api/src/account/holdings.ts`
and `platform/api/src/routes/account.ts` include up to 1,000 meter readings per property (timestamp, kWh, interval minutes) in the
`meterReadings.rows` array, in addition to the counts that were already there.  The export is
authorised by the signed-in user only and never contains another person's data, passwords or
tokens.  Test: `platform/api/test/account-deletion.test.ts` checks the row count and shape.


## Found on 2026-10-30, by running the applications rather than reading them

**24. The dashboard could not start.**  `app/dashboard.py` crashed on import.  `app/home_setup_view.py`
imported `route_community_exchange` from `avishkar_ems.home_balance`, where no such name existed; the engine
has a *method* of that name with a different signature, and the tests call the method, so the whole suite
passed while `run-dashboard.sh` showed nothing but an ImportError.  Two further mismatches sat behind it:
the view passed `measurement_mode` to `IntervalTelemetry`, which had no such field, and read
`profile.battery.chemistry`, which did not exist.  Fixed: the module-level function the view was written
against is implemented (I^2R feeder loss from the current the transfer draws, caps named, opt-in on both
sides required, nothing counted twice, caller's prices only), `IntervalTelemetry` carries an optional
per-reading `measurement_mode` that the engine prefers over the home's, and `BatteryConfig.chemistry`
defaults to `NOT_STATED` with nothing inferred from it.  Tests:
`tests/avishkar_ems/test_community_exchange.py` (28 tests, passing).
**Why no test caught it:** `tests/avishkar_ems/test_dashboard.py` skips itself unless the disk cache is
fresh, and nothing else imports `app.dashboard`.  A test that merely imports the dashboard modules would
have caught all three in one line.

**25. HTML was printed as text on the page.**  `st.markdown(..., unsafe_allow_html=True)` still runs the
string through Markdown first, and Markdown treats a blank line followed by a line indented four spaces or
more as a *code block*.  The HTML in these views is written indented with blank lines between sections, so
everything after the first such blank line was shown as text: readers saw `<!-- Active Animated Flow Lines
-->` and raw `<path d="...">` where the power-flow map should have been, on the front page.  36 blocks
across the four view files were affected.  Fixed: `app/ui_html.py` strips the indentation at the render
boundary (42 call sites), which cannot form a code block and leaves any Markdown in the same string working;
it refuses a block containing `<pre>` or `<textarea>`, where that whitespace would matter.

**26. The maps invented trades and equipment.**  `build_microgrid_plotly_map` and
`build_microgrid_map_deck` in `src/avishkar_ems/satellite.py` each hardcoded three peer-to-peer trades with
made-up energies and prices (6.8 kWh at INR 7.25, and so on) and drew them between real Indian cities, while
the `trades` parameter both accept was ignored.  The EMS publishes *offers* -- a seller, an hour, an amount
and a price -- and never matches them to a buyer, so an arrow between two cities asserted a market that does
not exist.  They also fell back to invented sizes (`15.0 if "shop" in k else 3.0 if "home" in k`) for any
node with no configured site.  Fixed: both draw only the trades they are given, skip a trade naming a node
they do not know, and report equipment as "not configured in AVISHKAR" rather than guessing a size.
Test: `tests/avishkar_ems/test_satellite.py::test_build_microgrid_plotly_map`.

**27. Something asks Plotly to place a text label at -Infinity.**  Opening the dashboard in Chromium leaves two
console errors, `<text> attribute y: Expected length, "-Infinity"`, raised inside Plotly's own bundle.  The page
renders, no Streamlit exception is raised, and no figure on it is wrong.  Nothing in AVISHKAR's own arithmetic
produces the value: `-Infinity` is computed inside Plotly's layout code from the size of the box it is given.

What was ruled out, each by an experiment rather than by reasoning:

- **Not the SoC gauge's values or step ranges.**  The plot without axis types is an `indicator` trace, and the only
  `go.Indicator` in the repository is the battery gauge at `app/home_setup_view.py:344`.  Rendered on its own in a
  one-file Streamlit app, with the same values and the same four coloured bands, it produces **no** error.
- **Not its height.**  Raising it from 240 px to 300 px with a larger top margin changed nothing.
- **Not a tile failure.**  Carto's tile host answers 200 from this container.
- **Not a chart laid out inside a hidden container.**  A chart in a collapsed `st.expander` and a chart in an
  inactive `st.tabs` panel, in a one-file app, produce **no** error either.  (An earlier version of this entry
  offered that as the likely explanation; it is wrong, and the experiment is why.)

It is also **not specific to one view**: both console errors appear on the personal-home view and again on the
State & National Explorer, which share no charts.  Two errors each time is consistent with one `gauge+number`
indicator emitting one for its title and one for its number, but the only indicator in the repository is on the
home view, so that does not fit either.

Open, cosmetic, and deliberately left alone: four hypotheses have been tested and none holds, so any change now
would be a guess at code that is not misbehaving in any way a reader can see.

**28. The documented test runtime assumes a warm cache.**  `CLAUDE.md` gives the EMS suite as about 100 s.
With an empty `data/cache/` it took **41 minutes 27 seconds** here (554 passed, 1 skipped), because every
test needing `prepared_<site>` trains the quantile models from scratch; the same suite then ran in 91 s once
the cache existed.  Run `python scripts/precompute_cache.py` first, or expect the long run.

**29. A fresh install is not the environment the results came from.**  `pip install -e ".[app,test]"`
resolves `pandas>=2.2.0` to pandas 3.0.5, which emits `Pandas4Warning` deprecations from `bands.py` and
pvlib (101 warnings, all harmless here).  `requirements-lock.txt` is the environment `results/*.csv` and the
README's numbers came from, and reproducing them to the stated 1e-11 INR needs that file, not the pyproject
ranges.  Install with `pip install -r requirements-lock.txt` when reproducing results.


**30. Determinism needs a genuinely identical environment, and the lock file does not pin all of it.**
Issue 1 says the pipeline reproduces, and in an identical environment it does: two independent
`examples/run_demo.py` runs here produced **bit-identical** `payback.csv` and `forecast_quality.csv` (0 differing
fields out of 15 rows and 10 rows).

But the `results/` committed earlier on 2026-10-30 differed from a regeneration here in the fifth significant
figure -- Mathura's EMS annual benefit 15298.23 against 15300.00 INR, about 0.01%, and the README's payback moving
19.94 to 19.93 -- and the differences fell **only** on the variants the linear programme plans (`EMS`,
`EMS + noon re-plan`, `perfect foresight`), never on `battery idle` or `fixed-rule battery`, which do not go
through it. Forecast band coverage at Mathura moved from 78% to 76%.

Every library version in `results/provenance.json` matched the regeneration exactly, so this is not library
drift. What differed is recorded in the same file: **Python 3.12.10 before, 3.12.3 now.**
`requirements-lock.txt` pins the packages but not the interpreter, and `.python-version` says only `3.12`. A
different interpreter build can change the order of floating-point accumulation in the model fit, which moves the
optimiser's inputs by a hair and occasionally changes which of two near-equal schedules HiGHS returns -- which is
exactly the pattern observed. A different CPU or BLAS would do the same; neither can be separated from the
interpreter difference with what was recorded, and no stronger claim is made here than the evidence supports.

Nothing is wrong with either set of numbers, and no conclusion in the README turns on the fifth figure: the
optimiser's small edge over a fixed rule, the battery being a backup purchase at Mathura, and the band coverage
being wide at the commercial sites all stand unchanged. What was wrong was the claim. `CLAUDE.md` said "a rebuild
is bit-identical" with no qualifier and now states what identical has to include. `results/` and the README block
were regenerated here in the locked environment so that the committed numbers, the code fingerprint and
`scripts/update_readme.py --check` agree again.

**If the exact published numbers matter to you**, pin the interpreter as well as the packages. Recording
`python: 3.12.10` in `provenance.json` was what made this diagnosable at all, and that was already being done.
