# API

The contract is `platform/api/openapi.json` (OpenAPI 3.1), served live at `GET /api/openapi.json`. It is generated from the
route schemas, committed, and a test fails if it is stale; the web app's types are generated from it. This page explains the
conventions and lists every operation. When a route changes, regenerate with `pnpm -C platform/api openapi`, then update the
tables below (a test fails if an operation is missing from this page).

## Conventions

**Sessions.** `POST /api/auth/register` and `POST /api/auth/login` set an `HttpOnly` session cookie (`avk_session`) and a
readable CSRF cookie (`avk_csrf`), and return the CSRF token. Every `POST`, `PUT`, `PATCH` and `DELETE` made while signed in
must send it back in the `x-csrf-token` header, or the answer is `403 CSRF_REJECTED`. Login and register are the only exempt
routes. Cookies are `SameSite=Lax`, and `Secure` in production.

**Errors.** Every failure has the same body, with a stable machine-readable `code`:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "The request is not valid: ...", "requestId": "...", "details": [] } }
```

Codes (the full list is `ERROR_CODES` in `api/src/errors.ts`): `VALIDATION_FAILED` and `INVALID_COORDINATES` (400),
`UNAUTHENTICATED` and `INVALID_CREDENTIALS` (401), `CSRF_REJECTED` and `FORBIDDEN` (403), `NOT_FOUND` (404), `EMAIL_TAKEN`
and `CONFLICT` (409), `PLAN_INPUTS_MISSING` (422, with a `details.missing` list of what to supply), `RATE_LIMITED` (429),
`INTERNAL` (500), `PROVIDER_BAD_RESPONSE`, `ENGINE_BAD_RESPONSE`, `ENGINE_REJECTED` and `PLAN_INVALID` (502: a plan that failed
its independent check is never returned), `PROVIDER_UNAVAILABLE`, `DATA_UNAVAILABLE` and `ENGINE_UNAVAILABLE` (503: the
provider or the Python engine is down or not configured). A policy question with no sourced rule is not an error: the
eligibility answer has `outcome: "NO_SOURCED_RULE"` and no number. Every response carries `x-request-id`;
send one of your own (1 to 64 letters, digits, `.`, `_`, `-`) and it is kept.

**Provenance.** Any value that comes from a provider, a model or an assumption is not a bare number. It is an envelope:

```json
{ "value": 12.4, "unit": "kWh", "provenance": { "provider": "avishkar-engine", "source": "...", "dataType": "solar_forecast", "status": "FORECAST", "generatedAt": "...", "validFor": "...", "processingVersion": "api-0.1.0", "notes": ["..."] } }
```

`observedAt`, `ageSeconds`, `location`, `quality`, `confidence` and `modelVersion` appear when they apply. `status` is one of `LIVE`, `UPDATED`, `FORECAST`, `ESTIMATED`, `SIMULATED`, `DEMO`, `REFERENCE`, `UNAVAILABLE`. `LIVE` is
assigned by the server from the age of the observation and cannot be requested. An `UNAVAILABLE` value has `value: null` and a
reason in `notes`; do not render it as a number.

**Rate limits.** 300 requests a minute per client in general; tighter on expensive routes (10 a minute on sign-in, plans,
scenarios, reports, meter imports, community and the VPP simulator; 5 on opportunities; 20 on the Copilot). Over the limit:
`429 RATE_LIMITED`.

**Ownership.** Everything under `/api/properties/{id}` and the routes that take a property belong to the signed-in user.
Another user's id answers `404`, not `403`.

**Time and money.** Timestamps are ISO 8601; plan steps are whole hours in IST (`+05:30`). Money is Indian rupees (INR).
Energy is kWh, power kW.

**Example: a first property.**

```bash
# 1. sign up (keep the cookies); the response includes csrfToken
curl -c jar -H 'content-type: application/json' -d '{"email":"you@example.com","password":"a-long-passphrase","displayName":"You"}' http://127.0.0.1:8080/api/auth/register

# 2. save a place (send the csrf token from step 1)
curl -b jar -H 'x-csrf-token: TOKEN' -H 'content-type: application/json' -d '{"name":"Home","latitude":12.9716,"longitude":77.5946,"positionSource":"manual"}' http://127.0.0.1:8080/api/properties

