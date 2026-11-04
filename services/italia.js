/**
 * Strategia I – "Quote italiane" (prova dal vivo, senza soldi veri).
 *
 * Idea: il segnale si misura sulla quota che Christian puo' davvero giocare in Italia (bookmaker con licenza ADM),
 * non su quella dei bookmaker esteri. Per ogni partita delle prossime ore si confronta il miglior prezzo tra i libri
 * italiani scelti con il prezzo "onesto" di Pinnacle (stesso metodo power della strategia A); alla chiusura si misura il CLV.
 *
 * Fonte: odss-api.com (variabile ODSS_API_KEY). NON usa i crediti di The Odds API e non tocca la strategia A.
 * Gira dentro la chiamata /api/capture-closing (ogni 10 minuti): la scansione parte solo ogni ITALIA_SCAN_EVERY_MIN
 * minuti tra le 9 e le 22 (ora italiana); la cattura di chiusura solo se ci sono segnali vicini al calcio d'inizio.
 * Tetto mensile di richieste (ITALIA_MONTHLY_CAP, predefinito 400) con una riserva per le chiusure.
 * Qualsiasi errore qui viene registrato e non ferma mai il resto.
 */
// 3 novembre 2026 (velocita'): le date dal database sono gia' oggetti Date; Date.parse li riconvertiva in testo a ogni confronto
const T = v => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));
let pinBoardDropped = false, ouBusy = false;
const axios = require('axios');
const { noVigPower } = require('./sharpSignals');

const BASE = 'https://odss-api.com/api/v1';
const DEFAULT_BOOKS = ['netwin', '888sport_it', 'sisal', 'snai', 'goldbet', 'eurobet'];
// Strategia B (selezione B dai dati della A, fonte odss): stessi libri esteri della A tranne quelli peggiori (LeoVegas, Coolbet, GTbets, Betsson).
// Strategia T (26 ottobre 2026, solo misura): TUTTI i siti giocabili dall'Italia presenti nel feed (playable_it: true),
// visti in una risposta di prova su Coritiba - Gremio. Stessa richiesta della I: nessuna richiesta in piu' al feed.
// Serve a capire quali siti hanno piu' spesso la quota migliore (dove aprire i conti) e quanti segnali in piu' darebbero.
const DEFAULT_T_BOOKS = ['888sport_it', 'snai', 'sisal', 'pokerstars', 'eurobet', 'goldbet', 'netwin', 'eplay24', 'sportium', 'betwin360', 'fastbet', 'zonagioco',
  'gioca7', 'vincitu', 'stanleybet', 'daznbet', 'betsson', 'williamhill', 'staryes', 'codere', 'bgame', 'sunbet', 'domusbet', 'totosi', 'quigioco', 'perlaplay',
  'sportbet', 'casinosanremo', 'marathonbet', 'netbet', 'admiralbet', 'starcasino', 'starvegas', 'winamax', 'lottomatica'];
// Siti della stessa societa' (stesse quote): per contare quanti siti INDIPENDENTI sono d'accordo
const BOOK_FAMILY = { snai: 'flutter', sisal: 'flutter', pokerstars: 'flutter', eplay24: 'betplay', sportium: 'betplay', betwin360: 'betplay', fastbet: 'altenar', zonagioco: 'altenar',
  betsson: 'betsson_group', starcasino: 'betsson_group', admiralbet: 'novomatic', starvegas: 'novomatic' };
const DEFAULT_B_BOOKS = ['onexbet', 'unibet_se', 'unibet_nl', 'williamhill', 'marathonbet', '888sport', 'bet365'];
const BOOK_NAMES = { fastbet: 'Fastbet', zonagioco: 'Zonagioco', eplay24: 'Eplay24', sportium: 'Sportium', betwin360: 'Betwin360', gioca7: 'Gioca7', vincitu: 'Vincitu', stanleybet: 'Stanleybet', daznbet: 'DAZN Bet', staryes: 'StarYes', codere: 'Codere', bgame: 'Bgame', sunbet: 'Sunbet', domusbet: 'Domusbet', totosi: 'Totosì', quigioco: 'Quigioco', perlaplay: 'Perlaplay', sportbet: 'Sportbet', casinosanremo: 'Casinò Sanremo', netbet: 'NetBet', admiralbet: 'AdmiralBet', starcasino: 'StarCasinò', starvegas: 'StarVegas', winamax: 'Winamax', netwin: 'Netwin', '888sport_it': '888sport', sisal: 'Sisal', snai: 'Snai', goldbet: 'Goldbet', eurobet: 'Eurobet', lottomatica: 'Lottomatica', pokerstars: 'PokerStars', leovegas: 'LeoVegas', betsson: 'Betsson', bet365: 'bet365', planetwin365: 'Planetwin365',
  onexbet: '1xBet', unibet_se: 'Unibet (SE)', unibet_nl: 'Unibet (NL)', williamhill: 'William Hill', marathonbet: 'Marathonbet', '888sport': '888sport (estero)' };
const STRATEGIES = {
  I: { letter: 'I', title: 'Quote italiane contro Pinnacle', playable: true },
  B: { letter: 'B', title: 'Selezione B – libri esteri (da odss)', playable: false },
  T: { letter: 'T', title: 'Tutti i siti italiani (solo misura)', playable: false }
};
const OUT = { home: 'HOME', draw: 'DRAW', away: 'AWAY' };
// formattatori dell'ora italiana creati una volta sola (crearli a ogni riga riempiva la memoria del server)
const ROME_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' });
const ROME_HOUR = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false });
const ROME_WHEN = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const SEL_NAME = { home: '1', draw: 'X', away: '2' };

function cfg(env = process.env) {
  const n = (k, d) => (env[k] !== undefined && env[k] !== '' && !isNaN(Number(env[k])) ? Number(env[k]) : d);
  return {
    key: String(env.ODSS_API_KEY || '').trim().replace(/^['"]+|['"]+$/g, '').trim(),   // spazi, a capo o virgolette copiati per sbaglio
    books: (env.ITALIA_BOOKS ? env.ITALIA_BOOKS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_BOOKS),
    minEdge: n('ITALIA_MIN_EDGE', 2),          // %
    maxEdge: n('ITALIA_MAX_EDGE', 15),         // % (sopra e' quasi sempre un errore del feed)
    minOdd: n('ITALIA_MIN_ODD', 1.3),
    maxOdd: n('ITALIA_MAX_ODD', 5),            // selezione B: quote alte troppo rischiose
    windowHours: n('ITALIA_WINDOW_HOURS', 6),  // selezione B: solo partite delle prossime 6 ore
    minLeadMin: n('ITALIA_MIN_LEAD_MIN', 15),  // non segnalare partite che iniziano tra meno di 15 minuti
    scanEveryMin: n('ITALIA_SCAN_EVERY_MIN', 180),
    fromHour: n('ITALIA_FROM_HOUR', 9), toHour: n('ITALIA_TO_HOUR', 22),
    monthlyCap: n('ITALIA_MONTHLY_CAP', 400),
    closeReserve: n('ITALIA_CLOSE_RESERVE', 60),
    // giorno del mese in cui odss ricarica le richieste (1° novembre 2026: 12)
    resetDay: n('ODSS_RESET_DAY', 12),
    // chiusura: si chiede Pinnacle quando una partita segnalata parte entro 15 minuti, e nella stessa richiesta
    // si prendono tutte quelle che partono entro 45 minuti (una richiesta per gruppo di partite, nessuna ripetizione)
    closeTriggerMin: n('ITALIA_CLOSE_TRIGGER_MIN', 15),
    closeWindowMin: n('ITALIA_CLOSE_WINDOW_MIN', 45),
    // chiusura solo per i segnali con vantaggio da questa soglia in su (0 = tutti). Con 4 si misurano le F2+ e le sicure
    // spendendo circa un terzo di richieste in meno (25 ottobre 2026: quota odss 500 al mese, rinnovo il 12)
    closeMinEdge: n('ITALIA_CLOSE_MIN_EDGE', 0),
    maxStaleMin: n('ITALIA_MAX_STALE_MIN', 30),
    // Strategia B: stessa richiesta della I (zero richieste in piu'), libri esteri, edge 2-5%, quota sotto 5, entro 6 ore
    bBooks: (env.B_BOOKS ? env.B_BOOKS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_B_BOOKS),
    bMinEdge: n('B_MIN_EDGE', 2), bMaxEdge: n('B_MAX_EDGE', 5), bMaxOdd: n('B_MAX_ODD', 5),
    bEnabled: env.B_ENABLED !== 'false',
    tBooks: (env.T_BOOKS ? env.T_BOOKS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_T_BOOKS),
    tEnabled: env.T_ENABLED !== 'false',
    // ⚽ gol (1° novembre 2026): quote Over/Under sulla carta, una richiesta in piu' a scansione. Spente finche' OU_ENABLED non e' 'true'
    ouEnabled: env.OU_ENABLED === 'true', ouMarket: String(env.OU_MARKET || 'over_under').trim(),
    // 1° novembre 2026: i siti dove Christian ha il conto (MY_BOOKS su Render, chiavi del feed separate da virgola).
    // "👉 Gioca su" sceglie la quota piu' alta tra questi.
    myBooks: (env.MY_BOOKS ? env.MY_BOOKS.split(',').map(s => s.trim()).filter(Boolean) : ['888sport_it', 'snai', 'netwin', 'eurobet', 'goldbet'])
  };
}

/** Config della strategia richiesta (I o B) nella stessa forma usata da findSignals. */
function cfgFor(c, strategy) {
  if (strategy === 'T') return { ...c, books: c.tBooks };   // stesse regole della I, piu' siti italiani
  return strategy === 'B' ? { ...c, books: c.bBooks, minEdge: c.bMinEdge, maxEdge: c.bMaxEdge, maxOdd: c.bMaxOdd } : c;
}

// ------------------------------------------------------------------------------------------- parte pura (testata)

/** Solo le righe 1X2 della partita intera (il feed ha anche primo e secondo tempo, con le stesse etichette). */
function mainRecords(records) {
  return (records || []).filter(r => r && r.market === '1x2' && (r.scope || 'match') === 'match' && (r.period || 'full_time') === 'full_time' && (r.state || 'prematch') === 'prematch');
}

function trio(o) {
  if (!o) return null;
  const h = Number(o.HOME), d = Number(o.DRAW), a = Number(o.AWAY);
  return h > 1 && d > 1 && a > 1 ? { home: h, draw: d, away: a } : null;
}

const fresh = (b, nowMs, maxStaleMin) => !b.last_update || (nowMs - T(b.last_update)) <= maxStaleMin * 60000;

// Abbinamento tra righe della stessa partita scritte in modo diverso dai bookmaker ("Benfica - Celtic" e "Benfica - Celtic Glasgow").
const GENERIC = new Set(['fc', 'cf', 'ac', 'sc', 'afc', 'cd', 'ud', 'sd', 'club', 'de', 'the', 'calcio', 'fk', 'sk', 'if', 'bk', 'cp', 'sv', 'vfb', 'vfl', 'tsg', 'as', 'ss', 'us', 'rc', 'rcd', 'ca', 'ad', 'sl', 'fsv', 'spvgg', 'sporting', 'real', 'united', 'city', 'town', 'athletic', 'atletico']);
const FLAGS = ['u17', 'u18', 'u19', 'u20', 'u21', 'u23', 'women', 'w', 'femminile', 'riserve', 'reserves', 'ii', 'b'];
const LEAGUE_FLAGS = ['u17', 'u18', 'u19', 'u20', 'u21', 'u23', 'women', 'femminile', 'reserves', 'riserve', 'youth', 'primavera'];
const FRIENDLY = /friendl|amichev|club friendly|test match/i;
// Fascia di quota consigliata: 4-6 vinte su 10 (saldo piu' regolare a parita' di vantaggio)
const BAND = { min: 1.6, max: 2.6 };
const inBand = odd => Number(odd) >= BAND.min && Number(odd) <= BAND.max;
const words = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
// Nomi che non hanno parole in comune tra le fonti (football-data.org scrive "Athletic Club" o "Athletic", il feed "Athletic Bilbao")
const ALIAS = { 'athletic club': 'athletic bilbao', 'athletic': 'athletic bilbao', 'athletic club bilbao': 'athletic bilbao' };
const canonWords = s => { const w = words(s), k = w.join(' '); return ALIAS[k] ? ALIAS[k].split(' ') : w; };
function sameTeam(a, b) {
  const wa = canonWords(a), wb = canonWords(b);
  if (FLAGS.filter(f => wa.includes(f)).join() !== FLAGS.filter(f => wb.includes(f)).join()) return false;   // giovanili, donne, riserve: mai con la prima squadra
  const A = wa.filter(w => !GENERIC.has(w) && w.length > 1), B = wb.filter(w => !GENERIC.has(w) && w.length > 1);
  if (!A.length || !B.length) return wa.join(' ') === wb.join(' ');
  return A.some(x => B.some(y => x === y || (x.length >= 5 && y.length >= 5 && (x.startsWith(y) || y.startsWith(x)))));
}
const sameMatch = (p, r) => p.commence_time && T(p.commence_time) === T(r.commence_time) && sameTeam(p.home_team, r.home_team) && sameTeam(p.away_team, r.away_team);

// Nome del campionato con il paese davanti ("Israel - Premier League", "Kazakhstan, Premier League"): alcuni bookmaker del feed lo scrivono,
// Pinnacle quasi mai. Se un'altra riga della stessa partita ce l'ha, si usa quello (26 ottobre 2026: su 888sport le partite si trovano per paese).
const CUP = /\b(?:super)?(cup|coppa|copa|pokal|puchar|coupe|kupa|kupasi|beker|ta[cç]a|cupa|trophy|shield)\b/i;
const isCup = l => CUP.test(String(l || ''));
const withCountry = l => /^[A-Za-zÀ-ÿ' .]{3,30}( - |, )/.test(String(l || ''));
/** Per ogni riga con Pinnacle aggiunge i bookmaker che il feed ha messo in un'altra riga della stessa partita (la riga con Pinnacle ha la precedenza). */
function mergeWithPinnacle(records) {
  const main = mainRecords(records);
  const withPin = main.filter(r => (r.bookmakers || []).some(b => b.key === 'pinnacle'));
  return withPin.map(p => {
    const books = [...p.bookmakers], have = new Set(books.map(b => b.key));
    let league = p.league;
    for (const r of main) {
      if (r === p || !sameMatch(p, r)) continue;
      if (!withCountry(league) && withCountry(r.league)) league = r.league;   // es. "Israel - Premier League" invece di "Premier League"
      if ((r.bookmakers || []).some(b => b.key === 'pinnacle')) continue;
      for (const b of r.bookmakers || []) if (!have.has(b.key)) { books.push(b); have.add(b.key); }
    }
    return { ...p, league, bookmakers: books };
  });
}

/** Una quota italiana e' "coerente" se tutti e tre i prezzi stanno entro il 35% di Pinnacle (altrimenti e' un altro mercato o un errore). */
function coherent(q, pin) {
  return ['home', 'draw', 'away'].every(k => Math.abs(q[k] / pin[k] - 1) <= 0.35);
}

/**
 * Cerca i segnali in un elenco di righe del feed. Ritorna una lista di candidati (al massimo uno per partita ed esito).
 * Nessun accesso a rete o database.
 */
function findSignals(records, c, nowMs = Date.now()) {
  const out = [];
  const seen = new Set();
  for (const r of mergeWithPinnacle(records)) {
    const start = T(r.commence_time);
    if (!(start > nowMs + c.minLeadMin * 60000) || start > nowMs + c.windowHours * 3600000) continue;
    if (FLAGS.some(f => words(r.home_team).includes(f) || words(r.away_team).includes(f))) continue;   // giovanili, donne, riserve: quote poco affidabili
    if (FRIENDLY.test(r.league || '')) continue;
    if (LEAGUE_FLAGS.some(f => words(r.league).includes(f))) continue;                                // campionati giovanili, femminili, riserve                                                       // amichevoli: formazioni e motivazioni ignote, quote poco affidabili
    const books = r.bookmakers || [];
    const pinB = books.find(b => b.key === 'pinnacle');
    const pin = pinB && trio(pinB.outcomes);
    if (!pin || !fresh(pinB, nowMs, c.maxStaleMin)) continue;
    const over = 1 / pin.home + 1 / pin.draw + 1 / pin.away;
    if (over < 1 || over > 1.12) continue;                                  // Pinnacle con margine strano: meglio non fidarsi
    const fair = noVigPower(pin);
    const it = {};
    for (const b of books) {
      if (!c.books.includes(b.key) || !fresh(b, nowMs, c.maxStaleMin)) continue;
      const q = trio(b.outcomes);
      if (q && coherent(q, pin)) it[b.key] = { q, suspended: new Set(b.suspended || []) };
    }
    if (!Object.keys(it).length) continue;
    for (const sel of ['home', 'draw', 'away']) {
      const k = `${r.event_id}|${sel}`;
      if (seen.has(k)) continue;
      let best = null;
      for (const [book, v] of Object.entries(it)) {
        if (v.suspended.has(OUT[sel])) continue;
        if (!best || v.q[sel] > best.odd) best = { book, odd: v.q[sel] };
      }
      if (!best) continue;
      const edge = (best.odd * fair[sel] - 1) * 100;
      if (edge < c.minEdge || edge > c.maxEdge || best.odd < c.minOdd || best.odd >= c.maxOdd) continue;
      seen.add(k);
      const nw = it.netwin ? it.netwin.q[sel] : null;
      out.push({
        event_id: r.event_id, league: r.league, home: r.home_team, away: r.away_team, commence_time: r.commence_time,
        selection: sel, book: best.book, odd: best.odd, fair_prob: fair[sel], edge_pct: edge,
        pin: [pin.home, pin.draw, pin.away],
        netwin_odd: nw, netwin_edge_pct: nw ? (nw * fair[sel] - 1) * 100 : null,
        quotes: Object.fromEntries(Object.entries(it).map(([bk, v]) => [bk, [v.q.home, v.q.draw, v.q.away]]))
      });
    }
  }
  return out;
}

/** Pinnacle alla chiusura per una partita (riga principale), oppure null. */
function closingPin(records, eventId) {
  const r = mainRecords(records).find(x => x.event_id === eventId && (x.bookmakers || []).some(b => b.key === 'pinnacle'));
  const b = r && r.bookmakers.find(x => x.key === 'pinnacle');
  return b ? trio(b.outcomes) : null;
}

/** Parte pura (testata): quante richieste odss si possono usare oggi per arrivare alla ricarica. */
function odssPace(remaining, usedToday, resetDay = 12, nowMs = Date.now()) {
  const d = new Date(nowMs);
  let reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), resetDay);
  if (reset <= nowMs) reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, resetDay);
  const daysLeft = Math.max(1, Math.ceil((reset - nowMs) / 86400000));
  const perDay = Math.max(4, Math.floor((remaining + usedToday) / daysLeft));
  return { daysLeft, perDay, usedToday, over: usedToday >= perDay, resetAt: new Date(reset).toISOString() };
}

