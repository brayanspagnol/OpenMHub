# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, a minor release (0.x.0) may change behaviour or settings formats.

## [Unreleased]

## [0.3.1] - 2026-09-29

### Added

- Spanish and French interface. The Language setting, tray, notifications, installer and desktop entries support all four languages.

## [0.3.0] - 2026-09-29

### Added

- Complete English interface, with a Language setting (Automatic, English, Português (Brasil)). The tray, notifications and installer follow the same language.

## [0.2.0] - 2026-09-29

### Changed

- Renamed to OpenMHub, with a new icon and titlebar that no longer use the MCHOSE logo, and a clearer "unofficial" note in Settings > Sobre. The launcher, preferences folder and window class stay `mhub-linux`.
- Product pictures are no longer bundled: they are downloaded from MCHOSE's CDN when first shown and cached in `~/.config/mhub-linux/device-images`. Offline, the generic icon is shown.

### Added

- Flatpak support: the app detects the sandbox, hides "Iniciar com o sistema" and shows the udev command to run on the host when no device is found.

## [0.1.0] - 2026-09-29

First public release.

### Added

- Home screen with one card per device: official product picture, colour variant, battery level, charging state and connection mode (wired or 2.4G), sleeping and offline states, in grid or list view.
- Device catalog with the official pictures and colours of 86 MCHOSE mice, keyboards and headsets, matched by HID product name or USB ID the same way M HUB does it, and `tools/fetch-device-assets.py` to rebuild it.
- MCHOSE G3 V2 mouse, wired and over its 2.4G receiver: button remapping, DPI stages, polling rate, debounce, LOD, sleep timer, Motion Sync, angle snapping, ripple control, scroll direction, macros and factory reset.
- MCHOSE UT98 / G98 V2 keyboard over its 2.4G dongle: lighting effects and per-key colour, key remapping on the normal, Fn and Fn2 layers, macros, sleep timer, Top Speed, Mac mode, Win lock and factory reset. Wired mode is implemented but not yet tested on hardware.
- Up to 6 local profiles per device, with JSON export and import.
- Keyboard and mouse test tools.
- Tray icon, low-battery and full-charge notifications, DPI and lock-key notifications, start with the system.
- Graphical installer (`MHUB-Linux-Installer.run`), Arch package, and a udev rule so the app runs without root.

[Unreleased]: https://github.com/brayanspagnol/OpenMHub/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/brayanspagnol/OpenMHub/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/brayanspagnol/OpenMHub/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/brayanspagnol/OpenMHub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/brayanspagnol/OpenMHub/releases/tag/v0.1.0
