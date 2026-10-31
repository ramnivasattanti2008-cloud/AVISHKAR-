# Phase 24: UrjaSetu EMS Configuration & Secrets Management

## 1. Exhaustive Environment Variable Inventory

Every environment variable utilized by UrjaSetu EMS is formally inventoried, validated, and classified below:

| Variable Name | Component | Required In | Is Secret? | Default Value | Purpose & Validation Rules | Safe Example Format |
|---|---|---|---|---|---|---|
| `NODE_ENV` | API / Web | Prod, Staging | No | `development` | Runtime environment. Enum: `development`, `test`, `production`. | `production` |
| `HOST` | API | None | No | `127.0.0.1` | Network interface to bind to. In Docker, must be `0.0.0.0`. | `0.0.0.0` |
| `PORT` | API | None | No | `8080` | HTTP port on which Fastify listens. Integer $\ge 1$. | `8080` |
| `LOG_LEVEL` | API | None | No | `info` | Fastify logger verbosity. Enum: `debug`, `info`, `warn`, `error`. | `info` |
| `POSTGRES_USER` | DB / API | Prod, Staging | No | `avishkar` | PostgreSQL superuser/role for UrjaSetu. | `avishkar` |
| `POSTGRES_PASSWORD` | DB / API | Prod, Staging | **Yes** | None | Database password. Fails closed if missing or contains `CHANGE_ME`. | Strong 32+ character random secret |
| `POSTGRES_DB` | DB / API | Prod, Staging | No | `avishkar` | Main database name. | `avishkar` |
| `DATABASE_URL` | API / Prisma | Prod, Staging | **Yes** | None | PostgreSQL connection URI. Must start with `postgresql://`. | `postgresql://user:pass@host:5432/avishkar?schema=public` |
| `DATABASE_URL_TEST`| API Tests | Test | **Yes** | None | Dedicated throwaway database connection URI for integration tests. | `postgresql://user:pass@localhost:5432/avishkar_test` |
| `SESSION_SECRET` | API | Prod, Staging | **Yes** | None | HMAC key for signing cookies and CSRF tokens. Minimum 32 chars. | `openssl rand -base64 48` |
| `SESSION_TTL_HOURS`| API | None | No | `336` | Session cookie time-to-live in hours (default: 14 days). | `336` |
| `COOKIE_SECURE` | API | Prod | No | `true` | Enforces `Secure` attribute on cookies. In prod, must be `true`. | `true` |
| `TRUST_PROXY` | API | None | No | `false` | Set to `1` or `true` only when running behind trusted reverse proxy. | `1` |
| `ENGINE_URL` | API | Prod, Staging | No | `http://127.0.0.1:8090` | Internal URL to Python optimization engine microservice. | `http://engine:8090` |
| `ENGINE_API_KEY` | API / Engine | Prod, Staging | **Yes** | None | Symmetric shared secret key between API and Engine. Min 16 chars. | `openssl rand -hex 24` |
| `ENGINE_INSECURE_DEV`| Engine | None | No | `false` | Bypasses key requirement for dev. Forbidden in production. | `false` |
| `PROVIDER_USER_AGENT`| API | Prod, Staging | No | None | Contact URL in User-Agent header for public API etiquette. | `UrjaSetuEMS/1.0 (+https://urjasetu.gov.in)` |
| `PROVIDER_TIMEOUT_MS`| API | None | No | `10000` | HTTP timeout for upstream external providers in milliseconds. | `10000` |
| `GEOCODING_PROVIDER`| API | None | No | `nominatim` | Geocoding provider adapter name. | `nominatim` |
| `WEATHER_PROVIDER`| API | None | No | `open-meteo` | Weather forecast provider adapter name. | `open-meteo` |
| `SOLAR_RESOURCE_PROVIDER`| API | None | No | `nasa-power` | Climatological solar resource provider adapter name. | `nasa-power` |
| `ANTHROPIC_API_KEY`| API | None | **Yes** | None | Optional LLM key for AI Copilot natural language phrasing. | `sk-ant-api03-...` |
| `JOBS_ENABLED` | API | None | No | `false` | Leader election flag. Enable on exactly one node in cluster. | `true` |
| `API_URL` | Web | Prod, Staging | No | `http://127.0.0.1:8080` | Internal Fastify API origin for Next.js SSR proxy rewrites. | `http://api:8080` |
| `NEXT_PUBLIC_MAP_TILE_URL`| Web | None | No | Empty | Vector/raster tile endpoint for MapLibre map visualizer. | `https://api.maptiler.com/maps/...` |
| `BACKUP_PASSPHRASE`| SRE / Scripts | None | **Yes** | None | Symmetric passphrase for GPG/PBKDF2 encrypted database backups. | Strong 32+ character random passphrase |

