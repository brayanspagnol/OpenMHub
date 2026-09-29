#!/usr/bin/env python3
# Pede a senha do sudo numa janela GTK4 (SUDO_ASKPASS) quando não há terminal.
import os
import sys
import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk


def system_lang():
    for var in ('LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG'):
        value = os.environ.get(var, '')
        if value:
            return value.split(':')[0]
    return ''


PT = system_lang().lower().startswith('pt')
prompt = sys.argv[1] if len(sys.argv) > 1 else ('Senha:' if PT else 'Password:')
# O instalador diz o motivo em MHUB_ASKPASS_REASON (já no idioma do sistema).
reason = os.environ.get('MHUB_ASKPASS_REASON', 'copiar a regra udev para /etc/udev/rules.d' if PT
                        else 'copy the udev rule to /etc/udev/rules.d')
result = {'pw': None}


def on_activate(app):
    win = Gtk.ApplicationWindow(application=app, title='OpenMHub: senha de administrador' if PT else 'OpenMHub: administrator password')
    win.set_default_size(420, -1)
    win.set_resizable(False)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
    for side in ('top', 'bottom', 'start', 'end'):
        getattr(box, f'set_margin_{side}')(18)
    info = Gtk.Label(label=f'O instalador precisa de permissão de administrador para {reason}.' if PT
                     else f'The installer needs administrator permission to {reason}.',
                     wrap=True, xalign=0)
    box.append(info)
    box.append(Gtk.Label(label=prompt, xalign=0))
    entry = Gtk.PasswordEntry()
    entry.set_show_peek_icon(True)
    box.append(entry)
    buttons = Gtk.Box(spacing=8, halign=Gtk.Align.END)
    cancel = Gtk.Button(label='Cancelar' if PT else 'Cancel')
    ok = Gtk.Button(label='OK')
    ok.add_css_class('suggested-action')
    buttons.append(cancel)
    buttons.append(ok)
    box.append(buttons)

    def accept(*_):
        result['pw'] = entry.get_text()
        win.close()

    ok.connect('clicked', accept)
    entry.connect('activate', accept)
    cancel.connect('clicked', lambda *_: win.close())
    win.set_child(box)
    win.present()
    entry.grab_focus()


app = Gtk.Application(application_id='io.github.mhublinux.askpass')
app.connect('activate', on_activate)
app.run([])
if result['pw'] is None:
    sys.exit(1)
print(result['pw'])
