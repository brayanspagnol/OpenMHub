// Abas do teclado (Iluminação, Teclas, Desempenho, Outros), no layout do M HUB.
// ctx = { drv, st, ui, run(fn, msg), rerender(), confirm(título, texto) }
import { icon } from '../icons.js';
import {
  LAYOUT, LAYOUT_W, LAYOUT_H, LOCKED, BASIC_KEYS, MOUSE_KEYS, MEDIA_KEYS, SHORTCUT_KEYS, OTHER_KEYS,
  LAYER_KEYS, LAYERS, LIGHT_EFFECTS, PALETTE,
} from '../data/keyboard-ut98.js';
import { macroPanelHtml, bindMacroPanel, getMacros, itemsToActions, actionsToItems } from './macros.js';
import { KB_MACRO_TYPE, KB_MACRO_AREA, KB_MACRO_MAX, KB_MACRO_MODES, macroKey, macroBytes } from '../drivers/sinowealth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toHex = (rgb) => '#' + (rgb || [0, 0, 0]).map((v) => v.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const sameVal = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

/* ---------- Funções atribuíveis ---------- */
const CATS = [
  ['basic', 'Teclas', BASIC_KEYS],
  ['mouse', 'Mouse', MOUSE_KEYS],
  ['media', 'Mídia', MEDIA_KEYS],
  ['shortcut', 'Atalhos', SHORTCUT_KEYS],
  ['other', 'Outros', OTHER_KEYS],
  ['macros', 'Macros', []],
];
const ALL_FUNCS = [...CATS.flatMap(([, , list]) => list), ...LAYER_KEYS];
// Funções da categoria; Fn e Fn2 só aparecem na camada normal (regra do M HUB).
const catList = (cat, layer) => (cat === 'other' && layer === 0 ? [...OTHER_KEYS, ...LAYER_KEYS] : (CATS.find((c) => c[0] === cat) || CATS[0])[2]);

const layerName = (v) => (v[1] === 1 ? 'Fn2' : 'Fn');
const knownName = (v) => ALL_FUNCS.find((x) => sameVal(x.slice(1), v))?.[0] || (v[0] === 13 ? layerName(v) : '');
// Valor de fábrica da tecla na camada (a Fn2 vem vazia).
const defOf = (k, layer) => (layer === 2 ? [0, 0, 0, 0] : layer ? k.f : k.d);

// Nome curto do que a tecla faz. Valores de fábrica sem nome na lista viram "Função de fábrica".
function funcName(v, key, layer, macros = []) {
  if (!v) return '--';
  const f = ALL_FUNCS.find((x) => sameVal(x.slice(1), v));
  if (f) return f[0];
  if (v[0] === 13) return layerName(v);
  if (v[0] === KB_MACRO_TYPE) return `Macro: ${macros[v[3]]?.name || v[3] + 1}`;
  if (key && sameVal(v, defOf(key, layer))) return 'Função de fábrica';
  return `Código ${v.join(':')}`;
}

/* ---------- Desenho do teclado ---------- */
// Teclas em posição absoluta, em % do desenho, para escalar com a largura.
function keyboardFig({ sel, cls = () => '', label = (k) => esc(k.l), style = () => '', act = 'kb-key', title = (k) => k.l }) {
  const keys = LAYOUT.map((k) => {
    const pos = `left:${(k.x / LAYOUT_W) * 100}%;top:${(k.y / LAYOUT_H) * 100}%;width:${(k.w / LAYOUT_W) * 100}%;height:${((k.h || 42) / LAYOUT_H) * 100}%;`;
    return `<button class="kbk ${k.knob ? 'knob' : ''} ${sel === k.k ? 'on' : ''} ${cls(k)}" style="${pos}${style(k)}" data-act="${act}" data-k="${esc(k.k)}" title="${esc(title(k))}">${label(k)}</button>`;
  }).join('');
  return `<div class="kbfig"><div class="kbfig-in" style="aspect-ratio:${LAYOUT_W}/${LAYOUT_H}">${keys}</div></div>`;
}

