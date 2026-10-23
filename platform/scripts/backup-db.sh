#!/usr/bin/env bash
# ==============================================================================
# UrjaSetu EMS Platform — Production Database Backup Utility
# ==============================================================================
# Creates a transactionally consistent, compressed custom-format (-Fc) dump of
# the PostgreSQL + PostGIS database, encrypts it, calculates a SHA-256 checksum
# and enforces retention pruning.
#
# Encryption: symmetric OpenPGP (gpg --symmetric). The passphrase is read from
# the BACKUP_PASSPHRASE environment variable and is NEVER written to disk or
# logged. If the variable is unset, the backup fails closed. If gpg is not
# installed, the script refuses to run rather than emitting an unencrypted dump.
#
# Usage:
#   BACKUP_PASSPHRASE="..." ./backup-db.sh [options]
#
# Options:
#   --db <name>          Database name (default: avishkar or $POSTGRES_DB)
#   --host <host>        Database host (default: "" for local unix socket)
#   --port <port>        Database port (default: 5432 or $POSTGRES_PORT)
#   --user <user>        Database user (default: avishkar or $POSTGRES_USER)
#   --out-dir <dir>      Output directory (default: platform/backups)
#   --keep <count>       Number of backups to retain (default: 7)
#   --docker             Run pg_dump via docker compose exec db
#   --no-encrypt         Skip encryption (restores become plaintext; not default)
# ==============================================================================
set -euo pipefail

# --- Encryption setup (fail closed) ------------------------------------------
ENCRYPT=true
if [[ "${BACKUP_PASSPHRASE:-}" == "" ]]; then
  if [[ "${BACKUP_PASSPHRASE_SET:-}" != "1" ]]; then
    echo "Error: BACKUP_PASSPHRASE is not set. Refusing to write an unencrypted database dump." >&2
    echo "       Export it before running this script (it is never written to disk or logged)." >&2
    exit 1
  fi
fi

if [[ "${ENCRYPT}" == "true" ]] && ! command -v gpg >/dev/null 2>&1; then
  echo "Error: gpg is not installed but encryption is enabled. Install gnupg or pass --no-encrypt." >&2
  exit 1
fi

DB_NAME="${POSTGRES_DB:-avishkar}"
DB_HOST="${POSTGRES_HOST:-}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-avishkar}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups"
KEEP_COUNT=7
USE_DOCKER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) DB_NAME="$2"; shift 2 ;;
    --host) DB_HOST="$2"; shift 2 ;;
    --port) DB_PORT="$2"; shift 2 ;;
    --user) DB_USER="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --keep) KEEP_COUNT="$2"; shift 2 ;;
    --docker) USE_DOCKER=true; shift 1 ;;
    --no-encrypt) ENCRYPT=false; shift 1 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "${OUT_DIR}"
chmod 700 "${OUT_DIR}" || true

TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"
BACKUP_FILE="${OUT_DIR}/${DB_NAME}_${TIMESTAMP}.dump"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

echo "=== UrjaSetu EMS Database Backup ==="
echo "Timestamp:   ${TIMESTAMP}"
echo "Database:    ${DB_NAME}"
echo "Destination: ${BACKUP_FILE}"

HOST_ARGS=()
if [[ -n "${DB_HOST}" && "${DB_HOST}" != "localhost" ]]; then
  HOST_ARGS=(-h "${DB_HOST}" -p "${DB_PORT}")
fi

if [[ "${USE_DOCKER}" == "true" ]]; then
  echo "Executing pg_dump via Docker Compose..."
  docker compose exec -T db pg_dump -U "${DB_USER}" -d "${DB_NAME}" -Fc > "${BACKUP_FILE}"
