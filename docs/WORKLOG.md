# Work log

Chronological record of work on this repository, written so that **any AI or human can pick up where the last one
stopped**. Newest entry last. Never delete history; correct it with a later entry.

**Rules for writing entries**

- One entry per work session. Say what you did, the **evidence** (command and result), and, equally important, what you
  did **not** do and why. Use the words `DONE` (verified), `PARTIAL`, `NOT DONE`, `BLOCKED`.
- Do not write "works" without a command that shows it. If you did not run it, say "not run".
- End every entry with **Next**: the concrete next steps, in order.
- Platform progress is also tracked per spec section in [../platform/STATUS.md](../platform/STATUS.md).

**How to resume in 60 seconds:** read [../CLAUDE.md](../CLAUDE.md), then the last entry below, then
[../platform/STATUS.md](../platform/STATUS.md) if the next step is platform work. Run
`git status` and `git log --oneline -15` to see anything uncommitted or unpushed.

---

## Entry 1: 2026-10-07: audit of the Python EMS and the context files

Done by Claude (Sonnet 5.5) at the owner's request: "analyse this project, list the drawbacks, organise every file, so a new
session (or another AI) need not look everything up again".

- DONE: read the whole `src/avishkar_ems` package, dashboard, scripts, tests, README, NOTICE, docs. Baseline measured:
  34 project tests passed, 1 skipped (official Beckn example, needs `DEG_PUBLISH_EXAMPLE`); ruff 17 findings, all in the
  newest uncommitted files.
- DONE: `CLAUDE.md`, `AGENTS.md`, `docs/KNOWN_ISSUES.md` (17 scored drawbacks), `.gitignore` for runtime files,
  `docs/DEMO_GUIDE.md` moved from the repo root, `.python-version`, `requirements-lock.txt`.
- DONE: `src/avishkar_ems/cache.py` replaced seven copy-pasted pickle blocks in the dashboard (same file names, so the
  existing cache stayed valid; a rebuild from empty matched it bit for bit); one idempotent `scripts/precompute_cache.py`
  replaced two scripts (one crashed unless the other had run first).
- DONE: dashboard honesty fixes (clear-sky line, monitor labels, "sampled days", upload path, removed hidden synthetic fleet
  peers). Verified with Streamlit `AppTest` over all sites and two dates.
- NOT DONE: committing; fixing the issues that needed decisions (done in Entry 2).

Next: owner asked to fix everything (Entry 2).

## Entry 2: 2026-10-07: "fix everything" pass on the Python EMS

All 17 items in `docs/KNOWN_ISSUES.md` were addressed; see that file for the per-item status and evidence. Summary:

- DONE (code, tests green): sampled replay days no longer inherit battery charge (`payback.evaluate`); month coverage and
  solver-status reporting (`Evaluation.months_covered`, `non_optimal_days`); `logging.disable` removed after fixing the
  EMHASS logger handler leak in `planner.py` (it hid a real bug); `p2p_share` made a tariff setting (was a hard-coded 0.55);
  PVGIS weather cache key now includes latitude/longitude, files renamed with `git mv`, a covering cache file is reused, an
  unreachable PVGIS gives a plain error; leap-year weather bug fixed; `analyze_my_site.py` no longer crashes on a normal
  install (needed `tabulate`); own-meter analysis moved to `mysite.py` and wired into the dashboard's Upload tab;
  `lifetime.py` (discounted payback, NPV, adjustable assumptions) and a dashboard panel; battery-advice wording fixed in
  English and Hindi; dashboard shows solver warnings, coverage, honest Beckn badge wording, an "assumptions" panel.
- DONE (results): `examples/run_demo.py` and `run_sensitivity.py` re-run; `results/provenance.json` records the environment;
  `src/avishkar_ems/report.py` + `scripts/update_readme.py` generate the README results block (CI checks it). Dashboard
  default (7-day sampling) verified equal to `results/payback.csv` for all three sites (max diff 1e-11 INR).
  New headline: EMS payback 19.94 / 8.59 / 7.69 years (Mathura / Pune / Jaipur); see the README block for the rest.
- DONE (tooling): `.github/workflows/ci.yml` (lint, tests, README check); ruff `fix = false`; ruff installed in `.venv`; dead
  `asyncio` dependency and `MANIFEST.in` removed; `run-dashboard.sh`; `data/README.md`.
- DONE (evidence): project suite **68 passed, 1 skipped**, ruff clean. Upstream EMHASS suite in a clean copy with
  `.[app,test]`: 1233 passed, 32 xfailed, 1 failed (missing unvendored `docs/api/healthz.schema.json`); `test_openapi.py`
  cannot be collected (unvendored `generate_openapi`).
- Re-stamp note: after the final edit to `report.py`/`cache.py` (fingerprint now ignores presentation-only modules) the
  cache stamp and `results/provenance.json` fingerprints were rewritten **after** recomputing Mathura and Pune and matching
  `results/payback.csv` to 1e-11. Clinic-Jaipur and the sensitivity sweep were not recomputed after that edit; the computing
  code is unchanged.
