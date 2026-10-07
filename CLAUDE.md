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
`platform/ARCHITECTURE.md` (decisions D1..D14), `platform/SPEC.md` (the owner's requirements). `docs/DEMO_GUIDE.md` is the
demo-video script, `docs/RESEARCH.md` the competitor/rules notes.

## Commands

Use the project venv: `.venv/Scripts/python.exe` (Python 3.12; `requirements-lock.txt` is the exact package set the
current `results/*.csv` came from). Below, `python` means that interpreter. `run-dashboard.cmd` sets `PYTHONUTF8=1` (the UI
has ₹ and Hindi text); do the same when you launch the dashboard another way.

```bash
python -m pytest tests/avishkar_ems -q -p no:cacheprovider    # project tests, ~100 s
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

### Vendored EMHASS

Do not edit `src/emhass/` or the upstream tests; the package keeps the name `emhass` because the vendored code reads its
version from package metadata. `planner._base_params` loads EMHASS's defaults and applies overrides to whichever config
section holds each key (it raises `KeyError` on a missing key, which means an EMHASS version mismatch). The planner turns
off EMHASS's default deferrable loads: this EMS plans PV, battery and grid only.

## Platform (TypeScript, `platform/`)

Status per spec section: `platform/STATUS.md`. Decisions: `platform/ARCHITECTURE.md`. Backend phases 1 and 2 are done and
verified (auth, properties, PostGIS, geocoding, weather, solar resource, building outline, satellite metadata, Energy Twin),
and `platform/web` shows them (map, property page, forecast charts, system health); tariffs, assets, forecasts, optimiser
and everything after are not built.

```bash
pnpm -C platform install                      # also generates the Prisma client
pnpm -C platform/api typecheck && pnpm -C platform/api lint && pnpm -C platform/api build
pnpm -C platform/api test                     # unit + integration on a REAL PostGIS (DATABASE_URL_TEST in platform/api/.env)
pnpm -C platform/api test:live                # calls the real public providers; on demand, never in CI
pnpm -C platform/api db:migrate               # apply prisma/migrations to DATABASE_URL
pnpm -C platform/api dev                      # API on :8080, OpenAPI at /api/openapi.json
pnpm -C platform/api openapi                  # regenerate api/openapi.json after changing any route schema (a test fails if stale)
pnpm -C platform/web gen:api                  # regenerate web/src/lib/api-types.ts from api/openapi.json (CI checks it is current)
pnpm -C platform/web typecheck && pnpm -C platform/web lint && pnpm -C platform/web test && pnpm -C platform/web build
pnpm -C platform/web dev                      # web on :3000, proxies /api to API_URL (default http://127.0.0.1:8080)
```

- **Web** (`platform/web`): Next 16 App Router, React 19, Tailwind 4, MapLibre, recharts. It only talks to `/api` (same-origin
  proxy, so the HttpOnly session cookie is first-party and the CSRF token is echoed from the `avk_csrf` cookie). Show every
  number through `components/Provenance.tsx` (`Measure`, `StatusBadge`) so it wears its data label; never print an
  UNAVAILABLE value as a number. Component classes (`.btn`, `.card`, `.field`, `.badge`) are in `@layer components` so
  Tailwind utilities can override them. The lint rule `react-hooks/set-state-in-effect` is on: derive state, do not set it
  synchronously in an effect. Tests pin the time zone to Asia/Kolkata (`vitest.config.ts`).

- **Database on this machine**: Docker's engine is not usable, so PostgreSQL 16 + PostGIS 3.4 run inside WSL Ubuntu
  (databases `avishkar_dev`, `avishkar_test`; credentials only in the git-ignored `platform/api/.env`). WSL stops idle
  distros and takes Postgres with it: keep it alive with
  `wsl -d Ubuntu -u root -- bash -lc "service postgresql start; exec sleep infinity"` (run it in the background).
- Prisma 7.10 (CLI pinned; `latest` resolves to an 8.0 release candidate) and TypeScript 5.9 (typescript-eslint does not
  support TS 7). Migrations are SQL with hand-written additions; GiST indexes must be declared in `schema.prisma` or Prisma
  drops them. Check drift with `pnpm -C platform/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  (an empty migration is good). Prisma refuses `migrate reset --force` from an agent without the owner's consent: do not
  work around it, create a fresh database instead.
- Rules baked into the code: `LIVE` is derived from freshness (`src/provenance`), never chosen; provider failures give errors
  or stale-marked values, never invented data; estimates are `ESTIMATED` with their assumptions; unknowns are `UNAVAILABLE`
  with a reason; browser location is never labelled NavIC.
- The public Overpass server answers HTTP 504 about one request in three from here: mirrors and retries are required.

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
- The pipeline is deterministic in a fixed environment (a rebuild is bit-identical), and since 2026-10-07 the README,
  `results/` and the dashboard default agree to 1e-11 INR (`docs/KNOWN_ISSUES.md` #1). `requirements-lock.txt` is the
  environment they came from. Sampled replay days that are not consecutive each start from the same battery state.
- Entry points log warnings (`logging.basicConfig`); EMHASS's `get_logger` adds a handler per call, so the planner uses one
  cached logger (`planner._plan_logger`). Do not call `get_logger` per plan.
- `p2p_share` in a tariff JSON (default 0.55) sets the assumed P2P price between export and retail rate; it is an assumption.
- The tool shell breaks on shell heredocs that contain apostrophes or backslash escapes (parse errors, or silently mangled
  text). Write files with the Write/Edit tools; if a script is needed, write it to a file first, then run it.
- Offer ids contain a random uuid, so offers are not byte-reproducible across runs.
- Strings shown to users come in English/Hindi pairs (`explain.py`, `summary.py`, `advisor.py`); keep both when editing.

When you change a command, the architecture, a data path or a known issue, update this file and `docs/KNOWN_ISSUES.md` in the
same change so the next session does not have to rediscover it.
