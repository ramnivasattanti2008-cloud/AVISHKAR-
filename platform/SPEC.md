# AVISHKAR: Autonomous, Location-Aware Energy Intelligence Platform
## Master Claude Code Engineering Specification (verbatim copy of the owner's brief, received 2026-10-07)

> This file is the owner's requirements document, kept in the repo so that any AI or human can read it instead of asking.
> Do not edit the requirements. Progress against them is tracked in [STATUS.md](STATUS.md) and
> [../docs/WORKLOG.md](../docs/WORKLOG.md). Section numbers below are used as requirement IDs (for example "§37").
> The owner's closing instruction: everything must be real (real APIs, real calculations, real persistence), no demo
> pieces presented as live, and a note must be kept of everything done and not done so another AI can follow.

## 0. ROLE
You are the lead architect, senior full-stack engineer, data engineer, ML engineer, geospatial engineer, optimization
engineer, security engineer, QA engineer, and DevOps engineer responsible for building AVISHKAR. You are NOT being asked
to create a mockup, prototype dashboard, fake demo, static frontend, or collection of disconnected screens. You are being
asked to build a real, functioning, production-quality software system with: real APIs where available; real geospatial
data; real weather data; real satellite data where technically accessible; real calculations; real forecasting
pipelines; real optimization; real database persistence; real authentication; real error handling; real provenance; real
validation; realistic simulations where direct real-world data/control is unavailable.
The application must never silently fabricate data. If real data is unavailable, clearly label the result as ESTIMATED,
FORECAST, SIMULATED or DEMONSTRATION DATA. Never present simulated data as live real-world data.

## 1. PRODUCT VISION
AVISHKAR is a Location-Aware Autonomous Energy Intelligence Platform. The central experience: a user selects any property
on a map. AVISHKAR builds an Energy Twin of that property using location, geospatial information,
satellite/environmental information, weather, energy data, tariffs, appliances, batteries and EV requirements. It
predicts possible energy futures and recommends the safest and highest-value destination for available energy.
The product must support: PLAN (what energy system should this property have?), PREDICT (what will happen to solar
generation, demand, weather and energy cost?), OPTIMIZE (what should happen to every available unit of energy?), ACT (what
should the user or connected system do?), LEARN (did the prediction and decision actually work?).

## 2. CORE PRINCIPLE
AVISHKAR is NOT a solar calculator, a weather app, a chatbot, a battery dashboard, an electricity bill analyzer, or a
generic smart-home dashboard. It combines all of these into one coherent system. The central optimization question: "Given
the property's current state, forecast uncertainty, weather, demand, battery state, EV requirements, tariff, resilience
requirements and eligible export mechanisms, what is the best allocation of available energy?"

## 3. CRITICAL REAL-DATA RULE
NEVER fabricate: GPS coordinates, weather, satellite observations, solar irradiance, electricity tariffs, electricity
prices, grid outages, household consumption, battery state, appliance consumption, subsidy eligibility, market eligibility,
electricity export availability. If a source/API is unavailable: (1) detect it, (2) show the reason, (3) use an
explicitly labelled estimation/simulation layer if appropriate, (4) preserve provenance, (5) never pretend it is live.
Every data point should support: source, timestamp, geographic location, measurement/forecast/simulation status,
confidence where applicable.

## 4. IMPORTANT NAVIC REQUIREMENT
Do NOT claim "NavIC provides weather." Use NavIC conceptually/technically as part of positioning, navigation, timing,
location confidence and a future compatible positioning architecture. Weather and Earth-observation information must come
from appropriate weather/satellite datasets. If NavIC receiver hardware is unavailable, do NOT fake NavIC measurements.
Implement a `PositioningProvider` abstraction. Possible providers: browser geolocation, user-selected coordinates,
GNSS-capable device, future NavIC-compatible receiver, imported location data. Expose the provider used (for example
"POSITION SOURCE: Browser GNSS, Accuracy: 12m, Timestamp: ..."). Do not label browser GPS as NavIC.

