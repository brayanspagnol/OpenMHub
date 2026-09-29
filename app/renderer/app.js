import { icon, batteryIcon } from './icons.js';
import { mouseRender, keyboardRender, receiverRender } from './renders.js';
import { createDriver } from './drivers/index.js';
import { mousePane, bindMousePane } from './views/mouse.js';
import { profilesSidebar, bindProfilesSidebar } from './views/profiles.js';
import { overviewPane, bindOverview } from './views/overview.js';
import { testerPage, bindTester, TESTER_ICON } from './views/tester.js';
import { t, lang, langPref, resolveLang } from './i18n.js';

// Módulos opcionais: se ainda não existirem, o app segue com as ilustrações e sem as abas do teclado.
const optional = (path) => import(path).catch((err) => { console.warn('módulo opcional', path, err.message); return {}; });
const [kbView, images] = await Promise.all([optional('./views/keyboard.js'), optional('./device-images.js')]);

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

const state = {
  view: 'home',          // home | device | settings
  current: null,         // id do aparelho aberto
  tab: 'overview',
  drivers: new Map(),    // chave física -> driver
  status: new Map(),     // chave física -> último status
  theme: store.get('theme', 'light'),
  pollMs: store.get('pollMs', 3000),
  debug: store.get('debug', false),
  homeView: store.get('homeView', 'grid'),
  ui: new Map(),         // id do aparelho -> estado da interface (aba de teclas, DPI em edição...)
  prefs: null,           // preferências do processo principal (bandeja, notificações, autostart)
  flatpak: false,        // rodando no Flatpak: sem início automático, regra udev instalada à mão
};

/* ---------- Tema e barra de título ---------- */
function applyTheme() {
  document.documentElement.setAttribute('theme-mode', state.theme);
  $('#btn-theme').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
}
$('#btn-refresh').innerHTML = icon('refresh');
$('#btn-settings').innerHTML = icon('gear');
$('#btn-refresh').title = t('tb.refresh');
$('#btn-theme').title = t('tb.theme');
$('#btn-settings').title = t('settings');
for (const b of document.querySelectorAll('[data-win]')) {
  b.innerHTML = icon(b.dataset.win);
  b.title = t('tb.' + b.dataset.win);
  b.onclick = () => window.mhub?.win(b.dataset.win);
}
// Troca de tema com círculo que se expande a partir do botão.
$('#btn-theme').onclick = (e) => {
  const flip = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; store.set('theme', state.theme); applyTheme(); };
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return flip();
  const r = e.currentTarget.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(flip).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 520, easing: 'cubic-bezier(.22, 1, .36, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
};
$('#btn-settings').onclick = () => go('settings');
$('#btn-refresh').onclick = async (e) => {
  const b = e.currentTarget; b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
  await rescan(true);
};
window.addEventListener('keydown', (e) => { if (e.key === 'F12') window.mhub?.win('devtools'); });
// Foto do aparelho que não carregou (offline, CDN fora): marca como falha e redesenha;
// deviceImage passa a devolver null e cada tela usa o ícone genérico.
let imgRetry = null;
document.addEventListener('error', (e) => {
  const src = e.target?.tagName === 'IMG' && e.target.getAttribute('src');
  if (!src?.startsWith('mhub-img:') || !images.markFailed) return;
  images.markFailed(src);
  clearTimeout(imgRetry);
  imgRetry = setTimeout(() => render(true), 50);
}, true);

/* ---------- Descoberta de aparelhos ---------- */
// Cada interface USB vira um HIDDevice no WebHID; agrupamos pelo aparelho físico.
function physicalKey(d) {
  return `${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`;
}