# 3. build its Energy Twin from real data (labels and sources on every value)
curl -b jar -X POST -H 'x-csrf-token: TOKEN' http://127.0.0.1:8080/api/properties/PROPERTY_ID/analyze
```

`GET /api/preview?latitude=..&longitude=..` gives a labelled preview of a point without saving anything or signing in.
`positionSource` is one of `browser-geolocation`, `manual`, `map-click`, `geocoded`, `imported`; `navic` is refused unless the server has a real NavIC receiver integration enabled.

## Operations

### auth

Accounts and sessions

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | The signed-in user, or 401 |
| POST | `/api/auth/register` | Create an account and sign in |

### account

Export and delete your data

| Method | Path | What it does |
|---|---|---|
| DELETE | `/api/account` | Permanently delete your account and data |
| GET | `/api/account/export` | Download all of your data |

### properties

Saved properties

| Method | Path | What it does |
|---|---|---|
| GET | `/api/properties` | Your saved properties |
| POST | `/api/properties` | Save a property at a location |
| DELETE | `/api/properties/{id}` | Delete a property and its geometry |
| GET | `/api/properties/{id}` | One property |
| PATCH | `/api/properties/{id}` | Rename or re-address a property |
| POST | `/api/properties/{id}/geometry` | Attach a roof or plot outline you drew |
| GET | `/api/properties/{id}/report` | Download a report of everything held for the property (Markdown) |

### geocoding

Address and place search

| Method | Path | What it does |
|---|---|---|
| GET | `/api/geocode/reverse` | Find the address at a coordinate |
| GET | `/api/geocode/search` | Search an address, locality or place name |

### weather

Weather and irradiance with provenance

| Method | Path | What it does |
|---|---|---|
| GET | `/api/properties/{id}/weather` | Weather at one of your properties |
| GET | `/api/weather` | Current model analysis and hourly forecast at a coordinate |

### twin

Energy Twin: versioned snapshot of a property

| Method | Path | What it does |
|---|---|---|
| GET | `/api/cloud-nowcast` | Cloud movement nowcast (UNAVAILABLE unless sub-hourly satellite data exists) |
| GET | `/api/preview` | Solar resource, weather and yield per kWp at a coordinate (not saved) |
| POST | `/api/properties/{id}/analyze` | Build a new Energy Twin version from every reachable real source |
| GET | `/api/properties/{id}/cloud-nowcast` | Cloud nowcast for a property |
| GET | `/api/properties/{id}/twin` | The latest Energy Twin |
| GET | `/api/properties/{id}/twin/versions` | Every Energy Twin version, newest first |

### tariffs

Electricity tariffs: catalogue from regulator orders, your own, and bill estimates

| Method | Path | What it does |
|---|---|---|
| DELETE | `/api/properties/{id}/tariff` | Clear the tariff of a property |
| PUT | `/api/properties/{id}/tariff` | Choose the tariff for a property |
| GET | `/api/tariffs` | Tariff plans you can choose from |
| POST | `/api/tariffs` | Enter your own tariff |
| DELETE | `/api/tariffs/{id}` | Delete a tariff you entered |
| GET | `/api/tariffs/{id}` | One tariff plan |
| POST | `/api/tariffs/{id}/bill` | Estimate a monthly bill under a tariff |

### energy

Meter data you import, and the Energy DNA built from it

| Method | Path | What it does |
|---|---|---|
| GET | `/api/properties/{id}/energy` | What meter data a property has |
| GET | `/api/properties/{id}/energy-dna` | The Energy DNA of a property |
| GET | `/api/properties/{id}/energy/imports` | Meter files imported for a property |
| POST | `/api/properties/{id}/energy/imports` | Import a meter file (CSV) |
| DELETE | `/api/properties/{id}/energy/imports/{importId}` | Delete an import and its readings |

### forecast

Forecasts of solar output and electricity use, with calibrated bands and how well each has done

| Method | Path | What it does |
|---|---|---|
| GET | `/api/properties/{id}/forecast-accuracy` | How the stored forecasts have done against the readings that followed |
| POST | `/api/properties/{id}/forecast-accuracy/evaluate` | Score every stored forecast that the meter data now covers |
| GET | `/api/properties/{id}/load-forecast` | Forecast the property's electricity use from its own meter readings |
| GET | `/api/properties/{id}/solar-forecast` | Forecast the output of the property's solar system |
| GET | `/api/properties/{id}/solar-forecast/performance` | How well the solar forecast has done lately |

### plan

The plan: when to charge, discharge, import, export and run flexible loads, checked from scratch before it is shown

| Method | Path | What it does |
|---|---|---|
| GET | `/api/properties/{id}/plan` | The latest plan |
| POST | `/api/properties/{id}/plan` | Plan the next day or two |
| GET | `/api/properties/{id}/plans` | Plans made for a property, newest first |
| GET | `/api/properties/{id}/plans/{planId}` | One plan as it was shown |
| GET | `/api/properties/{id}/resilience` | How long the critical load would last if the grid failed, and how autonomous the plan is |
| GET | `/api/properties/{id}/today` | Today: generation, use, surplus, weather risk, backup, autonomy, expected value, and what to do next |
| GET | `/api/properties/{id}/health` | Energy health: efficiency, solar utilisation, peak management, storage utilisation, resilience, grid dependence and flexibility |
| GET | `/api/properties/{id}/waste` | Energy waste: solar thrown away, surplus sold, energy sold then bought back dearer, energy bought in the dearest hours, and the avoidable cost |

### scenarios

What-if: today's setup against added solar, a battery or another tariff over a typical year, with payback and net present value

| Method | Path | What it does |
|---|---|---|
| POST | `/api/properties/{id}/cloud-front` | What a cloud front crossing the sky would do to the next 24 hours, with and without AVISHKAR |
| POST | `/api/properties/{id}/opportunities` | What is worth doing at this property |
| GET | `/api/properties/{id}/scenarios` | Scenarios run for a property, newest first |
| POST | `/api/properties/{id}/scenarios` | What would adding solar, a battery or a different tariff do over a year |
| DELETE | `/api/properties/{id}/scenarios/{scenarioId}` | Delete a scenario |
| GET | `/api/properties/{id}/scenarios/{scenarioId}` | One scenario as it was shown |

### copilot

Ask about a property: answers are worded from backend tools, with the supporting data to inspect

| Method | Path | What it does |
|---|---|---|
| GET | `/api/copilot/tools` | What the Copilot can look at, and the questions it can answer |
| POST | `/api/properties/{id}/copilot/ask` | Ask about this property |
| POST | `/api/properties/{id}/copilot/tools/{tool}` | Call one tool directly and inspect what it returns |

### admin

For administrators: the health of data, catalogue, models and providers, the background jobs and the audit log

| Method | Path | What it does |
|---|---|---|
| GET | `/api/admin/audit` | The audit log, newest first |
| GET | `/api/admin/jobs` | The background jobs, when each is next due and what it did lately |
| POST | `/api/admin/jobs/{name}/run` | Run one background job now |
| GET | `/api/admin/overview` | Health of the data, the catalogue, the models and the providers: counts, and no one's readings |

### control

Human control: Observe, Recommend, Approve, Automate; safety limits; the moves waiting for a decision, every decision audited

| Method | Path | What it does |
|---|---|---|
| GET | `/api/properties/{id}/control` | How much AVISHKAR may do for this property, its safety limits and the moves waiting for a decision |
| PUT | `/api/properties/{id}/control` | Choose the mode and the safety limits |
| POST | `/api/properties/{id}/control/proposals` | Turn the latest plan's moves into proposals, each put through your safety limits |
| POST | `/api/properties/{id}/control/proposals/{proposalId}/{action}` | Approve, reject, withdraw or roll back one proposed move |

### demo

The demo world: invented properties in real places, labelled DEMO DATA, for trying everything before you have a meter file

| Method | Path | What it does |
|---|---|---|
| DELETE | `/api/demo/world` | Remove the demo properties and everything computed from them |
| GET | `/api/demo/world` | The demo world: four invented properties, and whether they are in your account |
| POST | `/api/demo/world` | Add the demo properties to your account (labelled DEMO DATA; loading twice changes nothing) |

### community

Your properties together, and a simulated virtual power plant of synthetic homes (always labelled a simulation)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/community` | Your properties together: surplus, deficit, storage and shiftable load on a typical day |
| POST | `/api/vpp/simulate` | Simulate a virtual power plant of 10, 100, 1,000 or 10,000 homes |

