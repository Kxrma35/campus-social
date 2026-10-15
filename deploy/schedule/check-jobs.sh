#!/usr/bin/env bash
# Alerts when a scheduled job has not succeeded recently, so a job that silently stopped
# running is noticed. Run it from its own timer, more often than the jobs themselves.
#
#   check-jobs.sh NAME:MAX_HOURS [NAME:MAX_HOURS ...]
#   check-jobs.sh lifecycle:30 backup:30
#
# A job that has never succeeded is reported too. The same job is reported at most once
# every ALERT_REPEAT_HOURS (default 6) so a long outage does not flood anyone.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-jobs.sh
. "$here/lib-jobs.sh"

[ $# -gt 0 ] || die "usage: check-jobs.sh NAME:MAX_HOURS [NAME:MAX_HOURS ...]"
state_dir

repeat=$(( ${ALERT_REPEAT_HOURS:-6} * 3600 ))
bad=0

for spec in "$@"; do
  name="${spec%%:*}"
  hours="${spec##*:}"
  valid_name "$name"
  [[ "$hours" =~ ^[0-9]+$ ]] || die "max hours must be a whole number: $spec"

  ok="$JOB_STATE_DIR/$name.last_success"
  problem=""
  if [ ! -f "$ok" ]; then
    problem="has never succeeded on $(hostname)"
  else
    last="$(cat "$ok")"
    age=$(( $(now) - last ))
    if [ "$age" -gt $(( hours * 3600 )) ]; then
      problem="has not succeeded for $(( age / 3600 )) hours on $(hostname) (limit $hours)"
    fi
  fi

  if [ -n "$problem" ]; then
    bad=1
    marker="$JOB_STATE_DIR/$name.last_alert"
    if [ ! -f "$marker" ] || [ $(( $(now) - $(cat "$marker") )) -ge "$repeat" ]; then
      alert "job \"$name\" $problem"
      now > "$marker"
    fi
  else
    rm -f "$JOB_STATE_DIR/$name.last_alert"
  fi
done

exit "$bad"