- NOT DONE: CI has not been seen running on GitHub; `run-dashboard.sh` not run on Linux/macOS; the Dockerfile is unchanged
  and no container was built (Docker engine was off); no real-browser test of the dashboard (Streamlit `AppTest` only);
  replays not parallelised; the generation/P2P/export-rate assumptions remain assumptions (need real data); the official
  Beckn example check still opt-in; fleet pooling cannot pool Mathura with anything.

Next: platform work (Entry 3 onward).

## Entry 3: 2026-10-07: AVISHKAR platform kickoff (specification, architecture, status)

Owner supplied a 100-section specification for a map-first, location-aware energy intelligence platform (TypeScript,
Next.js, Fastify, Prisma, PostgreSQL + PostGIS, real providers, provenance, optimiser, Copilot, community/VPP).

- DONE: saved the specification verbatim as `platform/SPEC.md` (section numbers are requirement IDs).
- DONE: repository audit and decisions D1..D14 in `platform/ARCHITECTURE.md` (TypeScript API + Python engine service,
  Fastify, Postgres/PostGIS via Prisma with raw SQL, pg-boss, provenance envelope, freshness rules, provider failover,
  honest satellite scope, NavIC positioning abstraction, tariff/policy as data, demo isolation, tool-only Copilot).
- DONE: `platform/STATUS.md`, a row per spec section with an honest status (almost everything NOT STARTED; the Python EMS
  parts that can be reused are marked REUSE).
- DONE: probed which real providers are reachable from this machine: Open-Meteo (forecast, archive), Nominatim, Overpass,
  NASA POWER and the Earth Search STAC catalogue respond; **PVGIS (EU JRC) times out**.
- DONE: `platform/` pnpm workspace and `platform/api` package (Fastify, zod, helmet, rate-limit, cookie, swagger,
  vitest, tsx, eslint, TypeScript installed with `pnpm add`).
- BLOCKED: Docker Desktop was launched; the engine was still not accepting connections when last checked, so no PostGIS
  yet. Database migrations and database integration tests cannot be verified until `docker info` reports a server.
- NOT DONE: everything else in the platform (see `platform/STATUS.md`).

Next (in order, per spec §84): (1) config + provenance envelope + freshness rules with unit tests; (2) provider interfaces and
real adapters (Nominatim, Open-Meteo, NASA POWER, Overpass, STAC) with caching, failover, latency recording and tests,
including live integration tests that are clearly marked and skippable offline; (3) Prisma schema and migrations once Docker
is up; (4) auth, audit log, property CRUD; (5) web app with MapLibre.

## Entry 4: 2026-10-07: platform Phase 1 backend (database, auth, properties, geocoding, providers)

Environment actions taken (on the owner's machine, reversible): launched Docker Desktop (its Linux engine never became
available, probably a first-run dialog needing a human); installed **PostgreSQL 16.15 + PostGIS 3.4 inside WSL Ubuntu** with
`apt-get` (undo: `wsl -d Ubuntu -u root -- apt-get remove --purge postgresql\*`); created role `avishkar` (SUPERUSER, local
dev only) and databases `avishkar_dev`, `avishkar_test` (also an unused empty `avishkar`, left alone: Prisma refused to reset
it without owner consent and that guard was respected). Credentials live only in the git-ignored `platform/api/.env`.
WSL stops idle distros: Postgres only stays up while a session is attached; keep one running with
`wsl -d Ubuntu -u root -- bash -lc "service postgresql start; exec sleep infinity"`.

- DONE: `platform/api` (Fastify 5, zod 4, Prisma 7.10 + pg adapter, TypeScript 5.9; TS 7 was avoided because
  typescript-eslint does not support it; Prisma CLI pinned to 7.10.0 because `latest` resolved to an 8.0 release candidate).
- DONE: migrations `foundation` and `reference_status` (hand-written SQL appended to the generated one: PostGIS extension,
  range CHECKs, geometry trigger, GiST indexes declared in the schema so Prisma sees no drift, append-only audit log
  trigger, `LIVE` needs `observed_at` CHECK). Evidence: `prisma migrate diff` against the schema is empty.
- DONE: config (zod), error codes, provenance envelope and freshness (`LIVE` is derived, never chosen), data-quality
  engine, seven reality checks, provider layer (HTTP client with retries/spacing/validation/telemetry, DB cache with
  stale-if-error, failover helper, Nominatim geocoder, positioning abstraction), auth (argon2id, hashed session tokens,
  CSRF, rate limits), property CRUD with PostGIS-validated polygons and tenant isolation, account export and real
  deletion, health with real provider telemetry, OpenAPI document.
