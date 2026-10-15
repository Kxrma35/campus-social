#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/lib-pg.sh"

out=""
recipient=""
unencrypted=0
photos=""

while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="${2:?}"; shift 2 ;;
    --encrypt-to) recipient="${2:?}"; shift 2 ;;
    --unencrypted) unencrypted=1; shift ;;
    --photos) photos="${2:?}"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

: "${OWNER_DATABASE_URL:?OWNER_DATABASE_URL is required (the database owner connection)}"
[ -n "$out" ] || die "--out DIR is required"
if [ -z "$recipient" ] && [ "$unencrypted" -ne 1 ]; then
  die "choose --encrypt-to GPG_RECIPIENT, or --unencrypted if you accept that this file holds every student's data in the clear"
fi
if [ -n "$recipient" ] && [ "$unencrypted" -eq 1 ]; then
  die "--encrypt-to and --unencrypted cannot be combined"
fi
if [ -n "$photos" ] && [ ! -d "$photos" ]; then
  die "--photos must be a directory: $photos"
fi

umask 077
mkdir -p "$out"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="$out/campus-social-$stamp"
ext=""
[ -n "$recipient" ] && ext=".gpg"

encrypt() {
  if [ -n "$recipient" ]; then
    gpg --batch --yes --quiet --trust-model always --encrypt --recipient "$recipient" --output "$1"
  else
    cat > "$1"
  fi
}

db_file="$base.dump$ext"
echo "dumping database..."
pg_tool pg_dump --format=custom --no-owner --dbname "$OWNER_DATABASE_URL" | encrypt "$db_file.partial"
mv "$db_file.partial" "$db_file"

photo_file=""
if [ -n "$photos" ]; then
  photo_file="$base.photos.tar$ext"
  echo "archiving photos..."
  tar -C "$photos" -cf - . | encrypt "$photo_file.partial"
  mv "$photo_file.partial" "$photo_file"
fi

q() { printf '%s\n' "$1" | pg_tool psql --dbname "$OWNER_DATABASE_URL" -tA -v ON_ERROR_STOP=1; }
count() { q "select count(*) from $1" 2>/dev/null || echo "n/a"; }

manifest="$base.manifest.txt"
{
  echo "created_utc: $stamp"
  echo "server_version: $(q 'show server_version')"
  echo "pg_dump: $(pg_tool pg_dump --version)"
  echo "encrypted: $([ -n "$recipient" ] && echo "yes, to $recipient" || echo "NO")"
  echo "database_file: $(basename "$db_file")"
  echo "database_sha256: $(sha256sum "$db_file" | cut -d' ' -f1)"
  echo "database_bytes: $(stat -c %s "$db_file")"
  if [ -n "$photo_file" ]; then
    echo "photos_file: $(basename "$photo_file")"
    echo "photos_sha256: $(sha256sum "$photo_file" | cut -d' ' -f1)"
    echo "photos_bytes: $(stat -c %s "$photo_file")"
  fi
  echo "migrations_applied: $(count public.schema_migrations)"
  echo "rows_accounts: $(count public.accounts)"
  echo "rows_profiles: $(count public.profiles)"
  echo "rows_posts: $(count public.posts)"
  echo "rows_comments: $(count public.comments)"
  echo "rows_photo_uploads: $(count public.photo_uploads)"
  echo "rows_anonymous_links: $(count identity.anonymous_links)"
  echo "keys_included: no"
} > "$manifest"

if [ -z "$recipient" ]; then
  pg_tool pg_restore --list < "$db_file" > /dev/null || die "the dump could not be read back"
fi

echo "backup written:"
echo "  $db_file"
[ -n "$photo_file" ] && echo "  $photo_file"
echo "  $manifest"
[ -n "$recipient" ] || echo "WARNING: this backup is not encrypted."
echo "Keys are NOT in this backup. They must be held separately (ops/KEY_CUSTODY_AND_RESTORE.md)."
