/**
 * Abbinamento dei nomi squadra tra le tre fonti che usiamo, che scrivono lo stesso
 * club in modi diversi ("Inter" / "FC Internazionale Milano" / "Inter Milan").
 * Come "ponte" usiamo i nomi dei file storici (football-data.co.uk).
 * Regola: se non siamo SICURI dell'abbinamento, non abbiniamo (e il sistema lo scrive
 * nel log), invece di indovinare: un abbinamento sbagliato darebbe segnali falsi.
 */
function stripAccents(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

function tokens(name) {
  return stripAccents(String(name || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

// Nomi completi ambigui o molto diversi, risolti a mano.
const FULL_NAME_ALIASES = {
  'inter milan': 'Inter',
  'internazionale': 'Inter',
  'internazionale milano': 'Inter',
  'fc internazionale milano': 'Inter',
  'ac milan': 'Milan',
  'hellas verona': 'Verona',
  'hellas verona fc': 'Verona'
};
// Parole equivalenti tra fonti diverse.
const TOKEN_SYNONYMS = { inter: ['internazionale'] };

/** Restituisce il nome usato nei file storici per questa squadra, o null se non certo. */
function resolveHistoryTeam(apiName, csvNames) {
  const key = tokens(apiName).join(' ');
  const alias = FULL_NAME_ALIASES[key];
  if (alias && csvNames.includes(alias)) return alias;
  const exact = csvNames.find(n => tokens(n).join(' ') === key);
  if (exact) return exact;

  const apiTokens = new Set(tokens(apiName));
  const cands = csvNames.filter(n => {
    const ts = tokens(n);
    return ts.length > 0 && ts.every(t => apiTokens.has(t) || (TOKEN_SYNONYMS[t] || []).some(s => apiTokens.has(s)));
  });
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    const maxLen = Math.max(...cands.map(n => tokens(n).length));
    const best = cands.filter(n => tokens(n).length === maxLen);
    return best.length === 1 ? best[0] : null;
  }
  return null;
}

/** Due nomi (di fonti diverse) indicano la stessa squadra? Prudente: nel dubbio, no. */
function sameTeam(a, b, csvNames) {
  const ra = resolveHistoryTeam(a, csvNames), rb = resolveHistoryTeam(b, csvNames);
  if (ra && rb) return ra === rb;
  const ta = tokens(a), tb = tokens(b);
  if (ta.join(' ') === tb.join(' ')) return true;
  if (ra || rb) return false;
  const sa = new Set(ta), sb = new Set(tb);
  return ta.every(t => sb.has(t)) || tb.every(t => sa.has(t));
}

module.exports = { tokens, resolveHistoryTeam, sameTeam };
