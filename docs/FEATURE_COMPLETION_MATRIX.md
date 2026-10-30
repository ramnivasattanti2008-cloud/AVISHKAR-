# Feature completion matrix, 2026-10-30

Classified against the evidence in [TESTING_AND_VERIFICATION.md](TESTING_AND_VERIFICATION.md). The rule applied
throughout: **source code existing is not evidence.** A feature is `VERIFIED` only if a command run in this
container proves the behaviour, and the row says which.

| Class | Meaning |
|---|---|
| `VERIFIED` | A test, journey or browser check run here exercises the behaviour and passes. |
| `IMPLEMENTED_NOT_FULLY_VERIFIED` | The code is real and reviewed, but no check here covers the behaviour end to end. |
| `PARTIALLY_IMPLEMENTED` | Part of it works; the gap is stated. |
| `BLOCKED` | Cannot proceed here; the reason is stated. |
| `NOT_IMPLEMENTED` | Absent. |
| `NOT_APPLICABLE` | Out of scope for software, or for this repository. |

## Starting and running

| Feature | Class | Evidence / gap |
|---|---|---|
| Platform starts from one documented command | `VERIFIED` | `./start-platform.sh` brings up engine, API and web; health endpoints answer. Was impossible before: no Linux launcher existed, and the API did not read its own `.env`. |
| Streamlit dashboard starts | `VERIFIED` | `./run-dashboard.sh`; opened in Chromium, no exception. Was crashing on import (issue 24). |
| Web production build serves a working app | `VERIFIED` | `pnpm browser` 21/21. Was 1/21: the CSP blocked hydration and every page was dead at HTTP 200. |
| Database schema and migrations | `VERIFIED` | 11+ migrations applied to a real PostGIS 3.4; 994 API tests run against it. |
| Deployment (Docker) | `BLOCKED` | Docker's engine is not usable here; images never built or run. |

## Individual home

| Feature | Class | Evidence / gap |
|---|---|---|
| Configure solar capacity, inverter, tilt, azimuth, losses | `VERIFIED` | Created through the API in the journey; entered-vs-effective values with their basis are shown on the equipment page (browser check). |
| Configure battery capacity, power limits, SoC, SoC limits, reserve | `VERIFIED` | Journey creates a battery; allocation tests exercise reserve floors, power limits and round-trip efficiency. |
| Battery chemistry recorded | `VERIFIED` | `BatteryConfig.chemistry`, defaulting to `NOT_STATED`; nothing is inferred from it. The dashboard read this field before it existed. |
| Household consumption from meter data | `VERIFIED` | Journey imports readings, nothing refused or repaired, Energy DNA built from complete days; browser check sees the readings drawn. |
| Purchase tariff and export tariff | `VERIFIED` | Journey creates a time-of-day tariff with an export rate and assigns it; tariffs and policy are seeded from sourced files. |
| EV charging requirements | `IMPLEMENTED_NOT_FULLY_VERIFIED` | EV assets and charging in the optimiser with engine tests; no end-to-end journey step drives an EV plan here. |
| Flexible appliances | `IMPLEMENTED_NOT_FULLY_VERIFIED` | Appliances with shiftable windows are in the optimiser and the schema; the journey marks a *critical* appliance only. |
| Backup reserve preference | `VERIFIED` | `RESILIENCE` mode keeps `backup_hours` of critical load; allocation tests assert discharge stops at the reserve. |
| Optimisation priorities as distinct goals | `VERIFIED` | Six named modes with explicit weights (`SAVE_MONEY`, `INDEPENDENCE`, `GREEN`, `REVENUE`, `RESILIENCE`, `BALANCED`) returned with every plan and described as preferences, not prices. Engine `/health` lists them. |
| Configure, save, revisit, modify, get updated results | `VERIFIED` | The journey does exactly this; the allocation workbench does it interactively in the browser. |
| Solar, no battery | `VERIFIED` | Allocation test; the planner handles a property with no battery. |
| Solar and battery | `VERIFIED` | Journey and allocation tests. |
| Battery, no solar | `VERIFIED` | Allocation test: it discharges to serve load and buys nothing. |
| Neither | `VERIFIED` | Allocation test: it simply buys what it uses, and is reported as `DEFICIT`. |

## Dashboard and display

