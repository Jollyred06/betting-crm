/**
 * 🧭 IL BIVIO (22 novembre 2026, idea di Christian: "dimmi tu cosa giocare, 1, X o 2"). Per ogni partita il CRM guarda 1, X e 2
 * alle quote migliori dei miei siti e sceglie UNA giocata: quella che fa crescere di piu' la cassa (crescita attesa con ¼ di Kelly,
 * massimo 2%), che mette insieme probabilita' e quota. 🔒 = quota sotto 2 (si vince spesso), 🎯 = quota 2-3,50 (paga di piu').
 * Sullo storico (86.769 partite 2012-2026, 18 campionati): piu' vinte (41% contro 37%), stessa resa per euro, cassa 250 -> 3.901 €
 * contro 1.902 € della regola di oggi, stesso calo massimo; meglio in tutti e due i periodi. Dal vivo le quote sotto 2 con
 * vantaggio piccolo erano andate male (-28 € su 134): per questo sotto quota 2 serve valore dal 4%. Sulla carta, 2 € fissi.
 */
const { noVigPower } = require('./sharpSignals');
const SINCE = '2026-11-22T00:00:00Z', STAKE = 2, MIN_ODD = 1.25, MAX_ODD = 3.5, MIN_EDGE = 2, MIN_EDGE_LOW = 4, MAX_MARGIN = 8;
const OUT = { home: 'HOME', draw: 'DRAW', away: 'AWAY' }, PICK = { home: '1', draw: 'X', away: '2' };
const T = x => new Date(x).getTime();
let ready = false;
async function ensure(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS bivio_paper (id SERIAL PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, selection TEXT NOT NULL, league TEXT, home TEXT, away TEXT,
    commence_time TIMESTAMPTZ, prob NUMERIC(8,5), book TEXT, odd NUMERIC(8,3), edge_pct NUMERIC(8,3), kelly NUMERIC(8,5), growth NUMERIC(12,8), quotes JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), result TEXT, result_score TEXT, settled_at TIMESTAMPTZ)`);
  ready = true;
}
/** ¼ di Kelly, massimo 2% della cassa; crescita attesa della cassa (logaritmo) puntando quella frazione. */
const kellyOf = (p, o) => Math.min(0.02, 0.25 * (p * o - 1) / (o - 1));
function growthOf(p, o) { const f = kellyOf(p, o); return f > 0 ? p * Math.log(1 + f * (o - 1)) + (1 - p) * Math.log(1 - f) : -1; }

/** Parte pura: per ogni partita la giocata del bivio (o nessuna). */
function pickBivio(merged, books, nowMs = Date.now()) {
  const I = require('./italia'), out = [];
  for (const r of merged || []) {
    const start = T(r.commence_time);
    if (!(start > nowMs + 20 * 60000) || start > nowMs + 48 * 3600000) continue;
    if (I.isNoise(r)) continue;
    const bs = r.bookmakers || [], pinB = bs.find(b => b.key === 'pinnacle'), pin = pinB && I.trio(pinB.outcomes);
    if (!pin) continue;
    const over = 1 / pin.home + 1 / pin.draw + 1 / pin.away; if (over < 1 || (over - 1) * 100 > MAX_MARGIN) continue;   // solo mercati liquidi
    const fair = noVigPower(pin); let best = null;
    for (const sel of ['home', 'draw', 'away']) {
      const quotes = {}; let top = null;
      for (const b of bs) {
        if (!books.includes(b.key) || (b.suspended || []).includes(OUT[sel])) continue;
        const q = I.trio(b.outcomes); if (!q || Math.abs(q[sel] / pin[sel] - 1) > 0.35) continue;
        quotes[b.key] = q[sel]; if (!top || q[sel] > top.odd) top = { book: b.key, odd: q[sel] };
      }
      if (!top || top.odd < MIN_ODD || top.odd > MAX_ODD) continue;
      const p = fair[sel], edgePct = (p * top.odd - 1) * 100;
      if (edgePct < (top.odd < 2 ? MIN_EDGE_LOW : MIN_EDGE)) continue;
      const g = growthOf(p, top.odd);
      if (!best || g > best.growth) best = { event_id: r.event_id, league: r.league, home: r.home_team, away: r.away_team, commence_time: r.commence_time, selection: sel,
        prob: p, book: top.book, odd: top.odd, edgePct, kelly: kellyOf(p, top.odd), growth: g, quotes };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.growth - a.growth);
}

/** Dopo ogni scansione (stessa richiesta): la prima volta che una partita ha una giocata del bivio, si fissa (niente senno di poi). */
async function record(pool, merged, books, nowMs = Date.now()) {
  if (nowMs < T(SINCE)) return 0;
  await ensure(pool); let n = 0;
  for (const s of pickBivio(merged, books, nowMs)) {
    const r = await pool.query(`INSERT INTO bivio_paper (event_id, selection, league, home, away, commence_time, prob, book, odd, edge_pct, kelly, growth, quotes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (event_id) DO NOTHING`,
      [s.event_id, s.selection, s.league, s.home, s.away, s.commence_time, s.prob, s.book, s.odd, s.edgePct, s.kelly, s.growth, JSON.stringify(s.quotes)]);
    n += r.rowCount;
  }
  return n;
}
const resultOf = (sel, score) => { const m = /^(\d+)-(\d+)$/.exec(String(score || '')); if (!m) return null; const o = +m[1] > +m[2] ? 'home' : +m[1] === +m[2] ? 'draw' : 'away'; return o === sel ? 'won' : 'lost'; };
async function settle(pool) {
  await ensure(pool);
  const rows = (await pool.query(`SELECT b.id, b.selection, g.result_score FROM bivio_paper b JOIN goal_watch g ON g.event_id = b.event_id WHERE b.result IS NULL AND g.result_score ~ '^[0-9]+-[0-9]+$'`)).rows;
  for (const r of rows) await pool.query(`UPDATE bivio_paper SET result = $2, result_score = $3, settled_at = NOW() WHERE id = $1`, [r.id, resultOf(r.selection, r.result_score), r.result_score]);
  return rows.length;
}

function tally(list) {
  const done = list.filter(r => r.result === 'won' || r.result === 'lost'), won = done.filter(r => r.result === 'won').length;
  const pnl = done.reduce((a, r) => a + (r.result === 'won' ? STAKE * (r.odd - 1) : -STAKE), 0);
  return { n: list.length, settled: done.length, won, expected: done.reduce((a, r) => a + r.prob, 0), pnl, roiPct: done.length ? 100 * pnl / (STAKE * done.length) : null,
    avgOdd: list.length ? list.reduce((a, r) => a + r.odd, 0) / list.length : null };
}
/** Riepilogo puro: tutte, 🔒 (sotto quota 2) e 🎯 (da 2), e le prossime 24 ore. */
function summarize(rows, nowMs = Date.now()) {
  const BN = require('./italia').BOOK_NAMES || {};
  const all = rows.map(r => ({ ...r, prob: Number(r.prob), odd: Number(r.odd), edgePct: Number(r.edge_pct), kelly: Number(r.kelly) }));
  const next = all.filter(r => T(r.commence_time) > nowMs && T(r.commence_time) < nowMs + 24 * 3600000).sort((a, b) => T(a.commence_time) - T(b.commence_time))
    .map(r => ({ home: r.home, away: r.away, league: r.league, at: r.commence_time, pick: PICK[r.selection], kind: r.odd < 2 ? 'prob' : 'quota', prob: r.prob, book: BN[r.book] || r.book, odd: r.odd, edgePct: r.edgePct, kelly: r.kelly }));
  return { since: SINCE, stake: STAKE, rules: { minOdd: MIN_ODD, maxOdd: MAX_ODD, minEdge: MIN_EDGE, minEdgeLow: MIN_EDGE_LOW, maxMargin: MAX_MARGIN },
    all: tally(all), prob: tally(all.filter(r => r.odd < 2)), quota: tally(all.filter(r => r.odd >= 2)), next,
    recent: all.filter(r => r.result).sort((a, b) => T(b.commence_time) - T(a.commence_time)).slice(0, 10).map(r => ({ home: r.home, away: r.away, at: r.commence_time, pick: PICK[r.selection], odd: r.odd, result: r.result, score: r.result_score })) };
}
async function getBivio(pool, { nowMs = Date.now() } = {}) {
  await ensure(pool);
  return summarize((await pool.query(`SELECT * FROM bivio_paper WHERE commence_time > NOW() - INTERVAL '120 days' ORDER BY commence_time DESC LIMIT 5000`)).rows, nowMs);
}

module.exports = { pickBivio, kellyOf, growthOf, record, settle, summarize, getBivio, resultOf, SINCE };
