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
  // Nuovi campionati (nomi di The Odds API verso i file "new" di football-data.co.uk): ipotesi sui nomi, i non riconosciuti finiscono nel Log
  'urawa red diamonds': 'Urawa Reds', 'urawa reds': 'Urawa Reds',
  'austria wien': 'Austria Vienna', 'blau weiss linz': 'BW Linz', 'fc blau weiss linz': 'BW Linz', 'austria lustenau': 'A. Lustenau', 'sc austria lustenau': 'A. Lustenau',
  'flamengo': 'Flamengo RJ', 'cr flamengo': 'Flamengo RJ', 'botafogo': 'Botafogo RJ', 'botafogo fr': 'Botafogo RJ',
  'atletico mineiro': 'Atletico-MG', 'clube atletico mineiro': 'Atletico-MG', 'athletico paranaense': 'Athletico-PR', 'athletico pr': 'Athletico-PR', 'atletico paranaense': 'Athletico-PR', 'atletico pr': 'Athletico-PR',
  'chapecoense': 'Chapecoense-SC', 'associacao chapecoense': 'Chapecoense-SC',
  'la galaxy': 'Los Angeles Galaxy', 'los angeles galaxy': 'Los Angeles Galaxy', 'dc united': 'DC United', 'd c united': 'DC United',
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
  'volos fc': 'Volos NFC', 'leuven': 'Oud-Heverlee Leuven',
  // serie minori inglesi e spagnole (visti nel log dal vivo)
  'wimbledon': 'AFC Wimbledon', 'celta fortuna': ['Celta B', 'Celta Fortuna', 'Celta Vigo B'],
  // nomi di football-data.org diversi da quelli dei file di football-data.co.uk
  'nottingham forest': "Nott'm Forest", 'wolverhampton wanderers': 'Wolves', 'queens park rangers': 'QPR',
  'athletic club': 'Ath Bilbao', 'club atletico de madrid': 'Ath Madrid', 'atletico madrid': 'Ath Madrid',
  'rcd espanyol de barcelona': 'Espanol', 'espanyol': 'Espanol',
  'paris saint germain': 'Paris SG', 'olympique lyonnais': 'Lyon', 'stade rennais': 'Rennes',
  'fc bayern munchen': 'Bayern Munich', 'bayern munchen': 'Bayern Munich', 'eintracht frankfurt': 'Ein Frankfurt', 'borussia monchengladbach': "M'gladbach",
  'psv': 'PSV Eindhoven', 'az': 'AZ Alkmaar', 'nec': 'Nijmegen', 'fortuna sittard': 'For Sittard',
  'sporting cp': 'Sp Lisbon', 'sporting clube de portugal': 'Sp Lisbon', 'sc braga': 'Sp Braga', 'vitoria sc': 'Guimaraes', 'vitoria guimaraes': 'Guimaraes'
};
// Parole equivalenti tra fonti diverse.
const TOKEN_SYNONYMS = {
  inter: ['internazionale'], st: ['saint', 'sint'], rvs: ['rovers'], weds: ['wednesday'], sp: ['sporting'], utd: ['united'], man: ['manchester']
};

/** Restituisce il nome usato nei file storici per questa squadra, o null se non certo. */
function resolveHistoryTeam(apiName, csvNames) {
  const key = tokens(apiName).join(' ');
  // anche senza sigle generiche e numeri d'anno ("Wolverhampton Wanderers FC", "Stade Rennais FC 1901")
  const bare = tokens(apiName).filter(w => !['fc', 'afc', 'cf'].includes(w) && !/^\d+$/.test(w)).join(' ');
  const alias = [key, bare].flatMap(k => [].concat(FULL_NAME_ALIASES[k] || [])).find(a => csvNames.includes(a));
  if (alias) return alias;
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