## 5. PRIMARY USER EXPERIENCE
MAP FIRST. The landing screen is not a giant dashboard. The user sees an interactive map. They can: search address,
search locality, search coordinates, use current location, click a building/property, save a property, compare
properties. When a property is selected: ANALYZE THIS PROPERTY. The system builds an Energy Twin.

## 6. MAP SYSTEM
Production-quality interactive map. Preferred: MapLibre GL JS, OpenStreetMap-compatible basemap, configurable tile
provider, satellite imagery provider abstraction. Do not hard-code one provider. Create: MapProvider, SatelliteProvider,
GeocodingProvider, BuildingFootprintProvider, WeatherProvider, SolarResourceProvider, etc.
Base layers: Standard map, Satellite, Terrain.
Analytical layers: Solar potential, Cloud cover, Temperature, Rain, Wind, Solar irradiance, Energy demand, Solar
generation, Surplus, Grid dependency, Energy risk, Resilience, Community energy.

## 7. PROPERTY SELECTION
Methods: (1) search address, (2) click map, (3) current location, (4) paste coordinates, (5) draw/select polygon.
Store: latitude, longitude, address, property ID, geometry, data sources, confidence. Never invent a building footprint.
If unavailable: "BUILDING GEOMETRY UNAVAILABLE" and continue with point-based analysis.

## 8. ENERGY TWIN
Every property gets a persistent Energy Twin (database object `EnergyTwin`). Fields include: property ID, location,
geometry, building metadata, climate zone, solar resource, estimated roof area, usable roof area, solar capacity
estimate, household profile, appliance profile, load profile, solar profile, battery profile, EV profile, tariff profile,
resilience profile, confidence, last updated, data provenance. The Energy Twin must be versioned: every major model/data
change creates a new snapshot.

## 9. ENERGY DNA
`EnergyDNA` model: a normalized fingerprint representing baseline demand, daily demand pattern, weekday/weekend pattern,
seasonal behavior, peak consumption, flexible consumption, solar potential, solar generation pattern, battery
flexibility, EV flexibility, tariff exposure, resilience requirements, weather sensitivity. Do not store sensitive
personal information unnecessarily. Use privacy-preserving aggregation where possible.

## 10. DATA INGESTION ARCHITECTURE
Provider interfaces. Weather: provider abstraction; possible sources Open-Meteo, NOAA where applicable, government
meteorological sources where accessible, other legitimate APIs. Store current observations, hourly forecasts, daily
forecasts, historical observations where available, weather alerts where available. Do not hardcode weather.

## 11. SATELLITE ARCHITECTURE
`SatelliteProvider`. Potential datasets: Sentinel-2, Sentinel-1 where appropriate, NASA/NOAA datasets, Indian
satellite/open government datasets where legitimately accessible. Do not download enormous datasets unnecessarily; use
appropriate APIs/catalogs. Capabilities: latest available image, historical image, cloud percentage, image timestamp.
Environmental intelligence where technically justified: cloud detection, land characteristics, vegetation, water/flood
context, building/environmental context. Every satellite observation stores: satellite, sensor, acquisition time,
processing time, geometry, source, cloud percentage, processing status.

