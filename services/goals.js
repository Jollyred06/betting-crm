/**
 * ⚽ GOL (1° novembre 2026). Regole fissate oggi alle 16:30 (ora italiana), PRIMA di vedere le partite successive.
 *
 * Il "filo" trovato su 393 partite chiuse (backup del 1° novembre): la probabilita' di pareggio di Pinnacle dice quanti gol ci saranno.
 *   gol attesi ≈ 6,21 − 12,52 × probabilita' del pareggio   (trovata su meta' partite, regge sull'altra meta')
 *
 * Due prove sulla carta, NON si giocano:
 *  💥 VALANGA: pareggio sotto il 22% e mercato sottile (margine Pinnacle dall'8%), niente coppe. All'indietro: 33 partite,
 *     4,06 gol di media, Over 2,5 al 79%, Over 3,5 al 61%. Nei mercati liquidi la stessa X alta non porta gol (2,44).
 *  ⭐ GOL: Over/Under 2,5 di un sito italiano sopra il prezzo giusto della Over/Under di Pinnacle (vantaggio 4–15%, entro 3 ore).
 *
 * Parte 1, gia' attiva e gratis: ogni scansione salva il prezzo 1X2 di Pinnacle di TUTTE le partite viste (goal_watch);
 * il risultato arriva da Highlightly (stesse pagine gia' lette) o dai segnali. Cosi' Valanga e formula si misurano da subito.
 * Parte 2, spenta (OU_ENABLED): le quote Over/Under dei siti, una richiesta odss in piu' a scansione. Si accende dal 12 novembre.
 */
const FORMULA = { a: 6.21, b: 12.52 };
const RULES = { since: '2026-11-01T15:30:00Z' };
const VALANGA = { maxDrawProb: 0.22, minMarginPct: 8, lines: [1.5, 2.5, 3.5] };
const GSTAR = { line: 2.5, minEdge: 4, maxEdge: 15, maxLeadHours: 3, minOdd: 1.3 };
// i numeri trovati all'indietro, per confronto con quelli che arrivano da oggi
const REFERENCE = { valanga: { n: 33, goals: 4.06, over: { 1.5: 91, 2.5: 79, 3.5: 61 } }, all: { n: 393, goals: 2.79, over: { 1.5: 74, 2.5: 50, 3.5: 31 } } };

// ------------------------------------------------------------------------------------------- parte pura (testata)
function fair1x2(h, d, a) {
  const o = [h, d, a].map(Number);
  if (!o.every(v => v > 1)) return null;
  const inv = o.map(v => 1 / v), s = inv.reduce((x, y) => x + y, 0);
  return { home: inv[0] / s, draw: inv[1] / s, away: inv[2] / s, marginPct: (s - 1) * 100 };
}
const expGoals = pDraw => Math.max(0.5, FORMULA.a - FORMULA.b * pDraw);
function isValanga(league, f) {
  return !!f && f.draw < VALANGA.maxDrawProb && f.marginPct >= VALANGA.minMarginPct && !require('./italia').isCup(league);
}
/** Prezzo giusto di due esiti (Over/Under) senza margine, metodo power come per l'1X2. */
function noVig2(o1, o2) {
  const a = Number(o1), b = Number(o2);
  if (!(a > 1 && b > 1)) return null;
  let lo = 0.5, hi = 3;
  for (let i = 0; i < 60; i++) { const k = (lo + hi) / 2, s = (1 / a) ** k + (1 / b) ** k; if (s > 1) lo = k; else hi = k; }
  const k = (lo + hi) / 2;
  return [(1 / a) ** k, (1 / b) ** k];
}
const goalsOf = sc => { const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(sc || '')); return m ? Number(m[1]) + Number(m[2]) : null; };
const sideWon = (side, line, goals) => (goals === null ? null : side === 'over' ? goals > line : goals < line);

/**
 * Righe Over/Under del feed, in forma unica. Il formato preciso di odss si conferma con la prova (ou-check) il 12 novembre:
 * qui si accettano i nomi piu' comuni per il mercato, la linea e i due esiti.
 */
