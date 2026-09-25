#!/usr/bin/env bash
# Start, stop, or check the app on this machine: the dashboard and one worker.
#
#   scripts/run-local.sh              start in demo mode (scripted client, no model calls, free)
#   scripts/run-local.sh --live       start against real providers (paid calls; needs keys in worker/.env)
#   scripts/run-local.sh stop
#   scripts/run-local.sh status
#
# Keys are read from worker/.env, which git ignores. In demo mode they only decide which models
# the picker shows as available; nothing is called.
#
# Each process writes its pid to data/run/, and its mode is written beside it. Status and stop
# work from those files, not from matching command lines, which macOS truncates.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=3100
RUN_DIR="$ROOT/data/run"
LOG_DIR="$ROOT/data/logs"
PASSWORD="${DASHBOARD_PASSWORD:-localdev}"
POLL="${SIM_POLL_SECONDS:-3}"

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# Start a command in its own session, so no signal meant for this shell (Ctrl-C, the terminal
# closing, the shell exiting) reaches it. The worker's own SIGTERM handler still lets `stop`
# drain it cleanly. macOS has no setsid, so Python's start_new_session does the job.
detach() {   # detach <log> <pidfile> <command...>
  local log="$1" pidfile="$2"; shift 2
  python3 - "$log" "$pidfile" "$@" <<'PY'
import subprocess, sys
log, pidfile, *cmd = sys.argv[1:]
with open(log, "ab") as out:
    p = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
open(pidfile, "w").write(str(p.pid))
PY
}

stop() {
  # by pid file first, then anything else on the port or matching the worker, so a stray
  # process from an earlier start cannot survive and run beside the new one
  for name in dashboard worker; do
    if alive "$RUN_DIR/$name.pid"; then kill "$(cat "$RUN_DIR/$name.pid")" 2>/dev/null && echo "stopped the $name"; fi
    rm -f "$RUN_DIR/$name.pid"
  done
  local pids
  pids="$(lsof -ti:"$PORT" 2>/dev/null || true)"
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
  pkill -f "sim serve" 2>/dev/null || true
  rm -f "$RUN_DIR/worker.mode"
  # the worker drains on SIGTERM: it finishes or rolls back what it is doing, then exits. Give it
  # that time, so a start right after does not run beside a worker that is still leaving.
  for _ in $(seq 1 30); do pgrep -f "sim serve" >/dev/null 2>&1 || break; sleep 1; done
  if pgrep -f "sim serve" >/dev/null 2>&1; then echo "a worker is still draining; it will exit when its current step ends" >&2; fi
}

status() {
  if curl -s -o /dev/null "http://localhost:$PORT/login"; then echo "dashboard: up at http://localhost:$PORT"; else echo "dashboard: down"; fi
  # macOS reports the interpreter's full path, not "python", so the worker is found by its pid
  # file and by the module name that survives in every form of the command line.
  local n
  n="$( (pgrep -f "sim serve" || true) | wc -l | tr -d ' ')"
  if ! alive "$RUN_DIR/worker.pid" && [ "$n" = 0 ]; then
    echo "worker:    down"
  elif [ "$n" -gt 1 ]; then
    echo "worker:    $n running; that is one too many. Run: $0 stop"
  elif ! alive "$RUN_DIR/worker.pid"; then
    echo "worker:    up, started by hand (mode unknown). Run: $0 stop, then start it from here."
  elif [ "$(cat "$RUN_DIR/worker.mode" 2>/dev/null)" = demo ]; then
    echo "worker:    up, demo (scripted client, no model calls)"
  else
    echo "worker:    up, LIVE (paid calls)"
  fi
}

start() {
  local mode="$1"
  stop
  mkdir -p "$RUN_DIR" "$LOG_DIR"

  # the schema first, so the dashboard never reads a table that is not there yet
  (cd "$ROOT/worker" && .venv/bin/python -m sim migrate >/dev/null)

  (
    cd "$ROOT/dashboard"
    DATABASE_URL=file:../data/sim.sqlite DASHBOARD_PASSWORD="$PASSWORD" DASHBOARD_SESSION_SECRET="$(openssl rand -base64 48)" \
      detach "$LOG_DIR/dashboard.log" "$RUN_DIR/dashboard.pid" npm run dev
  )

  local args=(serve --poll-seconds "$POLL")
  [ "$mode" = demo ] && args+=(--demo)
  (
    cd "$ROOT/worker"
    set -a; [ -f .env ] && source .env; set +a
    detach "$LOG_DIR/worker.log" "$RUN_DIR/worker.pid" .venv/bin/python -m sim "${args[@]}"
  )
  echo "$mode" > "$RUN_DIR/worker.mode"

  for _ in $(seq 1 60); do curl -s -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done
  sleep 2
  echo
  status
  echo
  echo "sign in at http://localhost:$PORT with your name and the password '$PASSWORD'"
  echo "logs: $LOG_DIR/dashboard.log  $LOG_DIR/worker.log"
}

case "${1:-start}" in
  start|"") start demo ;;
  --live|live)
    if ! grep -qE "^(ANTHROPIC_API_KEY|OPENAI_API_KEY|HF_TOKEN)=." "$ROOT/worker/.env" 2>/dev/null; then
      echo "live mode needs at least one key in worker/.env (ANTHROPIC_API_KEY, OPENAI_API_KEY or HF_TOKEN)" >&2; exit 1
    fi
    echo "LIVE mode: reviews will make paid model calls."; start live ;;
  stop)   stop ;;
  status) status ;;
  *) echo "usage: $0 [start|--live|stop|status]" >&2; exit 2 ;;
esac
