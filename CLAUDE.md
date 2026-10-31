# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AVISHKAR EMS (FET Hackathon, problem statement #2): predictive energy management and P2P surplus dispatch for Indian
solar-plus-battery sites. The planning engine is **EMHASS, vendored unmodified in `src/emhass/`** (see `NOTICE.md`).
Everything original lives in `src/avishkar_ems/`, the Streamlit dashboard `app/dashboard.py`, `examples/` and `scripts/`.

Two efforts live here. (1) The **Python EMS** above, finished and documented in this file. (2) The **AVISHKAR platform**
(`platform/`): a larger TypeScript + PostGIS + map product defined by `platform/SPEC.md`, being built in phases.

Read order for a new session: this file, then **`docs/WORKLOG.md`** (what was done and what was NOT done, newest last;
append to it before you stop), then `docs/KNOWN_ISSUES.md` (Python EMS drawbacks), then `README.md` (results,
"How it works", limitations). For the platform: `platform/STATUS.md` (honest ledger per spec section),
`platform/ARCHITECTURE.md` (decisions D1..D22), `platform/SPEC.md` (the owner's requirements). `platform/docs/ACCEPTANCE.md` is the spec's final acceptance walk with what it found. `docs/DEMO_GUIDE.md` is the
demo-video script, `docs/RESEARCH.md` the competitor/rules notes.

## Commands

Use the project venv: `.venv/Scripts/python.exe` (Python 3.12; `requirements-lock.txt` is the exact package set the
current `results/*.csv` came from). Below, `python` means that interpreter. `run-dashboard.cmd` sets `PYTHONUTF8=1` (the UI
has ₹ and Hindi text); do the same when you launch the dashboard another way.

```bash
python -m pytest tests/avishkar_ems -q -p no:cacheprovider    # project tests, ~100 s WITH a warm cache; 40+ min from cold
python -m pytest tests/avishkar_ems/test_pipeline.py::test_plan_never_dips_below_reserve_floor   # a single test
python -m ruff check src/avishkar_ems app scripts examples tests/avishkar_ems --no-fix          # lint (ruff is in the venv)
python scripts/update_readme.py [--check]  # regenerate (or verify) the README results block from results/

run-dashboard.cmd | ./run-dashboard.sh    # or: python -m streamlit run app/dashboard.py  -> http://127.0.0.1:8501
python scripts/precompute_cache.py         # pre-warm the dashboard cache for 7/14/28-day samplings (minutes; safe to re-run)
python scripts/precompute_cache.py --rebuild   # wipe and rebuild: REQUIRED after changing code, tariffs or data
python examples/run_demo.py [--quick]      # replay all sites -> results/payback.csv, forecast_quality.csv, example_offers.json
python examples/run_sensitivity.py         # battery size / export rate sweep -> results/sensitivity.csv (slow)
python examples/analyze_my_site.py --help  # payback and battery advice from your own meter CSV (same code as the Upload tab)

# after run_demo + run_sensitivity: python scripts/update_readme.py   (never edit the README block between the markers by hand)
```

`tests/test_*.py` at the top level and `tests/ui/*.cjs` are upstream EMHASS tests, not part of the project loop. The
`.venv` was installed from `.[app]` only (no `aioresponses`; aiohttp is 3.14 where the `test` extra pins `<3.13`), so run
them in a separate venv with `.[app,test]` (about 11 minutes; last result 1233 passed, 1 failed on a missing upstream
docs file, `tests/test_openapi.py` cannot be collected). Never run them inside the repo checkout you care about: they
write into `data/`.
`test_dashboard.py` skips itself unless the cache is fresh; `test_real.py` skips one Beckn check unless
`DEG_PUBLISH_EXAMPLE` points at the devkit's `publish-catalog.json`.

## Architecture

One day at a time, per site, the pipeline is (all 15-minute, tz-aware, 96 steps/day):

1. **Data frame** (`schema.py` is the contract and validator). Produced by `realdata.real_site_frame` (PVGIS weather +
   measured load; Mathura uses CEEW meter MH43 with measured outages) or `sim.simulate_site` (fully synthetic, used by
   unit tests). `SiteSpec` (`site.py`) and `Tariff` (`tariffs.py`) describe a site; `realdata.real_sites()` is the
   registry of the three demo sites and lets `data/tariffs/<site>.json` override the preset tariff.
2. **Forecast** (`bands.QuantileBands`): P10/P50/P90 gradient-boosted quantile models with conformal calibration of the
   tails; PV is modelled as a clearness ratio times `pv_clear_kw`.
3. **Reserve** (`reserve.reserve_floor`): SOC floor from critical kW x backup hours x outage-risk uplift, counted above
   the unusable depth-of-discharge band. `outage_risk` is a heuristic noisy-OR of notice, storm and 90-day history.
4. **Plan + offers** (`engine.plan_and_offer`, two passes): `planner.plan_day` builds an EMHASS config, feeds the LP
   P50 forecasts and sets the battery minimum SOC to the reserve floor, so the reserve is a hard constraint inside the
   optimiser. `dispatch.build_offers` sizes hourly offers on P10 PV + battery discharge - P90 load. Pass 2 re-plans with
   the P2P price applied only inside the committed windows.
5. **Execute** (`execute.execute_day`): replays a day against actual PV, load and outages. Policies `guided` (the EMS: follows
   the plan's price signal, reacts to real load and sun), `greedy` (fixed-rule baseline), `idle`, `plan` all share one
   battery model so comparisons are fair. During an outage only `critical_kw` is backed up.
6. **Settle and evaluate** (`settle.settle`, `payback.evaluate`): delivered vs committed energy, shortfall penalty, then
   benefit vs the no-system bill for EMS, idle, fixed-rule, perfect-foresight and noon-replan (`intraday.py`) variants.
   Payback = system cost / annualised benefit, annualised from *sampled* days (`every_days`).
7. **Protocol** (`ies.py`): Beckn DEG v2.0 `catalog/publish`, confirm / on_confirm / settled messages and the project's own
   structural validators. Nothing is ever sent to a network.

`demo.py` wires steps 1-6 for the dashboard and scripts (`prepare` trains the models, `day_view` is one planned day,
`run_payback` the replay). Side modules: `monitor` (generation vs expected), `fleet` (pooled offers, pro-rata split),
`flex` (shiftable load bursts), `loads` (cheapest appliance start), `advisor` (battery sizing), `explain`/`summary`
(English and Hindi text), `userdata` (meter CSV reader), `subsidy`, `ceew`. Added 2026-10-07: `cache` (disk cache,
fingerprint, provenance), `mysite` (own-meter analysis, shared by the CLI and the Upload tab), `lifetime` (discounted
payback and NPV with adjustable assumptions), `report` (renders the README results block from `results/`).

Conventions: INR everywhere. In plans `batt_kw` is + discharge / - charge and `grid_kw` is + import / - export. The step
constants `planner.STEP_H`, `execute.DT` and `sim.STEPS_PER_DAY` are separate copies of 0.25 h / 96.

### Vendored third-party source

Two places hold somebody else's code, and they are treated differently from everything else:

- `src/emhass/` -- upstream EMHASS, unmodified (below).
- `src/avishkar_ems/vendor/` -- **added 2026-10-31.** Pure functions vendored verbatim from SEM
  (`traktore-org/sem-community`, MIT, commit `067c8615`): `sem_surplus.py` (seven functions of surplus
  arithmetic) and `sem_reclaim.py` (the whole of upstream's `energy_reclaim.py`, byte for byte).
  `sensor_reader.py` is a stand-in holding the single constant `sem_reclaim` imports from a 6,988-line
  Home Assistant module AVISHKAR does not need. Licence text in `vendor/LICENSES/`.

  **Do not edit the vendored bodies and do not reformat them.** 49 of upstream's own tests are run
  against these copies by `tests/avishkar_ems/test_vendored_sem_surplus.py`, which is the only thing
  that makes them a copy rather than a paraphrase; an edit silently invalidates it. The directory is
  excluded from ruff in `pyproject.toml` for the same reason. To change behaviour, change the caller.

  What they buy: `home_balance.py` computes the **allocatable** surplus from a live grid meter with
  `solar_bounded_surplus` (feedback-free, clamped to the generation so a load on the battery at night
  is not read as surplus, aware of an import the sun did not fund and of a zero-export inverter's
  deliberate 100 W) plus the battery-charge reclaim. Two surplus figures now exist and must not be
  conflated: `gross_surplus_kw` is the accounting value the first-law check balances on, and
  `allocatable_surplus_kw` is the control signal, which deliberately subtracts an import. Conflating
  them breaks energy conservation. Provenance and what was deliberately NOT reused (evcc: Go, and no
  hardware; SolarFlow: a Node-RED bundle; smart-energy-manager: its two useful modules are the wrong
  shape or worse than ours) are in `docs/OPEN_SOURCE_REUSE_AUDIT.md` and
  `docs/OPEN_SOURCE_INTEGRATION_MAP.md`.

### Vendored EMHASS

Do not edit `src/emhass/` or the upstream tests; the package keeps the name `emhass` because the vendored code reads its
version from package metadata. `planner._base_params` loads EMHASS's defaults and applies overrides to whichever config
section holds each key (it raises `KeyError` on a missing key, which means an EMHASS version mismatch). The planner turns
off EMHASS's default deferrable loads: this EMS plans PV, battery and grid only.

## Platform (TypeScript, `platform/`)

Status per spec section: `platform/STATUS.md`. Decisions: `platform/ARCHITECTURE.md`. Backend phases 1 and 2 are done and
verified (auth, properties, PostGIS, geocoding, weather, solar resource, building outline, satellite metadata, Energy Twin),
and `platform/web` shows them (map, property page, forecast charts, system health). Tariffs, policy rules and the eligibility
calculator (milestone 3a, WORKLOG entry 8), assets, meter-data import and Energy DNA (milestone 3b, entry 9), and the Python
engine with solar and load forecasts and the planner (milestone 4, entry 10) are built, and so are the engines on top of them
(learning loop, yearly what-if and economics, opportunities, Copilot and report, community view and VPP simulator; entry 10).
The demo world (`api/src/demo`, DEMO relabelling hook), the cloud-front scenario (`api/src/cloudfront`), plan recommendations with confidence (`api/src/plan/explain.ts`) and resilience and autonomy (`api/src/resilience`), human control (`api/src/control`, no device: an approval is only a record), background jobs (`api/src/jobs`, `JOBS_ENABLED`) and the admin API (`api/src/admin`, grant with `pnpm -C platform/api db:make-admin <email>`), the Today view (`api/src/today`: reads stored forecasts and the latest plan, recomputes nothing) are built too, and the Account page (`web/.../account`, `api/src/routes/account.ts`, `api/src/account/holdings.ts`): when a provider call changes what coordinates it sends, change the precision statements in `AccountView.tsx` and `docs/SECURITY.md` with it; the audit log is append-only (a trigger), and account deletion erases the user link and the address from its rows through the one edit the trigger allows (`test/account-deletion.test.ts` compares the whole database before and after). Energy health and waste (`api/src/insight`: `calc.ts` is pure arithmetic on one stored plan, no weights, no overall score; the Health tab; Copilot tools `getEnergyHealth` and `getEnergyWaste`) read the latest plan and are SIMULATED. Energy futures (`api/src/futures`, the Futures tab) plan the next 24 hours afresh on eight days, each saying what it is built from, with no probabilities. The every-kWh ledger (`api/src/allocation/ledger.ts`, a section of the Plan tab) follows a stored plan's energy from source to sink by a stated order (the optimiser records no such thing), with a check that each hour's energy is in exactly one place. Note the plan's `selfConsumptionRatio` is solar not thrown away (exports count), not solar used on site. `pnpm -C platform/api bench` times the spec's targets against a running API and engine (creates a throwaway account). The city energy map (`api/src/city`, the City page) shows the solar resource per cell and the owner's own properties, and states that a city's demand, storage, vehicles, flexibility and risk have no source. Deployment files (`platform/docker/*.Dockerfile`, `platform/docker-compose.yml`, `engine/requirements-runtime.txt`) **were built and run on 2026-10-30** where a Docker daemon was available: all four services reach `healthy`, migrate and seed work, and the containerised stack passes journey 41/41, browser 21/21 and smoke 12/12 (`platform/STATUS.md`, the deployment section). Two defects it found are fixed: `db:seed` could not reach `data/` from inside the image (the api service now mounts it and sets `SEED_DATA_DIR`), and the map was blank in every container because `NEXT_PUBLIC_OSM_TILE_URL` arrives as an empty string and `basemaps.ts` took it as the tile URL. The owner's own machine still has no usable Docker engine; a sandbox that intercepts TLS additionally needs `--network=host` and a CA layer, which is not committed. Before trusting any restart, check for a stale `next start`, API or uvicorn on 3000/8080/8090 -- with bash's `/dev/tcp`, since `ss` and `netstat` are absent from many containers.

```bash
pnpm -C platform install                      # also generates the Prisma client
pnpm -C platform/api typecheck && pnpm -C platform/api lint && pnpm -C platform/api build
pnpm -C platform/api test                     # unit + integration on a REAL PostGIS (DATABASE_URL_TEST in platform/api/.env)
pnpm -C platform/api test:live                # calls the real public providers; on demand, never in CI
pnpm -C platform/api db:migrate               # apply prisma/migrations to DATABASE_URL
pnpm -C platform/api db:seed                  # load data/tariffs/*.json and data/policy/*.json into tariff_plans / policy_rules (idempotent)
pnpm -C platform/api dev                      # API on :8080, OpenAPI at /api/openapi.json
pnpm -C platform/api openapi                  # regenerate api/openapi.json after changing any route schema (a test fails if stale)
pnpm -C platform/web gen:api                  # regenerate web/src/lib/api-types.ts from api/openapi.json (CI checks it is current)
pnpm -C platform/web typecheck && pnpm -C platform/web lint && pnpm -C platform/web test && pnpm -C platform/web build
pnpm -C platform/web smoke [url]      # a RUNNING production build: pages, the map worker files, the security headers
pnpm -C platform/web journey [url] [--no-providers]   # end-to-end over HTTP through a running stack; --no-providers is what CI runs
pnpm -C platform/web browser [url]    # real Chromium (playwright): the map draws and pans, pages render, skip link, theme,
                                      # and the allocation workbench recalculates. PLAYWRIGHT_CHROMIUM_PATH=<binary> to use
                                      # a browser the image already ships instead of Playwright's own download.
pnpm -C platform/web dev                      # web on :3000, proxies /api to API_URL (default http://127.0.0.1:8080)

# the Python engine (platform/engine), same venv as the EMS; routes that need it answer 503 ENGINE_UNAVAILABLE without it
cd platform/engine && python -m pytest tests -q -p no:cacheprovider        # ~1 minute; pytest.ini puts ../../src on the path
python -m ruff check platform/engine --no-fix                              # from the repo root
python platform/engine/scripts/export_openapi.py                           # regenerate engine/openapi.json (a test fails if stale)
ENGINE_API_KEY=<16+ chars> python -m uvicorn avishkar_engine.app:create_app --factory --port 8090    # run it (from platform/engine)
# api/.env then needs ENGINE_URL=http://127.0.0.1:8090 and the same ENGINE_API_KEY; the API integration tests start their own engine
# process (test/engine-process.ts) and are skipped, not faked, without Python; CI sets REQUIRE_ENGINE=1 so they cannot skip
```

- **Engine** (`platform/engine`, D1, D15): stateless FastAPI, camelCase on the wire, shared key `x-engine-key`, refuses to start
  open unless `ENGINE_INSECURE_DEV=1`. `optimise.py` is the planner (scipy `milp`/HiGHS; `validate()` re-checks every plan and
  an invalid one is never shown; an optional `risk` block plans one battery schedule for several days with expected cost + CVaR,
  the API builds those days from the forecast bands in `api/src/plan/risk.ts` when a plan is asked with `riskAversion`), `solar.py` (pvlib; the band is learned from the place's own past day-ahead errors) and
  `load.py` (baselines against a quantile model on a chronological holdout). The TS side is `api/src/engine` (client, zod
  schemas), `api/src/forecast` (solar and load routes, the Open-Meteo previous-runs provider), `api/src/plan` (builds the
  optimiser input from tariff, forecasts and assets; `horizon.ts` is the local-clock arithmetic, steps are whole IST hours).
  The solar provider's hours sit half an hour off IST: `plan/horizon.ts resample` averages the two it overlaps. Plans are stored
  whole in `optimization_runs` (a stored plan has `schedule.times`/`schedule.loadKw`, not `steps`; `plan/export.ts` is the CSV,
  `plan/drift.ts` compares a plan with the readings for its passed hours); forecasts as issued in `forecast_runs`; what-ifs in `scenarios`. Tests that depend on the hour of
  day pin the clock. `api/src/scenarios` estimates a year from 24 typical days (a weekday and a weekend day per month) planned with
  a `cyclic` battery, weighted by the next 365 days; money arithmetic is `economics.ts`, and only prices the owner enters are used
  (never a built-in price list or emission factor). `api/src/forecast/evaluate.ts` scores stored load forecasts against readings
  imported later (automatically after each meter import).
- Tool-shell traps seen again: a heredoc containing `\b`, `\d` or a curly apostrophe is mangled (a Python `'''` string turned
  `\b` into a literal backspace in a regex). Write scripts and files with the Write tool, then run them.

- **Community allocation** (`api/src/community`, `POST /api/community/allocate`, the workbench on the web Community page):
  `allocate.ts` is pure arithmetic over one interval -- own generation, then own battery, then the shared node, then the grid, in
  that stated order -- applying per-member export and import limits, a shared feeder limit, line losses per member and one network
  loss on the pool (each charged once), and battery reserve floors, power limits and round-trip efficiency on the charge leg. Four
  rules (proportional, equal share, critical first, nearest first) and two battery policies. Each member reports which cap bound it;
  unserved demand and curtailed generation are reported, not smoothed away; every result carries an energy-balance check.
  `service.ts` builds members from the request, or from the owner's own properties (solar from their entered systems via the engine,
  demand from their imported readings' pattern, export limit from the entered inverter) and says in `basis` where each figure came
  from and which it does not hold. It moves no electricity and says so in every response.

- **Web** (`platform/web`): Next 16 App Router, React 19, Tailwind 4, MapLibre, recharts. It only talks to `/api` (same-origin
  proxy, so the HttpOnly session cookie is first-party and the CSRF token is echoed from the `avk_csrf` cookie; the root layout's
  `components/DegradedBanner.tsx` polls `/api/system/health` and says on every page what is down). Show every
  number through `components/Provenance.tsx` (`Measure`, `StatusBadge`) so it wears its data label; never print an
  UNAVAILABLE value as a number. Component classes (`.btn`, `.card`, `.field`, `.badge`) are in `@layer components` so
  Tailwind utilities can override them. The lint rule `react-hooks/set-state-in-effect` is on: derive state, do not set it
  synchronously in an effect. Tests pin the time zone to Asia/Kolkata (`vitest.config.ts`).

- **The map worker**: `maplibre-gl` v6 finds its tile worker by a fixed file name next to its own module, and a production build renames
  assets with a hash, so without help the production map is blank ("Worker failed to load" in the console; `next dev` hides it).
  `scripts/copy-maplibre-worker.mjs` (run by `pnpm build` and `pnpm dev`) copies the worker and its shared chunk to the git-ignored
  `public/maplibre/`, and `MapCanvas.tsx` calls `setWorkerUrl`. After changing the map library, check a production build in a browser.
  The web app also sends a CSP and other security headers (`src/lib/csp.ts`): a new outside host (a tile server) must be added there.
  **Scripts run by a per-request nonce**, which `web/src/proxy.ts` makes and Next puts on its own script tags; the root layout
  reads it from `x-nonce` for the theme script. Do not put a Content-Security-Policy in `next.config.ts` as well -- two are both
  enforced, and a nonce-less one blocks everything the nonced one allows. A fixed script *hash* cannot work here: Next's hydration
  scripts differ per page and per build, and listing one left the whole production app non-interactive while serving HTTP 200
  (`platform/STATUS.md`, the 2026-10-30 findings). `pnpm smoke` cannot see that; `pnpm browser` can. Using a nonce means every
  page renders per request, which is why none is prerendered.
- **Database on this machine**: Docker's engine is not usable, so PostgreSQL 16 + PostGIS 3.4 run inside WSL Ubuntu
  (databases `avishkar_dev`, `avishkar_test`; credentials only in the git-ignored `platform/api/.env`). WSL stops idle
  distros and takes Postgres with it: keep it alive with
  `wsl -d Ubuntu -u root -- bash -lc "service postgresql start; exec sleep infinity"` (run it in the background), or
  `start-database.cmd` (runs `scripts/wsl-init-db.sh`, then migrates and seeds `DATABASE_URL`); `start-platform.cmd` starts the
  engine, API and web on Windows and **`./start-platform.sh`** does the same on Linux or macOS (`--dev` for the development web
  server; it checks `platform/api/.env`, the venv and the ports before starting anything, and stops all three on Ctrl-C). `DATABASE_URL` may point at a Neon cloud database (`docs/DATABASE_GUIDE.md`, `pnpm -C platform/api
  db:health`), so `db:migrate` and `db:seed` can write to the cloud; tests always use the local `DATABASE_URL_TEST`. Every
  password and key is read from `platform/api/.env`: never write one into a script or a doc.
- Prisma 7.10 (CLI pinned; `latest` resolves to an 8.0 release candidate) and TypeScript 5.9 (typescript-eslint does not
  support TS 7). Migrations are SQL with hand-written additions; GiST indexes must be declared in `schema.prisma` or Prisma
  drops them. Check drift with `pnpm -C platform/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  (an empty migration is good). Prisma refuses `migrate reset --force` from an agent without the owner's consent: do not
  work around it, create a fresh database instead.
- Rules baked into the code: `LIVE` is derived from freshness (`src/provenance`), never chosen; provider failures give errors
  or stale-marked values, never invented data; estimates are `ESTIMATED` with their assumptions; unknowns are `UNAVAILABLE`
  with a reason; browser location is never labelled NavIC.
- **Never run two API test commands at once.** Every test file shares `DATABASE_URL_TEST`, and each file's resetDb truncates the whole schema, so a single-file run started while the full suite is going will wipe the other one's data mid-test. The symptoms look like real bugs: HTTP 401 Sign in required on a session that was just made, or a plan that vanishes. Wait for the suite to finish.
- The public Overpass server answers HTTP 504 about one request in three from here: mirrors and retries are required.
- **Meter data is the owner's, and is never repaired.** `src/energy/parse.ts` refuses to guess a unit (kW against kWh differs
  four-fold at 15 minutes), counts every row as accepted, refused with a named reason, or duplicate, and leaves gaps as gaps.
  Energy DNA (`src/energy/dna.ts`) uses only complete days. A parameter the owner leaves blank on an asset is stored blank; the
  API returns `entered` beside `effective` with its `basis` (`src/assets/defaults.ts`). In Zod 4 a `.default()` inside
  `.partial()` still applies, so field sets used for PATCH carry no defaults (see `src/assets/schemas.ts`). Use `Prisma.DbNull`,
  not `Prisma.JsonNull`, to clear a JSON column. The DB CHECKs in each migration are part of the contract: add one for every rule.
- **Tariffs and policy are data, with sources.** `data/tariffs/<site>.json` (EMS inputs plus a `meta` block the Python loader
  ignores) and `data/policy/pm_surya_ghar.json` are the single source for both the Python EMS (`subsidy.py` reads the policy
  file) and the platform (the seeder loads them). Add a rule or order by editing the file with its source and check date, then
  `db:seed`. Never state a policy as fact without a source: with no sourced rule the API answers `NO_SOURCED_RULE` and no number
  (net metering is in exactly that state). Tariff validity is judged against today's date, so an expired order is flagged, not hidden.

## Data and caches

- `data/` mixes three things: upstream EMHASS test fixtures (`data/*.csv`, `*.pbz2`, `*.pkl`), project inputs
  (`data/real/` PVGIS weather, CEEW meter and German load CSVs; `data/tariffs/<site>.json`), and runtime junk. EMHASS's
  `data_path` points at `data/`, so running upstream code writes `last_run.json`, `adjust_pv_regressor.pkl` and
  `debug-*.csv` there (git-ignored).
- `data/real/pvgis_<site>_<lat>_<lon>_<tilt>_<azimuth>_<first>_<last>.csv`: the location is in the name on purpose; a file
  covering the requested years is reused, otherwise PVGIS is called (needs internet; PVGIS is unreachable on some
  networks, which gives a plain RuntimeError). Full folder guide: `data/README.md`.
- `data/cache/` (git-ignored) holds pickles of the slow per-site results, managed by `src/avishkar_ems/cache.py`:
  `prepared_<site>`, `day_view_<site>_<day>_<soc>`, `payback_<site>_<every>`, `advice_`, `fq_`, `flex_`, `mon_`. A
  `FINGERPRINT` file hashes our code, tariffs, `data/real` and library versions; the dashboard shows a sidebar warning
  when it no longer matches. Override the location with `AVISHKAR_CACHE_DIR`. Pickles reference `demo.Prepared` and
  `demo.DayView` by import path; moving them just forces a recompute.
- `results/*.csv|json` are written by `examples/`, with `results/provenance.json` recording when, by which environment and
  for which code (fingerprint). The README's result numbers are generated from them (`scripts/update_readme.py`).
  Modules that only format results (`report`, `mysite`, `lifetime`, `explain`, `summary`) are excluded from the
  fingerprint; any other edit under `src/avishkar_ems`, `data/tariffs` or `data/real` makes cache and results stale, so
  re-run `run_demo.py`, `run_sensitivity.py` and `precompute_cache.py --rebuild`, then `update_readme.py`.

## Gotchas

- In real-data frames `expected_kw == pv_kw` (generation is modelled, there are no inverter logs), so `monitor.py` can only
  flag an injected fault there. Use `pv_clear_kw` when you need a clear-sky reference.
- Held-out periods differ per site: Mathura Jul 2020 to Feb 2021 (trained Jun 2019 to Jun 2020), Pune and Jaipur 2023. Sites do
  not overlap in time except Pune and Jaipur, so fleet pooling only has two real members on 2023 dates.
- The pipeline is deterministic **in a genuinely identical environment**: two independent `run_demo.py` runs here on
  2026-10-30 gave bit-identical `payback.csv` and `forecast_quality.csv`. "Identical" includes the Python patch version, which
  `requirements-lock.txt` does not pin -- the `results/` committed earlier that day came from Python 3.12.10 and the
  regeneration from 3.12.3, with every pinned library version equal, and the figures moved in the fifth significant figure.
  The differences fell only on the variants the LP plans, not on the fixed-rule or idle baselines (`docs/KNOWN_ISSUES.md` #30).
  Since 2026-10-07 the README,
  `results/` and the dashboard default agree to 1e-11 INR (`docs/KNOWN_ISSUES.md` #1). `requirements-lock.txt` is the
  environment they came from. Sampled replay days that are not consecutive each start from the same battery state.
- Entry points log warnings (`logging.basicConfig`); EMHASS's `get_logger` adds a handler per call, so the planner uses one
  cached logger (`planner._plan_logger`). Do not call `get_logger` per plan.
- `p2p_share` in a tariff JSON (default 0.55) sets the assumed P2P price between export and retail rate; it is an assumption.
- The tool shell breaks on shell heredocs that contain apostrophes or backslash escapes (parse errors, or silently mangled
  text). Write files with the Write/Edit tools; if a script is needed, write it to a file first, then run it.
- Offer ids contain a random uuid, so offers are not byte-reproducible across runs.
- Strings shown to users come in English/Hindi pairs (`explain.py`, `summary.py`, `advisor.py`); keep both when editing.
- `IntervalTelemetry` (`home_balance.py`) takes optional live grid readings (`grid_export_kw`,
  `grid_import_kw`, `battery_discharge_kw`, `battery_charge_kw`, `controllable_draw_kw`, `ev_draw_kw`,
  `battery_commanded`). With them the surplus is read from the meter by the vendored SEM functions;
  without them it is `generation - demand` and the result says so in its assumptions. The dashboard's
  "My Home EMS" tab exposes them behind a collapsed "I have a live grid meter" panel, and a figure a
  person types there is `USER_ENTERED`, never `HARDWARE_MEASURED`.
- `DispatchStepResult.curtailed_solar_kw` is in the first-law check. Before 2026-10-31 there was no
  curtailment term, so a zero-export home with a full battery lost the unusable generation and
  `is_balanced` went False with nothing to point at.
- Pass every block of HTML through `app/ui_html.py`'s `html_block()` before `st.markdown(..., unsafe_allow_html=True)`.
  Markdown still runs first and reads a blank line followed by an indented line as a *code block*, so indented markup is printed
  as text on the page; this stripped the indentation at 42 call sites after 36 blocks were found leaking raw `<path>` elements.
- `tests/avishkar_ems/test_app_imports.py` imports every view and resolves every name they import. It needs no cache and never
  skips, unlike `test_dashboard.py`, which skips itself without a fresh cache -- which is how a dashboard that could not start at
  all passed 554 tests.

When you change a command, the architecture, a data path or a known issue, update this file and `docs/KNOWN_ISSUES.md` in the
same change so the next session does not have to rediscover it.
