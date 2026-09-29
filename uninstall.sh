#!/usr/bin/env bash
# Remove o OpenMHub instalado por install.sh. Com --all remove também a regra udev e as preferências.
# Também fica instalado em ~/.local/share/mhub-linux/uninstall.sh.
exec "$(dirname "$(readlink -f "$0")")/install.sh" --uninstall "$@"
