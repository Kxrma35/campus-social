#!/usr/bin/env bash
set -euo pipefail

: "${OWNER_DATABASE_URL:?OWNER_DATABASE_URL is required (the database owner connection)}"
: "${AUTH_SERVICE_PASSWORD:?}"
: "${ACCOUNT_LIFECYCLE_PASSWORD:?}"
: "${APP_API_PASSWORD:?}"
: "${MODERATOR_PASSWORD:?}"

psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -v auth="$AUTH_SERVICE_PASSWORD" \
  -v lifecycle="$ACCOUNT_LIFECYCLE_PASSWORD" \
  -v api="$APP_API_PASSWORD" \
  -v moderator="$MODERATOR_PASSWORD" <<'SQL'
alter role auth_service login password :'auth';
alter role account_lifecycle login password :'lifecycle';
alter role app_api login password :'api';
alter role moderator login password :'moderator';
SQL

echo "passwords set for auth_service, account_lifecycle, app_api, moderator"