---

## 2. Server-Only Secrets vs Client-Exposed Variables

### Non-Negotiable Rule:
No server secret (database password, session key, engine key, AI token) may EVER be prefixed with `NEXT_PUBLIC_`.
The `ConfigEnvironmentManager` in `src/avishkar_ems/release_safety.py` actively checks for any key starting with `NEXT_PUBLIC_` containing secret keywords (`PASSWORD`, `SECRET`, `PRIVATE_KEY`, `ENGINE_API_KEY`, `DATABASE_URL`) and fails startup closed if detected.

---

## 3. Secret Handling & Repository Hygiene Policy

1. **Zero Credential Invariant**:
   - No production password, real token, private key, or cloud credential is ever committed to source control.
   - Pinned CI test credentials (e.g. `ci_only_not_a_secret`, `ci-session-secret-0123456789abcdef-0123456789`) are strictly quarantined to ephemeral Docker CI containers and rejected by production startup validators.
2. **Version Control Ignore Enforcement**:
   - The root `.gitignore` enforces exclusion of:
     - `.env`, `.env.*`, `.env.local`, `platform/**/.env`, `platform/**/.env.*`
     - `secrets_*.yaml`, `secrets_*.yml` (except template `secrets_emhass(example).yaml`)
     - `*.dump`, `*.dump.*`, `*.dump.gpg`, `*.dump.enc`, `*.sha256`
     - `platform/backups/`, `backups/`, `data/cache/`
3. **Automated Secret Scanning**:
   - GitHub Actions `docker-build.yml` runs automated file scans verifying that no dump, gpg archive, or untracked secret file exists in Git tracking.
   - `SecretHygieneScanner` in `release_safety.py` sanitizes database URLs, Bearer tokens, and sensitive dictionary keys before logging.

---

## 4. Secret Rotation Procedures

### A. Rotating `SESSION_SECRET`
Rotating `SESSION_SECRET` invalidates all existing user session cookies, requiring active users to re-login.
1. Generate new 48-byte secret:
   ```bash
   NEW_SESSION_SECRET=$(openssl rand -base64 48)
   ```
2. Update environment variable in container deployment manager (AWS Secrets Manager / Doppler / Kubernetes Secret).
3. Perform rolling restart of the API cluster:
   ```bash
   docker compose up -d api
   ```
4. Verify `/api/health` returns status `ok`.

### B. Rotating `ENGINE_API_KEY`
The `ENGINE_API_KEY` is shared symmetrically between Fastify API and FastAPI Engine.
1. Generate new 32-character key:
   ```bash
   NEW_ENGINE_KEY=$(openssl rand -hex 24)
   ```
2. Update both API and Engine configuration simultaneously:
   ```bash
   export ENGINE_API_KEY="$NEW_ENGINE_KEY"
   ```
3. Restart Engine first, followed immediately by API.
4. Verify `/api/system/health` reports `engine.state == "healthy"`.

### C. Rotating `POSTGRES_PASSWORD`
1. Connect as database administrator and alter password:
   ```sql
   ALTER USER avishkar WITH PASSWORD 'NEW_STRONG_GENERATED_PASSWORD';
   ```
2. Update `DATABASE_URL` in API configuration.
3. Restart API process and verify database connectivity.
