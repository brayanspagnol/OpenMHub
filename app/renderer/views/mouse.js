// Abas do mouse (Botões, DPI, Desempenho, Outros), no layout do M HUB.
import { icon } from '../icons.js';
import { mouseRender } from '../renders.js';
import { RATES, SENSOR, DEFAULT_CONFIG, DEFAULT_KEYS, MACRO_TYPE } from '../drivers/g3v2.js';
import { macroListHtml, bindMacroList, macroName } from './macros.js';
import KEYS from '../data/mouse-keys.js';
import { t } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Cores dos estágios de DPI, na mesma ordem do M HUB.
export const DPI_COLORS = ['#ea5e56', '#0053e2', '#32aa70', '#f59c25', '#00c8d0', '#b500ec'];

// Foto real do mouse quando existe; senão a ilustração vetorial.
// h = null deixa a altura para o CSS (figura fluida da aba Botões).
function mouseFig(ctx, h) {
  const src = ctx.image?.('top');
  return src ? `<img class="mouse-photo" src="${esc(src)}" ${h ? `style="height:${h}px"` : ''} alt="" draggable="false">` : mouseRender(h || 420);
}

// O M HUB esconde estas opções no G3 V2 (não Pro): o firmware aceita, mas o efeito não é garantido.
const EXP = ` <span class="exp" title="${t('mouse.exp')}">${t('mouse.expBadge')}</span>`;

// y = centro da etiqueta, em fração da altura da foto (a figura muda de tamanho com a janela).
// tx/ty: ponto do botão na foto (fração da largura/altura), medido no M HUB oficial.
const BUTTONS = [
  { label: t('mb.left'), side: 'left', y: 0.19, tx: 0.3, ty: 0.13 },
  { label: t('mb.right'), side: 'right', y: 0.19, tx: 0.7, ty: 0.13 },
  { label: t('mb.middle'), side: 'right', y: 0.33, tx: 0.52, ty: 0.19 },
  { label: t('mb.back'), side: 'left', y: 0.56, tx: 0.035, ty: 0.55 },
  { label: t('mb.forward'), side: 'left', y: 0.40, tx: 0.02, ty: 0.4 },
];

// Linhas das etiquetas como no M HUB: sai reta da etiqueta e desce inclinada até o botão.
function drawLeads(root) {
  const fig = root.querySelector('.kfig');
  if (!fig) return;
  const draw = () => {
    const f = fig.getBoundingClientRect();
    if (!f.width) return;
    let svg = fig.querySelector('svg.leads');
    if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'leads'); fig.append(svg); }
    svg.innerHTML = [...fig.querySelectorAll('.kchip')].map((chip) => {
      const b = BUTTONS[+chip.dataset.i];
      const c = chip.getBoundingClientRect();
      const left = b.side === 'left';
      const ax = (left ? c.right : c.left) - f.left, ay = c.top + c.height / 2 - f.top;
      const bx = ax + (left ? 18 : -18);
      const tx = b.tx * f.width, ty = b.ty * f.height;
      const on = chip.classList.contains('on') ? ' on' : '';
      return `<polyline class="lead-line${on}" points="${ax},${ay} ${bx},${ay} ${tx},${ty}"/><circle class="lead-dot${on}" cx="${tx}" cy="${ty}" r="4"/>`;
    }).join('');
  };
  draw();
  const img = fig.querySelector('img');
  if (img && !img.complete) img.addEventListener('load', draw, { once: true });
  fig._ro?.disconnect();
  fig._ro = new ResizeObserver(draw);
  fig._ro.observe(fig);
}

/* ---------- Nomes das funções ---------- */
// Nomes do M HUB (leftButton...) têm tradução em fn.*; teclas e atalhos ("Ctrl + C") ficam como vêm.
const CATS = [
  ['system', t('mouse.cat.system')],
  ['keyboard', t('mouse.cat.keyboard')],
  ['other', t('mouse.cat.other')],
  ['macros', 'Macros'],
];
const keyLabel = (k) => t('fn.' + k.name, null, k.name.replace('LWindows', 'Super'));

