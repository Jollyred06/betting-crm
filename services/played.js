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
  // doppio tocco su "Ho giocato" (26 ottobre 2026: Real Esteli - Managua registrata due volte a 3 secondi): una sola giocata per segnale
  const dup = (await pool.query(`SELECT id FROM played_bets WHERE signal_id = $1 ORDER BY id LIMIT 1`, [signalId])).rows[0];
  if (dup) return { id: dup.id, giaRegistrata: true };
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

// ------------------------------------------------------------------------------------------- non giocate (1° novembre 2026)
/**
 * Segnali che si volevano giocare ma non si e' riusciti: senza questo dato i numeri sembrano migliori della realta'.
 * Motivi: quota scesa sotto la minima, partita non trovata sul sito, nessun tempo per giocarla.
 */
const SKIP_REASONS = { quota: 'quota scesa', trovata: 'partita non trovata', tempo: 'non avevo tempo' };
let skipReady = false;
async function ensureSkipped(pool) {
  if (skipReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS skipped_bets (id SERIAL PRIMARY KEY, signal_id INT NOT NULL, reason TEXT NOT NULL, book TEXT, odd_seen NUMERIC(8,3), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS skipped_bets_signal ON skipped_bets (signal_id)`);
  skipReady = true;
}
async function addSkipped(pool, signalId, body = {}) {
  await ensureSkipped(pool);
  const reason = String(body.reason || '');
  if (!SKIP_REASONS[reason]) { const e = new Error('Scegli il motivo.'); e.status = 400; throw e; }
  const s = (await pool.query(`SELECT id FROM italia_signals WHERE id = $1`, [signalId])).rows[0];
  if (!s) { const e = new Error('Segnale non trovato.'); e.status = 404; throw e; }
  const odd = Number(String(body.odd || '').replace(',', '.'));
  const r = await pool.query(`INSERT INTO skipped_bets (signal_id, reason, book, odd_seen) VALUES ($1,$2,$3,$4) RETURNING id`,
    [signalId, reason, body.book ? String(body.book).slice(0, 40) : null, odd > 1 && odd < 100 ? odd : null]);
  return { id: r.rows[0].id };
}
async function deleteSkipped(pool, id) { await ensureSkipped(pool); return { deleted: (await pool.query(`DELETE FROM skipped_bets WHERE id = $1`, [id])).rowCount }; }
async function skippedSignalIds(pool) {
  try { await ensureSkipped(pool); return new Map((await pool.query(`SELECT id, signal_id, reason FROM skipped_bets ORDER BY id`)).rows.map(r => [Number(r.signal_id), { id: Number(r.id), reason: r.reason, label: SKIP_REASONS[r.reason] || r.reason }])); }
  catch (e) { return new Map(); }
}

async function getPlayed(pool) {
  await ensurePlayed(pool);
  const { rows } = await pool.query(
    `SELECT p.*, s.home, s.away, s.selection, s.commence_time, s.odd AS signal_odd, s.book AS signal_book, s.fair_prob, s.result, s.result_score,
       s.event_id, s.league, s.edge_pct, s.pin_h, s.pin_d, s.pin_a,
       -- 8 novembre 2026: se la riga giocata non ha la chiusura, si prende quella di un'altra lettura della stessa partita e scelta
       COALESCE(s.closing_fair_prob, (SELECT x.closing_fair_prob FROM italia_signals x WHERE x.event_id = s.event_id AND x.selection = s.selection AND x.closing_fair_prob IS NOT NULL ORDER BY x.created_at DESC LIMIT 1)) AS closing_fair_prob
     FROM played_bets p JOIN italia_signals s ON s.id = p.signal_id ORDER BY p.created_at DESC LIMIT 500`);
  const out = summarize(rows);
  // 🎯 IL TUO VALORE (8 novembre 2026): la quota che hai preso tu contro la chiusura di Pinnacle, con la forchetta e un giudizio
  try {
    const I = require('./italia'), m = out.items.filter(x => x.clvPct !== null), n = m.length;
    const mean = n ? m.reduce((a, x) => a + x.clvPct, 0) / n : null;
    const sd = n > 1 ? Math.sqrt(m.reduce((a, x) => a + (x.clvPct - mean) ** 2, 0) / (n - 1)) : null;
    const ci = n >= 5 && sd !== null ? [mean - 1.96 * sd / Math.sqrt(n), mean + 1.96 * sd / Math.sqrt(n)] : null;
    const jlIds = new Set(); { const all = (await pool.query(`SELECT * FROM italia_signals WHERE strategy = 'I'`)).rows, mo = I.markOceani(all), key = r => r.event_id + '|' + r.selection;
      const jlKeys = new Set(all.filter(r => (mo.get(r.id) || {}).final).map(key)); for (const r of rows) if (jlKeys.has(r.event_id + '|' + r.selection)) jlIds.add(r.id); }
    const part = list => { const k = list.filter(x => x.clvPct !== null); return { measured: k.length, avgClvPct: k.length ? k.reduce((a, x) => a + x.clvPct, 0) / k.length : null }; };
    const verdict = n < 20 ? 'wait' : ci && ci[0] > 0 ? 'good' : mean < 0 ? 'bad' : 'wait';
    const sorted = [...m].sort((a, b) => b.clvPct - a.clvPct), pick = x => ({ home: x.home, away: x.away, selection: x.selection, book: x.book, odd: x.odd, clvPct: x.clvPct });
    out.myValue = { measured: n, avgClvPct: mean, clvCi95: ci, positivePct: out.positivePct, verdict, need: Math.max(0, 20 - n),
      jl: part(out.items.filter(x => jlIds.has(x.id))), other: part(out.items.filter(x => !jlIds.has(x.id))),
      best: sorted.slice(0, 3).map(pick), worst: sorted.slice(-3).reverse().map(pick) };
  } catch (e) { out.myValue = null; }
  try {
    await ensureSkipped(pool);
    const sk = (await pool.query(`SELECT k.*, s.home, s.away, s.selection, s.commence_time, s.clv_pct FROM skipped_bets k JOIN italia_signals s ON s.id = k.signal_id ORDER BY k.created_at DESC LIMIT 500`)).rows;
    const by = {}; for (const r of sk) by[r.reason] = (by[r.reason] || 0) + 1;
    // quota di giocabilita': delle giocate tentate, quante sono riuscite
    out.skipped = { count: sk.length, byReason: Object.entries(by).map(([k, n]) => ({ reason: k, label: SKIP_REASONS[k] || k, n })),
      playablePct: out.count + sk.length ? 100 * out.count / (out.count + sk.length) : null,
      items: sk.slice(0, 20).map(r => ({ id: r.id, signalId: r.signal_id, at: r.created_at, home: r.home, away: r.away, selection: r.selection, reason: r.reason, label: SKIP_REASONS[r.reason] || r.reason, clvPct: r.clv_pct !== null ? Number(r.clv_pct) : null })) };
  } catch (e) { out.skipped = { count: 0, byReason: [], playablePct: null, items: [] }; }
  return out;
}

/** Id dei segnali gia' giocati (per segnarli nell'app). */
async function playedSignalIds(pool) {
  try { await ensurePlayed(pool); return new Map((await pool.query(`SELECT signal_id, book, odd FROM played_bets ORDER BY id`)).rows.map(r => [Number(r.signal_id), { book: r.book, odd: Number(r.odd) }])); }
  catch (e) { return new Map(); }
}

module.exports = { SKIP_REASONS, ensureSkipped, addSkipped, deleteSkipped, skippedSignalIds, PLAYABLE, ensurePlayed, validate, addPlayed, deletePlayed, summarize, getPlayed, playedSignalIds };