/**
 * PIANO DELLE RICHIESTE ODSS fino alla ricarica (1° novembre 2026). Parte pura (testata).
 * Le chiusure (che misurano il valore) hanno la precedenza: si tiene da parte quanto serve per loro fino alla ricarica
 * (media degli ultimi 7 giorni, con un margine), non piu' una riserva fissa di 60 che alla ricarica andava sprecata.
 * Con quello che resta si sceglie la scansione piu' frequente che ci sta: ogni 2 ore, 3 ore o 4 ore (dalle 9 alle 22).
 */
function planScans({ remaining, daysLeft, closesPerDay, usedToday = 0, fromHour = 9, toHour = 22, options = [120, 180, 240], maxReserve = 60, margin = 10 }) {
  const days = Math.max(1, daysLeft), closes = Math.max(4, Math.ceil(closesPerDay * 1.2));   // +20% per le giornate piene
  const reserve = Math.min(maxReserve, closes * days + margin);
  const scansPerDay = m => Math.floor((toHour - fromHour) * 60 / m) + 1;
  const need = m => (scansPerDay(m) + closes) * days + margin;
  const pick = options.find(m => need(m) <= remaining) || options[options.length - 1];
  return { reserve, everyMin: pick, scansPerDay: scansPerDay(pick), closesPerDay: closes, perDay: scansPerDay(pick) + closes,
    leftAtReset: Math.max(0, remaining - (scansPerDay(pick) + closes) * days) };
}

/** Quote di tutti i siti (tranne Pinnacle) per una partita alla chiusura: { sito: [1, X, 2] }, oppure null. */
function closingQuotes(records, eventId) {
  const r = mergeWithPinnacle(mainRecords(records)).find(x => x.event_id === eventId);
  if (!r) return null;
  const out = {};
  for (const b of r.bookmakers || []) { if (b.key === 'pinnacle') continue; const q = trio(b.outcomes); if (q) out[b.key] = [q.home, q.draw, q.away]; }
  return Object.keys(out).length ? out : null;
}

/** Scrive sull'ultima richiesta di quel tipo cosa ha prodotto (solo registro: non blocca mai). */
async function noteRequest(pool, kind, info) {
  try { await pool.query(`UPDATE italia_requests SET info = $2 WHERE id = (SELECT MAX(id) FROM italia_requests WHERE kind = $1)`, [kind, JSON.stringify(info)]); } catch (e) { /* solo registro */ }
}

/** Ora italiana (0-23) per decidere se e' il momento di scansionare. */
function romeHour(nowMs) {
  return Number(ROME_HOUR.format(new Date(nowMs))) % 24;
}

/** Quota minima da accettare sul sito: sotto questa il vantaggio sul prezzo giusto di Pinnacle scende sotto la soglia. */
function minOdd(fairProb, minEdgePct) { return Math.ceil((1 + minEdgePct / 100) / fairProb * 100) / 100; }

function signalText(s, minEdgePct = 2) {
  const when = ROME_WHEN.format(new Date(s.commence_time));
  const n = (v, d = 2) => Number(v).toFixed(d).replace('.', ',');
  const pick = s.selection === 'home' ? `1 (${s.home})` : s.selection === 'away' ? `2 (${s.away})` : 'X (pareggio)';
  const nw = s.netwin_odd && s.book !== 'netwin' ? `\nNetwin: ${n(s.netwin_odd)} (${s.netwin_edge_pct >= 0 ? '+' : ''}${n(s.netwin_edge_pct, 1)}%)` : '';
  return `🇮🇹 <b>${s.home} – ${s.away}</b>\n${s.league}, ${when}\nPunta <b>${pick}</b> a <b>${n(s.odd)}</b> su ${BOOK_NAMES[s.book] || s.book} (+${n(s.edge_pct, 1)}% su Pinnacle)\nGioca solo se la quota è almeno <b>${n(minOdd(s.fair_prob, minEdgePct))}</b>${nw}`;
}

// ------------------------------------------------------------------------------------------- database e rete

let ready = false;
async function ensureTables(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS italia_signals (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_id TEXT NOT NULL, league TEXT, home TEXT, away TEXT, commence_time TIMESTAMPTZ,
    selection TEXT NOT NULL, book TEXT, odd NUMERIC(8,3), fair_prob NUMERIC(8,5), edge_pct NUMERIC(8,3),
    pin_h NUMERIC(8,3), pin_d NUMERIC(8,3), pin_a NUMERIC(8,3),
    netwin_odd NUMERIC(8,3), netwin_edge_pct NUMERIC(8,3), quotes JSONB,
    close_pin_h NUMERIC(8,3), close_pin_d NUMERIC(8,3), close_pin_a NUMERIC(8,3), closing_fair_prob NUMERIC(8,5),
    clv_pct NUMERIC(8,3), netwin_clv_pct NUMERIC(8,3), close_lag_min INT, close_captured_at TIMESTAMPTZ,
    strategy TEXT NOT NULL DEFAULT 'I')`);
  // tabelle create prima della strategia B: colonna nuova e unicita' per (partita, esito, strategia)
  await pool.query(`ALTER TABLE italia_signals ADD COLUMN IF NOT EXISTS strategy TEXT NOT NULL DEFAULT 'I'`);
  await pool.query(`ALTER TABLE italia_signals DROP CONSTRAINT IF EXISTS italia_signals_event_id_selection_key`);
  // fase del segnale: 'far' = uscito oltre 3 ore dal calcio d'inizio, 'near' = entro 3 ore. Per ogni partita ed esito
  // ci possono essere al massimo due righe: la prima uscita e la rilettura vicino al calcio d'inizio (serve alla F2).
  await pool.query(`ALTER TABLE italia_signals ADD COLUMN IF NOT EXISTS phase TEXT`);
  await pool.query(`UPDATE italia_signals SET phase = CASE WHEN commence_time - created_at <= INTERVAL '${NEAR_HOURS} hours' THEN 'near' ELSE 'far' END WHERE phase IS NULL`);
  await pool.query(`DROP INDEX IF EXISTS italia_signals_uniq`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS italia_signals_uniq2 ON italia_signals (event_id, selection, strategy, phase)`);
  // tentativo di chiusura gia' fatto (anche se Pinnacle mancava): la stessa partita non si richiede di nuovo ogni 10 minuti
  await pool.query(`ALTER TABLE italia_signals ADD COLUMN IF NOT EXISTS close_tried_at TIMESTAMPTZ`);
  // 31 ottobre 2026: categoria del segnale fissata al momento in cui esce (✅, 🛡️, solidita', coppa...) e regole attive,
  // cosi' le analisi non dipendono dalle regole cambiate dopo. Si scrive una volta sola e poi non si tocca piu'.
  await pool.query(`ALTER TABLE italia_signals ADD COLUMN IF NOT EXISTS flags JSONB`);
  // 1° novembre 2026: quote dei siti italiani alla chiusura (stessa richiesta di Pinnacle, nessun costo in piu')
  await pool.query(`ALTER TABLE italia_signals ADD COLUMN IF NOT EXISTS close_quotes JSONB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS italia_requests (
    id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW(), kind TEXT, ok BOOLEAN, records INT, quota_remaining INT, note TEXT)`);
  // 1° novembre 2026: cosa ha fatto ogni richiesta (partite viste, segnali trovati, chiusure prese)
  await pool.query(`ALTER TABLE italia_requests ADD COLUMN IF NOT EXISTS info JSONB`);
  ready = true;
}

