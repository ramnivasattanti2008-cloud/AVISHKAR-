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
| Headers | `@fastify/helmet` defaults on the API. The web app sets `poweredByHeader: false` | `api/src/app.ts`, `web/next.config.ts` |
| Logs | Cookies, authorization and `set-cookie` are redacted. Every response carries an `x-request-id` (a client-supplied one is accepted only if it is 1 to 64 safe characters) | `api/src/app.ts` |
| Audit | An append-only `audit_log` (a database trigger refuses edits and deletes) records sign-ups, sign-ins and failures, sign-outs, property, tariff and asset changes, meter imports and deletions, plan and scenario runs, report exports, VPP runs and Copilot questions. The Copilot entries keep the kind of question, the tools used and the outcome, **not the question text**. Account deletion leaves only a hashed id | `api/src/audit.ts` |
| Your data | `GET /api/account/export` returns everything held about you; `DELETE /api/account` (password required) deletes the account, its sessions and properties and everything below them | `api/src/routes/account.ts` |
| Location privacy | Coordinates are coarsened to about 1 km before they are sent to a weather, solar-resource or forecast-history provider, and the coarsened value is the cache key. Geocoding sends the text or point the user typed or clicked to Nominatim; the reverse-geocode call is made only when the user asks | `api/src/providers/weather.ts`, `geocoding.ts` |
| Engine | The Python engine requires a shared key (`x-engine-key`, at least 16 characters) and refuses to start without one unless `ENGINE_INSECURE_DEV=1`. It holds no data of its own: it receives the numbers for one calculation and returns the result | `engine/avishkar_engine/app.py` |
| Secrets | `.env` files are git-ignored; `.env.example` holds placeholders only. The API refuses to start without a `SESSION_SECRET` of at least 32 characters (in every mode) and, in production with an engine URL, without an engine key | `api/src/config.ts` |
| Honesty as a safety property | `LIVE` is derived from freshness and cannot be chosen; a provider failure becomes an error or a stale-marked value, never invented data; browser location is never labelled NavIC; the Copilot cannot state a number no backend tool returned (`api/src/copilot/guard.ts`) | see STATUS rows 0-4 and 90 |

## What is not done

These are real gaps. None is hidden by the code; several are the owner's decision.

- **No Content-Security-Policy on the web app.** helmet protects the API's responses, but the Next.js app serves pages without
  a CSP, and the map loads tiles and styles from third-party hosts. Add a CSP once the tile provider is chosen, because the
  allow-list depends on it.
- **No email verification, password reset or two-factor sign-in.** Anyone can register any email address, and a forgotten
  password cannot be recovered. There is no mail provider configured.
- **Registering an existing address says so** (`EMAIL_TAKEN`, 409), so anyone can test whether an address has an account. Login
  does not leak this (same message and same cost for an unknown email), but registration does.
- **No account lockout.** Brute force is slowed only by the per-client rate limit (10 a minute on login) and argon2's cost.
  Behind a proxy, `TRUST_PROXY=true` must be set or every client shares one address.
- **No admin interface.** The `ADMIN` role exists in the schema and `requireAdmin` exists as a guard, but nothing uses it
  yet: no route is admin-only. Do not describe any part of the platform as having an admin role in production use.
- **`/api/system/health` is public** and shows provider names, call counts, latencies and the last error text of each public
  provider. It contains no secrets, but it is information about the deployment; restrict it at the proxy if that matters.
- **No dependency or container scanning in CI**, and no signed releases. `pnpm audit` and `pip-audit` have not been run as a gate.
- **No backup or restore procedure** is defined or tested (see DEPLOYMENT.md).
- **The audit log is append-only inside the application's database.** An operator with database superuser rights can still
  alter it; it is not shipped to an external, write-once store.
- **Rate-limit counters are in process memory.** With more than one API instance each keeps its own count; use a shared store
  before scaling out.
- **Data-protection law.** Meter readings and location are personal data. The platform has export and deletion, but no privacy
  notice, no consent screen, no retention schedule and no data-processing agreements. Those belong to whoever operates it.

## Reporting a problem

There is no public security contact yet. Until the owner publishes one, a vulnerability should be reported privately to the
repository owner through GitHub (a private security advisory), not in a public issue.
