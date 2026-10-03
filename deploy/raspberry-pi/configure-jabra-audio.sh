#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 DESKTOP_USER DESKTOP_HOME" >&2
  exit 2
fi

DESKTOP_USER="$1"
DESKTOP_HOME="$2"
WP_VERSION="$(wireplumber --version 2>&1 | grep -Eo '0\.[0-9]+' | head -n 1 || true)"

if [ "$WP_VERSION" = "0.4" ]; then
  CONFIG_DIR="$DESKTOP_HOME/.config/wireplumber/main.lua.d"
  CONFIG_FILE="$CONFIG_DIR/51-crumbs-jabra.lua"
  install -d -o "$DESKTOP_USER" -g "$DESKTOP_USER" -m 0755 "$CONFIG_DIR"
  cat > "$CONFIG_FILE" <<'CRUMBS_JABRA_LUA'
local rule = {
  matches = {
    {
      { "node.name", "matches", "alsa_input.usb-0b0e_Jabra_SPEAK_410_.*" },
    },
    {
      { "node.name", "matches", "alsa_output.usb-0b0e_Jabra_SPEAK_410_.*" },
    },
  },
  apply_properties = {
    ["api.alsa.headroom"] = 1024,
    ["session.suspend-timeout-seconds"] = 0,
    ["priority.session"] = 3000,
  },
}

table.insert(alsa_monitor.rules, rule)
CRUMBS_JABRA_LUA
  chown "$DESKTOP_USER:$DESKTOP_USER" "$CONFIG_FILE"
  rm -f "$DESKTOP_HOME/.config/wireplumber/wireplumber.conf.d/51-crumbs-jabra.conf"
else
  CONFIG_DIR="$DESKTOP_HOME/.config/wireplumber/wireplumber.conf.d"
  CONFIG_FILE="$CONFIG_DIR/51-crumbs-jabra.conf"
  install -d -o "$DESKTOP_USER" -g "$DESKTOP_USER" -m 0755 "$CONFIG_DIR"
  cat > "$CONFIG_FILE" <<'CRUMBS_JABRA_CONF'
monitor.alsa.rules = [
  {
    matches = [
      { node.name = "~alsa_input.usb-0b0e_Jabra_SPEAK_410_.*" }
    ]
    actions = {
      update-props = {
        api.alsa.headroom = 1024
        session.suspend-timeout-seconds = 0
        priority.session = 3000
      }
    }
  }
  {
    matches = [
      { node.name = "~alsa_output.usb-0b0e_Jabra_SPEAK_410_.*" }
    ]
    actions = {
      update-props = {
        api.alsa.headroom = 1024
        session.suspend-timeout-seconds = 0
        priority.session = 3000
      }
    }
  }
]
CRUMBS_JABRA_CONF
  chown "$DESKTOP_USER:$DESKTOP_USER" "$CONFIG_FILE"
  rm -f "$DESKTOP_HOME/.config/wireplumber/main.lua.d/51-crumbs-jabra.lua"
fi

echo "Installed Jabra SPEAK 410 WirePlumber tuning for WirePlumber ${WP_VERSION:-0.5+}."