async function usedThisMonth(pool) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM italia_requests WHERE at >= date_trunc('month', NOW())`);
  return rows[0].n;
}

/** Richieste rimaste sull'account odss secondo l'ultima risposta (la quota e' condivisa con le altre chiavi dello stesso account). */
async function lastRemaining(pool) {
  const { rows } = await pool.query(`SELECT quota_remaining FROM italia_requests WHERE quota_remaining IS NOT NULL ORDER BY id DESC LIMIT 1`);
  return rows.length ? Number(rows[0].quota_remaining) : null;
}

async function fetchOdds(pool, c, params, kind, http = axios) {
  let ok = false, records = 0, remaining = null, note = null, data = null;
  try {
    const res = await http.get(`${BASE}/odds`, { params: { sport: 'calcio', market: '1x2', limit: 5000, ...params }, headers: { 'x-api-key': c.key }, timeout: 45000 });
    data = res.data || {};
    records = (data.odds || []).length;
    const h = res.headers || {};
    remaining = h['x-quota-remaining'] !== undefined ? Number(h['x-quota-remaining']) : null;
    ok = true;
    return data.odds || [];
  } catch (err) {
    note = (err.response && err.response.data && (err.response.data.error || err.response.data.code)) || err.message;
    throw err;
  } finally {
    try { await pool.query(`INSERT INTO italia_requests (kind, ok, records, quota_remaining, note) VALUES ($1,$2,$3,$4,$5)`, [kind, ok, records, Number.isFinite(remaining) ? remaining : null, note ? String(note).slice(0, 300) : null]); } catch (e) { /* solo registro */ }
  }
}

/** Il piano di oggi, dai numeri del registro (chiusure medie degli ultimi 7 giorni). */
async function planOf(pool, c, rem, nowMs = Date.now()) {
  const { rows } = await pool.query(`SELECT COUNT(*) FILTER (WHERE kind = 'close' AND at >= NOW() - INTERVAL '7 days')::int AS closes,
    COUNT(*) FILTER (WHERE at >= date_trunc('day', NOW()))::int AS today FROM italia_requests`);
  const pace = odssPace(rem, rows[0].today, c.resetDay, nowMs);
  return { ...planScans({ remaining: rem, daysLeft: pace.daysLeft, closesPerDay: rows[0].closes / 7, fromHour: c.fromHour, toHour: c.toHour, maxReserve: c.closeReserve }), daysLeft: pace.daysLeft, resetAt: pace.resetAt };
}

async function scan(pool, c, { nowMs = Date.now(), http, notify } = {}) {
  const h = romeHour(nowMs);
  if (h < c.fromHour || h >= c.toHour) return { scan: 'fuori orario' };
  const { rows } = await pool.query(`SELECT MAX(at) FILTER (WHERE ok) AS last_ok, MAX(at) FILTER (WHERE NOT ok) AS last_ko FROM italia_requests WHERE kind = 'scan'`);
  const lastOk = rows[0].last_ok ? T(rows[0].last_ok) : 0, lastKo = rows[0].last_ko ? T(rows[0].last_ko) : 0;
  const rem = await lastRemaining(pool);
  const plan = rem !== null ? await planOf(pool, c, rem, nowMs) : null;
  const every = plan ? Math.min(plan.everyMin, Math.max(c.scanEveryMin, 240)) : c.scanEveryMin;
  if (nowMs - lastOk < every * 60000 - 5 * 60000) return { scan: 'non ancora' };   // 5 minuti di tolleranza: il giro passa ogni 10
  if (lastKo > lastOk && nowMs - lastKo < 30 * 60000) return { scan: 'in pausa dopo un errore' };    // chiave sbagliata o servizio giu': non insistere ogni 10 minuti
  if (await usedThisMonth(pool) >= c.monthlyCap - c.closeReserve) return { scan: 'tetto mensile' };
  if (rem !== null && rem <= (plan ? plan.reserve : c.closeReserve)) return { scan: 'quota odss quasi finita: restano solo le chiusure' };
  // 1° novembre 2026: richieste distribuite fino alla ricarica. Budget di oggi = rimaste / giorni alla ricarica;
  // se oggi e' gia' stato speso, niente scansione (le chiusure, che misurano il valore, continuano).
  if (rem !== null) {
    const p = odssPace(rem, (await pool.query(`SELECT COUNT(*)::int AS n FROM italia_requests WHERE at >= date_trunc('day', NOW())`)).rows[0].n, c.resetDay, nowMs);
    if (p.over) return { scan: `budget di oggi finito (${p.usedToday} su ${p.perDay})` };
  }
  const records = await fetchOdds(pool, c, {
    bookmakers: [...new Set(['pinnacle', ...c.books, ...(c.bEnabled ? c.bBooks : []), ...(c.tEnabled ? c.tBooks : [])])].join(','),
    commence_from: new Date(nowMs + c.minLeadMin * 60000).toISOString(),
    commence_to: new Date(nowMs + c.windowHours * 3600000).toISOString()
  }, 'scan', http);
  if (!pinBoardDropped) { pinBoardDropped = true; try { await pool.query('DROP TABLE IF EXISTS pin_board'); } catch (e) { /* facoltativo */ } }   // quote maggiorate tolte il 1° novembre
  // ⚽ gol: prezzo 1X2 di Pinnacle di tutte le partite viste (gratis) e, se accese, le quote Over/Under (una richiesta in piu')
  let golOut = {};
  try { const merged = mergeWithPinnacle(records), G = require('./goals'); golOut.partiteGol = await G.watch(pool, merged, trio, nowMs);
    try { Object.assign(golOut, await G.scanTotals(pool, c, { nowMs, http, merged, trio })); } catch (e) { golOut.erroreGol = e.message; }
    try { Object.assign(golOut, await G.valangaOdds(pool, c, { nowMs, http })); } catch (e) { golOut.erroreThor = e.message; } } catch (e) { /* facoltativo */ }
  const found = findSignals(records, c, nowMs);
  const foundB = c.bEnabled ? findSignals(records, cfgFor(c, 'B'), nowMs) : [];
  const foundT = c.tEnabled ? findSignals(records, cfgFor(c, 'T'), nowMs) : [];
  const fresh = [];
  let nuoviB = 0;
  for (const [strategy, list] of [['I', found], ['B', foundB], ['T', foundT]]) {
    for (const s of list) {
      const r = await pool.query(
        `INSERT INTO italia_signals (event_id, league, home, away, commence_time, selection, book, odd, fair_prob, edge_pct, pin_h, pin_d, pin_a, netwin_odd, netwin_edge_pct, quotes, strategy, phase)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (event_id, selection, strategy, phase) DO NOTHING RETURNING id`,
        [s.event_id, s.league, s.home, s.away, s.commence_time, s.selection, s.book, s.odd, s.fair_prob, s.edge_pct, s.pin[0], s.pin[1], s.pin[2], s.netwin_odd, s.netwin_edge_pct, JSON.stringify(s.quotes), strategy,
         (T(s.commence_time) - nowMs) / 3600000 <= NEAR_HOURS ? 'near' : 'far']);
      if (r.rowCount) {
        // una rilettura di un segnale gia' avvisato non manda un secondo messaggio
        const again = (await pool.query(`SELECT COUNT(*)::int AS n FROM italia_signals WHERE event_id = $1 AND selection = $2 AND strategy = $3`, [s.event_id, s.selection, strategy])).rows[0].n > 1;
        if (strategy === 'I') { if (!again) fresh.push(s); } else if (strategy === 'B' && !again) nuoviB++;
      }
    }
  }
  if (fresh.length && notify) {
    try { await notify(`<b>Quote italiane – prova senza soldi</b>\n\n${fresh.map(x => signalText(x, c.minEdge)).join('\n\n')}\n\n<i>La quota cambia in fretta: controlla sul sito prima di giocare.</i>`); } catch (e) { /* avviso facoltativo */ }
  }
  const partite = new Set(mainRecords(records).map(r => r.event_id)).size;
  await noteRequest(pool, 'scan', { righe: records.length, partite, candidatiI: found.length, nuoviI: fresh.length, candidatiB: foundB.length, nuoviB, candidatiT: foundT.length });
  return { scan: 'fatta', righe: records.length, partite, candidati: found.length, nuovi: fresh.length, nuoviB, candidatiT: foundT.length, ...golOut };
}

async function captureClosing(pool, c, { nowMs = Date.now(), http } = {}) {
  const { rows } = await pool.query(
    `SELECT id, event_id, selection, odd, netwin_odd, commence_time, close_lag_min, COALESCE(strategy, 'I') AS strategy FROM italia_signals
     WHERE commence_time > to_timestamp($1::double precision / 1000) AND commence_time <= to_timestamp($1::double precision / 1000) + make_interval(mins => $2::int)
       AND close_captured_at IS NULL AND close_tried_at IS NULL AND COALESCE(edge_pct, 0) >= $3`,
    [nowMs, c.closeWindowMin, c.closeMinEdge]);
  // 1° novembre 2026: anche i segnali T (tutti i siti italiani) prendono la chiusura, per giudicare i bookmaker sul valore.
  // Non fanno mai partire una richiesta da soli: si aggiungono a quella dei segnali I e B (una richiesta = stesso costo).
  if (!rows.some(r => r.strategy !== 'T')) return { chiusure: 0 };
  // si aspetta che almeno una partita sia vicina: cosi' una sola richiesta copre il gruppo e la chiusura e' piu' fedele
  if (!rows.some(r => r.strategy !== 'T' && T(r.commence_time) - nowMs <= c.closeTriggerMin * 60000)) return { chiusure: 0, nota: 'non ancora' };
  if (await usedThisMonth(pool) >= c.monthlyCap) return { chiusure: 0, nota: 'tetto mensile' };
  const rem = await lastRemaining(pool);
  if (rem !== null && rem <= 3) return { chiusure: 0, nota: 'quota odss finita' };
  const ids = [...new Set(rows.map(r => r.event_id))];
  // stessa richiesta: Pinnacle per la chiusura + i siti italiani, per sapere se la quota era ancora prendibile al calcio d'inizio
  const records = await fetchOdds(pool, c, { event_id: ids.join(','), bookmakers: [...new Set(['pinnacle', ...c.books, ...c.myBooks, ...(c.tEnabled ? c.tBooks : [])])].join(',') }, 'close', http);
  // 25 ottobre 2026: un solo tentativo per segnale. Prima, se Pinnacle mancava, la stessa partita si richiedeva a ogni giro
  // (ogni 10 minuti) fino al calcio d'inizio: 44 richieste su 154 non avevano catturato niente.
  await pool.query(`UPDATE italia_signals SET close_tried_at = NOW() WHERE id = ANY($1::int[])`, [rows.map(r => Number(r.id))]);
  let n = 0;
  for (const s of rows) {
    const pin = closingPin(records, s.event_id);
    if (!pin) continue;
    const fair = noVigPower(pin)[s.selection];
    const lag = Math.max(0, Math.round((T(s.commence_time) - nowMs) / 60000));
    await pool.query(
      `UPDATE italia_signals SET close_pin_h=$2, close_pin_d=$3, close_pin_a=$4, closing_fair_prob=$5, clv_pct=$6, netwin_clv_pct=$7, close_lag_min=$8, close_captured_at=NOW(), close_quotes=$9 WHERE id=$1`,
      [s.id, pin.home, pin.draw, pin.away, fair, (Number(s.odd) * fair - 1) * 100, s.netwin_odd ? (Number(s.netwin_odd) * fair - 1) * 100 : null, lag, (() => { const q = closingQuotes(records, s.event_id); return q ? JSON.stringify(q) : null; })()]);
    n++;
  }
  await noteRequest(pool, 'close', { partite: ids.length, segnali: rows.length, chiusure: n, conQuoteItaliane: rows.filter(s => closingQuotes(records, s.event_id)).length });
  return { chiusure: n };
}

/** Un passo: prima le chiusure (hanno la precedenza sul tetto), poi l'eventuale scansione. Non lancia mai. */
async function tick(pool, { env = process.env, nowMs = Date.now(), http, notify, resultsHttp } = {}) {
  const c = cfg(env);
  if (!c.key) return { attiva: false, motivo: 'ODSS_API_KEY non impostata' };
  const out = { attiva: true };
  try { await ensureTables(pool); } catch (e) { return { attiva: true, errore: e.message }; }
  try { Object.assign(out, await captureClosing(pool, c, { nowMs, http })); } catch (e) { out.erroreChiusura = e.message; }
  try { Object.assign(out, await scan(pool, c, { nowMs, http, notify })); } catch (e) { out.erroreScansione = e.message; }
  try { out.timbrati = await stampFlags(pool, c, nowMs); } catch (e) { out.erroreTimbro = e.message; }
  try { Object.assign(out, await require('./results').settleSignals(pool, { env, nowMs, http: resultsHttp, sameTeam })); } catch (e) { out.erroreRisultati = e.message; }
  try { Object.assign(out, await require('./highlightly').settleFromHighlightly(pool, { env, nowMs })); } catch (e) { out.erroreHighlightly = e.message; }
  try { await require('./goals').settleGoals(pool); } catch (e) { out.erroreGol = e.message; }
  // ⚽ Over/Under di Pinnacle con i crediti di The Odds API: in sottofondo (legge tanti elenchi gratuiti, non deve rallentare il giro)
  if (!ouBusy) { ouBusy = true; require('./ouPinnacle').tick(pool, { env, nowMs }).catch(() => {}).finally(() => { ouBusy = false; }); }
  try { Object.assign(out, await require('./backup').saveDaily(pool, { nowMs })); } catch (e) { out.erroreCopia = e.message; }
  return out;
}

// ------------------------------------------------------------------------------------------- selezione F (finale candidata)
/**
 * Condizioni fissate il 17 ottobre 2026, PRIMA di vedere i risultati successivi: valgono solo i segnali I creati da quel momento
 * (prova fuori campione, nessun ritocco a posteriori).
 *  1. bookmaker italiano (strategia I)          2. entro 6 ore dal calcio d'inizio (gia' garantito dalla scansione)
 *  3. vantaggio dal 2% al 6%                     4. quota tra 1,60 e 3,50
 *  5. niente amichevoli/giovanili/riserve (gia' escluse alla fonte)
 *  6. bookmaker escluso se, PRIMA del segnale, aveva almeno 15 segnali misurati con valore medio negativo
 */
// ------------------------------------------------------------------------------------------- prima uscita e rilettura
const NEAR_HOURS = 3;
const phaseOf = r => r.phase || ((T(r.commence_time) - T(r.created_at)) / 3600000 <= NEAR_HOURS ? 'near' : 'far');
const sigKey = r => `${r.event_id}|${r.selection}|${r.strategy || 'I'}`;
/** Righe "prima uscita": tutte tranne le riletture vicino al calcio d'inizio di un segnale gia' uscito prima (le misure di I, B, F e F3 restano quelle di sempre). */
function primaryRows(rows) {
  const far = new Set(rows.filter(r => phaseOf(r) === 'far').map(sigKey));
  return rows.filter(r => !(phaseOf(r) === 'near' && far.has(sigKey(r))));
}
/** Per l'app: una scheda per partita ed esito, la piu' recente (la rilettura, se c'e'). */
function latestRows(rows) {
  const near = new Set(rows.filter(r => phaseOf(r) === 'near').map(sigKey));
  return rows.filter(r => !(phaseOf(r) === 'far' && near.has(sigKey(r))));
}

// "6 su 10": dentro la F, i segnali con l'esito piu' probabile (Pinnacle lo da' almeno al 55%). Non cambia la F: e' un sottoinsieme.
const SIX_MIN_PROB = 0.55;
const isSix = r => Number(r.fair_prob) >= SIX_MIN_PROB;

const FINAL = { since: '2026-10-17T08:00:00Z', minEdge: 2, maxEdge: 6, minOdd: 1.6, maxOdd: 3.5, bookMinN: 15 };

/** Guadagno atteso sulla carta: puntata fissa per il valore contro la chiusura di ogni segnale misurato (non dipende dalla fortuna dei risultati). */
const STAKE = 2;
function expectedEur(rows, stake = STAKE) {
  return rows.filter(r => r.clv_pct !== null && r.clv_pct !== undefined && r.clv_pct !== '').reduce((a, r) => a + stake * Number(r.clv_pct) / 100, 0);
}

/** Segna con final=true le righe I che rispettano le condizioni F; il controllo sul bookmaker usa solo le chiusure gia' note al momento del segnale. */
function markFinal(rows) {
  const since = T(FINAL.since);
  const sorted = [...rows].sort((a, b) => T(a.created_at) - T(b.created_at));
  const out = new Map();
  // chiusure gia' note per bookmaker, in ordine di tempo, con le somme progressive: una ricerca invece di rileggere tutte le righe
  const byBook = new Map();
  for (const x of rows) if (x.clv_pct !== null && x.clv_pct !== undefined && x.close_captured_at) { const l = byBook.get(x.book) || []; l.push([T(x.close_captured_at), Number(x.clv_pct)]); byBook.set(x.book, l); }
  for (const [b, l] of byBook) { l.sort((a, c) => a[0] - c[0]); let acc = 0; byBook.set(b, { ts: l.map(v => v[0]), cum: l.map(v => (acc += v[1])) }); }
  const pastClv = (book, t) => { const g = byBook.get(book); if (!g) return { n: 0, sum: 0 }; let lo = 0, hi = g.ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (g.ts[m] < t) lo = m + 1; else hi = m; } return { n: lo, sum: lo ? g.cum[lo - 1] : 0 }; };
  for (const r of sorted) {
    const t = T(r.created_at), edge = Number(r.edge_pct), odd = Number(r.odd);
    const reasons = [];
    if (t < since) reasons.push('prima delle regole');
    if (!(edge >= FINAL.minEdge && edge <= FINAL.maxEdge)) reasons.push('vantaggio fuori 2–6%');
    if (!(odd >= FINAL.minOdd && odd <= FINAL.maxOdd)) reasons.push('quota fuori 1,60–3,50');
    const past = pastClv(r.book, t);
    if (past.n >= FINAL.bookMinN && past.sum / past.n < 0) reasons.push('bookmaker con valore negativo');
    out.set(r.id, { final: reasons.length === 0, reasons });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- selezione F2 (seconda candidata)
/**
 * Condizioni fissate il 18 ottobre 2026 alle 9:30 (ora italiana), PRIMA di vedere i segnali successivi.
 * Usa solo le due cose che si sono ripetute in piu' backup: vicinanza al calcio d'inizio e vantaggio medio-alto.
 *  1. bookmaker italiano (strategia I)      2. segnale uscito entro 3 ore dal calcio d'inizio
 *  3. vantaggio dal 4% all'8%               4. quota tra 1,60 e 3,50
 *  5. niente amichevoli/giovanili/riserve (gia' escluse alla fonte)
 */
const FINAL2 = { since: '2026-10-18T07:30:00Z', minEdge: 4, maxEdge: 8, minOdd: 1.6, maxOdd: 3.5, maxLeadHours: 3 };

function markFinal2(rows) {
  const since = T(FINAL2.since), out = new Map();
  for (const r of rows) {
    const t = T(r.created_at), edge = Number(r.edge_pct), odd = Number(r.odd);
    const lead = (T(r.commence_time) - t) / 3600000;
    const reasons = [];
    if (t < since) reasons.push('prima delle regole');
    if (!(lead <= FINAL2.maxLeadHours)) reasons.push('oltre 3 ore dal calcio d\'inizio');
    if (!(edge >= FINAL2.minEdge && edge <= FINAL2.maxEdge)) reasons.push('vantaggio fuori 4–8%');
    if (!(odd >= FINAL2.minOdd && odd <= FINAL2.maxOdd)) reasons.push('quota fuori 1,60–3,50');
    out.set(r.id, { final: reasons.length === 0, reasons });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- selezione F3 (favoriti con valore)
/**
 * Condizioni fissate il 18 ottobre 2026 alle 20:45 (ora italiana), PRIMA di vedere i segnali successivi.
 * Obiettivo: vincere piu' spesso (6-7 partite su 10) senza rinunciare al valore.
 *  1. bookmaker italiano (strategia I)      2. quota tra 1,30 e 1,60
 *  3. vantaggio dal 2% all'8%               4. niente amichevoli/giovanili/riserve (gia' escluse alla fonte)
 */
const FINAL3 = { since: '2026-10-18T18:45:00Z', minEdge: 2, maxEdge: 8, minOdd: 1.3, maxOdd: 1.6 };

function markFinal3(rows) {
  const since = T(FINAL3.since), out = new Map();
  for (const r of rows) {
    const t = T(r.created_at), edge = Number(r.edge_pct), odd = Number(r.odd);
    const reasons = [];
    if (t < since) reasons.push('prima delle regole');
    if (!(edge >= FINAL3.minEdge && edge <= FINAL3.maxEdge)) reasons.push('vantaggio fuori 2–8%');
    if (!(odd >= FINAL3.minOdd && odd < FINAL3.maxOdd)) reasons.push('quota fuori 1,30–1,60');
    out.set(r.id, { final: reasons.length === 0, reasons });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- selezione F2+ (la principale per i soldi veri)
/**
 * Condizioni fissate il 24 ottobre 2026 alle 20:00 (ora italiana), dopo la prova di circa 1.200 combinazioni di regole:
 * l'unica che reggeva in entrambe le meta' del periodo E sui bookmaker esteri (dati indipendenti).
 *  1. bookmaker italiano (strategia I)      2. segnale letto entro 3 ore dal calcio d'inizio (una sola lettura per partita)
 *  3. vantaggio dal 4% in su (nessun tetto)  4. quota da 1,30 (gia' garantito dalla scansione)
 * Si misura da quel momento; il dato "all'indietro" resta solo come riferimento (le regole sono state scelte su quei dati).
 */
const FINAL4 = { since: '2026-10-24T18:00:00Z', minEdge: 4, minOdd: 1.3, maxLeadHours: 3 };

function markFinal4(rows, { ignoreSince = false } = {}) {
  const since = T(FINAL4.since), out = new Map();
  for (const r of rows) {
    const t = T(r.created_at), edge = Number(r.edge_pct), odd = Number(r.odd);
    const lead = (T(r.commence_time) - t) / 3600000;
    const reasons = [];
    if (!ignoreSince && t < since) reasons.push('prima delle regole');
    if (!(lead <= FINAL4.maxLeadHours)) reasons.push('oltre 3 ore dal calcio d\'inizio');
    if (!(edge >= FINAL4.minEdge)) reasons.push('vantaggio sotto il 4%');
    if (!(odd >= FINAL4.minOdd)) reasons.push('quota sotto 1,30');
    out.set(r.id, { final: reasons.length === 0, reasons });
  }
  // una sola giocata per partita ed esito: se piu' letture rispettano le regole, conta quella piu' vicina al calcio d'inizio
  const best = new Map();
  for (const r of rows) {
    if (!out.get(r.id).final) continue;
    const k = sigKey(r), cur = best.get(k);
    if (!cur || T(r.created_at) > T(cur.created_at)) best.set(k, r);
  }
  for (const r of rows) if (out.get(r.id).final && best.get(sigKey(r)) !== r) out.set(r.id, { final: false, reasons: ['letta di nuovo piu\' vicino alla partita'] });
  return out;
}

// ------------------------------------------------------------------------------------------- selezione F2+ sicure (soldi veri)
/**
 * Condizioni fissate il 24 ottobre 2026 alle 22:45 (ora italiana), PRIMA di vedere i segnali successivi.
 * Sono le F2+ con probabilita' Pinnacle di vincita almeno al 50% (in pratica quota fino a circa 2): sui 182 segnali I
 * il valore contro la chiusura era uguale in tutte le fasce di probabilita' (circa +2,7%), quindi scegliere le piu' probabili
 * non toglie valore ma riduce le oscillazioni (serie di sconfitte piu' corte, stop dei 75 euro meno raggiungibile per sfortuna).
 *  1. tutte le regole F2+      2. probabilita' Pinnacle di vincita almeno 50%
 */
const FINAL5 = { since: '2026-10-24T20:45:00Z', minProb: 0.5 };

function markFinal5(rows, { ignoreSince = false } = {}) {
  const f4 = markFinal4(rows, { ignoreSince: true }), since = T(FINAL5.since), out = new Map();
  for (const r of rows) {
    const reasons = [...((f4.get(r.id) || {}).reasons || [])];
    if (!ignoreSince && T(r.created_at) < since) reasons.push('prima delle regole');
    if (!(Number(r.fair_prob) >= FINAL5.minProb)) reasons.push('probabilita\' di vincita sotto il 50%');
    out.set(r.id, { final: reasons.length === 0, reasons });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- selezione F2+ consigliate (soldi veri)
/**
 * Condizioni fissate il 25 ottobre 2026 alle 15:30 (ora italiana), dopo i primi 221 risultati veri (scritti a mano).
 * I risultati hanno mostrato un solo gruppo dove le probabilita' di Pinnacle sbagliano: i FAVORITI (probabilita' dal 50%)
 * nei MERCATI SOTTILI (margine di Pinnacle dal 6% in su, tipico dei campionati minori): 22 vinte su 30 attese, saldo -22%,
 * mentre tutto il resto era in linea (61 vinte su 52 attese). Il CLV non lo vede perche' si misura contro lo stesso Pinnacle.
 * Le 🛡️ sicure cadevano TUTTE in quel gruppo. Quindi: tutte le regole F2+, tranne i favoriti nei mercati sottili.
 */
const FINAL6 = { since: '2026-10-25T14:30:00Z', favProb: 0.5, thinMarginPct: 6 };
const pinMarginPct = r => { const o = [r.pin_h, r.pin_d, r.pin_a].map(Number); return o.every(v => v > 1) ? (o.reduce((a, v) => a + 1 / v, 0) - 1) * 100 : null; };
const thinFav = r => Number(r.fair_prob) >= FINAL6.favProb && (pinMarginPct(r) ?? 99) >= FINAL6.thinMarginPct;

/**
 * SOLIDITA' del segnale (25 ottobre 2026, in prova sulla carta): quante di queste tre condizioni rispetta.
 *  1. letto a meno di 1 ora dal calcio d'inizio   2. mercato liquido (margine Pinnacle sotto il 6%)
 *  3. almeno 2 book italiani sopra il prezzo giusto (+2%)
 * Sui 161 segnali I senza favoriti sottili: con 2 condizioni su 3 CLV +5,3% (±1,0), con 0-1 condizioni +1,9%.
 * Serve alla puntata ADATTIVA del bankroll di allenamento: 3% invece del 2% quando il segnale e' solido.
 */
const SEL_IDX = { home: 0, draw: 1, away: 2 };
function solidity(r) {
  const leadH = (T(r.commence_time) - T(r.created_at)) / 3600000, m = pinMarginPct(r);
  let q = r.quotes; try { if (typeof q === 'string') q = JSON.parse(q); } catch (e) { q = null; }
  const fair = Number(r.fair_prob), i = SEL_IDX[r.selection];
  const books = q && fair > 0 ? Object.values(q).filter(v => Array.isArray(v) && Number(v[i]) * fair - 1 >= 0.02).length : 0;
  const near = leadH < 1, liquid = m !== null && m < FINAL6.thinMarginPct, agree = books >= 2;
  return { score: near + liquid + agree, near, liquid, agree, books };
}

function markFinal6(rows, { ignoreSince = false } = {}) {
  const f4 = markFinal4(rows, { ignoreSince: true }), since = T(FINAL6.since), out = new Map();
  for (const r of rows) {
    const reasons = [...((f4.get(r.id) || {}).reasons || [])];
    if (!ignoreSince && T(r.created_at) < since) reasons.push('prima delle regole');
    if (thinFav(r)) reasons.push('favorito in un mercato sottile');
    out.set(r.id, { final: reasons.length === 0, reasons });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- due prove sulla carta (1° novembre 2026)
/**
 * Regole fissate il 1° novembre 2026 alle 14:30 (ora italiana), PRIMA di vedere i segnali successivi. Solo misura: non si giocano.
 * 🔒 7 SU 10: le ⭐ F2+ molto probabili (Pinnacle dal 65%, quota circa 1,30–1,55), niente coppe. Misura se il difetto dei favoriti
 *    nei mercati sottili vale anche quando sono molto favoriti (all'indietro: 7 vinte su 9, 6,3 attese, CLV +4,4%).
 * 💧 LIQUIDI: le ⭐ F2+ nei mercati piu' liquidi (margine Pinnacle sotto l'8%: il quarto piu' liquido delle nostre, la mediana e' 10%),
 *    quota fino a 3,50, niente coppe: dove Pinnacle sbaglia meno (all'indietro: 16 segnali, CLV +7,8%).
 */
const FINAL8 = { since: '2026-11-01T13:30:00Z', minProb: 0.65 };
const FINAL9 = { since: '2026-11-01T13:30:00Z', maxMarginPct: 8, maxOdd: 3.5 };
const liquidOf = (r, max) => { const m = pinMarginPct(r); return m !== null && m < max; };
function markPaper(rows, extra, since, { ignoreSince = false } = {}) {
  const f4 = markFinal4(rows, { ignoreSince: true }), t0 = T(since), out = new Map();
  for (const r of rows) {
    const reasons = [...((f4.get(r.id) || {}).reasons || [])];
    if (!ignoreSince && T(r.created_at) < t0) reasons.push('prima delle regole');
    if (isCup(r.league)) reasons.push('coppa');
    reasons.push(...extra(r));
    out.set(r.id, { final: reasons.length === 0, reasons });
  }
  return out;
}
const markFinal8 = (rows, o) => markPaper(rows, r => [
  ...(Number(r.fair_prob) >= FINAL8.minProb ? [] : ['probabilita\' di vincita sotto il 65%'])], FINAL8.since, o);
const markFinal9 = (rows, o) => markPaper(rows, r => [
  ...(liquidOf(r, FINAL9.maxMarginPct) ? [] : ['mercato sottile']),
  ...(Number(r.odd) <= FINAL9.maxOdd ? [] : ['quota sopra 3,50'])], FINAL9.since, o);

// ------------------------------------------------------------------------------------------- 🧮 punteggio delle ⭐ (4 novembre 2026)
/**
 * Formula trovata il 4 novembre 2026 sui 300 segnali I con chiusura (backup delle 3): stima il valore contro la chiusura
 * dalle caratteristiche note PRIMA della partita. Provata sulla meta' mai vista: terzo migliore +5,5% e +6,78 euro,
 * terzo peggiore +1,6% e -18,06 euro. Voto 0-100 (50 = valore atteso circa +3,5%). Ordina la lista, non scarta niente.
 */
const SCORE = { base: -2.56, liquid: 2.85, edge: 0.89, above: -0.09, iso: -13.91, lead: -0.34, draw: 11.57, away: 0.32, isDraw: -0.66, cup: -3.02, highOdd: -2.65 };
function scoreOf(r, cons = null, nowMs = Date.now()) {
  const pin = [r.pin_h, r.pin_d, r.pin_a].map(Number);
  if (!pin.every(v => v > 1)) return null;
  const inv = pin.map(v => 1 / v), s = inv.reduce((a, b) => a + b, 0), m = (s - 1) * 100;
  const lead = (T(r.commence_time) - T(r.created_at)) / 3600000;
  const pred = SCORE.base + SCORE.liquid * (m < 6 ? 1 : 0) + SCORE.edge * Math.min(Number(r.edge_pct) || 0, 15)
    + SCORE.above * Math.min(cons ? cons.above : 0, 10) + SCORE.iso * (cons && cons.ratio ? cons.ratio - 1 : 0) + SCORE.lead * lead
    + SCORE.draw * (inv[1] / s) + SCORE.away * (r.selection === 'away' ? 1 : 0) + SCORE.isDraw * (r.selection === 'draw' ? 1 : 0)
    + SCORE.cup * (isCup(r.league) ? 1 : 0) + SCORE.highOdd * (Number(r.odd) > 3.5 ? 1 : 0);
  return { pred, vote: Math.max(0, Math.min(100, Math.round(50 + 8 * (pred - 3.5)))) };
}

// ------------------------------------------------------------------------------------------- 💧 liquide tra le ⭐ (2 novembre 2026)
/**
 * Regola fissata il 2 novembre 2026 alle 21:10 (ora italiana), PRIMA dei risultati successivi, sul backup delle 20:58:
 * nei mercati LIQUIDI (margine Pinnacle sotto il 6%) i segnali I hanno vinto 46 volte su 32,6 attese (82 segnali, +85,68 euro),
 * positivi in ogni divisione (meta' dei dati, vantaggio piccolo e grande, quota fino a 3,50); nei sottili no.
 * Dove il mercato e' grande il prezzo di Pinnacle e' affidabile: basta un vantaggio dal 2% (non 4%). Entrano tra le ⭐, prima delle altre.
 */
const LIQUID = { since: '2026-11-02T20:10:00Z', maxMarginPct: 6, minEdge: 2, maxLeadHours: 3 };
function markLiquid(rows, { ignoreSince = false } = {}) {
  const since = T(LIQUID.since), out = new Map();
  for (const r of rows) {
    const t = T(r.created_at), lead = (T(r.commence_time) - t) / 3600000, m = pinMarginPct(r);
    const ok = (ignoreSince || t >= since) && lead <= LIQUID.maxLeadHours && Number(r.edge_pct) >= LIQUID.minEdge && m !== null && m < LIQUID.maxMarginPct && !isCup(r.league);
    out.set(r.id, { final: ok });
  }
  const best = new Map();   // una sola per partita ed esito: la lettura piu' vicina al calcio d'inizio
  for (const r of rows) if (out.get(r.id).final) { const k = sigKey(r), cur = best.get(k); if (!cur || T(r.created_at) > T(cur.created_at)) best.set(k, r); }
  for (const r of rows) if (out.get(r.id).final && best.get(sigKey(r)) !== r) out.set(r.id, { final: false });
  return out;
}

// ------------------------------------------------------------------------------------------- 🏠 fattore campo (1° novembre 2026)
/**
 * Regola fissata il 1° novembre 2026 alle 21:20 (ora italiana), PRIMA dei risultati successivi, sui 363 segnali I chiusi:
 * nei mercati sottili (margine Pinnacle dal 6%, campionati minori) la squadra in TRASFERTA vince meno di quanto dice Pinnacle
 * (37 vinte su 46,1 attese, saldo -40,86 euro), mentre casa e pareggio vincono di piu'. Su tutte le partite: 2 usciti 109 contro 121,5 attesi.
 * Nei mercati liquidi la trasferta va bene (17 su 13,9). Quindi: fuori dalla lista da giocare il 2 nei mercati sottili. Si misura tutto lo stesso.
 */
const AWAY_THIN = { since: '2026-11-01T20:20:00Z', thinMarginPct: 6 };
function isAwayThin(r) {
  if (r.selection !== 'away') return false;
  const m = r.pin_margin !== undefined ? r.pin_margin : pinMarginPct(r);
  return m !== null && m !== undefined && Number(m) >= AWAY_THIN.thinMarginPct;
}

// ------------------------------------------------------------------------------------------- 👥 consenso dei siti (1° novembre 2026)
const CONSENSUS = { since: '2026-11-01T16:00:00Z', minEdgePct: 2, agreeMin: 4, isolatedRatio: 1.08, minSites: 3 };
/** Parte pura (testata): quanti siti italiani pagano sopra il prezzo giusto e quanto la quota sta sopra la mediana degli altri. */
function consensusOf(odd, fairProb, selection, quotes) {
  const i = { home: 0, draw: 1, away: 2 }[selection];
  if (i === undefined || !(fairProb > 0) || !(odd > 1) || !quotes) return null;
  const odds = Object.values(quotes).filter(v => Array.isArray(v) && Number(v[i]) > 1).map(v => Number(v[i])).sort((a, b) => a - b);
  if (odds.length < CONSENSUS.minSites) return null;
  const m = odds.length % 2 ? odds[(odds.length - 1) / 2] : (odds[odds.length / 2 - 1] + odds[odds.length / 2]) / 2;
  return { sites: odds.length, above: odds.filter(o => (o * fairProb - 1) * 100 >= CONSENSUS.minEdgePct).length, median: m, ratio: odd / m };
}

// ------------------------------------------------------------------------------------------- timbro della categoria
/** Parte pura (testata): la categoria di un segnale I calcolata con le regole di adesso. */
function flagsOf(r, f4, f5, f6, c, nowMs = Date.now()) {
  const sol = solidity(r), g = (m) => !!(m.get(r.id) && m.get(r.id).final);
  return { v: 1, at: new Date(nowMs).toISOString(), f2plus: g(f4), sicura: g(f5), consigliata: g(f6),
    motivi: (f6.get(r.id) || {}).reasons || [], solidita: sol.score, vicina: sol.near, liquido: sol.liquid, bookOk: sol.books,
    coppa: isCup(r.league), favSottile: thinFav(r), margine: pinMarginPct(r),
    regole: { minEdge: c && c.minEdge, final4: FINAL4, final6: FINAL6, books: c && c.books } };
}

/** Timbra i segnali I appena usciti (flags ancora vuoto). Le regole guardano lo storico, quindi si caricano gli ultimi 600. */
async function stampFlags(pool, c, nowMs = Date.now()) {
  const all = (await pool.query(`SELECT * FROM italia_signals WHERE strategy = 'I' ORDER BY commence_time DESC, id DESC LIMIT 600`)).rows;
  const todo = all.filter(r => r.flags == null && T(r.commence_time) > nowMs - 6 * 3600000);
  if (!todo.length) return 0;
  const f4 = markFinal4(all), f5 = markFinal5(all), f6 = markFinal6(all);
  for (const r of todo) await pool.query(`UPDATE italia_signals SET flags = $1 WHERE id = $2 AND flags IS NULL`, [JSON.stringify(flagsOf(r, f4, f5, f6, c, nowMs)), r.id]);
  return todo.length;
}

// ------------------------------------------------------------------------------------------- le migliori di oggi e il budget
/** Config del budget delle giocate vere (si cambia da Render senza toccare il codice). */
const budgetCfg = (env = process.env) => ({
  start: Number(env.BUDGET_START) > 0 ? Number(env.BUDGET_START) : 100,
  stop: Number(env.BUDGET_STOP) >= 0 && env.BUDGET_STOP !== undefined && env.BUDGET_STOP !== '' ? Number(env.BUDGET_STOP) : 75,
  maxPerDay: Number(env.BEST_MAX_PER_DAY) > 0 ? Number(env.BEST_MAX_PER_DAY) : 10,   // 2 novembre 2026: da 5 a 10 (il tetto quasi non scatta, resta come protezione)
  // quali F2+ mettere nelle migliori di oggi: 'consigliate' (predefinito dal 25 ottobre), 'sicure' o 'tutte'
  rule: ['consigliate', 'sicure', 'tutte'].includes(env.BEST_RULE) ? env.BEST_RULE : 'consigliate',
  onlySafe: env.BEST_RULE === 'sicure',
  // 1° novembre 2026: nella lista da giocare niente quote sopra 3,50 (F2+ fino a 3,50: +5..+8% contro la chiusura; sopra: -3,1% su 17)
  maxOdd: Number(env.BEST_MAX_ODD) > 1 ? Number(env.BEST_MAX_ODD) : 3.5,
  // 1° novembre 2026: niente 2 (trasferta) nei mercati sottili; BEST_AWAY_THIN=true su Render per rimetterle
  noAwayThin: env.BEST_AWAY_THIN !== 'true'
});

/**
 * Parte pura (testata): le vinte della lista da giocare contro le vinte attese (probabilita' di Pinnacle).
 * z = (vinte - attese) / deviazione: sotto -2 con almeno 30 risultati le vinte sono troppo poche per essere solo sfortuna.
 */
function winCheck(rows, minN = 30) {
  const done = rows.filter(r => r.result === 'won' || r.result === 'lost');
  const won = done.filter(r => r.result === 'won').length, expected = done.reduce((a, r) => a + Number(r.fair_prob || 0), 0);
  const sd = Math.sqrt(done.reduce((a, r) => { const p = Number(r.fair_prob || 0); return a + p * (1 - p); }, 0));
  const z = sd > 0 ? (won - expected) / sd : 0;
  const pnl = done.reduce((a, r) => a + (r.result === 'won' ? STAKE * (Number(r.odd) - 1) : -STAKE), 0);
  return { n: done.length, won, expected, z, pnlEur: pnl, minN, level: done.length < minN ? 'pochi' : z < -2 ? 'allarme' : z < -1 ? 'attenzione' : 'ok' };
}

/**
 * Parte pura (testata): quali segnali mettere in "⭐ Le migliori di oggi".
 * items = schede di getItalia (con final4, play, played, win_prob, commence_time); playedToday = giocate annotate oggi.
 * Solo F2+ non ancora iniziate, giocabili sui tuoi siti (MY_BOOKS) a quota almeno minima, non gia' giocate;
 * ordinate per valore della quota consigliata, al massimo maxPerDay meno quelle gia' giocate oggi. Niente se il budget e' allo stop.
 */
function pickBest(items, { nowMs = Date.now(), playedToday = 0, maxPerDay = 5, stopped = false, onlySafe = false, rule = null, maxOdd = 3.5, noAwayThin = false, team = null } = {}) {
  // 4 novembre 2026: la squadra in campo (pagella approvata da Christian). Senza, come prima: consigliate + liquide
  const tm = { fascia: true, oceano: true, coro: false, saracinesca: false, liquidi8: false, ...(team || {}) };
  if (stopped) return [];
  const room = Math.max(0, maxPerDay - playedToday);
  const value = r => r.play && r.win_prob ? r.play.odd * r.win_prob - 1 : -1;
  // 26 ottobre 2026: prima le 🟢 solide (2 condizioni su 3, il gruppo migliore nei dati), poi per convenienza
  const solidOf = r => (r.solid && r.solid.score >= 2 ? 1 : 0);
  // 30 ottobre 2026: niente partite di coppa nella lista da giocare (formazioni incerte: le ✅ di coppa CLV -3,4% su 15,
  // quelle di campionato +4,9% su 61). Le misure non cambiano: le coppe restano nei segnali e nell'archivio.
  // 1° novembre 2026 (21:20): niente trasferte nei mercati sottili (vedi AWAY_THIN)
  const ok = r => !(noAwayThin && isAwayThin(r)) && !isCup(r.league) && !(Number(r.odd) > maxOdd) && !(r.play && r.play.odd > maxOdd) && (rule === 'consigliate' ? r.final6 : (rule === 'sicure' || onlySafe) ? r.final5 : true);
  // una sola giocata per partita (26 ottobre 2026): se ci sono due esiti della stessa partita (es. X e 2) si tiene il piu' conveniente,
  // perche' sono giocate legate tra loro (se una vince l'altra perde). Non cambia nessuna misura, solo la lista da giocare.
  const seen = new Set();
  // 2 novembre 2026: anche le 💧 liquide (mercato liquido, vantaggio dal 2%), e vengono per prime
  const baseOk = r => !isCup(r.league) && !(Number(r.odd) > maxOdd) && !(r.play && r.play.odd > maxOdd);
  const okLiq = r => tm.oceano && r.liquid && baseOk(r);
  const okExtra = r => baseOk(r) && ((tm.coro && r.final4 && r.consensus && r.consensus.above >= 4) || (tm.saracinesca && r.final8) || (tm.liquidi8 && r.final9));
  const liq = r => (okLiq(r) ? 1 : 0);
  return items.filter(r => ((tm.fascia && r.final4 && ok(r)) || okLiq(r) || okExtra(r)) && r.play && !r.played && !r.skipped && T(r.commence_time) > nowMs)
    .sort((a, b) => ((b.score ? b.score.vote : -1) - (a.score ? a.score.vote : -1)) || (liq(b) - liq(a)) || (solidOf(b) - solidOf(a)) || (value(b) - value(a))).filter(r => { const k = r.event_id || r.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, room).map(r => r.id);   // 4 novembre: prima il 🧮 voto piu' alto
}

/**
 * Parte pura (testata): il verdetto di una scheda. play = 'yes' (giocala), 'wait' (non ancora), 'no' (non giocare); text = il motivo.
 * Segue le stesse regole della lista da giocare (pickBest), nello stesso ordine.
 */
function verdictOf(r, { best = new Set(), budget = {}, bc = {}, nowMs = Date.now(), toHour = 22 } = {}) {
  if (r.played || r.skipped) return null;
  const t = T(r.commence_time);
  if (!(t > nowMs)) return null;
  const n2 = v => Number(v).toFixed(2).replace('.', ',');
  const mine = Object.entries(r.alt || {}).map(([b, v]) => `${b} ${n2(v)}`).join(', ');
  if (best.has(r.id) && r.play) return { play: 'yes', text: `Giocala su ${r.play.book} a ${n2(r.play.odd)} o più (minimo ${n2(r.min_odd)})` };
  if (budget.stopped) return { play: 'no', text: 'Stop del budget raggiunto: niente giocate' };
  // 2 novembre 2026: prima i motivi che non cambiano col tempo (coppa, quota alta, campionato minore), poi l'attesa
  const liqOk = r.liquid || (r.pin_margin !== null && r.pin_margin !== undefined && Number(r.pin_margin) < LIQUID.maxMarginPct && Number(r.edge_pct) >= LIQUID.minEdge);
  if (isCup(r.league)) return { play: 'no', text: 'Partita di coppa: formazioni incerte' };
  const odd = r.play ? r.play.odd : Number(r.odd);
  if (bc.maxOdd && odd > bc.maxOdd) return { play: 'no', text: `Quota sopra ${n2(bc.maxOdd)}: lì il vantaggio non regge` };
  if (!liqOk && bc.rule === 'consigliate' && Number(r.win_prob) >= 0.5 && Number(r.pin_margin) >= 6) return { play: 'no', text: 'Favorito in un campionato minore: vince meno del previsto' };
  if (!liqOk && bc.noAwayThin && r.awayThin) return { play: 'no', text: 'Trasferta in un campionato minore: vince meno del previsto' };
  if (!r.final4 && !r.liquid) {
    if (!(Number(r.edge_pct) >= 4 || liqOk)) return { play: 'no', text: `Vantaggio troppo basso (${n2(r.edge_pct)}%, serve almeno 4%, o 2% nei campionati principali)` };
    const from = t - 3 * 3600000, rome = ms => Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }).format(new Date(ms)));
    // l'ultimo controllo e' alle 22: se le 3 ore prima cadono di notte, non diventera' mai una ⭐
    if (rome(t) < 9 || (rome(from) >= toHour && rome(t) >= toHour) || (from > nowMs && rome(from) >= toHour)) return { play: 'no', text: 'Partita di notte: il CRM non controlla dopo le 22, non diventerà una ⭐' };
    const hm = ms => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
    // gia' nelle 3 ore: il CRM la rilegge al primo giro (ogni 2 ore circa). Se passato un giro non e' diventata ⭐, la quota non vale piu'
    if (nowMs >= from + 2.25 * 3600000) return { play: 'no', text: 'Riletta nelle ultime 3 ore: la quota non ha più valore' };
    if (nowMs >= from) return { play: 'wait', text: `Il CRM la rilegge al prossimo controllo (entro le ${hm(Math.min(t, from + 2.25 * 3600000))}): se la quota tiene diventa 🟢` };
    return { play: 'wait', text: `Non ancora: il CRM la rilegge nelle 3 ore prima della partita (dalle ${hm(from)}) e ti dice se giocarla` };
  }
  if (!r.liquid && bc.rule === 'consigliate' && !r.final6) return { play: 'no', text: 'Favorito in un campionato minore: vince meno del previsto' };
  if (!r.play) return { play: 'no', text: `Non c'è sui tuoi siti a una quota buona${mine ? ` (${mine}, serve almeno ${n2(r.min_odd)})` : ''}` };
  if (budget.playedToday >= budget.maxPerDay) return { play: 'no', text: 'Hai già fatto le giocate di oggi' };
  return { play: 'no', text: 'C\'è già una giocata migliore su questa partita o oggi la lista è piena' };
}

