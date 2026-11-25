'use strict';
/**
 * 🤝 TUTTI D'ACCORDO (25/11/2026, idea di Christian): partite con una buona quota dove la giocata, Pinnacle (prima lettura) e
 * l'IA dicono la stessa cosa. Sull'archivio (520 segnali, 31 giorni): d'accordo +4,8% contro la chiusura, gli altri +2,6%;
 * sotto quota 1,60 non conviene. Per ora SOLO SULLA CARTA (1 € a partita): dopo 2-3 settimane, se regge, si mette in campo.
 * Si registra quando getItalia vede la partita (prima del calcio d'inizio); il risultato arriva da goal_watch, il valore
 * alla chiusura dal segnale.
 */
const SINCE = '2026-11-25T00:00:00Z', STAKE = 1, MIN_ODD = 1.6;
const PICK = { home: '1', draw: 'X', away: '2' };
const T = x => Date.parse(x) || 0;

let ensured = false;
async function ensure(pool) {
  if (ensured) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS concordi_paper (
    id SERIAL PRIMARY KEY, signal_id INTEGER, event_id TEXT UNIQUE, selection TEXT, league TEXT, home TEXT, away TEXT,
    commence_time TIMESTAMPTZ, book TEXT, odd NUMERIC, edge_pct NUMERIC, prob NUMERIC, ai_prob NUMERIC,
    result TEXT, result_score TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), settled_at TIMESTAMPTZ)`);
  ensured = true;
}

/** Puro: dalle righe di getItalia (con guess e play) quelle "tutti d'accordo" ancora da giocare. */
function pickConcordi(items, nowMs = Date.now()) {
  return (items || []).filter(r => r && r.guess && r.guess.ai && r.play && T(r.commence_time) > nowMs
    && r.pick === r.guess.pick && r.pick === r.guess.ai.pick && Number(r.play.odd) >= MIN_ODD && Number(r.edge_pct) > 0);
}

/** Registra (una volta per partita) le nuove "d'accordo". Non blocca mai la pagina. */
async function record(pool, items, nowMs = Date.now()) {
  if (Date.now() < T(SINCE)) return 0;
  await ensure(pool); let n = 0;
  for (const r of pickConcordi(items, nowMs)) {
    const q = await pool.query(`INSERT INTO concordi_paper (signal_id, event_id, selection, league, home, away, commence_time, book, odd, edge_pct, prob, ai_prob)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (event_id) DO NOTHING`,
      [r.id, r.event_id, r.selection, r.league, r.home, r.away, r.commence_time, r.play.book, r.play.odd, r.edge_pct, r.win_prob || r.guess.prob, r.guess.ai.prob]);
    n += q.rowCount;
  }
  return n;
}

const resultOf = (sel, score) => { const m = /^(\d+)-(\d+)$/.exec(String(score || '')); if (!m) return null; const o = +m[1] > +m[2] ? 'home' : +m[1] === +m[2] ? 'draw' : 'away'; return o === sel ? 'won' : 'lost'; };

function summarize(rows, nowMs = Date.now()) {
  const all = rows.map(r => ({ ...r, odd: Number(r.odd), prob: Number(r.prob), clv: r.clv_pct == null ? null : Number(r.clv_pct) }));
  const done = all.filter(r => r.result === 'won' || r.result === 'lost'), won = done.filter(r => r.result === 'won').length;
  const pnl = done.reduce((a, r) => a + (r.result === 'won' ? STAKE * (r.odd - 1) : -STAKE), 0), clv = all.filter(r => r.clv !== null);
  return { since: SINCE, stake: STAKE, minOdd: MIN_ODD, n: all.length, settled: done.length, won, expected: done.reduce((a, r) => a + (r.prob || 0), 0), pnlEur: pnl,
    avgClvPct: clv.length ? clv.reduce((a, r) => a + r.clv, 0) / clv.length : null, measured: clv.length,
    next: all.filter(r => T(r.commence_time) > nowMs).sort((a, b) => T(a.commence_time) - T(b.commence_time)).slice(0, 10)
      .map(r => ({ home: r.home, away: r.away, at: r.commence_time, pick: PICK[r.selection], odd: r.odd, book: r.book })),
    recent: done.sort((a, b) => T(b.commence_time) - T(a.commence_time)).slice(0, 8).map(r => ({ home: r.home, away: r.away, at: r.commence_time, pick: PICK[r.selection], odd: r.odd, result: r.result, score: r.result_score })) };
}

async function getConcordi(pool, { nowMs = Date.now() } = {}) {
  await ensure(pool);
  // risultati: dalla lista partite viste (come il Bivio)
  const open = (await pool.query(`SELECT c.id, c.selection, g.result_score FROM concordi_paper c JOIN goal_watch g ON g.event_id = c.event_id WHERE c.result IS NULL AND g.result_score ~ '^[0-9]+-[0-9]+$'`)).rows;
  for (const r of open) await pool.query(`UPDATE concordi_paper SET result = $2, result_score = $3, settled_at = NOW() WHERE id = $1`, [r.id, resultOf(r.selection, r.result_score), r.result_score]);
  const rows = (await pool.query(`SELECT c.*, s.clv_pct FROM concordi_paper c LEFT JOIN italia_signals s ON s.id = c.signal_id ORDER BY c.commence_time DESC LIMIT 3000`)).rows;
  return summarize(rows, nowMs);
}

module.exports = { pickConcordi, record, summarize, getConcordi, resultOf, SINCE, MIN_ODD };
