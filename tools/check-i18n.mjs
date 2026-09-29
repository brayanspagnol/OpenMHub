// Confere os dicionários da interface: en e pt-BR com as mesmas chaves, mesmos {marcadores},
// e toda chave literal usada em t('...') existe (prefixos como t('fn.' + nome) ficam de fora). Uso: node tools/check-i18n.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../app/renderer/', import.meta.url).pathname;
const { default: en } = await import(join(dir, 'i18n/en.js'));
const { default: pt } = await import(join(dir, 'i18n/pt-BR.js'));

const errors = [];
const marks = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
for (const k of Object.keys(en)) {
  if (!(k in pt)) errors.push(`pt-BR sem a chave ${k}`);
  else if (marks(en[k]) !== marks(pt[k])) errors.push(`marcadores diferentes em ${k}`);
}
for (const k of Object.keys(pt)) if (!(k in en)) errors.push(`en sem a chave ${k}`);

const files = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? (e.name === 'i18n' ? [] : files(join(d, e.name))) : e.name.endsWith('.js') && e.name !== 'i18n.js' ? [join(d, e.name)] : []));
for (const f of files(dir)) {
  for (const [, key] of readFileSync(f, 'utf8').matchAll(/\bt\('([^'$]*[^'.$])'/g)) {
    if (!(key in en)) errors.push(`${f.slice(dir.length)}: chave inexistente ${key}`);
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`i18n ok: ${Object.keys(en).length} chaves`);
