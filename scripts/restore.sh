#!/usr/bin/env bash
# Restore a daily dump from R2 into a supplied DATABASE_URL (e.g. a Neon branch).
#
# Usage:
#   DATABASE_URL='postgresql://...' ./scripts/restore.sh backups/neon-2026-11-26.sql.gz
#   RESTORE_CONFIRM=RESTORE DATABASE_URL='postgresql://...' ./scripts/restore.sh backups/neon-2026-11-26.sql.gz
#
# Same secret-name contract as scripts/backup-db.sh; DATABASE_URL is the target.
# Restore into an empty branch: this streams plain SQL into psql, it does not
# clean or drop existing objects. Never call this against production by accident.
set -euo pipefail

usage() {
  printf 'Usage: DATABASE_URL=<target-neon-url> %s <backups/neon-YYYY-MM-DD.sql.gz>\n' "$0" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
key="$1"

if [[ ! "$key" =~ ^backups/neon-[0-9]{4}-[0-9]{2}-[0-9]{2}\.sql\.gz$ ]]; then
  printf 'Refusing to restore unexpected key: %s\n' "$key" >&2
  usage
fi

for name in DATABASE_URL R2_BACKUP_ACCOUNT_ID R2_BACKUP_BUCKET R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY; do
  if [ -z "${!name:-}" ]; then
    printf 'Missing required restore setting: %s\n' "$name" >&2
    exit 1
  fi
done

for command_name in aws gunzip psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$command_name" >&2
    exit 1
  fi
done

export AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto

endpoint="https://${R2_BACKUP_ACCOUNT_ID}.r2.cloudflarestorage.com"
source="s3://${R2_BACKUP_BUCKET}/${key}"

# Safety confirm. Never echo the target URL — it may contain credentials.
if [ "${RESTORE_CONFIRM:-}" = "RESTORE" ]; then
  : # Explicit non-interactive opt-in for scripted round-trip checks.
elif [ -t 0 ]; then
  printf 'Restore %s into the database in DATABASE_URL. This overwrites data.\n' "$key" >&2
  printf 'Type RESTORE to continue: ' >&2
  IFS= read -r reply || {
    printf 'No confirmation received; cancelled.\n' >&2
    exit 1
  }
  if [ "$reply" != "RESTORE" ]; then
    printf 'Cancelled.\n' >&2
    exit 1
  fi
else
  printf 'Restore needs confirmation: run interactively or set RESTORE_CONFIRM=RESTORE.\n' >&2
  exit 1
fi

printf 'Restoring %s (credentials and target URL are not logged).\n' "$key" >&2

# pipefail makes a failed download, gunzip or psql statement fail the restore.
aws --endpoint-url "$endpoint" s3 cp --only-show-errors "$source" - \
  | gunzip \
  | psql --no-psqlrc -v ON_ERROR_STOP=1 "$DATABASE_URL"

printf 'Restore complete: %s\n' "$key" >&2
