#!/usr/bin/env bash
# ==============================================================================
# UrjaSetu EMS Platform — Production Database Restore Utility
# ==============================================================================
# Restores a compressed custom-format (-Fc) dump into a target PostgreSQL database.
# Verifies SHA-256 integrity before restoring and runs post-restore smoke checks.
#
# Usage:
#   ./restore-db.sh --file <backup.dump> [options]
#
# Options:
#   --file <path>        Path to the backup dump file (required)
#   --db <name>          Target database name (default: avishkar_restore_test)
#   --host <host>        Database host (default: "" for local unix socket)
#   --port <port>        Database port (default: 5432 or $POSTGRES_PORT)
#   --user <user>        Database user (default: avishkar or $POSTGRES_USER)
#   --create-db          Create target database if it does not exist (default: true)
#   --no-verify          Skip checksum verification (not recommended)
#   --docker             Run pg_restore via docker compose exec db
# ==============================================================================
set -euo pipefail

BACKUP_FILE=""
TARGET_DB="${POSTGRES_RESTORE_DB:-avishkar_restore_test}"
DB_HOST="${POSTGRES_HOST:-}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-avishkar}"
CREATE_DB=true
VERIFY_CHECKSUM=true
USE_DOCKER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) BACKUP_FILE="$2"; shift 2 ;;
    --db) TARGET_DB="$2"; shift 2 ;;
    --host) DB_HOST="$2"; shift 2 ;;
    --port) DB_PORT="$2"; shift 2 ;;
    --user) DB_USER="$2"; shift 2 ;;
    --create-db) CREATE_DB=true; shift 1 ;;
    --no-verify) VERIFY_CHECKSUM=false; shift 1 ;;
    --docker) USE_DOCKER=true; shift 1 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Error: --file <backup.dump> is required." >&2
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Error: Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

echo "=== UrjaSetu EMS Database Restore ==="
echo "Source Dump:     ${BACKUP_FILE}"
echo "Target Database: ${TARGET_DB}"

# Checksum Verification
if [[ "${VERIFY_CHECKSUM}" == "true" ]]; then
  CHECKSUM_FILE="${BACKUP_FILE}.sha256"
  if [[ -f "${CHECKSUM_FILE}" ]]; then
    echo "Verifying SHA-256 checksum against ${CHECKSUM_FILE}..."
    EXPECTED_HASH="$(cat "${CHECKSUM_FILE}" | awk '{print $1}')"
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL_HASH="$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL_HASH="$(shasum -a 256 "${BACKUP_FILE}" | awk '{print $1}')"
    else
      ACTUAL_HASH="$(openssl dgst -sha256 "${BACKUP_FILE}" | awk '{print $NF}')"
    fi

    if [[ "${EXPECTED_HASH}" != "${ACTUAL_HASH}" ]]; then
      echo "FATAL: Checksum mismatch! Corrupt or tampered dump." >&2
      echo "Expected: ${EXPECTED_HASH}" >&2
      echo "Actual:   ${ACTUAL_HASH}" >&2
      exit 1
    fi
    echo "Checksum verified: ${ACTUAL_HASH}"
  else
    echo "Warning: No .sha256 file found alongside dump. Continuing with caution."
  fi
fi

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
    wsl -d Ubuntu -u "${DB_USER}" -- psql "${HOST_ARGS[@]}" -U "${DB_USER}" -d "${db}" -t -c "${query}"
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
if [[ "${USE_DOCKER}" == "true" ]]; then
  cat "${BACKUP_FILE}" | docker compose exec -T db pg_restore \
    -U "${DB_USER}" \
    -d "${TARGET_DB}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges || true
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
      "${BACKUP_FILE}" || true
  elif command -v wsl >/dev/null 2>&1; then
    wsl -d Ubuntu -u "${DB_USER}" -- bash -c \
      "pg_restore ${HOST_ARGS[@]} -U '${DB_USER}' -d '${TARGET_DB}' --clean --if-exists --no-owner --no-privileges" < "${BACKUP_FILE}" || true
  fi
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
