/**
 * 🎲 DOPPIA CHANCE SULLA CARTA (18 novembre 2026, voluta da Christian). Una lettura al giorno (1 richiesta odss), subito dopo
 * la scansione delle 17, cosi' l'1X2 di Pinnacle salvato e' fresco. Le doppie chance pagate almeno il 2% piu' del giusto
 * (giusto = probabilita' Pinnacle 1+X, X+2 o 1+2), solo nei campionati con margine Pinnacle sotto il 6% e con la quota di
 * Pinnacle letta nelle ultime 3 ore, diventano segnali SULLA CARTA: risultato, vinte contro attese, saldo. Nessuna giocata.
 * Prova di 2-3 settimane: la prima lettura il 18/11/2026 ha trovato valore solo nell'1,8% delle quote (contro il 10-15% dell'1X2).
 * DC_PAPER=false su Render per spegnerla; DC_HOUR per l'ora (default 17).
 */
const ROME_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' });
const romeHour = ms => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date(ms))) % 24;
const dcCfg = (env = process.env) => ({ on: String(env.DC_PAPER || '').trim().toLowerCase() !== 'false', hour: Number.isFinite(Number(env.DC_HOUR)) && env.DC_HOUR !== undefined && env.DC_HOUR !== '' ? Number(env.DC_HOUR) : 17, minEdge: 2, maxMargin: 6, freshH: 3 });
let ready = false;
async function ensureDc(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS dc_signals (id SERIAL PRIMARY KEY, event_id TEXT NOT NULL, league TEXT, home TEXT, away TEXT, commence_time TIMESTAMPTZ,
    selection TEXT NOT NULL, book TEXT, odd NUMERIC(8,3), fair_prob NUMERIC(8,5), edge_pct NUMERIC(8,3), pin_h NUMERIC(8,3), pin_d NUMERIC(8,3), pin_a NUMERIC(8,3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), result TEXT, result_score TEXT, settled_at TIMESTAMPTZ, UNIQUE (event_id, selection))`);
  ready = true;
}

/** Scelta pura dei segnali da una lettura gia' riassunta (summarizeDC con all=true). */
function pickDc(found, { maxMargin = 6, minEdge = 2 } = {}) {
  const best = new Map();
  for (const f of found || []) {
    const p = f.pin || {}, h = Number(p.pin_h), d = Number(p.pin_d), a = Number(p.pin_a);
    if (!(h > 1 && d > 1 && a > 1)) continue;
    const margin = (1 / h + 1 / d + 1 / a - 1) * 100;
    if (margin >= maxMargin || f.edgePct < minEdge) continue;
    const k = f.event + '|' + f.esito;
    if (!best.has(k) || best.get(k).quota < f.quota) best.set(k, { ...f, margin });   // un segnale per esito: il sito che paga di piu'
  }
  return [...best.values()];
}

/** Una volta al giorno, dopo la scansione dell'ora scelta. */
async function dcDaily(pool, c, { nowMs = Date.now(), http, env = process.env } = {}) {
  const k = dcCfg(env);
  if (!k.on) return { doppiaChance: 'spenta' };
  if (romeHour(nowMs) !== k.hour) return {};
  await ensureDc(pool);
  const today = ROME_DAY.format(new Date(nowMs));
  const done = (await pool.query(`SELECT 1 FROM italia_requests WHERE kind = 'dc_paper' AND at > to_timestamp($1::double precision / 1000) - INTERVAL '20 hours' LIMIT 1`, [nowMs])).rows.length;
  if (done) return {};
  // aspetta che la scansione di quest'ora sia fatta: cosi' l'1X2 di Pinnacle e' di pochi minuti prima
  const scanned = (await pool.query(`SELECT 1 FROM italia_requests WHERE kind = 'scan' AND ok AND at > to_timestamp($1::double precision / 1000) - INTERVAL '50 minutes' LIMIT 1`, [nowMs])).rows.length;
  if (!scanned) return { doppiaChance: 'aspetta la scansione' };
  const I = require('./italia'), M = require('./markets');
  const records = await I.fetchOdds(pool, c, { market: 'dc', content: 'match', limit: 3000, bookmakers: [...new Set([...c.books, ...c.myBooks])].join(','),
    commence_from: new Date(nowMs + 15 * 60000).toISOString(), commence_to: new Date(nowMs + 30 * 3600000).toISOString() }, 'dc_paper', http);
  const ids = [...new Set((records || []).map(r => r.event_id))];
  const pins = new Map(ids.length ? (await pool.query(`SELECT event_id, pin_h, pin_d, pin_a, updated_at FROM goal_watch WHERE event_id = ANY($1) AND pin_h IS NOT NULL AND updated_at > to_timestamp($2::double precision / 1000) - make_interval(hours => $3::int)`, [ids, nowMs, k.freshH])).rows.map(r => [r.event_id, r]) : []);
  const sum = M.summarizeDC(records, pins, { all: true });
  const picks = pickDc(sum.tutti, k);
  let n = 0;
  for (const f of picks) {
    const q = await pool.query(`INSERT INTO dc_signals (event_id, league, home, away, commence_time, selection, book, odd, fair_prob, edge_pct, pin_h, pin_d, pin_a)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (event_id, selection) DO NOTHING`,
      [f.event, f.lega, f.home, f.away, f.commence_time, f.esito, f.sito, f.quota, f.fair, f.edgePct, f.pin.pin_h, f.pin.pin_d, f.pin.pin_a]);
    n += q.rowCount || 0;
  }
  return { doppiaChance: `letta il ${today}: ${sum.quote} quote, ${n} segnali sulla carta` };
}

const outOf = (sel, score) => { const m = /^(\d+)-(\d+)$/.exec(String(score || '')); if (!m) return null; const a = +m[1], b = +m[2], o = a > b ? '1' : a === b ? 'X' : '2'; return sel.includes(o) ? 'won' : 'lost'; };
/** Risultati: dalla tabella delle partite viste (riempita da Highlightly e dai segnali). */
async function settleDc(pool) {
  await ensureDc(pool);
  const rows = (await pool.query(`SELECT d.id, d.selection, g.result_score FROM dc_signals d JOIN goal_watch g ON g.event_id = d.event_id WHERE d.result IS NULL AND g.result_score ~ '^[0-9]+-[0-9]+$'`)).rows;
  for (const r of rows) await pool.query(`UPDATE dc_signals SET result = $2, result_score = $3, settled_at = NOW() WHERE id = $1`, [r.id, outOf(r.selection, r.result_score), r.result_score]);
  return rows.length;
}

/** Riepilogo puro. */
function summarizeDcPaper(rows) {
  const done = rows.filter(r => r.result === 'won' || r.result === 'lost');
  const won = done.filter(r => r.result === 'won').length, exp = done.reduce((a, r) => a + Number(r.fair_prob), 0);
  const pnl = done.reduce((a, r) => a + (r.result === 'won' ? Number(r.odd) - 1 : -1), 0);
  return { count: rows.length, settled: done.length, won, expected: exp, roiPct: done.length ? 100 * pnl / done.length : null,
    items: rows.slice(0, 15).map(r => ({ home: r.home, away: r.away, league: r.league, at: r.commence_time, selection: r.selection, book: r.book, odd: Number(r.odd), edge: Number(r.edge_pct), result: r.result, score: r.result_score })) };
}
async function getDcPaper(pool) {
  await ensureDc(pool);
  const rows = (await pool.query(`SELECT * FROM dc_signals ORDER BY created_at DESC LIMIT 500`)).rows;
  return { on: dcCfg().on, hour: dcCfg().hour, ...summarizeDcPaper(rows) };
}

module.exports = { dcCfg, pickDc, dcDaily, settleDc, summarizeDcPaper, getDcPaper, outOf };
