#!/usr/bin/env bash
# D1 — Daily Neon backup → R2.
#
# Secret-name contract (same names as .github/workflows/backup.yml):
#   DATABASE_URL                  Neon connection string to dump
#   R2_BACKUP_ACCOUNT_ID          Cloudflare account id (builds the S3 endpoint)
#   R2_BACKUP_BUCKET              Backup bucket (separate from the S3_* audio bucket)
#   R2_BACKUP_ACCESS_KEY_ID       R2 API token / access key id
#   R2_BACKUP_SECRET_ACCESS_KEY   R2 API token / secret access key
#
# Retention is an R2 bucket lifecycle rule that expires `backups/*` after 30
# days. That rule is configured in Cloudflare, not enforced by this script.
set -euo pipefail

for name in DATABASE_URL R2_BACKUP_ACCOUNT_ID R2_BACKUP_BUCKET R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY; do
  if [ -z "${!name:-}" ]; then
    printf 'Missing required backup setting: %s\n' "$name" >&2
    exit 1
  fi
done

for command_name in pg_dump gzip aws; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$command_name" >&2
    exit 1
  fi
done

export AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto

endpoint="https://${R2_BACKUP_ACCOUNT_ID}.r2.cloudflarestorage.com"
key="backups/neon-$(date -u +%F).sql.gz"

# Status only: never print DATABASE_URL or any credential.
printf 'Writing daily Neon dump to s3://%s/%s\n' "$R2_BACKUP_BUCKET" "$key" >&2

# pipefail (above) makes a failing pg_dump fail the whole backup.
pg_dump "$DATABASE_URL" | gzip | aws \
  --endpoint-url "$endpoint" \
  s3 cp --only-show-errors - "s3://${R2_BACKUP_BUCKET}/${key}"

printf 'Daily Neon dump complete: %s\n' "$key" >&2
