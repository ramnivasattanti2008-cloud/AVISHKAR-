# Testing and verification, 2026-10-30

Every command below was run in this container on 2026-10-30 against a real PostgreSQL 16 + PostGIS 3.4, the real
Python optimiser, the real public data providers and a real Chromium. The result quoted is what it printed.

Levels of evidence are kept apart on purpose, because they are not interchangeable: a unit test, an integration
test against a real database, an end-to-end journey over HTTP, a check in a real browser, a simulation, physical
hardware testing and independent certification are seven different things. Only the first four happened here.

## Automated test suites

| Suite | Command | Result |
|---|---|---|
| Python EMS | `.venv/bin/python -m pytest tests/avishkar_ems -q` | **589 passed, 1 skipped** (was 554 at session start) |
| Platform engine (FastAPI + scipy/HiGHS) | `python -m pytest tests -q` in `platform/engine` | **448 passed** in 41.5 s |
| Platform API (real PostGIS) | `pnpm -C platform/api test` | **994 passed**, 69 files, 346 s |
| Platform web (vitest + jsdom + axe) | `pnpm -C platform/web test` | **387 passed**, 45 files (was 366) |

The one skip is `tests/avishkar_ems/test_dashboard.py`, which skips itself unless the disk cache is fresh. That
skip is why a dashboard that could not start at all passed 554 tests; `tests/avishkar_ems/test_app_imports.py` was
added to cover that gap and never skips.

## Static checks and builds

| Check | Command | Result |
|---|---|---|
| EMS lint | `ruff check src/avishkar_ems app scripts examples tests/avishkar_ems --no-fix` | All checks passed |
| Engine lint | `ruff check platform/engine --no-fix` | All checks passed |
| API types | `pnpm -C platform/api typecheck` | clean |
| API lint | `pnpm -C platform/api lint` | clean |
| API build | `pnpm -C platform/api build` | succeeds |
| Web types | `pnpm -C platform/web typecheck` | clean |
| Web lint | `pnpm -C platform/web lint` | clean |
| Web production build | `pnpm -C platform/web build` | succeeds |
| OpenAPI contract | part of the API suite | the committed `openapi.json` matches, and every operation is listed in `platform/docs/API.md` |

## The application starts

`./start-platform.sh` (new; the repository had Windows launchers only) brings up all three services and prints:

```
[avishkar] engine  -> http://127.0.0.1:8090
[avishkar] api     -> http://127.0.0.1:8080
[avishkar] web     -> http://127.0.0.1:3000  (production build)
[avishkar] all three are up. Open http://127.0.0.1:3000 — Ctrl-C stops them.
```

`GET /api/system/health` returns `"status":"ok"` with `"postgis":"3.4 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"`.
`GET /health` on the engine returns scipy 1.18.1, HiGHS 1.15.1 and all six optimisation modes.

The Streamlit dashboard starts with `./run-dashboard.sh` and answers on :8501. It had to be fixed first: it
crashed on import (issue 24).

## End-to-end over HTTP, through the running stack

`pnpm -C platform/web journey http://127.0.0.1:3000` — **41/41 ok**, against the real public providers and the
real optimiser. It walks: register → session cookie is first-party → a write without the CSRF header is refused →
create a property → import meter readings → nothing refused or repaired → Energy DNA built from complete days →
create a tariff and choose it → add a solar system, a battery, a critical appliance → every property page answers
→ a second account **cannot see** the first's property → a solar forecast → a load forecast from the readings → a
plan → the plan passes the planner's own check → the plan reports a cost against no control → the Copilot answers
from a tool result → every citation points at a tool result that exists → download the report → export everything
held about the account → the export holds no other account's data → deletion needs the right password → delete the
account → the session is over.

`pnpm -C platform/web smoke http://127.0.0.1:3000` — **12/12 ok**: every page answers 200 with a page, the map's
worker files are served under the names the library asks for, the security headers are sent, and an unknown page
is a 404 rather than a blank 200.

## In a real browser (the only check that sees a page)

`PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm -C platform/web browser` — **21/21 ok**.

**This was 1/21 before.** The web app's own Content-Security-Policy blocked React's hydration scripts, so every
page was non-interactive while answering HTTP 200. Neither the HTTP journey nor the smoke test can see that.
What the browser now confirms:

- the map draws tiles and changes when panned;
- each page renders its own content and nothing throws while it does;
- the keyboard reaches the skip link first and it points at the content;
- the theme switch changes the page and the choice survives a reload;
- a roof outline can be drawn with the mouse and the server really holds it;
- the meter page draws the readings and the Energy DNA;
- energy health says there is no plan yet rather than showing a score;
- **the allocation workbench works the specified three-building scenario out**: Building B receives 2 kW,
  Building C receives 3 kW, and the page says the community bought nothing;
- **editing a figure and recalculating changes the answer**: taking Building A's sun down to 1 kW makes the
  community start buying, and the page stops claiming it covered itself;
- **a feeder limit is applied and named**: with 3 kW of feeder, the page says the feeder was the binding
  constraint and reports the loss of carrying the energy.

The Streamlit dashboard was also opened in Chromium: no Streamlit exception, and no raw markup in the rendered
text. One cosmetic Plotly console warning remains (issue 27).

## The specified three-building scenario, number for number

Building A generates 8 kW and uses 3; B generates 2 and uses 4; C generates nothing and uses 3. Lossless, no
battery charging, sharing permitted. Checked as a unit test, over HTTP, and in a browser:

