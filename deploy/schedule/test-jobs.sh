#!/usr/bin/env bash
# Tests for run-job.sh, check-jobs.sh and run-backup.sh. Needs only bash and coreutils.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export JOB_STATE_DIR="$tmp/state"
export ALERT_COMMAND="$tmp/alert.sh"
cat > "$ALERT_COMMAND" <<'EOS'
#!/usr/bin/env bash
echo "$1" >> "${ALERTS_FILE}"
EOS
chmod +x "$ALERT_COMMAND"
export ALERTS_FILE="$tmp/alerts"
: > "$ALERTS_FILE"

fails=0
ok() { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fails=$((fails + 1)); }
expect() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
alerts() { wc -l < "$ALERTS_FILE" | tr -d ' '; }

# 1. A passing job leaves a success marker and sends nothing.
bash "$here/run-job.sh" good -- true
expect "a passing job exits 0" "[ \$? -eq 0 ]"
expect "a passing job records a success time" "[ -f '$JOB_STATE_DIR/good.last_success' ]"
expect "a passing job sends no alert" "[ \"\$(alerts)\" = 0 ]"

# 2. A failing job alerts once, with the code, and no log content.
bash "$here/run-job.sh" broken -- bash -c 'echo SECRET-ROW-DATA; exit 7'
code=$?
expect "a failing job passes its exit code on" "[ $code -eq 7 ]"
expect "a failing job sends one alert" "[ \"\$(alerts)\" = 1 ]"
expect "the alert names the job and the code" "grep -q 'job \"broken\" failed.*exit code 7' '$ALERTS_FILE'"
expect "the alert carries no output from the job" "! grep -q SECRET-ROW-DATA '$ALERTS_FILE'"
expect "the output is kept in the local log" "grep -q SECRET-ROW-DATA '$JOB_STATE_DIR/broken.log'"
expect "a failing job leaves no success marker" "[ ! -f '$JOB_STATE_DIR/broken.last_success' ]"

# 3. A job that overruns is stopped and reported as a timeout.
: > "$ALERTS_FILE"
JOB_TIMEOUT_SECONDS=1 bash "$here/run-job.sh" slow -- sleep 5
expect "an overrunning job is reported as timed out" "grep -q 'timed out after 1s' '$ALERTS_FILE'"

# 4. A second start while one is running is skipped, not stacked.
( bash "$here/run-job.sh" locked -- sleep 2 ) &
sleep 0.5
bash "$here/run-job.sh" locked -- true
expect "an overlapping start is skipped" "grep -q 'still running' '$JOB_STATE_DIR/locked.log'"
wait

# 5. Job names are validated (no path tricks).
bash "$here/run-job.sh" '../escape' -- true 2>/dev/null
expect "a bad job name is refused" "[ \$? -eq 2 ]"

# 6. check-jobs reports a job that never succeeded, then stays quiet until the repeat window.
: > "$ALERTS_FILE"
bash "$here/check-jobs.sh" never:24 2>/dev/null
expect "a job that never succeeded is reported" "grep -q 'never succeeded' '$ALERTS_FILE'"
bash "$here/check-jobs.sh" never:24 2>/dev/null
expect "the same problem is not repeated at once" "[ \"\$(alerts)\" = 1 ]"

# 7. check-jobs reports a stale success and accepts a fresh one.
: > "$ALERTS_FILE"
echo $(( $(date -u +%s) - 49 * 3600 )) > "$JOB_STATE_DIR/stale.last_success"
bash "$here/check-jobs.sh" stale:30 2>/dev/null
expect "a stale job is reported" "grep -q 'has not succeeded for 49 hours' '$ALERTS_FILE'"
: > "$ALERTS_FILE"
bash "$here/check-jobs.sh" good:30
expect "a recent success is accepted" "[ \$? -eq 0 ] && [ \"\$(alerts)\" = 0 ]"

# 8. The backup wrapper refuses to run without the choices that are the owner's.
OWNER_DATABASE_URL=postgres://x BACKUP_DIR="$tmp/b" bash "$here/run-backup.sh" >/dev/null 2>&1
expect "a backup without a retention period is refused" "[ \$? -ne 0 ]"
OWNER_DATABASE_URL=postgres://x BACKUP_DIR="$tmp/b" BACKUP_KEEP_DAYS=0 bash "$here/run-backup.sh" >/dev/null 2>&1
expect "a retention of 0 days is refused" "[ \$? -ne 0 ]"
OWNER_DATABASE_URL=postgres://x BACKUP_DIR="$tmp/b" BACKUP_KEEP_DAYS=35 bash "$here/run-backup.sh" >/dev/null 2>&1
expect "a backup with neither encryption nor an explicit opt-out is refused" "[ \$? -ne 0 ]"

# 9. Webhook delivery posts plain text and carries no secrets.
if command -v python3 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
  port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  python3 - "$port" "$tmp/hook" <<'PY' &
import sys, http.server
port, out = int(sys.argv[1]), sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        open(out, "w").write(self.headers.get("content-type", "") + "\n" + self.rfile.read(n).decode())
        self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", port), H)
srv.handle_request()
PY
  sleep 0.5
  ALERT_COMMAND="" ALERT_WEBHOOK_URL="http://127.0.0.1:$port/hook" \
    bash "$here/run-job.sh" hooked -- bash -c 'exit 3'
  sleep 0.5
  expect "a webhook alert is a plain text post" "head -1 '$tmp/hook' | grep -q 'text/plain'"
  expect "the webhook message names the job" "grep -q 'job \"hooked\" failed' '$tmp/hook'"
else
  echo "skip - webhook test needs python3 and curl"
fi

echo
if [ "$fails" -eq 0 ]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
