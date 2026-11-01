/**
 * ⚽ OVER/UNDER DI PINNACLE CON I CREDITI DI THE ODDS API (1° novembre 2026).
 * La strategia A e' in archivio: i suoi 500 crediti al mese servono a leggere il prezzo Over/Under di Pinnacle
 * delle partite che stanno per iniziare (entro 1–3 ore, quindi vicino alla chiusura). Cosi' si misura da subito:
 *  - se Pinnacle indovina la frequenza degli Over (il "prezzo giusto" che useremo contro i siti italiani dal 12 novembre);
 *  - se Pinnacle sa gia' della 💥 Valanga (se no, li' c'e' valore);
 *  - la formula del pareggio contro il prezzo di Pinnacle.
 * Costi: l'elenco dei campionati e delle partite e' GRATIS; si paga 1 credito per campionato letto (mercato totals, solo Pinnacle).
 * Budget: (crediti rimasti - 20 di scorta) / giorni alla ricarica del 1°. Al massimo una lettura per campionato ogni 3 ore.
 */
const axios = require('axios');
const BASE = 'https://api.the-odds-api.com/v4';
const KEEP = 20, EVERY_MIN = 60, WINDOW = [60, 180];   // minuti: lettura ogni ora, partite che iniziano tra 1 e 3 ore
let sportsCache = null;