/* ---------- Abas ---------- */
export function keyboardPane(tab, ctx) {
  const { st } = ctx;
  if (st.online === false) return `<div class="soon">Ligue o teclado ou aperte uma tecla para acordar. As configurações aparecem quando ele responder.</div>`;
  if (!st.kb) {
    if (st.model && !st.canWrite) return `<div class="soon">Modelo ${esc(st.model)}: a configuração deste teclado ainda não é suportada.</div>`;
    if (st.sleeping) return `<div class="soon">Teclado em repouso. Aperte uma tecla para acordar; a configuração é lida em seguida.</div>`;
    return `<div class="soon">Lendo a configuração do teclado…</div>`;
  }
  const banner = st.sleeping ? `<div class="kb-sleep">${icon('info')}Teclado em repouso: aperte uma tecla antes de mudar algo.</div>` : '';
  let body = '';
  if (tab === 'light') body = lightPane(ctx);
  else if (tab === 'keymap') body = keymapPane(ctx);
  else if (tab === 'perf') body = perfPane(ctx);
  else if (tab === 'others') body = othersPane(ctx);
  return banner + body;
}

/* ---------- Iluminação ---------- */
const effectOf = (id) => LIGHT_EFFECTS.find((e) => e.id === id) || LIGHT_EFFECTS[LIGHT_EFFECTS.length - 1];
// Brilho guardado de 0 a 20 (passos de 5); a interface mostra de 0 a 4 (o M HUB mostra 1 a 4).
const uiBright = (raw) => (raw === 4 ? 4 : Math.min(4, Math.round(raw / 5)));

function lightPane({ st, ui }) {
  const perf = st.kb.performance;
  const cur = perf.lightMode;
  const eff = effectOf(cur);
  const m = perf.modes[cur];
  // Cor em uso: a da paleta indicada pelo efeito (a tecla Fn do teclado troca essa posição).
  const pal = st.kb.lighting.palettes?.[cur];
  const color = toHex(pal && m && m.colorIdx < 7 ? pal[m.colorIdx] : st.kb.lighting.colors[cur]);
  const multi = m ? m.multi : false;
  const tiles = LIGHT_EFFECTS.map((e) => `<button class="lfx ${e.id === cur ? 'on' : ''}" data-act="lfx" data-v="${e.id}">
      <span class="lfx-ico fx-${e.id}"></span><span class="lfx-name">${e.name}</span></button>`).join('');

  let right;
  if (eff.custom) {
    const paint = ui.paint || '#ff0000';
    const pend = ui.diyPending || {};
    const diy = st.kb.diy || {};
    right = `<div class="pcard"><div class="pcard-head"><div><h3>Cores por tecla</h3>
        <p>Escolha a cor e clique nas teclas para pintar. Depois salve no teclado.</p></div></div>
      <div class="swatches">${PALETTE.map((c) => `<button class="sw ${c === paint ? 'on' : ''}" style="--sw:${c}" data-act="paint" data-v="${c}"></button>`).join('')}
        <label class="sw-pick" title="Outra cor"><input type="color" data-act="paint-pick" value="${paint}"></label>
        <button class="sw off ${paint === '#000000' ? 'on' : ''}" data-act="paint" data-v="#000000" title="Apagada"></button></div>
      <div class="kb-actions">
        <button class="btn-outline" data-act="paint-all">Pintar todas</button>
        <span class="spacer"></span>
        <button class="btn-ghost" data-act="diy-cancel" ${Object.keys(pend).length ? '' : 'disabled'}>Descartar</button>
        <button class="btn-primary" data-act="diy-save" ${Object.keys(pend).length ? '' : 'disabled'}>Salvar cores</button>
      </div></div>`;
    const figure = keyboardFig({
      act: 'diy-key',
      style: (k) => { const c = pend[k.k] || toHex(diy[k.k]); return `--kc:${c}`; },
      cls: (k) => (pend[k.k] ? 'painted lit' : 'lit'),
    });
    return `<div class="kb-light">
      <div class="lfx-grid">${tiles}</div>
      <div class="kb-light-side">${right}</div>
    </div>
    <div class="kb-diy">${figure}</div>`;
  }

  const bDis = !eff.b, sDis = !eff.s, cDis = !eff.c;
  const bright = m ? uiBright(m.brightness) : 4;
  const speed = m ? m.speed : 3;
  right = `
    <div class="pcard ${bDis && sDis ? 'dim' : ''}"><div class="pcard-head"><div><h3>Velocidade e brilho</h3>
      <p>${bDis && sDis ? 'Este efeito não tem ajuste.' : 'Valem só para o efeito escolhido.'}</p></div></div>
      ${slider('lspeed', 0, 5, speed, 'Velocidade', sDis)}
      ${slider('lbright', 0, 4, bright, 'Brilho', bDis)}
    </div>
    <div class="pcard ${cDis ? 'dim' : ''}"><div class="pcard-head"><div><h3>Cor</h3>
      <p>${cDis ? 'Este efeito usa as cores próprias.' : 'Colorido alterna as cores do arco-íris; cor única usa a cor abaixo.'}</p></div></div>
      <div class="radios">
        ${radio('lmulti', 1, !cDis && multi, 'Colorido', cDis)}
        ${radio('lmulti', 0, !cDis && !multi, 'Cor única', cDis)}
      </div>
      <div class="swatches ${cDis || multi ? 'disabled' : ''}">
        ${PALETTE.map((c) => `<button class="sw ${c === color ? 'on' : ''}" style="--sw:${c}" data-act="lcolor" data-v="${c}" ${cDis || multi ? 'disabled' : ''}></button>`).join('')}
        <label class="sw-pick" title="Outra cor"><input type="color" data-act="lcolor-pick" value="${color}" ${cDis || multi ? 'disabled' : ''}></label>
        <span class="sw-hex">${color.toUpperCase()}</span>
      </div>
    </div>`;
  return `<div class="kb-light">
    <div class="lfx-grid">${tiles}</div>
    <div class="kb-light-side">${right}</div>
  </div>`;
}

