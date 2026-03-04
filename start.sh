#!/usr/bin/env bash
# Mission Control — start on port 3850
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/mission-control"
PORT=3850
PID_FILE="$APP_DIR/.mc-3850.pid"

if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Mission Control already running (PID $OLD_PID) at http://localhost:$PORT"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$APP_DIR"
echo "Starting Mission Control on port $PORT..."
pnpm start --port $PORT &
echo $! > "$PID_FILE"
echo "Started (PID $(cat $PID_FILE)) — http://localhost:$PORT"
