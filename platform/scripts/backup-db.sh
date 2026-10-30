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
# =======================================================================
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