function slider(act, min, max, value, label, disabled = false) {
  const pct = ((value - min) / (max - min)) * 100;
  return `<div class="kslider ${disabled ? 'disabled' : ''}">
    <label>${label}</label>
    <div class="pslider" style="--p:${pct}%;--c:${disabled ? 'var(--border)' : 'var(--accent)'}">
      <input type="range" data-act="${act}" min="${min}" max="${max}" step="1" value="${value}" ${disabled ? 'disabled' : ''}>
    </div>
    <b data-val>${value}</b>
  </div>`;
}
const radio = (act, value, on, label, disabled = false) => `<button class="radio ${on ? 'on' : ''}" data-act="${act}" data-v="${value}" ${disabled ? 'disabled' : ''}><span class="dot"></span>${label}</button>`;
const sw = (act, on, disabled = false) => `<button class="switch ${on ? 'on' : ''}" data-act="${act}" role="switch" aria-checked="${on}" ${disabled ? 'disabled' : ''}></button>`;

/* ---------- Teclas ---------- */
function keymapPane(ctx) {
  const { st, ui, drv } = ctx;
  const layer = ui.kbLayer || 0;
  const keys = st.kb.keys[layer] || {};
  const sel = ui.kbSel;
  const selKey = LAYOUT.find((k) => k.k === sel);
  const cat = ui.kbCat || 'basic';
  const q = (ui.kbSearch || '').trim().toLowerCase();
  const list = catList(cat, layer).filter((f) => !q || f[0].toLowerCase().includes(q));
  const cur = sel ? keys[sel] : null;
  const macros = getMacros(drv);

  const figure = keyboardFig({
    sel,
    cls: (k) => {
      const v = keys[k.k];
      const changed = v && !sameVal(v, defOf(k, layer));
      return `${LOCKED.includes(k.k) ? 'locked' : ''} ${changed ? 'changed' : ''}`;
    },
    label: (k) => {
      const v = keys[k.k];
      const changed = v && !sameVal(v, defOf(k, layer));
      // Na camada Fn mostra o nome das funções conhecidas; as de fábrica sem nome ganham só um ponto.
      let sub = '';
      if (changed) sub = funcName(v, k, layer, macros);
      else if (layer && v && !sameVal(v, [0, 0, 0, 0])) sub = knownName(v) || '•';
      return `<span class="kl">${esc(k.l)}</span>${sub ? `<span class="ks">${esc(sub)}</span>` : ''}`;
    },
    title: (k) => `${k.l}: ${funcName(keys[k.k], k, layer, macros)}`,
  });

  return `<div class="kb-map">
    <div class="kb-top">
      ${figure}
      <div class="kb-layers">
        ${LAYERS.map((l) => `<button class="kb-layer ${layer === l.id ? 'on' : ''}" data-act="kb-layer" data-v="${l.id}">${l.name}</button>`).join('')}
        <button class="btn-ghost" data-act="kb-reset">${icon('undo')}Restaurar padrão</button>
      </div>
    </div>
    <div class="kb-sel">${sel ? `<b>${esc(selKey?.l || sel)}</b><span>${LAYERS[layer].prefix} faz agora: <b>${esc(funcName(cur, selKey, layer, macros))}</b></span>`
      : '<span>Clique numa tecla do desenho e depois escolha a função abaixo.</span>'}</div>
    <div class="kb-funcs">
      <div class="kb-funcs-head">
        <div class="kb-cats">${CATS.map(([id, label]) => `<button class="kb-cat ${cat === id ? 'on' : ''}" data-act="kb-cat" data-v="${id}">${label}</button>`).join('')}</div>
        <span class="spacer"></span>
        <div class="ksearch">${icon('search')}<input data-act="kb-search" placeholder="Buscar função" value="${esc(ui.kbSearch || '')}"></div>
      </div>
      ${cat === 'macros' ? `<div class="kb-macros">${macroPanelHtml(kbMacroAdapter(ctx), q)}</div>` : `<div class="kb-flist ${cat === 'basic' ? 'grid' : ''} ${sel ? '' : 'idle'}">
        ${list.map((f) => `<button class="kitem ${cur && sameVal(f.slice(1), cur) ? 'on' : ''}" data-act="kb-set" data-v="${f.slice(1).join(',')}" ${sel ? '' : 'disabled'}>${esc(f[0])}</button>`).join('') || '<div class="kempty">Nada encontrado.</div>'}
      </div>`}
    </div>
  </div>`;
}

