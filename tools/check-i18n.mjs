// Confere os dicionários da interface: todos com as mesmas chaves do en, mesmos {marcadores},
// e toda chave literal usada em t('...') existe (prefixos como t('fn.' + nome) ficam de fora). Uso: node tools/check-i18n.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../app/renderer/', import.meta.url).pathname;
const load = async (name) => (await import(join(dir, `i18n/${name}.js`))).default;
const en = await load('en');
const others = { 'pt-BR': await load('pt-BR'), es: await load('es'), fr: await load('fr') };

const errors = [];
const marks = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
for (const [name, dict] of Object.entries(others)) {
  for (const k of Object.keys(en)) {
    if (!(k in dict)) errors.push(`${name} sem a chave ${k}`);
    else if (marks(en[k]) !== marks(dict[k])) errors.push(`${name}: marcadores diferentes em ${k}`);
  }
  for (const k of Object.keys(dict)) if (!(k in en)) errors.push(`${name}: chave a mais ${k} (não existe em en)`);
}

const files = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? (e.name === 'i18n' ? [] : files(join(d, e.name))) : e.name.endsWith('.js') && e.name !== 'i18n.js' ? [join(d, e.name)] : []));
for (const f of files(dir)) {
  for (const [, key] of readFileSync(f, 'utf8').matchAll(/\bt\('([^'$]*[^'.$])'/g)) {
    if (!(key in en)) errors.push(`${f.slice(dir.length)}: chave inexistente ${key}`);
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`i18n ok: ${Object.keys(en).length} chaves em en, ${Object.keys(others).join(', ')}`);
