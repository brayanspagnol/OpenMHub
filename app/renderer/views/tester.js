// Ferramenta de teste de mouse e teclado (equivalente ao "Mouse & Keyboard Test Tool" do M HUB).
// testerPage() devolve o HTML; bindTester(root) liga os eventos e devolve a função de limpeza.
import { LAYOUT, LAYOUT_W, LAYOUT_H } from '../data/keyboard-ut98.js';
import { t } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

// Ícones próprios (icons.js não tem teclado nem mouse).
const svg = (p) => `<svg class="i" viewBox="0 0 24 24">${p}</svg>`;
const IC = {
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M6 13.5h1M17 13.5h1M9 14h6"/>'),
  mouse: svg('<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6M6 10h12"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  warn: svg('<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>'),
};
// Ícone para o botão "Testes" da tela inicial.
export const TESTER_ICON = svg('<rect x="2.5" y="9" width="12" height="9" rx="1.5"/><path d="M5 12h1M8 12h1M11 12h1M6 15h5"/><rect x="16" y="5" width="5.5" height="9" rx="2.75"/><path d="M18.75 5v3"/>');

/* ---------- Mapa KeyboardEvent.code -> tecla do desenho ---------- */
const CODE2K = {
  Escape: 'Esc', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  Backquote: 'backquote', Minus: 'transverse', Equal: 'equal', Backspace: 'Backspace', Tab: 'Tab',
  BracketLeft: 'left_bracket', BracketRight: 'right_bracket', Backslash: 'backslash', CapsLock: 'Caps',
  Semicolon: 'semicolon', Quote: 'singlequotes', Enter: 'Enter', ShiftLeft: 'Left_Shift', ShiftRight: 'Right_Shift',
  Comma: 'comma', Period: 'dot', Slash: 'slash', ControlLeft: 'Left_Ctrl', MetaLeft: 'Left_Win', AltLeft: 'Left_Alt',
  Space: 'Space', AltRight: 'Right_Alt', ControlRight: 'Right_Ctrl',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  NumLock: 'Num', NumpadDivide: 'num_divide', NumpadMultiply: 'num_multiply', NumpadSubtract: 'num_subtract',
  NumpadAdd: 'num_add', NumpadEnter: 'num_Enter', NumpadDecimal: 'num_dot',
  LaunchApp2: 'cala_btn', AudioVolumeUp: 'btn_volumeRoll', AudioVolumeDown: 'btn_volumeRoll', AudioVolumeMute: 'btn_volumeRoll',
};
for (let i = 1; i <= 12; i++) CODE2K['F' + i] = 'F' + i;
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') CODE2K['Key' + c] = c;
['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].forEach((n, i) => {
  CODE2K['Digit' + i] = n;
  CODE2K['Numpad' + i] = 'num_' + n;
});

// Teclas que não existem no UT98 mas aparecem em outros teclados.
const EXTRAS = [['Insert', 'Ins'], ['PrintScreen', 'PrtSc'], ['ScrollLock', 'ScrLk'], ['Pause', 'Pause'], ['ContextMenu', 'Menu'], ['MetaRight', t('key.right', { key: 'Win' })]];

const UNTESTABLE = new Set(['Fn']); // Fn é tratada dentro do teclado e não gera evento
const TOTAL = LAYOUT.filter((k) => !UNTESTABLE.has(k.k)).length;
const byK = new Map(LAYOUT.map((k) => [k.k, k]));

function keyName(code) {
  const m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (m) return t(m[2] === 'Left' ? 'key.left' : 'key.right', { key: { Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Meta: 'Win' }[m[1]] });
  const ex = EXTRAS.find(([c]) => c === code);
  if (ex) return ex[1];
  if (code.startsWith('AudioVolume')) return { AudioVolumeUp: 'Volume +', AudioVolumeDown: 'Volume −', AudioVolumeMute: t('fn.mute') }[code] || code;
  const lk = byK.get(CODE2K[code]);
  if (lk) return (code.startsWith('Numpad') || code === 'NumLock' ? 'Num ' : '') + lk.l.split(' ')[0].replace(/^Num$/, 'Lock');
  return code.replace(/^(Key|Digit)/, '') || '?';
}

