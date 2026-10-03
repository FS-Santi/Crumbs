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
systemctl restart crumbs.service
echo "Update complete; rebooting into Crumbs."
sleep 2
reboot
