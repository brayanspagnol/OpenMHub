// Perfis locais, como o M HUB (/gmouse): até 6 perfis por aparelho no localStorage.
// O primeiro item da lista (fixo) é a configuração que já está no aparelho; os perfis são cópias.
// Cada tipo de aparelho tem um adaptador: { kind, model, storageKey, snapshot(drv), apply(drv, data), same(a, b) }.
import { getMacros, itemsToActions } from './views/macros.js';

export const MAX_PROFILES = 6;
export const NAME_MAX = 24;

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const eqJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameBytes = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/* ---------- Armazenamento ---------- */
// Formato salvo: lista de perfis { name, active, ...dados }. Nenhum ativo = vale o do aparelho.
export function loadProfiles(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter((p) => p && typeof p.name === 'string').slice(0, MAX_PROFILES) : [];
  } catch { return []; }
}

export function saveProfiles(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* sem armazenamento */ }
}

export const activeIndex = (list) => list.findIndex((p) => p.active);

// "Nome", "Nome(1)", "Nome(2)"... como o M HUB faz ao importar.
export function uniqueName(list, base, skip = -1) {
  let name = base, n = 1;
  while (list.some((p, i) => i !== skip && p.name === name)) name = `${base}(${n++})`;
  return name;
}

export function nextName(list) {
  let n = list.length + 1;
  while (list.some((p) => p.name === `Perfil ${n}`)) n++;
  return `Perfil ${n}`;
}

// Separa os dados do perfil (sem nome e marca de ativo).
export function profileData(p) {
  const { name: _n, active: _a, ...data } = p;
  return data;
}

/* ---------- Exportar e importar ---------- */
const safeFile = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim() || 'perfil';

// Arquivo igual ao do M HUB: { deviceModel, profileData }.
export function exportProfile(model, profile) {
  const { active: _a, ...profileData } = profile;
  const text = JSON.stringify({ deviceModel: model, profileData }, null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFile(profile.name) + '.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { try { resolve(JSON.parse(r.result)); } catch { reject(new Error('o arquivo não é um JSON válido')); } };
    r.onerror = () => reject(new Error('não foi possível ler o arquivo'));
    r.readAsText(file, 'UTF-8');
  });
}

// Confere o arquivo e devolve o perfil novo (ainda não salvo). Erros em pt-BR.
export function parseImport(obj, adapter, list) {
  if (!obj || typeof obj !== 'object' || !obj.deviceModel || !obj.profileData) throw new Error('Arquivo de perfil inválido.');
  if (obj.deviceModel !== adapter.model) throw new Error(`Este perfil é de outro aparelho (${obj.deviceModel}).`);
  if (list.length >= MAX_PROFILES) throw new Error(`Limite de ${MAX_PROFILES} perfis atingido. Exclua um antes de importar.`);
  const data = profileData(obj.profileData);
  if (!adapter.valid(data)) throw new Error('O arquivo não traz uma configuração completa deste aparelho.');
  const base = String(obj.profileData.name || 'Importado').slice(0, NAME_MAX);
  return { name: uniqueName(list, base), active: false, ...clone(data) };
}

/* ---------- Adaptador do mouse (G3 V2 e parentes) ---------- */
const CONFIG_FIELDS = ['rateIdx', 'dpiCount', 'dpiIndex', 'dpis', 'scroll', 'lod', 'sensor', 'debounce', 'sleep', 'highspeed', 'angle'];
const pickConfig = (c) => Object.fromEntries(CONFIG_FIELDS.map((k) => [k, k === 'dpis' ? [...c.dpis] : c[k]]));
const pickKeys = (keys) => keys.map((k) => ({ type: k.type, code1: k.code1, code2: k.code2, code3: k.code3 }));
const macroKey = (drv) => `mhub.macros.${drv.identity || drv.productId}`;

