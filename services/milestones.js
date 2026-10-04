/**
 * TAPPE: fotografie dei numeri a 100, 200 e 300 segnali CHIUSI, salvate una volta sola e mai modificate.
 * La fotografia usa i PRIMI N segnali chiusi (in ordine di chiusura), quindi non cambia se il controllo avviene in ritardo.
 * Il codice ha un'impronta (hash): se qualcuno cambiasse i numeri dopo, l'impronta non tornerebbe.
 * La regola della decisione è fissata qui, prima di vedere i dati (1 ottobre 2026): modificarla dopo aver visto i numeri
 * vorrebbe dire adattarla al risultato.
 */
const crypto = require('crypto');
const { summarize } = require('./weeklyReport');

const TARGETS = [100, 200, 300];
const MINOR = new Set(['E2', 'E3', 'I2', 'SP2', 'F2', 'D2']);

const RULE = {
  fixedOn: '2026-10-01',
  intro: 'Regola fissata prima di vedere i dati. Le tappe a 100 e 200 sono solo controlli: non si decide niente. Si decide una volta sola, a 300 segnali chiusi.',
  lines: [
    'Fascia di incertezza del valore rispetto alla chiusura tutta sopra lo zero e ROI non chiaramente negativo: vantaggio plausibile. Non è un via libera a giocare: il passo dopo è verificare che quelle quote fossero davvero ottenibili.',
    'Fascia che include lo zero: nessun vantaggio dimostrato. Si prosegue fino a circa 600 segnali chiusi, oppure si chiude.',
    'Fascia tutta sotto lo zero: nessun vantaggio, si chiude.',
    'Valore sulla chiusura positivo ma ROI chiaramente negativo: qualcosa nei dati non torna, da indagare prima di fidarsi.'
  ],
  note: 'Dal 3 ottobre 2026 il valore rispetto alla chiusura è misurato sulla chiusura di Pinnacle (non più sulla media dei bookmaker) e la quota è quella presa. La regola di decisione non cambia. Analisi secondaria dichiarata in anticipo: segnali con probabilità Pinnacle sotto il 40% contro 40% o più.'
};

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const round = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

function ci95(values) {
  if (values.length < 20) return null;
  const m = mean(values), sd = Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1)), h = 1.96 * sd / Math.sqrt(values.length);
  return [round(m - h), round(m + h)];
}

const known = r => r.n_near_best !== null && r.n_near_best !== undefined;

function group(rows) {
  if (!rows.length) return { n: 0, avgClvPct: null, roiFlatPct: null, hitRatePct: null };
  const s = summarize(rows.map(r => ({ odd: r.odd, status: r.status, edge_pct: r.edge_pct, clv_pct: r.clv_pct })));
  return { n: rows.length, avgClvPct: round(s.avgClvPct), roiFlatPct: round(s.roiFlatPct), hitRatePct: round(s.hitRatePct) };
}

/** rows: segnali CHIUSI { odd, status, edge_pct, clv_pct, est_prob, league_code, selection, sharp_source }. */
function buildSnapshot(rows, { pendingNow = null } = {}) {
  const s = summarize(rows.map(r => ({ odd: r.odd, status: r.status, edge_pct: r.edge_pct, clv_pct: r.clv_pct })));
  const profits = rows.map(r => (r.status === 'won' ? Number(r.odd) - 1 : -1));
  const clvs = rows.map(r => r.clv_pct).filter(v => v !== null && v !== undefined).map(Number);
  const wins = rows.filter(r => r.status === 'won').length;
  const p = f => rows.filter(f);
  return {
    n: rows.length, wins, expectedWins: round(rows.reduce((t, r) => t + Number(r.est_prob || 0), 0), 1),
    hitRatePct: round(s.hitRatePct), avgOdd: round(s.avgOdd, 2), avgEdgePct: round(s.avgEdgePct, 2),
    roiFlatPct: round(s.roiFlatPct), roiCi95: (() => { const c = ci95(profits); return c && c.map(v => round(v * 100)); })(),
    avgClvPct: round(s.avgClvPct), nClv: clvs.length, clvCi95: s.clvCi95 && s.clvCi95.map(v => round(v)),
    pinnacleSharePct: round(rows.length ? (rows.filter(r => r.sharp_source === 'pinnacle').length / rows.length) * 100 : null, 1),
    groups: {
      edge: { '2-3%': group(p(r => Number(r.edge_pct) < 3)), '3% o più': group(p(r => Number(r.edge_pct) >= 3)) },
      tier: { maggiori: group(p(r => !MINOR.has(r.league_code))), minori: group(p(r => MINOR.has(r.league_code))) },
      selection: { casa: group(p(r => r.selection === 'home')), pareggio: group(p(r => r.selection === 'draw')), trasferta: group(p(r => r.selection === 'away')) },
      odds: { 'sotto 4': group(p(r => Number(r.odd) < 4)), '4 o più': group(p(r => Number(r.odd) >= 4)) },
      // la quota migliore era offerta da più bookmaker (ottenibile) o da uno solo (possibile quota fuori linea)?
      avail: { 'più bookmaker': group(p(r => known(r) && Number(r.n_near_best) >= 2)), 'un solo bookmaker': group(p(r => known(r) && Number(r.n_near_best) === 1)) },
      // analisi secondaria dichiarata in anticipo (3 ottobre 2026): gli esiti probabili (>= 40% secondo Pinnacle) mantengono il vantaggio meglio di pareggi e underdog?
      prob: { 'sotto il 40%': group(p(r => Number(r.est_prob) > 0 && Number(r.est_prob) < 0.4)), '40% o più': group(p(r => Number(r.est_prob) >= 0.4)) }
    },
    quality: { pendingNow, quoteRegistrate: rows.filter(r => r.n_near_best !== null && r.n_near_best !== undefined).length }
  };
}

