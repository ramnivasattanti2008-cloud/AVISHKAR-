#!/usr/bin/env bash
# Start the AVISHKAR platform on macOS or Linux: the Python engine, the API and the web app (Windows users have
# start-platform.cmd). Stops all three on Ctrl-C.
#
#   ./start-platform.sh            the web app as a production build (builds it if there is none)
#   ./start-platform.sh --dev      the web app in development mode instead, which rebuilds as you edit
#
# What it needs, and says so rather than failing obscurely:
#   - platform/api/.env, copied from platform/api/.env.example, with DATABASE_URL and SESSION_SECRET filled in;
#   - ENGINE_API_KEY in that file, at least 16 characters, shared by the engine and the API (generate one with
#     `openssl rand -hex 24`); the engine refuses to start without a key unless ENGINE_INSECURE_DEV=1;
#   - the Python environment at .venv (see the README) and `pnpm -C platform install` already run;
#   - a PostgreSQL with PostGIS that DATABASE_URL points at, migrated and seeded (`pnpm -C platform/api db:migrate`
#     then `db:seed`), or ./start-database.sh.
set -euo pipefail
cd "$(dirname "$0")"

ROOT="$PWD"
ENV_FILE="$ROOT/platform/api/.env"
LOG_DIR="${AVISHKAR_LOG_DIR:-$ROOT/platform/.logs}"
DEV_WEB=0
[ "${1:-}" = "--dev" ] && DEV_WEB=1

die() { printf '[ERROR] %s\n' "$1" >&2; exit 1; }
note() { printf '[avishkar] %s\n' "$1"; }

[ -f "$ENV_FILE" ] || die "platform/api/.env is missing. Copy platform/api/.env.example to it and fill in DATABASE_URL, SESSION_SECRET and ENGINE_API_KEY."

# Read one key from .env without sourcing the file: its values contain spaces and brackets that a shell would try to run.
# The last definition wins, which is what the API's own loader does.
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

ENGINE_API_KEY="$(env_value ENGINE_API_KEY)"
ENGINE_URL="$(env_value ENGINE_URL)"
API_PORT="$(env_value PORT)"; API_PORT="${API_PORT:-8080}"
[ -n "$ENGINE_API_KEY" ] || die "ENGINE_API_KEY is not set in platform/api/.env. Add a key of 16 or more characters (openssl rand -hex 24); the engine and the API must share it."
[ "${#ENGINE_API_KEY}" -ge 16 ] || die "ENGINE_API_KEY in platform/api/.env is shorter than 16 characters."
[ -n "$(env_value DATABASE_URL)" ] || die "DATABASE_URL is not set in platform/api/.env."
[ -n "$(env_value SESSION_SECRET)" ] || die "SESSION_SECRET is not set in platform/api/.env. Generate one with: openssl rand -base64 48"

ENGINE_PORT=8090
case "$ENGINE_URL" in
  *:[0-9]*) ENGINE_PORT="${ENGINE_URL##*:}"; ENGINE_PORT="${ENGINE_PORT%%/*}" ;;
esac

if [ -x "$ROOT/.venv/bin/python" ]; then PY="$ROOT/.venv/bin/python"
elif [ -x "$ROOT/.venv/Scripts/python.exe" ]; then PY="$ROOT/.venv/Scripts/python.exe"
else die "No Python environment at .venv. Create it as the README describes; the engine needs it."; fi
command -v pnpm >/dev/null 2>&1 || die "pnpm is not on PATH. Install it (https://pnpm.io) and run: pnpm -C platform install"
[ -d "$ROOT/platform/node_modules" ] || die "platform/node_modules is missing. Run: pnpm -C platform install"

# A port already in use is almost always a stale server from an earlier run; say which, rather than starting a second
# copy that silently loses to it.
# A TCP connect using bash's own /dev/tcp: ss and netstat are absent from many containers and minimal images, and a
# port check that depends on them silently never succeeds.
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for p in "$ENGINE_PORT" "$API_PORT" 3000; do
  if port_busy "$p"; then die "Port $p is already in use. Stop whatever is on it first (an earlier start-platform.sh, next start, or uvicorn)."; fi
done

mkdir -p "$LOG_DIR"
PIDS=()
cleanup() {
  trap - INT TERM EXIT
  note "stopping"
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Waits for a port to accept a connection, so each service is up before the next one needs it.
wait_for_port() {
  local port="$1" name="$2" log="$3" tries=120
  while [ "$tries" -gt 0 ]; do
    if port_busy "$port"; then return 0; fi
    sleep 1
    tries=$((tries - 1))
  done
  printf '[ERROR] %s did not come up on port %s. Its log:\n' "$name" "$port" >&2
  tail -n 25 "$log" >&2
  exit 1
}

note "engine  -> http://127.0.0.1:$ENGINE_PORT  (log: $LOG_DIR/engine.log)"
( cd "$ROOT/platform/engine" && ENGINE_API_KEY="$ENGINE_API_KEY" exec "$PY" -m uvicorn avishkar_engine.app:create_app --factory --host 127.0.0.1 --port "$ENGINE_PORT" ) > "$LOG_DIR/engine.log" 2>&1 &
PIDS+=("$!")
wait_for_port "$ENGINE_PORT" "The engine" "$LOG_DIR/engine.log"

note "api     -> http://127.0.0.1:$API_PORT     (log: $LOG_DIR/api.log)"
( cd "$ROOT/platform/api" && exec pnpm dev ) > "$LOG_DIR/api.log" 2>&1 &
PIDS+=("$!")
wait_for_port "$API_PORT" "The API" "$LOG_DIR/api.log"

if [ "$DEV_WEB" = "1" ]; then
  note "web     -> http://127.0.0.1:3000          (development, log: $LOG_DIR/web.log)"
  ( cd "$ROOT/platform/web" && API_URL="http://127.0.0.1:$API_PORT" exec pnpm dev ) > "$LOG_DIR/web.log" 2>&1 &
else
  if [ ! -d "$ROOT/platform/web/.next" ]; then
    note "no production build yet: building the web app (this takes a minute)"
    ( cd "$ROOT/platform/web" && pnpm build ) || die "The web build failed. Its output is above."
  fi
  note "web     -> http://127.0.0.1:3000          (production build, log: $LOG_DIR/web.log)"
  ( cd "$ROOT/platform/web" && API_URL="http://127.0.0.1:$API_PORT" exec pnpm start ) > "$LOG_DIR/web.log" 2>&1 &
fi
PIDS+=("$!")
wait_for_port 3000 "The web app" "$LOG_DIR/web.log"

note "all three are up. Open http://127.0.0.1:3000 — Ctrl-C stops them."
wait
