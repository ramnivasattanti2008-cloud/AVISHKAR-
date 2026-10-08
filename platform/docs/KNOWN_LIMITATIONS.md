# Known limitations

What the platform does not do, does only partly, or does with a caveat the user must know. The per-requirement ledger is
`platform/STATUS.md`; this page is the short list a user, a reviewer or a funder should read first. Written on 2026-10-08.

## It plans and explains; it does not control anything

- **No device is connected.** There is no inverter, battery, charger or smart-meter integration. Nothing here can switch
  anything on or off, so the specification's control modes (observe, recommend, approve, automate), approval step and rollback
  (§46) have nothing to apply to and are not built.
- **No live feed.** Every figure is from a provider's forecast or archive, a climatology, the owner's uploaded file, or a
  simulation. Nothing is "live" from the user's own installation.

## Data

- **Meter data is a CSV the owner uploads.** No utility-portal connector, no Green Button, no export or net-meter columns. An
  Energy DNA needs 7 complete days at hourly resolution or finer; the load model needs two weeks (six for the learned model).
  Time zones other than IST are not supported unless the file carries offsets. Bills alone are not accepted yet.
- **Solar is scored against the weather model's analysis, not metered generation**, because the data model has no generation
  meter. The score measures the weather forecast.
- **Public providers are not for production traffic:** Nominatim, Overpass, Open-Meteo, NASA POWER, Earth Search and the map
  tile servers all have usage policies. The code caches and spaces its calls, but a launch needs commercial or self-hosted
  services and a tile provider with a key (see DATA_SOURCES.md and DEPLOYMENT.md).
- **PVGIS is unreachable from the development machine.** NASA POWER stands in for the platform's solar resource.
- **No outage data, no carbon-intensity data, no sub-hourly satellite.** Resilience is a held reserve, not a prediction; carbon
  appears only when the owner supplies a factor; the cloud-movement nowcast is `UNAVAILABLE` with the reason.
- **Building outlines come from OpenStreetMap** where they exist, and roof area is derived from the outline. There is no roof
  segmentation, shading analysis or orientation detection from imagery; tilt and azimuth are the owner's entries.

## Tariffs and policy

- **The tariff catalogue is three sourced plans** (UPPCL domestic, MSEDCL LT II, a Rajasthan state schedule) plus whatever the
  owner enters. There is no all-India catalogue. The first two are **expired** (their order ended 2026-03-31) and are shown as
  expired. Lower slabs and fixed charges are missing where the file says so, so those bills are over- or understated as noted.
- **Export prices are assumptions** unless the owner enters them, and the export basis is stated on every result that depends
  on it. It decides most of a solar saving.
- **Net metering and state subsidy top-ups have no sourced rule**: the answer is `NO_SOURCED_RULE` and no number. Only the
  central PM Surya Ghar capital subsidy schedule is loaded, as read on 2026-10-07 from the national portal.

## Forecasts and the planner

- Solar: hourly and up to 7 days; no 5-minute nowcast; no soiling, shading, snow or degradation; the 80% band is marginal per
  hour (not joint across a day) and its coverage is only as good as the 45 days of provider history behind it.
- Load: does not react to the last few days; no weather, occupancy or holiday features; seasonality only with about a year of
  history. A load forecast made from data that ended more than two days ago is `ESTIMATED` and says so.
- Planner: uses the median forecast and does not hedge against the band; one battery (several are summed), one vehicle, one run
  per appliance; plans are 24 or 48 hours and are not re-made when a forecast changes; no net-metering settlement or demand
  charge; no battery degradation beyond the owner's wear cost per kWh.
- The learning loop reports how forecasts did; it does not retrain or switch methods on its own, and runs only after a meter
  import or on request (no scheduled job).

## What-if, opportunities, community

- A yearly result is **24 typical days**, not a simulated year: no cloudy-day variability. Money results exist only from prices
  the owner enters; there is no price list. No financing, tax or battery-replacement model. A subsidy is shown beside the
  investment and never netted off it.
- Opportunity sizes are examples, not designs; the page gives the price above which each would not repay itself.
- **Community and VPP results are simulations.** The community view covers only the signed-in owner's own properties. The
  VPP simulator draws synthetic homes with shares and sizes that are assumptions, not survey data. AVISHKAR does not trade or
  move electricity between properties, and no sourced rule says whether sharing across meters is allowed.
- **No city energy map, no demo world, no neighbour or cross-account view.** No real per-building consumption may be shown, and
  none exists here.

## Copilot

- Answers come from fixed patterns for twelve kinds of question, in English, without conversation memory or follow-ups. Every
  number in an answer is one a backend tool returned (tested). The optional language-model path **has not been run against the
  real service**. The Copilot cannot change settings.

## Product and operations

- **Not deployed.** No hosted instance, Dockerfile, compose file, infrastructure code, backup, job runner (pg-boss), alerting
  or load test (see DEPLOYMENT.md).
- **No admin interface.** An `ADMIN` role exists in the schema and a guard exists, but no route uses it.
- **Accounts:** no email verification, password reset or two-factor sign-in; registering an address that exists is reported
  (`EMAIL_TAKEN`), which lets someone test whether an address has an account. No privacy notice, consent screen or retention
  schedule. No Content-Security-Policy on the web app (see SECURITY.md).
- **Interface:** English only (the Python dashboard has Hindi). No screen-reader or axe pass has been done on the platform's
  pages; no browser end-to-end suite exists, only component tests with a stubbed API plus manual checks in a real browser.
  The manual roof-drawing tool has not been exercised in a browser.
- **Maps:** the production tile provider is the owner's to choose and pay for.

## The Python EMS (the first deliverable)

Its own list is `docs/KNOWN_ISSUES.md` and the README's "limitations": shop and clinic loads are a German factory profile; only
the Mathura home has measured Indian load and outages; system costs and the P2P price share are assumptions; the pipeline is
for three demo sites.
