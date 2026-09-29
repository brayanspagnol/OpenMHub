// Idioma da interface: preferência salva (Configurações > Geral) ou o idioma do sistema.
// es* vira es, fr* vira fr, pt* vira pt-BR; o resto, inglês. Inglês também cobre chaves que faltem no outro dicionário.
// O idioma vale para a página inteira: trocar grava a preferência e recarrega.
import en from './i18n/en.js';
import ptBR from './i18n/pt-BR.js';
import es from './i18n/es.js';
import fr from './i18n/fr.js';

const DICTS = { en, 'pt-BR': ptBR, es, fr };
export const LANGS = Object.keys(DICTS);

// 'auto' | 'en' | 'pt-BR' | 'es' | 'fr' (guardado como JSON, igual às outras chaves do app).
export function langPref() {
  try {
    const v = JSON.parse(localStorage.getItem('lang'));
    return LANGS.includes(v) ? v : 'auto';
  } catch { return 'auto'; }
}

export const resolveLang = (pref) => {
  if (LANGS.includes(pref)) return pref;
  const sys = (navigator.language || '').toLowerCase();
  return sys.startsWith('pt') ? 'pt-BR' : sys.startsWith('es') ? 'es' : sys.startsWith('fr') ? 'fr' : 'en';
};

export const lang = resolveLang(langPref());
document.documentElement.lang = lang;

// t('chave', { n: 1 }) troca {n}. Sem tradução: inglês, depois `fallback`, depois a própria chave.
export function t(key, vars, fallback) {
  let s = DICTS[lang][key] ?? en[key] ?? fallback ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
