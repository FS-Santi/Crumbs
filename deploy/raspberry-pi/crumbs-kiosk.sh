#!/bin/sh
set -eu

APP_URL="${CRUMBS_URL:-http://127.0.0.1:3000}"
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
AUDIO_MAX_WAIT_SECONDS="${CRUMBS_AUDIO_MAX_WAIT_SECONDS:-90}"
AUDIO_STABLE_POLLS="${CRUMBS_AUDIO_STABLE_POLLS:-5}"
AUDIO_SETTLE_SECONDS="${CRUMBS_AUDIO_SETTLE_SECONDS:-15}"

echo "=== Crumbs kiosk audio startup ==="
if [ -r /etc/os-release ]; then
  . /etc/os-release
  echo "OS: ${PRETTY_NAME:-unknown}"
fi
echo "Kernel: $(uname -r)"
if command -v dpkg-query >/dev/null 2>&1; then
  echo "Audio package versions:"
  dpkg-query -W -f='${binary:Package} ${Version}\n' pipewire pipewire-bin pipewire-pulse wireplumber 2>/dev/null || true
fi

find_jabra_node_id() {
  STATUS_TEXT="$1"
  TARGET_SECTION="$2"

  printf '%s\n' "$STATUS_TEXT" | awk -v target="$TARGET_SECTION" '
    /Sinks:/ { section = "sink"; next }
    /Sources:/ { section = "source"; next }
    /Filters:/ { section = ""; next }
    section == target && tolower($0) ~ /jabra.*speak[_ ]410/ {
      if (match($0, /[0-9]+\./)) {
        print substr($0, RSTART, RLENGTH - 1)
        exit
      }
    }
  '
}

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
# Wait until both nodes stay available across multiple checks, set them as
# defaults, then give the PipeWire graph time to settle before Chromium opens
# its microphone stream. On the Pi, nodes can appear before capture is ready.
if command -v wpctl >/dev/null 2>&1; then
  JABRA_SELECTED=0
  attempt=0
  stable_polls=0
  previous_sink=""
  previous_source=""
  while [ "$attempt" -lt "$AUDIO_MAX_WAIT_SECONDS" ]; do
    if AUDIO_STATUS="$(wpctl status -n 2>&1)"; then
      JABRA_SINK_ID="$(find_jabra_node_id "$AUDIO_STATUS" sink)"
      JABRA_SOURCE_ID="$(find_jabra_node_id "$AUDIO_STATUS" source)"
    else
      JABRA_SINK_ID=""
      JABRA_SOURCE_ID=""
      if [ "$attempt" -eq 0 ]; then
        echo "wpctl status could not connect to the PipeWire session: $AUDIO_STATUS"
      fi
    fi

    if [ -n "$JABRA_SINK_ID" ] && [ -n "$JABRA_SOURCE_ID" ]; then
      if [ "$JABRA_SINK_ID" = "$previous_sink" ] && [ "$JABRA_SOURCE_ID" = "$previous_source" ]; then
        stable_polls=$((stable_polls + 1))
      else
        stable_polls=1
        previous_sink="$JABRA_SINK_ID"
        previous_source="$JABRA_SOURCE_ID"
        echo "Jabra nodes detected; waiting for stable PipeWire startup."
      fi

      if [ "$stable_polls" -ge "$AUDIO_STABLE_POLLS" ] &&
        wpctl set-default "$JABRA_SINK_ID" && wpctl set-default "$JABRA_SOURCE_ID"; then
        echo "Jabra SPEAK 410 selected: sink=$JABRA_SINK_ID source=$JABRA_SOURCE_ID"
        echo "Allowing ${AUDIO_SETTLE_SECONDS}s for PipeWire and USB audio to settle before Chromium starts."
        sleep "$AUDIO_SETTLE_SECONDS"

        if AUDIO_STATUS="$(wpctl status -n 2>&1)"; then
          settled_sink="$(find_jabra_node_id "$AUDIO_STATUS" sink)"
          settled_source="$(find_jabra_node_id "$AUDIO_STATUS" source)"
        else
          settled_sink=""
          settled_source=""
        fi

        if [ "$settled_sink" = "$JABRA_SINK_ID" ] && [ "$settled_source" = "$JABRA_SOURCE_ID" ] &&
          wpctl set-default "$settled_sink" && wpctl set-default "$settled_source"; then
          echo "Jabra audio remained stable through settling period; launching Chromium."
          echo "PipeWire audio topology at Chromium launch:"
          printf '%s\n' "$AUDIO_STATUS" | sed -n '/^Audio$/,/^Video$/p'
          JABRA_SELECTED=1
          break
        fi

        echo "Jabra audio changed during settling; waiting for it to stabilize again."
        stable_polls=0
        previous_sink=""
        previous_source=""
      fi
    else
      stable_polls=0
      previous_sink=""
      previous_source=""
    fi

    attempt=$((attempt + 2))
    sleep 2
  done

  if [ "$JABRA_SELECTED" -ne 1 ]; then
    echo "Jabra audio did not stabilize within ${AUDIO_MAX_WAIT_SECONDS}s; launching Crumbs with current defaults."
    if [ -n "${AUDIO_STATUS:-}" ]; then
      echo "Last WirePlumber audio topology:"
      printf '%s\n' "$AUDIO_STATUS" | sed -n '/^Audio$/,/^Video$/p'
    fi
  fi
