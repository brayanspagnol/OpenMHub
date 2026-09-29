// Macros: lista (na aba de botões/teclas) e editor em tela cheia, no jeito do M HUB.
// Serve para qualquer aparelho: quem chama passa um adaptador com o que muda entre eles
// (limites, modos de repetição, como ler/gravar e como ligar a macro a um botão ou tecla).
// A lista editável fica no localStorage, por aparelho; o aparelho guarda só os bytes.
//
// Adaptador (ad):
//   drv, ctx            driver (chave do armazenamento) e ctx do app (run, confirm, rerender)
//   noun                'mouse' | 'teclado' (textos)
//   max, nameMax, delayMax, wheel (a gravação aceita a roda?), defaultMode
//   modes               [{ id, icon, name, tip }] na ordem das peças do editor
//   capacity(list, index, name)  ações que ainda cabem na macro `index` (-1 = nova)
//   read()              -> { list, mismatch } lido do aparelho (ou null para manter a local)
//   save(list)          grava a lista inteira no aparelho
//   remove(index, list) desliga a macro apagada, acerta os índices e grava `list`
//   boundIndex          índice ligado ao botão/tecla escolhido (-1 = nenhum)
//   canBind, tip        se dá para ligar agora e a dica acima da lista
//   bind(index, macro)  liga a macro ao botão/tecla escolhido
import { MACRO_TYPE, MACRO_MAX, MACRO_AREA, DEFAULT_KEYS, encodeMacros } from '../drivers/g3v2.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Ícones próprios (traço fino) ---------- */
const svg = (d, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const IC = {
  hold: svg('<path d="M19 12a7 7 0 0 1-12 4.9"/><path d="M5 12a7 7 0 0 1 12-4.9"/><path d="M17 3v4h-4M7 21v-4h4"/><path d="M10.5 9.5l4.5 2-2 .7-.7 2z"/>'),
  toggle: svg('<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="8" cy="12" r="2.6" fill="currentColor"/>'),
  anyKey: svg('<rect x="4" y="4" width="11" height="11" rx="1.5"/><rect x="9" y="9" width="11" height="11" rx="1.5"/>'),
  once: svg('<path d="M4 11V9a3 3 0 0 1 3-3h13l-3-3M20 13v2a3 3 0 0 1-3 3H4l3 3"/><path d="M11 10l1.5-1v6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  close: svg('<path d="M7 7l10 10M17 7 7 17"/>'),
  rec: svg('<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z" fill="currentColor" stroke="none"/>'),
  stop: svg('<circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
};
export const MACRO_ICONS = IC;

/* ---------- Modos de repetição do mouse (code3 da entrada do botão) ---------- */
export const MODES = [
  { id: 2, icon: 'hold', name: 'Repetir enquanto segura', tip: 'A macro se repete enquanto o botão está pressionado e para ao soltar.' },
  { id: 4, icon: 'toggle', name: 'Repetir até apertar de novo', tip: 'A macro se repete até o mesmo botão ser pressionado outra vez.', newFw: true },
  { id: 3, icon: 'anyKey', name: 'Repetir até outra tecla', tip: 'A macro se repete até qualquer tecla ser pressionada.' },
  { id: 0, icon: 'once', name: 'Executar uma vez', tip: 'Cada toque no botão executa a macro uma vez.' },
];
const modeOf = (ad, id) => ad.modes.find((m) => m.id === id) || ad.modes[ad.modes.length - 1];
// O modo 4 só existe em firmware acima de 2.0.0 (regra do M HUB).
function modesFor(drv) {
  const fw = (drv.firmware || '').split('.').map(Number);
  const newer = !drv.firmware || fw[0] > 2 || (fw[0] === 2 && (fw[1] > 0 || fw[2] > 0));
  return MODES.filter((m) => !m.newFw || newer);
}

/* ---------- Teclas: código do navegador -> uso HID ---------- */
const WEB_HID = {
  Digit1: 30, Digit2: 31, Digit3: 32, Digit4: 33, Digit5: 34, Digit6: 35, Digit7: 36, Digit8: 37, Digit9: 38, Digit0: 39,
  KeyA: 4, KeyB: 5, KeyC: 6, KeyD: 7, KeyE: 8, KeyF: 9, KeyG: 10, KeyH: 11, KeyI: 12, KeyJ: 13, KeyK: 14, KeyL: 15, KeyM: 16,
  KeyN: 17, KeyO: 18, KeyP: 19, KeyQ: 20, KeyR: 21, KeyS: 22, KeyT: 23, KeyU: 24, KeyV: 25, KeyW: 26, KeyX: 27, KeyY: 28, KeyZ: 29,
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48, Backslash: 49,
  Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64, F8: 65, F9: 66, F10: 67, F11: 68, F12: 69,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
  NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88, Numpad1: 89, Numpad2: 90, Numpad3: 91, Numpad4: 92, Numpad5: 93,
  Numpad6: 94, Numpad7: 95, Numpad8: 96, Numpad9: 97, Numpad0: 98, NumpadDecimal: 99, IntlBackslash: 100, ContextMenu: 101,
  NumpadEqual: 103, F13: 104, F14: 105, F15: 106, F16: 107, F17: 108, F18: 109, F19: 110, F20: 111, F21: 112, F22: 113,
  F23: 114, F24: 115, Help: 117, AudioVolumeMute: 127, AudioVolumeUp: 128, AudioVolumeDown: 129, NumpadComma: 133,
  IntlRo: 135, IntlYen: 137,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227, OSLeft: 227,
  ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231, OSRight: 231,
};
const SPECIAL = {
  Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab', Space: 'Espaço', CapsLock: 'Caps Lock',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Backquote: '`', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\ (ABNT)', IntlRo: '/ (ABNT)',
  PrintScreen: 'Print Screen', ScrollLock: 'Scroll Lock', PageUp: 'Page Up', PageDown: 'Page Down',
  ArrowRight: '→', ArrowLeft: '←', ArrowDown: '↓', ArrowUp: '↑', NumLock: 'Num Lock', ContextMenu: 'Menu',
  AudioVolumeMute: 'Mudo', AudioVolumeUp: 'Volume +', AudioVolumeDown: 'Volume -',
  ControlLeft: 'Ctrl esq.', ShiftLeft: 'Shift esq.', AltLeft: 'Alt esq.', MetaLeft: 'Super esq.',
  ControlRight: 'Ctrl dir.', ShiftRight: 'Shift dir.', AltRight: 'AltGr', MetaRight: 'Super dir.',
};
const HID_LABEL = {};
for (const [code, hid] of Object.entries(WEB_HID)) {
  if (HID_LABEL[hid]) continue;
  HID_LABEL[hid] = SPECIAL[code] || code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ')
    .replace('Num Divide', 'Num /').replace('Num Multiply', 'Num *').replace('Num Subtract', 'Num -')
    .replace('Num Add', 'Num +').replace('Num Decimal', 'Num ,').replace('Num Equal', 'Num =').replace('Num Comma', 'Num ,');
}
const MOUSE_LABEL = { 1: 'Botão esquerdo', 2: 'Botão direito', 4: 'Botão do meio', 8: 'Voltar', 16: 'Avançar' };
const BUTTON_MASK = [1, 4, 2, 8, 16];   // e.button -> bit do mouse

function itemLabel(it) {
  if (it.t === 'key') return HID_LABEL[it.code] || `Tecla ${it.code}`;
  if (it.t === 'mouse') return MOUSE_LABEL[it.btn] || `Mouse ${it.btn}`;
  if (it.t === 'wheel') return it.up ? 'Roda ↑' : 'Roda ↓';
  return `${it.ms} ms`;
}

/* ---------- Conversão lista editável <-> ações do aparelho ---------- */
// Itens: { t: 'key', code, down } | { t: 'mouse', btn, down } | { t: 'wheel', up } | { t: 'delay', ms }
export function itemsToActions(items) {
  const acts = [];
  for (const it of items) {
    if (it.t === 'delay') {
      if (acts.length) acts[acts.length - 1].delay += Math.max(1, it.ms || 10);
      continue;
    }
    if (it.t === 'key') acts.push({ kind: 'key', code: it.code, down: !!it.down, delay: 0 });
    else if (it.t === 'mouse') acts.push({ kind: 'mouse', code: it.btn, down: !!it.down, delay: 0 });
    else if (it.t === 'wheel') acts.push({ kind: 'wheel', code: it.up ? 1 : 255, down: true, delay: 0 });
  }
  return acts;
}
export function actionsToItems(acts) {
  const items = [];
  acts.forEach((a, i) => {
    if (a.kind === 'key') items.push({ t: 'key', code: a.code, down: a.down });
    else if (a.kind === 'mouse') items.push({ t: 'mouse', btn: a.code, down: a.down });
    else items.push({ t: 'wheel', up: a.code === 1 });
    const last = i === acts.length - 1;
    if ((!last && a.delay > 0) || (last && a.delay > 2)) items.push({ t: 'delay', ms: a.delay });
  });
  return items;
}
const actionCount = (m) => itemsToActions(m.items).length;

/* ---------- Armazenamento local ---------- */
const cache = new Map();          // identidade -> [{ name, type, items }]
const synced = new WeakSet();     // drivers já lidos do aparelho nesta sessão
const syncState = new WeakMap();  // driver -> { mismatch }
const keyFor = (drv) => `mhub.macros.${drv.identity || drv.productId}`;

export function getMacros(drv) {
  const k = keyFor(drv);
  if (!cache.has(k)) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(k) || '[]') || []; } catch { list = []; }
    cache.set(k, Array.isArray(list) ? list : []);
  }
  return cache.get(k);
}
export function setMacros(drv, list) {
  cache.set(keyFor(drv), list);
  try { localStorage.setItem(keyFor(drv), JSON.stringify(list)); } catch { /* sem armazenamento */ }
}

// Lê o aparelho uma vez por sessão (por driver). Sem resposta, tenta de novo no próximo desenho.
async function syncMacros(ad) {
  const { drv } = ad;
  if (synced.has(drv) || !ad.read) return;
  synced.add(drv);
  try {
    const res = await ad.read();
    if (res) {
      setMacros(drv, res.list);
      syncState.set(drv, { mismatch: !!res.mismatch });
    }
  } catch (err) {
    console.warn('macros', err);
    synced.delete(drv);
    return;
  }
  ad.ctx.rerender();
}
export const macrosSynced = (drv) => synced.has(drv);

// Usa o ctx.run do app (aviso e redesenho); sem ele, roda e redesenha.
async function run(ctx, fn, msg) {
  if (ctx.run) return ctx.run(fn, msg);
  try { await fn(); } catch (err) { console.warn(err); }
  ctx.rerender();
}

/* ---------- Lista (genérica) ---------- */
export function macroPanelHtml(ad, q = '') {
  const list = getMacros(ad.drv);
  const shown = list.map((m, i) => ({ m, i })).filter(({ m }) => !q || m.name.toLowerCase().includes(q));
  return `<div class="mx-list">
    <p class="mx-tip">${esc(ad.tip)}</p>
    <button class="btn-outline mx-new" data-act="macro-new" ${list.length >= ad.max ? 'disabled' : ''}>${IC.plus}Nova macro</button>
    <div class="mx-count">Minhas macros <span>(${list.length}/${ad.max})</span>${synced.has(ad.drv) ? '' : `<em>lendo do ${ad.noun}…</em>`}</div>
    ${syncState.get(ad.drv)?.mismatch ? `<div class="mx-warn">As macros gravadas no ${ad.noun} não batem com as deste computador.
      <button class="btn-white sm" data-act="macro-push">Gravar estas no ${ad.noun}</button></div>` : ''}
    <div class="mx-items">
    ${shown.map(({ m, i }) => {
      const on = ad.boundIndex === i;
      return `<div class="mx-item ${on ? 'on' : ''} ${ad.canBind ? '' : 'off'}" data-act="macro-bind" data-i="${i}" title="${esc(modeOf(ad, m.type).name)}">
        <span class="mx-ic">${IC[modeOf(ad, m.type).icon]}</span>
        <span class="mx-name">${esc(m.name)}</span>
        <span class="mx-n">${m.unknown ? 'sem conteúdo' : `${actionCount(m)} ações`}</span>
        <button class="mx-btn" data-act="macro-edit" data-i="${i}" title="Editar">${IC.edit}</button>
        <button class="mx-btn danger" data-act="macro-del" data-i="${i}" title="Apagar">${IC.trash}</button>
      </div>`;
    }).join('') || `<div class="kempty">${list.length ? 'Nada encontrado.' : `Nenhuma macro ainda. ${esc(ad.emptyTip || 'Crie uma e clique nela para ligar a um botão.')}`}</div>`}
    </div>
  </div>`;
}

export function bindMacroPanel(root, ad) {
  const { drv, ctx } = ad;
  if (!root.querySelector('.mx-list')) return;
  syncMacros(ad);
  const on = (sel, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => fn(el, e)));
  on('[data-act="macro-new"]', () => openMacroEditor(ad, -1));
  on('[data-act="macro-push"]', () => run(ctx, async () => {
    await ad.save(getMacros(drv));
    syncState.set(drv, { mismatch: false });
  }, `Macros gravadas no ${ad.noun}`));
  on('[data-act="macro-edit"]', (el, e) => { e.stopPropagation(); openMacroEditor(ad, +el.dataset.i); });
  on('[data-act="macro-del"]', async (el, e) => {
    e.stopPropagation();
    const i = +el.dataset.i;
    const list = getMacros(drv);
    const ok = await ctx.confirm(`Apagar a macro "${list[i]?.name}"?`, ad.deleteTip || 'Os botões ligados a ela voltam à função padrão.');
    if (!ok) return;
    const rest = list.filter((_, j) => j !== i);
    await run(ctx, async () => {
      await ad.remove(i, rest);
      setMacros(drv, rest);
    }, 'Macro apagada');
  });
  on('[data-act="macro-bind"]', (el) => {
    if (!ad.canBind) return;
    const i = +el.dataset.i;
    ad.bind(i, getMacros(drv)[i]);
  });
}

/* ---------- Mouse G3 V2 ---------- */
const toDevice = (list) => list.map((m) => ({ type: m.type, actions: itemsToActions(m.items) }));

// O mouse só devolve os ponteiros das macros (as ações não podem ser relidas), então:
// cabeçalho igual ao que gravaríamos = em dia; senão, macros que só existem no mouse viram
// "sem conteúdo" e, se as locais diferem, aparece o aviso para regravar.
async function readMouse(drv) {
  const dev = await drv.readMacros();
  const local = getMacros(drv);
  const mine = encodeMacros(toDevice(local)).slice(0, 56);
  if (mine.every((b, i) => b === dev.head[i])) return { list: local, mismatch: false };
  const keys = drv.keys || [];
  let differs = false;
  const list = dev.macros.map((d, i) => {
    const l = local[i];
    if (l) { if (d.actions != null && d.actions !== actionCount(l)) differs = true; return l; }
    const bound = keys.find((k) => k.type === MACRO_TYPE && k.code1 === i);
    return { name: `Macro ${i + 1} (do mouse)`, type: bound ? bound.code3 : 0, items: [], unknown: true };
  });
  // Macros locais que o mouse não tem continuam na lista, para poder regravar.
  for (let i = dev.macros.length; i < local.length; i++) list.push(local[i]);
  return { list, mismatch: differs || list.length > dev.macros.length };
}

export function mouseMacroAdapter(ctx, keys, sel) {
  const { drv } = ctx;
  const cur = keys[sel];
  return {
    drv, ctx, noun: 'mouse',
    max: MACRO_MAX, nameMax: 20, delayMax: 16000, wheel: true, defaultMode: 0,
    modes: modesFor(drv),
    capacity: (list, index) => {
      const others = list.reduce((n, m, i) => n + (i === index ? 0 : actionCount(m)), 0);
      return Math.floor((MACRO_AREA - 68 - 4 * others) / 4);
    },
    read: () => readMouse(drv),
    save: (list) => drv.writeMacros(toDevice(list)),
    async remove(idx, list) {
      const old = (ctx.st.keys || drv.keys || DEFAULT_KEYS);
      // Botões da macro apagada voltam ao padrão; os das seguintes acompanham a troca de índice.
      const next = old.map((k, b) => {
        if (k.type !== MACRO_TYPE) return { ...k };
        if (k.code1 === idx) return { ...DEFAULT_KEYS[b] };
        if (k.code1 > idx) return { ...k, code1: k.code1 - 1 };
        return { ...k };
      });
      if (next.some((k, b) => JSON.stringify(k) !== JSON.stringify(old[b]))) await drv.writeKeys(next);
      await drv.writeMacros(toDevice(list));
    },
    boundIndex: cur && cur.type === MACRO_TYPE ? cur.code1 : -1,
    canBind: sel !== 0,
    tip: sel === 0 ? 'O botão esquerdo não recebe macro. Escolha outro botão no mouse ao lado.' : 'Clique numa macro para ligar ao botão selecionado.',
    bind(i, m) {
      const next = (ctx.st.keys || DEFAULT_KEYS).map((k) => ({ ...k }));
      next[sel] = { type: MACRO_TYPE, code1: i, code2: 0, code3: m.type };
      ctx.writeKeys(next);
    },
  };
}

// Interface usada pela aba Botões do mouse (views/mouse.js).
export function macroName(k, drv) {
  const m = getMacros(drv)[k.code1];
  return m ? m.name : `Macro ${k.code1 + 1}`;
}
export function macroListHtml(ctx, keys, sel, q = '') {
  return macroPanelHtml(mouseMacroAdapter(ctx, keys, sel), q);
}
export function bindMacroList(root, ctx) {
  const keys = ctx.st.keys || DEFAULT_KEYS;
  bindMacroPanel(root, mouseMacroAdapter(ctx, keys, ctx.ui.keySel ?? 0));
}

/* ---------- Editor em tela cheia ---------- */
export function openMacroEditor(ad, index) {
  const { drv, ctx } = ad;
  const NAME_MAX = ad.nameMax;
  const DELAY_MAX = ad.delayMax;
  document.querySelector('.mx-overlay')?.remove();
  const all = getMacros(drv);
  const isNew = index < 0;
  const src = isNew ? { name: '', type: -1, items: [] } : all[index];
  const ed = {
    step: isNew ? 'name' : 'edit',
    name: src.name, type: src.type, items: src.items.map((x) => ({ ...x })),
    sel: -1, editDelay: -1, recording: false, dirty: false, saving: false,
    useStd: true, std: 50, last: 0, error: '',
  };
  const modes = ad.modes;
  const maxActions = () => ad.capacity(all, index, ed.name);
  const noun = ad.noun;

  const ov = document.createElement('div');
  ov.className = 'mx-overlay';
  document.body.append(ov);

  const close = () => { stopRec(); ov.remove(); document.removeEventListener('keydown', onEsc, true); };
  const nameTaken = (n) => all.some((m, i) => i !== index && m.name.trim() === n.trim());

  function top(right) {
    return `<div class="mx-top">
      <div class="mx-title">${ed.step === 'name' ? '' : `<input class="mx-name-in" data-e="name" maxlength="${NAME_MAX}" size="${Math.max(6, ed.name.length + 1)}" value="${esc(ed.name)}" placeholder="Nome da macro"><small>${ed.name.length}/${NAME_MAX}</small>`}</div>
      <span class="spacer"></span>${right}
      <button class="btn-white" data-e="exit">Sair</button>
    </div>`;
  }

  function stepName() {
    return `${top('')}<div class="mx-center">
      <input class="mx-bigname" data-e="bigname" maxlength="${NAME_MAX}" placeholder="Nome da macro" value="${esc(ed.name)}">
      <div class="mx-len">${ed.name.length}/${NAME_MAX}</div>
      <div class="mx-help">${ed.error ? `<span class="err">${esc(ed.error)}</span>` : 'Digite o nome e aperte Enter para continuar.'}</div>
    </div>`;
  }

  function stepType() {
    return `${top('')}<div class="mx-center">
      <h2>Escolha o tipo de macro</h2>
      <div class="mx-types">${modes.map((m) => `
        <button class="mx-type" data-e="type" data-v="${m.id}">
          <span class="mx-tile ${ed.type === m.id ? 'on' : ''}">${IC[m.icon]}</span>
          <b>${m.name}</b><small>${m.tip}</small>
        </button>`).join('')}</div>
    </div>`;
  }

  function tile(it, i) {
    const sel = i === ed.sel ? 'sel' : '';
    const del = ed.recording ? '' : `<span class="mx-x" data-e="del" data-i="${i}" title="Apagar">${IC.close}</span>`;
    const add = ed.recording ? '' : `<span class="mx-add" data-e="add-delay" data-i="${i}" title="Inserir atraso depois">${IC.plus}</span>`;
    if (it.t === 'delay') {
      const body = i === ed.editDelay
        ? `<input class="mx-delay-in" data-e="delay-in" data-i="${i}" type="number" min="1" max="${DELAY_MAX}" value="${it.ms}">ms`
        : `<b>${it.ms}</b>ms`;
      return `<div class="mx-act delay ${sel}" data-e="pick" data-i="${i}">${IC.clock}${body}${del}${add}</div>`;
    }
    const dir = it.t === 'wheel' ? '' : `<span class="mx-dir ${it.down ? 'down' : 'up'}" data-e="flip" data-i="${i}" title="${it.down ? 'Pressionar (clique para trocar)' : 'Soltar (clique para trocar)'}">${it.down ? IC.down : IC.up}</span>`;
    return `<div class="mx-act ${it.t} ${it.down === false ? 'is-up' : ''} ${sel}" data-e="pick" data-i="${i}">${dir}<span class="mx-lbl">${esc(itemLabel(it))}</span>${del}${add}</div>`;
  }

  function stepEdit() {
    const n = itemsToActions(ed.items).length;
    const cap = maxActions();
    const dis = ed.recording ? 'disabled' : '';
    const right = `<button class="btn-outline mx-save" data-e="save" ${ed.saving || ed.recording ? 'disabled' : ''}>${ed.saving ? 'Gravando…' : 'Salvar'}</button>
      <button class="btn-white" data-e="clear" ${ed.recording || !ed.items.length ? 'disabled' : ''}>Limpar</button>`;
    return `${top(right)}
    <div class="mx-bar">
      <span class="mx-lab ${ed.recording ? 'dim' : ''}">Tipo</span>
      ${modes.map((m) => `<button class="mx-mini ${ed.type === m.id ? 'on' : ''}" data-e="type" data-v="${m.id}" title="${m.name}: ${m.tip}" ${dis}>${IC[m.icon]}</button>`).join('')}
      <span class="mx-modename">${esc(modeOf(ad, ed.type).name)}</span>
      <span class="spacer"></span>
      <label class="mx-std ${ed.recording ? 'dim' : ''}"><input type="checkbox" data-e="std-on" ${ed.useStd ? 'checked' : ''} ${dis}>Atraso padrão
        <input class="mx-std-in" type="number" data-e="std" min="1" max="${DELAY_MAX}" value="${ed.std}" ${ed.useStd && !ed.recording ? '' : 'disabled'}>ms</label>
    </div>
    <div class="mx-area ${ed.recording ? 'rec' : ''}" data-e="area">
      <div class="mx-acts">${ed.items.map(tile).join('')}</div>
      ${!ed.items.length && !ed.recording ? `<div class="mx-empty">Clique em Gravar e use o teclado e o mouse. Teclas${ad.wheel ? ', cliques e a roda entram' : ' e cliques entram'} na lista com os atrasos entre eles.</div>` : ''}
      ${ed.recording ? `<div class="mx-empty rec">Gravando… teclas${ad.wheel ? ', cliques e a roda' : ' e cliques'} desta área entram na macro.</div>` : ''}
    </div>
    <div class="mx-foot">
      <button class="mx-rec ${ed.recording ? 'stop' : ''}" data-e="rec">${ed.recording ? `${IC.stop}Parar` : `${IC.rec}Gravar`}</button>
      <div class="mx-ins ${ed.recording ? 'dim' : ''}">
        <span>Inserir${ed.sel >= 0 ? ' depois do item marcado' : ''}:</span>
        <button class="btn-white sm" data-e="ins" data-v="delay" ${dis}>${IC.clock}Atraso</button>
        <button class="btn-white sm" data-e="ins" data-v="m1" ${dis}>Clique esquerdo</button>
        <button class="btn-white sm" data-e="ins" data-v="m2" ${dis}>Clique direito</button>
        <button class="btn-white sm" data-e="ins" data-v="m4" ${dis}>Clique do meio</button>
        ${ad.wheel ? `<button class="btn-white sm" data-e="ins" data-v="wu" ${dis}>Roda ↑</button>
        <button class="btn-white sm" data-e="ins" data-v="wd" ${dis}>Roda ↓</button>` : ''}
      </div>
      <span class="spacer"></span>
      <span class="mx-cnt ${n > cap ? 'err' : ''}">${n}/${cap} ações</span>
    </div>
    ${ed.error ? `<div class="mx-error">${esc(ed.error)}</div>` : ''}`;
  }

  function draw() {
    const scroll = ov.querySelector('.mx-area')?.scrollTop;
    ov.innerHTML = `<div class="mx-sheet">${ed.step === 'name' ? stepName() : ed.step === 'type' ? stepType() : stepEdit()}</div>`;
    const area = ov.querySelector('.mx-area');
    if (area) { if (ed.recording) area.scrollTop = area.scrollHeight; else if (scroll) area.scrollTop = scroll; }
    const big = ov.querySelector('[data-e="bigname"]');
    if (big) { big.focus(); big.setSelectionRange(big.value.length, big.value.length); }
    const din = ov.querySelector('[data-e="delay-in"]');
    if (din) { din.focus(); din.select(); }
  }

  const clampDelay = (v) => Math.min(DELAY_MAX, Math.max(1, Math.round(+v || 1)));
  const insertAt = () => (ed.sel >= 0 ? ed.sel + 1 : ed.items.length);
  const change = () => { ed.dirty = true; ed.error = ''; };

  function insert(kind) {
    const at = insertAt();
    const d = { t: 'delay', ms: ed.std };
    let add = [];
    if (kind === 'delay') add = [d];
    else if (kind[0] === 'm') { const btn = +kind.slice(1); add = [{ t: 'mouse', btn, down: true }, { ...d }, { t: 'mouse', btn, down: false }]; }
    else add = [{ t: 'wheel', up: kind === 'wu' }];
    // Separa do vizinho anterior com um atraso, como a gravação faz.
    if (kind !== 'delay' && at > 0 && ed.items[at - 1].t !== 'delay') add.unshift({ ...d });
    ed.items.splice(at, 0, ...add);
    ed.sel = at + add.length - 1;
    change();
    draw();
  }

  /* Gravação: teclado na janela toda; mouse e roda só dentro da área da lista. */
  function push(it, ts) {
    if (itemsToActions(ed.items).length >= maxActions()) { ed.error = `A memória de macros do ${noun} encheu.`; stopRec(); draw(); return; }
    if (ed.items.length && ed.items[ed.items.length - 1].t !== 'delay') {
      ed.items.push({ t: 'delay', ms: ed.useStd ? ed.std : clampDelay(ts - ed.last) });
    }
    ed.last = ts;
    ed.items.push(it);
    change();
    draw();
  }
  const onKey = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    let code = e.code;
    if (!code && e.key === 'Shift') code = 'ShiftRight';
    const hid = WEB_HID[code];
    if (hid == null) return;
    push({ t: 'key', code: hid, down: e.type === 'keydown' }, e.timeStamp);
  };
  const inArea = (e) => e.target.closest?.('.mx-area') && !e.target.closest('button, input');
  const onMouse = (e) => {
    if (!inArea(e)) return;
    e.preventDefault();
    push({ t: 'mouse', btn: BUTTON_MASK[e.button] ?? 1, down: e.type === 'mousedown' }, e.timeStamp);
  };
  const onWheel = (e) => {
    if (!inArea(e)) return;
    e.preventDefault();
    if (!e.deltaY || !ad.wheel) return;
    push({ t: 'wheel', up: e.deltaY < 0 }, e.timeStamp);
  };
  const noMenu = (e) => { if (ed.recording) e.preventDefault(); };
  function startRec() {
    ed.recording = true; ed.sel = -1; ed.editDelay = -1; ed.error = '';
    ed.last = performance.now();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    ov.addEventListener('mousedown', onMouse, true);
    ov.addEventListener('mouseup', onMouse, true);
    ov.addEventListener('wheel', onWheel, { capture: true, passive: false });
    ov.addEventListener('contextmenu', noMenu, true);
    document.activeElement?.blur?.();
  }
  function stopRec() {
    if (!ed.recording) return;
    ed.recording = false;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    ov.removeEventListener('mousedown', onMouse, true);
    ov.removeEventListener('mouseup', onMouse, true);
    ov.removeEventListener('wheel', onWheel, { capture: true });
    ov.removeEventListener('contextmenu', noMenu, true);
  }

  async function exit() {
    if (ed.recording) { stopRec(); draw(); return; }
    if (ed.dirty && ed.step === 'edit') {
      const ok = await ctx.confirm('Sair sem salvar?', 'As mudanças desta macro serão perdidas.');
      if (!ok) return;
    }
    close();
  }
  const onEsc = (e) => { if (e.key === 'Escape' && !ed.recording && !e.target.closest?.('.modal')) { e.preventDefault(); exit(); } };
  document.addEventListener('keydown', onEsc, true);

  async function save() {
    const name = ed.name.trim();
    if (!name) { ed.error = 'Dê um nome para a macro.'; draw(); return; }
    if (nameTaken(name)) { ed.error = 'Já existe uma macro com esse nome.'; draw(); return; }
    // Atraso sobrando no começo não tem ação antes para somar: tira.
    while (ed.items.length && ed.items[0].t === 'delay') ed.items.shift();
    const n = itemsToActions(ed.items).length;
    const cap = maxActions();
    if (!n) { ed.error = 'Grave ou insira pelo menos uma ação.'; draw(); return; }
    if (n > cap) { ed.error = `Macro grande demais: o limite livre é ${cap} ações.`; draw(); return; }
    const macro = { name, type: ed.type < 0 ? ad.defaultMode : ed.type, items: ed.items.map((x) => ({ ...x })) };
    const list = getMacros(drv).map((m) => ({ ...m }));
    const idx = isNew ? list.length : index;
    list[idx] = macro;
    ed.saving = true; draw();
    let ok = false;
    await run(ctx, async () => {
      await ad.save(list);
      setMacros(drv, list);
      ok = true;
    }, `Macro salva no ${noun}`);
    ed.saving = false;
    if (ok) close();
    else { ed.error = `Não foi possível gravar no ${noun}. Veja se ele está ligado.`; draw(); }
  }

  /* Eventos do editor (delegados no overlay) */
  ov.addEventListener('click', (e) => {
    const t = e.target.closest('[data-e]');
    if (!t || ed.recording && t.dataset.e !== 'rec' && t.dataset.e !== 'exit') return;
    const i = +t.dataset.i;
    switch (t.dataset.e) {
      case 'exit': exit(); break;
      case 'type':
        ed.type = +t.dataset.v;
        if (ed.step === 'type') { ed.step = 'edit'; ed.dirty = true; } else change();
        draw(); break;
      case 'rec': if (ed.recording) stopRec(); else startRec(); draw(); break;
      case 'save': save(); break;
      case 'clear': ed.items = []; ed.sel = -1; change(); draw(); break;
      case 'ins': insert(t.dataset.v); break;
      case 'del': e.stopPropagation(); ed.items.splice(i, 1); ed.sel = Math.min(ed.sel, ed.items.length - 1); ed.editDelay = -1; change(); draw(); break;
      case 'add-delay': e.stopPropagation(); ed.items.splice(i + 1, 0, { t: 'delay', ms: ed.std }); ed.sel = i + 1; change(); draw(); break;
      case 'flip': e.stopPropagation(); ed.items[i].down = !ed.items[i].down; ed.sel = i; change(); draw(); break;
      case 'pick':
        if (e.target.closest('input')) return;
        ed.sel = i;
        ed.editDelay = ed.items[i].t === 'delay' ? i : -1;
        draw(); break;
      default:
    }
  });
  ov.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.e === 'bigname' || t.dataset.e === 'name') {
      ed.name = t.value.slice(0, NAME_MAX);
      const len = t.parentElement.querySelector('.mx-len, small');
      if (len) len.textContent = `${ed.name.length}/${NAME_MAX}`;
      if (t.dataset.e === 'name') { ed.dirty = true; t.size = Math.max(6, ed.name.length + 1); }
    }
  });
  ov.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.e === 'std-on') { ed.useStd = t.checked; draw(); }
    if (t.dataset.e === 'std') { ed.std = clampDelay(t.value); draw(); }
    if (t.dataset.e === 'delay-in') { ed.items[+t.dataset.i].ms = clampDelay(t.value); ed.editDelay = -1; change(); draw(); }
    // O nome também ocupa a memória do teclado: atualiza o limite de ações.
    if (t.dataset.e === 'name') draw();
  });
  ov.addEventListener('keydown', (e) => {
    const t = e.target;
    if (ed.recording) return;
    if (t.dataset?.e === 'bigname' && e.key === 'Enter') {
      const n = t.value.trim();
      if (!n) return;
      if (nameTaken(n)) { ed.error = 'Já existe uma macro com esse nome.'; draw(); return; }
      ed.name = n; ed.error = ''; ed.step = 'type'; draw();
    } else if ((t.dataset?.e === 'delay-in' || t.dataset?.e === 'std' || t.dataset?.e === 'name') && e.key === 'Enter') {
      t.blur();
    } else if (!t.closest?.('input') && (e.key === 'Delete' || e.key === 'Backspace') && ed.sel >= 0 && ed.step === 'edit') {
      ed.items.splice(ed.sel, 1); ed.sel = Math.min(ed.sel, ed.items.length - 1); change(); draw();
    }
  });
  ov.addEventListener('focusout', (e) => {
    if (e.target.dataset?.e === 'delay-in' && ed.editDelay >= 0) {
      setTimeout(() => { if (ed.editDelay >= 0 && !ov.querySelector('[data-e="delay-in"]:focus')) { ed.editDelay = -1; draw(); } }, 0);
    }
  });

  draw();
}
