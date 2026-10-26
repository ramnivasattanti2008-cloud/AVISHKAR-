# Data sources

Every number the platform shows comes from one of the places below, or from the owner's own entries, and wears a label
(`LIVE`, `UPDATED`, `FORECAST`, `ESTIMATED`, `SIMULATED`, `DEMO`, `REFERENCE`, `UNAVAILABLE`). Written from the code on
2026-10-08. Where a source has a usage policy, the code identifies itself with a contact User-Agent, caches, spaces its calls
and retries with back-off; **none of the public servers below is meant for production traffic**, which is the owner's
decision to plan for (see KNOWN_LIMITATIONS.md).

## Outside providers

All are adapters under `api/src/providers`, each behind an interface so the provider can be swapped by configuration. Every
call is validated against a schema, recorded (latency, failures) for `GET /api/system/health`, cached in the database, and when
the provider fails an expired cache entry is served **marked stale** rather than hidden. A failure with nothing cached is an
error, never a made-up value.

| Need | Provider (default) | What is taken | Cached for | Notes |
|---|---|---|---|---|
| Address and place search, reverse lookup | OpenStreetMap Nominatim (`nominatim.openstreetmap.org`) | Place name, coordinates, type | 7 days (search), 30 days (reverse) | At most one call every 1.1 s, as its policy requires. Results are OpenStreetMap contributors' data (ODbL); the map shows the attribution |
| Weather and irradiance forecast | Open-Meteo (`api.open-meteo.com`) | Hourly temperature, cloud cover, wind, precipitation, shortwave / direct / diffuse irradiance | 10 minutes | The place is coarsened to about 1 km before it is sent. Irradiance is end-of-hour UTC and is shifted to the hour it covers in IST |
| How wrong past forecasts were | Open-Meteo previous-runs (`previous-runs-api.open-meteo.com`) | The day-ahead forecast and the analysis for the same hours, 45 days | 3 hours | The last 3 hours are left out while the analysis settles. Used to learn the solar forecast's own error band |
| Solar resource (climatology) | NASA POWER (`power.larc.nasa.gov`) | Monthly mean irradiation, temperature, wind | 90 days | A 20-year climatology: used for typical days and the yearly what-if, never presented as today's weather |
| Building outline | OpenStreetMap through Overpass (`overpass-api.de`, with mirrors tried in order) | The building polygon and tags around the point | 30 days | The public server answers 504 about a third of the time from the development machine, so mirrors and one retry are required. Roof area is derived from the polygon, not measured |
| Satellite scene metadata | Sentinel-2 L2A through Earth Search STAC (`earth-search.aws.element84.com`) | Acquisition and processing time, cloud cover, footprint, platform | 6 hours | Metadata only: no imagery is shown or analysed |
| Map tiles | OpenStreetMap standard, Esri World Imagery, OpenTopoMap (raster), chosen in the browser | Tiles | by the browser | These public tile servers do not allow production traffic. **A tile provider and key must be supplied before launch.** Each layer is attributed on the map |
| Position | The browser's geolocation, or typed coordinates | A point and the accuracy the browser reports | n/a | Never labelled NavIC; the API refuses that label unless `NAVIC_RECEIVER_ENABLED=true`, which needs a real receiver integration that does not exist |

PVGIS is not reachable from the development machine, so NASA POWER stands in for the platform. The Python EMS still uses its
bundled PVGIS files (below).

## Sourced configuration (tariffs and policy)

Not scraped, not guessed: files in `data/` that name their source and the date they were read, loaded into the database by
`pnpm -C platform/api db:seed`.

| File | Content | Source recorded in the file | Caveat |
|---|---|---|---|
| `data/tariffs/home-mathura.json` | UPPCL LMV-1 urban domestic, FY2025-26 | The regulator's order, as cited in the file | Only the rate above 300 kWh a month is loaded, so a small household's bill is overstated. The order's validity ended 2026-03-31, so the tariff is shown as **expired**, not hidden |
| `data/tariffs/shop-pune.json` | MSEDCL LT II (0-20 kW), FY2025-26 | The review order, as cited in the file | The effective date is not recorded; validity ended 2026-03-31, shown as expired. Fixed charge loaded |
| `data/tariffs/clinic-jaipur.json` | Rajasthan NDS / LT-2 above 5 kW, 2025 state schedule, from 2025-10-01 | The Jodhpur discom's publication of the state schedule | Not specific to one discom; fixed charges not loaded, so a bill is energy charges only |
| `data/policy/pm_surya_ghar.json` | PM Surya Ghar capital subsidy schedule | The Benefits section of the National Portal for Rooftop Solar (MNRE), read on 2026-10-07 | Net metering and state top-ups have **no sourced rule**: the API answers `NO_SOURCED_RULE` and gives no number |

Every export price is an `ASSUMPTION` unless a file says otherwise, and the label stays on every figure derived from it. A
plan the owner types in is theirs, labelled as entered.

## The owner's own data

| Data | How it enters | How it is treated |
|---|---|---|
| Meter readings | CSV upload (up to 25 MB): kWh, Wh, kW or W; day-first or ISO timestamps; IST unless the file carries offsets | The unit is read from the header or stated, never guessed. Every row is accepted, refused with a named reason, or a duplicate. Gaps stay gaps; nothing is repaired or interpolated. The same file is refused twice |
| Equipment (solar systems, batteries, vehicles, appliances) | Forms | A parameter left blank is stored blank; the API returns what was `entered` beside what is `effective` and the basis for the default |
| Prices (installed cost, export rate, discount rate) | Forms on the What-if tab | Money results exist only when these are given |
| Roof outline | Drawn on the map | Validated as a polygon in PostGIS |

## Data used only by the Python EMS (`src/avishkar_ems`, the first deliverable)

| Data | Where | Notes |
|---|---|---|
| PVGIS hourly weather for Mathura, Pune and Jaipur | `data/real/pvgis_*.csv` | The location, tilt and azimuth are in the file name |
| Load | `data/real/` | Mathura: CEEW smart meter MH43, 3-minute data, CC0 (Harvard Dataverse), with measured outages. Pune shop and Jaipur clinic: a measured German factory profile (Zenodo 4683455, CC-BY), real but not Indian, with assumed outages. Generation is modelled, not read from an inverter |
| Tariffs | the `data/tariffs` files above | The same files feed both the EMS and the platform |

## What has no source, and so is not shown

- **Grid outages and reliability:** no open, machine-readable source was found; resilience is a held reserve, not a forecast
  of outages.
- **Carbon intensity:** no emission-factor table has been read from a source; carbon is computed only when the owner supplies
  a factor.
- **Cloud movement nowcast:** a Sentinel-2 revisit of about 5 days cannot support a minutes-ahead nowcast; the API answers
  `UNAVAILABLE` with that reason. A real nowcast needs a sub-hourly geostationary source.
- **Generation measured at an inverter:** the data model has no generation meter, so the solar model is scored against the
  weather model's analysis, and says so.
- **Other people's consumption:** the city map and any neighbour view would need aggregated or simulated data; none exists and
  no real per-building consumption may be shown.