/** Budget dalle giocate vere: partenza + saldo delle chiuse; "in gioco" = puntate ancora senza risultato. */
function budgetOf(played, c, nowMs = Date.now()) {
  const items = (played && played.items) || [];
  const pnl = items.reduce((a, x) => a + (x.pnlEur || 0), 0);
  const open = items.filter(x => x.pnlEur === null && x.result !== 'void').reduce((a, x) => a + (x.stake || 0), 0);
  const today = ROME_DAY.format(new Date(nowMs));
  const playedToday = items.filter(x => ROME_DAY.format(new Date(x.at)) === today).length;
  const balance = c.start + pnl;
  return { start: c.start, stop: c.stop, maxPerDay: c.maxPerDay, balance, pnl, open, count: items.length, playedToday, stopped: balance <= c.stop };
}

// ------------------------------------------------------------------------------------------- riepilogo per l'app

/** Come stats, piu' le vinte attese su 10 secondo Pinnacle (probabilita' giusta media). */
function oddsStats(list) {
  const p = list.map(r => Number(r.fair_prob)).filter(v => v > 0);
  return { ...stats(list), expectedWinsOf10: p.length ? 10 * p.reduce((a, b) => a + b, 0) / p.length : null };
}

function stats(list) {
  const cl = list.filter(r => r.clv_pct !== null && r.clv_pct !== undefined && r.clv_pct !== '').map(r => Number(r.clv_pct)).filter(Number.isFinite);
  const n = cl.length, mean = n ? cl.reduce((a, b) => a + b, 0) / n : null;
  const sd = n > 1 ? Math.sqrt(cl.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  return {
    signals: list.length, measured: n, avgClvPct: mean,
    clvCi95: n >= 5 && sd !== null ? [mean - 1.96 * sd / Math.sqrt(n), mean + 1.96 * sd / Math.sqrt(n)] : null,
    positivePct: n ? 100 * cl.filter(v => v > 0).length / n : null
  };
}

/**
 * ARCHIVIO: le partite gia' iniziate, raggruppate per giorno (ora italiana), dalla piu' recente.
 * Niente viene cancellato: l'archivio legge le stesse righe che usano tutte le misure.
 * before = giorno (AAAA-MM-GG) da cui andare indietro, escluso; days = quanti giorni restituire.
 */
async function getArchive(pool, { before = null, days = 7, nowMs = Date.now() } = {}) {
  await ensureTables(pool);
  try { await require('./results').ensureResults(pool); } catch (e) { /* risultati facoltativi */ }
  const all = (await pool.query(`SELECT * FROM italia_signals WHERE strategy = 'I' ORDER BY commence_time DESC, id DESC`)).rows;
  const prim = primaryRows(all), fin = markFinal(prim), fin3 = markFinal3(prim), fin2 = markFinal2(all), fin4 = markFinal4(all), fin5 = markFinal5(all), fin6 = markFinal6(all);
  const firstOf = new Map(prim.map(r => [sigKey(r), r.id]));
  const played = await require('./played').playedSignalIds(pool);
  const playedByKey = new Map(all.filter(r => played.get(Number(r.id))).map(r => [sigKey(r), played.get(Number(r.id))]));
  const romeDay = ms => ROME_DAY.format(new Date(ms));   // AAAA-MM-GG
  const past = latestRows(all).filter(r => T(r.commence_time) <= nowMs && (!before || romeDay(T(r.commence_time)) < before));
  const dayList = [...new Set(past.map(r => romeDay(T(r.commence_time))))].slice(0, Math.max(1, Math.min(31, days)));
  const R = require('./results');
  const out = dayList.map(day => {
    const items = past.filter(r => romeDay(T(r.commence_time)) === day).map(r => {
      const first = firstOf.get(sigKey(r));
      return { id: r.id, commence_time: r.commence_time, league: r.league, home: r.home, away: r.away, pick: SEL_NAME[r.selection], book: BOOK_NAMES[r.book] || r.book,
        odd: Number(r.odd), clv_pct: r.clv_pct !== null ? Number(r.clv_pct) : null, result: r.result || null, result_score: r.result_score || null,
        win_prob: r.fair_prob ? Number(r.fair_prob) : null, final: !!(fin.get(first) || {}).final, final2: !!(fin2.get(r.id) || {}).final, final3: !!(fin3.get(first) || {}).final, final4: !!(fin4.get(r.id) || {}).final, final5: !!(fin5.get(r.id) || {}).final, final6: !!(fin6.get(r.id) || {}).final, thin: pinMarginPct(r) !== null && pinMarginPct(r) >= FINAL6.thinMarginPct,
        six: !!(fin.get(first) || {}).final && isSix(r), played: played.get(Number(r.id)) || playedByKey.get(sigKey(r)) || null };
    });
    const cl = items.map(i => i.clv_pct).filter(v => v !== null);
    return { day, count: items.length, avgClvPct: cl.length ? cl.reduce((a, b) => a + b, 0) / cl.length : null, positivePct: cl.length ? 100 * cl.filter(v => v > 0).length / cl.length : null,
      results: R.resultStats(items), items };
  });
  const oldest = dayList[dayList.length - 1];
  return { days: out, more: !!oldest && past.some(r => romeDay(T(r.commence_time)) < oldest), next: oldest || null, totalPast: past.length };
}

async function getItalia(pool, env = process.env, strategy = 'I') {
  strategy = STRATEGIES[strategy] ? strategy : 'I';
  const c = cfgFor(cfg(env), strategy);
  const base = { strategy, ...STRATEGIES[strategy], active: !!c.key && (strategy !== 'B' || c.bEnabled), books: c.books.map(b => BOOK_NAMES[b] || b), rules: { minEdge: c.minEdge, maxEdge: c.maxEdge, maxOdd: c.maxOdd, windowHours: c.windowHours, scanEveryMin: c.scanEveryMin, monthlyCap: c.monthlyCap } };
  try { await ensureTables(pool); } catch (e) { return { ...base, error: e.message, total: stats([]), netwin: stats([]), byBook: [], bySelection: [], byOdds: [], recent: [], requestsThisMonth: 0 }; }
  const R = require('./results');
  try { await R.ensureResults(pool); } catch (e) { /* risultati facoltativi */ }
  // 3 novembre 2026 (velocita'): le letture indipendenti partono insieme invece che una dopo l'altra
  const [resultsStatus, allRes, used, lastRes] = await Promise.all([
    R.resultsStatus(pool, env).catch(() => null),
    pool.query(`SELECT * FROM italia_signals WHERE strategy = $1 ORDER BY commence_time DESC, id DESC LIMIT 600`, [strategy]),
    usedThisMonth(pool),
    pool.query(`SELECT at, ok, kind, records, quota_remaining, note FROM italia_requests ORDER BY id DESC LIMIT 1`)]);
  const all = allRes.rows;
  const rows = primaryRows(all);   // le misure restano sulla prima uscita; la F2 guarda anche le riletture
  const last = lastRes.rows[0] || null;
  const byBook = [...new Set(rows.map(r => r.book))].map(b => ({ book: BOOK_NAMES[b] || b, ...stats(rows.filter(r => r.book === b)) })).sort((a, b) => b.signals - a.signals);
  const fin = strategy === 'I' ? markFinal(rows) : new Map();
  const finRows = rows.filter(r => fin.get(r.id) && fin.get(r.id).final);
  const fin2 = strategy === 'I' ? markFinal2(all) : new Map();
  const fin2Rows = all.filter(r => fin2.get(r.id) && fin2.get(r.id).final);
  const fin4 = strategy === 'I' ? markFinal4(all) : new Map();
  const fin4Rows = all.filter(r => fin4.get(r.id) && fin4.get(r.id).final);
  const retro4 = strategy === 'I' ? markFinal4(all, { ignoreSince: true }) : new Map();
  const retro4Rows = all.filter(r => retro4.get(r.id) && retro4.get(r.id).final);
  const fin5 = strategy === 'I' ? markFinal5(all) : new Map();
  const fin5Rows = all.filter(r => fin5.get(r.id) && fin5.get(r.id).final);
  const retro5 = strategy === 'I' ? markFinal5(all, { ignoreSince: true }) : new Map();
  const retro5Rows = all.filter(r => retro5.get(r.id) && retro5.get(r.id).final);
  const fin6 = strategy === 'I' ? markFinal6(all) : new Map();
  const liqMap = strategy === 'I' ? markLiquid(all) : new Map(), liqRows = all.filter(r => (liqMap.get(r.id) || {}).final);
  const liqRetro = strategy === 'I' ? (() => { const m = markLiquid(all, { ignoreSince: true }); return all.filter(r => (m.get(r.id) || {}).final); })() : [];
  const fin6Rows = all.filter(r => fin6.get(r.id) && fin6.get(r.id).final);
  const retro6 = strategy === 'I' ? markFinal6(all, { ignoreSince: true }) : new Map();
  const retro6Rows = all.filter(r => retro6.get(r.id) && retro6.get(r.id).final);
  const paper = (mark) => { const f = strategy === 'I' ? mark(all) : new Map(), rt = strategy === 'I' ? mark(all, { ignoreSince: true }) : new Map();
    return { map: f, rows: all.filter(r => f.get(r.id) && f.get(r.id).final), retro: all.filter(r => rt.get(r.id) && rt.get(r.id).final) }; };
  const p8 = paper(markFinal8), p9 = paper(markFinal9);
  // la rilettura eredita l'etichetta F e F3 della prima uscita (stessa partita, stesso esito)
  const firstOf = new Map(rows.map(r => [sigKey(r), r.id]));
  const fin3 = strategy === 'I' ? markFinal3(rows) : new Map();
  const fin3Rows = rows.filter(r => fin3.get(r.id) && fin3.get(r.id).final);
  const nwRows = rows.filter(r => r.netwin_clv_pct !== null).map(r => ({ clv_pct: r.netwin_clv_pct }));
  const played = strategy === 'I' ? await require('./played').playedSignalIds(pool) : new Map();
  // una giocata vale per la partita e l'esito, anche se la scheda mostrata e' la rilettura
  const playedByKey = new Map(all.filter(r => played.get(Number(r.id))).map(r => [sigKey(r), played.get(Number(r.id))]));
  const skipped = strategy === 'I' ? await require('./played').skippedSignalIds(pool) : new Map();
  const skippedByKey = new Map(all.filter(r => skipped.get(Number(r.id))).map(r => [sigKey(r), skipped.get(Number(r.id))]));
  const SEL_IDX = { home: 0, draw: 1, away: 2 };
  // 1° novembre 2026: quote di TUTTI i siti dove Christian ha il conto (MY_BOOKS). Le quote dei siti fuori dalla I (es. Fastbet)
  // arrivano dalla riga T della stessa partita e della stessa lettura (stessa richiesta al feed, nessun costo in piu').
  const parseQ = q => { try { return typeof q === 'string' ? JSON.parse(q) : q; } catch (e) { return null; } };
  const tQuotes = new Map();
  if (strategy === 'I') {
    try {
      const evs = [...new Set(all.map(r => r.event_id))];
      const tr = evs.length ? (await pool.query(`SELECT event_id, phase, quotes, created_at FROM italia_signals WHERE strategy = 'T' AND event_id = ANY($1) ORDER BY created_at`, [evs])).rows : [];
      for (const t of tr) { const q = parseQ(t.quotes); if (q) { tQuotes.set(`${t.event_id}|${t.phase || ''}`, q); tQuotes.set(t.event_id, q); } }
    } catch (e) { /* facoltativo */ }
  }
  const quotesOf = r => ({ ...(tQuotes.get(`${r.event_id}|${r.phase || ''}`) || tQuotes.get(r.event_id) || {}), ...(parseQ(r.quotes) || {}) });
  const altOdds = r => { const q = quotesOf(r), out = {};
    for (const k of c.myBooks) { const v = q[k] && Number(q[k][SEL_IDX[r.selection]]); if (v > 1) out[BOOK_NAMES[k] || k] = v; }
    return Object.keys(out).length ? out : null; };
  const checks = strategy === 'I' ? await R.pendingChecks(pool).catch(() => []) : [];
  // 👥 consenso dei siti italiani (1° novembre 2026): sulle 296 I con chiusura, 4+ siti sopra il giusto = CLV +6,6%;
  // quota oltre l'8% sopra la mediana degli altri siti ("isolata") = vinte sotto le attese. Si mostra e si misura, non filtra.
  const consOf = r => consensusOf(Number(r.odd), Number(r.fair_prob), r.selection, quotesOf(r));
  const f2c = strategy === 'I' ? all.filter(r => fin4.get(r.id) && fin4.get(r.id).final && Number(r.odd) <= 3.5).map(r => ({ r, k: consOf(r) })).filter(x => x.k) : [];
  const since = T(CONSENSUS.since), consGroup = test => { const l = f2c.filter(x => test(x.k)); const now = l.filter(x => T(x.r.created_at) >= since).map(x => x.r), all2 = l.map(x => x.r);
    return { ...oddsStats(now), results: R.resultStats(now), retro: { ...oddsStats(all2), results: R.resultStats(all2) } }; };
  const out = {
    ...base, checks, total: stats(rows), netwin: stats(nwRows), byBook, results: R.resultStats(rows), resultsStatus,
    final: strategy === 'I' ? { ...oddsStats(finRows), rules: FINAL, stake: STAKE, expectedEur: expectedEur(finRows), results: R.resultStats(finRows),
      six: { ...oddsStats(finRows.filter(isSix)), minProb: SIX_MIN_PROB, results: R.resultStats(finRows.filter(isSix)) } } : null,
    final2: strategy === 'I' ? { ...oddsStats(fin2Rows), rules: FINAL2, stake: STAKE, expectedEur: expectedEur(fin2Rows), results: R.resultStats(fin2Rows) } : null,
    final3: strategy === 'I' ? { ...oddsStats(fin3Rows), rules: FINAL3, stake: STAKE, expectedEur: expectedEur(fin3Rows), results: R.resultStats(fin3Rows) } : null,
    final4: strategy === 'I' ? { ...oddsStats(fin4Rows), rules: FINAL4, stake: STAKE, expectedEur: expectedEur(fin4Rows), results: R.resultStats(fin4Rows),
      retro: { ...stats(retro4Rows), from: retro4Rows.length ? retro4Rows.reduce((m, r) => (r.created_at < m ? r.created_at : m), retro4Rows[0].created_at) : null } } : null,
    final5: strategy === 'I' ? { ...oddsStats(fin5Rows), rules: FINAL5, stake: STAKE, expectedEur: expectedEur(fin5Rows), results: R.resultStats(fin5Rows),
      retro: { ...oddsStats(retro5Rows), results: R.resultStats(retro5Rows) } } : null,
    final6: strategy === 'I' ? { ...oddsStats(fin6Rows), rules: FINAL6, stake: STAKE, expectedEur: expectedEur(fin6Rows), results: R.resultStats(fin6Rows),
      retro: { ...oddsStats(retro6Rows), results: R.resultStats(retro6Rows) } } : null,
    final8: strategy === 'I' ? { ...oddsStats(p8.rows), rules: FINAL8, stake: STAKE, expectedEur: expectedEur(p8.rows), results: R.resultStats(p8.rows),
      retro: { ...oddsStats(p8.retro), results: R.resultStats(p8.retro) } } : null,
    final9: strategy === 'I' ? { ...oddsStats(p9.rows), rules: FINAL9, stake: STAKE, expectedEur: expectedEur(p9.rows), results: R.resultStats(p9.rows),
      retro: { ...oddsStats(p9.retro), results: R.resultStats(p9.retro) } } : null,
    consensus: strategy === 'I' ? { rules: CONSENSUS, agree: consGroup(k => k.above >= CONSENSUS.agreeMin), isolated: consGroup(k => k.ratio > CONSENSUS.isolatedRatio),
      rest: consGroup(k => k.above < CONSENSUS.agreeMin && !(k.ratio > CONSENSUS.isolatedRatio)) } : null,
    bySelection: ['home', 'draw', 'away'].map(s => ({ name: SEL_NAME[s], ...stats(rows.filter(r => r.selection === s)) })),
    byOdds: [
      { name: 'Sotto 1,60 (7 o più vinte su 10)', ...oddsStats(rows.filter(r => Number(r.odd) < BAND.min)) },
      { name: '1,60–2,60 (4–6 vinte su 10)', recommended: true, ...oddsStats(rows.filter(r => inBand(r.odd))) },
      { name: 'Sopra 2,60 (meno di 4 su 10)', ...oddsStats(rows.filter(r => Number(r.odd) > BAND.max)) }
    ],
    requestsThisMonth: used, quotaRemaining: last && last.quota_remaining !== null ? Number(last.quota_remaining) : null, lastRequest: last,
    recent: latestRows(all).slice(0, 30).map(r => ({
      id: r.id, event_id: r.event_id, created_at: r.created_at, commence_time: r.commence_time, league: r.league, home: r.home, away: r.away,
      selection: r.selection, pick: SEL_NAME[r.selection], book: BOOK_NAMES[r.book] || r.book, odd: Number(r.odd), edge_pct: Number(r.edge_pct),
      netwin_odd: r.netwin_odd !== null ? Number(r.netwin_odd) : null, clv_pct: r.clv_pct !== null ? Number(r.clv_pct) : null,
      min_odd: r.fair_prob ? minOdd(Number(r.fair_prob), c.minEdge) : null, in_band: inBand(r.odd),
      win_prob: r.fair_prob ? Number(r.fair_prob) : null,
      final: !!(fin.get(firstOf.get(sigKey(r))) || {}).final, again: phaseOf(r) === 'near' && firstOf.get(sigKey(r)) !== r.id,
      final2: fin2.get(r.id) ? fin2.get(r.id).final : false,
      final3: !!(fin3.get(firstOf.get(sigKey(r))) || {}).final,
      final4: !!(fin4.get(r.id) || {}).final,
      liquid: !!(liqMap.get(r.id) || {}).final,
      draw_prob: (() => { const o = { home: Number(r.pin_h), draw: Number(r.pin_d), away: Number(r.pin_a) }; return o.home > 1 && o.draw > 1 && o.away > 1 ? noVigPower(o).draw : null; })(),
      final5: !!(fin5.get(r.id) || {}).final,
      final6: !!(fin6.get(r.id) || {}).final,
      final8: !!(p8.map.get(r.id) || {}).final, final9: !!(p9.map.get(r.id) || {}).final,
      pin_margin: pinMarginPct(r), thin: pinMarginPct(r) !== null && pinMarginPct(r) >= FINAL6.thinMarginPct, solid: solidity(r),
      six: !!(fin.get(firstOf.get(sigKey(r))) || {}).final && isSix(r),
      alt: strategy === 'I' ? altOdds(r) : null, consensus: strategy === 'I' ? consOf(r) : null, score: strategy === 'I' ? scoreOf(r, consOf(r)) : null, awayThin: isAwayThin(r), played: played.get(Number(r.id)) || playedByKey.get(sigKey(r)) || null,
      skipped: skipped.get(Number(r.id)) || skippedByKey.get(sigKey(r)) || null,
      // dove giocarlo: il bookmaker consigliato (MY_BOOKS) con la quota piu' alta, solo se almeno la minima
      play: (() => { const a = strategy === 'I' ? altOdds(r) : null, m = r.fair_prob ? minOdd(Number(r.fair_prob), c.minEdge) : null;
        const best = Object.entries(a || {}).filter(([, v]) => m && v >= m).sort((x, y) => y[1] - x[1])[0];
        return best ? { book: best[0], odd: best[1] } : null; })(),
      result: r.result || null, result_score: r.result_score || null
    }))
  };
  if (strategy === 'I') {
    let playedSum = null; try { playedSum = await require('./played').getPlayed(pool); } catch (e) { /* tabella non ancora creata */ }
    const budget = budgetOf(playedSum, budgetCfg(env));
    out.budget = budget;
    const bc = budgetCfg(env);
    out.bestOnlySafe = bc.onlySafe; out.bestRule = bc.rule; out.myBooks = c.myBooks.map(k => BOOK_NAMES[k] || k);
    let team = null; try { team = (await require('./team').stateOf(pool)).on; } catch (e) { /* pagella facoltativa */ }
    if (team) bc.noAwayThin = bc.noAwayThin && team.muro !== false;
    out.team = team;
    out.best = pickBest(out.recent, { playedToday: budget.playedToday, maxPerDay: budget.maxPerDay, stopped: budget.stopped, rule: bc.rule, maxOdd: bc.maxOdd, noAwayThin: bc.noAwayThin, team });
    out.bestMaxOdd = bc.maxOdd; out.bestNoAwayThin = bc.noAwayThin;
    // 1° novembre 2026: su ogni scheda un verdetto chiaro, GIOCALA o NON GIOCARE con il motivo (solo partite non ancora iniziate)
    const bestSet = new Set(out.best), nowV = Date.now();
    for (const r of out.recent) r.verdict = verdictOf(r, { best: bestSet, budget, bc, nowMs: nowV, toHour: c.toHour });
    // vinte contro attese della lista da giocare (stesse regole: selezione, niente coppe, quota fino al massimo)
    const ruleRows0 = bc.rule === 'consigliate' ? fin6Rows : bc.rule === 'sicure' ? fin5Rows : fin4Rows;
    const ruleRows = [...ruleRows0, ...liqRows.filter(r => !ruleRows0.includes(r))];   // con le 💧 liquide dal 2 novembre
    // 🧮 il voto si misura: da quando c'e' (4 novembre, 8:00) per fasce, sui segnali I (ultima lettura)
    { const t0 = T('2026-11-04T07:00:00Z'), lr = latestRows(all).filter(r => T(r.created_at) >= t0).map(r => ({ r, v: (scoreOf(r, consOf(r)) || {}).vote })).filter(x => x.v !== undefined);
      const band = (lo, hi) => { const l = lr.filter(x => x.v >= lo && x.v < hi).map(x => x.r); return { lo, hi, ...oddsStats(l), results: R.resultStats(l) }; };
      out.scoreBands = [band(65, 101), band(40, 65), band(0, 40)]; }
    out.liquidStar = { rules: LIQUID, ...oddsStats(liqRows.filter(r => Number(r.odd) <= bc.maxOdd)), results: R.resultStats(liqRows.filter(r => Number(r.odd) <= bc.maxOdd)),
      retro: { ...oddsStats(liqRetro.filter(r => Number(r.odd) <= bc.maxOdd)), results: R.resultStats(liqRetro.filter(r => Number(r.odd) <= bc.maxOdd)) } };
    out.bestCheck = winCheck(ruleRows.filter(r => !isCup(r.league) && Number(r.odd) <= bc.maxOdd && !(bc.noAwayThin && isAwayThin(r))));
    // 🏠 fattore campo sulla carta: le ✅ fino alla quota massima, con e senza le trasferte nei mercati sottili
    const hf = ruleRows.filter(r => !isCup(r.league) && Number(r.odd) <= bc.maxOdd), t0 = T(AWAY_THIN.since);
    const grp = l => { const now = l.filter(r => T(r.created_at) >= t0); return { ...oddsStats(now), results: R.resultStats(now), retro: { ...oddsStats(l), results: R.resultStats(l) } }; };
    out.homeField = { rules: AWAY_THIN, active: bc.noAwayThin, kept: grp(hf.filter(r => !isAwayThin(r))), awayThin: grp(hf.filter(isAwayThin)) };
  }
  return out;
}

module.exports = { SCORE, scoreOf, LIQUID, markLiquid, verdictOf, AWAY_THIN, isAwayThin, planScans, planOf, CONSENSUS, consensusOf, trio, fetchOdds, FINAL8, FINAL9, markFinal8, markFinal9, winCheck, odssPace, closingQuotes, flagsOf, stampFlags, isCup, withCountry, getArchive, SIX_MIN_PROB, isSix, NEAR_HOURS, phaseOf, primaryRows, latestRows, expectedEur, FINAL, markFinal, FINAL2, markFinal2, FINAL3, markFinal3, FINAL4, markFinal4, FINAL5, markFinal5, DEFAULT_T_BOOKS, BOOK_FAMILY, FINAL6, markFinal6, pinMarginPct, thinFav, solidity, pickBest, budgetOf, budgetCfg, cfgFor, STRATEGIES, DEFAULT_B_BOOKS, inBand, BAND, oddsStats, minOdd, cfg, mainRecords, mergeWithPinnacle, sameTeam, findSignals, closingPin, romeHour, signalText, ensureTables, scan, captureClosing, tick, getItalia, stats, DEFAULT_BOOKS, BOOK_NAMES };
