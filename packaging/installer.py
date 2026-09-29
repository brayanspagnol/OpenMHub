#!/usr/bin/env python3
# Instalador gráfico (GTK4) do OpenMHub. Não instala nada sozinho: roda install.sh --machine
# e mostra os passos que ele informa em linhas "@@step <id> <estado> <texto>".
#
# Testes: installer.py --auto [--uninstall] [--autostart|--no-autostart] [--shot arquivo.png]
#   --auto já clica em Instalar (ou Desinstalar), grava a captura da janela no fim e sai.
import ctypes
import ctypes.util
import os
import subprocess
import sys
import tempfile

import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Gdk', '4.0')
gi.require_version('PangoCairo', '1.0')
from gi.repository import Gdk, Gio, GLib, Gtk, PangoCairo  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALL = os.path.join(ROOT, 'install.sh')
ICON = os.path.join(ROOT, 'app', 'assets', 'icon-256.png')
FONTS = os.path.join(ROOT, 'app', 'renderer', 'assets', 'fonts')


def system_lang():
    # Mesma ordem do gettext: LANGUAGE (lista), LC_ALL, LC_MESSAGES, LANG.
    for var in ('LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG'):
        value = os.environ.get(var, '')
        if value:
            return value.split(':')[0]
    return ''


PT = system_lang().lower().startswith('pt')


def _(pt, en):
    # Texto no idioma do sistema: português para pt*, inglês para o resto.
    return pt if PT else en


INSTALL_STEPS = [
    ('electron', _('Verificar o Electron', 'Check Electron')),
    ('app', _('Copiar o app', 'Copy the app')),
    ('shortcut', _('Criar o atalho no menu', 'Add the menu shortcut')),
    ('udev', _('Regra udev (acesso aos dispositivos)', 'udev rule (device access)')),
    ('done', _('Pronto', 'Done')),
]
UNINSTALL_STEPS = [
    ('stop', _('Fechar o OpenMHub', 'Close OpenMHub')),
    ('files', _('Remover o app, o atalho e os ícones', 'Remove the app, shortcut and icons')),
    ('autostart', _('Remover o início automático', 'Remove launch at login')),
    ('done', _('Pronto', 'Done')),
]

CSS = """
window.mhub, window.mhub * { font-family: MiSans, "Noto Sans", Cantarell, sans-serif; }
window.mhub { background: @bg; color: @text; }
window.mhub headerbar, window.mhub headerbar:backdrop { background: @bg; box-shadow: none; border: none; min-height: 40px; }
.card { background: @card; border-radius: 16px; padding: 18px 20px; box-shadow: 0 4px 12px rgba(0,0,0,.08); }
.title { font-size: 22px; font-weight: 700; }
.subtitle { color: @text2; font-size: 13px; }
.step { padding: 7px 0; }
.step-label { font-size: 14px; }
.step-detail { color: @text2; font-size: 12px; }
.dot { min-width: 22px; min-height: 22px; border-radius: 11px; font-size: 12px; font-weight: 700;
       background: @pending; color: @text2; }
.dot.ok { background: @accent; color: #fff; }
.dot.skip { background: @accentsoft; color: @accent; }
.dot.fail { background: #ea5e56; color: #fff; }
button.primary { background: @accent; color: #fff; border-radius: 8px; padding: 8px 22px; font-weight: 600;
                 border: none; box-shadow: none; }
button.primary:hover { background: shade(@accent, 1.1); }
button.primary:disabled { background: @pending; color: @text2; }
button.secondary { background: @card; color: @text; border-radius: 8px; padding: 8px 18px; border: 1px solid @border;
                   box-shadow: none; }
button.danger { color: #ea5e56; }
checkbutton check:checked { background: @accent; border-color: @accent; color: #fff; }
.log { font-family: monospace; font-size: 11px; background: transparent; color: @text2; }
.log text { background: transparent; }
"""
LIGHT = dict(bg='#f2f3f7', card='#ffffff', text='#151515', text2='rgba(21,21,21,.55)', border='#d7dee3',
             accent='#0053e2', accentsoft='#d6e4fb', pending='#e5e9f0')
