#!/bin/bash
set -Eeuo pipefail

LOG_FILE=/var/log/crumbs-firstboot.log
mkdir -p "$(dirname "$LOG_FILE")"
exec >> "$LOG_FILE" 2>&1
echo "$(date -Is) Starting Crumbs first-boot installation"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run first-boot.sh as root."
  exit 1
fi

if [ "$(dpkg --print-architecture)" != "arm64" ]; then
  echo "Crumbs requires 64-bit Raspberry Pi OS (arm64)."
  exit 1
fi

STAGED_ENV=/boot/firmware/crumbs.env
if [ ! -s "$STAGED_ENV" ]; then
  echo "Missing $STAGED_ENV. Run prepare-card.sh on the SD card first."
  exit 1
fi

for name in OPENAI_API_KEY ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID; do
  if ! grep -Eq "^[[:space:]]*${name}[[:space:]]*=[[:space:]]*[^#[:space:]]" "$STAGED_ENV"; then
    echo "The staged environment file is missing a non-empty $name value."
    exit 1
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get full-upgrade -y
apt-get install -y ca-certificates curl git xz-utils chromium

# Node.js 24 LTS Linux ARM64 distribution.
NODE_VERSION=v24.21.0
NODE_ARCHIVE="node-${NODE_VERSION}-linux-arm64.tar.xz"
curl -fsSLo "/tmp/${NODE_ARCHIVE}" "https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}"
curl -fsSLo /tmp/node-shasums.txt "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
grep " ${NODE_ARCHIVE}$" /tmp/node-shasums.txt | (cd /tmp && sha256sum --check --status)
echo "Verified Node.js ${NODE_VERSION} download checksum"
tar -xJf "/tmp/${NODE_ARCHIVE}" -C /usr/local --strip-components=1
rm -f "/tmp/${NODE_ARCHIVE}" /tmp/node-shasums.txt
/usr/local/bin/node --version
/usr/local/bin/npm --version

if ! getent group crumbs >/dev/null; then
  groupadd --system crumbs
fi
if ! id crumbs >/dev/null 2>&1; then
  useradd --system --no-create-home --gid crumbs --home-dir /opt/crumbs --shell /usr/sbin/nologin crumbs
fi

REPO_URL=https://github.com/FS-Santi/Crumbs.git
REPO_BRANCH=Main
if [ -d /opt/crumbs/.git ]; then
  echo "Found an earlier Crumbs checkout; reusing it for recovery."
elif [ -e /opt/crumbs ]; then
  echo "/opt/crumbs exists but is not a Git checkout; refusing to overwrite it."
  exit 1
else
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" /opt/crumbs
fi

cd /opt/crumbs
/usr/local/bin/npm ci --omit=dev
chown -R root:crumbs /opt/crumbs

install -d -o root -g crumbs -m 0750 /etc/crumbs
install -o root -g crumbs -m 0640 "$STAGED_ENV" /etc/crumbs/crumbs.env

cat > /etc/systemd/system/crumbs.service <<'CRUMBS_SERVICE'
[Unit]
Description=Crumbs voice assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=crumbs
Group=crumbs
WorkingDirectory=/opt/crumbs
EnvironmentFile=/etc/crumbs/crumbs.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=LD_LIBRARY_PATH=/opt/crumbs/node_modules/sherpa-onnx-linux-arm64
ExecStart=/usr/local/bin/node /opt/crumbs/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
CRUMBS_SERVICE

install -d -m 0755 /opt/crumbs/deploy/raspberry-pi
cat > /opt/crumbs/deploy/raspberry-pi/crumbs-kiosk.sh <<'CRUMBS_KIOSK'
#!/bin/sh
set -eu
APP_URL=http://127.0.0.1:3000
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROMIUM" ]; then
  echo "Chromium is not installed." >&2
  exit 1
fi
attempt=0
until curl -fsS "$APP_URL/healthz" >/dev/null; do
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
CRUMBS_KIOSK
chmod 0755 /opt/crumbs/deploy/raspberry-pi/crumbs-kiosk.sh

DESKTOP_ENTRY="$(getent passwd 1000 || true)"
if [ -z "$DESKTOP_ENTRY" ]; then
  echo "Could not find the desktop user (UID 1000). Create the user in Imager."
  exit 1
fi
DESKTOP_USER="$(printf '%s' "$DESKTOP_ENTRY" | cut -d: -f1)"
DESKTOP_HOME="$(printf '%s' "$DESKTOP_ENTRY" | cut -d: -f6)"
if [ -z "$DESKTOP_USER" ] || [ -z "$DESKTOP_HOME" ]; then
  echo "Could not determine the desktop user's account details."
  exit 1
fi

WIREPLUMBER_CONFIG_DIR="$DESKTOP_HOME/.config/wireplumber/wireplumber.conf.d"
install -d -o "$DESKTOP_USER" -g "$DESKTOP_USER" -m 0755 "$WIREPLUMBER_CONFIG_DIR"
cat > "$WIREPLUMBER_CONFIG_DIR/51-jabra.conf" <<'WIREPLUMBER_RULE'
monitor.alsa.rules = [
  {
    matches = [
      {
        node.name = "~alsa_input.usb-0b0e_Jabra_SPEAK_410_.*"
      }
    ]
    actions = {
      update-props = {
        session.suspend-timeout-seconds = 0
        priority.session = 3000
      }
    }
  }
]
WIREPLUMBER_RULE
chown "$DESKTOP_USER:$DESKTOP_USER" "$WIREPLUMBER_CONFIG_DIR/51-jabra.conf"
chmod 0644 "$WIREPLUMBER_CONFIG_DIR/51-jabra.conf"

if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_boot_behaviour B4
else
  echo "raspi-config is missing; cannot configure desktop auto-login."
  exit 1
fi

install -d -o "$DESKTOP_USER" -g "$DESKTOP_USER" -m 0755 "$DESKTOP_HOME/.config/labwc"
AUTOSTART="$DESKTOP_HOME/.config/labwc/autostart"
touch "$AUTOSTART"
if ! grep -Fq '/opt/crumbs/deploy/raspberry-pi/crumbs-kiosk.sh' "$AUTOSTART"; then
  printf '%s\n' '/opt/crumbs/deploy/raspberry-pi/crumbs-kiosk.sh >> /tmp/crumbs-kiosk.log 2>&1 &' >> "$AUTOSTART"
fi
chown "$DESKTOP_USER:$DESKTOP_USER" "$AUTOSTART"

systemctl daemon-reload
systemctl enable --now crumbs.service
rm -f "$STAGED_ENV"
echo "$(date -Is) Crumbs installation completed successfully"
