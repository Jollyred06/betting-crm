/**
 * 🔒 LE PIU' SICURE SULLA CARTA (20 novembre 2026, chiesto da Christian: "proviamo"). Le partite con il favorito sopra il 70%
 * (Pinnacle senza margine) si indovinano 8-9 volte su 10, ma le quote sono basse. Domanda: giocandole tutte a 2 euro fissi
 * sul sito italiano che paga di piu' tra quelli dove si puo' giocare (MY_BOOKS), si guadagna o si perde? Si registra la quota
 * alla prima lettura (gratis: stessa richiesta della scansione), si chiude con il risultato di goal_watch. Niente soldi veri.
 */
const { noVigPower } = require('./sharpSignals');
const MIN_PROB = 0.70, STAKE = 2, SINCE = '2026-11-21T00:00:00Z';
const OUT = { home: 'HOME', draw: 'DRAW', away: 'AWAY' };
const T = x => new Date(x).getTime();
let ready = false;
async function ensure(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS sicure_paper (id SERIAL PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, league TEXT, home TEXT, away TEXT, commence_time TIMESTAMPTZ,
    selection TEXT NOT NULL, prob NUMERIC(8,5), book TEXT, odd NUMERIC(8,3), quotes JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), result TEXT, result_score TEXT, settled_at TIMESTAMPTZ)`);
  ready = true;
}

/** Parte pura: dalle righe gia' unite con Pinnacle, le partite con il favorito sopra la soglia e la quota migliore tra i miei siti. */
function pickSicure(merged, books, nowMs = Date.now(), { minProb = MIN_PROB, minLeadMin = 20, windowHours = 48 } = {}) {
  const I = require('./italia'), out = [];
  for (const r of merged || []) {
    const start = T(r.commence_time);
    if (!(start > nowMs + minLeadMin * 60000) || start > nowMs + windowHours * 3600000) continue;
    const bs = r.bookmakers || [], pinB = bs.find(b => b.key === 'pinnacle'), pin = pinB && I.trio(pinB.outcomes);
    if (!pin) continue;
    const over = 1 / pin.home + 1 / pin.draw + 1 / pin.away; if (over < 1 || over > 1.12) continue;
    const fair = noVigPower(pin), sel = ['home', 'draw', 'away'].reduce((a, b) => (fair[b] > fair[a] ? b : a), 'home');
    if (fair[sel] < minProb) continue;
    const quotes = {}; let best = null;
    for (const b of bs) {
      if (!books.includes(b.key) || (b.suspended || []).includes(OUT[sel])) continue;
      const q = I.trio(b.outcomes); if (!q || Math.abs(q[sel] / pin[sel] - 1) > 0.35) continue;
      quotes[b.key] = q[sel]; if (!best || q[sel] > best.odd) best = { book: b.key, odd: q[sel] };
    }
    if (!best) continue;
    out.push({ event_id: r.event_id, league: r.league, home: r.home_team, away: r.away_team, commence_time: r.commence_time, selection: sel, prob: fair[sel], book: best.book, odd: best.odd, quotes });
  }
  return out;
}

/** Dopo ogni scansione (nessuna richiesta in piu'). */
async function record(pool, merged, books, nowMs = Date.now()) {
  if (nowMs < T(SINCE)) return 0;
  await ensure(pool); let n = 0;
  for (const s of pickSicure(merged, books, nowMs)) {
    const r = await pool.query(`INSERT INTO sicure_paper (event_id, league, home, away, commence_time, selection, prob, book, odd, quotes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (event_id) DO NOTHING`,
      [s.event_id, s.league, s.home, s.away, s.commence_time, s.selection, s.prob, s.book, s.odd, JSON.stringify(s.quotes)]);
    n += r.rowCount;
  }
  return n;
}
const resultOf = (sel, score) => { const m = /^(\d+)-(\d+)$/.exec(String(score || '')); if (!m) return null; const o = +m[1] > +m[2] ? 'home' : +m[1] === +m[2] ? 'draw' : 'away'; return o === sel ? 'won' : 'lost'; };
async function settle(pool) {
  await ensure(pool);
  const rows = (await pool.query(`SELECT s.id, s.selection, g.result_score FROM sicure_paper s JOIN goal_watch g ON g.event_id = s.event_id WHERE s.result IS NULL AND g.result_score ~ '^[0-9]+-[0-9]+$'`)).rows;
  for (const r of rows) await pool.query(`UPDATE sicure_paper SET result = $2, result_score = $3, settled_at = NOW() WHERE id = $1`, [r.id, resultOf(r.selection, r.result_score), r.result_score]);
  return rows.length;
}

/** Riepilogo puro, a 2 euro fissi. */
function summarize(rows) {
  const done = rows.filter(r => r.result === 'won' || r.result === 'lost'), won = done.filter(r => r.result === 'won').length;
  const pnl = done.reduce((a, r) => a + (r.result === 'won' ? STAKE * (Number(r.odd) - 1) : -STAKE), 0);
  const value = rows.length ? 100 * rows.reduce((a, r) => a + Number(r.odd) * Number(r.prob) - 1, 0) / rows.length : null;
  const avgOdd = rows.length ? rows.reduce((a, r) => a + Number(r.odd), 0) / rows.length : null;
  return { since: SINCE, minProb: MIN_PROB, stake: STAKE, count: rows.length, open: rows.length - done.length, settled: done.length, won,
    expected: done.reduce((a, r) => a + Number(r.prob), 0), pnl, staked: STAKE * done.length, roiPct: done.length ? 100 * pnl / (STAKE * done.length) : null, valuePct: value, avgOdd,
    items: rows.slice(0, 12).map(r => ({ home: r.home, away: r.away, at: r.commence_time, selection: r.selection, prob: Number(r.prob), book: r.book, odd: Number(r.odd), result: r.result, score: r.result_score })) };
}
async function getSicurePaper(pool) {
  await ensure(pool);
  return summarize((await pool.query(`SELECT * FROM sicure_paper ORDER BY commence_time DESC LIMIT 2000`)).rows);
}

module.exports = { pickSicure, record, settle, summarize, getSicurePaper, resultOf, MIN_PROB, STAKE, SINCE };