// ------------------------------------------------------------------------------------------- parte pura (testata)
/** Crediti da spendere oggi: rimasti meno la scorta, divisi per i giorni alla ricarica (il 1° del mese). */
function dailyBudget(remaining, usedToday, nowMs = Date.now()) {
  if (remaining === null || remaining === undefined) return { perDay: 3, over: usedToday >= 3 };   // primo giorno: si parte piano
  const d = new Date(nowMs), reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const days = Math.max(1, Math.ceil((reset - nowMs) / 86400000));
  const perDay = Math.max(0, Math.floor((Number(remaining) + usedToday - KEEP) / days));
  return { perDay, days, over: usedToday >= perDay };
}
/** Righe Over/Under di Pinnacle da una risposta /odds di The Odds API: [{ event, line, over, under, fairOver }]. */
function parsePinTotals(events, noVig2) {
  const out = [];
  for (const ev of events || []) {
    const b = (ev.bookmakers || []).find(x => x.key === 'pinnacle');
    const m = b && (b.markets || []).find(x => x.key === 'totals');
    if (!m) continue;
    const byLine = {};
    for (const o of m.outcomes || []) { const L = Number(o.point); if (!(L > 0)) continue; (byLine[L] = byLine[L] || {})[String(o.name).toLowerCase()] = Number(o.price); }
    for (const [L, p] of Object.entries(byLine)) {
      const f = p.over > 1 && p.under > 1 ? noVig2(p.over, p.under) : null;
      if (f) out.push({ event: ev, line: Number(L), over: p.over, under: p.under, fairOver: f[0] });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------- database
let ready = false;
async function ensureOU(pool) {
  if (ready) return;
  await require('./goals').ensureGoals(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS goal_ou (event_id TEXT, line NUMERIC(4,1), sport_key TEXT, home TEXT, away TEXT, commence_time TIMESTAMPTZ,
    pin_over NUMERIC(8,3), pin_under NUMERIC(8,3), fair_over NUMERIC(6,4), captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), watch_id TEXT, PRIMARY KEY (event_id, line))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ou_requests (id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sport_key TEXT, paid BOOLEAN, ok BOOLEAN, events INT, remaining INT, note TEXT)`);
  ready = true;
}
async function logReq(pool, sport, paid, ok, events, remaining, note) {
  try { await pool.query(`INSERT INTO ou_requests (sport_key, paid, ok, events, remaining, note) VALUES ($1,$2,$3,$4,$5,$6)`, [sport, paid, ok, events, Number.isFinite(remaining) ? remaining : null, note ? String(note).slice(0, 300) : null]); } catch (e) { /* solo registro */ }
}
const remOf = h => (h && h['x-requests-remaining'] !== undefined ? Number(h['x-requests-remaining']) : null);

/** Lega la partita di The Odds API a quella vista da odss (stesse squadre, entro 20 minuti); se manca, la aggiunge alle partite seguite. */
async function linkWatch(pool, ev, sameTeam) {
  const t = Date.parse(ev.commence_time);
  const { rows } = await pool.query(`SELECT event_id, home, away, commence_time FROM goal_watch WHERE commence_time BETWEEN $1::timestamptz - INTERVAL '20 minutes' AND $1::timestamptz + INTERVAL '20 minutes'`, [new Date(t).toISOString()]);
  const hit = rows.find(r => sameTeam(r.home, ev.home_team) && sameTeam(r.away, ev.away_team)) || rows.find(r => sameTeam(r.home, ev.home_team) || sameTeam(r.away, ev.away_team));
  if (hit) return hit.event_id;
  const id = 'oa:' + ev.id;
  await pool.query(`INSERT INTO goal_watch (event_id, league, home, away, commence_time) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_id) DO NOTHING`, [id, ev.sport_title || ev.sport_key, ev.home_team, ev.away_team, ev.commence_time]);
  return id;
}

/** Un passo (dal giro ogni 10 minuti). Non lancia mai. */
async function tick(pool, { env = process.env, nowMs = Date.now(), http = axios } = {}) {
  const key = env.ODDS_API_KEY;
  if (!key) return { ouPinnacle: 'chiave non impostata' };
  if (env.OU_PIN_ENABLED === 'false') return { ouPinnacle: 'spento' };
  await ensureOU(pool);
  const last = (await pool.query(`SELECT MAX(at) AS at FROM ou_requests WHERE note = 'giro'`)).rows[0].at;
  if (last && nowMs - Date.parse(last) < (EVERY_MIN - 5) * 60000) return { ouPinnacle: 'non ancora' };
  const st = (await pool.query(`SELECT (SELECT remaining FROM ou_requests WHERE remaining IS NOT NULL ORDER BY id DESC LIMIT 1) AS rem,
    (SELECT COUNT(*) FROM ou_requests WHERE paid AND at >= date_trunc('day', NOW()))::int AS today`)).rows[0];
  const bud = dailyBudget(st.rem, st.today, nowMs);
  await logReq(pool, null, false, true, 0, null, 'giro');
  if (bud.over) return { ouPinnacle: `budget di oggi finito (${st.today} su ${bud.perDay})` };
  const G = require('./goals'), sameTeam = require('./italia').sameTeam;
  // elenco campionati (gratis), tenuto 12 ore
  if (!sportsCache || nowMs - sportsCache.at > 12 * 3600000) {
    const r = await http.get(`${BASE}/sports`, { params: { apiKey: key }, timeout: 20000 });
    sportsCache = { at: nowMs, keys: (r.data || []).filter(s => s.active && /^soccer_/.test(s.key) && !s.has_outrights).map(s => s.key) };
  }
  const from = new Date(nowMs + WINDOW[0] * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'), to = new Date(nowMs + WINDOW[1] * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  // partite in arrivo per campionato (gratis); si salta chi e' gia' stato letto nelle ultime 3 ore
  const recent = new Set((await pool.query(`SELECT DISTINCT sport_key FROM ou_requests WHERE paid AND ok AND at > NOW() - INTERVAL '3 hours'`)).rows.map(r => r.sport_key));
  const todo = [];
  for (const sk of sportsCache.keys) {
    if (recent.has(sk)) continue;
    try {
      const r = await http.get(`${BASE}/sports/${sk}/events`, { params: { apiKey: key, commenceTimeFrom: from, commenceTimeTo: to }, timeout: 20000 });
      const n = (r.data || []).length;
      if (n) todo.push({ sk, n });
    } catch (e) { /* un campionato che non risponde non ferma gli altri */ }
  }
  todo.sort((a, b) => b.n - a.n);   // prima i campionati con piu' partite: piu' righe per credito
  let spent = 0, saved = 0;
  for (const { sk } of todo) {
    if (st.today + spent >= bud.perDay) break;
    let r;
    try {
      r = await http.get(`${BASE}/sports/${sk}/odds`, { params: { apiKey: key, regions: 'eu', bookmakers: 'pinnacle', markets: 'totals', oddsFormat: 'decimal', commenceTimeFrom: from, commenceTimeTo: to }, timeout: 30000 });
    } catch (e) { spent++; await logReq(pool, sk, true, false, 0, remOf(e.response && e.response.headers), (e.response && e.response.status) || e.message); continue; }
    spent++;
    const rows = parsePinTotals(r.data, G.noVig2);
    for (const x of rows) {
      const wid = await linkWatch(pool, x.event, sameTeam);
      await pool.query(`INSERT INTO goal_ou (event_id, line, sport_key, home, away, commence_time, pin_over, pin_under, fair_over, watch_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (event_id, line) DO UPDATE SET pin_over = $7, pin_under = $8, fair_over = $9, captured_at = NOW(), watch_id = $10`,
        ['oa:' + x.event.id, x.line, sk, x.event.home_team, x.event.away_team, x.event.commence_time, x.over, x.under, x.fairOver, wid]);
      saved++;
    }
    await logReq(pool, sk, true, true, (r.data || []).length, remOf(r.headers), null);
  }
  return { ouPinnacle: 'fatto', campionati: todo.length, letti: spent, righe: saved, budget: bud.perDay };
}

/** Numeri per l'app: Pinnacle indovina gli Over? E sulla Valanga? Solo linee intere-e-mezzo con risultato. */
async function getPinOU(pool) {
  await ensureOU(pool);
  const { rows } = await pool.query(`SELECT o.line, o.fair_over, w.goals, w.valanga, w.exp_goals FROM goal_ou o JOIN goal_watch w ON w.event_id = o.watch_id WHERE w.goals IS NOT NULL`);
  const st = list => { const n = list.length; return { n, expected: n ? 100 * list.reduce((a, r) => a + Number(r.fair_over), 0) / n : null, real: n ? 100 * list.filter(r => r.goals > Number(r.line)).length / n : null }; };
  const at = L => rows.filter(r => Number(r.line) === L);
  const cr = (await pool.query(`SELECT (SELECT remaining FROM ou_requests WHERE remaining IS NOT NULL ORDER BY id DESC LIMIT 1) AS rem,
    (SELECT COUNT(*) FROM ou_requests WHERE paid AND at >= date_trunc('day', NOW()))::int AS today, (SELECT COUNT(*) FROM goal_ou)::int AS lines`)).rows[0];
  return { lines: { 1.5: st(at(1.5)), 2.5: st(at(2.5)), 3.5: st(at(3.5)) }, valanga25: st(at(2.5).filter(r => r.valanga)), valanga35: st(at(3.5).filter(r => r.valanga)),
    credits: { remaining: cr.rem, today: cr.today, budget: dailyBudget(cr.rem, cr.today).perDay }, righe: cr.lines };
}

module.exports = { dailyBudget, parsePinTotals, ensureOU, tick, getPinOU, KEEP };
