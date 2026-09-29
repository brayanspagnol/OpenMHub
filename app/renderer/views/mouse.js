// Abas do mouse (Botões, DPI, Desempenho, Outros), no layout do M HUB.
import { icon } from '../icons.js';
import { mouseRender } from '../renders.js';
import { RATES, SENSOR, DEFAULT_CONFIG, DEFAULT_KEYS, MACRO_TYPE } from '../drivers/g3v2.js';
import { macroListHtml, bindMacroList, macroName } from './macros.js';
import KEYS from '../data/mouse-keys.js';

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
const EXP = ' <span class="exp" title="O M HUB oficial não mostra esta opção para o G3 V2. Pode não ter efeito.">Experimental</span>';

// y = centro da etiqueta, em fração da altura da foto (a figura muda de tamanho com a janela).
// tx/ty: ponto do botão na foto (fração da largura/altura), medido no M HUB oficial.
const BUTTONS = [
  { label: 'Botão esquerdo', side: 'left', y: 0.19, tx: 0.3, ty: 0.13 },
  { label: 'Botão direito', side: 'right', y: 0.19, tx: 0.7, ty: 0.13 },
  { label: 'Botão do meio', side: 'right', y: 0.33, tx: 0.52, ty: 0.19 },
  { label: 'Voltar', side: 'left', y: 0.56, tx: 0.035, ty: 0.55 },
  { label: 'Avançar', side: 'left', y: 0.40, tx: 0.02, ty: 0.4 },
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
const PT = {
  leftButton: 'Clique esquerdo', rightButton: 'Clique direito', middleButton: 'Clique do meio',
  forward: 'Avançar', backward: 'Voltar', scrollUp: 'Rolar para cima', scrollDown: 'Rolar para baixo',
  DPI: 'Ciclo de DPI', cut: 'Recortar', copy: 'Copiar', paste: 'Colar',
  playPause: 'Tocar/pausar', mute: 'Mudo', stopPlaying: 'Parar', previousTrack: 'Faixa anterior',
  nextTrack: 'Próxima faixa', volumeUp: 'Volume +', volumeDown: 'Volume -', multimedia: 'Player de mídia',
  screenBrightnessUp: 'Brilho +', screenBrightnessDown: 'Brilho -', browserHomePage: 'Navegador: início',
  browserRefresh: 'Navegador: recarregar', browserStop: 'Navegador: parar', browserForward: 'Navegador: avançar',
  browserBackward: 'Navegador: voltar', browserFavorite: 'Navegador: favoritos', browserSearch: 'Navegador: busca',
  calculator: 'Calculadora', myComputer: 'Arquivos', mailbox: 'E-mail', forbidden: 'Desativado',
  'DPI +': 'DPI +', 'DPI -': 'DPI -', dpiSwitch: 'Alternar DPI',
};
const GROUPS = {
  mouse: 'Mouse', edit: 'Edição', multimedia: 'Multimídia', system: 'Sistema', keyboard: 'Teclas',
  navigation: 'Navegação', Windows: 'Tecla Super', efficiency: 'Produtividade', other: 'Outros', dpi: 'DPI',
};
const CATS = [
  ['system', 'Sistema'],
  ['keyboard', 'Teclado'],
  ['other', 'Atalhos'],
  ['macros', 'Macros'],
];
const keyLabel = (k) => PT[k.name] || k.name.replace('LWindows', 'Super');

const ALL_KEYS = Object.values(KEYS).flatMap((groups) => groups.flatMap((g) => g.keys));
const sameKey = (a, b) => a && b && a.type === b.type && a.code1 === b.code1 && a.code2 === b.code2 && a.code3 === b.code3;
export function keyName(k, drv = null) {
  if (!k) return '--';
  if (k.type === MACRO_TYPE) return drv ? `Macro: ${macroName(k, drv)}` : `Macro ${k.code1 + 1}`;
  if (k.type === 32 && k.code1 === 0) return 'Desativado';
  const f = ALL_KEYS.find((x) => sameKey(x, k));
  return f ? keyLabel(f) : `Código ${k.type}:${k.code1}:${k.code2}`;
}

/* ---------- Abas ---------- */
export function mousePane(tab, ctx) {
  const { st } = ctx;
  if (st.online === false) return `<div class="soon">Ligue o mouse ou mexa nele para acordar. As configurações aparecem quando ele responder.</div>`;
  if (!st.config) return `<div class="soon">Lendo a configuração do mouse…</div>`;
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

// Aba DPI no layout do M HUB atual: seletor de 1 a 6 níveis e um cartão com barra própria por nível.
function dpiPane({ st }) {
  const c = st.config;
  const r = st.dpiRange;
  const marks = [200, 1200, 2200, 3200, 4200].filter((m) => m >= r.min && m < r.max).concat(r.max);
  return `<div class="dpi2">
    <div class="dpi2-top">
      <span class="field-label">Número de níveis</span>
      <div class="dpi2-count">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="${n === c.dpiCount ? 'on' : ''}" data-act="dpi-count" data-v="${n}">${n}</button>`).join('')}</div>
      <span class="spacer"></span>
      <button class="btn-text" data-act="dpi-reset">${icon('undo')}Restaurar padrão</button>
    </div>
    <div class="dpi2-grid">
      ${c.dpis.slice(0, c.dpiCount).map((d, i) => {
        const pos = dpiToPos(d, r) / 10;
        return `<div class="dpi2-card ${i === c.dpiIndex ? 'on' : ''}" data-act="dpi-current" data-i="${i}" title="Clique para usar este nível">
          <span class="dpi2-dot"></span><span class="dpi2-n">${i + 1}</span>
          <div class="dpi2-slider" style="--p:${pos}%">
            <div class="dpi2-track"><i class="dpi2-fill"></i>${marks.map((m) => `<b style="left:${dpiToPos(m, r) / 10}%"></b>`).join('')}</div>
            <input type="range" min="0" max="1000" step="1" value="${Math.round(pos * 10)}" data-act="dpi-slider" data-i="${i}">
            <div class="dpi2-marks">${marks.map((m) => `<span style="left:${dpiToPos(m, r) / 10}%">${m}</span>`).join('')}</div>
          </div>
          <input class="dpi2-val" type="number" min="${r.min}" max="${r.max}" step="50" value="${d}" data-act="dpi-input" data-i="${i}">
          ${i === c.dpiIndex ? `<span class="dpi2-check">${icon('check')}</span>` : ''}
        </div>`;
      }).join('')}
    </div>
    <p class="dpi2-tip">Dica: o DPI é a sensibilidade do mouse. Use o botão de DPI do mouse para trocar de nível rápido.</p>
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

function perfPane({ st, drv }) {
  const c = st.config;
  const never = c.sleep === 0;
  const left = [
    card('Hibernação <small>(minutos)</small>', 'Sem uso por esse tempo em 2.4G ou Bluetooth, o mouse entra em repouso.', {
      below: `<div class="row-gap">${slider('sleep', 1, 100, never ? 3 : c.sleep, 'minutos')}${radio('sleep-never', 1, never, 'Nunca dormir')}</div>`,
    }),
    card('Taxa de polling <small>(Hz)</small>', drv.isCable ? 'Com cabo a taxa é fixa em 1000 Hz.' : 'Taxa maior reduz o atraso de entrada e gasta mais bateria.', {
      below: `<div class="radios">${drv.isCable ? radio('none', 0, true, '1000') : RATES.map((r, i) => radio('rate', i, i === c.rateIdx, r)).join('')}</div>`,
    }),
    card('Debounce das teclas <small>(milissegundos)</small>', 'Valor menor responde mais rápido; valor maior evita clique duplo. Não deixe baixo demais.', {
      below: slider('debounce', 0, 20, c.debounce, 'milissegundos'),
    }),
    card('Altura de levantamento (LOD)' + EXP, 'Altura a partir da qual o sensor para de ler o movimento.', {
      below: `<div class="radios">${[1, 2].map((v) => radio('lod', v, c.lod === v || (v === 1 && c.lod === 0xff), `${v} mm`)).join('')}</div>`,
    }),
  ];
  const right = [
    card('Controle de ondulação' + EXP, 'Ajuste de algoritmo em alta velocidade para eliminar tremidas em forma de onda.', { inline: sw('sensor-ripple', !!(c.sensor & SENSOR.ripple)) }),
    card('Correção de linha', 'O mouse endireita o movimento em linha reta.', { inline: sw('sensor-angle', !!(c.sensor & SENSOR.angleSnap)) }),
    card('Motion Sync' + EXP, 'Sincroniza a leitura do sensor com o envio ao computador, para movimento mais regular.', { inline: sw('sensor-motion', !!(c.sensor & SENSOR.motionSync)) }),
    card('Direção da rolagem', 'Inverte o sentido da roda do mouse.', {
      below: `<div class="radios">${radio('scroll', 0, c.scroll !== 1, 'Normal')}${radio('scroll', 1, c.scroll === 1, 'Invertida')}</div>`,
    }),
  ];
  return `<div class="perf-grid"><div class="col">${left.join('')}</div><div class="col">${right.join('')}</div></div>`;
}

function othersPane(ctx) {
  const { st, drv } = ctx;
  return `<div class="others">
    <div class="others-render">${mouseFig(ctx, 380)}</div>
    <div class="others-cards">
      <div class="ocard"><div><h3>Firmware do mouse: ${esc(st.firmware || '--')}</h3>
        <p>Atualização de firmware ainda não é suportada no Linux. Use o M HUB oficial para atualizar.</p></div>
        <button class="btn-white" disabled>Atualizar</button></div>
      <div class="ocard"><div><h3>Firmware do receptor: ${esc(st.receiverFirmware || '--')}</h3>
        <p>${drv.isCable ? 'Conecte pelo receptor 2.4G para ler a versão.' : 'Receptor 2.4G conectado.'}</p></div>
        <button class="btn-white" disabled>Atualizar</button></div>
      <div class="ocard"><div><h3>Parear o receptor</h3>
        <p>Com a chave do mouse em 2.4G e o receptor conectado, segure os botões esquerdo, do meio e direito juntos por 3 a 5 segundos.</p></div></div>
      <div class="ocard"><div><h3>Restaurar configurações de fábrica</h3>
        <p>DPI, polling, desempenho e botões voltam ao padrão. Faça isso com cuidado.</p></div>
        <button class="btn-white" data-act="factory">Restaurar</button></div>
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
      <div class="ksearch">${icon('search')}<input data-act="key-search" placeholder="Buscar função" value="${esc(ui.keySearch || '')}"></div>
      <div class="kcats">${CATS.map(([id, label]) => `<button class="kcat ${cat === id ? 'on' : ''}" data-act="key-cat" data-v="${id}">${label}</button>`).join('')}</div>
      <p class="khint">Clique numa função para ligá-la ao botão selecionado no mouse.</p>
      <div class="klist">
        ${cat === 'macros' ? macroListHtml(ctx, keys, sel, q) : groups.map((g) => {
          const closed = !q && ui.keyClosed?.includes(g.group);
          return `<div class="kgroup ${closed ? 'closed' : ''}"><button class="kgroup-title" data-act="key-group" data-v="${esc(g.group)}">${GROUPS[g.group] || g.group}${icon('chevron')}</button>
          <div class="kitems ${cat === 'keyboard' ? 'grid' : ''}">${g.keys.map((k) => {
            const on = sameKey(k, keys[sel]);
            return `<button class="kitem ${on ? 'on' : ''}" data-act="key-set" data-k="${esc(JSON.stringify([k.type, k.code1, k.code2, k.code3]))}">${esc(all(k))}</button>`;
          }).join('')}</div></div>`; }).join('') || '<div class="kempty">Nada encontrado.</div>'}
      </div>
    </div>
    <div class="kmouse">
      <div class="kfig">
        ${mouseFig(ctx, null)}
        ${BUTTONS.map((b, i) => { const val = esc(keyName(keys[i], drv)); return `<button class="kchip ${b.side} ${i === sel ? 'on' : ''}" style="top:${b.y * 100}%" data-act="key-sel" data-i="${i}" title="${b.label}: ${val}">
          <span class="kchip-val">${val}</span><i class="lead"></i></button>`; }).join('')}
      </div>
      <button class="btn-ghost" data-act="keys-reset">${icon('undo')}Restaurar padrão</button>
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
  on('[data-act="dpi-count"]', 'click', (el, e) => { e.stopPropagation(); const n = +el.dataset.v; ctx.write({ dpiCount: n, dpiIndex: Math.min(c.dpiIndex, n - 1) }); });
  on('[data-act="dpi-current"]', 'click', (el, e) => {
    if (e.target.closest('input')) return;
    const i = +el.dataset.i; if (i !== c.dpiIndex) ctx.write({ dpiIndex: i });
  });
  on('[data-act="dpi-input"]', 'change', (el) => setDpi(+el.dataset.i, +el.value));
  on('[data-act="dpi-input"]', 'keydown', (el, e) => { if (e.key === 'Enter') el.blur(); });
  on('[data-act="dpi-slider"]', 'input', (el) => {
    const card = el.closest('.dpi2-card');
    card.querySelector('.dpi2-slider').style.setProperty('--p', `${el.value / 10}%`);
    card.querySelector('.dpi2-val').value = posToDpi(+el.value, st.dpiRange);
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
    const ok = await ctx.confirm('Restaurar configurações de fábrica?', 'DPI, taxa de polling, desempenho e os 5 botões voltam ao padrão do M HUB. Isso não pode ser desfeito.');
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
      const ok = await ctx.confirm('Mudar o botão esquerdo?', 'Sem clique esquerdo fica difícil usar o computador. Se precisar voltar, use outro mouse ou o touchpad e clique em Restaurar padrão.');
      if (!ok) return;
    }
    keys[sel] = { type, code1, code2, code3 };
    ctx.writeKeys(keys);
  });
  on('[data-act="keys-reset"]', 'click', () => ctx.writeKeys(DEFAULT_KEYS.map((k) => ({ ...k }))));

  // Macros
  bindMacroList(root, ctx);
}
