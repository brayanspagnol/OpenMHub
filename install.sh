#!/usr/bin/env bash
# Instala ou remove o M HUB Linux para o usuário atual (sem npm, sem root).
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
    *) echo "Opção desconhecida: $arg" >&2; exit 2 ;;
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
    msg="Não foi possível abrir o instalador gráfico: ele precisa de uma sessão gráfica e do python-gobject (GTK 4). Rode num terminal: sh MHUB-Linux-Installer.run --terminal"
    command -v notify-send >/dev/null 2>&1 && notify-send "M HUB Linux" "$msg" || true
    echo "$msg" >&2
    exit 1
  fi
fi

ask() { # ask <pergunta> <padrão s|n>
  local reply
  read -r -p "$1 " reply || reply=""
  reply="${reply:-$2}"
  case "$reply" in [sSyY]*) return 0 ;; *) return 1 ;; esac
}

if [ "$ui" = terminal ] && [ "$yes" = 0 ]; then
  echo "M HUB Linux $version: instalador"
  if [ -f "$dest/app/package.json" ]; then
    echo "Instalado: versão $(version_of "$dest/app") em $dest"
    echo "  1) Atualizar/reinstalar   2) Desinstalar   3) Sair"
    read -r -p "Escolha [1]: " choice || choice=3
    case "${choice:-1}" in
      1) ;;
      2) action=uninstall; ask "Remover também a regra udev e as preferências? [s/N]" n && all=1 ;;
      *) exit 0 ;;
    esac
  else
    ask "Instalar em $dest? [S/n]" s || exit 0
  fi
  if [ "$action" = install ] && [ -z "$autostart" ]; then
    if ask "Iniciar com o sistema (escondido na bandeja)? [s/N]" n; then autostart=on; else autostart=off; fi
  fi
fi

# ---------- Desinstalar ----------
if [ "$action" = uninstall ]; then
  step stop run "Fechando o M HUB Linux"
  if pkill -f "$(running_pattern)" 2>/dev/null; then step stop ok "App fechado"; else step stop skip "Não estava aberto"; fi

  # A regra udev sai antes dos arquivos: a janela de senha (askpass) pode estar dentro de $dest.
  if [ "$all" = 1 ]; then
    rm -rf "$config/mhub-linux"
    if [ -f "$rule" ]; then
      step udev run "Removendo a regra udev"
      if as_root "rm -f '$rule' && udevadm control --reload" "remover a regra udev de /etc/udev/rules.d"; then
        step udev ok "Regra udev removida"
      else
        step udev fail "Não foi possível remover $rule"
      fi
    fi
  fi

  step files run "Removendo o app, o atalho e os ícones"
  rm -rf "$dest"
  rm -f "$launcher" "$data/applications/mhub-linux.desktop" \
        "$data/icons/hicolor/256x256/apps/mhub-linux.png" \
        "$data/icons/hicolor/512x512/apps/mhub-linux.png" \
        "$data/icons/hicolor/scalable/apps/mhub-linux.svg"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$data/applications" || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$data/icons/hicolor" 2>/dev/null || true
  step files ok "Arquivos removidos"

  step autostart run "Removendo o início automático"
  rm -f "$config/autostart/mhub-linux.desktop"
  # Linha marcada que o app põe no config do Hyprland (ver applyAutostart em app/main.js).
  for f in "${MHUB_HYPR_CONF:-}" "$config/hypr/hyprland.conf" "$config/hypr/hyprland.lua"; do
    [ -n "$f" ] && [ -f "$f" ] && grep -q 'mhub-linux-autostart$' "$f" && sed -i --follow-symlinks '/mhub-linux-autostart$/d' "$f" || true
  done
  step autostart ok "Início automático removido"

  if [ "$all" = 1 ]; then
    step done ok "M HUB Linux removido, com preferências e regra udev"
  else
    step done ok "M HUB Linux removido (regra udev e preferências mantidas)"
  fi
  exit 0
fi

# ---------- Instalar ----------
if [ "$src" = "$dest" ]; then
  echo "Esta é a cópia instalada. Para atualizar, rode o instalador baixado (MHUB-Linux-Installer.run)." >&2
  exit 1
fi

step electron run "Verificando o Electron"
if command -v electron42 >/dev/null 2>&1; then
  step electron skip "electron42 já instalado"
elif command -v pacman >/dev/null 2>&1; then
  step electron run "Instalando electron42 com o pacman"
  if as_root "pacman -S --needed --noconfirm electron42" "instalar o pacote electron42 com o pacman"; then
    step electron ok "electron42 instalado"
  else
    step electron fail "Não foi possível instalar o electron42. Rode: sudo pacman -Syu electron42"
    exit 1
  fi
else
  step electron fail "Falta o Electron 42. Esta distribuição não tem o pacote electron42 do Arch: baixe o Electron 42 em github.com/electron/electron/releases, extraia e crie um link ~/.local/bin/electron42 para o executável electron; depois rode o instalador de novo."
  exit 1
fi

step app run "Copiando o app para ${dest/#$HOME/\~}"
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
# Lançador do M HUB Linux (instalado por install.sh).
export MHUB_LAUNCHER="$launcher"
exec env -u ELECTRON_RUN_AS_NODE electron42 "$dest/app" "\$@"
LAUNCHER
chmod +x "$launcher"
step app ok "App $version em ${dest/#$HOME/\~}"

step shortcut run "Criando o atalho no menu de aplicativos"
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
    [ "$autostart" = on ] && step shortcut ok "Atalho criado; inicia com o sistema" || step shortcut ok "Atalho criado"
  else
    step shortcut fail "Atalho criado, mas não foi possível configurar o início automático"
  fi
else
  # Atualiza o atalho de início automático, se já estiver ligado.
  [ -f "$auto" ] && sed -i "s|^Exec=.*|Exec=\"$launcher\" --hidden|" "$auto"
  step shortcut ok "Atalho \"M HUB Linux\" no menu de aplicativos"
fi

step udev run "Verificando a regra udev"
if [ -f "$rule" ] && cmp -s "$rule" "$src/udev/70-mhub-linux.rules"; then
  step udev skip "Regra udev já instalada"
else
  step udev run "Instalando a regra udev (pede a senha de administrador)"
  cmd="install -Dm644 '$src/udev/70-mhub-linux.rules' '$rule' && udevadm control --reload && udevadm trigger --subsystem-match=hidraw"
  if as_root "$cmd" "copiar a regra udev para /etc/udev/rules.d, que libera o acesso aos dispositivos MCHOSE"; then
    step udev ok "Regra udev instalada"
  else
    step udev fail "Regra udev não instalada; o app não vai achar os dispositivos. Rode depois: sudo install -Dm644 '$dest/udev/70-mhub-linux.rules' $rule && sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=hidraw"
  fi
fi

case ":$PATH:" in
  *":$bin:"*) ;;
  *) [ "$machine" = 1 ] || echo "Aviso: $bin não está no PATH; o atalho do menu funciona mesmo assim." ;;
esac
step done ok "Pronto. Abra \"M HUB Linux\" no menu de aplicativos ou rode: mhub-linux"
