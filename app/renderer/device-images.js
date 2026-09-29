// Fotos oficiais dos aparelhos MCHOSE, as mesmas que o M HUB mostra.
//
// O mapa modelo -> cores -> imagens vem de data/device-catalog.js, gerado por
// tools/fetch-device-assets.py a partir do próprio M HUB (bundle web + cardList.json do CDN).
// As fotos não vêm no app: o catálogo guarda a URL do CDN e o protocolo mhub-img (main.js)
// baixa na primeira vez e guarda em cache. Sem rede, a <img> falha e app.js mostra o ícone genérico.
//
// 'card' = foto do cartão da home. 'top' = vista de cima do teclado (tela de teclas);
// no mouse o M HUB usa a mesma foto nos dois lugares.
import CATALOG from './data/device-catalog.js';
import { lang } from './i18n.js';

// Mesma normalização para o nome do aparelho e para os nomes do catálogo.
const norm = (s) => ` ${String(s || '').toUpperCase().replace(/^MCHOSE\s+/, '').replace(/[_\s-]+/g, ' ').trim()} `;
const hasName = (product, name) => {
  const n = norm(name).trim();
  return n && product.includes(n);
};

// Cores gravadas antes do catálogo, com os ids antigos.
const LEGACY = { graywhite: 'gray-white', bluewhite: 'star-blue', grayside: 'black-side', pink: 'pink-line', pinkside: 'pink-side' };

const cache = new Map();

