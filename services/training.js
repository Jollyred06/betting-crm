/**
 * BANKROLL DI ALLENAMENTO (sulla carta, nessun soldo vero).
 * Per ogni selezione candidata (F, F2, F3) fa crescere tre casse da START euro con tre modi di puntare,
 * sugli stessi segnali e nello stesso ordine in cui sono usciti:
 *   - fisso:          sempre il 2% della cassa di partenza
 *   - proporzionale:  il 2% della cassa del momento (sale quando si vince, scende quando si perde)
 *   - kelly prudente: mezzo Kelly sul vantaggio del segnale, tra lo 0,5% e il 3% della cassa
 * Due saldi per ogni cassa:
 *   - atteso: ogni segnale misurato rende puntata x valore contro la chiusura (quanto vale davvero, senza fortuna)
 *   - reale:  ogni segnale con risultato rende la vincita o la perdita vera (dipende anche dalla fortuna)
 * Freno: se una cassa scende sotto il 75% della partenza, quel metodo si ferma (come si farebbe con soldi veri).
 */
const START = 500;
const STOP_AT = 0.75;
const METHODS = [
  { key: 'fixed', label: 'Fisso', desc: '2% della cassa di partenza, sempre uguale' },
  { key: 'prop', label: 'Proporzionale', desc: '2% della cassa del momento' },
  { key: 'kelly', label: 'Kelly prudente', desc: 'Più puntata quando il vantaggio è alto, massimo 3%' }
];

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

/** Puntata del metodo dato il saldo attuale e il segnale. */
function stakeFor(method, balance, signal, start = START) {
  if (method === 'fixed') return 0.02 * start;
  if (method === 'prop') return 0.02 * balance;
  // mezzo Kelly: f = p - (1 - p) / (q - 1) con p dal prezzo giusto di Pinnacle, poi / 2, tra 0,5% e 3%
  const q = num(signal.odd), p = num(signal.fair_prob);
  if (!(q > 1) || !(p > 0)) return 0.01 * balance;
  const kelly = p - (1 - p) / (q - 1);
  const f = Math.min(0.03, Math.max(0.005, kelly / 2));
  return f * balance;
}

/** Fa girare una cassa su una lista di segnali. kind: 'expected' (valore alla chiusura) o 'real' (vinte e perse). */
function runCash(method, signals, kind, start = START) {
  let balance = start, peak = start, maxDd = 0, bets = 0, staked = 0, stopped = false;
  const curve = [{ b: start }];
  for (const s of signals) {
    let pnl = null;
    const stake = stakeFor(method, balance, s, start);
    if (kind === 'expected') {
      const clv = num(s.clv_pct);
      if (clv === null) continue;
      pnl = stake * clv / 100;
    } else {
      if (s.result === 'won') pnl = stake * (num(s.odd) - 1);
      else if (s.result === 'lost') pnl = -stake;
      else continue;
    }
    if (stopped) continue;
    balance += pnl; bets++; staked += stake;
    peak = Math.max(peak, balance); maxDd = Math.max(maxDd, (peak - balance) / peak);
    curve.push({ b: Math.round(balance * 100) / 100 });
    if (balance < STOP_AT * start) stopped = true;
  }
  return { balance, pnl: balance - start, bets, staked, roiPct: staked ? 100 * (balance - start) / staked : null, maxDrawdownPct: 100 * maxDd, stopped, curve };
}

/** Tutte le casse per una selezione. */
function trainSelection(signals, start = START) {
  const ordered = [...signals].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return {
    signals: ordered.length,
    measured: ordered.filter(s => num(s.clv_pct) !== null).length,
    settled: ordered.filter(s => s.result === 'won' || s.result === 'lost').length,
    methods: METHODS.map(m => ({ ...m, expected: runCash(m.key, ordered, 'expected', start), real: runCash(m.key, ordered, 'real', start) }))
  };
}

async function getTraining(pool) {
  const I = require('./italia');
  const { rows } = await pool.query(`SELECT * FROM italia_signals WHERE strategy = 'I' ORDER BY created_at`);
  const prim = I.primaryRows(rows);   // F e F3 sulla prima uscita, F2 anche sulle riletture vicino al calcio d'inizio
  const pick = (mark, list = prim) => { const m = mark(list); return list.filter(r => m.get(r.id) && m.get(r.id).final); };
  const sel = [
    { key: 'F', title: 'Selezione F', rows: pick(I.markFinal) },
    { key: 'F2', title: 'Selezione F2', rows: pick(I.markFinal2, rows) },
    { key: 'F3', title: 'Selezione F3 (favoriti)', rows: pick(I.markFinal3) }
  ];
  return { start: START, stopAtPct: STOP_AT * 100, selections: sel.map(s => ({ key: s.key, title: s.title, ...trainSelection(s.rows) })) };
}

module.exports = { START, STOP_AT, METHODS, stakeFor, runCash, trainSelection, getTraining };
