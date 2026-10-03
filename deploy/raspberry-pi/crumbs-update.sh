#!/bin/bash
set -Eeuo pipefail

REPO_DIR=/opt/crumbs
REPO_BRANCH=Main

if [ "$(id -u)" -ne 0 ]; then
  exec sudo "$0" "$@"
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Crumbs checkout not found at $REPO_DIR" >&2
  exit 1
fi

echo "Updating Crumbs from origin/$REPO_BRANCH"
git -C "$REPO_DIR" fetch origin "$REPO_BRANCH"
git -C "$REPO_DIR" reset --hard "origin/$REPO_BRANCH"
/usr/local/bin/npm ci --omit=dev --prefix "$REPO_DIR"
DESKTOP_ENTRY="$(getent passwd 1000 || true)"
if [ -z "$DESKTOP_ENTRY" ]; then
  echo "Could not find the desktop user (UID 1000); cannot configure Jabra audio." >&2
  exit 1
fi
DESKTOP_USER="$(printf '%s' "$DESKTOP_ENTRY" | cut -d: -f1)"
DESKTOP_HOME="$(printf '%s' "$DESKTOP_ENTRY" | cut -d: -f6)"
/bin/sh "$REPO_DIR/deploy/raspberry-pi/configure-jabra-audio.sh" "$DESKTOP_USER" "$DESKTOP_HOME"
systemctl restart crumbs.service
echo "Update complete; rebooting into Crumbs."
sleep 2
reboot
