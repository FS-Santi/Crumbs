#!/bin/sh
set -eu

APP_URL="${CRUMBS_URL:-http://127.0.0.1:3000}"
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"

if [ -z "$CHROMIUM" ]; then
  echo "Chromium is not installed. Install Raspberry Pi OS Desktop or chromium." >&2
  exit 1
fi

# Wait briefly for the backend so Chromium does not land on a connection error
# when the desktop session starts before systemd finishes bringing up Crumbs.
attempt=0
until wget -q -O /dev/null "${APP_URL%/}/healthz"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Crumbs did not become ready at $APP_URL" >&2
    exit 1
  fi
  sleep 1
done

# Reset the PipeWire user session before any application opens the microphone.
# Restarting it after Chromium starts destroys the stream Chromium is using.
if systemctl --user restart pipewire pipewire-pulse wireplumber; then
  echo "PipeWire audio session restarted before Chromium startup."
else
  echo "PipeWire restart failed; continuing with the existing audio session."
fi

# Select the USB Jabra headset as both playback and capture default before
# Chromium starts. PipeWire node IDs can change between boots, so discover them
# by name each time instead of saving numeric IDs in the image.
if command -v wpctl >/dev/null 2>&1; then
  attempt=0
  JABRA_SELECTED=0
  while [ "$attempt" -lt 60 ]; do
    JABRA_SINK_ID="$(wpctl list audio sinks 2>/dev/null | awk -F '\t' '
      tolower($0) ~ /jabra/ {
        if (match($1, /[0-9]+/)) {
          print substr($1, RSTART, RLENGTH)
          exit
        }
      }
    ')"
    JABRA_SOURCE_ID="$(wpctl list audio sources 2>/dev/null | awk -F '\t' '
      tolower($0) ~ /jabra/ {
        if (match($1, /[0-9]+/)) {
          print substr($1, RSTART, RLENGTH)
          exit
        }
      }
    ')"

    if [ -n "$JABRA_SINK_ID" ] && [ -n "$JABRA_SOURCE_ID" ]; then
      if wpctl set-default "$JABRA_SINK_ID" && wpctl set-default "$JABRA_SOURCE_ID"; then
        echo "Selected Jabra USB audio: sink=$JABRA_SINK_ID source=$JABRA_SOURCE_ID"
        JABRA_SELECTED=1
        break
      fi
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  if [ "$JABRA_SELECTED" -ne 1 ]; then
    echo "Jabra USB audio was not found; Chromium will use the system defaults."
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
