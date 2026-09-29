import { icon, batteryIcon, MCHOSE_LOGO } from './icons.js';
import { mouseRender, keyboardRender, receiverRender } from './renders.js';
import { createDriver } from './drivers/index.js';
import { mousePane, bindMousePane } from './views/mouse.js';
import { profilesSidebar, bindProfilesSidebar } from './views/profiles.js';
import { testerPage, bindTester, TESTER_ICON } from './views/tester.js';

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
};

/* ---------- Tema e barra de título ---------- */
function applyTheme() {
  document.documentElement.setAttribute('theme-mode', state.theme);
  $('#btn-theme').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
}
$('#btn-refresh').innerHTML = icon('refresh');
$('#btn-settings').innerHTML = icon('gear');
for (const b of document.querySelectorAll('[data-win]')) {
  b.innerHTML = icon(b.dataset.win);
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
    try { window.mhub?.notify?.(`DPI ${ev.value}`, `Nível ${ev.index + 1} de ${ev.count} · ${drv.name}`, { tag: 'dpi' }); } catch { /* sem processo principal */ }
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
    if (st.cableOnly && best && best.key !== k) best.st = { ...best.st, via: `${best.st.via} · cabo só carregando` };
  }
  return [...byId.values()].sort((a, b) => (a.drv.kind === 'mouse' ? 0 : 1) - (b.drv.kind === 'mouse' ? 0 : 1));
}

function statusRow(st) {
  const parts = [];
  if (st.online === false) {
    parts.push(`<span class="st muted">${icon('offline')}Desconectado</span>`);
  } else if (st.charging) {
    const full = st.battery >= 100;
    parts.push(`<span class="st charging ${full ? 'full' : ''}">${batteryIcon(st.battery, !full)}${full ? 'Carregado' : 'Carregando'}${st.battery != null ? ` · ${st.battery}%` : ''}</span>`);
  } else if (st.battery != null) {
    const low = st.battery < 20;
    parts.push(`<span class="st ${low ? 'low' : ''}">${batteryIcon(st.battery, false)}${st.battery}%</span>`);
  }
  const modes = { wired: ['wired', 'Com fio'], '2.4g': ['wifi', '2.4G'], bt: ['bluetooth', 'Bluetooth'] };
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
    left.innerHTML = `<div class="wordmark">${MCHOSE_LOGO}MCHOSE<small>HUB Linux</small></div>`;
  } else {
    tb.classList.add('bordered');
    left.innerHTML = `<button class="back-btn" id="back">${icon('home')}Voltar ao início</button>`;
    $('#back').onclick = () => go('home');
  }
}

