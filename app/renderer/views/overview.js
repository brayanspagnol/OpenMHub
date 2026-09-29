// Visão geral do aparelho: grade de blocos (foto + nome, anel de bateria, números e ficha).
// Cada bloco com número leva à aba onde aquilo é ajustado.
import { icon, batteryIcon } from '../icons.js';
import { RATES } from '../drivers/g3v2.js';
import { LIGHT_EFFECTS } from '../data/keyboard-ut98.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MODE = { wired: ['wired', 'Com fio'], '2.4g': ['wifi', 'Sem fio 2.4G'], bt: ['bluetooth', 'Bluetooth'] };
const R = 54;
const CIRC = 2 * Math.PI * R;

function batteryState(st) {
  if (st.battery == null) return ['', 'Sem leitura de bateria'];
  if (st.charging) return st.battery >= 100 ? ['ok', 'Carga completa'] : ['charging', 'Carregando pelo cabo'];
  if (st.battery < 20) return ['low', 'Bateria fraca: conecte o cabo'];
  if (st.battery < 50) return ['mid', 'Bateria pela metade'];
  return ['ok', 'Bateria boa'];
}

function stateChip(st) {
  if (st.online === false) return '<span class="ov-chip off"><i class="ov-led"></i>Desligado ou fora de alcance</span>';
  if (st.sleeping) return '<span class="ov-chip sleep"><i class="ov-led"></i>Em repouso</span>';
  return '<span class="ov-chip live"><i class="ov-led"></i>Ativo</span>';
}

// Cartão em moldura dupla: casca cinza por fora, miolo claro por dentro.
const shell = (cls, inner, attrs = '') => `<section class="ov-shell ${cls}" ${attrs}><div class="ov-core">${inner}</div></section>`;

function tile({ tab, ic, label, value, unit = '', foot = '' }) {
  return shell('ov-tile', `
    <div class="ov-tile-top"><span class="ov-ico">${icon(ic)}</span><span class="ov-label">${label}</span>
      ${tab ? `<span class="ov-go">${icon('chevron')}</span>` : ''}</div>
    <div class="ov-num">${value}<small>${unit}</small></div>
    <div class="ov-foot">${foot}</div>`, tab ? `data-go-tab="${tab}" role="button" tabindex="0"` : '');
}

const flag = (on, label) => `<span class="ov-flag ${on ? 'on' : ''}">${on ? icon('check') : '<i></i>'}${label}</span>`;

function hero(ctx, item) {
  const { st, drv } = ctx;
  const src = ctx.image?.('card');
  const [mi, ml] = MODE[st.mode] || ['offline', 'Desconhecido'];
  return shell('ov-hero', `
    <div class="ov-hero-text">
      <span class="ov-eyebrow">${drv.kind === 'keyboard' ? 'Teclado' : 'Mouse'} MCHOSE</span>
      <h2>${esc(st.name || drv.name)}</h2>
      <div class="ov-chips">
        <span class="ov-chip">${icon(mi)}${ml}</span>
        ${stateChip(st)}
      </div>
      <p class="ov-via">${esc(st.via || '')}</p>
    </div>
    <div class="ov-hero-img">${src ? `<img src="${esc(src)}" alt="" draggable="false">` : ''}</div>`);
}

function battery(st) {
  const pct = st.battery;
  const [cls, text] = batteryState(st);
  const off = pct == null ? CIRC : CIRC * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return shell(`ov-battery ${cls}`, `
    <div class="ov-ring">
      <svg viewBox="0 0 128 128"><circle class="ov-ring-bg" cx="64" cy="64" r="${R}"/>
        <circle class="ov-ring-fg" cx="64" cy="64" r="${R}" style="--c:${CIRC.toFixed(1)};--o:${off.toFixed(1)}"/></svg>
      <div class="ov-ring-val">${st.charging ? `<span class="ov-bolt">${batteryIcon(pct, true)}</span>` : ''}
        <b ${pct != null ? `data-count="${pct}"` : ''}>${pct != null ? pct + '%' : '--'}</b></div>
    </div>
    <div class="ov-bat-text"><span class="ov-label">Bateria</span><strong>${text}</strong></div>`);
}

