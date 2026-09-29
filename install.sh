#!/usr/bin/env bash
# Instala ou remove o OpenMHub para o usuário atual (sem npm, sem root).
# Só o electron42 (pacman) e a regra udev precisam de root; os dois são pulados se já estiverem instalados.
#
# Uso: install.sh [opções]
#   (sem opções)      instala no terminal, como antes
#   --gui             abre o instalador gráfico (GTK4); sem tela, cai no modo terminal interativo
#   --terminal        modo terminal interativo (pergunta instalar/desinstalar e início automático)
#   --yes             não pergunta nada
#   --autostart       liga "Iniciar com o sistema"      --no-autostart  desliga
#   --uninstall       remove o app (mantém a regra udev e as preferências)
#   --all             com --uninstall: remove também a regra udev e as preferências
#   --status          mostra se está instalado (chave=valor)
#   --machine         saída em linhas "@@step <id> <estado> <texto>" para o instalador gráfico
#   --gui --auto [--shot arquivo.png]   testes: o instalador gráfico instala sozinho, grava a captura e sai
set -euo pipefail

src="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
config="${XDG_CONFIG_HOME:-$HOME/.config}"
dest="$data/mhub-linux"
bin="$HOME/.local/bin"
launcher="$bin/mhub-linux"
rule=/etc/udev/rules.d/70-mhub-linux.rules
askpass="$src/packaging/askpass.py"

# Mensagens no idioma do sistema: L <português> <inglês> <espanhol> <francês> (sem tradução: inglês).
lang="${LANGUAGE:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}"
case "${lang%%:*}" in pt*) li=1 ;; es*) li=3 ;; fr*) li=4 ;; *) li=2 ;; esac
L() { printf '%s' "${!li:-$2}"; }

action=install; ui=plain; yes=0; autostart=""; all=0; machine=0
args=("$@")
while [ $# -gt 0 ]; do
  arg="$1"; shift
  case "$arg" in
    --auto) ;;                     # repassado ao instalador gráfico (testes)
    --shot) shift ;;               # idem, com o arquivo da captura
    --gui) ui=gui ;;
    --terminal) ui=terminal ;;
    --yes|-y) yes=1 ;;
    --autostart) autostart=on ;;
    --no-autostart) autostart=off ;;
    --uninstall) action=uninstall ;;
    --all) all=1 ;;
    --status) action=status ;;
    --machine) machine=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "$(L 'Opção desconhecida' 'Unknown option' 'Opción desconocida' 'Option inconnue '): $arg" >&2; exit 2 ;;
  esac
done

version_of() { sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$1/package.json" 2>/dev/null | head -n1; }
version="$(version_of "$src/app")"

# step <id> <run|ok|skip|fail> <texto>
step() {
  if [ "$machine" = 1 ]; then echo "@@step $1 $2 $3"; return; fi
  case "$2" in
    run) echo "==> $3" ;;
    fail) echo "!!  $3" >&2 ;;
    *) echo "    $3" ;;
  esac
}

has_gtk() {
  [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ] && command -v python3 >/dev/null 2>&1 &&
    python3 -c "import gi; gi.require_version('Gtk', '4.0'); from gi.repository import Gtk" >/dev/null 2>&1
}

# Roda um comando como root: sudo no terminal, sudo -A com a janela de senha GTK fora dele.
as_root() {
  if [ "$(id -u)" = 0 ]; then sh -c "$1"; return; fi
  command -v sudo >/dev/null 2>&1 || return 1
  if [ "$machine" = 0 ] && [ -t 0 ]; then
    sudo sh -c "$1"
  elif has_gtk; then
    SUDO_ASKPASS="$askpass" MHUB_ASKPASS_REASON="$2" sudo -A sh -c "$1"
  else
    sudo -n sh -c "$1" 2>/dev/null
  fi
}

running_pattern() { echo "electron.*$dest/app"; }

# ---------- Estado ----------
if [ "$action" = status ]; then
  auto=0
  grep -qs '"autostart": *true' "$config/mhub-linux/prefs.json" && auto=1
  if [ -f "$dest/app/package.json" ]; then
    echo "installed=1"
    echo "installed_version=$(version_of "$dest/app")"
  else
    echo "installed=0"
  fi
  echo "version=$version"
  echo "launcher=$launcher"
  echo "dest=$dest"
  echo "autostart=$auto"
  exit 0