const mouseAdapter = (drv) => ({
  kind: 'mouse',
  model: drv.name,
  storageKey: `mc_mouse_profiles_${drv.identity || drv.productId}`,
  ready: () => !!(drv.config && drv.keys),
  snapshot() {
    if (!drv.config || !drv.keys) return null;
    const data = { config: pickConfig(drv.config), keys: pickKeys(drv.keys) };
    // Macros só entram quando todas têm conteúdo conhecido (as do mouse não podem ser relidas).
    const macros = getMacros(drv);
    if (macros.length && !macros.some((m) => m.unknown)) data.macros = clone(macros);
    return data;
  },
  valid: (d) => !!(d.config && Array.isArray(d.config.dpis) && Array.isArray(d.keys) && d.keys.length === 5),
  same: (a, b) => eqJson(a.config, b.config) && eqJson(a.keys, b.keys) && (!a.macros || !b.macros || eqJson(a.macros, b.macros)),
  // Grava só o que difere e confere lendo de volta.
  async apply(data) {
    if (data.macros && !eqJson(data.macros, getMacros(drv)) && drv.writeMacros) {
      await drv.writeMacros(data.macros.map((m) => ({ type: m.type, actions: itemsToActions(m.items || []) })));
      const local = getMacros(drv);
      local.splice(0, local.length, ...clone(data.macros));
      try { localStorage.setItem(macroKey(drv), JSON.stringify(local)); } catch { /* sem armazenamento */ }
    }
    const cur = await drv.readConfig();
    if (!cur) throw new Error('o mouse não respondeu');
    if (!eqJson(pickConfig(cur), data.config)) await drv.writeConfig(clone(data.config));
    const keys = await drv.readKeys();
    if (!keys || !eqJson(pickKeys(keys), data.keys)) await drv.writeKeys(clone(data.keys));
    const backC = await drv.readConfig();
    const backK = await drv.readKeys();
    if (!backC || !eqJson(pickConfig(backC), data.config)) throw new Error('o mouse não guardou a configuração');
    if (!backK || !eqJson(pickKeys(backK), data.keys)) throw new Error('o mouse não guardou os botões');
  },
});

/* ---------- Adaptador do teclado (Sinowealth) ---------- */
// Se o driver tiver exportConfig/importConfig, usa; senão guarda as estruturas cruas
// (desempenho, luz, teclas das 2 camadas, cor por tecla) e regrava com os métodos do driver.
const rawOf = (drv) => (drv.perfRaw && drv.lightRaw && drv.keysRaw?.[0] && drv.keysRaw?.[1] && drv.diyRaw
  ? { perf: [...drv.perfRaw], light: [...drv.lightRaw], keys: { 0: [...drv.keysRaw[0]], 1: [...drv.keysRaw[1]] }, diy: [...drv.diyRaw] }
  : null);

// Troca a cópia do driver pela do perfil e chama o método de gravação sem mudanças:
// ele grava a estrutura inteira e confere lendo de volta. Se falhar, desfaz a troca.
async function writeRawPart(drv, prop, layer, bytes, write) {
  const holder = layer == null ? drv : drv.keysRaw;
  const slot = layer == null ? prop : layer;
  const old = holder[slot];
  holder[slot] = [...bytes];
  try { await write(); } catch (err) { holder[slot] = old; throw err; }
}

const keyboardAdapter = (drv) => ({
  kind: 'keyboard',
  model: drv.model || drv.name,
  storageKey: `mc_kb_profiles_${drv.identity || drv.productId}`,
  ready: () => !!drv.kb,
  async snapshot() {
    if (!drv.kb) return null;
    if (typeof drv.exportConfig === 'function') {
      const cfg = await drv.exportConfig();
      if (cfg) return { format: 'driver', config: clone(cfg) };
    }
    const raw = rawOf(drv);
    return raw && { format: 'raw', ...raw };
  },
  valid: (d) => (d.format === 'driver' ? !!d.config
    : d.format === 'raw' && Array.isArray(d.perf) && Array.isArray(d.light) && Array.isArray(d.diy) && Array.isArray(d.keys?.[0]) && Array.isArray(d.keys?.[1])),
  same: (a, b) => eqJson(a, b),
  async apply(data) {
    if (!drv.kb) throw new Error('o teclado ainda não foi lido (está dormindo?)');
    if (data.format === 'driver') {
      if (typeof drv.importConfig !== 'function') throw new Error('esta versão do driver não importa este formato');
      await drv.importConfig(clone(data.config));
      return;
    }
    // Só regrava a estrutura que difere (perfil idêntico = nada é gravado).
    if (!sameBytes(drv.perfRaw, data.perf)) await writeRawPart(drv, 'perfRaw', null, data.perf, () => drv.writePerformance({}));
    if (!sameBytes(drv.lightRaw, data.light)) {
      // writeLightColor grava o bloco inteiro; a cor do efeito 1 vai igual à do perfil.
      await writeRawPart(drv, 'lightRaw', null, data.light, () => drv.writeLightColor(1, data.light.slice(21, 24)));
    }
    for (const layer of [0, 1]) {
      if (!sameBytes(drv.keysRaw?.[layer], data.keys[layer])) await writeRawPart(drv, 'keysRaw', layer, data.keys[layer], () => drv.writeKeys({}, layer));
    }
    if (!sameBytes(drv.diyRaw, data.diy)) await writeRawPart(drv, 'diyRaw', null, data.diy, () => drv.writeDiy({}));
  },
});

export function adapterFor(drv) {
  if (drv.kind === 'mouse' && typeof drv.writeConfig === 'function') return mouseAdapter(drv);
  if (drv.kind === 'keyboard' && typeof drv.writePerformance === 'function') return keyboardAdapter(drv);
  return null;
}
