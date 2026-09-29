// Idioma da interface: preferência salva (Configurações > Geral) ou o idioma do sistema.
// pt* vira pt-BR; o resto, inglês. Inglês também cobre chaves que faltem no outro dicionário.
// O idioma vale para a página inteira: trocar grava a preferência e recarrega.
import en from './i18n/en.js';
import ptBR from './i18n/pt-BR.js';

const DICTS = { en, 'pt-BR': ptBR };
export const LANGS = ['en', 'pt-BR'];

// 'auto' | 'en' | 'pt-BR' (guardado como JSON, igual às outras chaves do app).
export function langPref() {
  try {
    const v = JSON.parse(localStorage.getItem('lang'));
    return LANGS.includes(v) ? v : 'auto';
  } catch { return 'auto'; }
}

export const resolveLang = (pref) => (LANGS.includes(pref) ? pref : /^pt/i.test(navigator.language || '') ? 'pt-BR' : 'en');

export const lang = resolveLang(langPref());
document.documentElement.lang = lang;

// t('chave', { n: 1 }) troca {n}. Sem tradução: inglês, depois `fallback`, depois a própria chave.
export function t(key, vars, fallback) {
  let s = DICTS[lang][key] ?? en[key] ?? fallback ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