/* ---------- Desempenho ---------- */
function card(title, desc, control, extra = '') {
  return `<div class="pcard ${extra}"><div class="pcard-head"><div><h3>${title}</h3><p>${desc}</p></div>${control.inline || ''}</div>${control.below || ''}</div>`;
}

function perfPane({ st }) {
  const p = st.kb.performance;
  const never = p.sleep === 0;
  const mins = never ? 1 : p.sleepMin;
  const pct = ((mins - 0.5) / (20 - 0.5)) * 100;
  const left = [
    card('Hibernação <small>(minutos)</small>', 'Sem uso por esse tempo em 2.4G ou Bluetooth, o teclado entra em repouso.', {
      below: `<div class="row-gap"><div class="pslider" style="--p:${pct}%;--c:var(--accent)">
          <input type="range" data-act="kb-sleep" min="0.5" max="20" step="0.5" value="${mins}">
          <div class="pval"><b data-val>${mins}</b> min</div></div>
        ${radio('kb-sleep-never', 1, never, 'Nunca dormir')}</div>`,
    }),
    card('Taxa de polling <small>(Hz)</small>', 'Neste modelo a taxa é fixa em 1000 Hz.', {
      below: `<div class="radios">${radio('none', 0, true, '1000')}</div>`,
    }),
  ];
  const right = [
    card('Top Speed (baixa latência)', 'Modo de latência ultrabaixa. Se alguma tecla repetir sozinha (duplo toque), desligue.', { inline: sw('kb-fast', p.fastMode) }),
    card('Modo Mac', 'Troca o layout das teclas especiais para o macOS. Ligar desativa o bloqueio da tecla Win.', { inline: sw('kb-mac', p.mac) }),
    card('Bloquear tecla Win', 'A tecla Win (Super) deixa de funcionar, para não sair do jogo sem querer.', { inline: sw('kb-win', p.winLock, p.mac) }, p.mac ? 'dim' : ''),
  ];
  return `<div class="perf-grid"><div class="col">${left.join('')}</div><div class="col">${right.join('')}</div></div>`;
}