function renderHome() {
  const devs = logicalDevices();
  let cards;
  if (!devs.length && !state.scanned) {
    // Primeira busca ainda em andamento: nada de "não encontrado" piscando na abertura.
    cards = `<div class="empty searching"><div class="spinner"></div><h3>Procurando seus aparelhos…</h3></div>`;
  } else if (!devs.length) {
    cards = `<div class="empty"><div class="empty-ico">${icon('devices')}</div>
      <h3>Nenhum aparelho conectado ainda</h3>
      <p>Ligue seu mouse ou teclado MCHOSE, pelo cabo ou pelo receptor sem fio. Ele aparece aqui sozinho, sem precisar reabrir o app.</p>
      <details><summary>Já está ligado e não aparece?</summary>
        <p>Tire o receptor ou o cabo e conecte de novo. Se continuar sem aparecer, rode o instalador do M HUB Linux mais uma vez: ele libera o acesso do app aos aparelhos.</p></details>
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
        ${st.sleeping ? '<div class="sleep-banner">Aparelho em repouso. Mexa nele para acordar.</div>' : ''}
      </div>`).join('')}</div>`;
  }
  // Barra como no M HUB atual: grupo de botões à esquerda, visualização grade/lista à direita.
  const list = state.homeView === 'list';
  return `<div class="home">
    <div class="home-bar">
      <div class="hb-group">
        <button id="seg-settings">${icon('settings2')}Configurações</button>
        <button id="seg-tester">${TESTER_ICON}Testes</button>
      </div>
      <span class="spacer"></span>
      <div class="hb-group hb-view">
        <button class="${list ? '' : 'on'}" data-home-view="grid" title="Grade">${icon('grid')}</button>
        <button class="${list ? 'on' : ''}" data-home-view="list" title="Lista">${icon('list')}</button>
      </div>
    </div>
    ${cards}
    <p class="home-note">Nenhum aparelho funciona com o app pelo Bluetooth: use o cabo ou o receptor 2.4G.</p>
  </div>`;
}

const TABS = {
  mouse: [['overview', 'info', 'Visão geral'], ['keymap', 'keymap', 'Botões'], ['dpi', 'dpi', 'DPI'], ['perf', 'perf', 'Desempenho'], ['others', 'others', 'Outros']],
  keyboard: [['overview', 'info', 'Visão geral'], ['light', 'light', 'Iluminação'], ['keymap', 'keymap', 'Teclas'], ['perf', 'perf', 'Desempenho'], ['others', 'others', 'Outros']],
};

function renderDevice() {
  const item = logicalDevices().find((x) => x.id === state.current);
  if (!item) { state.view = 'home'; return renderHome(); }
  const { drv, st } = item;
  const tabs = TABS[drv.kind] || TABS.mouse;
  const modeName = { wired: 'Com fio (USB)', '2.4g': 'Sem fio 2.4G', bt: 'Bluetooth' }[st.mode] || 'Desconhecido';
  let pane;
  if (state.tab === 'overview') {
    const pct = st.battery;
    const cls = st.charging ? 'charging' : pct != null && pct < 20 ? 'low' : '';
    pane = `<div class="grid2">
      <div class="scard">
        <h3>Bateria</h3>
        <p>${st.charging ? 'Carregando pelo cabo USB.' : st.battery != null ? 'Nível informado pelo aparelho.' : 'O aparelho não informou a bateria.'}</p>
        <div class="big-battery">
          <div class="pct" ${pct != null ? `data-count="${pct}"` : ''} style="color:${st.charging ? 'var(--green)' : cls === 'low' ? 'var(--orange)' : 'inherit'}">${pct != null ? pct + '%' : '--'}</div>
          <div class="meter ${cls}"><div style="width:${pct ?? 0}%"></div></div>
        </div>
      </div>
      <div class="scard">
        <h3>Conexão</h3>
        <p>Como o aparelho está falando com o computador agora.</p>
        <dl class="kv">
          <dt>Modo</dt><dd>${modeName}</dd>
          <dt>Estado</dt><dd>${st.online === false ? 'Desligado ou fora de alcance' : st.sleeping ? 'Em repouso' : 'Ativo'}</dd>
          ${st.via ? `<dt>Via</dt><dd>${esc(st.via)}</dd>` : ''}
        </dl>
      </div>
      <div class="scard">
        <h3>Aparelho</h3>
        <dl class="kv">
          <dt>Nome USB</dt><dd>${esc(drv.productName)}</dd>
          <dt>VID:PID</dt><dd>${esc(item.key)}</dd>
          ${st.firmware ? `<dt>Firmware</dt><dd>${esc(st.firmware)}</dd>` : ''}
          ${st.receiverFirmware ? `<dt>Firmware receptor</dt><dd>${esc(st.receiverFirmware)}</dd>` : ''}
          ${st.pollingRate ? `<dt>Taxa de polling</dt><dd>${st.pollingRate} Hz</dd>` : ''}
          ${st.dpi ? `<dt>DPI atual</dt><dd>${st.dpi}</dd>` : ''}
        </dl>
      </div>
      ${st.config ? `<div class="scard">
        <h3>Configuração salva no mouse</h3>
        <p>Lida da memória do aparelho. Altere nas abas DPI e Desempenho.</p>
        <dl class="kv">
          <dt>Estágios de DPI</dt><dd>${st.config.dpis.map((d, i) => i === st.config.dpiIndex ? `<span style="color:var(--accent)">[${d}]</span>` : d).join(' · ')}</dd>
          <dt>Taxa de polling</dt><dd>${st.pollingRate ?? '--'} Hz</dd>
          <dt>LOD</dt><dd>${st.config.lod === 1 || st.config.lod === 2 ? st.config.lod + ' mm' : 'Padrão'}</dd>
          <dt>Debounce</dt><dd>${st.config.debounce} ms</dd>
          <dt>Repouso</dt><dd>${st.config.sleep ? st.config.sleep + ' min' : 'Nunca'}</dd>
          <dt>Motion Sync</dt><dd>${st.config.sensor & 32 ? 'Ligado' : 'Desligado'}</dd>
          <dt>Correção de linha</dt><dd>${st.config.sensor & 1 ? 'Ligada' : 'Desligada'}</dd>
          <dt>Controle de ripple</dt><dd>${st.config.sensor & 16 ? 'Ligado' : 'Desligado'}</dd>
        </dl>
      </div>` : ''}
      ${state.debug ? `<div class="scard"><h3>Depuração</h3><p>Últimas respostas HID.</p><div class="raw">${esc(JSON.stringify(st.raw || {}, null, 1))}</div></div>` : ''}
    </div>`;
  } else if (drv.kind === 'mouse' && st.canWrite) {
    pane = mousePane(state.tab, ctxFor(item));
  } else if (drv.kind === 'keyboard' && kbView.keyboardPane) {
    pane = kbView.keyboardPane(state.tab, ctxFor(item));
  } else {
    pane = `<div class="soon">Esta seção chega nas próximas versões.</div>`;
  }
  return { pane, shell: (paneHtml) => `<div class="dpage" data-key="${esc(item.id)}|${state.tab}">
    <aside class="side">
      <div class="side-head"><span class="dot ${st.online === false ? 'off' : ''}"></span><h1>${esc(st.name || drv.name)}</h1><span class="badge">Linux</span></div>
      ${profilesSidebar(ctxFor(item))}
      <div class="side-info" data-part="side">
        <span>Modo: <b>${modeName}</b></span>
        ${st.battery != null ? `<span>Bateria: <b>${st.battery}%${st.charging ? ' (carregando)' : ''}</b></span>` : ''}
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

