#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$root/deploy/lib-pg.sh"

backup=""
manifest=""
record_dir="$root/ops/drills"

while [ $# -gt 0 ]; do
  case "$1" in
    --backup) backup="${2:?}"; shift 2 ;;
    --manifest) manifest="${2:?}"; shift 2 ;;
    --record-dir) record_dir="${2:?}"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$backup" ] || die "--backup FILE is required"
[ -f "$backup" ] || die "backup not found: $backup"
[ -z "$manifest" ] || [ -f "$manifest" ] || die "manifest not found: $manifest"
: "${LINK_ENCRYPTION_KEYS:?LINK_ENCRYPTION_KEYS must be the keys you retrieved from the key backup, not the running configuration}"
: "${LINK_BLIND_INDEX_KEY:?LINK_BLIND_INDEX_KEY must be the key you retrieved from the key backup}"
command -v docker >/dev/null || die "docker is required: the drill restores into a throwaway database container"
[ -d "$root/apps/api/node_modules" ] || die "run npm ci in apps/api first"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="campus-drill-$stamp"
password="$(openssl rand -hex 16)"
port="$((40000 + RANDOM % 20000))"
target="postgres://postgres:$password@127.0.0.1:$port/campus_social"
work="$(mktemp -d)"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

started=$SECONDS
echo "starting a throwaway database ($name)..."
docker run --rm -d --name "$name" \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=campus_social \
  -p "127.0.0.1:$port:5432" "${PG_IMAGE:-postgres:16}" > /dev/null
for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -U postgres -d campus_social > /dev/null 2>&1 && break
  sleep 1
done
sleep 2

restore_started=$SECONDS
set +e
"$root/deploy/restore.sh" --backup "$backup" --target-url "$target" --yes-overwrite > "$work/restore.log" 2>&1
restore_status=$?
set -e
restore_seconds=$((SECONDS - restore_started))

verify_status=99
verify_seconds=0
if [ "$restore_status" -eq 0 ]; then
  verify_started=$SECONDS
  set +e
  (cd "$root/apps/api" && KEY_CHECK_DATABASE_URL="$target" npx tsx src/scripts/verify-keys.ts) > "$work/verify.log" 2>&1
  verify_status=$?
  set -e
  verify_seconds=$((SECONDS - verify_started))
fi

counts_match="not checked (no manifest given)"
if [ "$restore_status" -eq 0 ] && [ -n "$manifest" ]; then
  counts_match="yes"
  for key in rows_accounts rows_profiles rows_posts rows_comments rows_photo_uploads rows_anonymous_links; do
    want="$(grep "^$key:" "$manifest" | cut -d' ' -f2)"
    got="$(grep "$key:" "$work/restore.log" | tail -1 | sed 's/.*: //')"
    if [ "$want" != "$got" ]; then
      counts_match="NO: $key was $want in the backup and $got after restore"
      break
    fi
  done
fi

result="PASS (automated steps)"
[ "$restore_status" -eq 0 ] || result="FAIL: restore did not complete"
[ "$restore_status" -ne 0 ] || [ "$verify_status" -eq 0 ] || result="FAIL: verify-keys reported a problem"
case "$counts_match" in NO*) result="FAIL: restored data does not match the backup manifest" ;; esac

mkdir -p "$record_dir"
record="$record_dir/drill-$stamp.md"
{
  echo "# Restore drill $stamp"
  echo
  echo "**Result of the automated steps: $result**"
  echo
  echo "| Item | Value |"
  echo "|---|---|"
  echo "| Date (UTC) | $stamp |"
  echo "| Run by | $(whoami) on $(hostname) |"
  echo "| Backup file | $(basename "$backup") |"
  echo "| Backup sha256 | $(sha256sum "$backup" | cut -d' ' -f1) |"
  echo "| Manifest checked | ${manifest:+$(basename "$manifest")}${manifest:-none} |"
  echo "| Restore time | ${restore_seconds}s (exit $restore_status) |"
  echo "| Row counts match the manifest | $counts_match |"
  echo "| verify-keys time | ${verify_seconds}s (exit $verify_status) |"
  echo "| Whole automated run | $((SECONDS - started))s |"
  echo
  echo "## verify-keys output"
  echo
  echo '```'
  if [ -f "$work/verify.log" ]; then cat "$work/verify.log"; else echo "(not run)"; fi
  echo '```'
  echo
  echo "## Restore output"
  echo
  echo '```'
  cat "$work/restore.log"
  echo '```'
  echo
  echo "## Still to be done and written down by a person"
  echo
  echo "- [ ] Step 2: the keys were retrieved from the key backup, not from the running configuration. Which copy, by whom, and how long it took: ______"
  echo "- [ ] Step 5: the student API was started against the restored copy with these keys, and a test account acted as its anonymous profile. Worked? ______"
  echo "- [ ] Step 6: a test account with an anonymous profile was closed and the maintenance job run against the restored copy. skipped: 0? ______"
  echo "- [ ] A second custodian, not the person who set this up, completed steps 2 and 4 from the runbook alone. Who? ______"
  echo "- [ ] Findings: anything slow, unclear, or requiring knowledge only one person has: ______"
  echo
  echo "Add a row to Appendix A of \`ops/KEY_CUSTODY_AND_RESTORE.md\`. **G7 stays open until all of the above are filled in and passed.**"
} > "$record"

echo
echo "result: $result"
echo "record: $record"
[ "$result" != "${result#PASS}" ]
