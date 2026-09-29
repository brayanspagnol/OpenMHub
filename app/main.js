// Processo principal: janela sem moldura, permissões WebHID, bandeja, notificações e preferências.
const { app, BrowserWindow, ipcMain, session, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// userData fixo em ~/.config/mhub-linux (definido antes do setName, que mudaria a pasta);
// o nome "M HUB Linux" aparece nas notificações. A classe da janela segue "mhub-linux".
app.setPath('userData', path.join(app.getPath('appData'), 'mhub-linux'));
app.setName('M HUB Linux');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('class', 'mhub-linux');
const SHOT = process.env.MHUB_SHOT;
// Teste de captura usa perfil à parte para não brigar com uma instância aberta.
if (SHOT) app.setPath('userData', path.join(os.tmpdir(), 'mhub-linux-shot'));

// Fabricantes USB dos aparelhos MCHOSE (YJX-CHIP e SINOWEALTH).
const VENDORS = new Set([0x3837, 0x41e4]);
const ASSETS = path.join(__dirname, 'assets');
const ICON = path.join(ASSETS, 'icon-256.png');
const MODES = { wired: 'cabo', '2.4g': '2.4G', bt: 'Bluetooth' };

let win = null;
let tray = null;
let trayOk = false;
let quitting = false;
let devices = [];
let lastStatus = '';
const alerts = new Map(); // id -> { low, full }: já notificou neste ciclo

// ---------- Preferências ----------
const DEFAULTS = {
  closeToTray: true, autostart: false, lowBattery: 20, notifyFull: false, lockNotify: true, dpiNotify: true,
};
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
let prefs = { ...DEFAULTS };

function loadPrefs() {
  try {
    const saved = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    for (const k of Object.keys(DEFAULTS)) if (k in saved) prefs[k] = clean(k, saved[k]);
  } catch { /* primeiro uso ou arquivo inválido */ }
}

function savePrefs() {
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2));
}

function clean(key, value) {
  if (key === 'lowBattery') {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(90, Math.max(1, n)) : DEFAULTS.lowBattery;
  }
  return Boolean(value);
}

// ---------- Início automático ----------
const autostartFile = () => path.join(app.getPath('home'), '.config', 'autostart', 'mhub-linux.desktop');

function applyAutostart() {
  const file = autostartFile();
  if (!prefs.autostart) {
    fs.rmSync(file, { force: true });
    applyHyprAutostart(false);
    return;
  }
  // O lançador define MHUB_LAUNCHER; sem ele, chama o electron42 direto.
  const exec = process.env.MHUB_LAUNCHER
    ? `"${process.env.MHUB_LAUNCHER}" --hidden`
    : `env -u ELECTRON_RUN_AS_NODE electron42 "${app.getAppPath()}" --hidden`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    '[Desktop Entry]',
    'Type=Application',
    'Name=M HUB Linux',
    'Comment=Bateria e configurações dos periféricos MCHOSE',
    `Exec=${exec}`,
    'Icon=mhub-linux',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n'));
  applyHyprAutostart(true, exec);
}

// Hyprland ignora ~/.config/autostart (sem uwsm/dex): mantém uma linha marcada no config principal.
const HYPR_MARK = 'mhub-linux-autostart';

function hyprConfig() {
  if (process.env.MHUB_HYPR_CONF) return process.env.MHUB_HYPR_CONF;
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'hypr');
  // Com hyprland.lua presente o Hyprland usa ele no lugar do hyprland.conf.
  return ['hyprland.lua', 'hyprland.conf'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f)) || null;
}