fi

# ---------- Modos interativos ----------
if [ "$ui" = gui ]; then
  if has_gtk; then
    exec python3 "$src/packaging/installer.py" "${args[@]}"
  fi
  ui=terminal
  if ! [ -t 0 ]; then
    msg="$(L 'Não foi possível abrir o instalador gráfico: ele precisa de uma sessão gráfica e do python-gobject (GTK 4). Rode num terminal: sh MHUB-Linux-Installer.run --terminal' \
      "Couldn't open the graphical installer: it needs a graphical session and python-gobject (GTK 4). Run it in a terminal: sh MHUB-Linux-Installer.run --terminal" 'No se pudo abrir el instalador gráfico: requiere una sesión gráfica y python-gobject (GTK 4). Ejecútalo en una terminal: sh MHUB-Linux-Installer.run --terminal' 'Impossible d’ouvrir l’installateur graphique : il nécessite une session graphique et python-gobject (GTK 4). Lancez-le dans un terminal : sh MHUB-Linux-Installer.run --terminal')"
    command -v notify-send >/dev/null 2>&1 && notify-send "OpenMHub" "$msg" || true
    echo "$msg" >&2
    exit 1
  fi
fi

ask() { # ask <pergunta> <padrão s|n>
  local reply
  read -r -p "$1 " reply || reply=""
  reply="${reply:-$2}"
  case "$reply" in [sSyYoO]*) return 0 ;; *) return 1 ;; esac
}

if [ "$ui" = terminal ] && [ "$yes" = 0 ]; then
  echo "OpenMHub $version: $(L instalador installer instalador installateur)"
  if [ -f "$dest/app/package.json" ]; then
    echo "$(L 'Instalado: versão' 'Installed: version' 'Instalado: versión' 'Installé : version') $(version_of "$dest/app") $(L em in en dans) $dest"
    echo "  $(L '1) Atualizar/reinstalar   2) Desinstalar   3) Sair' '1) Update/reinstall   2) Uninstall   3) Quit' '1) Actualizar/reinstalar   2) Desinstalar   3) Salir' '1) Mettre à jour/réinstaller   2) Désinstaller   3) Quitter')"
    read -r -p "$(L 'Escolha' 'Choose' 'Opción' 'Choix') [1]: " choice || choice=3
    case "${choice:-1}" in
      1) ;;
      2) action=uninstall; ask "$(L 'Remover também a regra udev e as preferências? [s/N]' 'Also remove the udev rule and preferences? [y/N]' '¿Eliminar también la regla udev y las preferencias? [s/N]' 'Supprimer aussi la règle udev et les préférences ? [o/N]')" n && all=1 ;;
      *) exit 0 ;;
    esac
  else
    ask "$(L "Instalar em $dest? [S/n]" "Install to $dest? [Y/n]" "¿Instalar en $dest? [S/n]" "Installer dans $dest ? [O/n]")" s || exit 0
  fi
  if [ "$action" = install ] && [ -z "$autostart" ]; then
    if ask "$(L 'Iniciar com o sistema (escondido na bandeja)? [s/N]' 'Launch at login (hidden in the tray)? [y/N]' '¿Iniciar con el sistema (oculto en la bandeja)? [s/N]' 'Lancer au démarrage (dans la zone de notification) ? [o/N]')" n; then autostart=on; else autostart=off; fi
  fi
fi