function lineOf(r) {
  for (const k of ['line', 'handicap', 'points', 'total', 'value', 'param']) if (r[k] !== undefined && r[k] !== null && !isNaN(Number(r[k]))) return Number(r[k]);
  const m = /(\d+)[._,](\d)/.exec(String(r.market || '')); return m ? Number(`${m[1]}.${m[2]}`) : null;
}
function ouPair(outcomes) {
  if (!outcomes) return null;
  const get = re => { for (const [k, v] of Object.entries(outcomes)) if (re.test(k)) return Number(v); return null; };
  const over = get(/^(over|o|over_?\d.*)$/i), under = get(/^(under|u|under_?\d.*)$/i);
  return over > 1 && under > 1 ? { over, under } : null;
}
function parseTotals(records) {
  const out = new Map();
  for (const r of records || []) {
    if (!r || !/over|under|total|goal|ou/i.test(String(r.market || ''))) continue;
    if ((r.scope || 'match') !== 'match' || (r.period || 'full_time') !== 'full_time' || (r.state || 'prematch') !== 'prematch') continue;
    const line = lineOf(r);
    if (!(line > 0)) continue;
    const ev = out.get(r.event_id) || { event_id: r.event_id, league: r.league, home: r.home_team, away: r.away_team, commence_time: r.commence_time, lines: {} };
    for (const b of r.bookmakers || []) {
      const p = ouPair(b.outcomes);
      if (!p) continue;
      (ev.lines[line] = ev.lines[line] || {})[b.key] = p;
    }
    out.set(r.event_id, ev);
  }
  return out;
}

/** Candidati sulla carta da una lettura Over/Under. pin1x2 = Map event_id -> {league, fair} dall'1X2 della stessa scansione. */
function findGoalSignals(totals, books, pin1x2, nowMs = Date.now()) {
  const out = [];
  for (const ev of totals.values()) {
    const lead = (Date.parse(ev.commence_time) - nowMs) / 3600000;
    if (!(lead > 0)) continue;
    // ⭐ GOL: valore contro la Over/Under di Pinnacle
    const L = ev.lines[GSTAR.line] || {}, pin = L.pinnacle, fair = pin && noVig2(pin.over, pin.under);
    if (fair && lead <= GSTAR.maxLeadHours) {
      for (const side of ['over', 'under']) {
        const p = side === 'over' ? fair[0] : fair[1];
        let best = null;
        for (const b of books) { const q = L[b] && L[b][side]; if (q >= GSTAR.minOdd && (!best || q > best.odd)) best = { book: b, odd: q }; }
        if (!best) continue;
        const edge = (best.odd * p - 1) * 100;
        if (edge >= GSTAR.minEdge && edge <= GSTAR.maxEdge) out.push({ strategy: 'G', ev, line: GSTAR.line, side, ...best, fair_prob: p, edge_pct: edge, pin });
      }
    }
    // 💥 VALANGA: tutte le partite che rispettano la regola, Over alla miglior quota italiana (si misura anche senza vantaggio)
    const x = pin1x2.get(ev.event_id);
    if (x && isValanga(x.league || ev.league, x.fair)) {
      for (const line of VALANGA.lines) {
        const LL = ev.lines[line] || {}, pp = LL.pinnacle, ff = pp && noVig2(pp.over, pp.under);
        let best = null;
        for (const b of books) { const q = LL[b] && LL[b].over; if (q > 1 && (!best || q > best.odd)) best = { book: b, odd: q }; }
        if (best) out.push({ strategy: 'V', ev, line, side: 'over', ...best, fair_prob: ff ? ff[0] : null, edge_pct: ff ? (best.odd * ff[0] - 1) * 100 : null, pin: pp || null });
      }
    }
  }
  return out;
}

/** Riepilogo di righe con gol: quante, media, % Over sulle linee. */
function overStats(goalsList) {
  const g = goalsList.filter(v => v !== null && v !== undefined), n = g.length;
  const pct = L => (n ? 100 * g.filter(v => v > L).length / n : null);
  return { n, goals: n ? g.reduce((a, b) => a + b, 0) / n : null, over: { 1.5: pct(1.5), 2.5: pct(2.5), 3.5: pct(3.5) } };
}