function applyHyprAutostart(enabled, exec) {
  const hypr = !!process.env.HYPRLAND_INSTANCE_SIGNATURE || /hyprland/i.test(process.env.XDG_CURRENT_DESKTOP || '');
  // Liga só no Hyprland; desligar limpa a linha mesmo fora dele.
  if (enabled && !hypr && !process.env.MHUB_HYPR_CONF) return;
  const file = hyprConfig();
  if (!file) return;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const line = file.endsWith('.lua')
    ? `hl.on("hyprland.start", function() hl.exec_cmd(${JSON.stringify(exec)}) end) -- ${HYPR_MARK}`
    : `exec-once = ${exec} # ${HYPR_MARK}`;
  const lines = text.split('\n');
  const marked = (l) => l.trimEnd().endsWith(HYPR_MARK);
  if (enabled && lines.filter(marked).length === 1 && lines.includes(line)) return;
  let next = lines.filter((l) => !marked(l)).join('\n');
  if (enabled) next += `${next && !next.endsWith('\n') ? '\n' : ''}${line}\n`;
  if (next === text) return;
  const bak = `${file}.mhub-bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  fs.writeFileSync(file, next); // no lugar, para manter links simbólicos de dotfiles
}

// ---------- WebHID ----------
function allowHid() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'hid' || permission === 'clipboard-sanitized-write');
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid' && VENDORS.has(details.device.vendorId));
  // requestDevice(): escolhe o primeiro aparelho compatível sem mostrar seletor.
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const dev = details.deviceList.find((d) => VENDORS.has(d.vendorId));
    callback(dev ? dev.deviceId : '');
  });
}

// ---------- Janela ----------
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    show: !hidden,
    icon: ICON,
    backgroundColor: '#f2f3f7',
    title: 'M HUB Linux',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Captura de tela para testes: MHUB_SHOT=arquivo.png [MHUB_JS="código"] electron42 .
  if (SHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 4000));
      if (process.env.MHUB_JS) {
        await win.webContents.executeJavaScript(process.env.MHUB_JS).catch((e) => console.error(e));
        await new Promise((r) => setTimeout(r, 2500));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(SHOT, img.toPNG());
      app.quit();
    });
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
  }
  // Fechar esconde na bandeja, se houver bandeja.
  win.on('close', (e) => {
    if (!quitting && !SHOT && prefs.closeToTray && trayOk) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

// ---------- Bandeja ----------
function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(ASSETS, 'tray-32.png'));
    tray = new Tray(img);
    tray.setToolTip('M HUB Linux');
    tray.on('click', showWindow);
    updateTray();
    trayOk = true;
  } catch (e) {
    console.error('Bandeja indisponível:', e.message);
    tray = null;
    trayOk = false;
    return;
  }
  // No Wayland a bandeja depende de um StatusNotifierWatcher (waybar, etc.).
  execFile('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/',
    '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher'], (err, out) => {
    if (!err && out.includes('false')) {
      trayOk = false;
      if (win && !win.isVisible()) showWindow();
    }
  });
}

function deviceLine(d) {
  const name = d.name || d.id || 'Dispositivo';
  if (d.online === false) return `${name} — desconectado`;
  if (d.sleeping) return `${name} — em repouso`;
  let s = `${name} — ${typeof d.battery === 'number' ? `${d.battery}%` : '—'}`;
  if (d.charging) s += ' (carregando)';
  if (MODES[d.mode]) s += ` · ${MODES[d.mode]}`;
  return s;
}

function updateTray() {
  if (!tray) return;
  const lines = devices.map(deviceLine);
  tray.setToolTip(['M HUB Linux', ...(lines.length ? lines : ['Nenhum dispositivo'])].join('\n'));
  const items = lines.length
    ? lines.map((label) => ({ label, enabled: false }))
    : [{ label: 'Nenhum dispositivo', enabled: false }];
  tray.setContextMenu(Menu.buildFromTemplate([
    ...items,
    { type: 'separator' },
    { label: 'Abrir M HUB', click: showWindow },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- Notificações ----------
const tagged = new Map(); // tag -> Notification: a nova do mesmo tag substitui a anterior

function notify(title, body, opts = {}) {
  if (!Notification.isSupported()) return null;
  const tag = opts.tag ? String(opts.tag) : '';
  if (tag && tagged.has(tag)) {
    try { tagged.get(tag).close(); } catch { /* já fechada */ }
  }
  const n = new Notification({
    title: String(title ?? ''),
    body: String(body ?? ''),
    icon: ICON,
    silent: opts.silent !== undefined ? !!opts.silent : !!tag,
    ...(['low', 'normal', 'critical'].includes(opts.urgency) ? { urgency: opts.urgency } : {}),
  });
  n.on('click', showWindow);
  if (tag) {
    tagged.set(tag, n);
    n.on('close', () => { if (tagged.get(tag) === n) tagged.delete(tag); });
  }
  n.show();
  return n;
}

function checkBattery(d) {
  if (typeof d.battery !== 'number' || d.online === false || d.sleeping) return;
  const st = alerts.get(d.id) || { low: false, full: false };
  const name = d.name || 'Dispositivo';
  // Bateria fraca: uma vez por ciclo de descarga.
  if (d.charging || d.battery > prefs.lowBattery + 5) st.low = false;
  else if (!st.low && d.battery <= prefs.lowBattery) {
    st.low = true;
    notify('Bateria fraca', `${name} está com ${d.battery}% de bateria.`);
  }
  // Carga completa (opcional).
  if (!d.charging || d.battery < 95) st.full = false;
  else if (!st.full && d.battery >= 100) {
    st.full = true;
    if (prefs.notifyFull) notify('Carga completa', `${name} está com 100% de bateria.`);
  }
  alerts.set(d.id, st);
}

function onStatus(list) {
  if (!Array.isArray(list)) return;
  devices = list.filter((d) => d && typeof d === 'object').map((d) => ({
    id: String(d.id ?? d.name ?? ''),
    name: String(d.name ?? ''),
    kind: d.kind,
    battery: typeof d.battery === 'number' ? Math.round(d.battery) : null,
    charging: !!d.charging,
    mode: d.mode,
    online: d.online,
    sleeping: !!d.sleeping,
  }));
  devices.forEach(checkBattery);
  const key = JSON.stringify(devices);
  if (key !== lastStatus) {
    lastStatus = key;
    updateTray();
  }
}

// ---------- Caps Lock / Num Lock / Scroll Lock ----------
// Lê os LEDs de cada teclado no sysfs (um nó por teclado, inclusive o receptor MCHOSE);
// basta um aceso para contar como ligado. fs.watch não funciona no sysfs, então consulta a cada 300 ms.
const LEDS_DIR = process.env.MHUB_LEDS_DIR || '/sys/class/leds';
const LOCKS = { capslock: 'Caps Lock', numlock: 'Num Lock', scrolllock: 'Scroll Lock' };
let ledFiles = {}; // lock -> [caminhos de brightness]
let lockState = null; // lock -> boolean
let lockTimer = null;
let lockScan = 0;

function scanLeds() {
  const found = { capslock: [], numlock: [], scrolllock: [] };
  let names = [];
  try { names = fs.readdirSync(LEDS_DIR); } catch { /* sem sysfs */ }
  for (const n of names) {
    const m = /^input\d+::(capslock|numlock|scrolllock)$/.exec(n);
    if (m) found[m[1]].push(path.join(LEDS_DIR, n, 'brightness'));
  }
  const changed = JSON.stringify(found) !== JSON.stringify(ledFiles);
  ledFiles = found;
  return changed;
}

function readLocks() {
  const st = {};
  for (const lock of Object.keys(LOCKS)) {
    st[lock] = ledFiles[lock].some((f) => {
      try { return Number(fs.readFileSync(f, 'utf8').trim()) > 0; } catch { return false; }
    });
  }
  return st;
}

function pollLocks() {
  // Teclados entram e saem (receptor, cabo): refaz a lista a cada ~3 s.
  // Se um teclado entrou ou saiu, só atualiza a referência (evita aviso falso ao tirar o receptor).
  const changed = lockScan++ % 10 === 0 && scanLeds();
  const st = readLocks();
  if (lockState && !changed) {
    for (const lock of Object.keys(LOCKS)) {
      if (st[lock] === lockState[lock]) continue;
      if (prefs.lockNotify) {
        notify(`${LOCKS[lock]} ${st[lock] ? 'ativado' : 'desativado'}`, '', { tag: 'lock' });
      }
    }
  }
  lockState = st;
}

function startLockWatch() {
  if (lockTimer) return;
  scanLeds();
  lockState = readLocks(); // estado inicial não gera notificação
  lockTimer = setInterval(pollLocks, 300);
}

ipcMain.on('win', (_e, action) => {
  if (!win) return;
  if (action === 'min') win.minimize();
  else if (action === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
  else if (action === 'close') win.close();
  else if (action === 'devtools') win.webContents.toggleDevTools();
});
ipcMain.on('status', (_e, list) => onStatus(list));
ipcMain.handle('prefs:get', () => ({ ...prefs }));
ipcMain.handle('prefs:set', (_e, key, value) => {
  if (!(key in DEFAULTS)) throw new Error(`Preferência desconhecida: ${key}`);
  prefs[key] = clean(key, value);
  savePrefs();
  if (key === 'autostart') applyAutostart();
  if (key === 'lowBattery') alerts.forEach((st) => { st.low = false; });
});
ipcMain.handle('version', () => app.getVersion());
// Notificação vinda da interface (ex.: troca de DPI). tag 'dpi' respeita a preferência dpiNotify.
ipcMain.on('notify', (_e, title, body, opts) => {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (o.tag === 'dpi' && !prefs.dpiNotify) return;
  notify(title, body, { tag: o.tag, silent: o.silent, urgency: o.urgency });
});

// ---------- Início ----------
// --set-autostart=on|off: grava a preferência e o início automático e sai (usado pelo instalador).
const setAutostart = process.argv.find((a) => a.startsWith('--set-autostart='));
if (setAutostart) {
  let code = 0;
  try {
    loadPrefs();
    prefs.autostart = setAutostart.endsWith('=on');
    savePrefs();
    applyAutostart();
  } catch (e) {
    console.error(e.message);
    code = 1;
  }
  process.exit(code);
} else if (!SHOT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Uma segunda cópia com --hidden (início automático repetido) não abre a janela.
  app.on('second-instance', (_e, argv) => { if (!argv.includes('--hidden')) showWindow(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(() => {
    loadPrefs();
    if (prefs.autostart) {
      try { applyAutostart(); } catch (e) { console.error(e.message); }
    }
    allowHid();
    if (!SHOT) {
      createTray();
      startLockWatch();
    }
    // --hidden só vale com bandeja; sem ela a janela abre normalmente.
    createWindow(process.argv.includes('--hidden') && trayOk);
  });
}
