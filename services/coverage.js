/**
 * 📋 RISULTATI MANCANTI (21 novembre 2026). Nel backup del 21/11 solo il 45% delle partite viste dal CRM (goal_watch) aveva il
 * risultato: l'IA impara solo da quelle, e le prove sulla carta (Sicure, Migliori) non si chiudono. Due rimedi, gratis:
 *  1. lo STORICO (football-data, gia' scaricato ogni giorno in hist_pin, con i risultati dei campionati che copre): ogni partita
 *     vista e ancora senza risultato si cerca li' (stessa data, stesse squadre) e si chiude;
 *  2. si misura quanto manca, giorno per giorno, e dove (per migliorare l'abbinamento dei nomi con dati veri).
 */
const T = x => new Date(x).getTime();

/** Parte pura: abbina le partite senza risultato alle righe dello storico (stessa data UTC o giorno prima/dopo, stesse squadre). */
function matchHist(watch, hist, sameTeam) {
  const byDay = new Map();
  for (const h of hist) { const d = String(h.match_date instanceof Date ? h.match_date.toISOString() : h.match_date).slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(h); }
  const out = [];
  for (const w of watch) {
    const t = T(w.commence_time); if (!Number.isFinite(t)) continue;
    const days = [-1, 0, 1].map(k => new Date(t + k * 86400000).toISOString().slice(0, 10));
    const c = days.flatMap(d => byDay.get(d) || []).filter(h => sameTeam(w.home, h.home) && sameTeam(w.away, h.away));
    if (c.length === 1 && Number.isFinite(Number(c[0].hg)) && Number.isFinite(Number(c[0].ag))) out.push({ event_id: w.event_id, score: `${Number(c[0].hg)}-${Number(c[0].ag)}` });
  }
  return out;
}

/** Chiude dallo storico le partite viste negli ultimi 45 giorni ancora senza risultato. */
let lastRun = 0;   // al massimo ogni 6 ore (lo storico si aggiorna una volta al giorno; si risparmia traffico con Supabase)
async function settleFromHist(pool, { nowMs = Date.now(), force = false } = {}) {
  if (!force && nowMs - lastRun < 6 * 3600000) return {};
  lastRun = nowMs;
  const I = require('./italia'), G = require('./goals');
  const watch = (await pool.query(`SELECT event_id, home, away, commence_time FROM goal_watch WHERE result_score IS NULL
    AND commence_time < to_timestamp($1::double precision / 1000) - INTERVAL '3 hours' AND commence_time > to_timestamp($1::double precision / 1000) - INTERVAL '45 days'`, [nowMs])).rows;
  if (!watch.length) return { storicoChiuse: 0, daChiudere: 0 };
  const from = new Date(Math.min(...watch.map(w => T(w.commence_time))) - 86400000).toISOString().slice(0, 10);
  const hist = (await pool.query(`SELECT match_date, home, away, hg, ag FROM hist_pin WHERE match_date >= $1::date`, [from]).catch(() => ({ rows: [] }))).rows;
  let n = 0;
  for (const m of matchHist(watch, hist, I.sameTeam)) { await G.setWatchScore(pool, m.event_id, m.score); n++; }
  return { storicoChiuse: n, daChiudere: watch.length };
}

/** Quanto manca, per giorno (ora italiana), ultimi 21 giorni. */
async function getCoverage(pool, { nowMs = Date.now() } = {}) {
  const rows = (await pool.query(`SELECT to_char(commence_time AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE result_score ~ '^[0-9]+-[0-9]+$')::int AS done
    FROM goal_watch WHERE commence_time < to_timestamp($1::double precision / 1000) - INTERVAL '3 hours' AND commence_time > to_timestamp($1::double precision / 1000) - INTERVAL '21 days'
    GROUP BY 1 ORDER BY 1`, [nowMs])).rows;
  const n = rows.reduce((a, r) => a + r.n, 0), done = rows.reduce((a, r) => a + r.done, 0);
  // i campionati che mancano di piu' (ultimi 7 giorni): dove serve una fonte o un abbinamento migliore
  const leagues = (await pool.query(`SELECT league, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE result_score IS NULL)::int AS missing FROM goal_watch
    WHERE commence_time < to_timestamp($1::double precision / 1000) - INTERVAL '3 hours' AND commence_time > to_timestamp($1::double precision / 1000) - INTERVAL '7 days'
    GROUP BY league ORDER BY missing DESC LIMIT 15`, [nowMs])).rows;
  return { total: n, done, pct: n ? 100 * done / n : null, days: rows, missingLeagues: leagues };
}

module.exports = { matchHist, settleFromHist, getCoverage };
