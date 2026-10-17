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
const axios = require('axios');
const { noVigPower } = require('./sharpSignals');

const BASE = 'https://odss-api.com/api/v1';
const DEFAULT_BOOKS = ['netwin', '888sport_it', 'sisal', 'snai', 'goldbet', 'eurobet'];
// Strategia B (selezione B dai dati della A, fonte odss): stessi libri esteri della A tranne quelli peggiori (LeoVegas, Coolbet, GTbets, Betsson).
const DEFAULT_B_BOOKS = ['onexbet', 'unibet_se', 'unibet_nl', 'williamhill', 'marathonbet', '888sport', 'bet365'];
const BOOK_NAMES = { netwin: 'Netwin', '888sport_it': '888sport', sisal: 'Sisal', snai: 'Snai', goldbet: 'Goldbet', eurobet: 'Eurobet', lottomatica: 'Lottomatica', pokerstars: 'PokerStars', leovegas: 'LeoVegas', betsson: 'Betsson', bet365: 'bet365', planetwin365: 'Planetwin365',
  onexbet: '1xBet', unibet_se: 'Unibet (SE)', unibet_nl: 'Unibet (NL)', williamhill: 'William Hill', marathonbet: 'Marathonbet', '888sport': '888sport (estero)' };
const STRATEGIES = {
  I: { letter: 'I', title: 'Quote italiane contro Pinnacle', playable: true },
  B: { letter: 'B', title: 'Selezione B – libri esteri (da odss)', playable: false }
};
const OUT = { home: 'HOME', draw: 'DRAW', away: 'AWAY' };
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
    closeWindowMin: n('ITALIA_CLOSE_WINDOW_MIN', 40),
    maxStaleMin: n('ITALIA_MAX_STALE_MIN', 30),
    // Strategia B: stessa richiesta della I (zero richieste in piu'), libri esteri, edge 2-5%, quota sotto 5, entro 6 ore
    bBooks: (env.B_BOOKS ? env.B_BOOKS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_B_BOOKS),
    bMinEdge: n('B_MIN_EDGE', 2), bMaxEdge: n('B_MAX_EDGE', 5), bMaxOdd: n('B_MAX_ODD', 5),
    bEnabled: env.B_ENABLED !== 'false'
  };
}