async function rescan(force = false) {
  const list = await navigator.hid.getDevices();
  const groups = new Map();
  for (const d of list) {
    const k = physicalKey(d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  for (const [k, drv] of state.drivers) {
    if (!groups.has(k) || force) { await drv.close().catch(() => {}); state.drivers.delete(k); state.status.delete(k); }
  }
  for (const [k, devs] of groups) {
    if (state.drivers.has(k)) continue;
    const drv = createDriver(devs);
    if (!drv) continue;
    drv.onEvent = (ev) => onDeviceEvent(drv, ev);
    state.drivers.set(k, drv);
    try { await drv.open(); } catch (err) { console.warn('open', k, err); }
  }
  // Os cartões aparecem já com a lista de aparelhos; bateria e conexão chegam na leitura seguinte.
  state.scanned = true;
  render();
  await pollAll();
}

let polling = false;
async function pollAll() {
  if (polling) return;
  polling = true;
  try {
    await Promise.all([...state.drivers].map(async ([k, drv]) => {
      try { state.status.set(k, await drv.poll()); }
      catch (err) { console.warn('poll', k, err); state.status.set(k, { ...(state.status.get(k) || {}), error: String(err) }); }
    }));
  } finally { polling = false; }
  state.scanned = true;
  render();
  reportStatus();
}

// Manda um resumo para a bandeja e as notificações de bateria do processo principal.
function reportStatus() {
  const list = logicalDevices().map(({ id, drv, st }) => ({
    id, name: st.name || drv.name, kind: drv.kind, battery: st.battery ?? null, charging: !!st.charging,
    mode: st.mode, online: st.online, sleeping: !!st.sleeping,
  }));
  try { window.mhub?.status?.(list); } catch { /* sem processo principal (teste) */ }
}

navigator.hid.addEventListener('connect', () => rescan());
navigator.hid.addEventListener('disconnect', () => rescan());
let timer = null;
function schedule() { clearInterval(timer); timer = setInterval(pollAll, state.pollMs); }

// Eventos espontâneos dos aparelhos (ex.: botão de DPI do mouse).
function onDeviceEvent(drv, ev) {
  if (ev.type === 'dpi') {
    try { window.mhub?.notify?.(`DPI ${ev.value}`, t('notify.dpi', { n: ev.index + 1, count: ev.count, name: drv.name }), { tag: 'dpi' }); } catch { /* sem processo principal */ }
    render();
  }
}

/* ---------- Aparelhos lógicos ---------- */
// O mesmo mouse pode aparecer pelo cabo e pelo receptor: mostramos um cartão só,
// dando preferência à conexão com fio (como o M HUB faz).
function logicalDevices() {
  const byId = new Map();
  for (const [k, drv] of state.drivers) {
    const st = state.status.get(k) || {};
    const id = drv.identity || k;
    const item = { key: k, id, drv, st };
    const prev = byId.get(id);
    const rank = (x) => (x.st.online === false ? 0 : 10 + (x.st.mode === 'wired' ? 3 : 0) + (x.st.battery != null ? 1 : 0));
    if (!prev || rank(item) > rank(prev)) byId.set(id, item);
  }
  // Cabo ligado mas mudo: a chave do mouse está em 2.4G e o cabo só carrega.
  for (const [k, drv] of state.drivers) {
    const st = state.status.get(k) || {};
    const best = byId.get(drv.identity || k);
    if (st.cableOnly && best && best.key !== k) best.st = { ...best.st, via: `${best.st.via} · ${t('via.cableOnly')}` };
  }
  return [...byId.values()].sort((a, b) => (a.drv.kind === 'mouse' ? 0 : 1) - (b.drv.kind === 'mouse' ? 0 : 1));
}

function statusRow(st) {
  const parts = [];
  if (st.online === false) {
    parts.push(`<span class="st muted">${icon('offline')}${t('st.disconnected')}</span>`);
  } else if (st.charging) {
    const full = st.battery >= 100;
    parts.push(`<span class="st charging ${full ? 'full' : ''}">${batteryIcon(st.battery, !full)}${t(full ? 'st.charged' : 'st.charging')}${st.battery != null ? ` · ${st.battery}%` : ''}</span>`);
  } else if (st.battery != null) {
    const low = st.battery < 20;
    parts.push(`<span class="st ${low ? 'low' : ''}">${batteryIcon(st.battery, false)}${st.battery}%</span>`);
  }
  const modes = { wired: ['wired', t('mode.wired')], '2.4g': ['wifi', '2.4G'], bt: ['bluetooth', 'Bluetooth'] };
  if (st.mode && modes[st.mode] && st.online !== false) parts.push(`<span class="st">${icon(modes[st.mode][0])}${modes[st.mode][1]}</span>`);
  return parts.join('');
}

// Cor escolhida pelo usuário para cada aparelho (o aparelho não informa a cor).
const colorOf = (id) => store.get('color:' + id, null);
// Tipo e VID/PID ajudam a achar o modelo no catálogo de imagens quando o nome não basta.
const imgOpts = (drv) => ({ kind: drv.kind, vendorId: drv.vendorId, productId: drv.productId });
function colorDots(id, model, drv) {
  const list = images.colorsFor?.(model, imgOpts(drv));
  if (!list || list.length < 2) return '';
  const cur = colorOf(id) || list[0].id;
  return `<div class="color-dots">${list.map((c) => `<button class="cdot ${c.id === cur ? 'on' : ''}" style="--dot:${c.hex}" data-color="${c.id}" title="${esc(c.label || c.id)}"></button>`).join('')}</div>`;
}

function renderFor(drv, big, st = {}, id = null) {
  const src = images.deviceImage?.(st.name || drv.name, big ? 'top' : 'card', id ? colorOf(id) : undefined, imgOpts(drv));
  if (src) return `<img class="dev-img ${drv.kind}" src="${esc(src)}" alt="${esc(st.name || drv.name)}" draggable="false">`;
  if (drv.kind === 'keyboard') return keyboardRender(big ? 520 : 340);
  if (drv.kind === 'receiver') return receiverRender(big ? 220 : 160);
  return mouseRender(big ? 330 : 230);
}

/* ---------- Telas ---------- */
let testerCleanup = null;
function go(view, extra = {}) {
  Object.assign(state, { view }, extra);
  render(true);
}

function renderTitle() {
  const left = $('#tb-left');
  const tb = $('#titlebar');
  if (state.view === 'home') {
    tb.classList.remove('bordered');
    left.innerHTML = `<div class="wordmark"><img class="logo" src="../assets/icon.svg" alt="">OpenMHub<small>${t('title.tagline')}</small></div>`;
  } else {
    tb.classList.add('bordered');
    left.innerHTML = `<button class="back-btn" id="back">${icon('home')}${t('title.back')}</button>`;
    $('#back').onclick = () => go('home');
  }
}

// Mesma regra de udev/70-mhub-linux.rules, num comando só para colar no terminal (bash, zsh ou fish).
const UDEV_CMD = `printf '%s\\n' ${['3837', '41e4'].map((v) => `'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="${v}", MODE="0660", TAG+="uaccess"'`).join(' ')}`
  + ' | sudo tee /etc/udev/rules.d/70-mhub-linux.rules >/dev/null'
  + ' && sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=hidraw';

function renderHome() {
  const devs = logicalDevices();
  let cards;
  if (!devs.length && !state.scanned) {
    // Primeira busca ainda em andamento: nada de "não encontrado" piscando na abertura.
    cards = `<div class="empty searching"><div class="spinner"></div><h3>${t('home.searching')}</h3></div>`;
  } else if (!devs.length) {
    cards = `<div class="empty"><div class="empty-ico">${icon('devices')}</div>
      <h3>${t('home.empty')}</h3>
      <p>${t('home.emptyBody')}</p>
      <details ${state.flatpak ? 'open' : ''}><summary>${t('home.notShowing')}</summary>
        ${state.flatpak ? `<p>${t('home.flatpakHelp')}</p>
        <div class="cmd"><code id="udev-cmd">${esc(UDEV_CMD)}</code><button class="btn-white" id="copy-udev">${t('common.copy')}</button></div>`
    : `<p>${t('home.nativeHelp')}</p>`}</details>
    </div>`;
  } else {
    cards = `<div class="cards ${state.homeView === 'list' ? 'list' : ''}">${devs.map(({ id, drv, st }) => `
      <div class="dcard ${st.online === false ? 'offline' : ''} ${st.sleeping ? 'sleeping' : ''}" data-id="${esc(id)}" title="${esc(st.via || '')}">
        <div class="render">${renderFor(drv, false, st, id)}</div>
        <div class="dcard-info">
          ${colorDots(id, st.name || drv.name, drv)}
          <h2>${esc(st.name || drv.name)}</h2>
          <div class="status-row">${statusRow(st)}</div>
        </div>
        ${st.sleeping ? `<div class="sleep-banner">${t('home.sleeping')}</div>` : ''}
      </div>`).join('')}</div>`;
  }
  // Barra como no M HUB atual: grupo de botões à esquerda, visualização grade/lista à direita.
  const list = state.homeView === 'list';
  return `<div class="home">
    <div class="home-bar">
      <div class="hb-group">
        <button id="seg-settings">${icon('settings2')}${t('settings')}</button>
        <button id="seg-tester">${TESTER_ICON}${t('home.tests')}</button>
      </div>
      <span class="spacer"></span>
      <div class="hb-group hb-view">
        <button class="${list ? '' : 'on'}" data-home-view="grid" title="${t('home.grid')}">${icon('grid')}</button>
        <button class="${list ? 'on' : ''}" data-home-view="list" title="${t('home.list')}">${icon('list')}</button>
      </div>
    </div>
    ${cards}
    <p class="home-note">${t('home.note')}</p>
  </div>`;
}

const TABS = {
  mouse: [['overview', 'info', t('tab.overview')], ['keymap', 'keymap', t('tab.buttons')], ['dpi', 'dpi', 'DPI'], ['perf', 'perf', t('tab.perf')], ['others', 'others', t('tab.others')]],
  keyboard: [['overview', 'info', t('tab.overview')], ['light', 'light', t('tab.light')], ['keymap', 'keymap', t('tab.keys')], ['perf', 'perf', t('tab.perf')], ['others', 'others', t('tab.others')]],
};

function renderDevice() {
  const item = logicalDevices().find((x) => x.id === state.current);
  if (!item) { state.view = 'home'; return renderHome(); }
  const { drv, st } = item;
  const tabs = TABS[drv.kind] || TABS.mouse;
  const modeName = { wired: t('mode.wiredUsb'), '2.4g': t('mode.24g'), bt: 'Bluetooth' }[st.mode] || t('common.unknown');
  let pane;
  if (state.tab === 'overview') {
    pane = overviewPane(ctxFor(item), item)
      + (state.debug ? `<div class="scard" style="margin-top:16px"><h3>${t('dev.debug')}</h3><p>${t('dev.debugHint')}</p><div class="raw">${esc(JSON.stringify(st.raw || {}, null, 1))}</div></div>` : '');
  } else if (drv.kind === 'mouse' && st.canWrite) {
    pane = mousePane(state.tab, ctxFor(item));
  } else if (drv.kind === 'keyboard' && kbView.keyboardPane) {
    pane = kbView.keyboardPane(state.tab, ctxFor(item));
  } else {
    pane = `<div class="soon">${t('dev.soon')}</div>`;
  }
  return { pane, shell: (paneHtml) => `<div class="dpage" data-key="${esc(item.id)}|${state.tab}">
    <aside class="side">
      <div class="side-head"><span class="dot ${st.online === false ? 'off' : ''}"></span><h1>${esc(st.name || drv.name)}</h1><span class="badge">Linux</span></div>
      ${profilesSidebar(ctxFor(item))}
      <div class="side-info" data-part="side">
        <span>${t('dev.mode')} <b>${modeName}</b></span>
        ${st.battery != null ? `<span>${t('dev.battery')} <b>${st.battery}%${st.charging ? t('dev.chargingParen') : ''}</b></span>` : ''}
      </div>
    </aside>
    <section class="content">
      <nav class="tabs">
        ${tabs.map(([id, ic, label]) => `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}">${icon(ic)}${label}</button>`).join('')}
        <span class="tab-ink"></span>
        <span class="spacer"></span>
        <div class="status-row" data-part="status">${statusRow(st)}</div>
      </nav>
      <div class="pane">${paneHtml}</div>
    </section>
  </div>` };
}

const SET_TABS = [['general', 'gear', t('set.general')], ['notify', 'info', t('set.notify')], ['tools', 'perf', t('set.tools')], ['about', 'devices', t('set.about')]];
const card = (title, desc, control) => `<div class="toggle-card"><div><b>${title}</b><span>${desc}</span></div>${control}</div>`;
const prefSwitch = (k) => `<button class="switch ${state.prefs?.[k] ? 'on' : ''}" data-pref="${k}"></button>`;

// Configurações no layout do M HUB: menu à esquerda e cartões à direita.
function renderSettings() {
  const tab = state.setTab || 'general';
  const p = state.prefs;
  let body;
  if (tab === 'notify') {
    body = `<h2>${t('set.notify')}</h2>
      ${p ? card(t('set.lowBattery'), t('set.lowBatteryDesc'),
        `<select class="sel" data-pref="lowBattery">${[10, 15, 20, 25, 30].map((v) => `<option value="${v}" ${v === p.lowBattery ? 'selected' : ''}>${v}%</option>`).join('')}</select>`)
      + card(t('set.full'), t('set.fullDesc'), prefSwitch('notifyFull'))
      + ('dpiNotify' in p ? card(t('set.dpi'), t('set.dpiDesc'), prefSwitch('dpiNotify')) : '')
      + ('lockNotify' in p ? card(t('set.lock'), t('set.lockDesc'), prefSwitch('lockNotify')) : '')
      : `<p class="soon">${t('set.installedOnly')}</p>`}`;
  } else if (tab === 'tools') {
    body = `<h2>${t('set.tools')}</h2>
      ${card(t('set.tester'), t('set.testerDesc'), `<button class="btn-white" id="set-tester">${t('set.openTester')}</button>`)}
      ${card(t('set.debug'), t('set.debugDesc'), `<button class="switch ${state.debug ? 'on' : ''}" id="set-debug"></button>`)}`;
  } else if (tab === 'about') {
    body = `<h2>${t('set.about')}</h2>
      <div class="toggle-card about-card"><img src="../assets/icon.svg" alt="">
        <div><b>OpenMHub <span id="app-version"></span></b><span>${t('set.aboutDesc')}</span></div></div>
      ${card(t('set.unofficial'), t('set.unofficialDesc'), '')}
      ${card(t('set.firmware'), t('set.firmwareDesc'), '')}`;
  } else {
    const pref = langPref();
    const langs = [['auto', t('set.langAuto')], ['en', 'English'], ['pt-BR', 'Português (Brasil)']];
    body = `<h2>${t('set.generalTitle')}</h2>
      ${card(t('set.lang'), t('set.langDesc'),
        `<select class="sel" id="set-lang">${langs.map(([v, label]) => `<option value="${v}" ${v === pref ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}
      ${card(t('set.dark'), t('set.darkDesc'), `<button class="switch ${state.theme === 'dark' ? 'on' : ''}" id="set-dark"></button>`)}
      ${card(t('set.poll'), t('set.pollDesc'),
        `<select class="sel" id="set-poll">${[1000, 3000, 5000, 10000].map((v) => `<option value="${v}" ${v === state.pollMs ? 'selected' : ''}>${v / 1000} s</option>`).join('')}</select>`)}
      ${p ? card(t('set.tray'), t('set.trayDesc'), prefSwitch('closeToTray'))
        + (state.flatpak ? '' : card(t('set.autostart'), t('set.autostartDesc'), prefSwitch('autostart'))) : ''}`;
  }
  return `<div class="settings-page">
    <nav class="set-nav">${SET_TABS.map(([id, ic, label]) => `<button class="${id === tab ? 'on' : ''}" data-set-tab="${id}">${icon(ic)}${label}</button>`).join('')}</nav>
    <div class="set-body">${body}</div>
  </div>`;
}

/* ---------- Gravação, avisos e confirmação ---------- */
function uiFor(id) {
  if (!state.ui.has(id)) state.ui.set(id, {});
  return state.ui.get(id);
}

function syncStatus(key, drv) {
  const st = state.status.get(key);
  if (!st || !drv.config) return;
  st.config = drv.config;
  st.keys = drv.keys;
  st.dpi = drv.config.dpis[drv.config.dpiIndex];
}

function ctxFor(item) {
  const { key, id, drv, st } = item;
  const run = async (fn, okMsg) => {
    try {
      await fn();
      syncStatus(key, drv);
      toast(okMsg);
    } catch (err) {
      console.warn(err);
      toast(t('common.saveFailed', { err: err.message || err }), true);
    }
    render(true);
  };
  return {
    drv, st, ui: uiFor(id), id, color: colorOf(id),
    image: (view) => images.deviceImage?.(st.name || drv.name, view, colorOf(id), imgOpts(drv)) || null,
    run: (fn, okMsg = t('common.saved')) => run(fn, okMsg),
    write: (patch) => run(() => drv.writeConfig(patch), t('mouse.saved')),
    writeKeys: (keys) => run(() => drv.writeKeys(keys), t('mouse.keysSaved')),
    rerender: () => render(true),
    confirm,
  };
}

let toastTimer = null;
function toast(msg, error = false) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.append(t); }
  t.innerHTML = `${error ? '' : icon('check')}${esc(msg)}`;
  t.className = `toast show ${error ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function confirm(title, body) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="dialog"><h3>${esc(title)}</h3><p>${esc(body)}</p>
      <div class="dialog-actions"><button class="btn-white" data-r="0">${t('common.cancel')}</button><button class="btn-primary" data-r="1">${t('common.confirm')}</button></div></div>`;
    const done = (v) => { m.remove(); resolve(v); };
    m.addEventListener('click', (e) => { if (e.target === m) done(false); const r = e.target.closest('[data-r]'); if (r) done(r.dataset.r === '1'); });
    document.body.append(m);
    m.querySelector('.btn-primary').focus();
  });
}

// Enquanto o usuário arrasta um controle ou digita, a leitura periódica não redesenha a aba.
let pointerDown = false;
window.addEventListener('pointerdown', () => { pointerDown = true; });
window.addEventListener('pointerup', () => { setTimeout(() => { pointerDown = false; }, 150); });
const interacting = (pane) => pointerDown || (pane && pane.contains(document.activeElement) && document.activeElement.tagName === 'INPUT');

let lastHtml = '';
let lastPane = '';
let lastViewKey = '';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Entrada animada: só quando a tela ou a aba muda, nunca na leitura periódica.
function animateIn(el, cls = 'anim-in') {
  if (!el || reduceMotion) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

// Pílula da aba ativa desliza da aba anterior para a nova.
function placeInk(nav, from) {
  const ink = nav?.querySelector('.tab-ink');
  const act = nav?.querySelector('.tab.active');
  if (!ink || !act) return;
  const to = { l: act.offsetLeft, w: act.offsetWidth };
  if (from && !reduceMotion) {
    ink.style.transition = 'none';
    ink.style.transform = `translateX(${from.l}px)`; ink.style.width = `${from.w}px`;
    void ink.offsetWidth;
    ink.style.transition = '';
  }
  ink.style.transform = `translateX(${to.l}px)`; ink.style.width = `${to.w}px`;
}

// Números (bateria) contam de 0 até o valor na primeira exibição.
function countUp(root) {
  for (const el of root.querySelectorAll('[data-count]')) {
    const target = +el.dataset.count;
    if (reduceMotion || !Number.isFinite(target)) continue;
    const t0 = performance.now(), dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * e) + '%';
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = '0%';
    requestAnimationFrame(step);
  }
  for (const bar of root.querySelectorAll('.meter > div')) {
    if (reduceMotion) continue;
    const w = bar.style.width; bar.style.width = '0'; void bar.offsetWidth; bar.style.width = w;
  }
}

function render(force = false) {
  renderTitle();
  const view = $('#view');
  const viewKey = state.view === 'device' ? `device|${state.current}` : state.view;
  const screenChanged = viewKey !== lastViewKey;
  if (state.view === 'device') {
    const r = renderDevice();
    if (typeof r === 'string') { state.view = 'home'; return render(true); }
    const dkey = `${esc(state.current)}|${state.tab}`;
    const page = view.querySelector('.dpage');
    const pane = page?.querySelector('.pane');
    if (page && page.dataset.key === dkey && !force) {
      // Atualiza só as partes vivas; a aba só é refeita se mudou e ninguém está mexendo nela.
      const tmp = document.createElement('div');
      tmp.innerHTML = r.shell('');
      for (const part of ['side', 'status']) {
        const a = page.querySelector(`[data-part="${part}"]`), b = tmp.querySelector(`[data-part="${part}"]`);
        if (a && b && a.innerHTML !== b.innerHTML) a.innerHTML = b.innerHTML;
      }
      page.querySelector('.side-head .dot')?.classList.toggle('off', tmp.querySelector('.side-head .dot')?.classList.contains('off'));
      if (r.pane !== lastPane && !interacting(pane)) { const sc = pane.scrollTop; pane.innerHTML = r.pane; pane.scrollTop = sc; lastPane = r.pane; bindPane(pane); }
      return;
    }
    const oldInk = view.querySelector('.tab-ink');
    const from = oldInk && !screenChanged ? { l: oldInk.getBoundingClientRect().left - oldInk.parentElement.getBoundingClientRect().left + oldInk.parentElement.scrollLeft, w: oldInk.offsetWidth } : null;
    const tabChanged = !page || page.dataset.key !== dkey;
    const sc = pane && !tabChanged ? pane.scrollTop : 0;
    testerCleanup?.(); testerCleanup = null;
    view.innerHTML = r.shell(r.pane);
    lastPane = r.pane;
    lastHtml = '';
    const newPane = view.querySelector('.pane');
    newPane.scrollTop = sc;
    for (const t of view.querySelectorAll('[data-tab]')) t.onclick = () => go('device', { tab: t.dataset.tab });
    placeInk(view.querySelector('.tabs'), from);
    bindPane(newPane);
    if (screenChanged) { animateIn(view.querySelector('.dpage'), 'anim-page'); countUp(newPane); }
    else if (tabChanged) { animateIn(newPane, 'anim-pane'); countUp(newPane); }
    lastViewKey = viewKey;
    return;
  }
  const html = state.view === 'settings' ? renderSettings() : state.view === 'tester' ? testerPage() : renderHome();
  if (!force && html === lastHtml) return;
  lastHtml = html;
  // Home sem mudança de aparelhos: troca só textos e estado dos cartões, sem refazer as animações.
  if (state.view === 'home' && !screenChanged && patchHome(view, html)) return;
  testerCleanup?.(); testerCleanup = null;
  view.innerHTML = html;
  if (state.view === 'tester') testerCleanup = bindTester(view);
  bindCards(view);
  const s = $('#seg-settings'); if (s) s.onclick = () => go('settings');
  const t = $('#seg-tester'); if (t) t.onclick = () => go('tester');
  for (const b of document.querySelectorAll('[data-home-view]')) b.onclick = () => { state.homeView = b.dataset.homeView; store.set('homeView', state.homeView); lastHtml = ''; render(true); };
  const ts = $('#set-tester'); if (ts) ts.onclick = () => go('tester');
  const cu = $('#copy-udev');
  if (cu) cu.onclick = () => navigator.clipboard.writeText(UDEV_CMD).then(() => toast(t('common.copied')), () => toast(t('common.copyFailed'), true));
  bindSettings();
  if (screenChanged) animateIn(view.firstElementChild, state.view === 'home' ? 'anim-home' : 'anim-page');
  lastViewKey = viewKey;
}

function bindCards(view) {
  for (const c of view.querySelectorAll('.dcard')) {
    c.onclick = (e) => {
      const dot = e.target.closest('[data-color]');
      if (dot) { store.set('color:' + c.dataset.id, dot.dataset.color); lastHtml = ''; return render(); }
      go('device', { current: c.dataset.id, tab: 'overview' });
    };
  }
}

function patchHome(view, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  if (view.querySelector('.cards')?.className !== tmp.querySelector('.cards')?.className) return false;
  if (view.querySelector('.hb-view')?.innerHTML !== tmp.querySelector('.hb-view')?.innerHTML) return false;
  const oldCards = [...view.querySelectorAll('.dcard')], newCards = [...tmp.querySelectorAll('.dcard')];
  if (!oldCards.length || oldCards.length !== newCards.length || oldCards.some((c, i) => c.dataset.id !== newCards[i].dataset.id)) return false;
  oldCards.forEach((a, i) => {
    const b = newCards[i];
    a.className = b.className;
    for (const sel of ['h2', '.sub', '.status-row', '.color-dots']) {
      const x = a.querySelector(sel), y = b.querySelector(sel);
      if (x && y && x.innerHTML !== y.innerHTML) { x.innerHTML = y.innerHTML; if (sel === '.status-row') animateIn(x, 'anim-flash'); }
    }
    const ra = a.querySelector('.render'), rb = b.querySelector('.render');
    if (ra && rb && ra.innerHTML !== rb.innerHTML) ra.innerHTML = rb.innerHTML;
    a.querySelector('.sleep-banner')?.remove();
    const banner = b.querySelector('.sleep-banner');
    if (banner) { a.append(banner); animateIn(banner, 'anim-pop'); }
  });
  return true;
}

function bindPane(pane) {
  const item = logicalDevices().find((x) => x.id === state.current);
  if (!item) return;
  bindProfilesSidebar(pane.closest('.dpage'), ctxFor(item));
  if (state.tab === 'overview') bindOverview(pane, (tab) => go('device', { tab }));
  if (item.drv.kind === 'mouse' && item.st.canWrite) bindMousePane(pane, ctxFor(item));
  else if (item.drv.kind === 'keyboard' && kbView.bindKeyboardPane) kbView.bindKeyboardPane(pane, ctxFor(item));
}

function bindSettings() {
  for (const b of document.querySelectorAll('[data-set-tab]')) b.onclick = () => { state.setTab = b.dataset.setTab; lastHtml = ''; render(true); };
  const ver = $('#app-version'); if (ver) window.mhub?.version?.().then((v) => { ver.textContent = v; }).catch(() => {});
  const dk = $('#set-dark'); if (dk) dk.onclick = () => { $('#btn-theme').click(); render(true); };
  const db = $('#set-debug'); if (db) db.onclick = () => { state.debug = !state.debug; store.set('debug', state.debug); render(true); };
  const sp = $('#set-poll'); if (sp) sp.onchange = () => { state.pollMs = +sp.value; store.set('pollMs', state.pollMs); schedule(); };
  // Idioma: grava, avisa o processo principal (bandeja e notificações) e recarrega a interface.
  const sl = $('#set-lang');
  if (sl) sl.onchange = async () => {
    store.set('lang', sl.value);
    try { await window.mhub?.setLang?.(resolveLang(sl.value)); } catch { /* sem processo principal */ }
    location.reload();
  };
  const setPref = async (k, v) => {
    state.prefs = { ...state.prefs, [k]: v };
    try { await window.mhub?.setPref?.(k, v); } catch (e) { toast(t('common.prefFailed', { err: e.message }), true); }
    render(true);
  };
  for (const b of document.querySelectorAll('[data-pref]')) {
    const k = b.dataset.pref;
    if (b.tagName === 'SELECT') b.onchange = () => setPref(k, +b.value);
    else b.onclick = () => setPref(k, !state.prefs?.[k]);
  }
}

applyTheme();
window.mhub?.setLang?.(lang)?.catch?.(() => {});
render(true);
window.mhub?.getPrefs?.().then((p) => { state.prefs = p; if (state.view === 'settings') render(true); }).catch(() => {});
window.mhub?.env?.().then((e) => { state.flatpak = !!e?.flatpak; render(true); }).catch(() => {});
rescan();
schedule();
