#!/usr/bin/env bash
# One scheduled backup: dump, then remove copies older than the retention you chose.
# Run it through run-job.sh so a failure alerts and a silent stop is noticed.
#
# Required environment (there are deliberately no defaults for the choices that are yours):
#   OWNER_DATABASE_URL    the database owner connection
#   BACKUP_DIR            where dumps are written, on a host that does not hold the link keys
#   BACKUP_KEEP_DAYS      how long a backup is kept. A backup still holds deleted data, so this
#                         is a privacy decision, not a disk-space one.
#   BACKUP_ENCRYPT_TO     GPG recipient, or set BACKUP_UNENCRYPTED=1 to accept plain dumps
# Optional:
#   BACKUP_PHOTOS_DIR     also archive a local photo directory
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${OWNER_DATABASE_URL:?OWNER_DATABASE_URL is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${BACKUP_KEEP_DAYS:?BACKUP_KEEP_DAYS is required: decide how long deleted data may stay in backups}"
[[ "$BACKUP_KEEP_DAYS" =~ ^[0-9]+$ ]] && [ "$BACKUP_KEEP_DAYS" -ge 1 ] \
  || { echo "BACKUP_KEEP_DAYS must be a whole number of days, at least 1" >&2; exit 2; }

args=(--out "$BACKUP_DIR")
if [ -n "${BACKUP_ENCRYPT_TO:-}" ]; then
  args+=(--encrypt-to "$BACKUP_ENCRYPT_TO")
elif [ "${BACKUP_UNENCRYPTED:-0}" = "1" ]; then
  args+=(--unencrypted)
else
  echo "set BACKUP_ENCRYPT_TO, or BACKUP_UNENCRYPTED=1 to accept plain dumps" >&2
  exit 2
fi
[ -n "${BACKUP_PHOTOS_DIR:-}" ] && args+=(--photos "$BACKUP_PHOTOS_DIR")

bash "$here/../backup.sh" "${args[@]}"

# Prune only files this job writes, and only by age.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'campus-social-*' -mtime "+$BACKUP_KEEP_DAYS" -print -delete
