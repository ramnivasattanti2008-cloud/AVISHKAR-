# Security and privacy

What the platform does today to protect accounts and data, what it does not do, and what the owner must decide before a
public launch. Written from the code (`platform/api/src`, `platform/engine`, `platform/web`) on 2026-10-08. Nothing here has
had an independent security review or a penetration test; treat it as a description, not a certification.

## What is protected, and how

| Area | What the code does | Where |
|---|---|---|
| Passwords | argon2id (19 MiB, 2 passes, the library's OWASP-aligned defaults). Minimum 10 and maximum 128 characters; refuses a short list of well-known passwords, one repeated character and the email address itself. Login for an unknown email still spends a real hash, so timing does not reveal which emails exist | `api/src/auth/password.ts` |
| Sessions | A 32-byte random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only the SHA-256 of the token is stored, so a database leak does not yield usable sessions. Sessions expire (default 336 h), can be revoked, and die with the account | `api/src/auth/sessions.ts` |
| CSRF | Every state-changing request from a signed-in user (POST, PUT, PATCH, DELETE) must carry `x-csrf-token`, an HMAC of the session token under `SESSION_SECRET`, compared in constant time. Login and register are the only exempt routes | `api/src/auth/hooks.ts` |
| Same-origin API | The browser only talks to the web origin; `/api/*` is proxied to the API, so the session cookie is first-party and no CORS is needed | `web/next.config.ts` |
| Ownership | Every property, asset, tariff, meter import, plan, scenario and report is looked up by `(id, userId)`; another user's id answers not found. The community view and the VPP simulator read only the signed-in owner's own properties | `api/src/*/service.ts`, `api/test/*` (ownership cases) |
| Input | Every route has a Zod schema for params, query and body; bodies are limited to 1 MB (meter files have their own 25 MB route); responses are validated against their schema too, so a field that leaks outside the schema is a 500, not data | `api/src/app.ts`, route files |
| Rate limits | 300 requests a minute per client globally, and tighter limits on expensive or abusable routes: 10 a minute on register and login, on plans, scenarios, reports, imports, VPP and community, 5 on opportunities, 20 on the Copilot, 30 on forecasts and geocoding | `api/src/app.ts`, `routes/*.ts` |
| Headers | `@fastify/helmet` defaults on the API. The web app sends a Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` and sets `poweredByHeader: false` | `api/src/app.ts`, `web/next.config.ts`, `web/src/lib/csp.ts` (tested against the map's real tile hosts) |
| Logs | Cookies, authorization and `set-cookie` are redacted. Every response carries an `x-request-id` (a client-supplied one is accepted only if it is 1 to 64 safe characters) | `api/src/app.ts` |
| Audit | An append-only `audit_log` (a database trigger refuses edits and deletes) records sign-ups, sign-ins and failures, sign-outs, property, tariff and asset changes, meter imports and deletions, plan and scenario runs, report exports, VPP runs and Copilot questions. The Copilot entries keep the kind of question, the tools used and the outcome, **not the question text**. Account deletion leaves only a hashed id | `api/src/audit.ts` |
| Your data | `GET /api/account/export` returns everything held about you; `DELETE /api/account` (password required) deletes the account, its sessions and properties and everything below them | `api/src/routes/account.ts` |
| Location privacy | What each outside service is sent, by the code: weather, solar-resource and forecast-history providers get the place rounded to 0.01 degree (about 1.1 km), and that rounded value is the cache key; the satellite-scene search gets 3 decimals (about 110 m); the building-outline search gets 5 decimals (about 1 m), because it has to find the one building; geocoding sends the text typed, or the point clicked to 5 decimals, to Nominatim, and the reverse call is made only when the user asks. The map's tile hosts see the area the browser asks for. The Account page (`/account`) says all of this to the person, and a component test pins the wording to these precisions | `api/src/providers/{weather,satellite,footprint,geocoding}.ts`, `web/src/components/account/AccountView.tsx` |
| Engine | The Python engine requires a shared key (`x-engine-key`, at least 16 characters) and refuses to start without one unless `ENGINE_INSECURE_DEV=1`. It holds no data of its own: it receives the numbers for one calculation and returns the result | `engine/avishkar_engine/app.py` |
| Secrets | `.env` files are git-ignored; `.env.example` holds placeholders only. The API refuses to start without a `SESSION_SECRET` of at least 32 characters (in every mode) and, in production with an engine URL, without an engine key | `api/src/config.ts` |
| Honesty as a safety property | `LIVE` is derived from freshness and cannot be chosen; a provider failure becomes an error or a stale-marked value, never invented data; browser location is never labelled NavIC; the Copilot cannot state a number no backend tool returned (`api/src/copilot/guard.ts`) | see STATUS rows 0-4 and 90 |

## What is not done

These are real gaps. None is hidden by the code; several are the owner's decision.

- **The web app's Content-Security-Policy still allows inline scripts and styles.** Pages are served with a CSP (own origin only for
  code and data, the three tile hosts and any provider set in `NEXT_PUBLIC_OSM_TILE_URL` for map tiles, no framing, no plugins,
  `nosniff`, a restrictive referrer policy and a permissions policy that allows only the position sensor), but Next writes the data a
  page hydrates from into inline scripts, so `'unsafe-inline'` is needed: the policy stops a script from a foreign host, not an injected
  inline one. A nonce-based policy needs every page rendered per request. No `Strict-Transport-Security`: that belongs with the TLS
  at the proxy.
- **No email verification, password reset or two-factor sign-in.** Anyone can register any email address, and a forgotten
  password cannot be recovered. There is no mail provider configured.
- **Registering an existing address says so** (`EMAIL_TAKEN`, 409), so anyone can test whether an address has an account. Login
  does not leak this (same message and same cost for an unknown email), but registration does.
- **No account lockout.** Brute force is slowed only by the per-client rate limit (10 a minute on login) and argon2's cost.
  Behind a proxy, `TRUST_PROXY=true` must be set or every client shares one address.
- **The administrator role is granted from the command line only** (`pnpm -C platform/api db:make-admin <email>`, audited as
  `admin.grant`): no route can make an administrator, and a registration always makes an ordinary user (both tested). The
  admin routes (`/api/admin/*`) answer 403 to anyone else. An administrator sees counts and aggregates, never another person's
  readings, equipment or plans, but the audit log they can read does carry email addresses and IP addresses. There is one
  administrator role with no finer permissions, no second-person approval for anything, and no two-factor sign-in for it.
- **`/api/system/health` is public** and shows provider names, call counts, latencies and the last error text of each public
  provider. It contains no secrets, but it is information about the deployment; restrict it at the proxy if that matters.
- **No dependency or container scanning in CI**, and no signed releases. Both audits were run by hand on 2026-10-09, and the
  results are below; neither is a CI gate, because the only findings have no fixed version available in the pinned toolchain today
  and a permanently red gate teaches people to ignore it. **Run them again before deploying**, and read the result rather than the
  exit code:

  ```bash
  pnpm -C platform audit                                            # six advisories, all in the Prisma CLI's own tree
  .venv/Scripts/python.exe -m pip_audit -r requirements-lock.txt    # no known vulnerabilities
  .venv/Scripts/python.exe -m pip_audit -r platform/engine/requirements-runtime.txt   # no known vulnerabilities
  ```

  | Package | Severity | Where it comes from | Why it is not in the running service |
  |---|---|---|---|
  | `lodash` (3 advisories) | high, moderate, moderate | Prisma Studio's chart library (`prisma` > `@prisma/studio-core` > `@visx/*`) | `prisma` is a devDependency used for `generate` and `migrate`; Studio is never started. No fixed version exists: the advisories ask for `>=4.18.1`, which is not published |
  | `mysql2` (2 advisories) | high, moderate | The MySQL driver the `prisma` CLI bundles | This project is PostgreSQL through `@prisma/adapter-pg`; `mysql2` is never loaded |
  | `deepmerge-ts` | high | `prisma` > `@prisma/config` | Used by the CLI while reading `prisma.config.ts`, not by the API |

  The built API imports only Fastify, its plugins, zod and the Prisma client runtime (`@prisma/client` depends on
  `@prisma/client-runtime-utils` alone), so none of the six is on a path the server can reach. The Prisma CLI is pinned at 7.10
  deliberately (`latest` resolves to an 8.0 release candidate), so these will clear when that pin can move.
- **No backup or restore procedure** is defined or tested (see DEPLOYMENT.md).
- **The audit log is append-only inside the application's database.** An operator with database superuser rights can still
  alter it; it is not shipped to an external, write-once store.
- **Rate-limit counters are in process memory.** With more than one API instance each keeps its own count; use a shared store
  before scaling out.
- **Data-protection law.** Meter readings and location are personal data. The platform has export and deletion and a page that says what it
  keeps and what leaves it (`/account`), but no consent screen, no retention schedule, no backup policy and no data-processing agreements.
  Those belong to whoever operates it. Deleting an account removes its rows from every table (a test compares the whole database before and
  after); the audit log cannot be edited by design, so its rows stay with the link to the account and the network address erased.

## Reporting a problem

There is no public security contact yet. Until the owner publishes one, a vulnerability should be reported privately to the
repository owner through GitHub (a private security advisory), not in a public issue.
