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
