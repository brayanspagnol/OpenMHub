#!/usr/bin/env bash
# Gera em dist/:
#   MHUB-Linux-Installer.run     instalador de arquivo único (cabeçalho sh + tar.gz com app, install.sh e o instalador GTK)
#   mhub-linux-<versão>-*.pkg.*  pacote Arch feito com packaging/PKGBUILD (se houver makepkg)
# Tudo é montado numa pasta temporária; nada é instalado no sistema.
set -euo pipefail

root="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
dist="$root/dist"
version="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$root/app/package.json" | head -n1)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/mhub-build.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$dist"

echo "==> OpenMHub $version"
bash -n "$root/install.sh"

# ---------- Instalador .run ----------
payload="$tmp/payload"
mkdir -p "$payload/packaging" "$payload/udev"
cp -r "$root/app" "$payload/app"
install -m755 "$root/install.sh" "$root/uninstall.sh" "$payload/"
install -m755 "$root/packaging/askpass.py" "$root/packaging/installer.py" "$payload/packaging/"
install -m644 "$root/packaging/mhub-linux.desktop" "$payload/packaging/"
install -m644 "$root/udev/70-mhub-linux.rules" "$payload/udev/"
find "$payload" -name '__pycache__' -prune -exec rm -rf {} +

run="$dist/MHUB-Linux-Installer.run"
cat > "$tmp/header.sh" <<HEADER
#!/bin/sh
# OpenMHub $version: instalador de arquivo único.
#   sh MHUB-Linux-Installer.run               abre o instalador gráfico (ou pergunta no terminal)
#   sh MHUB-Linux-Installer.run --terminal    instala pelo terminal
#   sh MHUB-Linux-Installer.run --yes         instala sem perguntar
#   sh MHUB-Linux-Installer.run --uninstall   remove (--all remove também a regra udev e as preferências)
#   sh MHUB-Linux-Installer.run --help        todas as opções (as mesmas do install.sh)
tmp=\$(mktemp -d "\${TMPDIR:-/tmp}/mhub-installer.XXXXXX") || exit 1
trap 'rm -rf "\$tmp"' EXIT
trap 'exit 130' INT TERM
line=\$(awk '/^__MHUB_PAYLOAD__\$/ { print NR + 1; exit }' "\$0")
tail -n +"\$line" "\$0" | tar -xz -C "\$tmp" || { echo "Arquivo do instalador corrompido." >&2; exit 1; }
[ \$# -eq 0 ] && set -- --gui
bash "\$tmp/install.sh" "\$@"
exit \$?
__MHUB_PAYLOAD__
HEADER
{
  cat "$tmp/header.sh"
  tar -C "$payload" --owner=0 --group=0 --numeric-owner -cz .
} > "$run"
chmod 755 "$run"
echo "==> $run ($(du -h "$run" | cut -f1))"

# ---------- Pacote Arch ----------
if command -v makepkg >/dev/null 2>&1; then
  mkdir -p "$tmp/pkg"
  cp "$root/packaging/PKGBUILD" "$tmp/pkg/"
  (
    cd "$tmp/pkg"
    MHUB_ROOT="$root" PKGDEST="$dist" BUILDDIR="$tmp/build" SRCDEST="$tmp/src" SRCPKGDEST="$tmp/srcpkg" \
      makepkg --force --nodeps --noconfirm >"$tmp/makepkg.log" 2>&1
  ) || { cat "$tmp/makepkg.log" >&2; echo "makepkg falhou" >&2; exit 1; }
  ls -1 "$dist"/mhub-linux-"${version//-/_}"-*.pkg.tar.* 2>/dev/null | sed 's/^/==> /'
else
  echo "==> makepkg não encontrado: pacote Arch não gerado"
fi