// https://cdn.mchose.com.cn/x.png -> mhub-img://cdn.mchose.com.cn/x.png (URL codifica acentos e chinês).
export const imgUrl = (u) => {
  const url = new URL(u);
  return `mhub-img://${url.host}${url.pathname}`.replace(/'/g, '%27');
};
// Fotos que falharam (offline, CDN lento): o app usa o ícone genérico e tenta de novo
// depois de 2 min ou quando a rede volta.
const failed = new Map(); // src -> horário da falha
export const markFailed = (src) => failed.set(src, Date.now());
addEventListener('online', () => failed.clear());

// Acha o modelo como o M HUB: primeiro pelo VID/PID (teclados magnéticos), depois pelo
// primeiro nome do catálogo contido no nome do produto (a ordem do catálogo resolve
// "A7 V2 Pro+" antes de "A7"). `kind` desempata quando o nome serve para mouse e teclado.
export function findModel(model, { kind, vendorId, productId } = {}) {
  const key = `${model}|${kind}|${vendorId}|${productId}`;
  if (cache.has(key)) return cache.get(key);
  // Receptor genérico: "MCHOSE 2.4G Wireless-A7 V2" traz o modelo depois do "-";
  // sem sufixo, o M HUB mostra o G3.
  const raw = String(model || '');
  const rx = /^(MCHOSE 2\.4G Wireless|2\.4G Wireless Receiver)(-|$)/i;
  const product = norm(rx.test(raw) ? raw.replace(rx, '') || 'G3' : raw);
  const byId = vendorId != null && productId != null
    ? CATALOG.find((m) => m.ids?.some(([v, p]) => v === vendorId && p === productId)) : null;
  const byName = (list) => list.find((m) => m.names.some((n) => hasName(product, n)));
  const sameKind = kind ? CATALOG.filter((m) => m.kind === kind) : CATALOG;
  const found = byId || byName(sameKind.filter((m) => !m.ids)) || byName(sameKind) || null;
  cache.set(key, found);
  return found;
}

// O catálogo traz os nomes das cores em português; nos outros idiomas o nome sai do id (vindo das
// classes em inglês do M HUB), sem o modelo e com as palavras estranhas do bundle corrigidas.
// Em espanhol e francês cada palavra é traduzida (palavra a palavra, como os nomes do catálogo).
const MODEL_WORD = /^(a\d|ax\d|v\d|v9t|z75s?|kx75|gx87(v2)?|ace\d+(air\d|-?v\d)?|god\d+|k87|pro|ultra|r7|copy|headset)$/;
const EN_WORD = { sliver: 'silver', golden: 'gold', shuang: 'orange', yunwu: 'mist', loose: 'moss', barde: 'burgundy', shaded: 'gradient', blueness: 'bluish', glaze: 'glazed', shallow: 'soft',
  bmw: 'BMW', halo: 'Halo', blue2: 'blue 2', blue3: 'blue 3', pink2: 'pink 2' };
const WORD = {
  es: { white: 'blanco', black: 'negro', red: 'rojo', pink: 'rosa', blue: 'azul', green: 'verde', orange: 'naranja', gray: 'gris',
    purple: 'morado', yellow: 'amarillo', brown: 'marrón', cyan: 'cian', navy: 'marino', silver: 'plata', gold: 'dorado',
    deep: 'profundo', dark: 'oscuro', light: 'claro', soft: 'suave', pure: 'puro', bluish: 'azulado', frosted: 'escarchado',
    glazed: 'vidriado', gradient: 'degradado', sea: 'mar', sky: 'cielo', star: 'estrella', night: 'noche', mist: 'niebla',
    smoke: 'humo', snow: 'nieve', ice: 'hielo', cloud: 'nube', stone: 'piedra', sand: 'arena', forest: 'bosque', moss: 'musgo',
    feather: 'pluma', wave: 'ola', north: 'norte', tea: 'té', peach: 'melocotón', apricot: 'albaricoque', cherry: 'cereza',
    blackberry: 'mora', champagne: 'champán', burgundy: 'burdeos', moonrock: 'roca lunar', side: 'lateral', line: 'línea' },
  fr: { white: 'blanc', black: 'noir', red: 'rouge', pink: 'rose', blue: 'bleu', green: 'vert', orange: 'orange', gray: 'gris',
    purple: 'violet', yellow: 'jaune', brown: 'marron', cyan: 'cyan', navy: 'marine', silver: 'argent', gold: 'or',
    deep: 'profond', dark: 'foncé', light: 'clair', soft: 'doux', pure: 'pur', bluish: 'bleuté', frosted: 'givré',
    glazed: 'vitrifié', gradient: 'dégradé', sea: 'mer', sky: 'ciel', star: 'étoile', night: 'nuit', mist: 'brume',
    smoke: 'fumée', snow: 'neige', ice: 'glace', cloud: 'nuage', stone: 'pierre', sand: 'sable', forest: 'forêt', moss: 'mousse',
    feather: 'plume', wave: 'vague', north: 'nord', tea: 'thé', peach: 'pêche', apricot: 'abricot', cherry: 'cerise',
    blackberry: 'mûre', champagne: 'champagne', burgundy: 'bordeaux', moonrock: 'roche lunaire', side: 'latéral', line: 'ligne' },
};
export function colorLabelEn(id, to = 'en') {
  let words = id.split('-').filter((w) => !MODEL_WORD.test(w)).map((w) => EN_WORD[w] || w)
    .filter((w, i, a) => w !== a[i - 1]);
  const dict = WORD[to];
  if (dict) {
    // Espanhol e francês: o modificador vem depois (azul profundo, blanc brume); nomes próprios e números não mudam de lugar.
    words = words.flatMap((w) => w.split(' '));
    const num = words.at(-1) && /^\d+$/.test(words.at(-1)) ? [words.pop()] : [];
    if (words.every((w) => w in dict)) words.reverse();
    words = [...words.map((w) => dict[w] || w), ...num];
  }
  const s = words.join(' ') || id;
  return s[0].toUpperCase() + s.slice(1);
}

// Cores para as bolinhas do cartão: [{ id, label, hex }] (hex pode ser gradiente ou url()).
export function colorsFor(model, opts) {
  const m = findModel(model, opts);
  return m ? m.colors.map((c) => ({
    id: c.id, label: lang === 'pt-BR' ? c.label : colorLabelEn(c.id, lang), hex: c.dot.startsWith('url(') ? `url('${imgUrl(c.dot.slice(4, -1))}')` : c.dot,
  })) : [];
}

export function deviceImage(model, view = 'card', color, opts = {}) {
  const m = findModel(model, opts);
  if (!m) return null; // renders.js mostra o ícone genérico do M HUB
  const id = LEGACY[color] && !m.colors.some((c) => c.id === color) ? LEGACY[color] : color;
  const c = m.colors.find((x) => x.id === id) || m.colors[0];
  const src = imgUrl((view === 'top' && c.top) || c.card);
  return Date.now() - (failed.get(src) || 0) < 120000 ? null : src;
}
