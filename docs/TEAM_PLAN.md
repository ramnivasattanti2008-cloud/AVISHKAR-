# Team plan: what is left, what does not work, what to build next

Written 2026-10-20 for a team of four. Source of truth for status stays `platform/STATUS.md` (per spec section) and
`docs/WORKLOG.md`; this page turns them into work you can hand out. Nothing here is claimed as done unless it says so.

## 1. State in one paragraph

The Python EMS (`src/avishkar_ems`, dashboard, examples) is finished. The TypeScript platform (`platform/`) has every spec
section built to the extent that data and hardware here allow: no row of `STATUS.md` says NOT STARTED, most say PARTIAL with the
gap named. Tests at the last full run: API 883 passed / 4 failed (one stale OpenAPI file, now regenerated; three
`control.test.ts` timeouts under full-suite load, which pass alone), web 344, engine 407, Python EMS 79. CI was green through
commit 5216356; the run for 8507b68 was still pending when this was written.

## 2. Things that do not work, or have never been run

| Item | What is wrong | Who can fix it |
|---|---|---|
| Docker images | `platform/docker/*.Dockerfile`, `docker-compose.yml`, `engine/requirements-runtime.txt` are written but have never been built or run (Docker does not start on the dev machine). Expect first-build errors. | Anyone with a working Docker machine |
| Copilot language-model path | Only exercised with a stub. The rule-based path works. Needs a real Anthropic key to test against the real service. | Owner supplies key, then 1 dev |
| Three `control.test.ts` tests | Time out at 30 s in a full API run, pass alone (the file took about 150 s). Cause not isolated; the load model refit on every call is the likely suspect. | Backend dev |
| Production map | Public OSM-style tiles only; a launch needs a tile provider with a key and its host added to the CSP (`web/src/lib/csp.ts`). | Owner + frontend dev |
| Public data providers | Nominatim, Overpass (504 about one call in three), Open-Meteo, NASA POWER, Earth Search have usage policies; not fit for production traffic. PVGIS is unreachable from the dev machine. | Backend dev (self-host or commercial plan) |
| Expired tariffs | UPPCL and MSEDCL orders ended 2026-03-31 and are shown as expired. | Anyone who can read the new orders |
| No load test | Timings are one user, one host, warm caches (`pnpm -C platform/api bench`). Concurrency behaviour is unknown. | Backend dev |
| Line endings | Git warns LF will become CRLF on generated files (`openapi.json`, `api-types.ts`). Harmless today, noisy tomorrow. | 10-minute `.gitattributes` fix |
| Python EMS limits (`docs/KNOWN_ISSUES.md`) | #11 the fault monitor cannot detect real faults on modelled data; #12 fleet pooling is illustrative; #16 many inputs are assumptions; #17 the optimiser's edge over a simple rule is small (a finding, not a bug). | Data / ML person |

## 3. Left to do, by kind

### Needs the owner or a person, not code
1. Hosting, domain, TLS, database backup and restore drill.
2. Production tile provider and key.
3. Anthropic API key.
4. Screen-reader pass (NVDA/VoiceOver) on the main flows. axe passes, which is not the same thing.
5. Independent security review (auth, CSRF, audit log, deletion, rate limits).
6. Someone to confirm the tariff and policy sources by hand against the official orders.

### Needs data that does not exist here (each is why a number shows UNAVAILABLE)
7. A device integration (inverter, battery, charger, smart meter). Control modes are only records today.
8. Outage records, so resilience can be validated rather than held as a reserve.
9. A sourced grid emission factor (carbon is not stated without one).
10. City-wide meter data (the City page only has solar resource and the owner's own properties).
11. Tariff orders beyond Maharashtra, Rajasthan and Uttar Pradesh; a sourced net-metering rule per state.
12. Generation meter data, so solar is scored against real output instead of the weather model.

### Code that could still be built
13. A risk-aware objective inside the optimiser (CVaR or chance constraints). Today the robustness view measures a plan after it
    is made; it does not make a cautious one. Biggest remaining technical item (spec 17 to 18).
14. Re-plan when a forecast changes, and a scheduled job for the learning loop (today it runs on meter import or on request).
15. Store the every-kWh ledger as its own object with an id, so it can be audited later.
16. Battery degradation and cycle limits in the planner; demand charges; net-metering settlement.
17. Joint (day-wide) forecast bands instead of per-hour; load forecast that reacts to the last few days, weather, holidays.
18. Bills-only onboarding (meter CSV is the only input today); a utility-portal or Green Button connector.
19. Sub-hourly nowcast from satellite (cloud movement is UNAVAILABLE now).
20. Stored simulation config and a `SIMULATION INVALID` gate (spec 64).
21. Speed: cache the load-model fit instead of refitting on each call.

## 4. Suggested split for four people

| Person | Focus | First three tasks |
|---|---|---|
| A: Platform / DevOps | Make it deployable | Get Docker building on a machine that can; add the production tile host to the CSP; backups + a restore drill; `.gitattributes`; load test |
| B: Backend / optimiser | Make it smarter and faster | Isolate the `control.test.ts` slowness and cache the load fit; CVaR objective (item 13); re-plan on forecast change + scheduled learning job |
| C: Frontend / UX | Make it usable by a person | Screen-reader pass and fixes; mobile pass on the Plan tab (ledger, robustness, futures are dense); bills-only onboarding screen |
| D: Data / domain | Make the numbers real | Update the expired tariffs from the new orders; add states and a sourced net-metering rule; find an emission factor and outage data; run the Python EMS on any real site data to shrink the "assumption" list in `KNOWN_ISSUES.md` #16 |

Everyone: read `CLAUDE.md`, then `docs/WORKLOG.md`, then `platform/STATUS.md`. Do not run two API test commands at once (they share
one test database and wipe each other). Never invent a tariff, subsidy, emission factor or generation figure; if it has no source
it stays UNAVAILABLE.

## 5. Before the demo or a launch

- Check CI is green on the final commit and the README results block is current (`python scripts/update_readme.py --check`).
- Run `pnpm -C platform/web smoke`, `journey` and `browser` against a production build.
- State on stage what is simulated (everything about operation: no device is connected) and what is real (public provider data,
  the owner's own uploaded meter file, sourced tariffs).
