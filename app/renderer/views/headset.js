// Abas do headset (Ajustes, Outros). Só o que fica gravado no headset; o resto do M HUB é DSP do Windows.
import { seg, bigSlider, pfCard } from './mouse.js';
import { EQ_MODES, AUTO_OFF } from '../drivers/headset.js';
import { t } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const eqName = (mode) => t(['hs.game1', 'hs.game2', 'hs.music'][mode] || 'common.unknown');
export const autoOffMin = (v) => AUTO_OFF.find(([x]) => x === v)?.[1] ?? null;

export function headsetPane(tab, ctx) {
  const { st, drv } = ctx;
  const s = st.settings;
  if (!s) return `<div class="ov-wait">${t(st.online === false ? 'hs.off' : 'hs.reading')}</div>`;
  if (tab === 'others') return othersPane(ctx);
  return `<div class="pf">
    <p class="hs-note">${t('hs.untested')}</p>
    ${pfCard('hs-eq', t('hs.eq'), t('hs.eqDesc'), seg('hs-eq', EQ_MODES.map((m) => [m, eqName(m), '']), s.eq))}
    ${drv.model.turbo ? `
      ${pfCard('hs-off', t('hs.autoOff'), t('hs.autoOffDesc'), seg('hs-off', AUTO_OFF.map(([v, min]) => [v, `${min} min`, '']), s.autoOff))}
      ${pfCard('hs-prompt', t('hs.prompt'), t('hs.promptDesc'), bigSlider('hs-prompt', 1, 16, s.prompt ?? 8, '', ''))}` : ''}
    ${pfCard('hs-dsp', t('hs.dsp'), t('hs.dspDesc'), '')}
  </div>`;
}

function othersPane({ st, drv }) {
  return `<div class="others"><div class="others-cards">
    <div class="ocard"><div><h3>${t('hs.fw', { v: esc(st.firmware || '--') })}</h3><p>${t('hs.fwDesc')}</p></div></div>
    ${drv.model.wired ? '' : `<div class="ocard"><div><h3>${t('hs.rxFw', { v: esc(st.receiverFirmware || '--') })}</h3><p>${t('hs.fwDesc')}</p></div></div>`}
    ${drv.model.turbo ? `<div class="ocard"><div><h3>${t('oth.factory')}</h3><p>${t('hs.factoryDesc')}</p></div>
      <button class="btn-white" data-act="hs-factory">${t('common.restore')}</button></div>` : ''}
  </div></div>`;
}

export function bindHeadsetPane(root, ctx) {
  const { drv } = ctx;
  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
  on('[data-act="hs-eq"]', 'click', (el) => ctx.run(() => drv.setEq(+el.dataset.v)));
  on('[data-act="hs-off"]', 'click', (el) => ctx.run(() => drv.setAutoOff(+el.dataset.v)));
  on('[data-act="hs-prompt"]', 'input', (el) => {
    const box = el.closest('.pslider');
    box.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
    box.querySelector('[data-val]').textContent = el.value;
  });
  on('[data-act="hs-prompt"]', 'change', (el) => ctx.run(() => drv.setPrompt(+el.value)));
  on('[data-act="hs-factory"]', 'click', async () => {
    if (await ctx.confirm(t('oth.factoryQ'), t('hs.factoryQ'))) ctx.run(() => drv.factoryReset());
  });
}
