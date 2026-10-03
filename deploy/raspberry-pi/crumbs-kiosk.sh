#!/bin/sh
set -eu

APP_URL="${CRUMBS_URL:-http://127.0.0.1:3000}"
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"

if [ -z "$CHROMIUM" ]; then
  echo "Chromium is not installed. Install Raspberry Pi OS Desktop or chromium." >&2
  exit 1
fi

# Wait for the local app before opening the kiosk browser.
attempt=0
until wget -q -O /dev/null "${APP_URL%/}/healthz"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Crumbs did not become ready at $APP_URL" >&2
    exit 1
  fi
  sleep 1
done

# WirePlumber's Jabra-specific rule is loaded by its user service at login.
# Select the current dynamic node IDs before Chromium opens its mic stream.
if command -v wpctl >/dev/null 2>&1; then
  JABRA_SELECTED=0
  attempt=0
  while [ "$attempt" -lt 20 ]; do
    JABRA_SINK_ID="$(wpctl list audio sinks 2>/dev/null | awk -F '\t' 'tolower($0) ~ /jabra speak 410/ { if (match($1, /[0-9]+/)) { print substr($1, RSTART, RLENGTH); exit } }')"
    JABRA_SOURCE_ID="$(wpctl list audio sources 2>/dev/null | awk -F '\t' 'tolower($0) ~ /jabra speak 410/ { if (match($1, /[0-9]+/)) { print substr($1, RSTART, RLENGTH); exit } }')"

    if [ -n "$JABRA_SINK_ID" ] && [ -n "$JABRA_SOURCE_ID" ] &&
      wpctl set-default "$JABRA_SINK_ID" && wpctl set-default "$JABRA_SOURCE_ID"; then
      echo "Jabra SPEAK 410 selected: sink=$JABRA_SINK_ID source=$JABRA_SOURCE_ID"
      JABRA_SELECTED=1
      break
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  if [ "$JABRA_SELECTED" -ne 1 ]; then
    echo "Jabra SPEAK 410 nodes were not exposed by WirePlumber; launching with current defaults."
  fi
else
  echo "wpctl is unavailable; Chromium will use the system defaults."
fi

exec "$CHROMIUM" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --user-data-dir="$HOME/.config/chromium-crumbs" \
  "$APP_URL"