const ALL_KEYS = Object.values(KEYS).flatMap((groups) => groups.flatMap((g) => g.keys));
const sameKey = (a, b) => a && b && a.type === b.type && a.code1 === b.code1 && a.code2 === b.code2 && a.code3 === b.code3;
export function keyName(k, drv = null) {
  if (!k) return '--';
  if (k.type === MACRO_TYPE) return drv ? `Macro: ${macroName(k, drv)}` : `Macro ${k.code1 + 1}`;
  if (k.type === 32 && k.code1 === 0) return t('fn.forbidden');
  const f = ALL_KEYS.find((x) => sameKey(x, k));
  return f ? keyLabel(f) : t('fn.code', { code: `${k.type}:${k.code1}:${k.code2}` });
}

/* ---------- Abas ---------- */
export function mousePane(tab, ctx) {
  const { st } = ctx;
  if (st.online === false) return `<div class="soon">${t('mouse.wake')}</div>`;
  if (!st.config) return `<div class="soon">${t('ov.readingMouse')}</div>`;
  if (tab === 'dpi') return dpiPane(ctx);
  if (tab === 'perf') return perfPane(ctx);
  if (tab === 'others') return othersPane(ctx);
  if (tab === 'keymap') return keymapPane(ctx);
  return '';
}

// Escala da barra como no M HUB atual: 200–4200 na primeira metade, o resto até o máximo na segunda.
const DPI_KNEE = 4200;
function dpiToPos(v, r) {
  return v <= DPI_KNEE ? ((v - r.min) / (DPI_KNEE - r.min)) * 500 : 500 + ((v - DPI_KNEE) / (r.max - DPI_KNEE)) * 500;
}
function posToDpi(p, r) {
  const v = p <= 500 ? r.min + (p / 500) * (DPI_KNEE - r.min) : DPI_KNEE + ((p - 500) / 500) * (r.max - DPI_KNEE);
  return Math.round(v / 50) * 50;
}

