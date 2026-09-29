const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mhub', {
  // Controles da janela: 'min' | 'max' | 'close' | 'devtools'.
  win: (action) => ipcRenderer.send('win', action),
  // Estado dos aparelhos para a bandeja e as notificações de bateria.
  status: (list) => ipcRenderer.send('status', list),
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPref: (key, value) => ipcRenderer.invoke('prefs:set', key, value).then(() => undefined),
  version: () => ipcRenderer.invoke('version'),
  // Notificação na área de trabalho. opts: { tag, silent, urgency }. Mesmo tag substitui a anterior;
  // tag 'dpi' é ignorada quando a preferência dpiNotify está desligada.
  notify: (title, body, opts) => ipcRenderer.send('notify', String(title ?? ''), String(body ?? ''),
    opts && typeof opts === 'object'
      ? { tag: opts.tag, silent: opts.silent, urgency: opts.urgency }
      : {}),
});
