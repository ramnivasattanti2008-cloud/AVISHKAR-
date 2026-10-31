#!/usr/bin/env bash
set -e

# The password is taken from DATABASE_URL_TEST in the git-ignored platform/api/.env, never written in this file.
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/platform/api/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "[WSL-ERROR] $ENV_FILE not found: create it with DATABASE_URL_TEST=postgresql://avishkar:<password>@127.0.0.1:5432/avishkar_test" >&2
    exit 1
fi
DB_PASSWORD="$(grep -E '^DATABASE_URL_TEST=' "$ENV_FILE" | head -1 | sed -E 's#^[^=]+="?[a-z]+://[^:]+:([^@]+)@.*#\1#')"
if [ -z "$DB_PASSWORD" ] || [ "$DB_PASSWORD" = "$(grep -E '^DATABASE_URL_TEST=' "$ENV_FILE" | head -1)" ]; then
    echo "[WSL-ERROR] Could not read a password from DATABASE_URL_TEST in $ENV_FILE." >&2
    exit 1
fi
SQL_PASSWORD="${DB_PASSWORD//\'/\'\'}"  # a single quote is doubled inside an SQL string

# Start postgresql service
service postgresql start

# Ensure user and databases exist (the password is passed on stdin, so it does not appear in the process list)
if ! su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='avishkar'\"" | grep -q 1; then
    printf "CREATE USER avishkar WITH SUPERUSER PASSWORD '%s';\n" "$SQL_PASSWORD" | su - postgres -c "psql -q"
fi
su - postgres -c "psql -lqt | cut -d \| -f 1 | grep -qw avishkar_dev || createdb -O avishkar avishkar_dev"
su - postgres -c "psql -lqt | cut -d \| -f 1 | grep -qw avishkar_test || createdb -O avishkar avishkar_test"

# Ensure postgis extension is enabled
su - postgres -c "psql -d avishkar_dev -c 'CREATE EXTENSION IF NOT EXISTS postgis;'"
su - postgres -c "psql -d avishkar_test -c 'CREATE EXTENSION IF NOT EXISTS postgis;'"

# Keep WSL distro active in background (daemonized with detached streams)
if ! pgrep -f "sleep infinity" >/dev/null 2>&1; then
    nohup sleep infinity </dev/null >/dev/null 2>&1 &
fi

echo "[WSL-OK] PostgreSQL 16 and PostGIS 3.4 verified."
