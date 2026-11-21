/**
 * 🪜 SCALATA (martingala con il freno) e 📈 CASSA KELLY (21 novembre 2026, chiesto da Christian).
 * Obiettivo dichiarato: "perdere pochi soldi e aumentare il profitto".
 *
 * SCALATA — una giocata al giorno, partenza 0,20 euro, raddoppio dopo ogni persa, FRENO A 10 (perdita massima 204,60 euro),
 * poi si riparte da 0,20. Sullo storico (14 stagioni, cassa 500): +701 euro, 2 anni in perdita su 14, serie peggiore 10.
 * La partita del giorno e' scelta per perdere il meno possibile: solo giocate PAGATE PIU' DEL GIUSTO (almeno +2%) su un sito
 * dove si puo' giocare, quota 2,00-3,50 (sotto 2 il raddoppio non recupera), e tra queste la PIU' PROBABILE, con un piccolo
 * premio se e' anche il favorito (pronostico IA d'accordo: valore +4,6% contro +3,0%), in casa (+6,9% sullo storico),
 * campionato serio e quota ferma. La giocata del giorno si fissa alla prima scansione che la trova e non cambia piu'.
 *
 * CASSA KELLY — la cassa che Christian dichiara (salvata nel database): la puntata di ogni ⭐ = cassa x 1/4 Kelly, massimo 2%.
 */