DARK = dict(bg='#000000', card='#212225', text='#ffffff', text2='rgba(255,255,255,.55)', border='#2b2b2b',
            accent='#226bee', accentsoft='rgba(34,107,238,.22)', pending='#35373a')


def woff2_to_sfnt(path):
    # O Pango (HarfBuzz) não lê woff2, mas o FreeType sim: pede a ele o arquivo sfnt inteiro (tabela 0).
    ft = ctypes.CDLL(ctypes.util.find_library('freetype') or 'libfreetype.so.6')
    lib, face = ctypes.c_void_p(), ctypes.c_void_p()
    if ft.FT_Init_FreeType(ctypes.byref(lib)):
        return None
    try:
        if ft.FT_New_Face(lib, path.encode(), 0, ctypes.byref(face)):
            return None
        size = ctypes.c_ulong(0)
        if ft.FT_Load_Sfnt_Table(face, ctypes.c_ulong(0), ctypes.c_long(0), None, ctypes.byref(size)) or not size.value:
            return None
        buf = (ctypes.c_ubyte * size.value)()
        if ft.FT_Load_Sfnt_Table(face, ctypes.c_ulong(0), ctypes.c_long(0), buf, ctypes.byref(size)):
            return None
        return bytes(buf)
    finally:
        if face:
            ft.FT_Done_Face(face)
        ft.FT_Done_FreeType(lib)


def load_fonts():
    # MiSans vem com o app em woff2; converte para uma pasta temporária e registra no Pango.
    fm = PangoCairo.FontMap.get_default()
    if not os.path.isdir(FONTS) or not hasattr(fm, 'add_font_file'):
        return None
    tmp = tempfile.TemporaryDirectory(prefix='mhub-fonts-')
    for name in sorted(os.listdir(FONTS)):
        try:
            data = woff2_to_sfnt(os.path.join(FONTS, name))
            if data:
                out = os.path.join(tmp.name, os.path.splitext(name)[0] + '.otf')
                with open(out, 'wb') as f:
                    f.write(data)
                fm.add_font_file(out)
        except (OSError, GLib.Error):
            pass
    return tmp


def prefers_dark():
    settings = Gtk.Settings.get_default()
    try:
        return settings.props.gtk_interface_color_scheme == Gtk.InterfaceColorScheme.DARK
    except AttributeError:
        return bool(settings.props.gtk_application_prefer_dark_theme)


def status():
    out = subprocess.run(['bash', INSTALL, '--status'], capture_output=True, text=True).stdout
    return dict(line.split('=', 1) for line in out.splitlines() if '=' in line)


class StepRow(Gtk.Box):
    def __init__(self, label):
        super().__init__(spacing=12)
        self.add_css_class('step')
        self.stack = Gtk.Stack(valign=Gtk.Align.START)
        self.dot = Gtk.Label(label='', halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER)
        self.dot.add_css_class('dot')
        self.spinner = Gtk.Spinner(width_request=22, height_request=22)
        self.stack.add_named(self.dot, 'dot')
        self.stack.add_named(self.spinner, 'spin')
        self.append(self.stack)
        texts = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, hexpand=True)
        self.label = Gtk.Label(label=label, xalign=0)
        self.label.add_css_class('step-label')
        self.detail = Gtk.Label(xalign=0, wrap=True, visible=False)
        self.detail.add_css_class('step-detail')
        texts.append(self.label)
        texts.append(self.detail)
        self.append(texts)

    def set_state(self, state, text=''):
        for c in ('ok', 'skip', 'fail'):
            self.dot.remove_css_class(c)
        if state == 'run':
            self.spinner.start()
            self.stack.set_visible_child_name('spin')
        else:
            self.spinner.stop()
            self.stack.set_visible_child_name('dot')
            self.dot.set_label({'ok': '✓', 'skip': '✓', 'fail': '!'}.get(state, ''))
            if state in ('ok', 'skip', 'fail'):
                self.dot.add_css_class(state)
        self.detail.set_label(text)
        self.detail.set_visible(bool(text))