- DONE (evidence): `pnpm -C platform/api typecheck`, `lint`, `build` clean; `test` 106 passed (59 unit, 47 integration on
  real PostGIS). Smoke test: built server started, registered, **live Nominatim** search for Koramangala returned results
  labelled REFERENCE with OSM attribution, property saved with PostGIS point, honest "BUILDING GEOMETRY UNAVAILABLE".
- DONE: platform CI job (PostGIS service container) in `.github/workflows/ci.yml` (YAML parsed; not yet run on GitHub).
- NOT DONE: map UI and the whole `web/` app; weather, solar resource, footprint (Overpass), satellite providers; Energy Twin;
  forecasts; optimiser; every engine after Phase 1; Python engine service; job queue; admin routes and role-based admin API;
  OpenAPI rendered docs and `API.md`; Docker Compose; deployment descriptors. See `platform/STATUS.md`.
- Known limitations recorded: rate limiter is in-memory (per instance); one geocoder only, so failover is untested against a
  real second provider; `avishkar_dev`/`avishkar_test` role is SUPERUSER for local convenience only.

Next (in order): (1) weather provider (Open-Meteo forecast + archive) with the quality engine applied, `weather_observations`
and `solar_forecasts` tables, live test; (2) solar resource (NASA POWER) and building footprint (Overpass) providers;
(3) satellite metadata (Earth Search STAC); (4) Energy Twin versioning and `POST /api/properties/:id/analyze`;
(5) `web/`: Next.js, MapLibre map-first UI wired to these endpoints; (6) Python engine service and Phase 3 forecasts.

## Entry 5: 2026-10-07: platform Phase 2 backend (real data and the Energy Twin)

- DONE: providers, each isolated, validated against the real response shapes, cached, rate-spaced and telemetered:
  Open-Meteo weather (quality engine applied, coordinates coarsened to about 1 km before leaving the machine, issued
  values stored in `weather_observations`), NASA POWER solar climatology, Overpass building outlines (mirror failover; the
  public server answers HTTP 504 about one request in three here), Earth Search STAC Sentinel-2 metadata.
- DONE: migrations `weather_observations`, `energy_twin_and_satellite` (drift check empty). `POST /api/properties/:id/analyze`
  builds a new versioned Energy Twin: a failed source is recorded and its part left empty, never invented; consumption,
  tariff and autonomy score are `UNAVAILABLE` with reasons until real data exists; estimates are `ESTIMATED` with the
  assumptions listed (`api/src/twin/estimate.ts`); `confidence` is data completeness, and says so.
- DONE: `GET /api/preview` (map-click view, nothing saved), `GET /api/cloud-nowcast` (honest UNAVAILABLE), twin read and
  version routes, OpenAPI updated.
- DONE (evidence): 176 tests pass; typecheck, lint, build clean; 7 live tests pass against the real services; live smoke:
  a twin for a real Bengaluru building in 11.7 s (603 m2 OSM outline, 11 levels so a shared-roof warning, NASA 5.48
  kWh/m2/day, 24 h forecast, Sentinel-2c scene of 2026-10-04).
- Lessons recorded: Prisma refuses `migrate reset --force` from an agent without the owner consent (respected; a fresh
  database was created instead); `typescript-eslint` does not support TypeScript 7; shell heredocs containing apostrophes
  break the tool shell, so write files with the file tools.
- NOT DONE: everything from Phase 3 on (own solar and load forecast models with measured error, optimiser, opportunities,
  value, what-if, counterfactual, economics, resilience, Copilot, community/VPP), the whole `web/` app including the map,
  Energy DNA, tariff engine and policy tables, appliance/battery/EV models, admin API, job queue, Python engine service,
  deployment files. See `platform/STATUS.md`.

Next (in order): (1) `web/`: Next.js + MapLibre map-first UI wired to `/api/geocode`, `/api/preview`, properties, analyze
(the first thing a user can see and touch); (2) tariff and policy tables (`tariffs`, `policy_rules`) seeded only from the
sourced JSON already in the repo, with manual entry; (3) appliances/battery/EV tables and the load profile import (reuse
`mysite`/`userdata` logic through the Python engine); (4) Python engine service and the forecast evaluation job
(`weather_observations` forecasts vs ERA5 actuals) for the solar forecast engine with benchmarks; (5) optimiser and the
engines that depend on it.

## Entry 6: 2026-10-07: verification pass ("check now"), first real CI run

- DONE (evidence, all run fresh): git clean and in sync with origin; `python -m pytest tests/avishkar_ems` 68 passed, 1 skipped;
  ruff clean; `scripts/update_readme.py --check` up to date; platform `tsc`, `eslint`, `vitest` (176 passed), `build` clean;
  `prisma migrate diff` against the schema empty.
- FOUND: GitHub had **no CI runs**: the workflow only triggered on `main` and pull requests. Fixed (`push` on every branch,
  plus `workflow_dispatch`). The first real run then **failed the platform typecheck**: `@prisma/client` and
  `@prisma/adapter-pg` were imported but missing from `platform/api/package.json`; the code only worked locally because
  of a leftover `node_modules`. Fixed (declared, pinned to 7.10.0; unused `fastify-plugin` removed). Reproduced and verified
  in a fresh clone installed with `pnpm install --frozen-lockfile` before pushing.