// Mesmo recurso do M HUB: sem e.code, deduz o lado pelo e.location.
function codeOf(e) {
  if (e.code) return e.code;
  const side = e.location === 1 ? 'Left' : 'Right';
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return e.key + side;
  return e.key || 'Unidentified';
}

/* ---------- Relógio ---------- */
const wall = (ts) => {
  const d = new Date(performance.timeOrigin + ts);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};
const fmtMs = (ms) => (ms >= 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/* ---------- HTML ---------- */
const SHORT = { Delete: 'Del', Backspace: 'Back' };
function keyboardFig() {
  const keys = LAYOUT.map((k) => {
    const pos = `left:${(k.x / LAYOUT_W) * 100}%;top:${(k.y / LAYOUT_H) * 100}%;width:${(k.w / LAYOUT_W) * 100}%;height:${((k.h || 42) / LAYOUT_H) * 100}%`;
    const cls = `${k.knob ? 'knob' : ''} ${UNTESTABLE.has(k.k) ? 'na' : ''}`;
    const title = UNTESTABLE.has(k.k) ? t('tt.fnKey') : k.l;
    const lbl = SHORT[k.k] || k.l;
    return `<div class="tt-key ${cls}" style="${pos}" data-k="${esc(k.k)}" title="${esc(title)}"><span class="tt-kl">${esc(lbl)}</span><span class="tt-kc"></span></div>`;
  }).join('');
  return `<div class="tt-kbfig"><div class="tt-kbfig-in" style="aspect-ratio:${LAYOUT_W}/${LAYOUT_H}">${keys}</div></div>`;
}

// Desenho do mouse com áreas que acendem por botão.
function mouseFig() {
  return `<svg class="tt-mfig" viewBox="0 0 170 250" aria-hidden="true">
    <ellipse class="tt-mshadow" cx="88" cy="238" rx="58" ry="8"/>
    <path class="tt-mbody" d="M24 100c19 6 40 9 64 9s45-3 64-9c1 48-5 88-17 110-10 20-27 28-47 28s-37-8-47-28c-12-22-18-62-17-110z"/>
    <path class="tt-mz" data-b="0" d="M86 12C45 13 26 44 24 96c19 6 40 9 62 9z"/>
    <path class="tt-mz" data-b="2" d="M90 12c41 1 60 32 62 84-19 6-40 9-62 9z"/>
    <rect class="tt-mz" data-b="4" x="12" y="112" width="9" height="30" rx="4"/>
    <rect class="tt-mz" data-b="3" x="12" y="148" width="9" height="30" rx="4"/>
    <rect class="tt-mz tt-wheel" data-b="1" x="79" y="34" width="18" height="42" rx="9"/>
    <path class="tt-wline" d="M83 44h10M83 50h10M83 56h10M83 62h10M83 68h10"/>
    <path class="tt-warr" data-w="up" d="M81 25l7-7 7 7"/>
    <path class="tt-warr" data-w="down" d="M81 85l7 7 7-7"/>
  </svg>`;
}

const BTN = [
  [0, 'left', t('tt.left')], [2, 'right', t('tt.right')], [1, 'middle', t('tt.middle')],
  [3, 'back', t('tt.back')], [4, 'forward', t('tt.forward')],
];
const BTN_NAME = Object.fromEntries(BTN.map(([b, , n]) => [b, n.replace(/ \(.*/, '')]));

const stat = (id, label, val = '0', extra = '') => `<div class="tt-stat ${extra}"><b data-s="${id}">${val}</b><span>${label}</span></div>`;

// Carrega tester.css sozinho, caso o index.html não tenha o <link>.
function ensureCss() {
  if (document.querySelector('link[data-tester], link[href$="tester.css"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../tester.css', import.meta.url).href; l.dataset.tester = '';
  document.head.append(l);
}

export function testerPage() {
  ensureCss();
  // HTML sempre igual (a leitura periódica do app compara o HTML); aba e limite vêm no bindTester.
  const tab = 'kb', thr = 80;
  return `<div class="tester" data-tab="${tab}">
    <div class="tt-head">
      <div class="tt-seg">
        <button class="${tab === 'kb' ? 'active' : ''}" data-tt-tab="kb">${IC.keyboard}${t('tt.keyboard')}</button>
        <button class="${tab === 'mouse' ? 'active' : ''}" data-tt-tab="mouse">${IC.mouse}${t('tt.mouse')}</button>
      </div>
      <span class="tt-sub" data-show="kb">${t('tt.kbSub')}</span>
      <span class="tt-sub" data-show="mouse">${t('tt.mouseSub')}</span>
      <span class="spacer"></span>
      <button class="btn-white" data-tt="reset">${IC.reset}${t('tt.reset')}</button>
    </div>

    <section class="tt-kb" data-show="kb">
      <div class="tt-kb-main">
        <div class="tt-area" tabindex="0" data-tt="area">
          ${keyboardFig()}
          <div class="tt-extras"><span class="tt-extras-l">${t('tt.otherKeys')}</span>
            ${EXTRAS.map(([c, l]) => `<div class="tt-key tt-xkey" data-code="${c}"><span class="tt-kl">${l}</span><span class="tt-kc"></span></div>`).join('')}
          </div>
          <div class="tt-cover"><div>${IC.keyboard}<b>${t('tt.start')}</b><span>${t('tt.startHint')}</span></div></div>
          <div class="tt-live"><i></i>${t('tt.live')}</div>
        </div>
        <div class="tt-legend">
          <span><i class="lg-idle"></i>${t('tt.idle')}</span>
          <span><i class="lg-down"></i>${t('tt.down')}</span>
          <span><i class="lg-done"></i>${t('tt.done')}</span>
          <span class="tt-legend-n">${t('tt.countHint')}</span>
        </div>
        <div class="tt-stats">
          ${stat('kdown', t('tt.presses'))}
          ${stat('kup', t('tt.releases'))}
          ${stat('ktotal', t('tt.total'))}
          ${stat('ktested', t('tt.tested'), `0<small>/${TOTAL}</small>`)}
          <div class="tt-stat tt-roll"><b data-s="kmax">0</b><span>${t('tt.rollover')}</span>
            <div class="tt-held" data-tt="held"><em>${t('tt.now')} <b data-s="know">0</b></em></div></div>
        </div>
      </div>
      <aside class="tt-logbox">
        <div class="tt-logh"><b>${t('tt.log')}</b><span data-s="klogn">${t('tt.events', { n: 0 })}</span></div>
        <ol class="tt-log" data-tt="klog"></ol>
        <div class="tt-logempty" data-tt="klogempty">${t('tt.logEmpty')}</div>
      </aside>
    </section>

    <section class="tt-ms" data-show="mouse">
      <div class="tt-pad" data-tt="pad">
        ${mouseFig()}
        <div class="tt-padhint">${t('tt.padHint')}</div>
        <div class="tt-padchips">
          <span class="tt-chip"><em>${t('tt.cps')}</em><b data-s="cps">0</b></span>
          <span class="tt-chip"><em>Polling</em><b data-s="hznow">--</b></span>
        </div>
        <div class="tt-ripples" data-tt="ripples"></div>
      </div>
      <div class="tt-mside">
        <div class="tt-counters">
          ${BTN.map(([b, id, name]) => `<div class="tt-ctr" data-b="${b}"><span>${name}</span><b data-s="b${b}">0</b><em data-s="bd${b}"></em></div>`).join('')}
          <div class="tt-ctr" data-w="up"><span>${IC.up}${t('tt.wheelUp')}</span><b data-s="wup">0</b><em></em></div>
          <div class="tt-ctr" data-w="down"><span>${IC.down}${t('tt.wheelDown')}</span><b data-s="wdown">0</b><em></em></div>
        </div>
        <div class="pcard tt-dbl" data-tt="dbl">
          <div class="tt-dbl-top">
            <div><h3>${IC.warn}${t('tt.dbl')}</h3>
              <p>${t('tt.dblDesc')}</p></div>
            <b class="tt-dbl-n" data-s="dbl">0</b>
          </div>
          <div class="tt-thr">
            <span>${t('tt.threshold')}</span>
            <div class="pslider"><input type="range" min="20" max="200" step="5" value="${thr}" data-tt="thr"></div>
            <b data-s="thr">${thr} ms</b>
          </div>
          <div class="tt-dbl-info"><span>${t('tt.minInt')} <b data-s="minint">--</b></span><span>${t('tt.maxCps')} <b data-s="cpsmax">0</b></span></div>
          <div class="tt-dbl-list" data-tt="dbllist"></div>
        </div>
        <div class="pcard tt-poll">
          <h3>${t('tt.poll')}</h3>
          <p>${t('tt.pollDesc')}</p>
          <div class="tt-poll-row">
            <div><b data-s="hzavg">--</b><span>${t('tt.avg')}</span></div>
            <div><b data-s="hzmax">--</b><span>${t('tt.max')}</span></div>
            <div><b data-s="hzstd">--</b><span>${t('tt.likely')}</span></div>
          </div>
          <div class="tt-poll-src" data-s="hzsrc"></div>
        </div>
      </div>
    </section>
  </div>`;
}

/* ---------- Ligação dos eventos ---------- */
export function bindTester(root) {
  const el = root.matches?.('.tester') ? root : root.querySelector('.tester');
  if (!el) return () => {};
  const $ = (s) => el.querySelector(s);
  const S = (id) => el.querySelector(`[data-s="${id}"]`);
  const off = []; // funções que removem os ouvintes
  const on = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); off.push(() => target.removeEventListener(type, fn, opt)); };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Troca o número e dá um "pulo" rápido.
  const put = (id, v, pop = true) => {
    const n = S(id);
    if (!n) return;
    if (n.innerHTML === String(v)) return;
    n.innerHTML = v;
    if (pop && !reduce) { n.classList.remove('tt-pop'); void n.offsetWidth; n.classList.add('tt-pop'); }
  };
  const flash = (node, cls) => { if (!node || reduce) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };

  /* ----- Abas ----- */
  const area = $('[data-tt="area"]');
  const setTab = (t, anim = true) => {
    el.dataset.tab = t;
    store.set('tester.tab', t);
    for (const b of el.querySelectorAll('[data-tt-tab]')) b.classList.toggle('active', b.dataset.ttTab === t);
    if (t === 'kb') area.focus({ preventScroll: true }); else area.blur();
    if (anim) for (const s of el.querySelectorAll(`section[data-show="${t}"]`)) flash(s, 'tt-in');
  };
  for (const b of el.querySelectorAll('[data-tt-tab]')) on(b, 'click', () => setTab(b.dataset.ttTab));

  /* ----- Teclado ----- */
  const keyEl = new Map();
  for (const n of el.querySelectorAll('.tt-kbfig .tt-key')) keyEl.set(n.dataset.k, n);
  const extrasBox = $('.tt-extras');
  const K = { down: 0, up: 0, held: new Map(), max: 0, tested: new Set(), count: new Map(), last: 0, logN: 0 };
  const klog = $('[data-tt="klog"]');

  // Elemento da tecla; códigos desconhecidos ganham uma tecla extra na hora.
  function nodeFor(code) {
    const k = CODE2K[code];
    if (k && keyEl.has(k)) return keyEl.get(k);
    let n = extrasBox.querySelector(`[data-code="${CSS.escape(code)}"]`);
    if (!n) {
      n = document.createElement('div');
      n.className = 'tt-key tt-xkey';
      n.dataset.code = code;
      n.innerHTML = `<span class="tt-kl">${esc(keyName(code))}</span><span class="tt-kc"></span>`;
      extrasBox.append(n);
      flash(n, 'tt-pop');
    }
    return n;
  }
  const inLayout = (code) => CODE2K[code] && keyEl.has(CODE2K[code]);

  function logKey(code, down, ts, hold) {
    const li = document.createElement('li');
    const delta = K.last ? ts - K.last : 0;
    K.last = ts;
    li.className = down ? 'down' : 'up';
    li.innerHTML = `<span class="lt">${wall(ts)}</span><span class="ld">${K.logN ? '+' + fmtMs(delta) : ''}</span>`
      + `<span class="lk"><b>${esc(keyName(code))}</b><small>${esc(code)}</small></span>`
      + `<span class="la">${down ? IC.down + t('tt.pressed') : IC.up + t('tt.released') + (hold != null ? ` <small>${fmtMs(hold)}</small>` : '')}</span>`;
    klog.prepend(li);
    K.logN++;
    while (klog.childElementCount > 200) klog.lastElementChild.remove();
    el.classList.add('has-klog');
    put('klogn', t('tt.events', { n: K.logN }), false);
  }

  function renderHeld() {
    const box = $('[data-tt="held"]');
    box.innerHTML = `<em>${t('tt.now')} <b data-s="know">${K.held.size}</b></em>` + [...K.held.keys()].map((c) => `<span>${esc(keyName(c))}</span>`).join('');
  }

  function keyStats() {
    put('kdown', K.down); put('kup', K.up); put('ktotal', K.down + K.up);
    const tested = [...K.tested].filter(inLayout).map((c) => CODE2K[c]);
    put('ktested', `${new Set(tested).size}<small>/${TOTAL}</small>`);
    put('kmax', K.max);
  }

  function press(code, ts) {
    const n = nodeFor(code);
    K.down++;
    K.held.set(code, ts);
    if (K.held.size > K.max) { K.max = K.held.size; flash(S('kmax')?.parentElement, 'tt-glow'); }
    K.tested.add(code);
    const c = (K.count.get(code) || 0) + 1;
    K.count.set(code, c);
    n.classList.add('down', 'tested');
    n.querySelector('.tt-kc').textContent = c;
    flash(n, 'tt-hit');
    logKey(code, true, ts);
    keyStats(); renderHeld();
  }

  function release(code, ts, silent = false) {
    const t0 = K.held.get(code);
    K.held.delete(code);
    const n = nodeFor(code);
    // A mesma tecla física pode vir por dois códigos (volume): só apaga se nenhum outro segurar.
    if (![...K.held.keys()].some((c) => nodeFor(c) === n)) n.classList.remove('down');
    if (!silent) {
      K.up++;
      K.tested.add(code);
      n.classList.add('tested');
      logKey(code, false, ts, t0 != null ? ts - t0 : null);
    }
    keyStats(); renderHeld();
  }

  // Solta tudo sem contar (saiu do teste com teclas presas).
  const releaseAll = () => { for (const c of [...K.held.keys()]) release(c, performance.now(), true); };
  on(area, 'keydown', (e) => {
    e.preventDefault(); // Tab, F5, Espaço, Alt… ficam no teste
    el.classList.add('kb-focus');
    if (e.repeat) return;
    const code = codeOf(e);
    if (K.held.has(code)) return;
    press(code, e.timeStamp);
  });
  on(area, 'keyup', (e) => {
    e.preventDefault();
    const code = codeOf(e);
    if (K.held.has(code)) release(code, e.timeStamp);
    else { // PrintScreen no Linux às vezes só manda o keyup
      nodeFor(code); K.tested.add(code); K.up++; nodeFor(code).classList.add('tested'); logKey(code, false, e.timeStamp); keyStats();
    }
    if (code === 'Escape') { releaseAll(); el.classList.remove('kb-focus'); area.blur(); }
  });
  // Perdeu o foco (Esc, Alt+Tab, clique fora): solta tudo sem contar.
  on(area, 'blur', () => { releaseAll(); el.classList.remove('kb-focus'); });
  on(window, 'blur', releaseAll);
  on(area, 'focus', () => el.classList.add('kb-focus'));

  /* ----- Mouse ----- */
  const pad = $('[data-tt="pad"]');
  const zone = (b) => pad.querySelector(`.tt-mz[data-b="${b}"]`);
  const ctr = (b) => el.querySelector(`.tt-ctr[data-b="${b}"]`);
  const M = { count: {}, dbl: 0, dblBy: {}, lastDown: {}, held: new Set(), wheel: { up: 0, down: 0 }, clicks: [], cpsMax: 0, minInt: null, minBtn: null };
  let thr = store.get('tester.dblMs', 80);

  function ripple(e, b) {
    if (reduce) return;
    const r = pad.getBoundingClientRect();
    const d = document.createElement('i');
    d.className = `tt-ripple b${b}`;
    d.style.left = `${e.clientX - r.left}px`; d.style.top = `${e.clientY - r.top}px`;
    $('[data-tt="ripples"]').append(d);
    d.addEventListener('animationend', () => d.remove(), { once: true });
  }

  function addDbl(b, dt) {
    M.dbl++;
    M.dblBy[b] = (M.dblBy[b] || 0) + 1;
    put('dbl', M.dbl);
    put('bd' + b, t(M.dblBy[b] > 1 ? 'tt.dblN' : 'tt.dbl1', { n: M.dblBy[b] }), false);
    ctr(b)?.classList.add('bad');
    const box = $('[data-tt="dbl"]');
    box.classList.add('bad');
    flash(box, 'tt-shake');
    const list = $('[data-tt="dbllist"]');
    const chip = document.createElement('span');
    chip.innerHTML = `${esc(BTN_NAME[b])} · <b>${fmtMs(dt)}</b>`;
    list.prepend(chip);
    while (list.childElementCount > 8) list.lastElementChild.remove();
  }

  function mouseDown(e) {
    const b = e.button;
    if (!(b in BTN_NAME)) return;
    const ts = e.timeStamp;
    M.count[b] = (M.count[b] || 0) + 1;
    M.held.add(b);
    put('b' + b, M.count[b]);
    zone(b)?.classList.add('down', 'tested');
    ctr(b)?.classList.add('tested');
    flash(ctr(b), 'tt-hit');
    // Intervalo desde o último aperto do mesmo botão (repique da chave aparece aqui).
    const prev = M.lastDown[b];
    M.lastDown[b] = ts;
    if (prev != null) {
      const dt = ts - prev;
      if (M.minInt == null || dt < M.minInt) { M.minInt = dt; M.minBtn = b; put('minint', `${fmtMs(dt)} <small>(${esc(BTN_NAME[b])})</small>`, false); }
      if (dt < thr) addDbl(b, dt);
    }
    M.clicks.push(ts);
    ripple(e, b);
    tickCps();
  }
  function mouseUp(b) {
    if (!M.held.delete(b)) return;
    zone(b)?.classList.remove('down');
  }

  on(pad, 'mousedown', (e) => { e.preventDefault(); area.blur(); mouseDown(e); }); // sem autoscroll nem seleção
  on(window, 'mouseup', (e) => { if (pad.contains(e.target) && e.button > 2) e.preventDefault(); mouseUp(e.button); }, true);
  on(pad, 'contextmenu', (e) => e.preventDefault());
  on(pad, 'auxclick', (e) => e.preventDefault());
  on(pad, 'wheel', (e) => {
    e.preventDefault();
    if (!e.deltaY) return;
    const dir = e.deltaY < 0 ? 'up' : 'down';
    M.wheel[dir]++;
    put('w' + dir, M.wheel[dir]);
    const c = el.querySelector(`.tt-ctr[data-w="${dir}"]`);
    c.classList.add('tested'); flash(c, 'tt-hit');
    flash(pad.querySelector(`.tt-warr[data-w="${dir}"]`), 'on');
    flash(zone(1), 'tt-roll-' + dir);
  }, { passive: false });
  on(window, 'blur', () => { for (const b of [...M.held]) mouseUp(b); });

  // Cliques por segundo: janela deslizante de 1 s.
  function tickCps() {
    const now = performance.now();
    while (M.clicks.length && now - M.clicks[0] > 1000) M.clicks.shift();
    const cps = M.clicks.length;
    put('cps', cps, false);
    if (cps > M.cpsMax) { M.cpsMax = cps; put('cpsmax', cps); }
  }

  /* ----- Taxa de polling ----- */
  // Cada relatório do mouse vira um evento (ou um evento "coalescido"); contamos por tempo.
  const P = { ts: [], samples: 0, sum: 0, max: 0, last: 0 };
  const RAW = 'onpointerrawupdate' in window;
  const moveType = RAW ? 'pointerrawupdate' : 'pointermove';
  put('hzsrc', t('tt.source', { src: `${RAW ? 'pointerrawupdate' : 'pointermove'} + getCoalescedEvents()` }), false);
  on(pad, moveType, (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const list = e.getCoalescedEvents?.() || [];
    const evs = list.length ? list : [e];
    for (const ev of evs) P.ts.push(ev.timeStamp);
    P.last = performance.now();
    if (P.ts.length > 4000) P.ts.splice(0, P.ts.length - 4000);
  });
  const STD = [125, 250, 500, 1000, 2000, 4000, 8000];
  function tickPoll() {
    const now = performance.now();
    const cut = now - 300;
    while (P.ts.length && P.ts[0] < cut) P.ts.shift();
    if (now - P.last > 120 || P.ts.length < 6) { put('hznow', '--', false); pad.classList.remove('moving'); return; }
    const span = P.ts[P.ts.length - 1] - P.ts[0];
    if (span < 60) return;
    const hz = ((P.ts.length - 1) / span) * 1000;
    pad.classList.add('moving');
    P.samples++; P.sum += hz;
    if (hz > P.max) P.max = hz;
    const avg = P.sum / P.samples;
    put('hznow', `${Math.round(hz)} Hz`, false);
    put('hzavg', `${Math.round(avg)}<small> Hz</small>`, false);
    put('hzmax', `${Math.round(P.max)}<small> Hz</small>`, false);
    const near = STD.reduce((a, b) => (Math.abs(Math.log(b / avg)) < Math.abs(Math.log(a / avg)) ? b : a));
    put('hzstd', `${near}<small> Hz</small>`, false);
  }
  const timers = [setInterval(tickCps, 100), setInterval(tickPoll, 150)];

  /* ----- Limite do duplo clique ----- */
  const range = $('[data-tt="thr"]');
  const paintRange = () => {
    const p = ((range.value - range.min) / (range.max - range.min)) * 100;
    range.parentElement.style.cssText = `--c:var(--accent);--p:${p}%`;
  };
  paintRange();
  on(range, 'input', () => { thr = +range.value; store.set('tester.dblMs', thr); put('thr', `${thr} ms`, false); paintRange(); });

  /* ----- Zerar ----- */
  on($('[data-tt="reset"]'), 'mousedown', (e) => e.preventDefault()); // não rouba o foco do teclado
  on($('[data-tt="reset"]'), 'click', () => {
    if (el.dataset.tab === 'kb') {
      Object.assign(K, { down: 0, up: 0, max: 0, last: 0, logN: 0 });
      K.held.clear(); K.tested.clear(); K.count.clear();
      for (const n of el.querySelectorAll('.tt-key')) { n.classList.remove('down', 'tested'); n.querySelector('.tt-kc').textContent = ''; }
      for (const n of extrasBox.querySelectorAll('.tt-xkey')) if (!EXTRAS.some(([c]) => c === n.dataset.code)) n.remove();
      klog.innerHTML = ''; el.classList.remove('has-klog'); put('klogn', t('tt.events', { n: 0 }), false);
      keyStats(); renderHeld();
    } else {
      Object.assign(M, { count: {}, dbl: 0, dblBy: {}, lastDown: {}, clicks: [], cpsMax: 0, minInt: null, minBtn: null });
      M.wheel = { up: 0, down: 0 };
      for (const [b] of BTN) { put('b' + b, 0, false); put('bd' + b, '', false); }
      put('wup', 0, false); put('wdown', 0, false); put('dbl', 0, false); put('cpsmax', 0, false); put('minint', '--', false);
      for (const n of el.querySelectorAll('.tt-ctr, .tt-mz')) n.classList.remove('tested', 'bad', 'down');
      $('[data-tt="dbl"]').classList.remove('bad'); $('[data-tt="dbllist"]').innerHTML = '';
      Object.assign(P, { ts: [], samples: 0, sum: 0, max: 0 });
      for (const id of ['hzavg', 'hzmax', 'hzstd']) put(id, '--', false);
    }
  });

  range.value = thr; put('thr', `${thr} ms`, false); paintRange();
  const first = store.get('tester.tab', 'kb') === 'mouse' ? 'mouse' : 'kb';
  if (first === 'kb') requestAnimationFrame(() => setTab('kb', false)); else setTab('mouse', false);

  return () => {
    for (const f of off) f();
    for (const t of timers) clearInterval(t);
  };
}
