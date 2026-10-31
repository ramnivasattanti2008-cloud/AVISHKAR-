# Independent audit, 2026-10-30

What a fresh container found when both applications were **started and opened in a browser**, rather than read.
Every figure here was produced by a command run in that container; where something could not be checked, it says so.

The chronological record is [WORKLOG.md](WORKLOG.md) entry 65. The per-issue ledgers are
[KNOWN_ISSUES.md](KNOWN_ISSUES.md) (Python EMS, items 24-29) and [../platform/STATUS.md](../platform/STATUS.md)
(platform, the 2026-10-30 section).

## The environment this was audited in

Nothing was pre-built. The container had Python 3.13, Node 22 and pnpm, and no project environment at all.

| What | How it was obtained | Result |
|---|---|---|
| Python 3.12 + the EMS package | `uv venv --python 3.12`, `uv pip install -e ".[app,test]"` | works; resolves pandas 3.0.5, **not** the locked environment (issue 29) |
| PostgreSQL 16 + PostGIS 3.4 | `apt-get install postgresql-16-postgis-3`, `CREATE EXTENSION postgis` | works; this is a **real** spatial database, not a stub |
| Node dependencies | `pnpm -C platform install` | works |
| Migrations and seed data | `pnpm -C platform/api db:migrate`, `db:seed` | works; real tariff and policy files loaded |
| Live providers | direct requests | Open-Meteo, PVGIS, NASA POWER, Nominatim, Carto tiles all **reachable** |
| A browser | Chromium pre-installed in the image | works, via `PLAYWRIGHT_CHROMIUM_PATH` |
| Docker | present as a client | **not usable**; images never built, deployment still unverified |
| Hardware | none | every device path remains simulated |

## What previous reports claimed, and what was actually true

The repository carries about 150 documents, many asserting completion. Four of those assertions did not survive
being checked. This is not a criticism of the work behind them — the code is largely good — but of the evidence
used to call it done.

| Claimed | Found | How the claim passed |
|---|---|---|
| The dashboard worked (entry 64 cites `curl -I :8501` → `200 OK`) | `app/dashboard.py` raised `ImportError` on import and showed an error page. It could not start. | The 200 is the Streamlit **shell**, served whether or not the app script runs. The only test that loads the dashboard skips itself unless the disk cache is fresh. |
| The web app's security headers were right and the app worked | Its own CSP blocked React's hydration scripts. **Every page was non-interactive** while answering HTTP 200: no map, no theme switch, no form, no chart. | `pnpm smoke` checks only that a policy was *sent*. `pnpm browser`, which opens a browser, had not been run — it reported 20 failures. |
| Community energy sharing was built | It computed `min(surplus, deficit)` over pooled totals. It could not say who received what, apply a transfer limit, account for a loss, or explain a decision. | "Community view" was real and honest; it was simply not allocation, and nothing distinguished the two. |
| The maps showed peer-to-peer energy flow | Three trades with invented energies and prices, hardcoded, drawn between real Indian cities. The `trades` parameter both map builders accept was ignored. | Nothing tested what the lines meant; one test asserted `len(fig.data) >= 4`, which the fabricated lines satisfied. |

The lesson that generalises: **an HTTP 200 is not evidence that a page works**, and a test that skips itself is not
evidence of anything. Both applications now have a check that cannot pass while broken —
`tests/avishkar_ems/test_app_imports.py` (never skips, needs no cache) and `pnpm -C platform/web browser`.

## What was found to be genuinely good

Most of the engineering held up, and was left alone:

- **The optimiser is real.** `platform/engine/avishkar_engine/optimise.py` is a mixed-integer linear programme
  solved by scipy/HiGHS, with an explicit objective, explicit constraints, a `validate()` pass that re-checks
  every plan so an invalid one is never shown, and an optional CVaR risk term. It already supports the four
  optimisation goals the brief asks for, through six named modes whose weights are returned with every plan and
  described as preferences rather than prices. 448 tests pass in 42 seconds.
- **The provenance discipline is real and pervasive.** Values carry a status (`LIVE`, `FORECAST`, `ESTIMATED`,
  `SIMULATED`, `UNAVAILABLE`), `LIVE` is derived from freshness rather than chosen, and the web app refuses to
  print an unavailable value as a number. There is no fabricated data anywhere in the TypeScript platform: a
  search for `Math.random` in `api/src` and `web/src` finds one password-timing dummy and one React key.
- **Data honesty in the data layer.** Meter data is never repaired; a row is accepted, refused with a named
  reason, or counted as a duplicate, and gaps stay gaps. A parameter left blank is stored blank and returned with
  its basis. Policy with no sourced rule answers `NO_SOURCED_RULE` and no number.
- **Account deletion is tested by comparing the whole database before and after.**

## What was built because it was missing

`platform/api/src/community/allocate.ts` — a real per-interval allocation engine; `POST /api/community/allocate`;
the allocation workbench on the web Community page; and `route_community_exchange` in the Python EMS, which the
dashboard had been written against but which never existed. Details in entry 65 and in
[FEATURE_COMPLETION_MATRIX.md](FEATURE_COMPLETION_MATRIX.md).

## What remains unverified, and cannot be verified here

- **Deployment.** The Dockerfiles and compose file have never been built or run.
- **Hardware.** No inverter, meter or Modbus device was present. No claim of electrical certification,
  anti-islanding validation or grid-code compliance is supported by anything in this repository.
- **Peer-to-peer transfer as a real arrangement.** The allocation engine models energy. Whether a surplus may be
  sent to a neighbour depends on the law, the licensee's rules, the metering arrangement and the wiring. Every
  response says so.
- **Forecast accuracy against reality beyond the held-out periods** in `data/real`.
- **The published result numbers in a different environment.** See issue 29.
