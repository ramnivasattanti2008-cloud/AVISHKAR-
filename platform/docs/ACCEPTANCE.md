# The final quality bar and the acceptance test

Spec sections 95 and 96. This is a record of one walk, not a promise about every future one: it says what was done, on what date, and what was found.

**Walk of 2026-10-09.** A completely fresh account, registered through the web app's own form, driven through the real user interface
against the running API, the running Python engine and the live providers (Nominatim, Open-Meteo, NASA POWER, Overpass, Earth Search).
No step used a fixture, a seeded property or the demo world. The one thing not typed by hand was the meter file: 70 days of hourly
readings were generated with a known pattern and imported through the page's own file input, because no real household's meter data was
available to use. The report calls it `readings-generated-for-this-walk.csv`, and nothing presents it as anyone's data.

The property was a real place: Koramangala, Bengaluru (12.93574, 77.62408), found by searching for it.

## Section 96: what a completely fresh user could do

| Step | Result | Evidence from the walk |
|---|---|---|
| Open AVISHKAR | Yes | Registered through the form; landed on the map |
| Search a real location | Yes | "Koramangala Bengaluru" returned real Nominatim places; picked the first |
| Select a property | Yes | Saved from the preview; property page opened |
| See the source and quality of the data | Yes | Each value carries its label, and a data-completeness figure (45% before the analysis) with what would raise it |
| Generate an Energy Twin | Yes | "Analyze this property" built Twin v1 in about ten seconds |
| Actual, estimated and forecast clearly distinguished | Yes | On one screen: roof area REFERENCE, usable area and capacity ESTIMATED, next-24-hour yield FORECAST, air temperature LIVE, consumption UNAVAILABLE with its reason |
| View weather | Yes | 26.1 °C, 100% cloud, 0 W/m² irradiance, LIVE (it was night) |
| View satellite information where available | Yes | Sentinel-2B, acquired that morning at 10:55, 57% cloud, REFERENCE, with the note that no cloud nowcast is possible |
| View solar potential | Yes | 43.1 m² outline from OpenStreetMap, 21.6 m² usable, 2.2 kWp, 8.9 kWh/day, each marked REFERENCE or ESTIMATED |
| View demand | Yes | UNAVAILABLE before any meter data, with the reason; after importing, an Energy DNA from 70 complete days |
| Run a forecast | Yes | Solar: 45 kWh over three days, band 35.3 to 49.3, the band held on 86% of 105 unseen hours, and 2% better than repeating yesterday. Load: 14.7 kWh for the next day, method "same hour last week", chosen on a holdout |
| See energy opportunities | Yes | Four findings with break-even prices (for example 4 kWp of solar is worth it below ₹47,630 per kWp), and "no other tariff in your state is on file" |
| Run optimization | Yes | Balanced plan: ₹56.03 against ₹64.09 with no control, saving ₹8.06, with a recommendation, its reasons, the data used and a confidence of 5 of 5 forecasts agreeing |
| See where energy is allocated | Yes | "Where the power comes from" hour by hour (solar used, from the battery, bought), the battery's charge, the prices, and every decision with the planner's own reason |
| Change solar, battery or EV assumptions | Yes | Added 3 kWp with a quote of ₹45,000 per kWp on the What-if tab |
| Run a simulation | Yes | A typical year, 24 planned days weighted over the next 365 |
| Compare outcomes | Yes | Today's setup against the change, month by month, with payback 9.09 years (17.3 discounted), NPV ₹8,764, IRR 8.88% |
| Ask the Copilot why a decision was made | Yes | "Why did the plan charge the battery at 12 pm?" was answered from the plan's own decision, with a citation |
| Inspect the supporting data | Yes | The citation opens the raw tool result (`getLatestPlan`, SIMULATED, with the time it was looked up) |
| Export a report | Yes | 8.2 kB of Markdown, `avishkar-report-koramangala-2026-10-09.md` |

**No step depended on fake data.** Every figure above came from a provider, from the readings imported, or from a calculation over those,
and each is labelled as what it is.

### What the walk found

- **The tariff catalogue has no Karnataka order.** A Bengaluru user must type their own rates, which the Tariff tab supports and labels
  YOURS with "the source does not say when this tariff applies". The three curated plans are Maharashtra, Rajasthan and Uttar Pradesh.
  This is data coverage, not a defect in the code, but it means the catalogue cannot yet serve most of India.
- A flat rate still leaves the planner something to do: it stored midday surplus rather than exporting it at ₹3.00 to use against a
  ₹7.50 import, which is the whole of the ₹8.06 it saved.
- The load forecast's error on these readings is near zero because the pattern generated for the walk repeats exactly every week. The
  page says what it was checked on, so the figure is not misleading, but it is not evidence about real households.

## Section 95: the quality bar

### Product

| Piece | State |
|---|---|
| Map, property selection, Energy Twin, weather, satellite, solar forecast, load forecast, optimization, battery simulation, EV, appliance model, opportunity engine, economics, resilience, what-if, counterfactual, Copilot, community simulation, VPP simulation | All present and exercised; the walk above covers most of them end to end, and `platform/STATUS.md` gives the state and the limits of each |
| Satellite "or clearly reports unavailable" | Reports the latest scene with its age and cloud, and says plainly that a cloud nowcast is impossible from scenes days apart |

### Data integrity

| Rule | How it is held |
|---|---|
| No fabricated live data | `LIVE` is derived from freshness, never chosen; a provider failure gives an error or a stale-marked value |
| Provenance | Every value carries provider, source, time, age and notes; the web app renders them through one component |
| Timestamps | On every measured value and every stored forecast, plan and what-if |
| Stale data detected | Weather and solar values carry their age; a plan older than a day is called stale on the Today and Health tabs |
| Failures handled | A provider that fails gives UNAVAILABLE with the reason, not a filled-in number |

### Engineering (run on 2026-10-09)

| Check | Result |
|---|---|
| `pnpm -C platform/api typecheck && lint && test` | Clean; 849 tests in 54 files, against a real PostgreSQL 16 + PostGIS 3.4 and the real Python engine |
| `pnpm -C platform/web typecheck && lint && test && build` | Clean; 323 tests in 36 files |
| `cd platform/engine && python -m pytest tests -q` | 407 passed; `ruff check platform/engine` clean |
| `pnpm -C platform/web smoke` against a production build | All checks pass (pages, the map's worker files, the security headers, a real 404) |
| Migrations | `prisma migrate deploy` applies; drift check against `schema.prisma` is empty |
| Security checks | argon2id passwords, hashed session tokens, HttpOnly SameSite cookies, CSRF header, rate limits, helmet, zod validation, ownership isolation, append-only audit log, a Content-Security-Policy and the other headers, export and real deletion of an account. No independent review and no dependency audit: see `SECURITY.md` |
| Deployment | Dockerfiles and a compose file exist but have **never been built or run** (the Docker engine does not start on this machine). See `DEPLOYMENT.md` |

## What would have to be true to call this finished

Not claimed, and listed so nobody has to guess: an independent security review and a dependency audit; a browser end-to-end suite
(only a smoke test exists); a screen-reader pass (axe finds nothing on the pages checked, which is not the same thing); a built and
run container image; a hosted instance with TLS, a domain, a backup and a tile provider; tariff coverage beyond three states; and the
language-model path of the Copilot exercised against the real service, which needs the owner's key.