| Feature | Class | Evidence / gap |
|---|---|---|
| Solar generation, demand, SoC, charge/discharge, import/export, surplus, costs | `VERIFIED` | Shown on the Plan/Today pages and in the allocation workbench; browser check reads the figures off the page. |
| Forecast generation and demand | `VERIFIED` | Journey makes a solar forecast and a load forecast from the readings. |
| Optimisation recommendations with reasons | `VERIFIED` | `api/src/plan/explain.ts`; the workbench prints the ordered steps that produced its answer. |
| Energy history and performance summaries | `IMPLEMENTED_NOT_FULLY_VERIFIED` | Meter history, Energy DNA and forecast scoring exist with tests; no browser check covers the summary pages. |
| Measured / entered / forecast / simulated / estimated are distinguished | `VERIFIED` | Provenance envelope on every value; `LIVE` derived from freshness, never chosen; the web app refuses to print an `UNAVAILABLE` value as a number. `IntervalTelemetry` now carries a per-reading mode so a what-if on a metered home is not labelled measured. |
| Missing and stale measurements handled explicitly | `VERIFIED` | Engine returns an incomplete result naming what is missing; stale telemetry raises a warning; gaps in meter data stay gaps. |
| No fabricated live data | `VERIFIED` | Three fabricated P2P trades and the invented equipment fallbacks were removed from both map builders (issue 26). A search for `Math.random` in the platform finds nothing that invents data. |
| Energy flow visualisation | `VERIFIED` | The dashboard's SVG flow map now renders (36 HTML blocks were being printed as source text, issue 25); the workbench draws in/out bars per property. |
| Accessibility: landmarks, keyboard, screen-reader names | `VERIFIED` | axe runs in the web unit tests (and caught a duplicate landmark introduced by the workbench); the browser check confirms the skip link. |

## Energy calculations and optimisation

| Feature | Class | Evidence / gap |
|---|---|---|
| Local demand satisfaction, surplus detection | `VERIFIED` | Allocation engine step 1; the same kW is never allocated twice, asserted by the balance check. |
| Battery charging, discharging, reserve protection | `VERIFIED` | Allocation tests, including the round-trip loss on the charge leg and the interval scaling of charge level. |
| Flexible-load scheduling, EV charging optimisation | `IMPLEMENTED_NOT_FULLY_VERIFIED` | In the MILP with engine tests; not driven end to end here. |
| Tariff optimisation, grid import and export | `VERIFIED` | Plans priced from the property's own tariff; journey asserts a cost against no control. |
| Solar forecasting | `VERIFIED` | pvlib in the engine, band learned from the place's own past day-ahead errors; journey makes one. |
| Demand forecasting | `VERIFIED` | Quantile model scored on a chronological holdout; 448 engine tests include leakage and seasonality checks. |
| Optimisation failure handling and deterministic fallback | `VERIFIED` | `validate()` re-checks every plan and an invalid one is never shown; routes answer `503 ENGINE_UNAVAILABLE` when the engine is absent, which was observed directly when the engine key mismatched. |
| Energy accounting consistent, nothing double-counted | `VERIFIED` | Per-member and community balance check on every allocation, plus a 432-case sweep; the single-property ledger has its own hourly check. |
| Respects battery, inverter, network limits and conversion losses | `VERIFIED` | Export/import limits, feeder limit, line and network losses each charged once, battery power and reserve limits — all asserted. |
| Globally optimal claims | `NOT_APPLICABLE` | The MILP is optimal for its stated model; the allocation engine is explicitly a stated-order convention and says so rather than claiming optimality. No heuristic is called optimal anywhere. |
| "AI"/"ML" labelling honest | `VERIFIED` | Gradient-boosted quantile models are called that; the Copilot is a language model over tool results with every citation checked to point at a real result. |

## Community

| Feature | Class | Evidence / gap |
|---|---|---|
| Multiple homes and buildings | `VERIFIED` | Allocation takes up to 200 members; community view spans the owner's properties. |
| Individual generation and demand, surplus and deficit | `VERIFIED` | 37 unit tests, 14 HTTP tests. |
| Allocation priorities | `VERIFIED` | Four rules, each tested for the division it claims. |
| Transfer limits | `VERIFIED` | Per-member export/import limits and a shared feeder limit; the binding one is named. |
| Network losses | `VERIFIED` | Line loss per member plus one network loss on the pool, each charged once; I²R from the drawn current in the Python EMS path. |
| Battery constraints in allocation | `VERIFIED` | Reserve floors, power limits, efficiency, and two policies for whether a surplus charges or shares first. |
| Grid import and export as the residual | `VERIFIED` | Unmet deficit bought within the import limit; unplaceable surplus sold within the export limit, then curtailed. |
| Explainable allocation decisions | `VERIFIED` | Ordered `decisions`, a per-member `explanation`, and a named `binding` cap; read off the page by the browser check. |
| Allocation history | `NOT_IMPLEMENTED` | Each allocation is computed and returned; nothing is stored. Deliberate for now — it is a what-if tool, not a ledger of events. |
| Community-level analytics | `PARTIALLY_IMPLEMENTED` | Self-sufficiency and self-consumption per interval, plus the existing typical-day community view. No multi-day community aggregation. |
| A home works without joining | `VERIFIED` | Opting out is honoured in both engines; the Python path reports which side has not opted in and leaves both homes working alone. |
| Simulated allocation separated from actual transfer | `VERIFIED` | Labelled `COMMUNITY ALLOCATION SIMULATION`; every response and the page state that AVISHKAR moves no electricity and that whether sharing is permitted depends on the law, the licensee, the metering and the wiring. |
| Actual energy transfer between properties | `NOT_APPLICABLE` | Requires a permitted arrangement, metering and infrastructure. Not a software feature and not claimed. |