# ---------- Desinstalar ----------
if [ "$action" = uninstall ]; then
  step stop run "$(L 'Fechando o OpenMHub' 'Closing OpenMHub' 'Cerrando OpenMHub' 'Fermeture d’OpenMHub')"
  if pkill -f "$(running_pattern)" 2>/dev/null; then step stop ok "$(L 'App fechado' 'App closed' 'Aplicación cerrada' 'Application fermée')"; else step stop skip "$(L 'Não estava aberto' 'It wasn’t running' 'No estaba abierta' 'Elle n’était pas ouverte')"; fi

  # A regra udev sai antes dos arquivos: a janela de senha (askpass) pode estar dentro de $dest.
  if [ "$all" = 1 ]; then
    rm -rf "$config/mhub-linux"
    if [ -f "$rule" ]; then
      step udev run "$(L 'Removendo a regra udev' 'Removing the udev rule' 'Eliminando la regla udev' 'Suppression de la règle udev')"
      if as_root "rm -f '$rule' && udevadm control --reload" "$(L 'remover a regra udev de /etc/udev/rules.d' 'remove the udev rule from /etc/udev/rules.d' 'eliminar la regla udev de /etc/udev/rules.d' 'supprimer la règle udev de /etc/udev/rules.d')"; then
        step udev ok "$(L 'Regra udev removida' 'udev rule removed' 'Regla udev eliminada' 'Règle udev supprimée')"
      else
        step udev fail "$(L 'Não foi possível remover' "Couldn't remove" 'No se pudo eliminar' 'Impossible de supprimer') $rule"
      fi
    fi
  fi

  step files run "$(L 'Removendo o app, o atalho e os ícones' 'Removing the app, shortcut and icons' 'Eliminando la aplicación, el acceso directo y los iconos' 'Suppression de l’application, du raccourci et des icônes')"
  rm -rf "$dest"
  rm -f "$launcher" "$data/applications/mhub-linux.desktop" \
        "$data/icons/hicolor/256x256/apps/mhub-linux.png" \
        "$data/icons/hicolor/512x512/apps/mhub-linux.png" \
        "$data/icons/hicolor/scalable/apps/mhub-linux.svg"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$data/applications" || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$data/icons/hicolor" 2>/dev/null || true
  step files ok "$(L 'Arquivos removidos' 'Files removed' 'Archivos eliminados' 'Fichiers supprimés')"

  step autostart run "$(L 'Removendo o início automático' 'Removing launch at login' 'Quitando el inicio automático' 'Suppression du lancement au démarrage')"
  rm -f "$config/autostart/mhub-linux.desktop"
  # Linha marcada que o app põe no config do Hyprland (ver applyAutostart em app/main.js).
  for f in "${MHUB_HYPR_CONF:-}" "$config/hypr/hyprland.conf" "$config/hypr/hyprland.lua"; do
    [ -n "$f" ] && [ -f "$f" ] && grep -q 'mhub-linux-autostart$' "$f" && sed -i --follow-symlinks '/mhub-linux-autostart$/d' "$f" || true
  done
  step autostart ok "$(L 'Início automático removido' 'Launch at login removed' 'Inicio automático eliminado' 'Lancement au démarrage supprimé')"

  if [ "$all" = 1 ]; then
    step done ok "$(L 'OpenMHub removido, com preferências e regra udev' 'OpenMHub removed, including preferences and the udev rule' 'OpenMHub eliminado, junto con las preferencias y la regla udev' 'OpenMHub supprimé, avec les préférences et la règle udev')"
  else
    step done ok "$(L 'OpenMHub removido (regra udev e preferências mantidas)' 'OpenMHub removed (udev rule and preferences kept)' 'OpenMHub eliminado (se conservan la regla udev y las preferencias)' 'OpenMHub supprimé (règle udev et préférences conservées)')"
  fi
  exit 0
fi

# ---------- Instalar ----------
if [ "$src" = "$dest" ]; then
  echo "$(L 'Esta é a cópia instalada. Para atualizar, rode o instalador baixado (MHUB-Linux-Installer.run).' \
    'This is the installed copy. To update, run the downloaded installer (MHUB-Linux-Installer.run).' 'Esta es la copia instalada. Para actualizar, ejecuta el instalador descargado (MHUB-Linux-Installer.run).' 'Ceci est la copie installée. Pour mettre à jour, lancez l’installateur téléchargé (MHUB-Linux-Installer.run).')" >&2
  exit 1
fi

step electron run "$(L 'Verificando o Electron' 'Checking Electron' 'Comprobando Electron' 'Vérification d’Electron')"
if command -v electron42 >/dev/null 2>&1; then
  step electron skip "$(L 'electron42 já instalado' 'electron42 already installed' 'electron42 ya está instalado' 'electron42 déjà installé')"
