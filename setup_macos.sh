#!/usr/bin/env bash

set -euo pipefail

ARCHIVE="${1:-$HOME/Downloads/LE_BMS_dashboard_mac_20260925.zip}"
TARGET="${LE_BMS_TARGET:-$HOME/Documents/LE_BMS}"
URL="http://127.0.0.1:8000"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. Install it from https://www.python.org/downloads/macos/ and rerun this script."
  exit 1
fi

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Dashboard archive not found: $ARCHIVE"
  echo "Check your Downloads folder for LE_BMS_dashboard_mac_20260925.zip."
  exit 1
fi

mkdir -p "$TARGET"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

ditto -x -k "$ARCHIVE" "$STAGING"
rsync -a --exclude '.venv-web' --exclude '__pycache__' "$STAGING/" "$TARGET/"

cd "$TARGET"
python3 -m venv .venv-web
"$TARGET/.venv-web/bin/python" -m pip install --upgrade pip
"$TARGET/.venv-web/bin/python" -m pip install -r requirements.txt

if [[ -f dashboard.pid ]]; then
  OLD_PID="$(cat dashboard.pid)"
  if kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID"
  fi
fi

nohup "$TARGET/.venv-web/bin/python" -m uvicorn server.main:app \
  --host 127.0.0.1 \
  --port 8000 \
  >dashboard.stdout.log \
  2>dashboard.stderr.log &

SERVER_PID=$!
echo "$SERVER_PID" > dashboard.pid

for _ in {1..30}; do
  if curl --silent --fail "$URL/api/state" >/dev/null; then
    open "$URL"
    echo "LE BMS dashboard is running at $URL (PID $SERVER_PID)."
    exit 0
  fi
  sleep 1
done

echo "The dashboard did not become ready. See $TARGET/dashboard.stderr.log."
exit 1