const SET_TABS = [['general', 'gear', 'Geral'], ['notify', 'info', 'Notificações'], ['tools', 'perf', 'Ferramentas'], ['about', 'devices', 'Sobre']];
const card = (title, desc, control) => `<div class="toggle-card"><div><b>${title}</b><span>${desc}</span></div>${control}</div>`;
const prefSwitch = (k) => `<button class="switch ${state.prefs?.[k] ? 'on' : ''}" data-pref="${k}"></button>`;

// Configurações no layout do M HUB: menu à esquerda e cartões à direita.
function renderSettings() {
  const tab = state.setTab || 'general';
  const p = state.prefs;
  let body;
  if (tab === 'notify') {
    body = `<h2>Notificações</h2>
      ${p ? card('Aviso de bateria fraca', 'Notificação quando um aparelho fora do carregador chega a este nível.',
        `<select class="sel" data-pref="lowBattery">${[10, 15, 20, 25, 30].map((v) => `<option value="${v}" ${v === p.lowBattery ? 'selected' : ''}>${v}%</option>`).join('')}</select>`)
      + card('Aviso de carga completa', 'Notificação quando um aparelho carregando chega a 100%.', prefSwitch('notifyFull'))
      + ('dpiNotify' in p ? card('Aviso de troca de DPI', 'Mostra o novo DPI quando você aperta o botão de DPI do mouse.', prefSwitch('dpiNotify')) : '')
      + ('lockNotify' in p ? card('Aviso de Caps Lock e Num Lock', 'Mostra na tela quando Caps Lock, Num Lock ou Scroll Lock liga ou desliga.', prefSwitch('lockNotify')) : '')
      : '<p class="soon">Disponível no app instalado.</p>'}`;
  } else if (tab === 'tools') {
    body = `<h2>Ferramentas</h2>
      ${card('Teste de mouse e teclado', 'Veja se cada tecla e botão responde, rollover, duplo clique anormal e taxa de polling.', '<button class="btn-white" id="set-tester">Abrir teste</button>')}
      ${card('Modo de depuração', 'Mostra as respostas HID brutas na página do aparelho.', `<button class="switch ${state.debug ? 'on' : ''}" id="set-debug"></button>`)}`;
  } else if (tab === 'about') {
    body = `<h2>Sobre</h2>
      <div class="toggle-card about-card"><img src="../assets/icon.svg" alt="">
        <div><b>M HUB Linux <span id="app-version"></span></b><span>Configurador não oficial para mouses e teclados MCHOSE no Linux. Não é afiliado à MCHOSE.</span></div></div>
      ${card('Atualização de firmware', 'Não é feita por este app, para não arriscar o aparelho. Use o M HUB oficial no Windows.', '')}`;
  } else {
    body = `<h2>Configurações gerais</h2>
      ${card('Tema escuro', 'Usa as cores do modo escuro do M HUB.', `<button class="switch ${state.theme === 'dark' ? 'on' : ''}" id="set-dark"></button>`)}
      ${card('Intervalo de atualização', 'Com que frequência a bateria e a conexão são lidas.',
        `<select class="sel" id="set-poll">${[1000, 3000, 5000, 10000].map((v) => `<option value="${v}" ${v === state.pollMs ? 'selected' : ''}>${v / 1000} s</option>`).join('')}</select>`)}
      ${p ? card('Fechar para a bandeja', 'O botão fechar esconde a janela; o app segue avisando sobre a bateria.', prefSwitch('closeToTray'))
        + card('Iniciar com o sistema', 'Abre minimizado na bandeja ao entrar na sessão.', prefSwitch('autostart')) : ''}`;
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
      toast('Não foi possível gravar: ' + (err.message || err), true);
    }
    render(true);
  };
  return {
    drv, st, ui: uiFor(id), id, color: colorOf(id),
    image: (view) => images.deviceImage?.(st.name || drv.name, view, colorOf(id), imgOpts(drv)) || null,
    run: (fn, okMsg = 'Salvo') => run(fn, okMsg),
    write: (patch) => run(() => drv.writeConfig(patch), 'Salvo no mouse'),
    writeKeys: (keys) => run(() => drv.writeKeys(keys), 'Botões salvos no mouse'),
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
      <div class="dialog-actions"><button class="btn-white" data-r="0">Cancelar</button><button class="btn-primary" data-r="1">Confirmar</button></div></div>`;
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
  if (item.drv.kind === 'mouse' && item.st.canWrite) bindMousePane(pane, ctxFor(item));
  else if (item.drv.kind === 'keyboard' && kbView.bindKeyboardPane) kbView.bindKeyboardPane(pane, ctxFor(item));
}

function bindSettings() {
  for (const b of document.querySelectorAll('[data-set-tab]')) b.onclick = () => { state.setTab = b.dataset.setTab; lastHtml = ''; render(true); };
  const ver = $('#app-version'); if (ver) window.mhub?.version?.().then((v) => { ver.textContent = v; }).catch(() => {});
  const dk = $('#set-dark'); if (dk) dk.onclick = () => { $('#btn-theme').click(); render(true); };
  const db = $('#set-debug'); if (db) db.onclick = () => { state.debug = !state.debug; store.set('debug', state.debug); render(true); };
  const sp = $('#set-poll'); if (sp) sp.onchange = () => { state.pollMs = +sp.value; store.set('pollMs', state.pollMs); schedule(); };
  const setPref = async (k, v) => {
    state.prefs = { ...state.prefs, [k]: v };
    try { await window.mhub?.setPref?.(k, v); } catch (e) { toast('Não foi possível salvar: ' + e.message, true); }
    render(true);
  };
  for (const b of document.querySelectorAll('[data-pref]')) {
    const k = b.dataset.pref;
    if (b.tagName === 'SELECT') b.onchange = () => setPref(k, +b.value);
    else b.onclick = () => setPref(k, !state.prefs?.[k]);
  }
}

applyTheme();
render(true);
window.mhub?.getPrefs?.().then((p) => { state.prefs = p; if (state.view === 'settings') render(true); }).catch(() => {});
rescan();
schedule();