elif command -v pacman >/dev/null 2>&1; then
  step electron run "$(L 'Instalando electron42 com o pacman' 'Installing electron42 with pacman' 'Instalando electron42 con pacman' 'Installation d’electron42 avec pacman')"
  if as_root "pacman -S --needed --noconfirm electron42" "$(L 'instalar o pacote electron42 com o pacman' 'install the electron42 package with pacman' 'instalar el paquete electron42 con pacman' 'installer le paquet electron42 avec pacman')"; then
    step electron ok "$(L 'electron42 instalado' 'electron42 installed' 'electron42 instalado' 'electron42 installé')"
  else
    step electron fail "$(L 'Não foi possível instalar o electron42. Rode' "Couldn't install electron42. Run" 'No se pudo instalar electron42. Ejecuta' 'Impossible d’installer electron42. Lancez '): sudo pacman -Syu electron42"
    exit 1
  fi
else
  step electron fail "$(L 'Falta o Electron 42. Esta distribuição não tem o pacote electron42 do Arch: baixe o Electron 42 em github.com/electron/electron/releases, extraia e crie um link ~/.local/bin/electron42 para o executável electron; depois rode o instalador de novo.' \
    'Electron 42 is missing. This distribution has no electron42 package (Arch): download Electron 42 from github.com/electron/electron/releases, extract it and link ~/.local/bin/electron42 to the electron executable, then run the installer again.' 'Falta Electron 42. Esta distribución no tiene el paquete electron42 (Arch): descarga Electron 42 desde github.com/electron/electron/releases, extráelo y crea un enlace ~/.local/bin/electron42 al ejecutable electron; luego vuelve a ejecutar el instalador.' 'Electron 42 est introuvable. Cette distribution n’a pas le paquet electron42 (Arch) : téléchargez Electron 42 depuis github.com/electron/electron/releases, extrayez-le et créez un lien ~/.local/bin/electron42 vers l’exécutable electron, puis relancez l’installateur.')"
  exit 1
fi

step app run "$(L 'Copiando o app para' 'Copying the app to' 'Copiando la aplicación a' 'Copie de l’application dans') ${dest/#$HOME/\~}"
mkdir -p "$dest"
rm -rf "$dest/app.new"
cp -r "$src/app" "$dest/app.new"
rm -rf "$dest/app"
mv "$dest/app.new" "$dest/app"
# Cópia do instalador para desinstalar depois: ~/.local/share/mhub-linux/uninstall.sh
install -Dm755 "$src/install.sh" "$dest/install.sh"
install -Dm755 "$src/uninstall.sh" "$dest/uninstall.sh"
install -Dm755 "$src/packaging/askpass.py" "$dest/packaging/askpass.py"
install -Dm644 "$src/udev/70-mhub-linux.rules" "$dest/udev/70-mhub-linux.rules"
mkdir -p "$bin"
cat > "$launcher" <<LAUNCHER
#!/usr/bin/env bash
# Lançador do OpenMHub (instalado por install.sh).
export MHUB_LAUNCHER="$launcher"
exec env -u ELECTRON_RUN_AS_NODE electron42 "$dest/app" "\$@"
LAUNCHER
chmod +x "$launcher"
step app ok "App $version $(L em in en dans) ${dest/#$HOME/\~}"

step shortcut run "$(L 'Criando o atalho no menu de aplicativos' 'Adding the applications menu shortcut' 'Creando el acceso directo en el menú de aplicaciones' 'Ajout du raccourci au menu des applications')"
icons="$data/icons/hicolor"
install -Dm644 "$src/app/assets/icon-256.png" "$icons/256x256/apps/mhub-linux.png"
install -Dm644 "$src/app/assets/icon-512.png" "$icons/512x512/apps/mhub-linux.png"
install -Dm644 "$src/app/assets/icon.svg" "$icons/scalable/apps/mhub-linux.svg"
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$icons" 2>/dev/null || true
apps="$data/applications"
mkdir -p "$apps"
sed "s|^Exec=.*|Exec=$launcher|" "$src/packaging/mhub-linux.desktop" > "$apps/mhub-linux.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$apps" || true
auto="$config/autostart/mhub-linux.desktop"
if [ -n "$autostart" ]; then
  # O próprio app grava a preferência, o ~/.config/autostart e a linha do Hyprland.
  if env -u ELECTRON_RUN_AS_NODE "$launcher" --set-autostart="$autostart" >/dev/null 2>&1; then
    [ "$autostart" = on ] && step shortcut ok "$(L 'Atalho criado; inicia com o sistema' 'Shortcut added; launches at login' 'Acceso directo creado; se inicia con el sistema' 'Raccourci ajouté ; lancement au démarrage')" || step shortcut ok "$(L 'Atalho criado' 'Shortcut added' 'Acceso directo creado' 'Raccourci ajouté')"
  else
    step shortcut fail "$(L 'Atalho criado, mas não foi possível configurar o início automático' "Shortcut added, but launch at login couldn't be set up" 'Acceso directo creado, pero no se pudo configurar el inicio automático' 'Raccourci ajouté, mais le lancement au démarrage n’a pas pu être configuré')"
  fi