/** Config della strategia richiesta (I o B) nella stessa forma usata da findSignals. */
function cfgFor(c, strategy) {
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

const fresh = (b, nowMs, maxStaleMin) => !b.last_update || (nowMs - Date.parse(b.last_update)) <= maxStaleMin * 60000;

// Abbinamento tra righe della stessa partita scritte in modo diverso dai bookmaker ("Benfica - Celtic" e "Benfica - Celtic Glasgow").
const GENERIC = new Set(['fc', 'cf', 'ac', 'sc', 'afc', 'cd', 'ud', 'sd', 'club', 'de', 'the', 'calcio', 'fk', 'sk', 'if', 'bk', 'cp', 'sv', 'vfb', 'vfl', 'tsg', 'as', 'ss', 'us', 'rc', 'rcd', 'ca', 'ad', 'sl', 'fsv', 'spvgg', 'sporting', 'real', 'united', 'city', 'town', 'athletic', 'atletico']);
const FLAGS = ['u17', 'u18', 'u19', 'u20', 'u21', 'u23', 'women', 'w', 'femminile', 'riserve', 'reserves', 'ii', 'b'];
const LEAGUE_FLAGS = ['u17', 'u18', 'u19', 'u20', 'u21', 'u23', 'women', 'femminile', 'reserves', 'riserve', 'youth', 'primavera'];
const FRIENDLY = /friendl|amichev|club friendly|test match/i;
// Fascia di quota consigliata: 4-6 vinte su 10 (saldo piu' regolare a parita' di vantaggio)
const BAND = { min: 1.6, max: 2.6 };
const inBand = odd => Number(odd) >= BAND.min && Number(odd) <= BAND.max;
const words = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
function sameTeam(a, b) {
  const wa = words(a), wb = words(b);
  if (FLAGS.filter(f => wa.includes(f)).join() !== FLAGS.filter(f => wb.includes(f)).join()) return false;   // giovanili, donne, riserve: mai con la prima squadra
  const A = wa.filter(w => !GENERIC.has(w) && w.length > 1), B = wb.filter(w => !GENERIC.has(w) && w.length > 1);
  if (!A.length || !B.length) return wa.join(' ') === wb.join(' ');
  return A.some(x => B.some(y => x === y || (x.length >= 5 && y.length >= 5 && (x.startsWith(y) || y.startsWith(x)))));
}
const sameMatch = (p, r) => p.commence_time && Date.parse(p.commence_time) === Date.parse(r.commence_time) && sameTeam(p.home_team, r.home_team) && sameTeam(p.away_team, r.away_team);

/** Per ogni riga con Pinnacle aggiunge i bookmaker che il feed ha messo in un'altra riga della stessa partita (la riga con Pinnacle ha la precedenza). */
function mergeWithPinnacle(records) {
  const main = mainRecords(records);
  const withPin = main.filter(r => (r.bookmakers || []).some(b => b.key === 'pinnacle'));
  return withPin.map(p => {
    const books = [...p.bookmakers], have = new Set(books.map(b => b.key));
    for (const r of main) {
      if (r === p || (r.bookmakers || []).some(b => b.key === 'pinnacle') || !sameMatch(p, r)) continue;
      for (const b of r.bookmakers || []) if (!have.has(b.key)) { books.push(b); have.add(b.key); }
    }
    return { ...p, bookmakers: books };
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
    const start = Date.parse(r.commence_time);
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

/** Ora italiana (0-23) per decidere se e' il momento di scansionare. */
function romeHour(nowMs) {
  return Number(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date(nowMs))) % 24;
}

/** Quota minima da accettare sul sito: sotto questa il vantaggio sul prezzo giusto di Pinnacle scende sotto la soglia. */
function minOdd(fairProb, minEdgePct) { return Math.ceil((1 + minEdgePct / 100) / fairProb * 100) / 100; }

function signalText(s, minEdgePct = 2) {
  const when = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s.commence_time));
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
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS italia_signals_uniq ON italia_signals (event_id, selection, strategy)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS italia_requests (
    id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW(), kind TEXT, ok BOOLEAN, records INT, quota_remaining INT, note TEXT)`);
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

async function scan(pool, c, { nowMs = Date.now(), http, notify } = {}) {
  const h = romeHour(nowMs);
  if (h < c.fromHour || h >= c.toHour) return { scan: 'fuori orario' };
  const { rows } = await pool.query(`SELECT MAX(at) FILTER (WHERE ok) AS last_ok, MAX(at) FILTER (WHERE NOT ok) AS last_ko FROM italia_requests WHERE kind = 'scan'`);
  const lastOk = rows[0].last_ok ? Date.parse(rows[0].last_ok) : 0, lastKo = rows[0].last_ko ? Date.parse(rows[0].last_ko) : 0;
  if (nowMs - lastOk < c.scanEveryMin * 60000) return { scan: 'non ancora' };
  if (lastKo > lastOk && nowMs - lastKo < 30 * 60000) return { scan: 'in pausa dopo un errore' };    // chiave sbagliata o servizio giu': non insistere ogni 10 minuti
  if (await usedThisMonth(pool) >= c.monthlyCap - c.closeReserve) return { scan: 'tetto mensile' };
  const rem = await lastRemaining(pool);
  if (rem !== null && rem <= c.closeReserve) return { scan: 'quota odss quasi finita' };
  const records = await fetchOdds(pool, c, {
    bookmakers: [...new Set(['pinnacle', ...c.books, ...(c.bEnabled ? c.bBooks : [])])].join(','),
    commence_from: new Date(nowMs + c.minLeadMin * 60000).toISOString(),
    commence_to: new Date(nowMs + c.windowHours * 3600000).toISOString()
  }, 'scan', http);
  const found = findSignals(records, c, nowMs);
  const foundB = c.bEnabled ? findSignals(records, cfgFor(c, 'B'), nowMs) : [];
  const fresh = [];
  let nuoviB = 0;
  for (const [strategy, list] of [['I', found], ['B', foundB]]) {
    for (const s of list) {
      const r = await pool.query(
        `INSERT INTO italia_signals (event_id, league, home, away, commence_time, selection, book, odd, fair_prob, edge_pct, pin_h, pin_d, pin_a, netwin_odd, netwin_edge_pct, quotes, strategy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (event_id, selection, strategy) DO NOTHING RETURNING id`,
        [s.event_id, s.league, s.home, s.away, s.commence_time, s.selection, s.book, s.odd, s.fair_prob, s.edge_pct, s.pin[0], s.pin[1], s.pin[2], s.netwin_odd, s.netwin_edge_pct, JSON.stringify(s.quotes), strategy]);
      if (r.rowCount) { if (strategy === 'I') fresh.push(s); else nuoviB++; }
    }
  }
  if (fresh.length && notify) {
    try { await notify(`<b>Quote italiane – prova senza soldi</b>\n\n${fresh.map(x => signalText(x, c.minEdge)).join('\n\n')}\n\n<i>La quota cambia in fretta: controlla sul sito prima di giocare.</i>`); } catch (e) { /* avviso facoltativo */ }
  }
  return { scan: 'fatta', righe: records.length, candidati: found.length, nuovi: fresh.length, nuoviB };
}

async function captureClosing(pool, c, { nowMs = Date.now(), http } = {}) {
  const { rows } = await pool.query(
    `SELECT id, event_id, selection, odd, netwin_odd, commence_time, close_lag_min FROM italia_signals
     WHERE commence_time > to_timestamp($1::double precision / 1000) AND commence_time <= to_timestamp($1::double precision / 1000) + make_interval(mins => $2::int)
       AND (close_captured_at IS NULL OR (close_lag_min > 20 AND commence_time <= to_timestamp($1::double precision / 1000) + INTERVAL '22 minutes'))`,
    [nowMs, c.closeWindowMin]);
  if (!rows.length) return { chiusure: 0 };
  if (await usedThisMonth(pool) >= c.monthlyCap) return { chiusure: 0, nota: 'tetto mensile' };
  const rem = await lastRemaining(pool);
  if (rem !== null && rem <= 3) return { chiusure: 0, nota: 'quota odss finita' };
  const ids = [...new Set(rows.map(r => r.event_id))];
  const records = await fetchOdds(pool, c, { event_id: ids.join(','), bookmakers: 'pinnacle' }, 'close', http);
  let n = 0;
  for (const s of rows) {
    const pin = closingPin(records, s.event_id);
    if (!pin) continue;
    const fair = noVigPower(pin)[s.selection];
    const lag = Math.max(0, Math.round((Date.parse(s.commence_time) - nowMs) / 60000));
    await pool.query(
      `UPDATE italia_signals SET close_pin_h=$2, close_pin_d=$3, close_pin_a=$4, closing_fair_prob=$5, clv_pct=$6, netwin_clv_pct=$7, close_lag_min=$8, close_captured_at=NOW() WHERE id=$1`,
      [s.id, pin.home, pin.draw, pin.away, fair, (Number(s.odd) * fair - 1) * 100, s.netwin_odd ? (Number(s.netwin_odd) * fair - 1) * 100 : null, lag]);
    n++;
  }
  return { chiusure: n };
}

/** Un passo: prima le chiusure (hanno la precedenza sul tetto), poi l'eventuale scansione. Non lancia mai. */
async function tick(pool, { env = process.env, nowMs = Date.now(), http, notify } = {}) {
  const c = cfg(env);
  if (!c.key) return { attiva: false, motivo: 'ODSS_API_KEY non impostata' };
  const out = { attiva: true };
  try { await ensureTables(pool); } catch (e) { return { attiva: true, errore: e.message }; }
  try { Object.assign(out, await captureClosing(pool, c, { nowMs, http })); } catch (e) { out.erroreChiusura = e.message; }
  try { Object.assign(out, await scan(pool, c, { nowMs, http, notify })); } catch (e) { out.erroreScansione = e.message; }
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
const FINAL = { since: '2026-10-17T08:00:00Z', minEdge: 2, maxEdge: 6, minOdd: 1.6, maxOdd: 3.5, bookMinN: 15 };

/** Segna con final=true le righe I che rispettano le condizioni F; il controllo sul bookmaker usa solo le chiusure gia' note al momento del segnale. */
function markFinal(rows) {
  const since = Date.parse(FINAL.since);
  const sorted = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const out = new Map();
  for (const r of sorted) {
    const t = Date.parse(r.created_at), edge = Number(r.edge_pct), odd = Number(r.odd);
    const reasons = [];
    if (t < since) reasons.push('prima delle regole');
    if (!(edge >= FINAL.minEdge && edge <= FINAL.maxEdge)) reasons.push('vantaggio fuori 2–6%');
    if (!(odd >= FINAL.minOdd && odd <= FINAL.maxOdd)) reasons.push('quota fuori 1,60–3,50');
    const past = rows.filter(x => x.book === r.book && x.clv_pct !== null && x.clv_pct !== undefined && x.close_captured_at && Date.parse(x.close_captured_at) < t).map(x => Number(x.clv_pct));
    if (past.length >= FINAL.bookMinN && past.reduce((a, b) => a + b, 0) / past.length < 0) reasons.push('bookmaker con valore negativo');
    out.set(r.id, { final: reasons.length === 0, reasons });
  }
  return out;
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

async function getItalia(pool, env = process.env, strategy = 'I') {
  strategy = STRATEGIES[strategy] ? strategy : 'I';
  const c = cfgFor(cfg(env), strategy);
  const base = { strategy, ...STRATEGIES[strategy], active: !!c.key && (strategy !== 'B' || c.bEnabled), books: c.books.map(b => BOOK_NAMES[b] || b), rules: { minEdge: c.minEdge, maxEdge: c.maxEdge, maxOdd: c.maxOdd, windowHours: c.windowHours, scanEveryMin: c.scanEveryMin, monthlyCap: c.monthlyCap } };
  try { await ensureTables(pool); } catch (e) { return { ...base, error: e.message, total: stats([]), netwin: stats([]), byBook: [], bySelection: [], byOdds: [], recent: [], requestsThisMonth: 0 }; }
  const { rows } = await pool.query(`SELECT * FROM italia_signals WHERE strategy = $1 ORDER BY commence_time DESC, id DESC LIMIT 500`, [strategy]);
  const used = await usedThisMonth(pool);
  const last = (await pool.query(`SELECT at, ok, kind, records, quota_remaining, note FROM italia_requests ORDER BY id DESC LIMIT 1`)).rows[0] || null;
  const byBook = [...new Set(rows.map(r => r.book))].map(b => ({ book: BOOK_NAMES[b] || b, ...stats(rows.filter(r => r.book === b)) })).sort((a, b) => b.signals - a.signals);
  const fin = strategy === 'I' ? markFinal(rows) : new Map();
  const finRows = rows.filter(r => fin.get(r.id) && fin.get(r.id).final);
  const nwRows = rows.filter(r => r.netwin_clv_pct !== null).map(r => ({ clv_pct: r.netwin_clv_pct }));
  return {
    ...base, total: stats(rows), netwin: stats(nwRows), byBook,
    final: strategy === 'I' ? { ...oddsStats(finRows), rules: FINAL } : null,
    bySelection: ['home', 'draw', 'away'].map(s => ({ name: SEL_NAME[s], ...stats(rows.filter(r => r.selection === s)) })),
    byOdds: [
      { name: 'Sotto 1,60 (7 o più vinte su 10)', ...oddsStats(rows.filter(r => Number(r.odd) < BAND.min)) },
      { name: '1,60–2,60 (4–6 vinte su 10)', recommended: true, ...oddsStats(rows.filter(r => inBand(r.odd))) },
      { name: 'Sopra 2,60 (meno di 4 su 10)', ...oddsStats(rows.filter(r => Number(r.odd) > BAND.max)) }
    ],
    requestsThisMonth: used, quotaRemaining: last && last.quota_remaining !== null ? Number(last.quota_remaining) : null, lastRequest: last,
    recent: rows.slice(0, 30).map(r => ({
      id: r.id, created_at: r.created_at, commence_time: r.commence_time, league: r.league, home: r.home, away: r.away,
      selection: r.selection, pick: SEL_NAME[r.selection], book: BOOK_NAMES[r.book] || r.book, odd: Number(r.odd), edge_pct: Number(r.edge_pct),
      netwin_odd: r.netwin_odd !== null ? Number(r.netwin_odd) : null, clv_pct: r.clv_pct !== null ? Number(r.clv_pct) : null,
      min_odd: r.fair_prob ? minOdd(Number(r.fair_prob), c.minEdge) : null, in_band: inBand(r.odd),
      win_prob: r.fair_prob ? Number(r.fair_prob) : null,
      final: fin.get(r.id) ? fin.get(r.id).final : false
    }))
  };
}

module.exports = { FINAL, markFinal, cfgFor, STRATEGIES, DEFAULT_B_BOOKS, inBand, BAND, oddsStats, minOdd, cfg, mainRecords, mergeWithPinnacle, sameTeam, findSignals, closingPin, romeHour, signalText, ensureTables, scan, captureClosing, tick, getItalia, stats, DEFAULT_BOOKS, BOOK_NAMES };