/** Decisione secondo la regola fissata. Solo alla tappa 300. */
function decide(snap) {
  const c = snap.clvCi95, r = snap.roiCi95;
  if (!c) return { level: 'none', title: 'Dati insufficienti', text: 'Non c\'è ancora una fascia di incertezza affidabile: servono più segnali con il confronto sulla chiusura.' };
  if (c[1] < 0) return { level: 'close', title: 'Nessun vantaggio: si chiude', text: 'Il valore rispetto alla chiusura è chiaramente negativo: in media il mercato chiude meglio delle quote prese.' };
  if (c[0] > 0 && r && r[1] < 0) return { level: 'mixed', title: 'I numeri non tornano', text: 'Il valore sulla chiusura è positivo ma il ROI è chiaramente negativo. Prima di fidarsi bisogna capire perché.' };
  if (c[0] > 0) return { level: 'plausible', title: 'Vantaggio plausibile', text: 'La fascia è tutta sopra lo zero. Non è un via libera a giocare: il passo dopo è verificare che le quote fossero davvero ottenibili.' };
  return { level: 'none', title: 'Nessun vantaggio dimostrato', text: 'La fascia include lo zero. Si prosegue fino a circa 600 segnali chiusi, oppure si chiude.' };
}

const hashOf = (target, snapshot, decision) => crypto.createHash('sha256').update(JSON.stringify({ target, snapshot, decision })).digest('hex');

/** Salva le fotografie delle tappe raggiunte e non ancora salvate. Restituisce i numeri delle tappe nuove. */
async function checkMilestones(pool) {
  const newly = [];
  for (const target of TARGETS) {
    const exists = await pool.query(`SELECT 1 FROM milestone_snapshots WHERE target = $1`, [target]);
    if (exists.rows.length) continue;
    const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM value_bets WHERE strategy = 'A_sharp' AND status IN ('won','lost')`);
    if (Number((cnt.rows[0] || {}).n || 0) < target) break;                                   // le tappe seguenti non sono raggiunte
    let rows;
    try {   // quota PRESA e valore vs chiusura PINNACLE (il ripiego sulla media di chiusura non conta nel CLV)
      ({ rows } = await pool.query(
        `SELECT id, COALESCE(quota_presa, bookmaker_odd) AS odd, status, edge_pct, CASE WHEN clv_source = 'pinnacle' THEN clv_pct END AS clv_pct,
                estimated_probability AS est_prob, league_code, selection, sharp_source, n_near_best
         FROM value_bets WHERE strategy = 'A_sharp' AND status IN ('won','lost') ORDER BY settled_at ASC NULLS LAST, id ASC LIMIT $1`, [target]));
    } catch (e) {   // schema non ancora aggiornato
      ({ rows } = await pool.query(
        `SELECT id, bookmaker_odd AS odd, status, edge_pct, clv_pct, estimated_probability AS est_prob, league_code, selection, sharp_source, n_near_best
         FROM value_bets WHERE strategy = 'A_sharp' AND status IN ('won','lost') ORDER BY settled_at ASC NULLS LAST, id ASC LIMIT $1`, [target]));
    }
    const pend = await pool.query(`SELECT COUNT(*)::int AS n FROM value_bets WHERE strategy = 'A_sharp' AND status = 'pending'`);
    const snapshot = buildSnapshot(rows, { pendingNow: Number((pend.rows[0] || {}).n || 0) });
    const decision = target === TARGETS[TARGETS.length - 1] ? decide(snapshot) : null;
    const ins = await pool.query(
      `INSERT INTO milestone_snapshots (target, last_signal_id, snapshot, decision, hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (target) DO NOTHING`,
      [target, rows.length ? rows[rows.length - 1].id : null, JSON.stringify(snapshot), decision ? JSON.stringify(decision) : null, hashOf(target, snapshot, decision)]);
    newly.push(target);
  }
  return newly;
}

async function getMilestones(pool) {
  const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM value_bets WHERE strategy = 'A_sharp' AND status IN ('won','lost')`);
  const settledNow = Number((cnt.rows[0] || {}).n || 0);
  let saved = [];
  try { saved = (await pool.query(`SELECT target, reached_at, snapshot, decision, hash FROM milestone_snapshots ORDER BY target`)).rows; } catch (e) { /* tabella non ancora creata */ }
  return {
    settledNow, rule: RULE,
    targets: TARGETS.map(t => {
      const s = saved.find(x => Number(x.target) === t);
      return s ? { target: t, reached: true, reachedAt: s.reached_at, hash: String(s.hash).slice(0, 10), snapshot: typeof s.snapshot === 'string' ? JSON.parse(s.snapshot) : s.snapshot, decision: typeof s.decision === 'string' ? JSON.parse(s.decision) : s.decision }
        : { target: t, reached: false, progress: Math.min(settledNow, t) };
    })
  };
}

module.exports = { TARGETS, RULE, buildSnapshot, decide, hashOf, checkMilestones, getMilestones };
