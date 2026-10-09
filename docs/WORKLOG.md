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

- DONE (2026-10-08): **opportunities** (milestone 5, part 2). `POST /api/properties/:id/opportunities` tries example sizes of solar and a battery, and the owner's own other tariffs, on the typical year; ranks what saves at least INR 100 a year; gives each the price above which it would not repay itself (no price list); lists what was tried and dropped; and says what the records lack. The scenario service was split into `prepareYear` (the inputs, gathered once) and `applyChange` so a base year is simulated once for many candidates. The What-if tab got the panel, with 'try it with my prices' filling the form. FOUND: a guess that a flat tariff would beat a time-of-day one was wrong for a site with a battery (the test now compares like with like), and jsdom has no `scrollIntoView` (guarded). NOT DONE: no ranking by return, no stored history of suggestions, no appliance-shifting suggestion.

- DONE (2026-10-08): **the Copilot and the report** (milestone 5, part 3). `src/copilot`: sixteen tools over the existing services (the fourteen of §91, plus the latest plan and forecast accuracy), fixed-pattern routing of twelve kinds of question, template wording with `[n]` citations to the tool results, and the full results returned for inspection. The core promise of §90 is a test: every number in every answer is one a tool returned (rounding allowed only to the precision written), and a made-up number is refused. An optional language-model adapter (Anthropic Messages API, key from the environment) only rewords the answer and is discarded when it states an ungrounded number or cites nothing; it is NOT verified against the real service (no key). The Ask tab shows answers with clickable source numbers that open the data. `GET /api/properties/:id/report` downloads a Markdown report assembled from what is stored (no recomputation), with every label and each gap's reason. FOUND AND FIXED: the first guard compared numbers to 0.5% of the tool's value and so rejected a legitimately rounded '3.4' for 3.37: it now allows rounding to the precision written and nothing more; a subsidy question that named a size was routed to a what-if; the accuracy pattern did not match 'accuracy'. NOT DONE: no conversation memory, no Hindi, no follow-ups; the Copilot cannot change settings or schedules (no human-control layer, §46).

