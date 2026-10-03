# Crumbs: mostly hands-off Pi setup

Flash the SD card, run one setup command on your Mac, then power on the Pi. Its first boot installs the system packages and Node.js, clones Crumbs from GitHub, installs the Linux ARM64 npm dependencies, configures the backend service and Chromium kiosk, and reboots into the face.

## You need

- Raspberry Pi 4 and microSD card
- Display, microphone, and speaker
- Wi-Fi details
- OpenAI API key and ElevenLabs API key and voice ID
- Raspberry Pi Imager 2.x

The installer pulls `https://github.com/FS-Santi/Crumbs.git`, branch `Main`, over public HTTPS. The Pi needs internet access during first boot.

## 1. Flash Raspberry Pi OS

In Raspberry Pi Imager 2.x:

1. Select **Raspberry Pi OS (64-bit) with Desktop**.
2. In OS customisation, set the hostname to `crumbs`, create your desktop user, configure Wi-Fi and locale, and enable SSH.
3. Write the card and wait for verification.

The first-boot setup switches the Pi to Desktop Auto Login and adds Crumbs to the labwc desktop autostart. Current Raspberry Pi OS Trixie images use cloud-init; Raspberry Pi Imager 2.x supports this format. Imager 1.x does not correctly customise the current Trixie images. [Raspberry Pi cloud-init guide](https://www.raspberrypi.com/news/cloud-init-on-raspberry-pi-os/), [Imager compatibility notes](https://github.com/raspberrypi/rpi-imager/blob/main/doc/os_customisation_formats.md)

## 2. Prepare the SD card

Reinsert the card in your Mac. In Terminal, find its boot volume:

```sh
ls /Volumes
```

Run the setup helper from this project, replacing `bootfs` with the volume name shown on your Mac if it differs:

```sh
./deploy/raspberry-pi/prepare-card.sh /Volumes/bootfs
```

The helper copies API settings from this project's `.env` if it has all three required values. Otherwise it asks for them without echoing the API keys on screen. It copies the first-boot installer to the SD card and adds its command to Imager's existing `runcmd` list, preserving commands such as Imager's SSH setup. It stops safely if that file already has a `power_state` section.

Safely eject the card after the helper says it is prepared.

## 3. Boot Crumbs

Put the card in the Pi, connect the display and audio devices, and power it on. First boot may take several minutes while it upgrades Raspberry Pi OS and installs Node.js and npm dependencies. It then reboots into Chromium kiosk mode. Touch the screen for Crumbs' face settings.

The kiosk enables audio autoplay and automatically grants the browser microphone permission, which is needed for hands-free startup.

On startup, the kiosk log records the OS, kernel, PipeWire and WirePlumber versions, then selects the Jabra sink and source by parsing `wpctl status -n`. This uses the `wpctl` command available in Raspberry Pi OS Trixie; `wpctl list` is not available in its WirePlumber 0.5.8 package. The audio rule is installed in the configuration format supported by the detected WirePlumber version.

## If startup fails

Connect a keyboard or SSH in using the account you created in Imager. Check the first-boot log:

```sh
sudo tail -n 100 /var/log/crumbs-firstboot.log
```

Check the backend service:

```sh
sudo systemctl status crumbs.service
sudo journalctl -u crumbs.service -b
curl http://127.0.0.1:3000/healthz
```

The health response should include `"wakeWordEnabled":true`. The installer keeps the staged API settings on the boot volume if setup fails, so you can retry with:

```sh
sudo bash /boot/firmware/crumbs-firstboot.sh
```

For Jabra audio startup details, inspect the most recent kiosk log:

```sh
tail -n 120 /tmp/crumbs-kiosk.log
```

The log includes PipeWire's audio topology before Chromium opens, so it shows whether the Jabra source and sink were visible and selected.

After a successful install, the staged `crumbs.env` is removed from the boot volume and the credentials live in `/etc/crumbs/crumbs.env`, readable only by root and the Crumbs service group.

## Important deployment detail

The first-boot installer deploys the latest code from GitHub branch `Main`. Push the code you want the Pi to run to `FS-Santi/Crumbs` branch `Main` before preparing the card. The repository must be publicly readable by the Pi.

The finished enclosure, microphone and speaker, Pi RAM size, cooling, and power supply still need a hands-on check on the actual toaster.