function specs(rows) {
  return shell('ov-specs', `<span class="ov-label">Ficha do aparelho</span>
    <dl>${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
}

function mouseBody(ctx, item) {
  const { st, drv } = ctx;
  const c = st.config;
  if (!c) return `<div class="ov-wait">${st.online === false ? 'Ligue o mouse para ver a configuração.' : 'Lendo a configuração do mouse…'}</div>`;
  const pips = c.dpis.slice(0, c.dpiCount).map((_, i) => `<i class="${i === c.dpiIndex ? 'on' : ''}"></i>`).join('');
  return `
    ${tile({ tab: 'dpi', ic: 'dpi', label: 'DPI atual', value: c.dpis[c.dpiIndex], foot: `<span class="ov-pips">${pips}</span>Nível ${c.dpiIndex + 1} de ${c.dpiCount}` })}
    ${tile({ tab: 'perf', ic: 'perf', label: 'Taxa de polling', value: st.pollingRate ?? RATES[c.rateIdx] ?? '--', unit: 'Hz', foot: drv.isCable ? 'Fixa no cabo' : 'Pelo receptor 2.4G' })}
    ${tile({ tab: 'perf', ic: 'moon', label: 'Repouso', value: c.sleep || '∞', unit: c.sleep ? 'min' : '', foot: c.sleep ? 'Sem uso, o mouse dorme' : 'Nunca dorme' })}
    ${tile({ tab: 'perf', ic: 'keymap', label: 'Debounce', value: c.debounce, unit: 'ms', foot: c.debounce < 4 ? 'Muito baixo: risco de clique duplo' : 'Proteção contra clique duplo' })}
    ${shell('ov-sensor', `<span class="ov-label">Sensor</span>
      <div class="ov-flags">
        ${flag(!!(c.sensor & 1), 'Correção de linha')}
        ${flag(!!(c.sensor & 32), 'Motion Sync')}
        ${flag(!!(c.sensor & 16), 'Controle de ondulação')}
        ${flag(c.scroll === 1, 'Rolagem invertida')}
        <span class="ov-flag on plain">LOD ${c.lod === 1 || c.lod === 2 ? c.lod + ' mm' : 'padrão'}</span>
      </div>`, 'data-go-tab="perf" role="button" tabindex="0"')}
    ${specs([['Modelo', st.name || drv.name], ['Firmware', st.firmware], ['Receptor', st.receiverFirmware], ['USB', `${drv.productName} · ${item.key}`]])}`;
}

function keyboardBody(ctx, item) {
  const { st, drv } = ctx;
  const p = st.kb?.performance;
  if (!p) return `<div class="ov-wait">${st.sleeping ? 'Aperte uma tecla para acordar o teclado e ver a configuração.' : 'Lendo a configuração do teclado…'}</div>`;
  const fx = LIGHT_EFFECTS.find((e) => e.id === p.lightMode);
  const m = p.modes?.[p.lightMode];
  const bright = m ? Math.round(m.brightness / 5) : null;
  const macros = st.kb?.macros?.length ?? st.kb?.macros?.list?.length;
  return `
    ${tile({ tab: 'light', ic: 'light', label: 'Iluminação', value: `<span class="ov-word">${esc(fx?.name || (p.lightMode === 0 ? 'Desligada' : 'Personalizada'))}</span>`, foot: bright != null ? `<span class="ov-bar"><i style="width:${bright * 25}%"></i></span>Brilho ${bright} de 4` : 'Efeito atual' })}
    ${tile({ tab: 'perf', ic: 'moon', label: 'Hibernação', value: p.sleep ? p.sleepMin : '∞', unit: p.sleep ? 'min' : '', foot: p.sleep ? 'Sem uso, o teclado dorme' : 'Nunca dorme' })}
    ${tile({ tab: 'perf', ic: 'perf', label: 'Taxa de polling', value: p.pollingRate, unit: 'Hz', foot: 'Fixa neste modelo' })}
    ${tile({ tab: 'keymap', ic: 'keymap', label: 'Macros', value: macros ?? 0, foot: 'Gravadas no teclado' })}
    ${shell('ov-sensor', `<span class="ov-label">Modos</span>
      <div class="ov-flags">${flag(p.fastMode, 'Top Speed')}${flag(p.mac, 'Modo Mac')}${flag(p.winLock, 'Tecla Win bloqueada')}</div>`, 'data-go-tab="perf" role="button" tabindex="0"')}
    ${specs([['Modelo', st.name || drv.name], ['Conexão', st.via], ['USB', `${drv.productName} · ${item.key}`]])}`;
}

export function overviewPane(ctx, item) {
  const body = ctx.drv.kind === 'keyboard' ? keyboardBody(ctx, item) : mouseBody(ctx, item);
  return `<div class="ov">${hero(ctx, item)}${battery(ctx.st)}${body}</div>`;
}

export function bindOverview(root, goTab) {
  for (const el of root.querySelectorAll('[data-go-tab]')) {
    el.onclick = () => goTab(el.dataset.goTab);
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTab(el.dataset.goTab); } };
  }
}
