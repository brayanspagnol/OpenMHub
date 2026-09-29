// Imagens oficiais dos aparelhos MCHOSE, as mesmas que o M HUB mostra.
//
// O mapa modelo -> cores -> imagens vem de data/device-catalog.js, gerado por
// tools/fetch-device-assets.py a partir do próprio M HUB (bundle web + cardList.json do CDN).
// As imagens ficam em assets/devices/ porque a CSP do index.html só aceita img-src 'self'.
//
// 'card' = foto do cartão da home. 'top' = vista de cima do teclado (tela de teclas);
// no mouse o M HUB usa a mesma foto nos dois lugares.
import CATALOG from './data/device-catalog.js';

// Mesma normalização para o nome do aparelho e para os nomes do catálogo.
const norm = (s) => ` ${String(s || '').toUpperCase().replace(/^MCHOSE\s+/, '').replace(/[_\s-]+/g, ' ').trim()} `;
const hasName = (product, name) => {
  const n = norm(name).trim();
  return n && product.includes(n);
};

// Cores gravadas antes do catálogo, com os ids antigos.
const LEGACY = { graywhite: 'gray-white', bluewhite: 'star-blue', grayside: 'black-side', pink: 'pink-line', pinkside: 'pink-side' };

const cache = new Map();

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

// Cores para as bolinhas do cartão: [{ id, label, hex }] (hex pode ser gradiente ou url()).
export function colorsFor(model, opts) {
  const m = findModel(model, opts);
  return m ? m.colors.map((c) => ({ id: c.id, label: c.label, hex: c.dot })) : [];
}

export function deviceImage(model, view = 'card', color, opts = {}) {
  const m = findModel(model, opts);
  if (!m) return null; // renders.js mostra o ícone genérico do M HUB
  const id = LEGACY[color] && !m.colors.some((c) => c.id === color) ? LEGACY[color] : color;
  const c = m.colors.find((x) => x.id === id) || m.colors[0];
  return (view === 'top' && c.top) || c.card;
}