| Quantity | Expected | Engine |
|---|---|---|
| Total generation | 10 kW | 10 kW |
| Total demand | 10 kW | 10 kW |
| A's surplus | 5 kW | 5 kW |
| B's deficit | 2 kW | 2 kW |
| C's deficit | 3 kW | 3 kW |
| Allocated to B | 2 kW | 2 kW |
| Allocated to C | 3 kW | 3 kW |
| Community grid import | 0 | 0 |

Plus the two scenarios the brief asks for beyond it: generation falls and the community must buy (8.5 kW bought
from 1.5 kW of generation against 10 kW of demand, batteries used first and stopped at their reserve floors), and
a transfer constraint prevents full allocation (3 kW feeder: B gets 1.2, C gets 1.8, 2 kW bought, 2 kW sold, the
feeder named as the binding cap on both short properties).

## Energy accounting

The allocation engine checks its own arithmetic on every call, per member and for the community, and reports the
largest imbalance found. A 432-case sweep over generation, demand, feeder limits, losses, all four rules and both
battery policies asserts that every case balances, that nothing received exceeds what was asked, that nothing sent
exceeds what was offered, and that the feeder limit is never exceeded. Losses are charged exactly once each and
the pair-level transfers sum to the total loss.

## Performance against the specification's targets

`pnpm -C platform/api bench` against the running stack, 3 runs each, median and slowest in milliseconds. It
creates a throwaway account and writes real rows, so it is a development-server command.

| Measurement | Median | Slowest | Target | |
|---|---|---|---|---|
| GET property (cached query) | 10 | 24 | under 500 ms | met |
| GET properties list | 7 | 9 | under 500 ms | met |
| GET energy summary | 15 | 21 | under 500 ms | met |
| GET energy DNA | 8 | 9 | under 500 ms | met |
| GET latest twin | 11 | 22 | under 500 ms | met |
| GET today (stored forecasts and plan) | 17 | 43 | under 500 ms | met |
| POST plan, 24 h (the optimiser, with the recommendation's re-plans) | 174 | 747 | under 3 s | met |
| POST what-if, one year (24 typical days) | 841 | 974 | under 5 s | met |
| GET solar forecast (engine) | 77 | 1100 | none set | |
| GET load forecast (engine) | 34 | 627 | none set | |
| GET resilience | 83 | 120 | none set | |
| POST cloud-front scenario (two plans) | 131 | 136 | none set | |
| POST copilot question | 15 | 54 | none set | |
| GET report (Markdown) | 28 | 36 | none set | |

Every target the specification sets is met, with the optimiser an order of magnitude inside its 3-second budget.
The map-load target (under 3 s) is a browser measurement the bench does not make.

## The containerised stack

The deployment files had never been built or run. `dockerd` runs here, so they were.

| Step | Result |
|---|---|
| `docker build` the engine, API and web images | all three build |
| `docker compose up -d` | db, engine, api, web all reach `healthy` |
| `docker compose run --rm api pnpm db:migrate` | all migrations applied |
| `docker compose run --rm api pnpm db:seed` | **failed first**, then worked: see below |
| `pnpm -C platform/web journey` against the containers | **41/41** |
| `PLAYWRIGHT_CHROMIUM_PATH=... pnpm -C platform/web browser` against the containers | **21/21** |
| `pnpm -C platform/web smoke` against the containers | **12/12** |

Two defects were found by doing it, both fixed:

1. **`db:seed` could not reach the tariff and policy files.** The seeder resolves `data/` relative to its own
   compiled location, which is `/data` inside the image; those files live at the repository root, outside the
   build context, so they are not in the image. A deployed instance would have had no tariff plans and no policy
   rules at all. The api service now mounts the repository's `data/` read-only and sets `SEED_DATA_DIR`.
2. **The map was blank in every container.** `basemaps.ts` chose its tile URL with `??`, and the compose file
   passes `NEXT_PUBLIC_OSM_TILE_URL` as an empty string when the operator has not chosen a tile service; `??`
   falls through only on null and undefined, so the empty string became the tile template and the map asked its
   own origin for `/{z}/{x}/{y}.png`, received Next's 404 page and failed to decode it as an image. Measured on
   the running container: **0 tile requests, 22 decode errors, a 12 KB canvas** before, and **41 tile requests, 0
   decode errors, a 569 KB canvas** after.

The builds needed `--network=host` and a temporary layer trusting this sandbox's TLS-intercepting proxy. That
shim is not committed and is not needed where outbound TLS is not intercepted.

## What was NOT verified

- **Deployment on a real host**: the images were built and the whole stack was run **in this container** (see
  below), but not on a real host behind TLS with a real tile provider. TLS termination, a domain and a tile
  service with a usage policy remain the operator's to supply.
- **Hardware**: no inverter, meter or Modbus device existed. Every device path is simulated and labelled as such.
  Nothing here supports a claim of electrical certification, anti-islanding validation or grid-code compliance.
- **The upstream EMHASS suite** (`tests/test_*.py`): needs a separate environment and writes into `data/`; not run.
- **`pnpm -C platform/api test:live`** (calls the real public providers): **run. 6 of 7 passed.** Open-Meteo
  forecast and archive, NASA POWER, Nominatim and Earth Search all answered with usable data. The failure is the
  building footprint, and it is environmental: no planet-wide Overpass instance is reachable from this container,
  so the provider correctly reports `BUILDING GEOMETRY UNAVAILABLE` rather than inventing an outline. A mirror
  that did answer (`overpass.osm.ch`) turned out to be a Switzerland-only extract and was reverted, because it
  would have turned an honest outage into "there is no building at this address" for every property in India.
  `platform/STATUS.md` records that in full.
- **Load testing** (`pnpm -C platform/api load-test`): not run.
- **Forecast accuracy against reality** beyond the held-out periods already in `data/real`.
