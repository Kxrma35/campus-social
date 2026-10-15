#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/lib-pg.sh"

backup=""
target=""
confirm=0
photos_archive=""
photos_dir=""

while [ $# -gt 0 ]; do
  case "$1" in
    --backup) backup="${2:?}"; shift 2 ;;
    --target-url) target="${2:?}"; shift 2 ;;
    --yes-overwrite) confirm=1; shift ;;
    --photos-archive) photos_archive="${2:?}"; shift 2 ;;
    --photos-dir) photos_dir="${2:?}"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$backup" ] || die "--backup FILE is required"
[ -n "$target" ] || die "--target-url URL is required (a database you are willing to overwrite)"
[ -f "$backup" ] || die "backup not found: $backup"
[ "$confirm" -eq 1 ] || die "this replaces the contents of the target database. Add --yes-overwrite to confirm"
if [ -n "${OWNER_DATABASE_URL:-}" ] && [ "$target" = "$OWNER_DATABASE_URL" ]; then
  die "the target is the same database as OWNER_DATABASE_URL. Restore into a separate database"
fi
if [ -n "$photos_archive" ] && [ -z "$photos_dir" ]; then
  die "--photos-archive needs --photos-dir"
fi

stream() {
  case "$1" in
    *.gpg) gpg --quiet --decrypt "$1" ;;
    *) cat "$1" ;;
  esac
}

echo "checking the target..."
printf 'select 1\n' | pg_tool psql --dbname "$target" -tA -v ON_ERROR_STOP=1 > /dev/null

echo "making sure the service roles exist..."
pg_tool psql --dbname "$target" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare r text;
begin
  foreach r in array array['app_api', 'auth_service', 'account_lifecycle', 'moderator', 'trust_safety'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
SQL

echo "restoring the database..."
stream "$backup" | pg_tool pg_restore --clean --if-exists --no-owner --exit-on-error --dbname "$target"

if [ -n "$photos_archive" ]; then
  [ -f "$photos_archive" ] || die "photo archive not found: $photos_archive"
  mkdir -p "$photos_dir"
  echo "restoring photos..."
  stream "$photos_archive" | tar -C "$photos_dir" -xf -
fi

q() { printf '%s\n' "$1" | pg_tool psql --dbname "$target" -tA -v ON_ERROR_STOP=1; }
count() { q "select count(*) from $1" 2>/dev/null || echo "n/a"; }

echo "restored. row counts:"
echo "  rows_accounts: $(count public.accounts)"
echo "  rows_profiles: $(count public.profiles)"
echo "  rows_posts: $(count public.posts)"
echo "  rows_comments: $(count public.comments)"
echo "  rows_photo_uploads: $(count public.photo_uploads)"
echo "  rows_anonymous_links: $(count identity.anonymous_links)"
echo "The restored data cannot be read by the anonymous profile tools without the link keys."