const BASE = 0.2, STOP = 10, MIN_ODD = 2, MAX_ODD = 3.5, MIN_EDGE = 2, SINCE = '2026-11-22T00:00:00Z';
const PICK = { home: '1', draw: 'X', away: '2' };
const T = x => new Date(x).getTime();
const ROME_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = t => ROME_DAY.format(new Date(t));
let ready = false;
async function ensure(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS scalata_picks (id SERIAL PRIMARY KEY, day TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL, selection TEXT NOT NULL,
    league TEXT, home TEXT, away TEXT, commence_time TIMESTAMPTZ, prob NUMERIC(8,5), book TEXT, odd NUMERIC(8,3), edge_pct NUMERIC(8,3), score NUMERIC(8,3), reasons JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), result TEXT, result_score TEXT, settled_at TIMESTAMPTZ)`);
  // 21/11: le quote di tutti i miei siti, per giocare dove la puntata minima lo permette (Eurobet 1 euro, Goldbet 0,10)
  await pool.query(`ALTER TABLE scalata_picks ADD COLUMN IF NOT EXISTS quotes JSONB`);
  ready = true;
}

/** Punteggio della scalata: probabilita' prima di tutto (meno serie storte), poi i premi. */
function ladderScore(x) {
  const fav = x.isFav ? 2 : 0;
  return 100 * x.prob + fav + (x.isHome ? 1 : 0) + (x.isMajor ? 1 : 0) + (x.movedPts !== null && x.movedPts !== undefined && Math.abs(x.movedPts) < 2 ? 1 : 0) + Math.min(x.edgePct, 8) / 4;
}
/** Parte pura: le candidate di una lettura (riusa le candidate delle Migliori, che hanno gia' fiducia, valore e quadro). */
function pickScalata(cands) {
  return (cands || []).filter(x => x.odd >= MIN_ODD && x.odd <= MAX_ODD && x.edgePct >= MIN_EDGE)
    .map(x => ({ ...x, score: ladderScore(x) })).sort((a, b) => b.score - a.score);
}
function reasonsOf(x) {
  const r = [`vince il ${Math.round(100 * x.prob)}%`, `paga +${x.edgePct.toFixed(1).replace('.', ',')}% più del giusto`];
  if (x.isFav) r.push('🤝 favorita (IA d\'accordo)'); if (x.isHome) r.push('in casa'); if (x.isMajor) r.push('campionato serio');
  if (x.movedPts !== null && x.movedPts !== undefined && Math.abs(x.movedPts) < 2) r.push('quota ferma');
  return r;
}

/** Dopo ogni scansione: se per un giorno non c'e' ancora la giocata, si fissa la migliore candidata di quel giorno. */
async function record(pool, merged, books, nowMs = Date.now()) {
  if (nowMs < T(SINCE)) return 0;
  await ensure(pool);
  const M = require('./migliori');
  const ids = [...new Set((merged || []).map(r => r.event_id))], firstPin = new Map();
  if (ids.length) for (const f of (await pool.query(`SELECT DISTINCT ON (event_id) event_id, pin_h, pin_d, pin_a FROM pin_history WHERE event_id = ANY($1) ORDER BY event_id, at`, [ids]).catch(() => ({ rows: [] }))).rows) firstPin.set(f.event_id, f);
  // candidate: tutte le giocate di valore (le Migliori chiedono almeno il 50%, la scalata no: quota 2-3,50 = 29-50%)
  const cands = M.pickMigliori(merged, books, nowMs, firstPin, { minProb: 0.25 });
  const taken = new Set((await pool.query(`SELECT day FROM scalata_picks WHERE day >= $1`, [dayOf(nowMs)])).rows.map(r => r.day));
  const best = new Map();
  for (const x of pickScalata(cands)) { const d = dayOf(x.commence_time); if (taken.has(d) || best.has(d) || T(x.commence_time) < nowMs + 30 * 60000) continue; best.set(d, x); }
  let n = 0;
  for (const [d, x] of best) {
    const r = await pool.query(`INSERT INTO scalata_picks (day, event_id, selection, league, home, away, commence_time, prob, book, odd, edge_pct, score, reasons, quotes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (day) DO NOTHING`,
      [d, x.event_id, x.selection, x.league, x.home, x.away, x.commence_time, x.prob, x.book, x.odd, x.edgePct, x.score, JSON.stringify(reasonsOf(x)), JSON.stringify(x.quotes || {})]);
    n += r.rowCount;
  }
  return n;
}
async function settle(pool) {
  await ensure(pool);
  const M = require('./migliori');
  const rows = (await pool.query(`SELECT s.id, s.selection, g.result_score FROM scalata_picks s JOIN goal_watch g ON g.event_id = s.event_id WHERE s.result IS NULL AND g.result_score ~ '^[0-9]+-[0-9]+$'`)).rows;
  for (const r of rows) await pool.query(`UPDATE scalata_picks SET result = $2, result_score = $3, settled_at = NOW() WHERE id = $1`, [r.id, M.resultOf(r.selection, r.result_score), r.result_score]);
  return rows.length;
}

/** Parte pura: la scalata giorno per giorno (raddoppio, freno a 10) e la puntata di oggi. */
function ladder(rows, { base = BASE, stop = STOP } = {}) {
  const list = [...rows].sort((a, b) => a.day.localeCompare(b.day)); let k = 0, lost = 0, pnl = 0, staked = 0, stops = 0, cycles = 0, maxK = 0, waiting = false;
  const steps = [];
  for (const r of list) {
    const stake = base * 2 ** k, odd = Number(r.odd), res = r.result;
    if (res !== 'won' && res !== 'lost') { steps.push({ ...r, step: k + 1, stake, open: true }); waiting = true; continue; }
    staked += stake;
    if (res === 'won') { const win = stake * (odd - 1); pnl += win; steps.push({ ...r, step: k + 1, stake, pnl: win, cycleEnd: 'vinta' }); cycles++; k = 0; lost = 0; }
    else { pnl -= stake; lost += stake; k++; maxK = Math.max(maxK, k); steps.push({ ...r, step: k, stake, pnl: -stake }); if (k >= stop) { steps[steps.length - 1].cycleEnd = 'freno'; stops++; k = 0; lost = 0; } }
  }
  return { base, stop, maxLoss: base * (2 ** stop - 1), step: k + 1, nextStake: base * 2 ** k, lostInCycle: lost, pnl, staked, cycles, stops, maxStep: maxK, waiting,
    steps: steps.slice(-15).reverse() };
}
async function getScalata(pool, { nowMs = Date.now() } = {}) {
  await ensure(pool);
  const BN = require('./italia').BOOK_NAMES || {};
  const rows = (await pool.query(`SELECT day, event_id, selection, league, home, away, commence_time, prob, book, odd, edge_pct, reasons, quotes, result, result_score FROM scalata_picks ORDER BY day`)).rows
    .map(r => ({ ...r, prob: Number(r.prob), odd: Number(r.odd), edgePct: Number(r.edge_pct), pick: PICK[r.selection], bookKey: r.book, book: BN[r.book] || r.book,
      quotes: Object.entries(r.quotes || {}).map(([k, q]) => ({ key: k, book: BN[k] || k, odd: Number(q), edgePct: (Number(q) * Number(r.prob) - 1) * 100 })).sort((a, b) => b.odd - a.odd) }));
  const L = ladder(rows), today = dayOf(nowMs), next = rows.find(r => r.day >= today && !r.result && T(r.commence_time) > nowMs - 3 * 3600000);
  return { since: SINCE, rules: { base: BASE, stop: STOP, minOdd: MIN_ODD, maxOdd: MAX_ODD, minEdge: MIN_EDGE }, ...L, next: next || null };
}

/** 📈 la cassa per Kelly, dichiarata da Christian (null = usa il saldo del budget). */
async function getKellyCassa(pool) { try { const v = await require('./calib').loadState(pool, 'kelly_cassa'); return v && Number(v.value) > 0 ? Number(v.value) : null; } catch (e) { return null; } }
async function setKellyCassa(pool, value) {
  const v = Number(value); if (!(v >= 10 && v <= 1e6)) throw new Error('Cassa non valida (da 10 a 1.000.000 euro)');
  await require('./calib').ensureCalib(pool); await require('./calib').saveState(pool, 'kelly_cassa', { value: v, at: new Date().toISOString() }); return v;
}

module.exports = { ladderScore, pickScalata, reasonsOf, record, settle, ladder, getScalata, getKellyCassa, setKellyCassa, BASE, STOP, SINCE };
