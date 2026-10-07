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

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

wait_for_jabra_source() {
  attempt=0
  until wpctl status 2>/dev/null | grep -Fq 'Jabra SPEAK 410 Mono'; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      return 1
    fi
    sleep 1
  done
}

echo "Waiting for Jabra SPEAK 410 capture source."
if ! wait_for_jabra_source; then
  echo "Jabra SPEAK 410 capture source did not appear within 30 seconds." >&2
  exit 1
fi

sleep 5
echo "Restarting PipeWire after Jabra enumeration."
systemctl --user restart pipewire pipewire-pulse wireplumber
sleep 3

echo "Waiting for Jabra SPEAK 410 capture source after PipeWire restart."
if ! wait_for_jabra_source; then
  echo "Jabra SPEAK 410 capture source did not return within 30 seconds." >&2
  exit 1
fi

wpctl set-volume @DEFAULT_SOURCE@ 100%
wpctl set-mute @DEFAULT_SOURCE@ 0
rm -rf "$HOME/.config/chromium-crumbs"

exec "$CHROMIUM" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-cache \
  --no-first-run \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --user-data-dir="$HOME/.config/chromium-crumbs" \
  "$APP_URL"