## Security

| Feature | Class | Evidence / gap |
|---|---|---|
| Authentication, sessions | `VERIFIED` | Journey: HttpOnly first-party session cookie; signing out ends it. |
| CSRF protection | `VERIFIED` | Journey: a state-changing request without the header is refused. |
| Authorization and data isolation | `VERIFIED` | Journey: a second account cannot see the first's property; allocation refuses another account's property ids with 404. |
| API input validation | `VERIFIED` | zod schemas on every route; allocation refuses negative generation, an impossible battery, an out-of-range loss, a bad limit. |
| Content-Security-Policy | `VERIFIED` | Per-request nonce with `strict-dynamic`; no inline script runs without it in either mode. Stricter than the hash policy it replaces, and unlike it, functional. |
| Secret management | `VERIFIED` | No secret in the repository; `.env` is git-ignored and was confirmed ignored before every commit. A blank optional key now means unset rather than a crash. |
| Account data export and deletion | `VERIFIED` | Journey exports and deletes; a dedicated API test compares the whole database before and after. |
| Device command authorization | `IMPLEMENTED_NOT_FULLY_VERIFIED` | An approval is a record only; there is no device. By design. |
| Electrical certification, anti-islanding validation, grid-code compliance | `NOT_APPLICABLE` | Not supported by any evidence in this repository, and not claimed anywhere in it. |

## Interactive demonstration

| Feature | Class | Evidence / gap |
|---|---|---|
| Inside the existing application, not a throwaway | `VERIFIED` | A section of the existing `/community` page, driven by `POST /api/community/allocate`. |
| Three buildings, reproducible | `VERIFIED` | A 8/3, B 2/4, C 0/3; checked number for number as a unit test, over HTTP and in a browser. |
| Real calculations, not hardcoded outcomes | `VERIFIED` | The browser check edits an input and asserts the answer changes; the scenarios are starting points sent to the engine like any other input. |
| Users can modify generation, demand, battery, transfer limits | `VERIFIED` | Every field is editable, including adding and removing buildings and giving one a battery; the browser check sends and asserts the changes. |
| Shows flows, surplus/deficit, battery, grid, losses, decisions, costs | `VERIFIED` | All present and read off the page by the browser check. |
| Second scenario: generation falls, deficit handled | `VERIFIED` | Unit tests and a browser check. |
| Third scenario: transfer constraint prevents full allocation | `VERIFIED` | Unit tests and a browser check; the feeder is named as the binding cap. |
| Before-and-after cost comparison | `PARTIALLY_IMPLEMENTED` | Computed and shown when every member's tariff is known (the own-properties path). The members-given path has no tariffs, so it shows nothing rather than inventing a price. |
| Clearly labelled as simulated | `VERIFIED` | `SIMULATED` provenance badge, the label on the page, and the notes beneath it. |

## Forecasting

| Feature | Class | Evidence / gap |
|---|---|---|
| Real measurements, weather, timestamps available | `VERIFIED` | Committed PVGIS weather and CEEW meter data; Open-Meteo, NASA POWER and PVGIS reachable and used. |
| Baseline before a complex model | `VERIFIED` | Load baselines compared against the quantile model on a chronological holdout, in the engine's own tests. |
| Chronological validation, no future leakage | `VERIFIED` | Engine tests include "a forecast can be issued from an earlier point using only what came before" and a level-shift test. |
| Forecast quality metrics | `VERIFIED` | `results/forecast_quality.csv`; `api/src/forecast/evaluate.ts` scores stored forecasts against readings imported later. |
| Missing values, outliers, stale telemetry, inconsistent timestamps | `VERIFIED` | Meter parsing refuses rather than repairs; gaps stay gaps; stale readings are flagged. |
| Synthetic data never presented as observed | `VERIFIED` | `sim.py` is used only by unit tests; real frames carry their provenance; `expected_kw == pv_kw` on real data is documented rather than hidden. |