- DONE (evidence): CI run 37612815661 on commit 5fbd3c2: job `python` success, job `platform` success (typecheck, tests on a
  real `postgis/postgis:16-3.4` service container, build). The pinned `requirements-lock.txt` installs and passes on Linux.
- Lesson: only a clean clone proves the manifests. Before claiming a package works, run `pnpm install --frozen-lockfile` in a
  fresh clone and typecheck there.
- STILL NOT DONE / unchanged: Docker engine is still not running here (needs a human at Docker Desktop); everything listed
  as not done in Entries 4 and 5; the web app is the next step.

## Entry 7: 2026-10-07: OpenAPI contract and the first web app ("complete all remaining works", milestones 1 and 2)

- DONE: the API contract is a committed file. `platform/api/openapi.json` (133 KB; shared schemas such as GeoPoint,
  Provenance, ErrorResponse, User, Property, SatelliteScene and EnergyTwin are components) is generated by
  `pnpm -C platform/api openapi` from the real route schemas with stub dependencies. `test/openapi.test.ts` fails when the
  generated document differs from the committed one, and when any route lacks a summary, tags or an error response (the
  test caught `/api/system/health`, now exempted with the reason stated).
- DONE: `platform/web` (Next 16 App Router, React 19, Tailwind 4, MapLibre 6, recharts 3). Same-origin `/api` proxy
  (Next rewrites) so the HttpOnly session cookie is first-party; the CSRF token is echoed from its readable cookie. API
  types are generated from the committed OpenAPI file (`pnpm -C platform/web gen:api`). Pages: `/`, `/map`, `/login`,
  `/register`, `/properties`, `/property/[id]`, `/property/[id]/forecast`, `/system`. Every value is shown through one
  component that wears its data label (LIVE, UPDATED, FORECAST, ESTIMATED, SIMULATED, DEMO, REFERENCE, UNAVAILABLE) and
  opens a provenance panel; an UNAVAILABLE value is a dash with its reason, never a number.
- DONE (evidence): web `typecheck`, `lint` (0 problems), `test` (57 passed in 5 files), `next build` all clean; API
  `typecheck` and `test` (179 passed, 10 files; one new test for the geocoder fix). CI gained a `web` job (install with the
  frozen lockfile, API types match the committed OpenAPI, typecheck, lint, tests, build). Reproduced in a fresh clone of the
  commit with no `DATABASE_URL`: `pnpm install --frozen-lockfile`, `gen:api` with no diff, web typecheck, lint, 57 tests and
  build, API typecheck and lint all pass.
- DONE (evidence, manual, in a real browser against the running API and real PostGIS, not mocked): searching
  "Indiranagar Bengaluru" returned five real Nominatim places; choosing one flew the map there and showed REFERENCE solar
  resource (5.48 kWh/m2/day, NASA POWER), ESTIMATED yield per kWp, FORECAST next-24 h yield (Open-Meteo) and LIVE weather;
  pasting `12.97840, 77.64080` made 0 geocoder calls and 1 preview call and was labelled "Entered coordinates"; registering a
  throwaway local account signed in; "Analyze this property" built Energy Twin v1 in 6.0 s with a real OSM roof outline (way
  331670039, 104 m2), a Sentinel-2C scene acquired 2026-10-04, completeness 70% with the two missing inputs (consumption,
  tariff) named and weighted, and consumption, tariff and autonomy shown UNAVAILABLE with reasons; the forecast page drew five
  real 72-hour series; `/system` showed real provider calls and honestly marked nasa-power UNKNOWN (no recent call); the
  theme toggle switched and persisted; the page fits a 344 px phone width.
- FOUND AND FIXED while doing that (each is a real defect a user would have hit):
  (1) at phone width the nav was 595 px wide in a 344 px screen and the page scrolled sideways: the nav now wraps, links take
  their own row;
  (2) the first fix did not apply because the `.btn`/`.card`/`.field`/`.badge` classes were unlayered CSS and beat Tailwind
  utilities: they now live in `@layer components`;
  (3) chart time axes printed HH:MM at about 20 h spacing across three days, which read as backwards: ticks are now one short
  day label per day under its data and an unlabelled tick at each local midnight (`dayAxis`, tested);
  (4) the geocoder returned the same place twice under one display name: now one per name, first (most relevant) kept (tested);
  (5) `/properties` and `/system` had the generic tab title; header buttons had no explicit `type`;
  (6) found only by a fresh clone: `pnpm install` runs `prisma generate` as a postinstall and Prisma's config threw when
  `DATABASE_URL` was unset, so a clean checkout (and the new CI `web` job, which has no database) could not install. Now
  `generate` alone falls back to a placeholder URL (it never connects); `migrate` and every other command still fail loudly
  without a real URL (verified both ways).