class Installer(Gtk.Application):
    def __init__(self, args):
        super().__init__(application_id='io.github.mhublinux.installer', flags=Gio.ApplicationFlags.NON_UNIQUE)
        self.args = args
        self.auto = '--auto' in args
        self.shot = args[args.index('--shot') + 1] if '--shot' in args else None
        self.rows = {}
        self.proc = None
        self.failed = False
        self.phase = 'idle'  # idle, busy, installed, removed

    # ---------- Interface ----------
    def do_activate(self):
        self.fonts = load_fonts()
        colors = DARK if prefers_dark() else LIGHT
        css = ''.join(f'@define-color {k} {v};\n' for k, v in colors.items()) + CSS
        provider = Gtk.CssProvider()
        provider.load_from_string(css) if hasattr(provider, 'load_from_string') else provider.load_from_data(css.encode())
        # Acima do gtk.css do usuário: o instalador segue as cores do app.
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_USER + 1)

        self.st = status()
        self.installed = self.st.get('installed') == '1'
        self.win = Gtk.ApplicationWindow(application=self, title=_('Instalar OpenMHub', 'Install OpenMHub'))
        self.win.add_css_class('mhub')
        self.win.set_default_size(480, -1)
        self.win.set_resizable(False)
        header = Gtk.HeaderBar()
        header.set_title_widget(Gtk.Label(label=''))
        self.win.set_titlebar(header)

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        for side in ('start', 'end', 'bottom'):
            getattr(outer, f'set_margin_{side}')(24)
        outer.set_margin_top(4)

        top = Gtk.Box(spacing=16)
        icon = Gtk.Picture.new_for_filename(ICON)
        icon.set_size_request(72, 72)
        icon.set_can_shrink(True)
        top.append(icon)
        titles = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.CENTER, spacing=2)
        title = Gtk.Label(label='OpenMHub', xalign=0)
        title.add_css_class('title')
        titles.append(title)
        version = self.st.get('version', '')
        self.base_subtitle = sub = _(f'Versão {version} · configurador não oficial dos periféricos MCHOSE',
                                     f'Version {version} · unofficial configurator for MCHOSE peripherals')
        if self.installed:
            installed = self.st.get('installed_version', '?')
            sub += _(f'\nJá instalado (versão {installed})', f'\nAlready installed (version {installed})')
        self.subtitle = Gtk.Label(label=sub, xalign=0)
        self.subtitle.add_css_class('subtitle')
        titles.append(self.subtitle)
        top.append(titles)
        outer.append(top)

        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        card.add_css_class('card')
        self.steps_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        card.append(self.steps_box)
        self.autostart = Gtk.CheckButton(label=_('Iniciar com o sistema (escondido na bandeja)',
                                                 'Launch at login (hidden in the tray)'))
        self.autostart.set_active(self.st.get('autostart') == '1')
        if '--autostart' in self.args:
            self.autostart.set_active(True)
        if '--no-autostart' in self.args:
            self.autostart.set_active(False)
        self.autostart.set_margin_top(10)
        card.append(self.autostart)
        outer.append(card)
        self.show_plan(INSTALL_STEPS)

        self.log = Gtk.TextView(editable=False, cursor_visible=False, wrap_mode=Gtk.WrapMode.WORD_CHAR)
        self.log.add_css_class('log')
        scroller = Gtk.ScrolledWindow(min_content_height=110, child=self.log)
        self.expander = Gtk.Expander(label=_('Detalhes', 'Details'), child=scroller)
        outer.append(self.expander)

        buttons = Gtk.Box(spacing=8, halign=Gtk.Align.END)
        self.secondary = Gtk.Button(label=_('Desinstalar', 'Uninstall') if self.installed else _('Cancelar', 'Cancel'))
        self.secondary.add_css_class('secondary')
        if self.installed:
            self.secondary.add_css_class('danger')
        self.primary = Gtk.Button(label=_('Atualizar', 'Update') if self.installed else _('Instalar', 'Install'))
        self.primary.add_css_class('primary')
        buttons.append(self.secondary)
        buttons.append(self.primary)
        outer.append(buttons)
        self.primary.connect('clicked', self.on_primary)
        self.secondary.connect('clicked', self.on_secondary)

        self.win.set_child(outer)
        self.win.connect('close-request', self.on_close)
        self.win.present()
        self.primary.grab_focus()

        if self.auto:
            GLib.timeout_add(400, lambda: (self.start('--uninstall' in self.args), False)[1])
        elif self.shot:
            GLib.timeout_add(600, lambda: (self.snapshot_and_quit(), False)[1])

    def show_plan(self, plan):
        while (child := self.steps_box.get_first_child()) is not None:
            self.steps_box.remove(child)
        self.rows = {}
        for key, label in plan:
            self.add_row(key, label)

    def add_row(self, key, label):
        row = StepRow(label)
        self.rows[key] = row
        # Passos extras (ex.: remover a regra udev) entram antes do "Pronto".
        done = self.rows.get('done')
        if done is not None and key != 'done':
            self.steps_box.insert_child_after(row, done.get_prev_sibling())
        else:
            self.steps_box.append(row)
        return row

    def append_log(self, text):
        buf = self.log.get_buffer()
        buf.insert(buf.get_end_iter(), text + '\n')

    # ---------- Ações ----------
    def on_primary(self, _btn):
        if self.phase == 'installed':
            self.open_app()
        elif self.phase == 'removed':
            self.quit()
        else:
            self.start(uninstall=False)

    def on_secondary(self, _btn):
        if self.phase in ('installed', 'removed'):
            self.quit()
        elif self.installed:
            self.confirm_uninstall()
        else:
            self.quit()

    def confirm_uninstall(self):
        dialog = Gtk.AlertDialog(message=_('Desinstalar o OpenMHub?', 'Uninstall OpenMHub?'),
                                 detail=_('O app, o atalho e o início automático serão removidos. '
                                          'A regra udev e as preferências ficam.',
                                          'The app, its shortcut and launch at login will be removed. '
                                          'The udev rule and your preferences are kept.'),
                                 buttons=[_('Cancelar', 'Cancel'), _('Desinstalar', 'Uninstall')],
                                 cancel_button=0, default_button=1)

        def done(dlg, res):
            try:
                if dlg.choose_finish(res) == 1:
                    self.start(uninstall=True)
            except GLib.Error:
                pass
        dialog.choose(self.win, None, done)

    def start(self, uninstall):
        self.phase = 'busy'
        self.failed = False
        self.uninstalling = uninstall
        self.show_plan(UNINSTALL_STEPS if uninstall else INSTALL_STEPS)
        self.primary.set_sensitive(False)
        self.secondary.set_sensitive(False)
        self.autostart.set_sensitive(False)
        cmd = ['bash', INSTALL, '--machine', '--yes']
        if uninstall:
            cmd.append('--uninstall')
        else:
            cmd.append('--autostart' if self.autostart.get_active() else '--no-autostart')
        env = dict(os.environ)
        env.pop('ELECTRON_RUN_AS_NODE', None)
        launcher = Gio.SubprocessLauncher.new(Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE
                                              | Gio.SubprocessFlags.STDIN_PIPE)
        launcher.set_environ([f'{k}={v}' for k, v in env.items()])
        self.proc = launcher.spawnv(cmd)
        self.proc.get_stdin_pipe().close()  # sem terminal: o sudo usa a janela de senha
        self.stream = Gio.DataInputStream.new(self.proc.get_stdout_pipe())
        self.stream.read_line_async(GLib.PRIORITY_DEFAULT, None, self.on_line)

    def on_line(self, stream, res):
        line, _len = stream.read_line_finish_utf8(res)
        if line is None:
            self.proc.wait_async(None, self.on_exit)
            return
        if line.startswith('@@step '):
            parts = line.split(' ', 3)
            key, state = parts[1], parts[2]
            text = parts[3] if len(parts) > 3 else ''
            row = self.rows.get(key) or self.add_row(key, text)
            # O rótulo do passo fica; o texto do script vira o detalhe.
            row.set_state(state, '' if key == 'done' and state == 'ok' else text)
            if state == 'fail':
                self.failed = True
            self.append_log(f'[{key}] {text}')
        elif line.strip():
            self.append_log(line)
        stream.read_line_async(GLib.PRIORITY_DEFAULT, None, self.on_line)

    def on_exit(self, proc, res):
        proc.wait_finish(res)
        ok = proc.get_exit_status() == 0
        for row in self.rows.values():
            if row.stack.get_visible_child_name() == 'spin':
                row.set_state('fail' if not ok else 'ok', row.detail.get_label())
        self.primary.set_sensitive(True)
        self.secondary.set_sensitive(True)
        if not ok:
            self.phase = 'idle'
            self.failed = True
            self.expander.set_expanded(True)
            self.primary.set_label(_('Tentar de novo', 'Try again'))
            self.secondary.set_label(_('Fechar', 'Close'))
            self.secondary.remove_css_class('danger')
            self.installed = False
            self.autostart.set_sensitive(True)
        elif self.uninstalling:
            self.phase = 'removed'
            self.subtitle.set_label(self.base_subtitle)
            self.rows['done'].set_state('ok', _('O OpenMHub foi removido.', 'OpenMHub was removed.'))
            self.primary.set_label(_('Fechar', 'Close'))
            self.secondary.set_visible(False)
            self.autostart.set_visible(False)
        else:
            self.phase = 'installed'
            dest = self.st.get('dest', '').replace(os.path.expanduser('~'), '~', 1)
            self.subtitle.set_label(self.base_subtitle + _(f'\nInstalado em {dest}', f'\nInstalled in {dest}'))
            detail = _('Abra "OpenMHub" no menu de aplicativos.', 'Open "OpenMHub" from your applications menu.')
            if self.failed:
                detail = _('Instalado com avisos: veja os detalhes. ', 'Installed with warnings: see the details. ') + detail
                self.expander.set_expanded(True)
            self.rows['done'].set_state('ok', detail)
            self.primary.set_label(_('Abrir OpenMHub', 'Open OpenMHub'))
            self.secondary.set_label(_('Fechar', 'Close'))
            self.secondary.remove_css_class('danger')
        if self.auto:
            GLib.timeout_add(500, lambda: (self.snapshot_and_quit(0 if ok else 1), False)[1])

    def open_app(self):
        env = dict(os.environ)
        env.pop('ELECTRON_RUN_AS_NODE', None)
        subprocess.Popen([status().get('launcher', os.path.expanduser('~/.local/bin/mhub-linux'))], env=env,
                         start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
        GLib.timeout_add(800, lambda: (self.quit(), False)[1])

    def on_close(self, _win):
        return self.phase == 'busy'  # não fecha no meio da instalação

    # ---------- Testes ----------
    def snapshot_and_quit(self, code=0):
        if self.shot:
            try:
                paintable = Gtk.WidgetPaintable.new(self.win)
                w, h = self.win.get_width(), self.win.get_height()
                snap = Gtk.Snapshot()
                paintable.snapshot(snap, w, h)
                node = snap.to_node()
                texture = self.win.get_renderer().render_texture(node, None)
                texture.save_to_png(self.shot)
            except Exception as e:  # noqa: BLE001
                print(f'captura falhou: {e}', file=sys.stderr)
        self.exit_code = code
        self.quit()


def main():
    app = Installer(sys.argv[1:])
    app.exit_code = 0
    app.run([sys.argv[0]])
    return app.exit_code


if __name__ == '__main__':
    sys.exit(main())
