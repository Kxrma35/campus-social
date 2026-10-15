#!/usr/bin/env bash
# Runs one scheduled job with a lock, a timeout, a bounded log and a failure alert.
#
#   run-job.sh NAME -- COMMAND [ARGS...]
#
# Environment:
#   JOB_STATE_DIR        where markers and logs live (default /var/lib/moku-jobs)
#   JOB_TIMEOUT_SECONDS  kill the job after this long (default 3600)
#   ALERT_WEBHOOK_URL or ALERT_COMMAND   where a failure is reported (see lib-jobs.sh)
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-jobs.sh
. "$here/lib-jobs.sh"

name="${1:-}"
[ -n "$name" ] || die "usage: run-job.sh NAME -- COMMAND [ARGS...]"
valid_name "$name"
shift
[ "${1:-}" = "--" ] || die "usage: run-job.sh NAME -- COMMAND [ARGS...]"
shift
[ $# -gt 0 ] || die "no command given"

state_dir
log="$JOB_STATE_DIR/$name.log"
lock="$JOB_STATE_DIR/$name.lock"

exec 9>"$lock"
if ! flock -n 9; then
  echo "$(iso) $name: still running from an earlier start, skipping" >> "$log"
  exit 0
fi

echo "$(iso) $name: start" >> "$log"
echo "$(now)" > "$JOB_STATE_DIR/$name.last_run"

timeout "${JOB_TIMEOUT_SECONDS:-3600}" "$@" >> "$log" 2>&1
code=$?

# Keep the log small.
if [ -f "$log" ] && [ "$(wc -l < "$log")" -gt 2000 ]; then
  tail -n 1000 "$log" > "$log.tmp" && mv "$log.tmp" "$log"
fi

if [ "$code" -eq 0 ]; then
  echo "$(now)" > "$JOB_STATE_DIR/$name.last_success"
  echo "$(iso) $name: ok" >> "$log"
  exit 0
fi

reason="exit code $code"
[ "$code" -eq 124 ] && reason="timed out after ${JOB_TIMEOUT_SECONDS:-3600}s"
echo "$(now)" > "$JOB_STATE_DIR/$name.last_failure"
echo "$(iso) $name: FAILED ($reason)" >> "$log"
alert "job \"$name\" failed on $(hostname) at $(iso): $reason"
exit "$code"