- NOT DONE (be exact): manual roof drawing (click vertices, double-click to finish) is implemented but was not exercised in
  a browser and has no test; "Locate me" is unit-tested with a stubbed geolocation, not against a real GPS fix; no axe or
  screen-reader accessibility pass; no browser end-to-end suite (the run above was manual); no analytic weather-grid map
  layers, property comparison, installation planner or energy-flow diagram; no production map-tile provider (OpenStreetMap,
  Esri and OpenTopoMap public tiles are for development; the owner must supply a provider and key before launch).
- Lessons: tool shell `[type=submit]` selectors miss buttons that rely on the default type; measure overflow with
  `getBoundingClientRect` against `clientWidth` instead of eyeballing a scaled screenshot; component classes written as plain
  CSS silently outrank Tailwind utilities under Tailwind 4 unless layered.

- CI confirmation: run 37618906764 on commit cde44c9 finished with jobs `python`, `platform` and `web` all success.

Next (in order): (3) tariff and policy tables (`tariffs`, `policy_rules`) from the sourced JSON in the repo plus manual entry
and the asset tables (battery, solar system, EV, appliances, load import); (4) Python engine service with forecasts and the
optimiser; (5) the engines that depend on them, Copilot tools, community/VPP; (6) admin, jobs, deployment files, docs.

## Entry 8: 2026-10-07: tariffs, policy rules and eligibility (milestone 3a)

- DONE: database. Migration `tariffs_and_policy`: tables `tariff_plans` and `policy_rules`, a tariff link on `properties`, a
  tariff snapshot on `energy_twins`, and hand-written CHECK constraints (a plan is either curated or owned, blocks and slabs
  are arrays, a fixed charge has an amount and a basis together, an export rate has a basis, effective dates are ordered).
  Drift check against the schema is empty.
- DONE: tariff engine (`api/src/tariff/engine.ts`): pure arithmetic. Time-of-day blocks (may wrap midnight, half-hour starts
  are time-weighted inside an hour), telescopic slabs, per-connection and per-kW fixed charges, validity periods
  (WITHIN / EXPIRED / NOT_YET_EFFECTIVE / OPEN_ENDED / UNKNOWN), monthly bills. `validateShape` names the exact times that have
  no rate or overlap. 22 unit tests with every figure worked out by hand.
- DONE: sourced reference data. `data/tariffs/*.json` gained a `meta` block (state, DISCOM, category, consumer type, fixed
  charge, validity, export-rate basis); the Python loader ignores it. `data/policy/pm_surya_ghar.json` holds the PM Surya
  Ghar schedule: **read from the Benefits section of pmsuryaghar.gov.in on 2026-10-07 in the built-in browser** (Rs 30,000 per
  kW up to 2 kW, Rs 18,000 per kW up to 3 kW, Rs 78,000 total above 3 kW; Rs 18,000 per kW for housing societies). The Python
  `subsidy.py` now reads this file instead of hard-coding the slabs (fixes the spec section 24 violation); 9 new Python tests.
  `pnpm -C platform/api db:seed` loads both into the tables idempotently and refuses a file that does not validate.
- DONE: API. `GET /api/tariffs` (public; filters), `GET /api/tariffs/:id`, `POST/DELETE /api/tariffs` (own private plans),
  `POST /api/tariffs/:id/bill`, `PUT/DELETE /api/properties/:id/tariff`, `GET /api/policy-rules`, `POST /api/eligibility`.
  Plans owned by someone else are 404, never 403. The Energy Twin records the chosen tariff as a snapshot, so editing or
  deleting a plan later does not rewrite an old version; completeness rises by the tariff's 0.10 weight.
- DONE (evidence): API `typecheck`, `lint`, `test` clean, 258 tests (was 179), including 45 integration tests on real PostGIS
  for seeding, visibility, bills, own plans, property selection, the twin and eligibility. Web `typecheck`, `lint`, 108 tests
  (was 57), including a whole-tab test against a faked API. OpenAPI regenerated (206 KB) and web types regenerated.
- DONE (evidence, manual, real browser against the running API): the Tariff tab listed the three real catalogue plans; choosing
  MSEDCL and estimating 300 kWh gave Rs 2,884.38 (my hand calculation: 300 x 7.88125 + 520), with the "this order's period
  ended 2026-03-31" warning attached to the figure; 3 kWp gave Rs 78,000 as 60,000 + 18,000, ESTIMATED, with the
  not-yet-read amendment disclosed; net metering answered UNAVAILABLE with the reason; "Analyze again" produced twin v2
  with the tariff and completeness 80%; a broken own tariff (gap 10:00 to 12:00) was refused with the hours named, the fixed
  one was saved and selected and then deleted; no horizontal overflow at 375 px.