// Aba DPI: destaque do DPI em uso com gráfico dos níveis e um cartão por nível.
function dpiPane({ st }) {
  const c = st.config;
  const r = st.dpiRange;
  const levels = c.dpis.slice(0, c.dpiCount);
  const top = Math.max(...levels, 1);
  const barH = (d) => Math.round(18 + 82 * Math.sqrt(d / top));
  return `<div class="dz">
    <section class="ov-shell dz-hero"><div class="ov-core">
      <div class="dz-now">
        <span class="ov-eyebrow">${t('dpi.inUse')}</span>
        <div class="dz-big"><b data-dz-now>${c.dpis[c.dpiIndex]}</b><small>DPI</small></div>
        <p class="dz-sub">${t('dpi.sub', { n: c.dpiIndex + 1, count: c.dpiCount })}</p>
        <div class="dz-tools">
          <div class="dz-count" role="group" aria-label="${t('dpi.levelCount')}">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="${n === c.dpiCount ? 'on' : ''}" data-act="dpi-count" data-v="${n}" title="${t(n > 1 ? 'dpi.levelsN' : 'dpi.levels1', { n })}">${n}</button>`).join('')}</div>
          <button class="btn-text" data-act="dpi-reset">${icon('undo')}${t('common.restoreDefaults')}</button>
        </div>
      </div>
      <div class="dz-chart">${levels.map((d, i) => `<button class="dz-bar ${i === c.dpiIndex ? 'on' : ''}" data-act="dpi-current" data-i="${i}" title="${t('dpi.useLevel', { n: i + 1 })}">
        <span class="dz-bar-v" data-bar-v="${i}">${d}</span><i style="height:${barH(d)}%" data-bar="${i}"></i><span class="dz-bar-n">${i + 1}</span></button>`).join('')}</div>
    </div></section>
    <div class="dz-levels">${levels.map((d, i) => {
      const pos = dpiToPos(d, r) / 10;
      const on = i === c.dpiIndex;
      return `<section class="ov-shell dz-lvl ${on ? 'on' : ''}" data-act="dpi-current" data-i="${i}"><div class="ov-core">
        <div class="dz-lvl-top"><span class="dz-lvl-n">${i + 1}</span><span class="ov-label">${t('dpi.level', { n: i + 1 })}</span>
          ${on ? `<span class="dz-pill">${t('dpi.active')}</span>` : `<span class="dz-use">${t('dpi.use')}</span>`}</div>
        <label class="dz-val"><input type="number" min="${r.min}" max="${r.max}" step="50" value="${d}" data-act="dpi-input" data-i="${i}"><span>DPI</span></label>
        <div class="dz-slider" style="--p:${pos}%">
          <div class="dz-track"><i></i></div>
          <input type="range" min="0" max="1000" step="1" value="${Math.round(pos * 10)}" data-act="dpi-slider" data-i="${i}" aria-label="${t('dpi.levelAria', { n: i + 1 })}">
          <div class="dz-marks"><span>${r.min}</span><span style="left:50%">4200</span><span style="left:100%">${r.max}</span></div>
        </div>
      </div></section>`;
    }).join('')}</div>
  </div>`;
}

function card(title, desc, control, extra = '') {
  return `<div class="pcard ${extra}"><div class="pcard-head"><div><h3>${title}</h3><p>${desc}</p></div>${control.inline || ''}</div>${control.below || ''}</div>`;
}
const sw = (act, on) => `<button class="switch ${on ? 'on' : ''}" data-act="${act}" role="switch" aria-checked="${on}"></button>`;
const radio = (act, value, on, label) => `<button class="radio ${on ? 'on' : ''}" data-act="${act}" data-v="${value}"><span class="dot"></span>${label}</button>`;
function slider(act, min, max, value, unit, color = 'var(--accent)') {
  const pct = ((value - min) / (max - min)) * 100;
  return `<div class="pslider" style="--p:${pct}%;--c:${color}">
    <input type="range" data-act="${act}" min="${min}" max="${max}" step="1" value="${value}">
    <div class="pval"><b data-val>${value}</b> ${unit}</div>
  </div>`;
}

// Desempenho em três grupos: resposta, energia e sensor.
const LATENCY = { 125: '8 ms', 250: '4 ms', 500: '2 ms', 1000: '1 ms' };
function seg(act, opts, cur) {
  return `<div class="pf-seg">${opts.map(([v, label, hint]) => `<button class="${v === cur ? 'on' : ''}" data-act="${act}" data-v="${v}"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</button>`).join('')}</div>`;
}
function bigSlider(act, min, max, value, unit, hint) {
  const pct = ((value - min) / (max - min)) * 100;
  return `<div class="pslider pf-slider" style="--p:${pct}%;--c:var(--accent)">
    <div class="pf-val"><b data-val>${value}</b><small>${unit}</small></div>
    <input type="range" data-act="${act}" min="${min}" max="${max}" step="1" value="${value}">
    <div class="pf-ends"><span>${min}</span><span>${hint || ''}</span><span>${max}</span></div>
  </div>`;
}
function toggleTile(act, on, ic, title, desc, exp = false) {
  return `<button class="ov-shell pf-toggle ${on ? 'on' : ''}" data-act="${act}" role="switch" aria-checked="${on}"><div class="ov-core">
    <div class="pf-toggle-top"><span class="ov-ico">${icon(ic)}</span><span class="switch ${on ? 'on' : ''}"></span></div>
    <b>${title}${exp ? EXP : ''}</b><p>${desc}</p>
  </div></button>`;
}
const pfCard = (cls, title, desc, body) => `<section class="ov-shell ${cls}"><div class="ov-core"><div class="pf-head"><h3>${title}</h3>${desc ? `<p>${desc}</p>` : ''}</div>${body}</div></section>`;

function perfPane({ st, drv }) {
  const c = st.config;
  const never = c.sleep === 0;
  const rate = drv.isCable ? 1000 : RATES[c.rateIdx];
  return `<div class="pf">
    <h4 class="pf-group">${t('perf.response')}</h4>
    ${pfCard('pf-rate', t('ov.pollingRate'), t(drv.isCable ? 'perf.rateCable' : 'perf.rateDesc'),
      drv.isCable ? seg('none', [[1000, '1000 Hz', '1 ms']], 1000) : seg('rate', RATES.map((r, i) => [i, `${r} Hz`, LATENCY[r]]), c.rateIdx))}
    ${pfCard('pf-deb', t('perf.debounce'), t('perf.debounceDesc'), bigSlider('debounce', 0, 20, c.debounce, 'ms', t('perf.debounceHint')))}
    <h4 class="pf-group">${t('perf.power')}</h4>
    ${pfCard('pf-sleep', t('perf.sleep'), t('perf.sleepDesc'),
      `<div class="pf-sleep-row">${never ? `<div class="pf-never"><b>∞</b><span>${t('perf.never')}</span></div>` : bigSlider('sleep', 1, 100, c.sleep, 'min', '')}
        <button class="pf-chip ${never ? 'on' : ''}" data-act="sleep-never">${never ? icon('check') : ''}${t('perf.neverSleep')}</button></div>`)}
    <h4 class="pf-group">${t('perf.sensor')}</h4>
    <div class="pf-toggles">
      ${toggleTile('sensor-angle', !!(c.sensor & SENSOR.angleSnap), 'dpi', t('perf.angle'), t('perf.angleDesc'))}
      ${toggleTile('sensor-motion', !!(c.sensor & SENSOR.motionSync), 'perf', 'Motion Sync', t('perf.motionDesc'), true)}
      ${toggleTile('sensor-ripple', !!(c.sensor & SENSOR.ripple), 'wifi', t('perf.ripple'), t('perf.rippleDesc'), true)}
    </div>
    <div class="pf-pair">
      ${pfCard('pf-lod', t('perf.lod') + EXP, t('perf.lodDesc'), seg('lod', [[1, '1 mm', t('perf.lod1')], [2, '2 mm', t('perf.lod2')]], c.lod === 2 ? 2 : 1))}
      ${pfCard('pf-scroll', t('perf.scroll'), t('perf.scrollDesc'), seg('scroll', [[0, t('perf.normal'), ''], [1, t('perf.reversed'), '']], c.scroll === 1 ? 1 : 0))}
    </div>
  </div>`;
}

function othersPane(ctx) {
  const { st, drv } = ctx;
  return `<div class="others">
    <div class="others-render">${mouseFig(ctx, 380)}</div>
    <div class="others-cards">
      <div class="ocard"><div><h3>${t('oth.mouseFw', { v: esc(st.firmware || '--') })}</h3>
        <p>${t('oth.mouseFwDesc')}</p></div>
        <button class="btn-white" disabled>${t('common.update')}</button></div>
      <div class="ocard"><div><h3>${t('oth.rxFw', { v: esc(st.receiverFirmware || '--') })}</h3>
        <p>${t(drv.isCable ? 'oth.rxCable' : 'oth.rxOk')}</p></div>
        <button class="btn-white" disabled>${t('common.update')}</button></div>
      <div class="ocard"><div><h3>${t('oth.pair')}</h3>
        <p>${t('oth.pairMouse')}</p></div></div>
      <div class="ocard"><div><h3>${t('oth.factory')}</h3>
        <p>${t('oth.factoryMouse')}</p></div>
        <button class="btn-white" data-act="factory">${t('common.restore')}</button></div>
    </div>
  </div>`;
}

function keymapPane(ctx) {
  const { st, ui, drv } = ctx;
  const keys = st.keys || DEFAULT_KEYS;
  const sel = ui.keySel ?? 0;
  const cat = ui.keyCat || 'system';
  const q = (ui.keySearch || '').trim().toLowerCase();
  const groups = (KEYS[cat] || [])
    .map((g) => ({ ...g, keys: g.keys.filter((k) => !q || keyLabel(k).toLowerCase().includes(q) || k.name.toLowerCase().includes(q)) }))
    .filter((g) => g.keys.length);
  const all = keyLabel;
  return `<div class="keymap">
    <div class="kpanel">
      <div class="ksearch">${icon('search')}<input data-act="key-search" placeholder="${t('common.searchFn')}" value="${esc(ui.keySearch || '')}"></div>
      <div class="kcats">${CATS.map(([id, label]) => `<button class="kcat ${cat === id ? 'on' : ''}" data-act="key-cat" data-v="${id}">${label}</button>`).join('')}</div>
      <p class="khint">${t('km.hint')}</p>
      <div class="klist">
        ${cat === 'macros' ? macroListHtml(ctx, keys, sel, q) : groups.map((g) => {
          const closed = !q && ui.keyClosed?.includes(g.group);
          return `<div class="kgroup ${closed ? 'closed' : ''}"><button class="kgroup-title" data-act="key-group" data-v="${esc(g.group)}">${t('fgroup.' + g.group, null, g.group)}${icon('chevron')}</button>
          <div class="kitems ${cat === 'keyboard' ? 'grid' : ''}">${g.keys.map((k) => {
            const on = sameKey(k, keys[sel]);
            return `<button class="kitem ${on ? 'on' : ''}" data-act="key-set" data-k="${esc(JSON.stringify([k.type, k.code1, k.code2, k.code3]))}">${esc(all(k))}</button>`;
          }).join('')}</div></div>`; }).join('') || `<div class="kempty">${t('common.noResults')}</div>`}
      </div>
    </div>
    <div class="kmouse">
      <div class="kfig">
        ${mouseFig(ctx, null)}
        ${BUTTONS.map((b, i) => { const val = esc(keyName(keys[i], drv)); return `<button class="kchip ${b.side} ${i === sel ? 'on' : ''}" style="top:${b.y * 100}%" data-act="key-sel" data-i="${i}" title="${t('mouse.btnTitle', { btn: b.label, fn: val })}">
          <span class="kchip-val">${val}</span><i class="lead"></i></button>`; }).join('')}
      </div>
      <button class="btn-ghost" data-act="keys-reset">${icon('undo')}${t('common.restoreDefaults')}</button>
    </div>
  </div>`;
}

/* ---------- Eventos ---------- */
export function bindMousePane(root, ctx) {
  const { st, ui } = ctx;
  const c = st.config;
  if (!c) return;
  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));
  const clamp = (v) => Math.round(Math.min(st.dpiRange.max, Math.max(st.dpiRange.min, v)) / 50) * 50;
  const setDpi = (i, v) => { const dpis = [...c.dpis]; dpis[i] = clamp(v); return ctx.write({ dpis }); };

  // DPI
  on('[data-act="dpi-count"]', 'click', (el, e) => { e.stopPropagation(); const n = +el.dataset.v; if (n !== c.dpiCount) ctx.write({ dpiCount: n, dpiIndex: Math.min(c.dpiIndex, n - 1) }); });
  on('[data-act="dpi-current"]', 'click', (el, e) => {
    if (e.target.closest('input, label')) return;
    const i = +el.dataset.i; if (i !== c.dpiIndex) ctx.write({ dpiIndex: i });
  });
  on('[data-act="dpi-input"]', 'change', (el) => setDpi(+el.dataset.i, +el.value));
  on('[data-act="dpi-input"]', 'keydown', (el, e) => { if (e.key === 'Enter') el.blur(); });
  on('[data-act="dpi-slider"]', 'input', (el) => {
    const i = +el.dataset.i, v = posToDpi(+el.value, st.dpiRange);
    const card = el.closest('.dz-lvl');
    card.querySelector('.dz-slider').style.setProperty('--p', `${el.value / 10}%`);
    card.querySelector('[data-act="dpi-input"]').value = v;
    const lbl = root.querySelector(`[data-bar-v="${i}"]`); if (lbl) lbl.textContent = v;
    if (i === c.dpiIndex) { const now = root.querySelector('[data-dz-now]'); if (now) now.textContent = v; }
  });
  on('[data-act="dpi-slider"]', 'change', (el) => setDpi(+el.dataset.i, posToDpi(+el.value, st.dpiRange)));
  on('[data-act="dpi-reset"]', 'click', () => ctx.write({ dpis: [...DEFAULT_CONFIG.dpis], dpiCount: 6, dpiIndex: DEFAULT_CONFIG.dpiIndex }));

  // Desempenho
  const bindSlider = (act, write) => {
    on(`[data-act="${act}"]`, 'input', (el) => {
      const box = el.closest('.pslider');
      box.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
      box.querySelector('[data-val]').textContent = el.value;
    });
    on(`[data-act="${act}"]`, 'change', (el) => write(+el.value));
  };
  bindSlider('sleep', (v) => ctx.write({ sleep: v }));
  bindSlider('debounce', (v) => ctx.write({ debounce: v }));
  on('[data-act="sleep-never"]', 'click', () => ctx.write({ sleep: c.sleep === 0 ? 3 : 0 }));
  on('[data-act="rate"]', 'click', (el) => ctx.write({ rateIdx: +el.dataset.v }));
  on('[data-act="lod"]', 'click', (el) => ctx.write({ lod: +el.dataset.v }));
  on('[data-act="scroll"]', 'click', (el) => ctx.write({ scroll: +el.dataset.v }));
  const flag = (act, bit) => on(`[data-act="${act}"]`, 'click', () => ctx.write({ sensor: (c.sensor === 0xff ? 0 : c.sensor) ^ bit }));
  flag('sensor-ripple', SENSOR.ripple);
  flag('sensor-angle', SENSOR.angleSnap);
  flag('sensor-motion', SENSOR.motionSync);

  // Outros
  on('[data-act="factory"]', 'click', async () => {
    const ok = await ctx.confirm(t('oth.factoryQ'), t('oth.factoryMouseQ'));
    if (!ok) return;
    await ctx.write({ ...DEFAULT_CONFIG, dpis: [...DEFAULT_CONFIG.dpis] }, true);
    await ctx.writeKeys(DEFAULT_KEYS.map((k) => ({ ...k })));
  });

  // Botões
  on('[data-act="key-sel"]', 'click', (el) => { ui.keySel = +el.dataset.i; ctx.rerender(); });
  drawLeads(root);
  on('[data-act="key-group"]', 'click', (el) => {
    const g = el.dataset.v, list = ui.keyClosed || [];
    ui.keyClosed = list.includes(g) ? list.filter((x) => x !== g) : [...list, g];
    ctx.rerender();
  });
  on('[data-act="key-cat"]', 'click', (el) => { ui.keyCat = el.dataset.v; ctx.rerender(); });
  on('[data-act="key-search"]', 'input', (el) => {
    ui.keySearch = el.value;
    const pos = el.selectionStart;
    ctx.rerender();
    const again = root.ownerDocument.querySelector('[data-act="key-search"]');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });
  on('[data-act="key-set"]', 'click', async (el) => {
    const [type, code1, code2, code3] = JSON.parse(el.dataset.k);
    const sel = ui.keySel ?? 0;
    const keys = (st.keys || DEFAULT_KEYS).map((k) => ({ ...k }));
    // O botão esquerdo precisa continuar clicando em algum lugar: não deixamos desativar.
    if (sel === 0 && !(type === 32 && code1 === 1)) {
      const ok = await ctx.confirm(t('km.leftQ'), t('km.leftQBody'));
      if (!ok) return;
    }
    keys[sel] = { type, code1, code2, code3 };
    ctx.writeKeys(keys);
  });
  on('[data-act="keys-reset"]', 'click', () => ctx.writeKeys(DEFAULT_KEYS.map((k) => ({ ...k }))));

  // Macros
  bindMacroList(root, ctx);
}