/* ---------- Outros ---------- */
function othersPane({ st, drv }) {
  const id = `${drv.vendorId.toString(16).padStart(4, '0')}:${drv.productId.toString(16).padStart(4, '0')}`;
  return `<div class="others kb-others">
    <div class="kb-others-fig">${keyboardFig({ cls: () => 'ro', label: () => '' })}</div>
    <div class="others-cards">
      <div class="ocard"><div><h3>Modelo: ${esc(st.kb.model || st.model || '--')}</h3>
        <p>Identificado pelo próprio teclado (código ${esc(drv.raw?.kb?.password || '--')}).</p></div>
        <button class="btn-white" data-act="kb-reload">Reler</button></div>
      <div class="ocard"><div><h3>Firmware do teclado: --</h3>
        <p>O protocolo não informa a versão. Atualização de firmware não é suportada no Linux; use o M HUB oficial.</p></div>
        <button class="btn-white" disabled>Atualizar</button></div>
      ${drv.wired ? `<div class="ocard"><div><h3>Conectado pelo cabo</h3>
        <p>${esc(drv.productName || 'Teclado MCHOSE')} (${id}). Suporte ao modo com fio ainda em teste.</p></div></div>`
      : `<div class="ocard"><div><h3>Receptor 2.4G</h3>
        <p>SINOWEALTH ${esc(drv.productName || '')} (${id}).</p></div>
        <button class="btn-white" disabled>Atualizar</button></div>`}
      <div class="ocard"><div><h3>Parear o receptor</h3>
        <p>Com o teclado no modo 2.4G, segure Fn + \` por 3 segundos até a luz piscar e deixe o receptor conectado ao computador perto do teclado.</p></div></div>
      <div class="ocard"><div><h3>Restaurar configurações de fábrica</h3>
        <p>${drv.wired ? 'Pelo cabo esta função não está disponível. Use o receptor 2.4G.' : 'Iluminação, teclas, desempenho e macros voltam ao padrão. Faça isso com cuidado.'}</p></div>
        <button class="btn-white" data-act="kb-factory" ${drv.wired ? 'disabled' : ''}>Restaurar</button></div>
    </div>
  </div>`;
}

/* ---------- Macros ---------- */
const KB_MODES = [
  { id: KB_MACRO_MODES.hold, icon: 'hold', name: 'Repetir enquanto segura', tip: 'A macro se repete enquanto a tecla está pressionada e para ao soltar.' },
  { id: KB_MACRO_MODES.anyKey, icon: 'anyKey', name: 'Repetir até outra tecla', tip: 'A macro se repete até outra tecla ser pressionada.' },
  { id: KB_MACRO_MODES.once, icon: 'once', name: 'Executar uma vez', tip: 'Cada toque na tecla executa a macro uma vez.' },
];
const toKb = (list) => list.map((m) => ({ name: m.name, type: m.type, actions: itemsToActions(m.items) }));

function kbMacroAdapter(ctx) {
  const { drv, st, ui } = ctx;
  const layer = ui.kbLayer || 0;
  const sel = ui.kbSel;
  const selKey = LAYOUT.find((k) => k.k === sel);
  const cur = sel ? st.kb.keys[layer]?.[sel] : null;
  const allKeys = st.kb.keys || {};
  return {
    drv, ctx, noun: 'teclado',
    max: KB_MACRO_MAX, nameMax: 15, delayMax: 60000, wheel: false, defaultMode: KB_MACRO_MODES.once,
    modes: KB_MODES,
    // A área guarda tabela (4 bytes por macro), nome e ações: o nome também conta.
    capacity(list, index, name) {
      const count = index < 0 ? list.length + 1 : list.length;
      let used = 4 * count + macroBytes(name || '', 0);
      list.forEach((m, i) => { if (i !== index) used += macroBytes(m.name, itemsToActions(m.items).length); });
      return Math.max(0, Math.floor((KB_MACRO_AREA - used) / 4));
    },
    // O teclado guarda nome e ações; o modo fica na tecla ligada (ou no que foi escolhido aqui).
    async read() {
      let dev;
      try { dev = await drv.readMacros(); } catch (err) { if (drv.wired) return null; throw err; }
      const local = getMacros(drv);
      const bound = {};
      for (const layerKeys of Object.values(allKeys)) {
        for (const v of Object.values(layerKeys || {})) if (v[0] === KB_MACRO_TYPE) bound[v[3]] = v[1];
      }
      const list = dev.map((m, i) => ({
        name: m.name,
        type: bound[i] ?? local.find((l) => l.name === m.name)?.type ?? KB_MACRO_MODES.once,
        items: actionsToItems(m.actions),
      }));
      return { list, mismatch: false };
    },
    save: (list) => drv.writeMacros(toKb(list)),
    // Teclas da macro apagada voltam ao padrão; as das seguintes acompanham a troca de índice.
    async remove(idx, list) {
      for (const l of LAYERS) {
        const keys = st.kb.keys[l.id];
        if (!keys) continue;
        const changes = {};
        for (const [k, v] of Object.entries(keys)) {
          if (v[0] !== KB_MACRO_TYPE) continue;
          if (v[3] === idx) { const key = LAYOUT.find((x) => x.k === k); changes[k] = key ? defOf(key, l.id) : [0, 0, 0, 0]; }
          else if (v[3] > idx) changes[k] = macroKey(v[3] - 1, v[1]);
        }
        if (Object.keys(changes).length) await drv.writeKeys(changes, l.id);
      }
      await drv.writeMacros(toKb(list));
    },
    boundIndex: cur && cur[0] === KB_MACRO_TYPE ? cur[3] : -1,
    canBind: !!sel && !LOCKED.includes(sel),
    tip: sel ? `Clique numa macro para ligar à tecla ${selKey?.l || sel} (${LAYERS[layer].short}).`
      : 'Escolha uma tecla no desenho e depois clique numa macro para ligar a ela.',
    emptyTip: 'Crie uma e clique nela para ligar à tecla escolhida.',
    deleteTip: 'As teclas ligadas a ela voltam à função padrão.',
    bind(i, m) {
      ctx.run(() => drv.writeKeys({ [sel]: macroKey(i, m.type) }, layer), 'Macro ligada à tecla');
    },
  };
}