- DONE (2026-10-08): **community view and virtual power plant simulator** (milestone 5, part 4). `src/vpp`: `sample.ts` (a seeded generator, so a run is reproducible; the battery share applies to homes that have solar), `service.ts` (`simulateVpp`: a fleet of 10 / 100 / 1,000 / 10,000 synthetic homes drawn around one of the owner's own properties as the pattern: its Energy DNA, its tariff, NASA POWER climate, a 1 kWp typical day from the engine; compared with and without coordination: shiftable load moved to the cheap hours inside a power cap no lower than what the uncoordinated fleet already draws, so coordination can never raise the bill; an aggregate cyclic battery; vehicles in a window from 18:00; every assumption returned), `community.ts` (the owner's own properties on a typical day: surplus, deficit, what pooling could shift; a property without readings is `NO_DATA` with the reason and no invented number). Routes `GET /api/community`, `POST /api/vpp/simulate`; web page `/community` and a nav link. Labelled `COMMUNITY ENERGY SIMULATION` and `VIRTUAL POWER PLANT SIMULATION`, values `SIMULATED`. Answers worked by hand are tests (with 15% of the load shiftable the peak falls 15%, and 100 homes save INR 1,020 a day). FOUND AND FIXED: a first design moved appliances without a power cap, which could raise the evening peak it was meant to cut.
- NOT DONE: every default share and size (solar, battery, vehicle, shiftable) is an assumption and says so, not a survey figure; one typical day per run, not a year; no feeder or network limits, no market or dispatch revenue; no neighbours or other accounts (only the owner's own properties are ever read); AVISHKAR does not move electricity between properties and no sourced rule says whether sharing across meters is allowed; no city energy map; no real homes are coordinated.

- DONE (2026-10-08): **the demo world and the cloud-front scenario** (milestone 5, part 5). Demo world (`api/src/demo`): `POST /api/demo/world` adds four properties to the owner's own account (Bengaluru home, Pune shop, Jaipur clinic, Mathura home) with invented, deterministic hourly readings (120 days, imported through the ordinary importer), equipment, and the sourced catalogue tariff where one exists (an invented, named tariff for Bengaluru); `DELETE` removes them; loading twice changes nothing. `isDemo` properties are now visible and flagged (the foundation had hidden them); a `preSerialization` hook relabels every computed value for a demo property DEMO and records the original label in its notes; outside providers' values, sourced references and UNAVAILABLE keep theirs; the report and the Copilot open with DEMO DATA; the community view leaves them out; the web shows a DEMO badge, a banner on every tab and a separate list. Cloud front (`api/src/cloudfront`, `POST /api/properties/:id/cloud-front`): the plan inputs were extracted (`buildPlanInputs`) so the day can be planned twice, on the forecast sky and on one with a front (arrival, share of sun, duration: the person's); advice (charge now / hold / no change / no battery) is read from the difference between the two plans; with and without AVISHKAR are the plan against the no-control baseline on the front sky. Verified in a real browser: loaded the world, opened the Jaipur clinic, made a real plan (DEMO badge), ran the front: real forecast, and the planner said **no change** for that clinic, which the page shows rather than forcing 'charge now'. FOUND AND FIXED: the import difference was rounded on its own and could differ by 0.01 from the difference of the two values shown (now the difference of what is shown, as for costs); 'the front costs X with the plan' exceeded 'with no control' for a reason that needed saying (the plan had more sun to lose), so the page now gives both days' costs and a sentence on it; a test expected 204 where the API answers 200.
- NOT DONE: no demo of a cloud-front case where the planner changes its action (the demo clinic's answer is no change, and no site was tuned to make it otherwise); the front is never observed (no nowcast source); no execution simulation of a plan made blind meeting the front; the demo world is not seeded at start-up or by a migration (each owner adds it); demo readings use invented load shapes.

- DONE (2026-10-08): **recommendation explanation, resilience and autonomy** (milestone 5, part 6). Every plan now carries a recommendation (`api/src/plan/explain.ts`): what to do in the next three hours read from the plan's battery moves, the planner's own reasons, the data used, the assumptions, the expected benefit (the whole plan against no control, not the move alone) and a confidence that is a COUNT, not a probability: the day is planned again with the sun and the demand at the 10th and 90th percentile of their forecast bands and the count is the forecasts in which the advice is the same ('5 of 5 forecasts agree'), each listed; with no battery or no band it says 'not assessed' and why. Resilience (`api/src/resilience`, `GET /api/properties/:id/resilience`, new Resilience tab): hour-by-hour arithmetic (no solver: for survival the best policy has no choices) of how long the CRITICAL appliances are served if the grid failed at the start of the next hour, with the forecast sun and with the battery alone, a score (hours out of 24), the reserve to keep for the time you ask and whether the battery can hold it; grid outage risk is returned UNAVAILABLE with the reason. Autonomy is read from the latest plan (100 x (1 - bought / used)) with its parts and method. Hand-solved tests (6 kWh, 1 kW, 90% discharge: 4.5 h; with 2 sunny hours first: 6.5 h). Verified in a real browser on the demo clinic: recommendation 'leave the battery until 01:00' with the planner's reason for the next move, 5 of 5 forecasts agree on live bands; resilience 9.5 h on the battery alone for a 0.3 kW vaccine refrigerator on 3 kWh above the floor, which is the hand arithmetic. FOUND AND FIXED: the first test of the reasons compared the recommendation's text with a list that contained it (always true): it now checks each reason is one of the plan's own decisions; the set-state-in-effect lint rule made the first Resilience view restructure its first fetch as a promise chain.
- NOT DONE: no energy health score and no waste engine (their normalisations would be invented); the Copilot's getResilience tool is still the older batteries-only figure; the recommendation's confidence tests only the next three hours' battery moves, not appliances or the vehicle, and only against the forecast bands (not a wrong tariff or a missing reading); the resilience critical load is the rated power of every CRITICAL appliance together; no outage data.

- DONE (2026-10-08): **human control, background jobs and the admin API** (milestone 5, part 7, and the start of milestone 6). Control (`api/src/control`, the Control tab, migration `20261008150000_jobs_and_control`): Observe / Recommend / Approve / Automate; a plan's moves become proposals with the planner's own reasons, each checked against the owner's safety limits (a move that breaks one is BLOCKED and cannot be approved: also a database CHECK); unanswered moves expire; every decision audited; withdraw and rollback; the server says why each action is not allowed. `DeviceExecutor` is the seam and the only one shipped declines ('No device is connected ... nothing was changed'), so Automate cannot be chosen; a fake device in the tests proves the apply, revert, failure and authorization-expiry paths. Jobs (`api/src/jobs`): forecast scoring, weather refresh, satellite ingest, tariff validity; due by when a job last started; failures retried sooner; no double run across processes (short advisory lock around the check and insert); a dead run stops blocking after 30 minutes; a job past 10 minutes is abandoned; `JOBS_ENABLED=true` runs the scheduler (off by default). Admin (`api/src/admin`, `/admin`): overview of data health, providers, models and the catalogue (an expired order is flagged), usage, jobs with run-now, and a paged audit log; counts only (a test searches the response for names, addresses and emails); the role is granted only by `pnpm -C platform/api db:make-admin` (audited), registration always makes an ordinary user (tested). Driven in a real browser: the Control tab on the demo clinic (switched to Approve, proposed the plan's three real moves with their reasons, approved one: 'No device is connected ... nothing was changed. Your approval is recorded.'), and the Admin page after granting a local test account the role from the command line (the scheduler ran all four jobs against the live providers: weather and satellite for 7 places, 0 failed). An axe-core audit of the pages in light and dark themes found one issue (the map page had no level-one heading); it is fixed and the Admin, Control, Plan and Map pages now pass in both themes. This is automated checking only. FOUND AND FIXED: Prisma refuses an update that sets both a relation and its foreign key (500 on every decision); a test's safety limit was stricter than the plan keeps to; the first Resilience view set state synchronously in an effect.
- NOT DONE: no device integration of any kind (so nothing is ever applied); limits cover battery power and lowest charge only; no second-person approval; the admin page edits nothing but runs a job; no pg-boss; opportunity recalculation and re-planning are not scheduled; no screen-reader pass; the Community page and the Hindi/English text of the Python dashboard are the only pages not driven in a browser.

- DONE (2026-10-08): **the Today view and measured response times** (spec sections 97, 98 and 77). `GET /api/properties/:id/today` and the Today tab (first tab; the home page links each of a signed-in owner's properties to it): autonomy, generation, consumption, surplus, weather risk, critical-load backup, expected value and confidence, then what to do next with a Why? chain, and what is expected to be achieved; all read from the latest stored forecasts and plan, each labelled and dated, UNAVAILABLE with a reason and a link where missing. The resilience engine took an injected sun so Today needs no engine call. `pnpm -C platform/api bench` measured the spec's targets against the live servers: cached queries 20 to 70 ms, a 24-hour plan with the recommendation's re-plans 2.06 s (target 3 s), a one-year what-if 1.46 s (target 5 s); all met, on one machine and one user. The tariff-validity job now judges only the catalogue. Driven in a browser on the demo clinic; axe-core found a skipped heading level on the new page and it is fixed.
- NOT DONE: no concurrent-load test; map tile loading not measured (public tile servers); 'achieved' cannot be measured without a device feed; the Copilot's resilience answer now carries the engine's figures too (see the next block); no health score and no waste engine; no city map; no deployment files (Docker cannot run here); the language-model Copilot path is untested against the real service.

- DONE (later the same day): a fresh-user walk through the real UI (register, search a real place, preview with live labels, build the Energy Twin, read Today) found three things, all fixed: the to-do list on Today offered 'make a solar forecast' to a property with no solar system (it now offers to add one, and lists things in the order they depend on each other, a tariff and readings first); the backup tile showed '0 h' for a battery whose charge is not known without saying so (it now says the charge is taken at its lowest and asks for the real one); and the weather-risk tile said MEDIUM twice. The Copilot's resilience answer now also gives the hours with the forecast sun, the score and the reserve to keep, from the same engine as the Resilience tab, so the two pages no longer differ in what they say.

- DONE (later the same day): **security headers, and a production-only bug the browser found**. The web app now sends a Content-Security-Policy (own origin for code and data; the three tile hosts and a provider chosen by `NEXT_PUBLIC_OSM_TILE_URL` for map tiles; no framing, plugins or foreign scripts), `nosniff`, a referrer policy and a permissions policy (`src/lib/csp.ts`, tested against the map's real tile hosts; inline scripts still allowed, which SECURITY.md says). Checking it in a real browser showed the map blank, and the cause was not the policy: **MapLibre v6 finds its tile worker by a fixed file name, and a production build renames every asset with a hash, so the worker was a 404 and the map never drew in any production build** (it had only been checked with the dev server, and CI only builds). `scripts/copy-maplibre-worker.mjs` now copies the worker and its shared chunk to `public/maplibre/` at build time and `MapCanvas` points MapLibre at them; verified in a production build in the browser (OpenStreetMap and Esri tiles draw under the policy). Also found and fixed in the report: a missing space ('Made2026-...') and times written in UTC beside reasons written in IST (now IST, with a test that the two agree).
- NOT DONE: no nonce-based CSP; no Strict-Transport-Security (it belongs with TLS at the proxy); no browser end-to-end suite, which is what would have caught the blank production map.


- DONE (2026-10-09): **the Account page, a fuller export and an honest deletion** (spec section 50). `/account` (linked as Account once signed in, which is also the only link on a phone) says what AVISHKAR keeps about a person, what each outside service is sent and how precisely (read from the code: weather, solar-resource and forecast-history places are rounded to about 1.1 km; the satellite search to about 110 m; the building-outline search and a clicked reverse-geocode point to about 1 m, because they have to find one building or one place; the tile hosts see the area looked at; a language model only when the operator switched one on), a download of the export, and deletion that needs the password. Writing it showed two gaps, both fixed: (1) the export held only the account, the properties and the audit log, so its words would have been untrue: it now also carries each property's equipment, the meter files imported (names, rows accepted and refused, dates), tariffs the person entered, the control mode and limits, and counts of what is stored (`api/src/account/holdings.ts`); it still does not repeat the readings or each plan, and the page says so; (2) after deletion the append-only audit log kept the network address of every request the person made: a migration (`20261008170000_erase_ip_on_account_delete`) lets the one edit that erases the user link together with the address through the append-only trigger (any other edit is still refused), and deletion now does that in one transaction with writing an anonymous marker and deleting the user. `api/test/account-deletion.test.ts` pins this (4 tests on real PostGIS): every foreign key to users or properties cascades except four named ones, a whole-database row count before and after deletion shows nothing of the account left (the check fails if the account had no data, so it cannot pass vacuously), no audit row of the account keeps a link or an address (checked red by removing the erasure), and the trigger still refuses every other edit. Web: `AccountView.test.tsx` (5), `AuthProvider.forget()` (the server already ended the session), `/account` added to the production smoke test. Driven in a real browser against the running API: a throwaway local account, the page, the export, a wrong password refused with the account kept, the right one deleting and returning to the home page signed out (`/api/auth/me` 401), and the database showing the user gone and its audit rows unlinked with no address.
- NOT DONE: the export is JSON only and lists at most the first 1,000 audit entries; no consent screen, retention schedule or backup policy (the operator's); no email confirmation before deletion; the audit rows of a deleted account still show what was done and when, and the ids of records that no longer exist.

- DONE (2026-10-09): **energy health and energy waste** (spec sections 35 and 36), in the honest form the data allows. `api/src/insight/calc.ts` is arithmetic on one stored plan, with no weights and no targets: seven health metrics, each a ratio that means what its formula says (efficiency = 1 minus battery losses and solar thrown away over what came in; solar utilisation; peak management = 1 minus the grid's highest hour over the property's highest hour of use; storage utilisation = range of charge used over usable capacity; grid dependence; flexibility = car and appliances with a window over use; and resilience in hours from the stored sun, through a helper now shared with Today), each with its formula in words and UNAVAILABLE with the reason where it does not exist (no solar, no battery); and no overall score, because it would need invented weights, which the page says. Waste: solar thrown away (valued at the export price, with the planner's own reason), surplus sold (not called waste), energy sold in one hour and bought dearer later (first in first out, an upper bound), energy bought at the day's highest price, and the avoidable cost per day (the plan's saving over no control) and per average month, the latter only when a what-if run has worked out a year; the appliance schedule and the battery's lost opportunity are UNAVAILABLE with the reason (the first is inside the plan's own saving; the second needs a battery history that does not exist without a device feed). `GET /api/properties/:id/health` and `/waste`, the Health tab, and two Copilot tools and intents (`getEnergyHealth`, `getEnergyWaste`: 'How healthy is my energy use?', 'Where am I wasting energy?'), whose wording is checked number by number against the tool results. Tests: `insight-calc.test.ts` (19, hand-checked on a four-hour plan whose arithmetic is in the file), `insight.test.ts` (against the real engine: ratios agree with the plan's own totals, an average month appears only after a what-if run, a stale plan is called stale and nothing is recomputed), Copilot pure and integration tests, `HealthView.test.tsx` (6). Driven in a real browser on a Pune home with a real plan: the figures were checked by hand (use 12.7 kWh = 11.7 + a 1 kWh washer; grid dependence 1.56 / 12.7 = 12.3%; efficiency 1 - 0.72 / 36.8 = 98%; storage range 6.86 of 9 kWh). The Community page was also driven in a browser, including a simulated fleet of 1,000 homes, with its numbers checked by hand against the readings generated for it.
- FOUND AND FIXED on the way: the plan's `selfConsumptionRatio` (engine `self_consumption_ratio`) was described as 'solar used on site' but is solar not thrown away, so solar that is exported counts as used: a property that sold every unit would show 100%. The web already worded it 'put to use (used, stored or sold)'; the API and engine descriptions now say what it is, and the health metric is named solar utilisation. The wire name is unchanged (stored plans carry it).
- NOT DONE: health and waste describe a simulated day (a plan), not measured operation, because there is no device feed; no overall health score by design; a month's avoidable cost is an average month from a typical year, not this month; no waste finding for the appliance schedule or the battery; no city energy map (section 49); no Dockerfiles or compose file (Docker cannot run here, and an untested one would be a claim).

- DONE (2026-10-09): **energy futures** (spec section 16). `api/src/futures`: `scenarios.ts` (pure) builds eight days from one plan's inputs and says what each is built from (the expected day; sunny, heavy cloud and high demand from the ends of the forecasts' own measured bands; rain as a share of the expected sun the person sets; a battery offline; a grid outage the person asks about, placed on the local clock; and heavy cloud, high demand and an outage together), `service.ts` plans each afresh through the real engine and reports cost, no-control cost, energy bought, autonomy, battery cycles, critical load unserved with and without the plan, and load switched off. `POST /api/properties/:id/futures`, the Futures tab. Choices made so the page cannot mislead: a day that cannot be built says why and shows no number; a day whose band has no width (perfectly regular readings give a load band of zero width) is flagged as the expected day instead of being shown as a finding; an outage day is not compared with the expected day because its bill is lower only since load is switched off, and the cheapest-to-dearest spread leaves outage days out; the days carry no probability. Found while driving it in a real browser: the first outage asked for '6 pm for 4 hours' fell, at 7 pm, on the very end of the 24 hours and covered one hour; the page now shows the hours planned and the day says it was cut. Tests: `futures-pure.test.ts`, `futures.test.ts` (consistency with a stored plan's cost to the paisa; less sun is never cheaper; rain at 100% is the expected day and is flagged so; battery offline has no cycles and is no cheaper; the outage switches off 6 kWh in a 4-hour evening outage; no critical appliance gives UNAVAILABLE), `FuturesView.test.tsx`. Also found: a stale `next start` from the previous session was still holding port 3000 and serving old files (check `netstat` before trusting a restart).
- NOT DONE: no tariff, EV-demand or cloud-cover-series futures; no probability weights and no regret of a plan made on the expected day; no Copilot tool for futures.

- DONE (2026-10-09): **deployment files, honestly marked** (spec section 94). `platform/docker/{engine,api,web}.Dockerfile`, `platform/docker-compose.yml` (PostGIS, engine, API, web; only the web port published; secrets required, not defaulted), `platform/.dockerignore`, and `platform/engine/requirements-runtime.txt` (the engine's real imports at the versions the whole environment was verified with: it does not import the EMS or EMHASS, so an image need not carry the 112-line lock file). The Docker engine does not start on this machine (`docker info` fails to reach the daemon), so nothing was built; each file says UNTESTED at its top. Checked instead what each image rests on: the engine's 407 tests pass in a virtual environment built from that requirements file alone; the web app's standalone output, with `.next/static` and `public/` copied beside `server.js` as the Dockerfile does, serves every page, the map worker files and the security headers (`pnpm smoke` passed against it on another port) and proxies `/api` to the API; `docker compose config` accepts the compose file and refuses to run without `SESSION_SECRET` and `PROVIDER_USER_AGENT`. A first attempt to run a copy of the standalone folder failed with a missing module because a Windows copy does not keep pnpm's symlinks: the layout works in place, which is what a Linux `COPY` preserves.
- NOT DONE: no image built, no stack run, no hosting, TLS, domain, backup, staging or rollback.

- DONE (2026-10-09): **the city energy map** (spec section 49), built as far as there is a source and no further. `api/src/city/grid.ts` (pure: a square of equal cells on an equirectangular approximation, every point of the square in exactly one cell), `service.ts`, `POST /api/city`, and a City page that draws the cells on the real map, coloured by the solar resource at each cell's centre (NASA POWER's 20-year climatology, REFERENCE), with the owner's own properties placed in the cells they fall in. `MapCanvas` gained a `cells` prop (a fill colour per feature, under the outlines).
  The honest part is what it refuses to draw. A city's demand, storage, vehicles, flexibility and energy risk are each UNAVAILABLE with the reason, because AVISHKAR holds no meter data but the owner's own and no register of anything; a number there would be invented. And because NASA POWER's grid is coarser than a city, the response counts how many different values the cells got and says so: driven live, a 12 km square over Jaipur gave every cell 5.44 kWh/m2/day and the page said "the colours show one number, not a pattern"; widening it to 60 km gave 5.00 to 5.44 with "a difference this small is the model's grid showing through". Cells smaller than 1.1 km are refused, since the provider is asked about a point rounded to about a kilometre.
  Found by the tests while writing it: `reduce(fn, 3)` in the flexible-load total was passing 3 as the starting accumulator, not as a rounding precision, so every cell's flexible load was 3 kW too high.
- NOT DONE: no demand, storage, vehicle or risk layer (no source); no shading, terrain or roof-area modelling; no feeder or network data; nobody else's properties, by design.

- DONE (2026-10-09): **the acceptance walk and the quality bar** (spec sections 95 and 96), written down in `platform/docs/ACCEPTANCE.md`. A completely fresh account, registered through the web app's own form, was driven through the real interface against the live providers and the real engine: searched Koramangala in Bengaluru, saved it, built the Energy Twin (a real 43.1 m2 OpenStreetMap outline, a Sentinel-2B scene from that morning, live weather), imported 70 days of readings through the page's own file input, typed a tariff because none is on file for Karnataka, made solar and load forecasts (band held on 86% of 105 unseen hours), found opportunities with break-even prices, planned the next 24 hours (INR 56.03 against INR 64.09 with no control), read the allocation and every decision's reason, ran a what-if with a quote (payback 9.09 years, NPV INR 8,764, IRR 8.88%), asked the Copilot why the battery charged at noon and opened the tool result behind the answer, and downloaded the report. Every step passed and none used fixtures, seeded data or the demo world. The document also records the section 95 checks with their results (849 API tests in 54 files, 323 web in 36, 407 engine, the production smoke test, migrations, the security list) and ends with what would have to be true to call the thing finished.
- FOUND: the tariff catalogue holds only Maharashtra, Rajasthan and Uttar Pradesh orders, so a Bengaluru owner has to type their own rates; the page handles it and labels them YOURS, but the catalogue cannot yet serve most of India. Also recorded: the load forecast's near-zero error on this walk is an artefact of the generated readings repeating exactly every week, not evidence about households.

- DONE (2026-10-09): **the dependency audits run, and written down** (a gap SECURITY.md had listed as never done). `pnpm audit` reports six advisories: three in lodash through Prisma Studio's chart library, two in the MySQL driver the Prisma CLI bundles, one in `@prisma/config`'s `deepmerge-ts`. Every one is inside the `prisma` CLI's own tree, which is a devDependency used for `generate` and `migrate`; the built server imports only Fastify, its plugins, zod and the Prisma client runtime (`@prisma/client` depends on `@prisma/client-runtime-utils` alone), this project talks to PostgreSQL through `@prisma/adapter-pg` so `mysql2` is never loaded, and Studio is never started. The lodash advisories have no fixed version published (they ask for >=4.18.1; npm's latest is 4.17.21), so an override would break rather than fix. `pip-audit` on `requirements-lock.txt` and on the engine's runtime requirements finds nothing. SECURITY.md now carries the commands, a table of each finding and why it is not in the running service, and says to re-run them before deploying; they are deliberately not a CI gate, because a permanently red gate for an unfixable upstream pin teaches people to ignore it.

Next (in order): (5) the engines that depend on these: the PM Surya Ghar calculator once an installed cost is given, carbon
(needs a sourced factor table), resilience, autonomy, health and waste scores, the city energy map, the demo world, Copilot
LLM verification (needs the owner's key), human-control modes with audit and rollback; (6) admin, the job runner (pg-boss),
observability, privacy and security review, Docker and hosting files, the documentation set.