else
  echo "wpctl is unavailable; Chromium will use the system defaults."
fi

CHROMIUM_PROFILE="$HOME/.config/chromium-crumbs"

"$CHROMIUM" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --user-data-dir="$CHROMIUM_PROFILE" \
  "$APP_URL" &
PRIMING_CHROMIUM_PID=$!

# Let the page request microphone access before the PipeWire recovery. If the
# Chromium link never appears, still perform the recovery and reopen the kiosk.
if command -v pw-link >/dev/null 2>&1; then
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if pw-link -l 2>/dev/null | awk '
      tolower($0) ~ /^alsa_input.*jabra.*capture_/ { source = 1; next }
      source && tolower($0) ~ /chromium input:input_/ { found = 1 }
      END { exit !found }
    '; then
      echo "Jabra capture is connected to Chromium."
      break
    fi
    if ! kill -0 "$PRIMING_CHROMIUM_PID" 2>/dev/null; then
      echo "The initial Chromium process exited before audio recovery." >&2
      wait "$PRIMING_CHROMIUM_PID" || true
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
fi

if command -v systemctl >/dev/null 2>&1 &&
  systemctl --user restart pipewire pipewire-pulse wireplumber; then
  echo "PipeWire user services restarted after Chromium startup."

  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if AUDIO_STATUS="$(wpctl status -n 2>/dev/null)"; then
      JABRA_SINK_ID="$(find_jabra_node_id "$AUDIO_STATUS" sink)"
      JABRA_SOURCE_ID="$(find_jabra_node_id "$AUDIO_STATUS" source)"
      if [ -n "$JABRA_SINK_ID" ] && [ -n "$JABRA_SOURCE_ID" ]; then
        wpctl set-default "$JABRA_SINK_ID" || true
        wpctl set-default "$JABRA_SOURCE_ID" || true
        echo "Restored Jabra defaults after PipeWire restart: sink=$JABRA_SINK_ID source=$JABRA_SOURCE_ID"
        break
      fi
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  # The first Chromium microphone stream belongs to the pre-restart audio
  # graph. Replace it so the page opens a fresh capture stream.
  pkill -u "$(id -u)" -f -- "$CHROMIUM_PROFILE" 2>/dev/null || true
  wait "$PRIMING_CHROMIUM_PID" 2>/dev/null || true
  exec "$CHROMIUM" \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --no-first-run \
    --autoplay-policy=no-user-gesture-required \
    --use-fake-ui-for-media-stream \
    --user-data-dir="$CHROMIUM_PROFILE" \
    "$APP_URL"
else
  echo "PipeWire restart failed; keeping the initial Chromium session." >&2
  wait "$PRIMING_CHROMIUM_PID"
fi
