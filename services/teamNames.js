/**
 * Abbinamento dei nomi squadra tra le tre fonti che usiamo, che scrivono lo stesso
 * club in modi diversi ("Inter" / "FC Internazionale Milano" / "Inter Milan").
 * Come "ponte" usiamo i nomi dei file storici (football-data.co.uk).
 * Regola: se non siamo SICURI dell'abbinamento, non abbiniamo (e il sistema lo scrive
 * nel log), invece di indovinare: un abbinamento sbagliato darebbe segnali falsi.
 */
function stripAccents(s) {
  // lettere che la normalizzazione non scompone (es. la "i" turca senza punto): senza questo "Kasimpasa" e "Kasımpaşa" non coincidono
  const extra = { 'ı': 'i', 'İ': 'I', 'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE' };
  return s.replace(/[ıİłŁøØđĐßæÆœŒ]/g, c => extra[c]).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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
  'hellas verona fc': 'Verona',
  // Turchia
  'istanbul basaksehir': 'Buyuksehyr', 'istanbul basaksehir fk': 'Buyuksehyr', 'basaksehir': 'Buyuksehyr', 'basaksehir fk': 'Buyuksehyr',
  'goztepe': 'Goztep', 'goztepe sk': 'Goztep', 'bodrum fk': 'Bodrumspor', 'bodrum': 'Bodrumspor',
  // Grecia
  'olympiacos': 'Olympiakos', 'olympiacos piraeus': 'Olympiakos', 'olympiakos piraeus': 'Olympiakos', 'olympiacos fc': 'Olympiakos',
  'larissa': 'Larisa', 'larissa fc': 'Larisa', 'levadiakos': 'Levadeiakos', 'volos': 'Volos NFC', 'volos nps': 'Volos NFC',
  'asteras tripoli': 'Asteras Tripolis', 'aris thessaloniki': 'Aris', 'paok salonika': 'PAOK',
  // Belgio
  'sint truidense': 'St Truiden', 'sint truiden': 'St Truiden', 'stvv': 'St Truiden',
  'union saint gilloise': 'St. Gilloise', 'royal union saint gilloise': 'St. Gilloise', 'union sg': 'St. Gilloise',
  'beerschot': 'Beerschot VA', 'k beerschot va': 'Beerschot VA', 'oh leuven': 'Oud-Heverlee Leuven',
  // Scozia
  'heart of midlothian': 'Hearts', 'heart of midlothian fc': 'Hearts',
  'volos fc': 'Volos NFC', 'leuven': 'Oud-Heverlee Leuven'
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
  return prefixFallback(apiTokens, csvNames);
}

/**
 * Ultimo ripiego, molto prudente: una parola del nome e' l'inizio di una parola di UN SOLO nome nello storico
 * (es. "Erzurum BB" -> "Erzurumspor", "Amed SK" -> "Amedspor"). Almeno 4 lettere, e solo se il candidato e' unico:
 * nel dubbio restituisce null e il nome finisce nel log.
 */
function prefixFallback(apiTokens, csvNames) {
  const hit = csvNames.filter(n => tokens(n).some(c => [...apiTokens].some(t => t !== c && Math.min(t.length, c.length) >= 4 && (c.startsWith(t) || t.startsWith(c)))));
  return hit.length === 1 ? hit[0] : null;
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
