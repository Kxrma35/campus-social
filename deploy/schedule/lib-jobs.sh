#!/usr/bin/env bash
# Shared helpers for the scheduled jobs. Source this file; do not run it.
#
# No analytics and no third party by default: an alert goes only where the operator points it,
# either ALERT_WEBHOOK_URL (any endpoint that accepts a plain text POST) or ALERT_COMMAND (a
# command that receives the message as its first argument, for example a mail wrapper).
# With neither set the message goes to standard error, where the scheduler's log keeps it.

JOB_STATE_DIR="${JOB_STATE_DIR:-/var/lib/moku-jobs}"

die() {
  echo "error: $*" >&2
  exit 2
}

state_dir() {
  umask 077
  mkdir -p "$JOB_STATE_DIR"
  chmod 700 "$JOB_STATE_DIR" 2>/dev/null || true
}

valid_name() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9_-]{0,40}$ ]] || die "job name must be lowercase letters, digits, - or _: $1"
}

# alert MESSAGE. The message never carries log content, only the job name, the host and a code.
alert() {
  local msg="[moku] $1"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 15 -H 'Content-Type: text/plain; charset=utf-8' --data-binary "$msg" \
      "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || echo "warning: the alert could not be delivered: $msg" >&2
  elif [ -n "${ALERT_COMMAND:-}" ]; then
    # shellcheck disable=SC2086
    $ALERT_COMMAND "$msg" || echo "warning: the alert command failed: $msg" >&2
  else
    echo "$msg" >&2
  fi
}

now() { date -u +%s; }
iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
