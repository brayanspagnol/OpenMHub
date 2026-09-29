// Visão geral do aparelho: grade de blocos (foto + nome, anel de bateria, números e ficha).
// Cada bloco com número leva à aba onde aquilo é ajustado.
import { icon, batteryIcon } from '../icons.js';
import { RATES } from '../drivers/g3v2.js';
import { LIGHT_EFFECTS } from '../data/keyboard-ut98.js';
import { t } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MODE = { wired: ['wired', t('mode.wired')], '2.4g': ['wifi', t('mode.24g')], bt: ['bluetooth', 'Bluetooth'] };
const R = 54;
const CIRC = 2 * Math.PI * R;

function batteryState(st) {
  if (st.battery == null) return ['', t('ov.noBattery')];
  if (st.charging) return st.battery >= 100 ? ['ok', t('ov.full')] : ['charging', t('ov.chargingCable')];
  if (st.battery < 20) return ['low', t('ov.low')];
  if (st.battery < 50) return ['mid', t('ov.mid')];
  return ['ok', t('ov.good')];
}

function stateChip(st) {
  if (st.online === false) return `<span class="ov-chip off"><i class="ov-led"></i>${t('ov.off')}</span>`;
  if (st.sleeping) return `<span class="ov-chip sleep"><i class="ov-led"></i>${t('ov.asleep')}</span>`;
  return `<span class="ov-chip live"><i class="ov-led"></i>${t('ov.active')}</span>`;
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
  const [mi, ml] = MODE[st.mode] || ['offline', t('common.unknown')];
  return shell('ov-hero', `
    <div class="ov-hero-text">
      <span class="ov-eyebrow">${t(drv.kind === 'keyboard' ? 'kb.defaultName' : 'mouse.defaultName')}</span>
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
    <div class="ov-bat-text"><span class="ov-label">${t('ov.battery')}</span><strong>${text}</strong></div>`);
}

function specs(rows) {
  return shell('ov-specs', `<span class="ov-label">${t('ov.specs')}</span>
    <dl>${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
}

function mouseBody(ctx, item) {
  const { st, drv } = ctx;
  const c = st.config;
  if (!c) return `<div class="ov-wait">${t(st.online === false ? 'ov.mouseOff' : 'ov.readingMouse')}</div>`;
  const pips = c.dpis.slice(0, c.dpiCount).map((_, i) => `<i class="${i === c.dpiIndex ? 'on' : ''}"></i>`).join('');
  return `
    ${tile({ tab: 'dpi', ic: 'dpi', label: t('ov.dpiNow'), value: c.dpis[c.dpiIndex], foot: `<span class="ov-pips">${pips}</span>${t('dpi.levelOf', { n: c.dpiIndex + 1, count: c.dpiCount })}` })}
    ${tile({ tab: 'perf', ic: 'perf', label: t('ov.pollingRate'), value: st.pollingRate ?? RATES[c.rateIdx] ?? '--', unit: 'Hz', foot: t(drv.isCable ? 'ov.fixedCable' : 'ov.viaReceiver') })}
    ${tile({ tab: 'perf', ic: 'moon', label: t('ov.sleep'), value: c.sleep || '∞', unit: c.sleep ? 'min' : '', foot: t(c.sleep ? 'ov.mouseSleeps' : 'ov.neverSleeps') })}
    ${tile({ tab: 'perf', ic: 'keymap', label: t('ov.debounce'), value: c.debounce, unit: 'ms', foot: t(c.debounce < 4 ? 'ov.debounceLow' : 'ov.debounceOk') })}
    ${shell('ov-sensor', `<span class="ov-label">${t('perf.sensor')}</span>
      <div class="ov-flags">
        ${flag(!!(c.sensor & 1), t('perf.angle'))}
        ${flag(!!(c.sensor & 32), 'Motion Sync')}
        ${flag(!!(c.sensor & 16), t('perf.ripple'))}
        ${flag(c.scroll === 1, t('ov.reversed'))}
        <span class="ov-flag on plain">LOD ${c.lod === 1 || c.lod === 2 ? c.lod + ' mm' : t('common.default')}</span>
      </div>`, 'data-go-tab="perf" role="button" tabindex="0"')}
    ${specs([[t('ov.model'), st.name || drv.name], ['Firmware', st.firmware], [t('ov.receiver'), st.receiverFirmware], ['USB', `${drv.productName} · ${item.key}`]])}`;
}

function keyboardBody(ctx, item) {
  const { st, drv } = ctx;
  const p = st.kb?.performance;
  if (!p) return `<div class="ov-wait">${t(st.sleeping ? 'ov.kbWake' : 'ov.readingKb')}</div>`;
  const fx = LIGHT_EFFECTS.find((e) => e.id === p.lightMode);
  const m = p.modes?.[p.lightMode];
  const bright = m ? Math.round(m.brightness / 5) : null;
  const macros = st.kb?.macros?.length ?? st.kb?.macros?.list?.length;
  return `
    ${tile({ tab: 'light', ic: 'light', label: t('tab.light'), value: `<span class="ov-word">${esc(fx?.name || t(p.lightMode === 0 ? 'ov.lightOff' : 'ov.lightCustom'))}</span>`, foot: bright != null ? `<span class="ov-bar"><i style="width:${bright * 25}%"></i></span>${t('ov.brightness', { n: bright })}` : t('ov.effect') })}
    ${tile({ tab: 'perf', ic: 'moon', label: t('ov.hibernate'), value: p.sleep ? p.sleepMin : '∞', unit: p.sleep ? 'min' : '', foot: t(p.sleep ? 'ov.kbSleeps' : 'ov.neverSleeps') })}
    ${tile({ tab: 'perf', ic: 'perf', label: t('ov.pollingRate'), value: p.pollingRate, unit: 'Hz', foot: t('ov.fixedModel') })}
    ${tile({ tab: 'keymap', ic: 'keymap', label: 'Macros', value: macros ?? 0, foot: t('ov.macrosStored') })}
    ${shell('ov-sensor', `<span class="ov-label">${t('ov.modes')}</span>
      <div class="ov-flags">${flag(p.fastMode, 'Top Speed')}${flag(p.mac, t('ov.mac'))}${flag(p.winLock, t('ov.winLocked'))}</div>`, 'data-go-tab="perf" role="button" tabindex="0"')}
    ${specs([[t('ov.model'), st.name || drv.name], [t('ov.connection'), st.via], ['USB', `${drv.productName} · ${item.key}`]])}`;
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
