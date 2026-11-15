/**
 * GIOCATE SIMULATE AUTOMATICHE (14 novembre 2026; dal 15/11 anche le 🏆 Coppe): ogni segnale Justice League nuovo (prima uscita, partita non ancora iniziata)
 * viene "giocato" da solo sulla carta, alla quota del segnale e con la puntata fissa (AUTO_STAKE, default 2 euro).
 * Parte dal primo giro dopo l'attivazione (niente storico: cosi' il saldo e' tutto fuori campione e senza ritocchi).
 * E' una tabella SEPARATA dalle giocate vere (played_bets): non sporca la misura "il tuo valore", che usa le quote davvero prese da te.
 */
const DEFAULT_STAKE = 2;
let ready = false;

async function ensureAuto(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS auto_bets (id SERIAL PRIMARY KEY, signal_id INT NOT NULL UNIQUE, event_id TEXT, selection TEXT, book TEXT, odd NUMERIC(8,3) NOT NULL, stake NUMERIC(8,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS auto_state (key TEXT PRIMARY KEY, val TEXT)`);
  ready = true;
}

const stakeOf = env => { const s = Number(String((env || {}).AUTO_STAKE || '').replace(',', '.')); return s > 0 && s <= 100 ? s : DEFAULT_STAKE; };

/** Parte pura: tra i segnali I sceglie quelli da giocare. */
function pickNew(rows, { sinceMs, nowMs, taken, isOceani, isCoppe = null, primaryRows }) {
  const keys = new Set(taken.keys), ids = new Set(taken.ids);
  return primaryRows(rows.filter(r => Date.parse(r.created_at) >= sinceMs))
    .filter(r => (isOceani(r) || (isCoppe && isCoppe(r))) && Date.parse(r.commence_time) > nowMs && !ids.has(Number(r.id)) && !keys.has(r.event_id + '|' + r.selection));
}

async function runAutoplay(pool, { env = process.env, nowMs = Date.now() } = {}) {
  await ensureAuto(pool);
  const I = require('./italia');
  let st = (await pool.query(`SELECT val FROM auto_state WHERE key = 'start'`)).rows[0];
  if (!st) { await pool.query(`INSERT INTO auto_state (key, val) VALUES ('start', $1) ON CONFLICT DO NOTHING`, [new Date(nowMs).toISOString()]); st = { val: new Date(nowMs).toISOString() }; }
  const sinceMs = Date.parse(st.val);
  const rows = (await pool.query(`SELECT * FROM italia_signals WHERE strategy = 'I' AND created_at >= $1 ORDER BY created_at`, [new Date(sinceMs).toISOString()])).rows;
  const ex = (await pool.query(`SELECT signal_id, event_id, selection FROM auto_bets`)).rows;
  const taken = { ids: ex.map(r => Number(r.signal_id)), keys: ex.map(r => r.event_id + '|' + r.selection) };
  const fresh = pickNew(rows, { sinceMs, nowMs, taken, isOceani: I.isOceani, isCoppe: I.isCoppe, primaryRows: I.primaryRows });
  const stake = stakeOf(env); let n = 0;
  for (const r of fresh) {
    const k = await pool.query(`INSERT INTO auto_bets (signal_id, event_id, selection, book, odd, stake) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [r.id, r.event_id, r.selection, r.book, r.odd, stake]);
    n += k.rowCount || 0;
  }
  return { nuoveSimulate: n };
}

/** Riepilogo puro: righe auto_bets + segnale. */
function summarize(rows) {
  const items = rows.map(r => {
    const odd = Number(r.odd), stake = Number(r.stake), fair = r.fair_prob === null || r.fair_prob === undefined ? null : Number(r.fair_prob);
    const pnl = r.result === 'won' ? stake * (odd - 1) : r.result === 'lost' ? -stake : null;
    const clv = r.closing_fair_prob ? (odd * Number(r.closing_fair_prob) - 1) * 100 : null;
    return { id: r.id, at: r.created_at, home: r.home, away: r.away, selection: r.selection, book: r.book, odd, stake, result: r.result || null, pnlEur: pnl, fair, clvPct: clv, commence_time: r.commence_time };
  });
  const done = items.filter(x => x.pnlEur !== null), cl = items.filter(x => x.clvPct !== null);
  const staked = done.reduce((a, x) => a + x.stake, 0), pnl = done.reduce((a, x) => a + x.pnlEur, 0);
  const exp = done.reduce((a, x) => a + (x.fair || 0), 0), sd = Math.sqrt(done.reduce((a, x) => a + (x.fair || 0) * (1 - (x.fair || 0)), 0));
  const won = done.filter(x => x.result === 'won').length;
  return { count: items.length, open: items.length - done.length, settled: done.length, won, expectedWon: exp, z: sd > 0 ? (won - exp) / sd : null,
    stakedSettled: staked, pnlEur: pnl, roiPct: staked ? 100 * pnl / staked : null, measured: cl.length, avgClvPct: cl.length ? cl.reduce((a, x) => a + x.clvPct, 0) / cl.length : null,
    items: items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) };
}

async function getAuto(pool) {
  await ensureAuto(pool);
  const start = (await pool.query(`SELECT val FROM auto_state WHERE key = 'start'`)).rows[0];
  const { rows } = await pool.query(`SELECT a.*, s.home, s.away, s.commence_time, s.result, s.fair_prob,
      COALESCE(s.closing_fair_prob, (SELECT x.closing_fair_prob FROM italia_signals x WHERE x.event_id = s.event_id AND x.selection = s.selection AND x.closing_fair_prob IS NOT NULL ORDER BY x.created_at DESC LIMIT 1)) AS closing_fair_prob
    FROM auto_bets a JOIN italia_signals s ON s.id = a.signal_id ORDER BY a.created_at DESC LIMIT 500`);
  const out = summarize(rows);
  out.items = out.items.slice(0, 30);
  return { since: start ? start.val : null, stake: stakeOf(process.env), ...out };
}

module.exports = { DEFAULT_STAKE, stakeOf, pickNew, summarize, runAutoplay, getAuto };