// ------------------------------------------------------------------------------------------- database
let ready = false;
async function ensureGoals(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS goal_watch (event_id TEXT PRIMARY KEY, league TEXT, home TEXT, away TEXT, commence_time TIMESTAMPTZ,
    pin_h NUMERIC(8,3), pin_d NUMERIC(8,3), pin_a NUMERIC(8,3), margin_pct NUMERIC(6,2), draw_prob NUMERIC(6,4), exp_goals NUMERIC(5,2), valanga BOOLEAN,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), result_score TEXT, goals INT, settled_at TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS goal_signals (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), strategy TEXT, event_id TEXT, league TEXT, home TEXT, away TEXT,
    commence_time TIMESTAMPTZ, line NUMERIC(4,1), side TEXT, book TEXT, odd NUMERIC(8,3), fair_prob NUMERIC(6,4), edge_pct NUMERIC(7,2), pin_over NUMERIC(8,3), pin_under NUMERIC(8,3),
    result TEXT, goals INT, settled_at TIMESTAMPTZ, UNIQUE (event_id, strategy, line, side))`);
  ready = true;
}

/** Dalla scansione 1X2 (righe gia' unite con Pinnacle): salva il prezzo di ogni partita. Nessuna richiesta in piu'. */
async function watch(pool, merged, trio, nowMs = Date.now()) {
  await ensureGoals(pool);
  let n = 0;
  for (const r of merged || []) {
    if (!(Date.parse(r.commence_time) > nowMs)) continue;
    const b = (r.bookmakers || []).find(x => x.key === 'pinnacle'), q = b && trio(b.outcomes), f = q && fair1x2(q.home, q.draw, q.away);
    if (!f) continue;
    await pool.query(`INSERT INTO goal_watch (event_id, league, home, away, commence_time, pin_h, pin_d, pin_a, margin_pct, draw_prob, exp_goals, valanga)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (event_id) DO UPDATE SET league=$2, home=$3, away=$4, commence_time=$5, pin_h=$6, pin_d=$7, pin_a=$8, margin_pct=$9, draw_prob=$10, exp_goals=$11, valanga=$12, updated_at=NOW()
      WHERE goal_watch.result_score IS NULL`,
      [r.event_id, r.league, r.home_team, r.away_team, r.commence_time, q.home, q.draw, q.away, f.marginPct, f.draw, expGoals(f.draw), isValanga(r.league, f)]);
    n++;
  }
  return n;
}

/** Risultati: dai segnali gia' chiusi (stessa partita) e poi le righe Over/Under sulla carta. */
async function settleGoals(pool) {
  await ensureGoals(pool);
  await pool.query(`UPDATE goal_watch g SET result_score = s.result_score, goals = split_part(s.result_score, '-', 1)::int + split_part(s.result_score, '-', 2)::int, settled_at = NOW()
    FROM italia_signals s WHERE s.event_id = g.event_id AND g.result_score IS NULL AND s.result_score ~ '^[0-9]+-[0-9]+$'`);
  await pool.query(`UPDATE goal_signals x SET goals = g.goals, settled_at = NOW(),
      result = CASE WHEN (x.side = 'over' AND g.goals > x.line) OR (x.side = 'under' AND g.goals < x.line) THEN 'won' ELSE 'lost' END
    FROM goal_watch g WHERE g.event_id = x.event_id AND x.result IS NULL AND g.goals IS NOT NULL`);
}

/** Partite viste e ancora senza risultato (per Highlightly, che legge comunque tutto il giorno). */
async function pendingWatch(pool, nowMs) {
  try {
    await ensureGoals(pool);
    return (await pool.query(`SELECT event_id, league, home, away, commence_time FROM goal_watch WHERE result_score IS NULL
      AND commence_time < to_timestamp($1::double precision / 1000) - INTERVAL '150 minutes' AND commence_time > to_timestamp($1::double precision / 1000) - INTERVAL '3 days'`, [nowMs])).rows;
  } catch (e) { return []; }
}
async function setWatchScore(pool, eventId, sc) {
  const g = goalsOf(sc);
  if (g === null) return;
  await pool.query(`UPDATE goal_watch SET result_score = $2, goals = $3, settled_at = NOW() WHERE event_id = $1 AND result_score IS NULL`, [eventId, sc, g]);
}

/**
 * 💥 THOR IN ANTICIPO (4 novembre 2026): prima del 12 le quote Over/Under si chiedono SOLO per le partite Valanga in arrivo
 * (entro 3 ore), una richiesta per gruppo, una volta per partita: circa 1-2 richieste al giorno, dentro il margine del piano odss.
 * Il nome del mercato Over/Under di odss non e' documentato: si prova 'over_under', poi 'totals', 'ou', 'goals';
 * un nome che torna vuoto non si riprova.
 */
const OU_MARKETS = ['over_under', 'totals', 'ou', 'goals'];
async function valangaOdds(pool, c, { nowMs = Date.now(), http } = {}) {
  if (c.ouEnabled) return { thor: 'ci pensa la lettura completa' };
  await ensureGoals(pool);
  await pool.query(`ALTER TABLE goal_watch ADD COLUMN IF NOT EXISTS ou_tried_at TIMESTAMPTZ`);
  const ev = (await pool.query(`SELECT * FROM goal_watch WHERE valanga AND ou_tried_at IS NULL AND event_id NOT LIKE 'oa:%'
    AND commence_time BETWEEN to_timestamp($1::double precision / 1000) + INTERVAL '15 minutes' AND to_timestamp($1::double precision / 1000) + INTERVAL '3 hours'`, [nowMs])).rows;
  if (!ev.length) return { thor: 'nessuna Valanga in arrivo' };
  const I = require('./italia');
  const rem = (await pool.query(`SELECT quota_remaining FROM italia_requests WHERE quota_remaining IS NOT NULL ORDER BY id DESC LIMIT 1`)).rows[0];
  if (rem) { const plan = await I.planOf(pool, c, Number(rem.quota_remaining), nowMs); if (Number(rem.quota_remaining) <= plan.reserve + 5) return { thor: 'richieste odss da tenere per le chiusure' }; }
  const failed = new Set((await pool.query(`SELECT note FROM italia_requests WHERE kind = 'ou_valanga' AND note LIKE 'ou:%:0'`)).rows.map(r => r.note.split(':')[1]));
  const market = OU_MARKETS.find(m => !failed.has(m));
  if (!market) return { thor: 'mercato Over/Under non trovato su odss' };
  const books = [...new Set([...c.myBooks, ...c.books])];
  await pool.query(`UPDATE goal_watch SET ou_tried_at = NOW() WHERE event_id = ANY($1)`, [ev.map(r => r.event_id)]);   // una volta sola, anche se va male
  let records;
  try { records = await I.fetchOdds(pool, c, { market, event_id: ev.map(r => r.event_id).join(','), bookmakers: ['pinnacle', ...books].join(',') }, 'ou_valanga', http); }
  catch (e) { await pool.query(`UPDATE italia_requests SET note = $1 WHERE id = (SELECT MAX(id) FROM italia_requests WHERE kind = 'ou_valanga')`, [`ou:${market}:0`]); return { thor: 'errore', mercato: market, errore: e.message }; }
  const totals = parseTotals(records);
  await pool.query(`UPDATE italia_requests SET note = $1 WHERE id = (SELECT MAX(id) FROM italia_requests WHERE kind = 'ou_valanga')`, [`ou:${market}:${totals.size}`]);
  const pin1x2 = new Map(ev.map(r => [r.event_id, { league: r.league, fair: fair1x2(r.pin_h, r.pin_d, r.pin_a) }]));
  const found = findGoalSignals(totals, books, pin1x2, nowMs);
  let nuovi = 0;
  for (const x of found) {
    const r = await pool.query(`INSERT INTO goal_signals (strategy, event_id, league, home, away, commence_time, line, side, book, odd, fair_prob, edge_pct, pin_over, pin_under)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (event_id, strategy, line, side) DO NOTHING`,
      [x.strategy, x.ev.event_id, x.ev.league, x.ev.home, x.ev.away, x.ev.commence_time, x.line, x.side, x.book, x.odd, x.fair_prob, x.edge_pct, x.pin && x.pin.over, x.pin && x.pin.under]);
    nuovi += r.rowCount;
  }
  return { thor: 'letta', mercato: market, partite: ev.length, conQuote: totals.size, nuoviGol: nuovi };
}

/** Parte 2 (spenta finche' OU_ENABLED non e' 'true'): una richiesta Over/Under per scansione, sugli stessi orari. */
async function scanTotals(pool, c, { nowMs = Date.now(), http, merged = [], trio } = {}) {
  if (!c.ouEnabled) return { gol: 'spenti' };
  await ensureGoals(pool);
  const I = require('./italia');
  const books = [...new Set([...c.myBooks, ...c.books])];
  const records = await I.fetchOdds(pool, c, {
    market: c.ouMarket, bookmakers: ['pinnacle', ...books].join(','),
    commence_from: new Date(nowMs + c.minLeadMin * 60000).toISOString(), commence_to: new Date(nowMs + c.windowHours * 3600000).toISOString()
  }, 'scan_ou', http);
  const pin1x2 = new Map();
  for (const r of merged) { const b = (r.bookmakers || []).find(x => x.key === 'pinnacle'), q = b && trio(b.outcomes); if (q) pin1x2.set(r.event_id, { league: r.league, fair: fair1x2(q.home, q.draw, q.away) }); }
  const totals = parseTotals(records), found = findGoalSignals(totals, books, pin1x2, nowMs);
  let nuovi = 0;
  for (const s of found) {
    const r = await pool.query(`INSERT INTO goal_signals (strategy, event_id, league, home, away, commence_time, line, side, book, odd, fair_prob, edge_pct, pin_over, pin_under)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (event_id, strategy, line, side) DO NOTHING`,
      [s.strategy, s.ev.event_id, s.ev.league, s.ev.home, s.ev.away, s.ev.commence_time, s.line, s.side, s.book, s.odd, s.fair_prob, s.edge_pct, s.pin && s.pin.over, s.pin && s.pin.under]);
    nuovi += r.rowCount;
  }
  return { gol: 'fatta', righeOU: records.length, partiteOU: totals.size, nuoviGol: nuovi };
}

/** Prova manuale del formato Over/Under di odss (costa UNA richiesta): quali mercati e campi arrivano. */
async function ouCheck(pool, env = process.env, { http, nowMs = Date.now() } = {}) {
  const I = require('./italia'), c = I.cfg(env);
  if (!c.key) return { ok: false, motivo: 'ODSS_API_KEY non impostata' };
  const records = await I.fetchOdds(pool, c, { market: c.ouMarket, bookmakers: 'pinnacle,snai,888sport_it',
    commence_from: new Date(nowMs + 15 * 60000).toISOString(), commence_to: new Date(nowMs + 12 * 3600000).toISOString() }, 'ou_check', http);
  const markets = {};
  for (const r of records) markets[r.market] = (markets[r.market] || 0) + 1;
  const sample = records[0] ? { campi: Object.keys(records[0]), market: records[0].market, linea: lineOf(records[0]), esiti: records[0].bookmakers && records[0].bookmakers[0] && Object.keys(records[0].bookmakers[0].outcomes || {}) } : null;
  const parsed = parseTotals(records);
  return { ok: true, mercatoChiesto: c.ouMarket, righe: records.length, mercati: markets, esempio: sample, partiteLette: parsed.size,
    linee: [...new Set([...parsed.values()].flatMap(e => Object.keys(e.lines)))].sort() };
}

async function getGoals(pool, env = process.env) {
  await ensureGoals(pool);
  try { await settleGoals(pool); } catch (e) { /* facoltativo */ }
  const c = require('./italia').cfg(env);
  const w = (await pool.query(`SELECT event_id, league, home, away, commence_time, exp_goals, valanga, draw_prob, margin_pct, goals, result_score FROM goal_watch WHERE first_seen >= $1 ORDER BY commence_time DESC`, [RULES.since])).rows;
  const done = w.filter(r => r.goals !== null);
  const band = (lo, hi) => { const s = done.filter(r => r.exp_goals !== null && Number(r.exp_goals) >= lo && Number(r.exp_goals) < hi); return { lo, hi, ...overStats(s.map(r => r.goals)) }; };
  const val = w.filter(r => r.valanga);
  const sig = (await pool.query(`SELECT strategy, line, side, odd, edge_pct, result FROM goal_signals WHERE created_at >= $1`, [RULES.since])).rows;
  const sstat = list => { const s = list.filter(r => r.result); const pnl = s.reduce((a, r) => a + (r.result === 'won' ? 2 * (Number(r.odd) - 1) : -2), 0);
    return { signals: list.length, settled: s.length, won: s.filter(r => r.result === 'won').length, pnlEur: pnl }; };
  let pinOU = null;
  try { pinOU = await require('./ouPinnacle').getPinOU(pool); } catch (e) { /* facoltativo */ }
  return {
    pinOU,
    rules: { since: RULES.since, formula: FORMULA, valanga: VALANGA, gstar: GSTAR }, reference: REFERENCE,
    watched: w.length, settled: done.length, all: overStats(done.map(r => r.goals)),
    formula: [band(0, 2.5), band(2.5, 3), band(3, 99)],
    valanga: { matches: val.length, ...overStats(val.filter(r => r.goals !== null).map(r => r.goals)),
      next: val.filter(r => r.goals === null).slice(0, 5).map(r => ({ match: `${r.home} – ${r.away}`, league: r.league, commence_time: r.commence_time, expGoals: Number(r.exp_goals) })) },
    odds: { enabled: c.ouEnabled, market: c.ouMarket, G: sstat(sig.filter(r => r.strategy === 'G')),
      V: [1.5, 2.5, 3.5].map(L => ({ line: L, ...sstat(sig.filter(r => r.strategy === 'V' && Number(r.line) === L)) })) }
  };
}

module.exports = { valangaOdds, OU_MARKETS, FORMULA, RULES, VALANGA, GSTAR, REFERENCE, fair1x2, expGoals, isValanga, noVig2, goalsOf, sideWon, parseTotals, findGoalSignals, overStats,
  ensureGoals, watch, settleGoals, pendingWatch, setWatchScore, scanTotals, ouCheck, getGoals };
