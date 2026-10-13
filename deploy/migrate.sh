#!/usr/bin/env bash
set -euo pipefail

: "${OWNER_DATABASE_URL:?OWNER_DATABASE_URL is required (the database owner connection)}"
dir="${MIGRATIONS_DIR:-/migrations}"

run() { psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

run -c "create table if not exists public.schema_migrations (filename text primary key, applied_at timestamptz not null default now())"

applied=0
for f in "$dir"/*.sql; do
  name="$(basename "$f")"
  seen="$(printf "select 1 from public.schema_migrations where filename = :'name'\n" | run -tA -v name="$name")"
  if [ "$seen" = "1" ]; then
    echo "skip    $name"
    continue
  fi
  run --single-transaction -f "$f"
  printf "insert into public.schema_migrations (filename) values (:'name')\n" | run -v name="$name"
  echo "applied $name"
  applied=$((applied + 1))
done

echo "done: $applied applied"