- FOUND AND FIXED on the way: the eligibility test caught a wrong assumption of mine (at 5 kWp the schedule itself stops at
  3 kW, so the cap never applies; the message now says kW above 3 earn nothing extra); a hint inside a `<label>` polluted the
  field's accessible name (now `aria-describedby`); a note written for data maintainers ("update this file") was reaching
  users (reworded).
- NOT DONE (be exact): net-metering rules (nothing sourced was read, so none is loaded); the 2nd amendment of the CFA
  guidelines, the "special states" uplift and the capacity-by-consumption table on the portal were not read; the catalogue
  is 3 plans (two expired) with no other states or DISCOMs, no UP slabs below 300 kWh, no taxes or duty; no admin screen to
  maintain tariffs and rules; the section 24 calculator's installed cost, payback and lifetime economics wait for the
  economics engine; the property's state is not detected, so a Karnataka property can be given a Maharashtra plan (the
  card shows its state and the person chooses).

- Added after the first write-up, same day: the Tariff tab got web component tests (108 web tests in all); the Python cache
  fingerprint now ignores a tariff file's `meta` block and policy wording but tracks policy numbers (`data/policy` feeds the EMS
  subsidy, so it must make a result stale; re-reading a rule at its source and finding it unchanged must not); the whole Python
  pipeline was rebuilt with the refactored `subsidy.py` and **every results CSV is byte-identical** (only `provenance.json`
  timestamps and fingerprint, the offers' random uuids and one README timestamp changed), which proves the refactor moved
  no number. Python tests 19 (cache, subsidy) plus the earlier suite; ruff clean.

## Entry 9: 2026-10-07: assets, meter-data import and Energy DNA (milestone 3b)

- DONE: database. Migration `assets_and_meter_data`: `batteries`, `solar_systems`, `evs`, `appliances`, `appliance_events`,
  `energy_imports`, `energy_observations`, `energy_dna`, plus tariff/asset/load columns on `energy_twins`. Hand-written CHECKs
  on every table: physical plausibility ranges, SOC ordering, a flexible appliance must have a window, an EV departure rule is
  well-formed, **a NILM estimate must carry energy, confidence and uncertainty**, an import's counts must add up to its rows.
  The checks caught two of my own mistakes during the work (below).
- DONE: assets API (`/api/properties/:id/{batteries,solar-systems,evs,appliances}` with POST, GET, PATCH, DELETE; appliance
  runs; `/assets` summary; `/appliance-estimates`). A parameter the owner left blank is stored blank; the response shows the
  labelled default next to it (`entered` against `effective` with a `basis`: USER_ENTERED, ASSUMPTION or PLANNER). Defaults are the
  Python EMS's tested values (round-trip efficiency 0.90 split evenly, 90% usable depth, 14% losses, 2 INR/kWh wear). The EV
  charger efficiency default (0.90) has no source in this repository and is labelled so. Another account's assets are 404.
- DONE: meter import (`src/energy/{csv,parse,dna,service}.ts`): a strict CSV reader (quotes, BOM, four delimiters), ISO and
  day-first timestamps (12-hour too; a month-first guess is never made; IST unless the file carries an offset), kWh/Wh/kW/W with
  the unit read from the header or stated by the caller (**never guessed**: kW and kWh differ four-fold at 15 minutes),
  every row accounted for as accepted, refused (seven named reasons) or duplicate, gaps measured and left as gaps, the same
  file refused twice (409 CONFLICT, a new error code), overlapping files keep the existing readings. Upload limit 25 MB, rate
  limit 10 a minute.
- DONE: Energy DNA from the owner's own complete days only (95% of readings present, scaled by the missing share, at most 5%):
  mean, weekday and weekend day, base load (10th percentile), peak power and hour, hourly patterns, monthly means; it refuses
  below 7 complete days and for readings coarser than hourly, and says what it cannot know (flexible load, weather
  sensitivity, seasons). Deleting an import deletes the fingerprint and rebuilds it from what remains.
- DONE: the Energy Twin records consumption (ESTIMATED, with the days it came from), a profile per asset kind, and the meter
  basis; **FULL now needs 0.95** (consumption and a tariff are both required; only the satellite scene may be missing). Before
  this change meter data alone would have reached 0.9 and FULL without a tariff, contradicting the documented rule.
- DONE: web. Tabs Meter data (upload with a unit choice, accounting of every row, daily chart with partial days faded and
  named, Energy DNA with patterns) and Assets (four forms with percent inputs, cards that mark each parameter ENTERED, DEFAULT
  or PLANNER, edit and delete), `useApi` hook, equipment and electricity-use sections on the twin page.
- DONE (evidence): API `typecheck`, `lint`, `test`: **397 tests** (was 258) incl. `meter-parse` 46, `energy-dna` 17, `energy`
  20 and `assets` 55 on real PostGIS; web `typecheck`, `lint`, `test`: **164 tests** (was 108).
- DONE (evidence, manual, real browser against the running API): a 21-day 15-minute file whose header gave no unit was refused
  with the explanation and prompt; with kW chosen, 2,011 rows became 2,008 stored plus 3 refused (bad time, negative, not a
  number) and the 2-hour gap was reported and left; the DNA matched the by-construction answer (weekday 18.4 and weekend 24.4
  kWh a day, busiest hour 19:00, the day with the gap excluded as incomplete); battery, solar system, EV, fridge (critical) and
  washer (flexible window) were added through the forms; a geyser needing 120 minutes in a 60-minute window was refused with
  those numbers; Analyze again produced twin v3 with consumption 20.2 kWh/day, the equipment summary, completeness 90%.
- FOUND AND FIXED on the way: (1) a Zod 4 `.default()` inside a `.partial()` PATCH schema silently resets fields the caller did
  not send (status, quantity, interruptible): the field sets carry no defaults now, with regression tests; (2) `Prisma.JsonNull`
  stores a JSON null, not SQL NULL, and the new CHECK refused it with a 500: `Prisma.DbNull`; (3) my number reader joined
  `"1 2"` into 12: a space is a thousands separator only in its exact shape; (4) my test helper treated `undefined` as "use the
  default session", so an "unauthenticated" check ran signed in (now `null`); (5) the FULL threshold above; (6) validation
  messages for our own rules no longer carry a technical field path; (7) the tool shell turns `﻿` and apostrophes inside
  heredocs into trouble: files with those are written with the file tools.
- NOT DONE (be exact): no NILM engine (and none is claimed); no utility-portal connectors or live smart-meter feed; only CSV;
  consumption from monthly bills alone is not accepted; no export or generation columns; a fingerprint needs hourly or finer
  readings; no weather sensitivity or flexible-load parts of the DNA; no battery degradation, no EV or appliance scheduling (the
  optimiser does not exist); Energy DNA is not yet used by any forecast; no browser end-to-end suite.

Next (in order): see the end of entry 10.

## Entry 10: 2026-10-08: the Python engine, forecasts and the planner (milestone 4)

- DONE: `platform/engine` (FastAPI, stateless, internal, keyed: D15). **Optimiser** (`optimise.py`): one LP, a MILP when a
  non-interruptible appliance exists, HiGHS via scipy; grid, solar, battery (efficiencies, SOC limits, reserve, terminal level,
  wear), EV by a deadline, flexible appliances in windows, outages with critical-load shedding, six modes whose weights are
  returned; costs always at the true prices; a do-nothing baseline; an **independent validator** that recomputes every balance
  from the returned schedule. Verified by hand-solved cases, 85 randomised invariants, a dynamic-programming cross-check (the LP
  is never worse than DP; gap 0.02 to 0.33 INR on the checked cases) and deliberately corrupted plans.
  **Solar** (`solar.py`): pvlib Simplified Solis + Erbs + isotropic, power by the EMS's formula (a test pins the two together);
  the band is the empirical error of the provider's own day-ahead forecasts by sky condition. **Load** (`load.py`): four methods
  on a chronological holdout, the quantile model only if it beats the best baseline by 2%. 362 engine tests, ruff clean.
- DONE: API side. `api/src/engine` (client, zod-validated replies, three honest errors), `api/src/providers/forecast-history.ts`
  (Open-Meteo previous-runs: the analysis and the one-day-ahead forecast for the last 45 days, cached 3 h, stale-if-error, the
  latest unbroken run only, nothing bridged), `api/src/forecast` (solar forecast, its performance, load forecast; stores each
  forecast as issued in `forecast_runs`), `api/src/plan` (builds the optimiser input and stores plans in `optimization_runs`).
  Routes: `GET /api/properties/:id/solar-forecast`, `.../solar-forecast/performance`, `.../load-forecast`,
  `POST/GET /api/properties/:id/plan`, `GET .../plans`, `GET .../plans/:planId`. New error codes `PLAN_INPUTS_MISSING` (422, lists
  what is missing) and `PLAN_INVALID` (502). Two migrations with hand-written CHECKs (`forecast_runs`, `optimization_runs`).
- DONE: web. Forecast tab: solar output and electricity use with shaded 10 to 90% bands, the range check, the methods table and
  the skill table against the naive baselines; Plan tab: mode, horizon, battery charge, the outcome against the same day with no
  control, charts (where the power comes from, battery charge, price), every decision with its reason, every assumption,
  earlier plans.
- VERIFIED LIVE (real browser, running API and engine, live Open-Meteo): a 5 kWp Bengaluru roof, 3 days, band present, the band
  held on 78% of 106 unseen hours (target 80%), and the model missed 10% less than repeating yesterday's output over 46 days; a
  load forecast from 70 days of hourly readings chose 'same hour of the week' at 0.08 kW mean error with 84% of unseen hours
  inside its band; a Jaipur property on the real Rajasthan ToD order made a balanced plan from the UI: ₹76.50 against ₹105.13
  with no control. (The meter file in the throwaway test account was generated by a script with a known weekly pattern, to
  exercise the pipeline; it is not presented as anyone's data.)
- FOUND AND FIXED on the way: (1) the first live plan worded its reasons in UTC ("imported at 00:30" for a 06:00 decision):
  the engine's `startTime` now carries the local offset, with a test that fails without it; (2) a stored saving differed by a
  paisa from the difference of the two costs shown, and the new CHECK refused the row with a 500: the saving is now the
  difference of the rounded costs, unit-tested; (3) `resample` matched provider hours on the UTC hour grid only, which would
  have made every load value unknown (the load forecast is labelled on the IST hour): it now works on interval overlap, with
  tests for both labellings; (4) a solar forecast above the clear-sky model is legitimate (cloud-edge enhancement, up to 1.25
  times, then clipped), so 'clear sky' is documented as a reference, not a ceiling; (5) `persistence_24h` became the wire name
  `persistence24H`: renamed `persistenceBaseline`; (6) the band's coverage check was skipped when any sky condition was rare in
  the fitting part; it now uses the same pooled fallback the issued band uses, and says 'not checked' only when too few hours
  were held back; (7) `-0` printed for a tiny negative number; (8) tests that depended on the hour of day (a car leaving at
  07:00, 'data ends less than a day ago') now pin the clock; (9) a Python `'''` string in the shell turned `\b` into a backspace.
- NOT DONE (be exact): no risk-aware objective; no outage data (resilience is a held reserve); no carbon factors (Green mode
  weighs imports only); one battery (several are summed), one EV, one run per appliance per plan; plans are 24 or 48 hours, not
  rolling, and nothing re-plans when a forecast changes; no net-metering or demand-charge settlement; solar is scored against
  the weather model's analysis, not generation (no generation meter in the data model); no job re-scores stored forecasts
  against later readings, so the learning loop is not closed; the engine is not packaged for deployment (no Dockerfile: the
  Docker engine cannot run here); the web Plan and Forecast tabs have not had a screen-reader pass.

- DONE (later the same day): **the learning loop for load forecasts** (`api/src/forecast/evaluate.ts`). Stored forecasts are scored against the readings that follow them, automatically after each meter import and on request: error, bias, band coverage, and skill against the same hour a week earlier; a forecast with too few readings is closed NOT_SCORABLE with the reason. A Forecast-tab panel shows each run. A household built to use exactly 20% above its pattern scored, to two decimals, as the arithmetic says it must. NOT DONE: no recalibration or automatic method switch from the live scores, no scheduled job, solar still scored against the weather model's analysis only.

- DONE (2026-10-08): **what-if scenarios, economics and a cyclic battery** (milestone 5, part 1). Engine: `POST /v1/solar/typical-days` (one clear-sky day per month scaled to NASA POWER's monthly irradiation, local hours; 11 tests including agreement with the forecast engine's energy on the same day) and a `cyclic` battery option in the optimiser (the day repeats; the planner picks the starting charge; the validator checks the reported start). API: `src/scenarios` (`annual.ts` weights 24 planned typical days by the next 365 days' calendar, `economics.ts` payback/discounted payback/NPV/IRR, `service.ts`), routes `POST/GET/DELETE /api/properties/:id/scenarios`, table `scenarios`. Web: What-if tab (form, headline saving, monthly chart, the money with cash-flow chart, subsidy shown beside and never netted, carbon only from a given factor, every assumption, history). Verified live against the Rajasthan order and NASA POWER: adding 3 kWp to a 5 kWp + 10 kWh site in Jaipur saved about INR 19,100 a year, nearly all of the extra solar being exported at the assumed 3.5, which the page says.
- FOUND AND FIXED: (1) a first cut started every typical day at a mid-range battery charge, which halved what a battery could do (a battery alone saved INR 5,372 where its full cycle allows about 10,000): the day now repeats and the start is chosen; (2) the export credit decides most of a solar saving, so plans and scenarios now state its basis and how much of the solar is exported; (3) yearly figures were shown to the paisa and are now whole rupees; (4) a flat tariff chosen as 'cheaper' in a test was dearer: the test checked the arithmetic, not my guess.
- NOT DONE: no opportunity ranking, no EV or appliance scenarios, no weather variability (a typical day is a mean day), no emission-factor table, no net-metering settlement, no financing or tax, battery replacement not modelled, no state detection for tariff comparison.

Next (in order): (5) the engines that depend on these: opportunity and value engines, the what-if simulator (24 h to a year),
counterfactual, economics (NPV, IRR, the PM Surya Ghar calculator once an installed cost is given), carbon (needs a sourced
factor table), resilience, autonomy, health and waste scores, the learning job, Copilot tools (the LLM adapter needs the
owner's key), human-control modes with audit and rollback, community and VPP simulators; (6) admin, the job runner (pg-boss),
observability, privacy and security review, demo data, Docker and hosting files, the documentation set.
