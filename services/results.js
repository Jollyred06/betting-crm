/**
 * Risultati automatici dei segnali I, B e F (vinta / persa) da API-Football (variabile APIFOOTBALL_KEY, piano gratuito).
 * Una richiesta restituisce tutte le partite di una data: il CRM abbina ogni segnale per orario e nomi delle squadre.
 * Gira dentro lo stesso passo della strategia I, al massimo una volta l'ora e solo se ci sono partite finite da chiudere.
 * Tetto prudente di richieste al giorno (RESULTS_DAILY_CAP, predefinito 80 su 100 del piano gratuito).
 * Il risultato 1X2 e' quello dei 90 minuti (score.fulltime); rinviate o annullate = "void" (non contano).
 * Qualsiasi errore viene registrato (scheda Strategie: stato dei risultati) e non ferma mai il resto.
 */
const axios = require('axios');

const BASE = 'https://v3.football.api-sports.io';
const FINISHED = new Set(['FT', 'AET', 'PEN']);
const VOID = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);
const STAKE = 2;

function rcfg(env = process.env) {
  const n = (k, d) => (env[k] !== undefined && env[k] !== '' && !isNaN(Number(env[k])) ? Number(env[k]) : d);
  return {
    key: String(env.APIFOOTBALL_KEY || '').trim().replace(/^['"]+|['"]+$/g, '').trim(),
    dailyCap: n('RESULTS_DAILY_CAP', 80),
    everyMin: n('RESULTS_EVERY_MIN', 60),
    afterMin: n('RESULTS_AFTER_MIN', 150),      // si cerca il risultato 2 ore e mezza dopo il calcio d'inizio
    giveUpHours: n('RESULTS_GIVE_UP_HOURS', 48),
    toleranceMin: n('RESULTS_TOLERANCE_MIN', 20)
  };
}

// ------------------------------------------------------------------------------------------- parte pura (testata)

/** Esito di una scommessa 1X2 dato il punteggio dei 90 minuti. */
function outcome(selection, home, away) {
  const res = home > away ? 'home' : home < away ? 'away' : 'draw';
  return res === selection ? 'won' : 'lost';
}

/** Cerca la partita di API-Football che corrisponde al segnale (stesso orario entro la tolleranza, stesse squadre). */
function matchFixture(signal, fixtures, sameTeam, toleranceMin = 20) {
  const t = Date.parse(signal.commence_time);
  const cands = (fixtures || []).filter(f => {
    const ft = Date.parse(f.fixture && f.fixture.date);
    return Math.abs(ft - t) <= toleranceMin * 60000 && sameTeam(signal.home, f.teams.home.name) && sameTeam(signal.away, f.teams.away.name);
  });
  return cands.length === 1 ? cands[0] : null;     // piu' di un candidato: meglio non indovinare
}

/** Da una partita di API-Football al risultato del segnale, oppure null se non e' ancora finita. */
function settle(signal, fx) {
  const st = fx.fixture && fx.fixture.status && fx.fixture.status.short;
  if (VOID.has(st)) return { result: 'void', score: st };
  if (!FINISHED.has(st)) return null;
  const ft = (fx.score && fx.score.fulltime) || {};
  const h = ft.home ?? (fx.goals && fx.goals.home), a = ft.away ?? (fx.goals && fx.goals.away);
  if (h === null || h === undefined || a === null || a === undefined) return null;
  return { result: outcome(signal.selection, h, a), score: `${h}-${a}` };
}

/** Testo leggibile dell'errore restituito da API-Football (piano, chiave, limite giornaliero). */
function apiError(data) {
  const e = data && data.errors;
  if (!e || (Array.isArray(e) && !e.length) || (typeof e === 'object' && !Object.keys(e).length)) return null;
  return Array.isArray(e) ? e.join('; ') : Object.values(e).join('; ');
}

// ------------------------------------------------------------------------------------------- database e rete

let ready = false;
async function ensureResults(pool) {
  if (ready) return;
  for (const col of ['result TEXT', 'result_score TEXT', 'settled_at TIMESTAMPTZ', 'af_fixture_id BIGINT']) {
    await pool.query(`ALTER TABLE italia_signals ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS results_requests (
    id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW(), day TEXT, ok BOOLEAN, fixtures INT, note TEXT)`);
  ready = true;
}

async function fetchDay(pool, c, day, http = axios) {
  let ok = false, n = 0, note = null;
  try {
    const res = await http.get(`${BASE}/fixtures`, { params: { date: day, timezone: 'UTC' }, headers: { 'x-apisports-key': c.key }, timeout: 45000 });
    const err = apiError(res.data);
    if (err) { note = err; return null; }
    const list = (res.data && res.data.response) || [];
    n = list.length; ok = true;
    return list;
  } catch (e) {
    note = (e.response && e.response.data && apiError(e.response.data)) || e.message;
    return null;
  } finally {
    try { await pool.query(`INSERT INTO results_requests (day, ok, fixtures, note) VALUES ($1,$2,$3,$4)`, [day, ok, n, note ? String(note).slice(0, 300) : null]); } catch (e) { /* solo registro */ }
  }
}

/** Un passo: chiude i segnali con partita finita. Non lancia mai. */
async function settleSignals(pool, { env = process.env, nowMs = Date.now(), http, sameTeam } = {}) {
  const c = rcfg(env);
  if (!c.key) return { risultati: 'APIFOOTBALL_KEY non impostata' };
  await ensureResults(pool);
  const last = (await pool.query(`SELECT MAX(at) AS t FROM results_requests`)).rows[0].t;
  if (last && nowMs - Date.parse(last) < c.everyMin * 60000) return { risultati: 'non ancora' };
  const today = (await pool.query(`SELECT COUNT(*)::int AS n FROM results_requests WHERE at >= date_trunc('day', NOW())`)).rows[0].n;
  if (today >= c.dailyCap) return { risultati: 'tetto giornaliero' };
  const { rows } = await pool.query(
    `SELECT id, home, away, selection, commence_time, odd FROM italia_signals
     WHERE result IS NULL AND commence_time < to_timestamp($1::double precision / 1000) - make_interval(mins => $2::int)
       AND commence_time > to_timestamp($1::double precision / 1000) - make_interval(hours => $3::int)
     ORDER BY commence_time`, [nowMs, c.afterMin, c.giveUpHours]);
  // segnali troppo vecchi senza abbinamento: "non trovato", per non riprovare all'infinito
  await pool.query(`UPDATE italia_signals SET result = 'notfound', settled_at = NOW()
    WHERE result IS NULL AND commence_time <= to_timestamp($1::double precision / 1000) - make_interval(hours => $2::int)`, [nowMs, c.giveUpHours]);
  if (!rows.length) return { risultati: 'niente da chiudere' };
  const days = [...new Set(rows.map(r => new Date(r.commence_time).toISOString().slice(0, 10)))].slice(0, 3);
  let chiusi = 0, letti = 0;
  for (const day of days) {
    const fx = await fetchDay(pool, c, day, http);
    if (!fx) return { risultati: 'errore', chiusi };
    letti += fx.length;
    for (const s of rows.filter(r => new Date(r.commence_time).toISOString().slice(0, 10) === day)) {
      const m = matchFixture(s, fx, sameTeam, c.toleranceMin);
      const out = m && settle(s, m);
      if (!out) continue;
      await pool.query(`UPDATE italia_signals SET result = $2, result_score = $3, settled_at = NOW(), af_fixture_id = $4 WHERE id = $1`,
        [s.id, out.result, out.score, m.fixture.id]);
      chiusi++;
    }
  }
  return { risultati: 'fatto', partiteLette: letti, chiusi };
}

/** Stato per l'app: attivo, ultimo esito, eventuale messaggio del piano. */
async function resultsStatus(pool, env = process.env) {
  const c = rcfg(env);
  if (!c.key) return { active: false, text: 'Risultati automatici spenti: manca la variabile APIFOOTBALL_KEY su Render.' };
  try {
    await ensureResults(pool);
    const r = (await pool.query(`SELECT at, ok, fixtures, note FROM results_requests ORDER BY id DESC LIMIT 1`)).rows[0];
    if (!r) return { active: true, ok: null, text: 'Risultati automatici: in attesa della prima partita finita.' };
    if (r.ok) return { active: true, ok: true, text: `✅ Risultati automatici attivi (ultima lettura: ${r.fixtures} partite).` };
    const plan = /season|plan/i.test(r.note || '');
    return { active: true, ok: false, text: plan ? `⚠️ Il piano gratuito di API-Football non dà la stagione in corso: ${r.note}` : `⚠️ Risultati non letti: ${r.note}` };
  } catch (e) { return { active: true, ok: false, text: `⚠️ Risultati: ${e.message}` }; }
}

/** Vinte, perse e saldo di carta a puntata fissa (i "void" e i non trovati non contano). */
function resultStats(list, stake = STAKE) {
  const done = list.filter(r => r.result === 'won' || r.result === 'lost');
  const won = done.filter(r => r.result === 'won');
  const pnl = done.reduce((a, r) => a + (r.result === 'won' ? (Number(r.odd) - 1) * stake : -stake), 0);
  return { settled: done.length, won: won.length, lost: done.length - won.length, pnlEur: pnl, roiPct: done.length ? 100 * pnl / (stake * done.length) : null };
}

module.exports = { rcfg, outcome, matchFixture, settle, apiError, ensureResults, settleSignals, resultsStatus, resultStats, STAKE };
