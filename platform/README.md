# AVISHKAR platform

Location-aware energy intelligence: pick a property on a map, build its Energy Twin from real data, forecast, optimise,
simulate. Defined by [SPEC.md](SPEC.md); decisions in [ARCHITECTURE.md](ARCHITECTURE.md); honest progress per spec section
in [STATUS.md](STATUS.md); chronological notes in [../docs/WORKLOG.md](../docs/WORKLOG.md). The pre-existing Python energy
management system (`../src/avishkar_ems`) is reused as the numerical engine and keeps working untouched.

## Layout

| Path | What it is |
|---|---|
| `api/` | Fastify + TypeScript + Prisma API: auth, properties, geocoding, health, provenance, providers (`pnpm`) |
| `api/prisma/` | Schema and SQL migrations (PostgreSQL + PostGIS) |
| `web/` | Next.js app (map first): not started |
| `engine/` | Python FastAPI service wrapping `avishkar_ems` and new engines: not started |

## Local development

Prerequisites: Node 20+, pnpm, PostgreSQL 15+ **with PostGIS** (Docker: `docker compose up -d db` once the compose file lands;
or any local install).

```bash
cd platform
pnpm install                      # also runs `prisma generate`
cp api/.env.example api/.env      # fill DATABASE_URL, DATABASE_URL_TEST, SESSION_SECRET
pnpm -C api db:migrate            # applies prisma/migrations to DATABASE_URL
pnpm -C api dev                   # http://127.0.0.1:8080  (OpenAPI: /api/openapi.json)
```

Checks (same as CI): `pnpm -C api typecheck && pnpm -C api lint && pnpm -C api test && pnpm -C api build`.
`pnpm -C api test` runs unit tests plus integration tests against the real database in `DATABASE_URL_TEST`; without it the
database tests are skipped, never faked. `pnpm -C api test:live` calls the real public providers (on demand, not in CI).

## Rules that matter

- Never present simulated, estimated or demo data as live: every provider-derived value carries its provenance and a status
  (`LIVE`, `UPDATED`, `FORECAST`, `ESTIMATED`, `SIMULATED`, `DEMO`, `REFERENCE`, `UNAVAILABLE`). `LIVE` is assigned only by
  freshness rules in code (`api/src/provenance`), and the database refuses a `LIVE` row with no observation time.
- A failing provider yields a plain error or a clearly stale value, never invented data.
- Browser geolocation is never labelled NavIC.
- No secrets in the repository: `.env` is git-ignored; `.env.example` holds placeholders.
