#!/usr/bin/env bash
# Gera em dist/:
#   OpenMHub-Installer.run     instalador de arquivo único (cabeçalho sh + tar.gz com app, install.sh e o instalador GTK)
#   openmhub_<versão>_*.deb, openmhub-<versão>-*.rpm  pacotes com o Electron embutido (se houver nfpm)
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

run="$dist/OpenMHub-Installer.run"
cat > "$tmp/header.sh" <<HEADER
#!/bin/sh
# OpenMHub $version: instalador de arquivo único.
#   sh OpenMHub-Installer.run               abre o instalador gráfico (ou pergunta no terminal)
#   sh OpenMHub-Installer.run --terminal    instala pelo terminal
#   sh OpenMHub-Installer.run --yes         instala sem perguntar
#   sh OpenMHub-Installer.run --uninstall   remove (--all remove também a regra udev e as preferências)
#   sh OpenMHub-Installer.run --help        todas as opções (as mesmas do install.sh)
tmp=\$(mktemp -d "\${TMPDIR:-/tmp}/mhub-installer.XXXXXX") || exit 1
trap 'rm -rf "\$tmp"' EXIT
trap 'exit 130' INT TERM
line=\$(awk '/^__MHUB_PAYLOAD__\$/ { print NR + 1; exit }' "\$0")
case "\${LANGUAGE:-\${LC_ALL:-\${LC_MESSAGES:-\${LANG:-}}}}" in pt*) bad="Arquivo do instalador corrompido." ;; *) bad="The installer file is corrupted." ;; esac
tail -n +"\$line" "\$0" | tar -xz -C "\$tmp" || { echo "\$bad" >&2; exit 1; }
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

# ---------- Pacotes .deb e .rpm (com o Electron oficial embutido) ----------
if command -v nfpm >/dev/null 2>&1; then
  # Mesma versão e SHA256 do Electron que o install.sh baixa.
  electron_version="$(sed -n 's/^electron_version=//p' "$root/install.sh")"
  for pair in amd64:x64 arm64:arm64; do
    arch="${pair%%:*}" earch="${pair#*:}"
    esum="$(sed -n "s/.*earch=$earch; esum=\([0-9a-f]*\) .*/\1/p" "$root/install.sh")"
    stage="$tmp/stage-$arch"
    zip="$tmp/electron-$earch.zip"
    mkdir -p "$stage/electron"
    curl -fsSL -o "$zip" "https://github.com/electron/electron/releases/download/v$electron_version/electron-v$electron_version-linux-$earch.zip"
    echo "$esum  $zip" | sha256sum -c --quiet -
    unzip -q "$zip" -d "$stage/electron"
    mv "$stage/electron/chrome-sandbox" "$stage/chrome-sandbox"
    cat > "$stage/mhub-linux" <<'LAUNCHER'
#!/usr/bin/env bash
export MHUB_LAUNCHER=/usr/bin/mhub-linux
exec env -u ELECTRON_RUN_AS_NODE /usr/lib/mhub-linux/electron/electron /usr/lib/mhub-linux/app "$@"
LAUNCHER
    for fmt in deb rpm; do
      # O nfpm não expande variáveis em contents; o envsubst preenche o nfpm.yaml antes.
      VERSION="$version" ARCH="$arch" ROOT="$root" STAGE="$stage" envsubst '$VERSION $ARCH $ROOT $STAGE' \
        < "$root/packaging/nfpm.yaml" > "$stage/nfpm.yaml"
      nfpm package -f "$stage/nfpm.yaml" -p "$fmt" -t "$dist/" >/dev/null
    done
  done
  ls -1 "$dist"/openmhub*.deb "$dist"/openmhub*.rpm | sed 's/^/==> /'
else
  echo "==> nfpm não encontrado: pacotes .deb e .rpm não gerados"
fi

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
