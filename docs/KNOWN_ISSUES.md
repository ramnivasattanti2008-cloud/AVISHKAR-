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
| 5 | Packaging and deploy leftovers from upstream | 2 | 3 | 2 | 20 | Partly fixed |
| 6 | Payback is a simple, extrapolated figure | 3 | 3 | 3 | 18 | Mitigated; headline stays simple |
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