/* ---------- Eventos ---------- */
export function bindKeyboardPane(root, ctx) {
  const { st, ui, drv } = ctx;
  if (!st.kb) return;
  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));
  const perf = st.kb.performance;
  const cur = perf.lightMode;

  // Iluminação
  on('[data-act="lfx"]', 'click', (el) => {
    const id = +el.dataset.v;
    if (id === cur) return;
    ui.diyPending = null;
    ctx.run(() => drv.writeLighting({ mode: id }), 'Efeito salvo no teclado');
  });
  const liveSlider = (act, write) => {
    on(`[data-act="${act}"]`, 'input', (el) => {
      const box = el.closest('.pslider');
      box.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
      const v = el.closest('.kslider, .pcard')?.querySelector('[data-val]');
      if (v) v.textContent = el.value;
    });
    on(`[data-act="${act}"]`, 'change', (el) => write(+el.value));
  };
  liveSlider('lspeed', (v) => ctx.run(() => drv.writeLighting({ speed: v }), 'Velocidade salva no teclado'));
  liveSlider('lbright', (v) => ctx.run(() => drv.writeLighting({ brightness: v }), 'Brilho salvo no teclado'));
  on('[data-act="lmulti"]', 'click', (el) => ctx.run(() => drv.writeLighting({ multi: el.dataset.v === '1' }), 'Salvo no teclado'));
  on('[data-act="lcolor"]', 'click', (el) => ctx.run(() => drv.writeLighting({ color: fromHex(el.dataset.v) }), 'Cor salva no teclado'));
  on('[data-act="lcolor-pick"]', 'change', (el) => ctx.run(() => drv.writeLighting({ color: fromHex(el.value) }), 'Cor salva no teclado'));

  // Cores por tecla (efeito personalizado)
  on('[data-act="paint"]', 'click', (el) => { ui.paint = el.dataset.v; ctx.rerender(); });
  on('[data-act="paint-pick"]', 'change', (el) => { ui.paint = el.value; ctx.rerender(); });
  on('[data-act="diy-key"]', 'click', (el) => {
    const k = el.dataset.k;
    if (k === 'btn_volumeRoll') return;
    ui.diyPending = { ...(ui.diyPending || {}), [k]: ui.paint || '#ff0000' };
    el.style.setProperty('--kc', ui.diyPending[k]);
    el.classList.add('painted');
    ctx.rerender();
  });
  on('[data-act="paint-all"]', 'click', () => {
    const c = ui.paint || '#ff0000';
    ui.diyPending = Object.fromEntries(LAYOUT.filter((k) => !k.knob).map((k) => [k.k, c]));
    ctx.rerender();
  });
  on('[data-act="diy-cancel"]', 'click', () => { ui.diyPending = null; ctx.rerender(); });
  on('[data-act="diy-save"]', 'click', () => {
    const pend = ui.diyPending || {};
    const colors = Object.fromEntries(Object.entries(pend).map(([k, h]) => [k, fromHex(h)]));
    ctx.run(async () => { await drv.writeDiy(colors); ui.diyPending = null; }, 'Cores salvas no teclado');
  });

  // Teclas
  on('[data-act="kb-key"]', 'click', (el) => {
    const k = el.dataset.k;
    if (!root.querySelector('.kb-map')) return;
    if (LOCKED.includes(k)) return;
    ui.kbSel = ui.kbSel === k ? null : k;
    ctx.rerender();
  });
  on('[data-act="kb-layer"]', 'click', (el) => { ui.kbLayer = +el.dataset.v; ctx.rerender(); });
  on('[data-act="kb-cat"]', 'click', (el) => { ui.kbCat = el.dataset.v; ctx.rerender(); });
  on('[data-act="kb-search"]', 'input', (el) => {
    ui.kbSearch = el.value;
    const pos = el.selectionStart;
    ctx.rerender();
    const again = root.ownerDocument.querySelector('[data-act="kb-search"]');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });
  if (root.querySelector('.kb-macros')) bindMacroPanel(root, kbMacroAdapter(ctx));
  on('[data-act="kb-set"]', 'click', async (el) => {
    const k = ui.kbSel;
    if (!k) return;
    const v = el.dataset.v.split(',').map(Number);
    const layer = ui.kbLayer || 0;
    if (layer !== 0 && v[0] === 13) return;   // Fn e Fn2 só na camada normal
    if (layer === 0 && v.every((x) => x === 0)) {
      const ok = await ctx.confirm('Desativar esta tecla?', 'Ela deixa de funcionar até você escolher outra função ou restaurar o padrão.');
      if (!ok) return;
    }
    ctx.run(() => drv.writeKeys({ [k]: v }, layer), 'Tecla salva no teclado');
  });
  on('[data-act="kb-reset"]', 'click', async () => {
    const layer = ui.kbLayer || 0;
    const ok = await ctx.confirm('Restaurar as teclas?', layer === 2
      ? 'Todas as teclas da camada Fn2 ficam sem função, como vêm de fábrica.'
      : `Todas as teclas da ${LAYERS[layer].short} voltam à função de fábrica.`);
    if (!ok) return;
    ctx.run(() => drv.resetKeys(layer), 'Teclas restauradas');
  });

  // Desempenho
  on('[data-act="kb-sleep"]', 'input', (el) => {
    const box = el.closest('.pslider');
    box.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
    box.querySelector('[data-val]').textContent = el.value;
  });
  on('[data-act="kb-sleep"]', 'change', (el) => ctx.run(() => drv.writePerformance({ sleep: Math.round(+el.value * 2) }), 'Salvo no teclado'));
  on('[data-act="kb-sleep-never"]', 'click', () => ctx.run(() => drv.writePerformance({ sleep: perf.sleep === 0 ? 2 : 0 }), 'Salvo no teclado'));
  on('[data-act="kb-fast"]', 'click', () => ctx.run(() => drv.writePerformance({ fastMode: !perf.fastMode }), 'Salvo no teclado'));
  on('[data-act="kb-mac"]', 'click', () => ctx.run(() => drv.writePerformance({ mac: !perf.mac }), 'Salvo no teclado'));
  on('[data-act="kb-win"]', 'click', () => ctx.run(() => drv.writePerformance({ winLock: !perf.winLock }), 'Salvo no teclado'));

  // Outros
  on('[data-act="kb-reload"]', 'click', () => ctx.run(() => drv.reload(), 'Configuração relida'));
  on('[data-act="kb-factory"]', 'click', async () => {
    const ok = await ctx.confirm('Restaurar configurações de fábrica?', 'Iluminação, teclas das duas camadas, desempenho e macros do teclado voltam ao padrão. Isso não pode ser desfeito.');
    if (!ok) return;
    ctx.run(() => drv.factoryReset(), 'Teclado restaurado');
  });
}
