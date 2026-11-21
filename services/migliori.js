/**
 * 🏆 LE MIGLIORI DEL GIORNO (20 novembre 2026, chiesto da Christian: "l'IA tra le tante partite dovrebbe selezionare le migliori").
 * Mette insieme le due cose che finora erano separate: la FIDUCIA (le piu' sicure vincono tanto ma pagano poco) e il VALORE
 * (le stelle guadagnano ma vincono meno). Candidate: esito con probabilita' vera almeno 50% che un sito dove si puo' giocare
 * (MY_BOOKS) paga almeno il giusto. Punteggio = valore % + fiducia + il "quadro buono" visto nel backup del 20/11
 * (favorita in casa, campionato serio, quota ferma dalla prima lettura). Ogni giorno valgono le 5 con il punteggio piu' alto,
 * calcolato quando la partita e' stata vista (niente senno di poi). Sulla carta, 2 euro fissi: si gioca solo se regge.
 * Si misura anche ogni ingrediente, cosi' si vede quale aiuta davvero e i pesi si possono correggere con i numeri.
 */
const { noVigPower } = require('./sharpSignals');
const SINCE = '2026-11-21T00:00:00Z', STAKE = 2, PER_DAY = 5, MIN_PROB = 0.5, MIN_ODD = 1.3, MIN_EDGE = 0, MAX_MARGIN = 8;
const OUT = { home: 'HOME', draw: 'DRAW', away: 'AWAY' }, PICK = { home: '1', draw: 'X', away: '2' };
const T = x => new Date(x).getTime();
const ROME_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = t => ROME_DAY.format(new Date(t));
let ready = false;
async function ensure(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS migliori_paper (id SERIAL PRIMARY KEY, event_id TEXT NOT NULL, selection TEXT NOT NULL, league TEXT, home TEXT, away TEXT,
    commence_time TIMESTAMPTZ, prob NUMERIC(8,5), book TEXT, odd NUMERIC(8,3), edge_pct NUMERIC(8,3), margin_pct NUMERIC(8,3), is_home BOOLEAN, is_major BOOLEAN,
    moved_pts NUMERIC(8,3), score NUMERIC(8,3), quotes JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), result TEXT, result_score TEXT, settled_at TIMESTAMPTZ, UNIQUE (event_id, selection))`);
  ready = true;
}

/** Punteggio: valore in punti percentuali + fiducia (20 punti ogni 100% sopra il 50%) + 1 per ogni elemento del quadro buono. */
function scoreOf({ edgePct, prob, isHome, isMajor, movedPts }) {
  const stable = movedPts !== null && movedPts !== undefined && Math.abs(movedPts) < 2;
  return edgePct + 20 * (prob - 0.5) + (isHome ? 1 : 0) + (isMajor ? 1 : 0) + (stable ? 1 : 0);
}
function reasonsOf(x) {
  const r = [`sicura al ${Math.round(100 * x.prob)}%`, `paga ${x.edgePct >= 0 ? '+' : ''}${x.edgePct.toFixed(1).replace('.', ',')}%`];
  if (x.isHome) r.push('in casa'); if (x.isMajor) r.push('campionato serio');
  if (x.movedPts !== null && x.movedPts !== undefined) r.push(Math.abs(x.movedPts) < 2 ? 'quota ferma' : x.movedPts > 0 ? 'quota in calo' : 'quota in salita');
  return r;
}

/** Parte pura: le candidate di una lettura. firstPin: Map event_id -> {pin_h,pin_d,pin_a} della prima lettura. */
function pickMigliori(merged, books, nowMs = Date.now(), firstPin = new Map(), { minProb = MIN_PROB } = {}) {
  const I = require('./italia'), out = [];
  for (const r of merged || []) {
    const start = T(r.commence_time);
    if (!(start > nowMs + 20 * 60000) || start > nowMs + 48 * 3600000) continue;
    if (I.isNoise(r)) continue;   // 21/11: giovanili, femminili, riserve, amichevoli (anche per la scalata, che usa queste candidate)
    const bs = r.bookmakers || [], pinB = bs.find(b => b.key === 'pinnacle'), pin = pinB && I.trio(pinB.outcomes);
    if (!pin) continue;
    const over = 1 / pin.home + 1 / pin.draw + 1 / pin.away, margin = (over - 1) * 100;
    if (over < 1 || margin > MAX_MARGIN) continue;
    const fair = noVigPower(pin), f0 = firstPin.get(r.event_id), first = f0 && I.trio({ HOME: f0.pin_h, DRAW: f0.pin_d, AWAY: f0.pin_a }), pf = first ? noVigPower(first) : null;
    for (const sel of ['home', 'draw', 'away']) {
      const prob = fair[sel]; if (prob < minProb) continue;
      const isFav = ['home', 'draw', 'away'].every(o => fair[o] <= prob);   // l'esito e' anche il favorito (come il pronostico IA)
      const quotes = {}; let best = null;
      for (const b of bs) {
        if (!books.includes(b.key) || (b.suspended || []).includes(OUT[sel])) continue;
        const q = I.trio(b.outcomes); if (!q || Math.abs(q[sel] / pin[sel] - 1) > 0.35) continue;
        quotes[b.key] = q[sel]; if (!best || q[sel] > best.odd) best = { book: b.key, odd: q[sel] };
      }
      if (!best || best.odd < MIN_ODD) continue;
      const edgePct = (best.odd * prob - 1) * 100; if (edgePct < MIN_EDGE) continue;
      const x = { event_id: r.event_id, league: r.league, home: r.home_team, away: r.away_team, commence_time: r.commence_time, selection: sel, prob, book: best.book, odd: best.odd,
        edgePct, margin, isFav, isHome: sel === 'home', isMajor: margin < 6, movedPts: pf ? 100 * (prob - pf[sel]) : null, quotes };
      out.push({ ...x, score: scoreOf(x) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

async function record(pool, merged, books, nowMs = Date.now()) {
  if (nowMs < T(SINCE)) return 0;
  await ensure(pool);
  const ids = [...new Set((merged || []).map(r => r.event_id))], firstPin = new Map();
  if (ids.length) for (const f of (await pool.query(`SELECT DISTINCT ON (event_id) event_id, pin_h, pin_d, pin_a FROM pin_history WHERE event_id = ANY($1) ORDER BY event_id, at`, [ids]).catch(() => ({ rows: [] }))).rows) firstPin.set(f.event_id, f);
  let n = 0;
  for (const s of pickMigliori(merged, books, nowMs, firstPin)) {
    const r = await pool.query(`INSERT INTO migliori_paper (event_id, selection, league, home, away, commence_time, prob, book, odd, edge_pct, margin_pct, is_home, is_major, moved_pts, score, quotes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (event_id, selection) DO NOTHING`,
      [s.event_id, s.selection, s.league, s.home, s.away, s.commence_time, s.prob, s.book, s.odd, s.edgePct, s.margin, s.isHome, s.isMajor, s.movedPts, s.score, JSON.stringify(s.quotes)]);
    n += r.rowCount;
  }
  return n;
}
const resultOf = (sel, score) => { const m = /^(\d+)-(\d+)$/.exec(String(score || '')); if (!m) return null; const o = +m[1] > +m[2] ? 'home' : +m[1] === +m[2] ? 'draw' : 'away'; return o === sel ? 'won' : 'lost'; };
async function settle(pool) {
  await ensure(pool);
  const rows = (await pool.query(`SELECT m.id, m.selection, g.result_score FROM migliori_paper m JOIN goal_watch g ON g.event_id = m.event_id WHERE m.result IS NULL AND g.result_score ~ '^[0-9]+-[0-9]+$'`)).rows;
  for (const r of rows) await pool.query(`UPDATE migliori_paper SET result = $2, result_score = $3, settled_at = NOW() WHERE id = $1`, [r.id, resultOf(r.selection, r.result_score), r.result_score]);
  return rows.length;
}

const norm = r => ({ ...r, prob: Number(r.prob), odd: Number(r.odd), edgePct: Number(r.edge_pct), score: Number(r.score), isHome: !!r.is_home, isMajor: !!r.is_major,
  movedPts: r.moved_pts === null || r.moved_pts === undefined ? null : Number(r.moved_pts) });
/** Le 5 migliori di ogni giorno (giorno della partita, ora italiana): una partita conta una volta sola (l'esito col punteggio piu' alto). */
function topPerDay(rows, perDay = PER_DAY) {
  const byDay = new Map();
  for (const r of rows.map(norm)) { const d = dayOf(r.commence_time); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); }
  const out = [];
  for (const list of byDay.values()) { const seen = new Set(); for (const r of list.sort((a, b) => b.score - a.score)) { if (seen.has(r.event_id)) continue; seen.add(r.event_id); out.push(r); if (seen.size >= perDay) break; } }
  return out;
}
function tally(list) {
  const done = list.filter(r => r.result === 'won' || r.result === 'lost'), won = done.filter(r => r.result === 'won').length;
  const pnl = done.reduce((a, r) => a + (r.result === 'won' ? STAKE * (r.odd - 1) : -STAKE), 0);
  return { n: list.length, settled: done.length, won, expected: done.reduce((a, r) => a + r.prob, 0), pnl, roiPct: done.length ? 100 * pnl / (STAKE * done.length) : null,
    avgOdd: list.length ? list.reduce((a, r) => a + r.odd, 0) / list.length : null };
}
/** Riepilogo puro: le 5 del giorno, tutte le candidate, e ogni ingrediente misurato da solo (sulle candidate chiuse). */
function summarize(rows, nowMs = Date.now()) {
  const all = rows.map(norm), top = topPerDay(rows);
  const parts = { casa: [r => r.isHome, r => !r.isHome], serio: [r => r.isMajor, r => !r.isMajor], ferma: [r => r.movedPts !== null && Math.abs(r.movedPts) < 2, r => r.movedPts !== null && Math.abs(r.movedPts) >= 2],
    valore: [r => r.edgePct >= 3, r => r.edgePct < 3], fiducia: [r => r.prob >= 0.65, r => r.prob < 0.65] };
  const ingredients = Object.fromEntries(Object.entries(parts).map(([k, [yes, no]]) => [k, { si: tally(all.filter(yes)), no: tally(all.filter(no)) }]));
  const upcomingDay = new Map();
  for (const r of all.filter(r => T(r.commence_time) > nowMs && T(r.commence_time) < nowMs + 24 * 3600000).sort((a, b) => b.score - a.score)) if (!upcomingDay.has(r.event_id)) upcomingDay.set(r.event_id, r);
  const next = [...upcomingDay.values()].slice(0, PER_DAY).map(r => ({ home: r.home, away: r.away, league: r.league, at: r.commence_time, pick: PICK[r.selection], prob: r.prob, book: (require('./italia').BOOK_NAMES || {})[r.book] || r.book, odd: r.odd, edgePct: r.edgePct, score: r.score, reasons: reasonsOf(r) }));
  return { since: SINCE, perDay: PER_DAY, stake: STAKE, top: tally(top), all: tally(all), ingredients, next,
    recent: top.filter(r => r.result).sort((a, b) => T(b.commence_time) - T(a.commence_time)).slice(0, 10).map(r => ({ home: r.home, away: r.away, at: r.commence_time, pick: PICK[r.selection], odd: r.odd, result: r.result, score: r.result_score })) };
}
async function getMigliori(pool, { nowMs = Date.now() } = {}) {
  await ensure(pool);
  return summarize((await pool.query(`SELECT * FROM migliori_paper WHERE commence_time > NOW() - INTERVAL '90 days' ORDER BY commence_time DESC LIMIT 5000`)).rows, nowMs);
}

module.exports = { pickMigliori, scoreOf, reasonsOf, record, settle, topPerDay, tally, summarize, getMigliori, resultOf, SINCE, PER_DAY };
