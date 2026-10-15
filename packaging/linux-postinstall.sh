#!/bin/sh
# Runs after the .deb or .rpm package is installed: applies the udev rule to devices already plugged in.
udevadm control --reload 2>/dev/null || true
udevadm trigger --subsystem-match=hidraw 2>/dev/null || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
echo "OpenMHub: reconnect your MCHOSE receiver or cable if the app does not see it."
