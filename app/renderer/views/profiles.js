// Barra lateral de perfis (como no M HUB): Criar, Importar, a configuração do aparelho
// e até 6 perfis locais, cada um com menu ⋯ (Renomear, Exportar, Excluir).
import {
  MAX_PROFILES, NAME_MAX, adapterFor, loadProfiles, saveProfiles, activeIndex, nextName,
  profileData, exportProfile, readJsonFile, parseImport,
} from '../profiles.js';
import { t } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
const IC = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  import: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  dots: svg('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  export: svg('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.8 9.5a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4M12 16.8v.2"/>'),
};

// Estado da interface por aparelho (sobrevive aos redesenhos do app).
const uiState = new Map();   // id -> { menu, editing, busy }
const uiOf = (id) => { if (!uiState.has(id)) uiState.set(id, { menu: null, editing: null, busy: null }); return uiState.get(id); };

function toast(msg, error = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.append(t); }
  t.textContent = msg;
  t.className = `toast show ${error ? 'error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function menuHtml(i) {
  if (i < 0) return `<div class="pf-menu" role="menu">
    <button data-pf="export" data-i="-1">${IC.export}${t('pf.exportBackup')}</button></div>`;
  return `<div class="pf-menu" role="menu">
    <button data-pf="rename" data-i="${i}">${IC.edit}${t('pf.rename')}</button>
    <button data-pf="export" data-i="${i}">${IC.export}${t('pf.export')}</button>
    <button data-pf="delete" data-i="${i}" class="danger">${IC.trash}${t('pf.delete')}</button></div>`;
}

function rowHtml(i, name, on, ui) {
  const editing = ui.editing === i;
  const busy = ui.busy === i;
  return `<div class="pf-item ${on ? 'on' : ''} ${busy ? 'busy' : ''}" data-pf="activate" data-i="${i}" title="${esc(name)}">
    <span class="pf-dot"></span>
    ${editing
    ? `<input class="pf-input" data-pf-input="${i}" maxlength="${NAME_MAX}" value="${esc(name)}" spellcheck="false">`
    : `<span class="pf-name">${esc(name)}</span>${busy ? `<span class="pf-busy">${t('pf.applying')}</span>` : ''}`}
    <button class="pf-more" data-pf="menu" data-i="${i}" title="${t('pf.more')}">${IC.dots}</button>
    ${ui.menu === i ? menuHtml(i) : ''}
  </div>`;
}

// HTML da parte de perfis da barra lateral (substitui a linha fixa "Perfil do aparelho").
export function profilesSidebar(ctx) {
  const ad = adapterFor(ctx.drv);
  if (!ad) return `<div class="side-row">${t('pf.device')}</div>`;
  const list = loadProfiles(ad.storageKey);
  const act = activeIndex(list);
  const ui = uiOf(ctx.id);
  const full = list.length >= MAX_PROFILES;
  const ready = ad.ready() && ctx.st.online !== false;
  return `<div class="pf" data-pf-root>
    <button class="pf-create" data-pf="create" ${full || !ready ? 'disabled' : ''} title="${full ? t('pf.limit', { max: MAX_PROFILES }) : t('pf.createTip')}">${IC.plus}${t('pf.create')}</button>
    <button class="pf-import" data-pf="import" ${full ? 'disabled' : ''}>${IC.import}${t('pf.import')}</button>
    <input type="file" accept=".json,application/json" data-pf-file hidden>
    <div class="pf-title">${t('pf.title')} <span class="pf-help" title="${t('pf.help')}">${IC.help}</span><span class="pf-count">(${list.length}/${MAX_PROFILES})</span></div>
    <div class="pf-list">
      ${rowHtml(-1, t(ctx.drv.kind === 'keyboard' ? 'pf.onKeyboard' : 'pf.onMouse'), act < 0, ui)}
      ${list.map((p, i) => rowHtml(i, p.name, i === act, ui)).join('')}
    </div>
  </div>`;
}

// Liga os eventos. Pode ser chamada a cada redesenho: usa onclick (substitui, não acumula).
export function bindProfilesSidebar(root, ctx) {
  const box = root?.querySelector('[data-pf-root]');
  const ad = adapterFor(ctx.drv);
  if (!box || !ad) return;
  const ui = uiOf(ctx.id);
  const load = () => loadProfiles(ad.storageKey);
  const save = (list) => saveProfiles(ad.storageKey, list);

  // Redesenha só a barra de perfis (menus, renomear), sem refazer a página.
  const redraw = () => {
    const cur = root.querySelector('[data-pf-root]');
    if (!cur) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = profilesSidebar(ctx);
    cur.replaceWith(tmp.firstElementChild);
    bindProfilesSidebar(root, ctx);
  };

  trackEdits(ad, load, save);

  // Fecha o menu ao clicar fora.
  if (ui.menu != null) {
    const off = (e) => {
      if (e.target.closest?.('.pf-menu, [data-pf="menu"]')) return;
      document.removeEventListener('pointerdown', off, true);
      if (ui.menu != null) { ui.menu = null; redraw(); }
    };
    document.addEventListener('pointerdown', off, true);
  }

  const input = box.querySelector('[data-pf-input]');
  if (input) {
    if (document.activeElement !== input) { input.focus(); input.select(); }
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const i = +input.dataset.pfInput;
      const list = load();
      const name = input.value.trim().slice(0, NAME_MAX);
      if (commit && list[i] && name && name !== list[i].name) {
        if (list.some((p, j) => j !== i && p.name === name)) toast(t('pf.nameTaken'), true);
        else { list[i].name = name; save(list); }
      }
      ui.editing = null;
      redraw();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    };
    input.onblur = () => finish(true);
    input.onclick = (e) => e.stopPropagation();
  }

  const file = box.querySelector('[data-pf-file]');
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const obj = await readJsonFile(f);
      const list = load();
      const p = parseImport(obj, ad, list);
      list.push(p);
      save(list);
      toast(t('pf.imported', { name: p.name }));
    } catch (err) {
      toast(t('pf.importFail', { err: err.message || err }), true);
    }
    redraw();
  };

  box.onclick = async (e) => {
    const el = e.target.closest('[data-pf]');
    if (!el || !box.contains(el) || ui.busy != null) return;
    const i = el.dataset.i != null ? +el.dataset.i : null;
    const act = el.dataset.pf;
    if (act !== 'activate') e.stopPropagation();

    if (act === 'menu') { ui.menu = ui.menu === i ? null : i; return redraw(); }
    ui.menu = null;

    if (act === 'import') return file.click();

    if (act === 'create') {
      const list = load();
      if (list.length >= MAX_PROFILES) return toast(t('pf.limitHit', { max: MAX_PROFILES }), true);
      const data = await ad.snapshot();
      if (!data) return toast(t('pf.notRead'), true);
      list.push({ name: nextName(list), active: false, ...data });
      save(list);
      ui.editing = list.length - 1;   // já abre para renomear
      return redraw();
    }

    if (act === 'rename') { ui.editing = i; return redraw(); }

    if (act === 'export') {
      if (i < 0) {
        const data = await ad.snapshot();
        if (!data) return toast(t('pf.notRead'), true);
        exportProfile(ad.model, { name: `${ad.model} backup ${new Date().toISOString().slice(0, 10)}`, ...data });
      } else {
        const p = load()[i];
        if (p) exportProfile(ad.model, p);
      }
      return redraw();
    }

    if (act === 'delete') {
      const list = load();
      const p = list[i];
      if (!p) return redraw();
      redraw();
      const ok = await ctx.confirm(t('pf.deleteQ', { name: p.name }), t('pf.deleteQBody'));
      if (!ok) return;
      const fresh = load();
      const at = fresh.findIndex((x) => x.name === p.name);
      if (at >= 0) fresh.splice(at, 1);
      save(fresh);
      return redraw();
    }

    if (act === 'activate') {
      if (ui.editing != null) return;
      const list = load();
      const cur = activeIndex(list);
      if (i === cur) return;
      if (i < 0) {
        // Volta a mostrar só o que está no aparelho; nada é gravado.
        list.forEach((p) => { p.active = false; });
        save(list);
        return redraw();
      }
      const p = list[i];
      if (!p) return;
      // Durante a gravação nenhum perfil fica ativo: se falhar no meio, o perfil não é sobrescrito.
      list.forEach((x) => { x.active = false; });
      save(list);
      ui.busy = i;
      redraw();
      let ok = false;
      await ctx.run(async () => {
        try {
          await ad.apply(profileData(p));
          ok = true;
        } finally {
          ui.busy = null;
          const after = load();
          const at = after.findIndex((x) => x.name === p.name);
          after.forEach((x, j) => { x.active = ok && j === at; });
          save(after);
        }
      }, t('pf.applied', { name: p.name }));
      if (!ok) redraw();
    }
  };
}

// Como no M HUB, mudanças feitas nas abas vão para o perfil ativo.
async function trackEdits(ad, load, save) {
  const list = load();
  const act = activeIndex(list);
  if (act < 0 || !ad.ready()) return;
  const data = await ad.snapshot();
  if (!data) return;
  const fresh = load();
  const at = activeIndex(fresh);
  if (at !== act || fresh[at].name !== list[act].name) return;
  const cur = profileData(fresh[at]);
  if (ad.same(cur, data)) return;
  // Mantém as macros do perfil quando o snapshot não as traz.
  fresh[at] = { name: fresh[at].name, active: true, ...(cur.macros && !data.macros ? { macros: cur.macros } : {}), ...data };
  save(fresh);
}

