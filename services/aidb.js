'use strict';
/**
 * 🧬 BANCA DATI IA (28/11/2026, richiesta di Christian): una scheda per ogni partita che il CRM vede (una per esito proposto),
 * con la "fotografia" al momento del segnale (quota, vantaggio, Pinnacle, IA, accordo, favorita, mercato, ore prima, coppa,
 * canone / piano B / svago) e poi il risultato e il valore alla chiusura. Serve a capire come sono fatte le partite BUONE
 * (valore alla chiusura positivo) e OTTIME (buone e vinte), per insegnare all'IA e scegliere le prossime regole.
 * Non cambia nessuna puntata: solo raccolta e lettura. Lo storico prima del 28/11 viene ricostruito dai segnali (senza IA,
 * perché il pronostico dell'IA di allora non era salvato).
 */
const T = x => Date.parse(x) || 0;
const PICK = { home: '1', draw: 'X', away: '2' };
const SEL = { 1: 'home', X: 'draw', 2: 'away' };

let ensured = false; const seen = new Set();
async function ensure(pool) {
  if (ensured) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_db (
    id SERIAL PRIMARY KEY, event_id TEXT NOT NULL, selection TEXT NOT NULL, signal_id INTEGER, source TEXT DEFAULT 'live',
    league TEXT, home TEXT, away TEXT, commence_time TIMESTAMPTZ, seen_at TIMESTAMPTZ DEFAULT NOW(), hours_before NUMERIC,
    book TEXT, odd NUMERIC, min_odd NUMERIC, edge_pct NUMERIC, win_prob NUMERIC, pin_pick TEXT, ai_pick TEXT, ai_prob NUMERIC,
    is_fav BOOLEAN, is_draw BOOLEAN, agree_ai BOOLEAN, agree_pin BOOLEAN, cup BOOLEAN, market_dir TEXT, my_books INTEGER,
    canon BOOLEAN, plan_b BOOLEAN, best BOOLEAN, svago BOOLEAN, result TEXT, result_score TEXT, settled_at TIMESTAMPTZ,
    UNIQUE (event_id, selection))`);
  ensured = true;
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM ai_db');
  if (!rows[0].n) await backfill(pool).catch(e => console.warn('aidb backfill:', e.message));
}

const favOf = (h, d, a) => { h = Number(h); d = Number(d); a = Number(a); if (!(h > 1 && d > 1 && a > 1)) return null; return h <= d && h <= a ? 'home' : a <= d ? 'away' : 'draw'; };
const cupRe = /cup|copa|coppa|pokal|ta[cç]a|coupe|trophy|shield|beker|kupa/i;

/** Storico: la prima lettura di ogni segnale (strategia I) diventa una scheda, senza IA. Una sola volta, a tabella vuota. */
async function backfill(pool) {
  const { rows } = await pool.query(`SELECT DISTINCT ON (event_id, selection) id, event_id, selection, league, home, away, commence_time, created_at,
      book, odd, NULL::numeric AS min_odd, edge_pct, fair_prob, pin_h, pin_d, pin_a FROM italia_signals WHERE strategy = 'I' AND pin_h IS NOT NULL ORDER BY event_id, selection, created_at`);
  for (const r of rows) {
    const fav = favOf(r.pin_h, r.pin_d, r.pin_a);
    await pool.query(`INSERT INTO ai_db (event_id, selection, signal_id, source, league, home, away, commence_time, seen_at, hours_before, book, odd, min_odd, edge_pct, win_prob, pin_pick, is_fav, is_draw, agree_pin, cup, canon)
      VALUES ($1,$2,$3,'storico',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (event_id, selection) DO NOTHING`,
      [r.event_id, r.selection, r.id, r.league, r.home, r.away, r.commence_time, r.created_at, (T(r.commence_time) - T(r.created_at)) / 36e5, r.book, r.odd, r.min_odd, r.edge_pct, r.fair_prob,
        fav ? PICK[fav] : null, fav === r.selection, r.selection === 'draw', fav === r.selection, cupRe.test(r.league || ''),
        fav === r.selection && r.selection !== 'draw' && Number(r.odd) <= 3 && Number(r.edge_pct) >= 5]);
  }
  return rows.length;
}

/** Puro: la fotografia di una scheda di getItalia. */
function snapshot(r, { best = new Set(), cup = false, nowMs = Date.now() } = {}) {
  const g = r.guess || {}, ai = g.ai || null, odd = r.play ? Number(r.play.odd) : Number(r.odd), sel = r.selection || SEL[r.pick];
  return { event_id: r.event_id, selection: sel, signal_id: r.id, league: r.league, home: r.home, away: r.away, commence_time: r.commence_time,
    hours_before: (T(r.commence_time) - nowMs) / 36e5, book: r.play ? r.play.book : r.book, odd, min_odd: r.min_odd == null ? null : Number(r.min_odd),
    edge_pct: r.edge_pct == null ? null : Number(r.edge_pct), win_prob: r.win_prob == null ? null : Number(r.win_prob), pin_pick: g.pick || null,
    ai_pick: ai ? ai.pick : null, ai_prob: ai ? ai.prob : null, is_fav: g.pick ? g.pick === r.pick : null, is_draw: r.pick === 'X',
    agree_ai: ai ? ai.pick === r.pick : null, agree_pin: g.pick ? g.pick === r.pick : null, cup: !!cup, market_dir: r.market ? r.market.dir || null : null,
    my_books: r.alt ? Object.keys(r.alt).length : null, canon: !!(g.pick && g.pick === r.pick && r.pick !== 'X' && odd <= 3 && Number(r.edge_pct) >= 5),
    plan_b: !!r.planB, best: best.has(r.id), svago: !!r.svago };
}

/** Registra le schede nuove (una volta per partita ed esito, prima del calcio d'inizio). Non blocca mai la pagina. */
async function record(pool, items, { best = [], cupOf = () => false, nowMs = Date.now() } = {}) {
  await ensure(pool); const bs = new Set(best); let n = 0;
  for (const r of items || []) {
    if (!r || !r.event_id || !r.guess || T(r.commence_time) <= nowMs) continue;
    const k = r.event_id + '|' + (r.selection || SEL[r.pick]); if (seen.has(k)) continue;
    const s = snapshot(r, { best: bs, cup: cupOf(r), nowMs }), cols = Object.keys(s);
    const q = await pool.query(`INSERT INTO ai_db (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})
      ON CONFLICT (event_id, selection) DO UPDATE SET best = ai_db.best OR EXCLUDED.best, plan_b = ai_db.plan_b OR EXCLUDED.plan_b, svago = ai_db.svago OR EXCLUDED.svago,
        ai_pick = COALESCE(ai_db.ai_pick, EXCLUDED.ai_pick), ai_prob = COALESCE(ai_db.ai_prob, EXCLUDED.ai_prob), agree_ai = COALESCE(ai_db.agree_ai, EXCLUDED.agree_ai)`, cols.map(c => s[c]));
    seen.add(k); n += q.rowCount;
  }
  return n;
}

const resultOf = (sel, score) => { const m = /^(\d+)-(\d+)$/.exec(String(score || '')); if (!m) return null; const o = +m[1] > +m[2] ? 'home' : +m[1] === +m[2] ? 'draw' : 'away'; return o === sel ? 'won' : 'lost'; };

/** Puro: profilo delle partite buone (valore alla chiusura > 0) e ottime (buone e vinte), per caratteristica. */
function summarize(rows) {
  const all = rows.map(r => ({ ...r, odd: Number(r.odd), edge: Number(r.edge_pct), p: Number(r.win_prob) || null, clv: r.clv_pct == null ? null : Number(r.clv_pct), h: Number(r.hours_before) }));
  const done = all.filter(r => r.result === 'won' || r.result === 'lost');
  const grp = (label, f) => {
    const a = all.filter(f), d = done.filter(f), c = a.filter(r => r.clv !== null), w = d.filter(r => r.result === 'won').length;
    const good = c.filter(r => r.clv > 0), top = d.filter(r => r.clv !== null && r.clv > 0 && r.result === 'won');
    const pnl = d.reduce((s, r) => s + (r.result === 'won' ? r.odd - 1 : -1), 0);
    return { label, n: a.length, settled: d.length, won: w, expected: d.reduce((s, r) => s + (r.p || 0), 0), roiPct: d.length ? 100 * pnl / d.length : null,
      measured: c.length, avgClvPct: c.length ? c.reduce((s, r) => s + r.clv, 0) / c.length : null, goodPct: c.length ? 100 * good.length / c.length : null,
      topPct: d.length ? 100 * top.length / d.length : null };
  };
  const groups = [
    ['Tutte', () => true],
    ['⭐ Canone (favorita, no X, vantaggio 5%+, quota ≤3)', r => r.canon],
    ['🅱️ Piano B', r => r.plan_b], ['🎈 Svago', r => r.svago],
    ['Favorita di Pinnacle', r => r.is_fav === true], ['Non favorita', r => r.is_fav === false && !r.is_draw], ['Pareggio', r => r.is_draw],
    ['🤝 IA e Pinnacle d\'accordo', r => r.agree_ai === true && r.agree_pin === true], ['Solo IA d\'accordo', r => r.agree_ai === true && r.agree_pin === false],
    ['Solo Pinnacle d\'accordo', r => r.agree_ai === false && r.agree_pin === true], ['Nessuno d\'accordo', r => r.agree_ai === false && r.agree_pin === false],
    ['Quota 1,60–2', r => r.odd >= 1.6 && r.odd < 2], ['Quota 2–3', r => r.odd >= 2 && r.odd <= 3], ['Quota 3–4', r => r.odd > 3 && r.odd <= 4], ['Quota oltre 4', r => r.odd > 4],
    ['Vantaggio 2–5%', r => r.edge >= 2 && r.edge < 5], ['Vantaggio 5–8%', r => r.edge >= 5 && r.edge < 8], ['Vantaggio 8–12%', r => r.edge >= 8 && r.edge < 12], ['Vantaggio 12%+', r => r.edge >= 12],
    ['📈 Mercato a favore', r => r.market_dir === 'con'], ['📉 Mercato contro', r => r.market_dir === 'contro'],
    ['Meno di 6 ore prima', r => r.h < 6], ['6–24 ore prima', r => r.h >= 6 && r.h < 24], ['Più di 24 ore prima', r => r.h >= 24],
    ['🏆 Coppe', r => r.cup], ['Campionati', r => !r.cup],
  ];
  const profile = groups.map(([l, f]) => grp(l, f)).filter(g => g.n > 0);
  // identikit: come sono fatte le ottime rispetto a tutte (solo partite chiuse e misurate)
  const meas = done.filter(r => r.clv !== null), tops = meas.filter(r => r.clv > 0 && r.result === 'won');
  const share = (a, f) => a.length ? 100 * a.filter(f).length / a.length : null, avg = (a, f) => a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : null;
  const ident = (f, l) => ({ label: l, top: share(tops, f), all: share(meas, f) });
  const identikit = tops.length ? [
    ident(r => r.is_fav === true && !r.is_draw, 'favorita (non pareggio)'), ...(meas.some(r => r.agree_ai !== null) ? [{ label: 'IA e Pinnacle d\'accordo (dal 28/11)', top: share(tops.filter(r => r.agree_ai !== null), r => r.agree_ai && r.agree_pin), all: share(meas.filter(r => r.agree_ai !== null), r => r.agree_ai && r.agree_pin) }] : []),
    ident(r => r.odd >= 2 && r.odd <= 3, 'quota 2–3'), ident(r => r.edge >= 8 && r.edge < 12, 'vantaggio 8–12%'), ident(r => r.h < 6, 'meno di 6 ore prima'), ident(r => r.cup, 'coppa'),
    { label: 'quota media', top: avg(tops, r => r.odd), all: avg(meas, r => r.odd), num: true }, { label: 'vantaggio medio %', top: avg(tops, r => r.edge), all: avg(meas, r => r.edge), num: true },
  ] : [];
  return { since: all.reduce((m, r) => !m || T(r.seen_at) < T(m) ? r.seen_at : m, null), n: all.length, live: all.filter(r => r.source === 'live').length, settled: done.length,
    measured: meas.length, ottime: tops.length, profile, identikit };
}

async function getAidb(pool) {
  await ensure(pool);
  // risultati: dalle partite viste (goal_watch), come Bivio e Tutti d'accordo; poi quelli già scritti nei segnali
  const open = (await pool.query(`SELECT a.id, a.selection, g.result_score FROM ai_db a JOIN goal_watch g ON g.event_id = a.event_id WHERE a.result IS NULL AND g.result_score ~ '^[0-9]+-[0-9]+$'`)).rows;
  for (const r of open) await pool.query('UPDATE ai_db SET result = $2, result_score = $3, settled_at = NOW() WHERE id = $1', [r.id, resultOf(r.selection, r.result_score), r.result_score]);
  await pool.query(`UPDATE ai_db a SET result = s.result, result_score = s.result_score, settled_at = NOW() FROM italia_signals s
    WHERE a.result IS NULL AND s.id = a.signal_id AND s.result IN ('won','lost','void')`).catch(() => null);
  const rows = (await pool.query(`SELECT a.*, (SELECT s2.clv_pct FROM italia_signals s2 WHERE s2.event_id = a.event_id AND s2.selection = a.selection AND s2.clv_pct IS NOT NULL ORDER BY s2.created_at LIMIT 1) AS clv_pct
    FROM ai_db a ORDER BY a.commence_time DESC LIMIT 20000`)).rows;
  return summarize(rows);
}

module.exports = { ensure, backfill, snapshot, record, summarize, getAidb, resultOf };
