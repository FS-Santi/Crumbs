#!/bin/sh
set -eu

APP_URL="${CRUMBS_URL:-http://127.0.0.1:3000}"
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"

echo "=== Crumbs kiosk audio startup ==="
if [ -r /etc/os-release ]; then
  . /etc/os-release
  echo "OS: ${PRETTY_NAME:-unknown}"
fi
echo "Kernel: $(uname -r)"
for AUDIO_COMMAND in pipewire wireplumber; do
  if command -v "$AUDIO_COMMAND" >/dev/null 2>&1; then
    AUDIO_VERSION="$("$AUDIO_COMMAND" --version 2>&1 | sed -n '1p')"
    echo "$AUDIO_COMMAND: $AUDIO_VERSION"
  fi
done

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
# Trixie's WirePlumber 0.5.8 has `wpctl status`, but not the newer `wpctl list`
# subcommand. Parse status output so this works on the installed OS version.
if command -v wpctl >/dev/null 2>&1; then
  if AUDIO_STATUS="$(wpctl status -n 2>&1)"; then
    echo "PipeWire audio topology before device selection:"
    printf '%s\n' "$AUDIO_STATUS" | sed -n '/^Audio$/,/^Video$/p'
  else
    echo "wpctl status failed: $AUDIO_STATUS"
  fi

  JABRA_SELECTED=0
  attempt=0
  while [ "$attempt" -lt 20 ]; do
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
    echo "Jabra SPEAK 410 sink/source were not found in wpctl status; launching with current defaults."
    if [ -n "${AUDIO_STATUS:-}" ]; then
      echo "Last WirePlumber audio topology:"
      printf '%s\n' "$AUDIO_STATUS" | sed -n '/^Audio$/,/^Video$/p'
    fi
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
