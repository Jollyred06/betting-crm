/**
 * LE MIE GIOCATE VERE: per ogni segnale giocato si annotano bookmaker, quota presa e puntata.
 * Il CRM poi misura da solo:
 *   - valore della quota PRESA contro la chiusura di Pinnacle (la stessa misura dei segnali)
 *   - quanto la quota presa differisce da quella del segnale (se le quote sono davvero prendibili)
 *   - vinte, perse e saldo, quando arriva il risultato
 */
const PLAYABLE = { snai: 'Snai', '888sport_it': '888sport', netwin: 'Netwin', goldbet: 'Goldbet', eurobet: 'Eurobet', sisal: 'Sisal' };
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

let ready = false;
async function ensurePlayed(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS played_bets (
    id SERIAL PRIMARY KEY, signal_id INT NOT NULL, book TEXT NOT NULL, odd NUMERIC(8,3) NOT NULL, stake NUMERIC(8,2) NOT NULL,
    note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS played_bets_signal ON played_bets (signal_id)`);
  ready = true;
}

/** Controlla i dati scritti a mano. Restituisce un messaggio d'errore o null. */
function validate({ book, odd, stake }) {
  if (!book || String(book).trim().length < 2) return 'Scegli il bookmaker.';
  if (!(Number(odd) > 1 && Number(odd) < 100)) return 'Scrivi la quota presa (per esempio 2,10).';
  if (!(Number(stake) > 0 && Number(stake) <= 1000)) return 'Scrivi la puntata (per esempio 2).';
  return null;
}

async function addPlayed(pool, signalId, body = {}) {
  await ensurePlayed(pool);
  const b = { book: String(body.book || '').trim(), odd: Number(String(body.odd).replace(',', '.')), stake: Number(String(body.stake ?? 2).replace(',', '.')) };
  const err = validate(b);
  if (err) { const e = new Error(err); e.status = 400; throw e; }
  const s = (await pool.query(`SELECT id FROM italia_signals WHERE id = $1`, [signalId])).rows[0];
  if (!s) { const e = new Error('Segnale non trovato.'); e.status = 404; throw e; }
  const r = await pool.query(`INSERT INTO played_bets (signal_id, book, odd, stake, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [signalId, b.book.slice(0, 40), b.odd, b.stake, body.note ? String(body.note).slice(0, 200) : null]);
  return { id: r.rows[0].id };
}

async function deletePlayed(pool, id) {
  await ensurePlayed(pool);
  const r = await pool.query(`DELETE FROM played_bets WHERE id = $1`, [id]);
  return { deleted: r.rowCount };
}

/** Riepilogo puro (testabile) di righe giocata + segnale. */
function summarize(rows, minEdgePct = 2) {
  const items = rows.map(r => {
    const odd = num(r.odd), stake = num(r.stake), fairClose = num(r.closing_fair_prob), fairAtSignal = num(r.fair_prob), sigOdd = num(r.signal_odd);
    const minOdd = fairAtSignal ? Math.ceil((1 + minEdgePct / 100) / fairAtSignal * 100) / 100 : null;
    const clv = fairClose ? (odd * fairClose - 1) * 100 : null;
    const pnl = r.result === 'won' ? stake * (odd - 1) : r.result === 'lost' ? -stake : null;
    return {
      id: r.id, signalId: r.signal_id, at: r.created_at, home: r.home, away: r.away, selection: r.selection, commence_time: r.commence_time,
      book: r.book, odd, stake, signalOdd: sigOdd, signalBook: PLAYABLE[r.signal_book] || r.signal_book, minOdd,
      okMin: minOdd ? odd >= minOdd - 1e-9 : null, slipPct: sigOdd ? (odd / sigOdd - 1) * 100 : null,
      clvPct: clv, expectedEur: clv === null ? null : stake * clv / 100, result: r.result || null, score: r.result_score || null, pnlEur: pnl
    };
  });
  const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
  const measured = items.filter(x => x.clvPct !== null), settled = items.filter(x => x.pnlEur !== null);
  return {
    count: items.length, staked: sum(items, x => x.stake),
    measured: measured.length, avgClvPct: measured.length ? sum(measured, x => x.clvPct) / measured.length : null,
    positivePct: measured.length ? 100 * measured.filter(x => x.clvPct > 0).length / measured.length : null,
    expectedEur: sum(measured, x => x.expectedEur),
    settled: settled.length, won: settled.filter(x => x.result === 'won').length, pnlEur: sum(settled, x => x.pnlEur),
    okMinPct: items.filter(x => x.okMin !== null).length ? 100 * items.filter(x => x.okMin).length / items.filter(x => x.okMin !== null).length : null,
    avgSlipPct: items.filter(x => x.slipPct !== null).length ? sum(items, x => x.slipPct) / items.filter(x => x.slipPct !== null).length : null,
    byBook: [...new Set(items.map(x => x.book))].map(b => { const g = items.filter(x => x.book === b); return { book: b, count: g.length, staked: sum(g, x => x.stake), pnlEur: sum(g, x => x.pnlEur) }; }),
    items: items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  };
}

async function getPlayed(pool) {
  await ensurePlayed(pool);
  const { rows } = await pool.query(
    `SELECT p.*, s.home, s.away, s.selection, s.commence_time, s.odd AS signal_odd, s.book AS signal_book, s.fair_prob, s.closing_fair_prob, s.result, s.result_score
     FROM played_bets p JOIN italia_signals s ON s.id = p.signal_id ORDER BY p.created_at DESC LIMIT 500`);
  return summarize(rows);
}

/** Id dei segnali gia' giocati (per segnarli nell'app). */
async function playedSignalIds(pool) {
  try { await ensurePlayed(pool); return new Map((await pool.query(`SELECT signal_id, book, odd FROM played_bets ORDER BY id`)).rows.map(r => [Number(r.signal_id), { book: r.book, odd: Number(r.odd) }])); }
  catch (e) { return new Map(); }
}

module.exports = { PLAYABLE, ensurePlayed, validate, addPlayed, deletePlayed, summarize, getPlayed, playedSignalIds };
