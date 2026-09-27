#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /Volumes/bootfs" >&2
  echo "Pass the mounted boot partition of the Raspberry Pi SD card." >&2
  exit 2
fi

BOOTFS="$1"
USER_DATA="$BOOTFS/user-data"
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
SETUP_ENV="$BOOTFS/crumbs.env"

if [ ! -d "$BOOTFS" ] || [ ! -f "$USER_DATA" ]; then
  echo "Couldn't find user-data at: $USER_DATA" >&2
  echo "Use Raspberry Pi Imager 2.x with a Raspberry Pi OS Trixie image, then pass its boot partition." >&2
  exit 1
fi

if ! grep -q '^#cloud-config' "$USER_DATA"; then
  echo "The SD card user-data file is not a cloud-init file from Raspberry Pi Imager 2.x." >&2
  exit 1
fi

if grep -Eq '^power_state:' "$USER_DATA"; then
  echo "The Imager user-data already has a power_state section." >&2
  echo "To avoid changing its reboot or shutdown behavior, prepare this card manually." >&2
  exit 1
fi

if [ -f "$PROJECT_DIR/.env" ] && \
  grep -Eq '^[[:space:]]*OPENAI_API_KEY[[:space:]]*=[[:space:]]*[^#[:space:]]' "$PROJECT_DIR/.env" && \
  grep -Eq '^[[:space:]]*ELEVENLABS_API_KEY[[:space:]]*=[[:space:]]*[^#[:space:]]' "$PROJECT_DIR/.env" && \
  grep -Eq '^[[:space:]]*ELEVENLABS_VOICE_ID[[:space:]]*=[[:space:]]*[^#[:space:]]' "$PROJECT_DIR/.env"; then
  cp "$PROJECT_DIR/.env" "$SETUP_ENV"
  echo "Copied API settings from this project's .env to the SD card."
else
  echo "Enter the API settings for Crumbs. They will be copied to the SD card for first boot."
  read -r -s -p "OpenAI API key: " OPENAI_API_KEY
  printf '\n'
  read -r -s -p "ElevenLabs API key: " ELEVENLABS_API_KEY
  printf '\n'
  read -r -p "ElevenLabs voice ID: " ELEVENLABS_VOICE_ID
  printf '\n'

  if [ -z "$OPENAI_API_KEY" ] || [ -z "$ELEVENLABS_API_KEY" ] || [ -z "$ELEVENLABS_VOICE_ID" ]; then
    echo "All three values are required." >&2
    exit 1
  fi

  umask 077
  {
    printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY"
    printf 'ELEVENLABS_API_KEY=%s\n' "$ELEVENLABS_API_KEY"
    printf 'ELEVENLABS_VOICE_ID=%s\n' "$ELEVENLABS_VOICE_ID"
    printf 'HOST=127.0.0.1\nPORT=3000\n'
  } > "$SETUP_ENV"
fi

for name in OPENAI_API_KEY ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID; do
  if ! grep -Eq "^[[:space:]]*${name}[[:space:]]*=[[:space:]]*[^#[:space:]]" "$SETUP_ENV"; then
    echo "The .env file is missing a non-empty $name value." >&2
    rm -f "$SETUP_ENV"
    exit 1
  fi
done

cp "$SCRIPT_DIR/first-boot.sh" "$BOOTFS/crumbs-firstboot.sh"

USER_DATA_TMP="$BOOTFS/user-data.crumbs-tmp"
BOOT_COMMAND='  - [bash, /boot/firmware/crumbs-firstboot.sh]'
if grep -Fq '/boot/firmware/crumbs-firstboot.sh' "$USER_DATA"; then
  cat "$USER_DATA" > "$USER_DATA_TMP"
else
  awk -v command="$BOOT_COMMAND" '
    BEGIN { in_runcmd = 0; found_runcmd = 0; inserted = 0 }
    /^runcmd:[[:space:]]*\[\][[:space:]]*$/ {
      print "runcmd:"
      print command
      found_runcmd = 1
      inserted = 1
      next
    }
    /^runcmd:[[:space:]]*$/ {
      in_runcmd = 1
      found_runcmd = 1
      print
      next
    }
    {
      if (in_runcmd && /^[^[:space:]#][^:]*:/) {
        if (!inserted) print command
        inserted = 1
        in_runcmd = 0
      }
      print
    }
    END {
      if (in_runcmd && !inserted) print command
      if (!found_runcmd) {
        print ""
        print "runcmd:"
        print command
      }
    }
  ' "$USER_DATA" > "$USER_DATA_TMP"
fi

cat >> "$USER_DATA_TMP" <<'CLOUD_CONFIG'

power_state:
  mode: reboot
  delay: '+1'
  message: Rebooting into Crumbs kiosk
CLOUD_CONFIG
mv "$USER_DATA_TMP" "$USER_DATA"
sync

echo "Card prepared. Safely eject it, put it in the Pi, and power on."
echo "First boot installs Crumbs and reboots into its kiosk screen."
