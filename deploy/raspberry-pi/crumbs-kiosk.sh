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

# Let the USB device settle, then reset PipeWire before Chromium opens audio.
# Some Pi boots expose the Jabra only after the first user audio stack restart.
sleep 2
if command -v wpctl >/dev/null 2>&1; then
  JABRA_SELECTED=0
  restart_attempt=1
  while [ "$restart_attempt" -le 3 ]; do
    echo "Starting PipeWire audio recovery attempt $restart_attempt/3."
    if systemctl --user restart pipewire pipewire-pulse wireplumber; then
      echo "PipeWire user audio services restarted."
    else
      echo "PipeWire restart reported an error; checking device availability anyway."
    fi

    attempt=0
    JABRA_FOUND=0
    while [ "$attempt" -lt 10 ]; do
      JABRA_SINK_ID="$(wpctl list audio sinks 2>/dev/null | awk -F '\t' 'tolower($0) ~ /jabra/ { if (match($1, /[0-9]+/)) { print substr($1, RSTART, RLENGTH); exit } }')"
      JABRA_SOURCE_ID="$(wpctl list audio sources 2>/dev/null | awk -F '\t' 'tolower($0) ~ /jabra/ { if (match($1, /[0-9]+/)) { print substr($1, RSTART, RLENGTH); exit } }')"

      if [ -n "$JABRA_SINK_ID" ] && [ -n "$JABRA_SOURCE_ID" ] &&
        wpctl set-default "$JABRA_SINK_ID" && wpctl set-default "$JABRA_SOURCE_ID"; then
        JABRA_FOUND=1
        break
      fi

      attempt=$((attempt + 1))
      sleep 1
    done

    if [ "$JABRA_FOUND" -eq 1 ]; then
      PROBE_FILE="/tmp/crumbs-audio-probe-$$.wav"
      rm -f "$PROBE_FILE"
      echo "Checking that Jabra capture delivers audio frames."
      timeout --signal=INT --kill-after=2s 2s pw-record --target "$JABRA_SOURCE_ID" "$PROBE_FILE" >/dev/null 2>&1 || true
      CAPTURE_BYTES="$(wc -c < "$PROBE_FILE" 2>/dev/null || echo 0)"
      rm -f "$PROBE_FILE"
      if [ "$CAPTURE_BYTES" -gt 44 ]; then
        echo "Jabra audio ready: sink=$JABRA_SINK_ID source=$JABRA_SOURCE_ID (${CAPTURE_BYTES} capture bytes)."
        JABRA_SELECTED=1
      else
        echo "Jabra node appeared but captured no audio data; restarting PipeWire."
      fi
    fi

    [ "$JABRA_SELECTED" -eq 1 ] && break
    echo "Jabra capture/playback not ready after this PipeWire restart."
    restart_attempt=$((restart_attempt + 1))
  done

  if [ "$JABRA_SELECTED" -ne 1 ]; then
    echo "Jabra audio unavailable after 3 recovery attempts; launching Chromium with current defaults."
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