## 12. CLOUD MOVEMENT NOWCAST
Real forecasting pipeline where data permits. Input: consecutive satellite observations, cloud masks, cloud movement
vectors, current solar resource, historical PV response where available. Output: estimated cloud movement, arrival time,
expected solar attenuation, forecast uncertainty (for example "Cloud front ETA 32 minutes, expected PV impact -18% to
-26%, confidence 84%"). If insufficient satellite data exists display "Satellite nowcast unavailable: insufficient recent
observations". Do not fake it.

## 13. SOLAR FORECAST ENGINE
`SolarForecastEngine`. Horizons: 5 min, 15 min, 30 min, 1 hour, 3 hours, 6 hours, 24 hours, 7 days. Start with robust
baselines (clear-sky model, persistence, weather-adjusted regression), then add ML where justified (gradient boosting,
temporal models, probabilistic forecasting). Do NOT use a huge neural network merely to look advanced. Benchmark models.
Store forecast, actual, error, MAE, RMSE, MAPE where appropriate, confidence interval.

## 14. LOAD FORECAST ENGINE
`LoadForecastEngine`. Inputs: historical consumption, time, weekday, season, temperature, appliance usage, occupancy
profile if provided, EV schedule, user constraints. Baseline: historical same-hour average; then gradient boosting;
temporal model if enough data. Output: expected load, confidence interval, peak probability.

## 15. PROBABILISTIC FORECASTING
Never depend only on a point value. Support P10 / P50 / P90 (for example 6.7 / 8.2 / 10.1 kWh) so decisions are
risk-aware.

## 16. ENERGY FUTURE ENGINE
Generate multiple future scenarios across weather, cloud cover, solar generation, load, tariff, outage, EV demand,
battery availability (for example A sunny, B partially cloudy, C heavy cloud, D rain, E grid outage). Calculate outcomes
for each.

## 17. RISK-AWARE OPTIMIZER
Do not optimize only expected profit. Objectives: minimize cost, maximize self-consumption, maximize renewable
utilization, maximize resilience, minimize carbon, maximize eligible revenue, preserve battery, maintain comfort, respect
appliance deadlines. Modes: SAVE MONEY, ENERGY INDEPENDENCE, RESILIENCE, GREEN, REVENUE, BALANCED.

## 18. MULTI-OBJECTIVE OPTIMIZATION
Optimizer with constraints (LP, MILP, QP or constrained optimization; do not force ML where optimization is more
appropriate). Decision variables: battery charging/discharging, EV charging, flexible appliance operation, grid import,
export, reserve energy. Constraints: battery capacity, SOC, charge/discharge limits, efficiency, appliance power and
deadline, EV deadline, user comfort, critical load, reserve requirement, grid limits, export eligibility.

## 19. EVERY KWH DESTINATION ENGINE
`EnergyAllocationEngine`. Destinations: immediate household load, flexible appliance, EV, battery, grid export, eligible
energy program, reserve. Output example: "Generated 24 kWh: Home 12, EV 4, Battery 6, Export 2". Every allocation must
have a reason.

## 20. ENERGY OPPORTUNITY ENGINE
Continuously detect opportunities: solar surplus, cheap tariff, expensive tariff, cloud arrival, battery opportunity, EV
opportunity, appliance shifting, outage-risk, export, carbon reduction. Each: type, start time, end time, expected value,
confidence, recommended action, explanation.

## 21. ENERGY VALUE ENGINE
Value of energy under different destinations, per kWh: self consumption, battery, EV, flexible load, export,
backup/resilience, carbon. Do not invent tariff/export values; use configured real tariff data or mark values as
estimates.

## 22. INDIAN TARIFF ENGINE
`TariffEngine`. Support state, DISCOM, consumer category, tariff slab, fixed charges, energy charges, time-of-day, net
metering, net billing, gross metering, other mechanisms. Never hard-code one universal Indian tariff. The user selects
state, DISCOM, consumer category. If a tariff source is unavailable: "Tariff data unavailable" with manual input fallback.

## 23. POLICY / ELIGIBILITY ENGINE
`EligibilityEngine`. Inputs: location, consumer type, connection, system size, generation capacity, applicable program,
metering arrangement. Outputs: net-metering eligibility, export eligibility, subsidy eligibility, relevant program,
confidence, source, timestamp. Never state eligibility as fact without a reliable source.

## 24. PM SURYA GHAR MODULE
Policy-aware calculator: residential rooftop solar, system size, applicable subsidy logic, estimated installation cost,
annual generation, annual savings, payback, lifetime economics. Policy values must be configuration-driven, never
hard-coded permanently. Admin/policy configuration table: effective date, expiry date, source, rule, region, notes.

## 25. BATTERY OPTIMIZATION
Capacity, current SOC, max SOC, reserve SOC, charge efficiency, discharge efficiency, max charge rate, max discharge
rate, cycle constraints, degradation estimate. Modes: economic, backup, solar self-consumption, balanced.

## 26. OUTAGE / RESILIENCE ENGINE
`ResilienceEngine`. Inputs: battery, critical load, weather, historical outage data if available, grid-risk information
if available. Output: resilience score, estimated backup duration, recommended reserve, critical load schedule. Never
fabricate outage predictions. If outage data is unavailable: "Grid outage risk unavailable" and use weather-driven
resilience planning only.

## 27. CRITICAL LOAD ENGINE
Appliances marked CRITICAL, IMPORTANT, FLEXIBLE or DISCRETIONARY (critical: refrigerator, medical equipment, network,
essential lights; flexible: washing machine, geyser, EV; discretionary: pool pump, optional AC loads). The optimizer must
preserve critical loads.

## 28. APPLIANCE SYSTEM
Manual appliance entry (name, rated power, expected runtime, schedule, flexibility, deadline). Smart-meter-derived
appliance estimation where actual data exists.

## 29. NILM MODULE
`NILMEngine` abstraction. Do not claim exact appliance consumption unless supported by data. Outputs: estimated appliance
load, confidence, uncertainty (for example "AC: 3.8 kWh +/- 0.7", not "exactly 3.8 kWh" unless directly measured).

## 30. APPLIANCE FLEXIBILITY ENGINE
Each appliance: energy requirement, earliest start, latest finish, duration, power, interruptibility, comfort
constraint. The optimizer decides when to operate it.

## 31. EV ENGINE
Battery capacity, current SOC, target SOC, departure time, charging power, charger efficiency. Optimize solar charging,
tariff, deadline, battery reserve (for example "EV needs 12 kWh by 07:00. Recommended charging window 12:10-15:20").

## 32. WHAT-IF SIMULATOR
A proper simulation engine. User modifies solar size, battery size, EV, appliance usage, tariff, weather, outage, demand
growth. Run over 24 hours, 7 days, 30 days, 1 year. Compare scenarios.

## 33. ENERGY INVESTMENT ADVISOR
Questions: install solar? how much? buy a battery? buy an EV? upgrade appliances? install smart controls? Output:
recommendation, economics, assumptions, payback, uncertainty, alternatives. The system must be allowed to recommend "NO
INVESTMENT" if that is economically optimal.

## 34. ENERGY AUTONOMY SCORE
`EnergyAutonomyScore`: renewable contribution, storage contribution, grid dependency, critical-load coverage. Display
"74 / 100" and show the methodology.

## 35. ENERGY HEALTH SCORE
Metrics: efficiency, solar utilization, peak management, storage utilization, resilience, grid dependence, flexibility.
Each score must be calculated, not randomly generated.

## 36. ENERGY WASTE ENGINE
Detect solar curtailment, unused surplus, peak consumption, inefficient appliance schedule, battery opportunity loss,
avoidable grid import. Output "Potential avoidable cost this month: X" only if enough data exists.

## 37. COUNTERFACTUAL ENGINE (critical)
For every major AVISHKAR decision calculate what actually happened versus what would likely have happened without
AVISHKAR (for example grid import 8.4 kWh without versus 4.7 kWh with, difference 3.7 kWh, estimated cost reduction).
This is the basis for measuring real impact.

## 38. MODEL PERFORMANCE ENGINE
Track forecast MAE, RMSE, calibration, confidence accuracy, recommendation success, savings, user overrides, constraint
violations. Dashboard example "Solar forecast MAE: 8.3%". Never display fake metrics; if not enough data show
"Insufficient data".

## 39. LEARNING ENGINE
After each prediction: store prediction, wait for actual, calculate error, update model statistics, recalibrate
confidence. Do not claim continuous AI learning unless actually implemented.

## 40. DATA PROVENANCE SYSTEM
Every observation contains source, provider, timestamp, location, data_type, status, quality, processing_version,
model_version (for example a Solar Forecast: source Weather Provider + Satellite, generated 2026-10-07 14:00 IST, horizon
60 min, status FORECAST, model solar-v2.1, confidence 87%).

## 41. DATA QUALITY ENGINE
Detect stale data, missing timestamps, impossible values, duplicate observations, sensor spikes, missing location, API
failure. Example: a temperature of 999 C must be rejected and not displayed.

## 42. NO-DATA EXPERIENCE
The application must still work if external providers fail. Example, weather API down: show "WEATHER SERVICE TEMPORARILY
UNAVAILABLE"; retain last valid observation; show its timestamp; disable affected predictions; continue unaffected
calculations. Never silently substitute fake weather.

## 43. OFFLINE / DEGRADED MODE
Full mode (all data), Partial mode (some providers unavailable), Simulation mode (explicitly marked), Demo mode (clearly
labeled DEMO DATA). Never mix demo data into production data.

## 44. AI COPILOT
A conversational assistant that queries actual AVISHKAR tools/data. It answers: why did my bill increase? why is solar
generation low? should I charge my EV? should I store surplus? should I export? should I buy a battery? how resilient is
my home? what is my biggest energy waste? Never let the LLM invent values. Every numeric response must originate from
backend data/tool calls.

## 45. AI EXPLANATION ENGINE
Every recommendation exposes WHY, DATA USED, ASSUMPTIONS, EXPECTED BENEFIT, CONFIDENCE (for example "Charge battery now.
WHY: cloud cover expected to increase; evening demand is high; current solar availability is strong. EXPECTED BENEFIT:
estimated value. CONFIDENCE 91%. ASSUMPTIONS: battery efficiency 92%, forecast horizon 3 hours").

## 46. HUMAN CONTROL
Never make dangerous autonomous actions without authorization. Modes: Observe, Recommend, Approve, Automate. All
automated actions need authorization, audit log, rollback where possible, safety limits.

## 47. COMMUNITY MODE
Multiple properties. Map surplus, deficit, flexible, storage. Calculate community surplus, demand, flexibility, storage.
Do not claim peer-to-peer electricity trading unless the legal mechanism exists; otherwise label "COMMUNITY ENERGY
SIMULATION".

## 48. VIRTUAL POWER PLANT SIMULATOR
Simulate 10, 100, 1,000, 10,000 homes. Calculate aggregate PV, aggregate battery, flexible demand, EV flexibility, peak
reduction, renewable utilization. A separate simulation mode.

## 49. CITY ENERGY MAP
For aggregated/simulated data show solar potential, estimated demand, storage, EVs, flexibility, energy risk. Never
expose private household data; aggregate appropriately.

## 50. PRIVACY
Minimal personal data; encryption in transit; encryption at rest where appropriate; role-based access; property
ownership controls; audit logs; deletion/export mechanisms; privacy-aware aggregation. Never expose one user's energy data
to another.

## 51. SECURITY
Secure authentication; authorization middleware; input validation; rate limiting; CSRF protection where relevant; secure
cookies/token handling; secret management; API validation; database constraints; audit logging. Never commit API keys.
Use `.env` and `.env.example`.

## 52. DATABASE
PostgreSQL + PostGIS. Core tables: users, properties, property_geometry, energy_twins, energy_dna, energy_observations,
weather_observations, satellite_observations, solar_forecasts, load_forecasts, batteries, solar_systems, EVs, appliances,
appliance_events, tariffs, policy_rules, energy_opportunities, optimization_runs, energy_allocations, scenarios,
simulation_runs, recommendations, recommendation_outcomes, model_versions, model_metrics, data_provenance, audit_logs.
Use migrations. No giant JSON blob as the entire database.

## 53. BACKEND
TypeScript, Node.js, Express or Fastify, Prisma, PostgreSQL, PostGIS. Architecture: API, domain services, data
providers, forecast engines, optimization engine, database. Keep provider integrations isolated.

## 54. FRONTEND
Next.js, TypeScript, React, Tailwind, MapLibre, accessible components, responsive design. Do not build every feature as a
modal. Clear information hierarchy.

## 55. UI DESIGN
A serious energy operating system. Not generic AI gradient, random glassmorphism, excessive glowing cards, fake 3D,
meaningless animations. Use dark/light support, precise typography, map-first layout, clean charts, meaningful animation,
strong information hierarchy.

## 56. MAIN PAGES
`/` landing; `/map` energy map; `/property/[id]` Energy Twin; `/property/[id]/forecast`; `/property/[id]/energy-flow`;
`/property/[id]/opportunities`; `/property/[id]/optimizer`; `/property/[id]/simulation`; `/property/[id]/appliances`;
`/property/[id]/battery`; `/property/[id]/ev`; `/property/[id]/economics`; `/property/[id]/resilience`; `/community`;
`/vpp`; `/analytics`; `/copilot`.

## 57. MAIN PROPERTY DASHBOARD
Top: property name, location, data quality, last updated. Then: energy autonomy; today's energy (generated, consumed,
stored, exported); current opportunity; weather (current + next event); AI recommendation (one primary action); energy
flow (Solar, Home, Battery, EV, Grid).

## 58. ENERGY FLOW VISUALIZATION
A live Sankey-style energy flow (solar into home, EV, battery; battery into reserve). Numbers must come from backend
state. No fake animations.

## 59. MAP INTERACTION
Clicking a property immediately shows energy score, solar potential, weather, risk, estimated generation, demand,
available data quality. "Analyze" creates/refreshes the Energy Twin.

## 60. PROPERTY COMPARISON
Property A versus B: solar potential, demand, ROI, autonomy, resilience, battery need, energy opportunity.

## 61. INSTALLATION PLANNER
If the property has no solar show "PLAN SOLAR". Input desired capacity, budget, financing. Output expected generation,
savings, payback, subsidy, surplus, battery requirement.

## 62. ECONOMIC ENGINE
CAPEX, OPEX, tariff savings, export revenue, subsidy, degradation, battery replacement assumptions, payback, NPV, IRR
where justified. Show assumptions. Never promise savings; use "estimated".

## 63. CARBON ENGINE
Renewable generation, grid displacement, estimated emissions avoided. Configurable emissions factor with source and
effective date; not hard-coded permanently.

## 64. SIMULATION ENGINE
Deterministic given the same inputs, weather scenario, load profile and model version. Store simulation configuration.
Allow export of results.

## 65. TESTING (mandatory)
Unit tests: solar calculations, battery SOC, tariff calculations, optimization constraints, subsidy rules, scoring,
forecast evaluation. Integration tests: weather provider, geocoding, satellite provider, database, optimization.
End-to-end: search, select property, analyze, forecast, optimize, simulate. Failure tests: API unavailable, invalid
coordinates, missing weather, missing meter data, bad tariff, incomplete property.

## 66. SAFETY TESTS
Battery overcharge and over-discharge prevention; impossible energy allocations; negative consumption; impossible
generation; export exceeding available energy; critical load violation; appliance deadline violation. The optimizer must
never produce physically impossible results.

## 67. ENERGY CONSERVATION VALIDATION
For every simulation: generation + grid import + battery discharge = load + battery charge + export + losses, within a
defined tolerance. If not: "SIMULATION INVALID" and do not show the result.

## 68. API CONTRACTS
Every endpoint: request schema, response schema, validation, error codes, documentation. Use OpenAPI.

## 69. OBSERVABILITY
Structured logging, request IDs, provider latency, provider failures, model execution time, optimization time, forecast
errors. Dashboard: weather API, satellite API, database, forecast engine, optimizer health.

## 70. CACHING
Cache geocoding, weather, satellite metadata, static policy, tariff data. Do not repeatedly call expensive external APIs.
Respect provider terms and rate limits.

## 71. SCHEDULING
Background jobs (proper queue/scheduler): weather refresh, satellite ingestion, forecast generation, forecast evaluation,
model metrics, opportunity recalculation, tariff updates.

## 72. PROVIDER FAILOVER
Each provider has a fallback (weather: primary, secondary, last-known valid data). The UI states "Last updated N min ago".
Never hide stale data.

## 73. CONFIGURATION
All external services configurable through environment variables. `.env.example` with DATABASE_URL, WEATHER_API_KEY,
MAP_PROVIDER, SATELLITE_PROVIDER, GEOCODING_PROVIDER, and so on. Never place secrets in source.

## 74. DEMO DATA
A separate deterministic demo dataset: 3 realistic properties, historical energy, solar, battery, weather, appliance, EV,
tariff. Labelled DEMO DATA. Never mixed with live data.

## 75. DEMO SCENARIO: CLOUD FRONT
Solar output 5.4 kW; cloud front ETA 38 min; expected solar reduction 22%; battery 42%; evening demand HIGH. AVISHKAR:
"Charge battery now." Then the counterfactual: WITHOUT AVISHKAR grid import X versus WITH grid import Y, estimated
difference Z. All numbers must come from the simulation engine.

## 76. DO NOT FAKE "LIVE"
Use LIVE, UPDATED, FORECAST, ESTIMATED, SIMULATED, DEMO correctly. Never label data LIVE unless it is actually live/current.

## 77. PERFORMANCE
Map initial load under 3 s on reasonable broadband; API response under 500 ms for cached property queries; optimization
under 3 s for normal household scenarios; simulation under 5 s for one-year simplified scenarios. Use asynchronous jobs
for expensive simulations.

## 78. ACCESSIBILITY
Keyboard navigation, readable contrast, screen readers, responsive mobile layout, reduced motion.

## 79. DOCUMENTATION
README.md, ARCHITECTURE.md, DATA_SOURCES.md, API.md, MODEL_CARD.md, OPTIMIZATION.md, SECURITY.md, DEPLOYMENT.md,
KNOWN_LIMITATIONS.md, PATENT_DISCOVERY.md.

## 80. MODEL CARD
For every ML model: purpose, input, output, training data, assumptions, limitations, metrics, failure cases. Never call
something AI just because it uses a formula.

## 81. PATENT-DISCOVERY DOCUMENT
Structured: potential invention, existing prior art, differentiating mechanism, novel technical elements, experimental
evidence required, open questions for patent counsel. Do NOT claim patentability.

## 82. API EXAMPLE
`POST /api/properties/analyze` with `{"latitude": 12.9716, "longitude": 77.5946}` returns propertyId, status, dataQuality,
an energyTwin (solarPotentialKw, estimatedDailyGenerationKwh, estimatedDailyLoadKwh, energyAutonomyScore) and sources.
Do not hard-code those values.

## 83. REALITY CHECKS
Before displaying any result: (1) is the source available? (2) is the timestamp valid? (3) is the value physically
possible? (4) is the location correct? (5) is the model applicable? (6) is uncertainty available? (7) is the result
simulation or reality? If any fails, mark the result appropriately.

## 84. DEVELOPMENT ORDER
PHASE 1 architecture, database, authentication, map, property selection, geocoding. PHASE 2 weather, solar resource,
satellite metadata, Energy Twin. PHASE 3 energy data, solar forecast, load forecast. PHASE 4 battery, EV, appliances,
energy flow. PHASE 5 optimization, opportunity engine, value engine. PHASE 6 what-if simulation, counterfactual engine,
economics, resilience. PHASE 7 AI Copilot, explainability. PHASE 8 community, VPP simulation. PHASE 9 testing, security,
observability, deployment.

## 85. IMPLEMENTATION RULE
At every stage: inspect the existing repository; understand the architecture; do not overwrite working functionality;
make small changes; run tests; fix errors; continue. Never rewrite the entire project because something is inconvenient.

## 86. NO PLACEHOLDER UI
No "Coming Soon", "Lorem ipsum", "+2,340", "AI Score 94%" unless the backend actually produces those values. Every
visible metric is backed by an API, database, deterministic calculation, ML model or simulation.

## 87. NO DEAD BUTTONS
Every button performs a real action, opens a real implemented feature, or is disabled with a clear explanation.

## 88. NO FAKE CHARTS
Every chart has a real dataset and stored chart source metadata. Hover shows timestamp, value, status, source.

## 89. NO FAKE MAP MARKERS
Property markers come from actual selected/stored properties or deterministic demo data. No random markers.

## 90. NO FAKE AI
The Copilot must not invent tariffs, weather, savings, generation, subsidy, market eligibility. It calls backend
functions/tools. LLM = explanation/reasoning interface. Backend = source of truth.

## 91. INTERNAL TOOL LAYER
Backend tools: getProperty, getWeather, getSatelliteObservations, getSolarForecast, getLoadForecast, getBatteryState,
getTariff, getEligibility, getEnergyOpportunities, runOptimization, runSimulation, calculateEconomics, getResilience,
getCounterfactual. The Copilot can only answer using these tools.

## 92. ADMIN PANEL
Admin tools for providers, tariffs, policy rules, model versions, data health, system health, simulation scenarios. Admin
changes are audited.

## 93. SEED DATA
Deterministic seed data for development: Bengaluru, Pune, Jaipur and one additional Indian location. Realistic but
clearly marked demo data.

## 94. DEPLOYMENT
Frontend: Vercel. Backend: containerized Node service. Database: PostgreSQL + PostGIS. Background worker: separate service
where required. Production environment variables. Provide local development, staging and production instructions.

## 95. FINAL QUALITY BAR
Before declaring completion verify. Product: map; property selection; Energy Twin; weather; satellite integration (or
clearly reports unavailable); solar forecast; load forecast; optimization; battery simulation; EV; appliance model;
opportunity engine; economics; resilience; what-if; counterfactual; copilot; community simulation; VPP simulation. Data
integrity: no fabricated live data; provenance; timestamps; stale data detected; failures handled. Engineering: tests,
typecheck, lint, production build, security checks, migrations, deployment.

## 96. FINAL ACCEPTANCE TEST
A completely fresh user can: open AVISHKAR; search a real location; select a property; see the source and quality of
available data; generate an Energy Twin; see actual/estimated/forecast values clearly distinguished; view weather; view
satellite information where available; view solar potential; view demand; run a forecast; see energy opportunities; run
optimization; see where energy is allocated; change solar/battery/EV assumptions; run a simulation; compare outcomes; ask
the AI Copilot why a decision was made; inspect the supporting data; export a report. No step depends on fake data.

## 97. FINAL PRODUCT PHILOSOPHY
Five questions: WHERE (what is happening at this location), WHAT (what energy resources and constraints exist), WHAT NEXT
(what is likely to happen), WHAT SHOULD I DO (the optimal action), WHAT DID AVISHKAR ACHIEVE (energy, money, resilience
and carbon impact).

## 98. THE FINAL EXPERIENCE
Home screen communicates: AVISHKAR, "YOUR ENERGY. UNDERSTOOD."; energy autonomy; today's generation; today's consumption;
available surplus; current opportunity; expected value; weather risk; resilience (hours of critical-load backup); AI
confidence. Then WHY? shows the complete reasoning chain. (The numbers in the brief's example are illustrations; they must
come from the backend.)

## 99. FINAL IMPLEMENTATION INSTRUCTION
Do not stop after creating the UI. Do not declare success because the application starts. Do not use mock values where
real calculations/data can be implemented. Do not hide missing integrations. Do not create a fake "AI" layer. Do not
create disconnected feature pages. Build a coherent platform. Where a feature cannot be implemented with reliable real
data, implement the architecture and an explicitly labelled simulation/fallback layer rather than fabricating reality.
Document every engineering assumption, every data source and every model; measure every model; validate physical
feasibility of every optimization result; retrieve every number in an AI answer from the backend. The result must feel like
a real energy intelligence product that could evolve into a production platform, not a hackathon mockup.

## 100. FIRST ACTION
Before writing substantial code: inspect the entire repository; identify framework and architecture; identify reusable
code; identify environment variables; identify the existing database schema; identify existing API integrations; identify
what is implemented; identify what is mock/demo-only; identify missing dependencies; produce a concise architecture
assessment; then begin implementation in the development order above. Do not ask unnecessary questions if the repository
already provides the answer. When a decision is required, choose the most robust production-oriented option and document
it.

## Owner's closing note (verbatim intent)
"do everything, create a workflow and do accordingly so that we get better output; make sure that everything is real, real
and real, no demo piece, and everything is working properly and ready to solve and use in general life and publish into the
world; if you want to add anything you can add and do something great but make sure you do great." Also: "keep a note of
every work you do and did not do so it is easy for you to continue, and other AI should easily understand what you did if
it checks in the middle and does work."