else
  # Atualiza o atalho de início automático, se já estiver ligado.
  [ -f "$auto" ] && sed -i "s|^Exec=.*|Exec=\"$launcher\" --hidden|" "$auto"
  step shortcut ok "$(L 'Atalho "OpenMHub" no menu de aplicativos' '"OpenMHub" shortcut in the applications menu' 'Acceso directo “OpenMHub” en el menú de aplicaciones' 'Raccourci « OpenMHub » dans le menu des applications')"
fi

step udev run "$(L 'Verificando a regra udev' 'Checking the udev rule' 'Comprobando la regla udev' 'Vérification de la règle udev')"
if [ -f "$rule" ] && cmp -s "$rule" "$src/udev/70-mhub-linux.rules"; then
  step udev skip "$(L 'Regra udev já instalada' 'udev rule already installed' 'La regla udev ya está instalada' 'Règle udev déjà installée')"
else
  step udev run "$(L 'Instalando a regra udev (pede a senha de administrador)' 'Installing the udev rule (asks for the administrator password)' 'Instalando la regla udev (pide la contraseña de administrador)' 'Installation de la règle udev (mot de passe administrateur requis)')"
  cmd="install -Dm644 '$src/udev/70-mhub-linux.rules' '$rule' && udevadm control --reload && udevadm trigger --subsystem-match=hidraw"
  if as_root "$cmd" "$(L 'copiar a regra udev para /etc/udev/rules.d, que libera o acesso aos dispositivos MCHOSE' 'copy the udev rule to /etc/udev/rules.d, which grants access to MCHOSE devices' 'copiar la regla udev a /etc/udev/rules.d, que da acceso a los dispositivos MCHOSE' 'copier la règle udev dans /etc/udev/rules.d, ce qui donne accès aux périphériques MCHOSE')"; then
    step udev ok "$(L 'Regra udev instalada' 'udev rule installed' 'Regla udev instalada' 'Règle udev installée')"
  else
    step udev fail "$(L 'Regra udev não instalada; o app não vai achar os dispositivos. Rode depois' "udev rule not installed; the app won't find your devices. Run later" 'Regla udev no instalada; la aplicación no encontrará los dispositivos. Ejecuta más tarde' 'Règle udev non installée ; l’application ne trouvera pas vos périphériques. Lancez plus tard '): sudo install -Dm644 '$dest/udev/70-mhub-linux.rules' $rule && sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=hidraw"
  fi
fi

case ":$PATH:" in
  *":$bin:"*) ;;
  *) [ "$machine" = 1 ] || echo "$(L "Aviso: $bin não está no PATH; o atalho do menu funciona mesmo assim." "Note: $bin is not in PATH; the menu shortcut works anyway." "Aviso: $bin no está en el PATH; el acceso directo del menú funciona igualmente." "Remarque : $bin n’est pas dans le PATH ; le raccourci du menu fonctionne quand même.")" ;;
esac
step done ok "$(L 'Pronto. Abra "OpenMHub" no menu de aplicativos ou rode: mhub-linux' 'Done. Open "OpenMHub" from the applications menu or run: mhub-linux' 'Listo. Abre “OpenMHub” desde el menú de aplicaciones o ejecuta: mhub-linux' 'Terminé. Ouvrez « OpenMHub » depuis le menu des applications ou lancez : mhub-linux')"
