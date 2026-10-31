#!/usr/bin/env bash
# ==============================================================================
# UrjaSetu EMS Platform — Production Database Restore Utility
# ==============================================================================
# Restores a compressed custom-format (-Fc) dump into a target PostgreSQL database.
# Verifies SHA-256 integrity, decrypts an encrypted dump in place (never writing
# the plaintext to a persistent path), and runs post-restore smoke checks.
#
# The passphrase is read from BACKUP_PASSPHRASE and is NEVER written to disk or
# logged. A dump ending in .gpg is treated as encrypted and must be decrypted
# before pg_restore can read it.
#
# Usage:
#   BACKUP_PASSPHRASE="..." ./restore-db.sh --file <backup.dump[.gpg]> [options]
#
# Options:
#   --file <path>        Path to the backup dump file (required; .gpg = encrypted)

#   --db <name>          Target database name (default: avishkar_restore_test)
#   --host <host>        Database host (default: "" for local unix socket)
#   --port <port>        Database port (default: 5432 or $POSTGRES_PORT)
#   --user <user>        Database user (default: avishkar or $POSTGRES_USER)
#   --create-db          Create target database if it does not exist (default: true)
#   --no-verify          Skip checksum verification (not recommended)
#   --docker             Run pg_restore via docker compose exec db
# ==============================================================================
set -euo pipefail

RESTORE_TMPDIR="$(mktemp -d)"
trap 'rm -rf "${RESTORE_TMPDIR}"' EXIT


HOST_ARGS=()
if [[ -n "${DB_HOST}" && "${DB_HOST}" != "localhost" ]]; then
  HOST_ARGS=(-h "${DB_HOST}" -p "${DB_PORT}")
fi

# Function to execute psql query
run_sql() {
  local query="$1"
  local db="${2:-postgres}"
  if [[ "${USE_DOCKER}" == "true" ]]; then
    docker compose exec -T db psql -U "${DB_USER}" -d "${db}" -t -c "${query}"
  elif command -v psql >/dev/null 2>&1; then
    PGPASSWORD="${POSTGRES_PASSWORD:-}" psql "${HOST_ARGS[@]}" -U "${DB_USER}" -d "${db}" -t -c "${query}"
  elif command -v wsl >/dev/null 2>&1; then
    # The PostgreSQL *database* user (avishkar) is not a WSL *system* user, so run
    # as the current WSL user and authenticate as the database user instead.
    WSL_USER="$(wsl -d Ubuntu -e whoami 2>/dev/null || echo ram)"
    wsl -d Ubuntu -u "${WSL_USER}" -- psql "${HOST_ARGS[@]}" -U "${DB_USER}" -d "${db}" -t -c "${query}"

  else
    echo "Error: Neither psql nor WSL found." >&2
    exit 1
  fi
}

# Ensure target database exists
if [[ "${CREATE_DB}" == "true" ]]; then
  echo "Checking if database '${TARGET_DB}' exists..."
  EXISTS=$(run_sql "SELECT 1 FROM pg_database WHERE datname='${TARGET_DB}';" "postgres" | tr -d '[:space:]')
  if [[ "${EXISTS}" != "1" ]]; then
    echo "Creating database '${TARGET_DB}'..."
    run_sql "CREATE DATABASE ${TARGET_DB} OWNER ${DB_USER} ENCODING 'UTF8';" "postgres"
    echo "Enabling PostGIS extension on '${TARGET_DB}'..."
    run_sql "CREATE EXTENSION IF NOT EXISTS postgis;" "${TARGET_DB}"
  fi
fi

echo "Restoring database schema and data..."
# A restore that fails must fail the job. pg_restore returns non-zero for a
# corrupt dump, a missing table or a privilege error, so capture its status
# before the integrity queries run and refuse to continue on it.
RESTORE_STATUS=0
if [[ "${USE_DOCKER}" == "true" ]]; then
  cat "${RESTORE_INPUT}" | docker compose exec -T db pg_restore \

    -U "${DB_USER}" \
    -d "${TARGET_DB}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges || RESTORE_STATUS=$?

else
  if command -v pg_restore >/dev/null 2>&1; then
    PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_restore \
      "${HOST_ARGS[@]}" \
      -U "${DB_USER}" \
      -d "${TARGET_DB}" \
      --clean \
      --if-exists \
      --no-owner \
      --no-privileges \
      "${RESTORE_INPUT}" || RESTORE_STATUS=$?
  elif command -v wsl >/dev/null 2>&1; then
    # The PostgreSQL *database* user (avishkar) is not a WSL *system* user, so run
    # as the current WSL user and authenticate as the database user instead.
    WSL_USER="$(wsl -d Ubuntu -e whoami 2>/dev/null || echo ram)"
    wsl -d Ubuntu -u "${WSL_USER}" -- bash -c \
      "pg_restore ${HOST_ARGS[@]} -U '${DB_USER}' -d '${TARGET_DB}' --clean --if-exists --no-owner --no-privileges" < "${RESTORE_INPUT}" || RESTORE_STATUS=$?
  else
    echo "Error: Neither pg_restore nor WSL found." >&2
    exit 1
  fi
fi

if [[ "${RESTORE_STATUS}" -ne 0 ]]; then
  echo "Error: pg_restore failed with status ${RESTORE_STATUS}. The dump may be corrupt or the target database unreachable." >&2
  exit 1
fi


echo "Verifying restored database integrity..."
TABLE_COUNT=$(run_sql "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" "${TARGET_DB}" | tr -d '[:space:]')
POSTGIS_VER=$(run_sql "SELECT PostGIS_Version();" "${TARGET_DB}" | tr -d '[:space:]')
MIGRATION_COUNT=$(run_sql "SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NULL;" "${TARGET_DB}" 2>/dev/null | tr -d '[:space:]' || echo "0")

echo "--- Integrity Summary ---"
echo "Public Tables:        ${TABLE_COUNT}"
echo "PostGIS Version:      ${POSTGIS_VER}"
echo "Applied Migrations:   ${MIGRATION_COUNT}"

if [[ "${TABLE_COUNT}" -lt 15 ]]; then
  echo "Error: Restore verification failed. Table count (${TABLE_COUNT}) is lower than expected." >&2
  exit 1
fi

echo "Restore drill completed successfully."