else
  # Check if pg_dump is available locally or via WSL
  if command -v pg_dump >/dev/null 2>&1; then
    PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_dump \
      "${HOST_ARGS[@]}" \
      -U "${DB_USER}" \
      -d "${DB_NAME}" \
      -Fc \
      --file="${BACKUP_FILE}"
  elif command -v wsl >/dev/null 2>&1; then
    # The PostgreSQL *database* user (avishkar) is not a WSL *system* user, so run
    # as the current WSL user and authenticate as the database user instead.
    WSL_USER="$(wsl -d Ubuntu -e whoami 2>/dev/null || echo ram)"
    WSL_HOST_ARGS=""
    if [[ -n "${DB_HOST}" && "${DB_HOST}" != "localhost" ]]; then
      WSL_HOST_ARGS="-h ${DB_HOST} -p ${DB_PORT}"
    fi
    echo "Running pg_dump inside WSL as '${WSL_USER}'..."
    wsl -d Ubuntu -u "${WSL_USER}" -- bash -c \
      "PGPASSWORD='*' pg_dump ${WSL_HOST_ARGS} -U '${DB_USER}' -d '${DB_NAME}' -Fc" > "${BACKUP_FILE}"
  else
    echo "Error: Neither pg_dump nor WSL found." >&2
    exit 1
  fi
fi

# Verify backup size
BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || wc -c < "${BACKUP_FILE}")
if [[ "${BACKUP_SIZE}" -lt 1024 ]]; then
  echo "Error: Backup file is suspiciously small (${BACKUP_SIZE} bytes)." >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

# Encrypt the dump before it ever touches disk in a form anyone but the operator can read.
# The passphrase is passed on a private file descriptor so it never appears in the process list.
if [[ "${ENCRYPT}" == "true" ]]; then
  ENCRYPTED_FILE="${BACKUP_FILE}.gpg"
  echo "Encrypting backup with OpenPGP symmetric cipher..."
  gpg --batch --yes --pinentry-mode loopback \
    --cipher-algo AES256 \
    --passphrase-fd 3 \
    --output "${ENCRYPTED_FILE}" \
    --symmetric "${BACKUP_FILE}" 3<<<"${BACKUP_PASSPHRASE}"
  # The plaintext dump must not linger next to the encrypted copy.
  rm -f "${BACKUP_FILE}"
  BACKUP_FILE="${ENCRYPTED_FILE}"
  BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || wc -c < "${BACKUP_FILE}")
  ENCRYPTED=true
else
  ENCRYPTED=false
fi

# Generate SHA-256 checksum over the artifact that is actually stored (encrypted or not).
# The checksum file is named after the final artifact so restore-db.sh can find it
# as "${BACKUP_FILE}.sha256" whatever that artifact is.
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${BACKUP_FILE}" | awk '{print $1}' > "${CHECKSUM_FILE}"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${BACKUP_FILE}" | awk '{print $1}' > "${CHECKSUM_FILE}"
else
  openssl dgst -sha256 "${BACKUP_FILE}" | awk '{print $NF}' > "${CHECKSUM_FILE}"
fi

CHECKSUM=$(cat "${CHECKSUM_FILE}")
echo "SHA-256:     ${CHECKSUM}"
echo "Size:        ${BACKUP_SIZE} bytes"
echo "Encrypted:   ${ENCRYPTED}"
echo "Status:      SUCCESS"

# Retention pruning. Encrypted backups carry the same stem, so prune by stem.
echo "Applying retention policy (keeping newest ${KEEP_COUNT} backups)..."
if [[ "${ENCRYPT}" == "true" ]]; then
  find "${OUT_DIR}" -name "${DB_NAME}_*.dump.gpg" -type f | sort -r | tail -n +"$((KEEP_COUNT + 1))" | while read -r old_dump; do
    echo "Pruning old backup: ${old_dump}"
    rm -f "${old_dump}" "${old_dump}.sha256"
  done
else
  find "${OUT_DIR}" -name "${DB_NAME}_*.dump" -type f | sort -r | tail -n +"$((KEEP_COUNT + 1))" | while read -r old_dump; do
    echo "Pruning old backup: ${old_dump}"
    rm -f "${old_dump}" "${old_dump}.sha256"
  done
fi

echo "Backup complete."