### assets

What a property has: batteries, solar systems, electric vehicles, appliances and their logged runs

| Method | Path | What it does |
|---|---|---|
| GET | `/api/properties/{id}/appliance-estimates` | Estimated energy per appliance (NILM) |
| GET | `/api/properties/{id}/appliances` | Appliances of a property |
| POST | `/api/properties/{id}/appliances` | Add an appliance |
| DELETE | `/api/properties/{id}/appliances/{assetId}` | Delete an appliance and its logged runs |
| PATCH | `/api/properties/{id}/appliances/{assetId}` | Change an appliance |
| GET | `/api/properties/{id}/appliances/{assetId}/events` | Logged runs of an appliance |
| POST | `/api/properties/{id}/appliances/{assetId}/events` | Log a run of an appliance |
| DELETE | `/api/properties/{id}/appliances/{assetId}/events/{eventId}` | Delete a logged run |
| GET | `/api/properties/{id}/assets` | A summary of everything entered for a property |
| GET | `/api/properties/{id}/batteries` | Batteries of a property |
| POST | `/api/properties/{id}/batteries` | Add a battery |
| DELETE | `/api/properties/{id}/batteries/{assetId}` | Delete a battery |
| PATCH | `/api/properties/{id}/batteries/{assetId}` | Change a battery |
| GET | `/api/properties/{id}/evs` | Electric vehicles of a property |
| POST | `/api/properties/{id}/evs` | Add an electric vehicle |
| DELETE | `/api/properties/{id}/evs/{assetId}` | Delete an electric vehicle |
| PATCH | `/api/properties/{id}/evs/{assetId}` | Change an electric vehicle |
| GET | `/api/properties/{id}/solar-systems` | Solar systems of a property |
| POST | `/api/properties/{id}/solar-systems` | Add a solar system (installed or planned) |
| DELETE | `/api/properties/{id}/solar-systems/{assetId}` | Delete a solar system |
| PATCH | `/api/properties/{id}/solar-systems/{assetId}` | Change a solar system |

### policy

Subsidy and net-metering rules as sourced configuration, and the eligibility calculator

| Method | Path | What it does |
|---|---|---|
| POST | `/api/eligibility` | Apply the published subsidy and net-metering rules to a system size |
| GET | `/api/policy-rules` | The policy rules on file, with their sources |

### system

Health

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Liveness: the process is up |
| GET | `/api/system/health` | Database and external provider health, from real recent calls |

