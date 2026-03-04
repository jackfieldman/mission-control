#!/usr/bin/env bash
# Mission Control — stop
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/mission-control/.mc-3850.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "Stopped Mission Control (PID $PID)"
  else
    echo "Not running."
  fi
  rm -f "$PID_FILE"
else
  echo "No PID file found. Not running?"
fi
