# Deployment

**State on 2026-10-09: nothing has been deployed.** There is no hosted instance, no infrastructure-as-code and no tested backup.
There are Dockerfiles and a compose file for the platform (`platform/docker/`, `platform/docker-compose.yml`), but **they have
never been built or run**: the Docker engine cannot start on the development machine, so each file says UNTESTED at its top.
What was checked, outside Docker, is described under "What was and was not checked" below. The repository's root `Dockerfile`
belongs to the vendored upstream EMHASS project, not to the platform. What follows is the procedure that matches how the
services run on the development machine (each step below was run there), plus what the owner must supply and decide.

## The pieces

| Service | Runs as | Needs | Port |
|---|---|---|---|
| Database | PostgreSQL 16 with PostGIS 3.4 | The `postgis` extension (the first migration runs `CREATE EXTENSION`: use a role that may, or enable it once from the host's console) | 5432 |
| Engine | Python 3.12, `uvicorn avishkar_engine.app:create_app --factory` | The packages in `requirements-lock.txt` plus `platform/engine/requirements.txt`; `ENGINE_API_KEY` | 8090 |
| API | Node 24, `node dist/server.js` after `pnpm -C platform/api build` | The database, the engine, outbound HTTPS to the providers in DATA_SOURCES.md | 8080 |
| Web | Next 16, `output: "standalone"` | The API's address | 3000 |

The browser talks only to the web origin. The web app proxies `/api/*` to the API, so the session cookie is first-party and the
API needs no CORS configuration. The API and the engine should not be reachable from the internet directly: put the API behind
the web origin (or a reverse proxy) and the engine on a private network.

## Order of steps

1. **Database.** Create a database and a role. Set `DATABASE_URL`. Run `pnpm -C platform/api db:migrate` (this is
   `prisma migrate deploy`: it applies the committed migrations and never resets anything), then `pnpm -C platform/api db:seed`
   to load the sourced tariffs and policy rules (idempotent).
2. **Engine.** Install the Python packages. Set `ENGINE_API_KEY` (16 characters or more; generate one). Start it with
   `python -m uvicorn avishkar_engine.app:create_app --factory --host 127.0.0.1 --port 8090`. It refuses to start without a key
   unless `ENGINE_INSECURE_DEV=1`, which must never be set in production.
3. **API.** Set the environment (below), then `pnpm -C platform/api build` and `node dist/server.js`.
4. **Web.** Set `API_URL` to the API's address **before building**: the proxy rewrite is read when the app is built, not at
   start. Then `pnpm -C platform/web build` and run the standalone server.
5. **First administrator.** Register an account in the web app, then `pnpm -C platform/api db:make-admin you@example.com` on the
   server. This is the only way to make an administrator, and it is recorded in the audit log.
6. **Check.** After building the web app, `pnpm -C platform/web smoke <web address>` fetches the pages, the map's worker files and the security headers of a running production build (CI runs it); then `GET /api/health` answers 200 when the process is up. `GET /api/system/health` reports the database, PostGIS, the
   engine and each provider from real recent calls; `unknown` means no recent traffic, not healthy.

## Environment (API)

The full list with comments is `platform/api/.env.example`. Values that must be set for a real deployment:

| Variable | Rule |
|---|---|
| `NODE_ENV` | `production`: turns on `Secure` cookies and the engine-key requirement |
| `SESSION_SECRET` | 32 characters or more, random (for example `openssl rand -base64 48`). Changing it signs everyone out |
| `DATABASE_URL` | The production database. Keep it out of the repository |
| `ENGINE_URL`, `ENGINE_API_KEY` | Where the engine is, and the key it was started with. Without `ENGINE_URL` plans and model forecasts are `UNAVAILABLE` and say so |
| `TRUST_PROXY` | `true` only behind a proxy you control, otherwise every client shares one rate-limit bucket (or can forge its address) |
| `PROVIDER_USER_AGENT` | Must identify the service with a real contact; Nominatim's policy requires it |
| `ANTHROPIC_API_KEY` | Optional; the Copilot works from templates without it |
| `JOBS_ENABLED` | `true` on exactly one API process to run the background jobs (forecast scoring, weather and satellite refresh, tariff checks); the database stops two from running one job at once. Off by default |

`.env` files are git-ignored. Never put a real secret in `.env.example`, the repository or the CI file.

## What the owner has to decide or supply

- **Hosting** and the account that pays for it. Nothing here chooses or creates one.
- **A map tile provider and key.** The default tile servers (OpenStreetMap, Esri, OpenTopoMap) do not allow production
  traffic. The map layer is abstracted in `web/src/lib/basemaps.ts`; a Content-Security-Policy should be written once the
  provider is known.
- **Commercial or self-hosted geocoding, weather and footprint services** if more than light use is expected: the public
  Nominatim, Overpass and Open-Meteo endpoints have usage policies, and the code is built to be polite (caching, spacing,
  back-off) rather than to carry load.
- **TLS and a domain**, terminated at the proxy.
- **An email provider**, if password reset or verification is wanted (not built).
- **A backup plan for the database.** None is defined or tested. The meter data an owner imports is theirs and cannot be
  re-fetched.
- **Privacy notice, consent and retention** for personal data (see SECURITY.md).

## Continuous integration

`.github/workflows/ci.yml` runs on every push: the Python EMS (lint, tests, README check), the platform API against a real
PostGIS service and the real engine (typecheck, lint, tests, build), the engine (lint, tests, committed OpenAPI) and the web
(typecheck, lint, tests, build). It does not deploy anything, scan dependencies or build images. The live-provider tests
(`pnpm -C platform/api test:live`) are run by hand, never in CI.

## Containers

`platform/docker/{engine,api,web}.Dockerfile` and `platform/docker-compose.yml` (database from `postgis/postgis:16-3.4`, engine,
API, web; only the web port is published). Build context is `platform/`. Required variables are refused when missing
(`docker compose config` shows which): `POSTGRES_PASSWORD`, `ENGINE_API_KEY`, `SESSION_SECRET`, `PROVIDER_USER_AGENT`. The one-off steps are
`docker compose run --rm api pnpm db:migrate`, `... pnpm db:seed` and `... pnpm db:make-admin <email>`; the top of the compose file lists them.
The API image keeps its development packages so that it can run those; the web image is the Next standalone output.

### What was and was not checked

| Piece | Checked | How |
|---|---|---|
| The engine's runtime packages | Yes | `platform/engine/requirements-runtime.txt` was installed alone into an empty virtual environment (plus pytest and httpx) and the engine's 407 tests passed there |
| The web app's image layout | Yes, outside Docker | `next build` with `output: "standalone"`, the static files and `public/` (which holds the map's worker files) copied beside `server.js`, `node server.js`; `pnpm smoke` passed against it and `/api/health` answered through its proxy |
| The compose file | Syntax and required variables | `docker compose config` (needs no engine) |
| Any image build, `docker compose up`, the one-off commands in a container, a healthcheck, the API as a non-root user | **No** | The Docker engine would not start |
| The API without its development packages | **No** | The image keeps them |

## Not done

- A built and run image of any service, and a tested compose stack (see above).
- Infrastructure as code, a staging environment, a rollback procedure, zero-downtime migrations.
- An external queue (pg-boss or similar): the jobs run from one in-process scheduler (`JOBS_ENABLED=true`), which is enough for
  four small jobs and not for work that must survive a restart or spread over machines.
- Structured metrics, tracing and alerting beyond the provider-health endpoint and request-id'd logs.
- A load test. Single-user response times against the specification's targets were measured on the development machine (`pnpm -C platform/api bench`, STATUS row 77) and met; nothing has been measured under concurrent load or on hosted hardware.
